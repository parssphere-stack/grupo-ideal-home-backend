// Full recovery — scan ALL Apify runs, import only particulars
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.APIFY_TOKEN;
const BASE = "https://api.apify.com/v2";

async function getAllDatasetIds() {
  const datasets = [];
  const seen = new Set();

  // Paginate through all runs
  for (let offset = 0; offset < 200; offset += 50) {
    try {
      const res = await axios.get(`${BASE}/actor-runs`, {
        params: { token: TOKEN, limit: 50, desc: 1, offset },
        timeout: 15000,
      });
      const runs = res.data?.data?.items || [];
      if (runs.length === 0) break;

      for (const r of runs) {
        if (r.status === "SUCCEEDED" && r.defaultDatasetId && !seen.has(r.defaultDatasetId)) {
          seen.add(r.defaultDatasetId);
          datasets.push({
            id: r.defaultDatasetId,
            actor: r.actId,
            date: r.startedAt?.substring(0, 16),
          });
        }
      }
    } catch (e) {
      break;
    }
  }

  return datasets;
}

// Same mapping as recover_properties.js
const PROPERTY_TYPE_MAP = {
  flat: "apartment", apartment: "apartment", piso: "apartment",
  house: "house", chalet: "house", casa: "house",
  villa: "villa", studio: "studio", estudio: "studio",
  penthouse: "penthouse", atico: "penthouse", "ático": "penthouse",
  duplex: "apartment", "dúplex": "apartment", loft: "studio",
  land: "land", terreno: "land",
  premises: "commercial", local: "commercial", office: "commercial",
  oficina: "commercial", garage: "commercial", garaje: "commercial",
};

function extractExternalId(item) {
  if (item.id || item.propertyCode) return String(item.id || item.propertyCode);
  const url = item.url || item.Url || item.detailUrl || "";
  const match = url.match(/\/inmueble\/(\d+)|\/immobile\/(\d+)|\/(\d+)\/?$/);
  if (match) return match[1] || match[2] || match[3];
  return null;
}

function extractImages(item) {
  if (item.images && Array.isArray(item.images)) {
    return item.images.map(img => typeof img === "string" ? img : img.url || img.src || null).filter(Boolean).slice(0, 20);
  }
  if (item.multimedia && item.multimedia.images) {
    return item.multimedia.images.map(img => img.url || img.src).filter(Boolean).slice(0, 20);
  }
  if (item.MainImage || item.thumbnail) return [item.MainImage || item.thumbnail];
  return [];
}

function mapItem(item) {
  const externalId = extractExternalId(item);
  if (!externalId) return null;

  const price = typeof item.price === "number" ? item.price : null;
  if (!price) return null;

  const rawType = (item.propertyType || item.typology || item.type || "").toLowerCase();
  const type = PROPERTY_TYPE_MAP[rawType] || "apartment";
  const operation = item.operation === "rent" || item.operation === "alquiler" ? "rent" : "sale";
  const sizeSqm = item.size || item.constructedArea || null;

  const phone = item.contactInfo && item.contactInfo.phone1 && item.contactInfo.phone1.phoneNumber;
  const contactName = item.contactInfo && item.contactInfo.contactName;

  return {
    idealista_id: "idealista_" + externalId,
    source: "idealista",
    title: item.title || "Propiedad en " + (item.address || item.neighborhood || "España"),
    description: item.description || null,
    type,
    operation,
    price,
    price_per_sqm: price && sizeSqm ? Math.round(price / sizeSqm) : null,
    location: {
      address: item.address || null,
      city: item.municipality || item.city || null,
      district: item.district || null,
      neighborhood: item.neighborhood || null,
      province: item.province || null,
      latitude: item.latitude || null,
      longitude: item.longitude || null,
    },
    features: {
      size_sqm: sizeSqm,
      bedrooms: item.rooms || item.bedrooms || null,
      bathrooms: item.bathrooms || null,
    },
    images: extractImages(item),
    url: item.url || item.detailUrl || null,
    contact: {
      name: contactName || null,
      type: "particular",
      phone: phone || null,
    },
    is_particular: true,
    status: "active",
    scraped_at: new Date(),
  };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const P = mongoose.model("P", new mongoose.Schema({}, { strict: false }), "properties");
  const beforeCount = await P.countDocuments();
  console.log("DB before:", beforeCount, "\n");

  // Get all dataset IDs
  console.log("Fetching all Apify runs...");
  const datasets = await getAllDatasetIds();
  console.log("Found", datasets.length, "datasets\n");

  const seenIds = new Set();
  let totalDownloaded = 0;
  let totalPrivate = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (let i = 0; i < datasets.length; i++) {
    const ds = datasets[i];
    try {
      const res = await axios.get(`${BASE}/datasets/${ds.id}/items`, {
        params: { token: TOKEN, format: "json" },
        timeout: 30000,
      });
      const items = res.data || [];
      totalDownloaded += items.length;

      let dsPrivate = 0;
      let dsInserted = 0;

      for (const item of items) {
        // Only import particulars
        const userType = item.contactInfo && item.contactInfo.userType;
        if (userType !== "private") continue;

        const mapped = mapItem(item);
        if (!mapped) continue;

        if (seenIds.has(mapped.idealista_id)) continue;
        seenIds.add(mapped.idealista_id);

        dsPrivate++;
        totalPrivate++;

        try {
          const result = await P.updateOne(
            { idealista_id: mapped.idealista_id },
            { $set: mapped, $setOnInsert: { createdAt: new Date() } },
            { upsert: true },
          );
          if (result.upsertedCount > 0) { totalInserted++; dsInserted++; }
          else if (result.modifiedCount > 0) totalUpdated++;
        } catch (e) {}
      }

      if (dsPrivate > 0) {
        console.log(`  [${i + 1}/${datasets.length}] ${ds.id} | ${items.length} items | ${dsPrivate} private | ${dsInserted} new | ${ds.date}`);
      }
    } catch (e) {
      // Skip failed datasets silently
    }
  }

  const afterTotal = await P.countDocuments();
  const afterActive = await P.countDocuments({ status: "active" });

  console.log("\n══════════════════════════════════════");
  console.log("Recovery Complete:");
  console.log("  Datasets scanned:", datasets.length);
  console.log("  Items downloaded:", totalDownloaded);
  console.log("  Unique particulars:", totalPrivate);
  console.log("  New inserted:", totalInserted);
  console.log("  Updated:", totalUpdated);
  console.log("  DB total:", afterTotal, "(was", beforeCount + ")");
  console.log("  Active:", afterActive);
  console.log("══════════════════════════════════════");

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch(e => { console.error(e); process.exit(1); });
