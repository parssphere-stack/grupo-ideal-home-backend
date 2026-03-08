// Recover all Malaga particular listings from 5 Apify datasets
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.APIFY_TOKEN;
const BASE = "https://api.apify.com/v2";

const MALAGA_DATASETS = [
  "hDXlPQn7qipmaefJ4",  // 200 items, sale, 26 private
  "VwYcedccygAPfbsaM",  // 2500 items, sale, 180 private
  "nVP6Dw09KgCt0MbXg",  // 2500 items, rent, 535 private
  "8KcB33MIOrug4rfWN",  // 2500 items, rent, 540 private
  "kaWbC6H5mHvoFRI7o",  // 2500 items, rent, 895 private
];

const TYPE_MAP = {
  flat: "apartment", apartment: "apartment", piso: "apartment",
  house: "house", chalet: "house", casa: "house",
  villa: "villa", penthouse: "penthouse", atico: "penthouse", "ático": "penthouse",
  studio: "studio", estudio: "studio", duplex: "duplex", "dúplex": "duplex",
  loft: "loft", land: "land", terreno: "land",
  commercial: "commercial", oficina: "commercial", local: "commercial",
};

function extractImages(item) {
  if (item.multimedia && item.multimedia.images) {
    return item.multimedia.images.map(img => img.url || img.src).filter(Boolean).slice(0, 20);
  }
  if (item.images && Array.isArray(item.images)) {
    return item.images.map(img => typeof img === "string" ? img : img.url || img.src || null).filter(Boolean).slice(0, 20);
  }
  if (item.thumbnail) return [item.thumbnail];
  return [];
}

function isShortTerm(item) {
  const text = [item.title || "", item.description || ""].join(" ").toLowerCase();
  return ["temporada", "temporal", "short term", "short-term", "vacacional",
    "holiday", "vacation", "por meses", "monthly", "turístico", "turistico",
    "tourist", "alquiler temporal", "seasonal"].some(kw => text.includes(kw));
}

function mapItem(item) {
  const id = String(item.propertyCode || item.adId || item.id || "");
  if (!id) return null;

  const rawType = (item.propertyType || item.typology || "").toLowerCase();
  const images = extractImages(item);
  const f = item.features || {};
  const ci = item.contactInfo || {};
  const operation = (item.operation || "sale").toLowerCase();

  return {
    idealista_id: id,
    source: "idealista",
    title: item.title || item.suggestedTexts?.title || "Propiedad en " + (item.address || "Málaga"),
    description: item.description || "",
    type: TYPE_MAP[rawType] || "other",
    operation,
    price: item.price || 0,
    price_per_sqm: item.priceByArea || (item.price && item.size ? Math.round(item.price / item.size) : null),
    location: {
      address: item.address || "",
      city: item.municipality || "",
      district: item.district || "",
      neighborhood: item.neighborhood || "",
      province: item.province || "Málaga",
      latitude: item.latitude || null,
      longitude: item.longitude || null,
    },
    features: {
      size_sqm: item.size || null,
      bedrooms: item.rooms || null,
      bathrooms: item.bathrooms || null,
      floor: item.floor || null,
      has_elevator: item.hasLift ?? null,
      has_parking: f.hasParking ?? null,
      has_terrace: f.hasTerrace ?? null,
      has_pool: f.hasSwimmingPool ?? null,
      has_ac: f.hasAirConditioning ?? null,
      has_garden: f.hasGarden ?? null,
    },
    images,
    url: item.url || "",
    contact: { name: ci.contactName || "", type: "particular", phone: ci.phone1?.phoneNumber || "" },
    is_particular: true,
    status: "active",
    scraped_at: new Date(),
  };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const P = mongoose.model("P", new mongoose.Schema({}, { strict: false }), "properties");
  const before = await P.countDocuments({ status: "active" });
  const beforeMalaga = await P.countDocuments({ status: "active", "location.province": { $regex: /m.laga/i } });
  console.log("Active before:", before, "| Malaga before:", beforeMalaga);

  let totalItems = 0, totalParticular = 0, totalInserted = 0, totalUpdated = 0, totalSkipped = 0;
  const seen = new Set();

  for (const ds of MALAGA_DATASETS) {
    console.log(`\n📦 Dataset: ${ds}`);
    try {
      const r = await axios.get(`${BASE}/datasets/${ds}/items`, {
        params: { token: TOKEN, format: "json", limit: 10000 },
        timeout: 60000,
      });
      const items = r.data || [];
      console.log(`  Downloaded: ${items.length} items`);
      totalItems += items.length;

      let dsNew = 0, dsUpdated = 0;
      for (const item of items) {
        const ci = item.contactInfo || {};
        if (ci.userType !== "private") continue;
        if (isShortTerm(item)) { totalSkipped++; continue; }

        const mapped = mapItem(item);
        if (!mapped) continue;
        if (!mapped.idealista_id) continue;
        if (seen.has(mapped.idealista_id)) continue;
        seen.add(mapped.idealista_id);

        // Skip listings with no images
        if (mapped.images.length === 0) continue;

        // For rent: skip below 1000€
        if (mapped.operation === "rent" && mapped.price < 1000) continue;
        // For sale: skip below 200000€
        if (mapped.operation === "sale" && mapped.price < 200000) continue;

        totalParticular++;

        try {
          const result = await P.updateOne(
            { idealista_id: mapped.idealista_id },
            { $set: mapped, $setOnInsert: { createdAt: new Date() } },
            { upsert: true },
          );
          if (result.upsertedCount > 0) { totalInserted++; dsNew++; }
          else if (result.modifiedCount > 0) { totalUpdated++; dsUpdated++; }
        } catch (e) {}
      }
      console.log(`  ✅ New: ${dsNew} | Updated: ${dsUpdated}`);
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
  }

  const after = await P.countDocuments({ status: "active" });
  const afterMalaga = await P.countDocuments({ status: "active", "location.province": { $regex: /m.laga/i } });

  // Show by city
  const byCityOp = await P.aggregate([
    { $match: { status: "active", "location.province": { $regex: /m.laga/i } } },
    { $group: { _id: { city: "$location.city", op: "$operation" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  console.log("\n══════════════════════════════════════");
  console.log("  Total items downloaded:", totalItems);
  console.log("  Particular (after filters):", totalParticular);
  console.log("  Short-term skipped:", totalSkipped);
  console.log("  New inserted:", totalInserted);
  console.log("  Updated:", totalUpdated);
  console.log("  Malaga:", afterMalaga, "(was", beforeMalaga + ")");
  console.log("  Total active:", after, "(was", before + ")");
  console.log("\n  By city:");
  for (const r of byCityOp) {
    console.log(`    ${r._id.city} (${r._id.op}): ${r.count}`);
  }
  console.log("══════════════════════════════════════");

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch(e => { console.error(e); process.exit(1); });
