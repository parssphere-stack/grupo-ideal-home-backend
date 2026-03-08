// Scrape Malaga & Costa del Sol — rent only, particular, >1000€, no short-term
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.APIFY_TOKEN;
const BASE = "https://api.apify.com/v2";
const ACTOR_ID = "REcGj6dyoIJ9Z7aE6";

// Locations to scrape
const LOCATIONS = [
  { name: "Málaga, Málaga", maxItems: 500 },
  { name: "Marbella, Málaga", maxItems: 500 },
  { name: "Estepona, Málaga", maxItems: 300 },
  { name: "Fuengirola, Málaga", maxItems: 300 },
  { name: "Torremolinos, Málaga", maxItems: 300 },
  { name: "Benalmádena, Málaga", maxItems: 300 },
  { name: "Mijas, Málaga", maxItems: 300 },
  { name: "Nerja, Málaga", maxItems: 200 },
  { name: "Rincón de la Victoria, Málaga", maxItems: 200 },
];

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

const TYPE_MAP = {
  flat: "apartment", apartment: "apartment", piso: "apartment",
  house: "house", chalet: "house", casa: "house",
  villa: "villa", studio: "studio", estudio: "studio",
  penthouse: "penthouse", atico: "penthouse", duplex: "apartment",
  loft: "studio", land: "land", terreno: "land",
};

function mapItem(item) {
  const id = String(item.propertyCode || item.adId || item.id || "");
  if (!id) return null;

  const price = item.price || 0;
  if (price < 1000) return null;

  const rawType = (item.propertyType || item.typology || "").toLowerCase();
  const images = extractImages(item);
  const f = item.features || {};
  const ci = item.contactInfo || {};

  return {
    idealista_id: "idealista_" + id,
    source: "idealista",
    title: item.title || item.suggestedTexts?.title || "Propiedad en " + (item.address || "Málaga"),
    description: item.description || "",
    type: TYPE_MAP[rawType] || "apartment",
    operation: "rent",
    price,
    price_per_sqm: item.priceByArea || (price && item.size ? Math.round(price / item.size) : null),
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

function isShortTerm(item) {
  const text = [item.title || "", item.description || ""].join(" ").toLowerCase();
  return ["temporada", "temporal", "short term", "short-term", "vacacional",
    "holiday", "vacation", "por meses", "monthly", "turístico", "turistico",
    "tourist", "alquiler temporal", "seasonal"].some(kw => text.includes(kw));
}

async function scrapeLocation(loc) {
  const input = {
    locationName: loc.name,
    country: "es",
    operation: "rent",
    maxItems: loc.maxItems,
    userType: "private",
  };

  const res = await axios.post(`${BASE}/acts/${ACTOR_ID}/runs`, input, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    timeout: 30000,
  });

  const runId = res.data?.data?.id;
  if (!runId) throw new Error("Failed to start run");

  // Poll
  let waited = 0;
  while (waited < 600000) {
    await new Promise(r => setTimeout(r, 15000));
    waited += 15000;
    process.stdout.write(".");

    const sr = await axios.get(`${BASE}/acts/${ACTOR_ID}/runs/${runId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeout: 15000,
    });

    const status = sr.data?.data?.status;
    if (status === "SUCCEEDED") {
      const datasetId = sr.data?.data?.defaultDatasetId;
      const items = await axios.get(`${BASE}/datasets/${datasetId}/items?format=json&limit=10000`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        timeout: 30000,
      });
      return items.data || [];
    }
    if (status === "FAILED" || status === "ABORTED") throw new Error(`Run ${status}`);
  }
  throw new Error("Timeout");
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const P = mongoose.model("P", new mongoose.Schema({}, { strict: false }), "properties");
  const beforeRent = await P.countDocuments({ status: "active", operation: "rent" });
  console.log("Rent before:", beforeRent, "\n");

  let totalScraped = 0, totalParticular = 0, totalInserted = 0, totalUpdated = 0, totalShortTerm = 0;

  for (const loc of LOCATIONS) {
    console.log(`\n🔍 Scraping ${loc.name}...`);

    try {
      const items = await scrapeLocation(loc);
      console.log(`\n  Downloaded: ${items.length} items`);
      totalScraped += items.length;

      if (items.length > 0) {
        console.log(`  Sample: municipality=${items[0].municipality}, province=${items[0].province}, userType=${items[0].contactInfo?.userType}`);
      }

      let cityInserted = 0;
      for (const item of items) {
        const ci = item.contactInfo || {};
        if (ci.userType !== "private") continue;
        if (isShortTerm(item)) { totalShortTerm++; continue; }

        const mapped = mapItem(item);
        if (!mapped) continue;
        if (mapped.images.length === 0) continue;

        totalParticular++;

        try {
          const result = await P.updateOne(
            { idealista_id: mapped.idealista_id },
            { $set: mapped, $setOnInsert: { createdAt: new Date() } },
            { upsert: true },
          );
          if (result.upsertedCount > 0) { totalInserted++; cityInserted++; }
          else if (result.modifiedCount > 0) totalUpdated++;
        } catch (e) {}
      }

      console.log(`  ✅ ${loc.name}: ${cityInserted} new`);
    } catch (e) {
      console.log(`  ❌ ${loc.name} failed: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  const afterRent = await P.countDocuments({ status: "active", operation: "rent" });
  const totalActive = await P.countDocuments({ status: "active" });

  console.log("\n══════════════════════════════════════");
  console.log("  Scraped:", totalScraped);
  console.log("  Particular:", totalParticular);
  console.log("  Short-term skipped:", totalShortTerm);
  console.log("  New:", totalInserted);
  console.log("  Updated:", totalUpdated);
  console.log("  Rent:", afterRent, "(was", beforeRent + ")");
  console.log("  Total active:", totalActive);
  console.log("══════════════════════════════════════");

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch(e => { console.error(e); process.exit(1); });
