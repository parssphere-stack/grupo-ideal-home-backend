// ══════════════════════════════════════════════════════════════
// scrape_costa_sol.js — Scrape all Málaga province from Idealista
// Run from: /Users/sam/Desktop/grupo-ideal-home/backend
// node src/scrape_costa_sol.js
//
// Uses location code "0-EU-ES-29" (Málaga province)
// Filters: rent >= 1000€, sale >= 200k€
// Only saves: particulars with images, no short-term rentals
// ══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.APIFY_TOKEN;
const BASE = "https://api.apify.com/v2";
const ACTOR_ID = "REcGj6dyoIJ9Z7aE6";

// Scrape jobs
const JOBS = [
  { label: "Málaga rent (recent)", operation: "rent", sortBy: "mostRecent", maxItems: 2500 },
  { label: "Málaga rent (cheapest)", operation: "rent", sortBy: "lowestPrice", maxItems: 2500 },
  { label: "Málaga sale (recent)", operation: "sale", sortBy: "mostRecent", maxItems: 2500 },
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

async function runJob(job) {
  const input = {
    location: "0-EU-ES-29",  // Málaga province code
    country: "es",
    operation: job.operation,
    propertyType: "homes",
    maxItems: job.maxItems,
    sortBy: job.sortBy,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
    accessible: false, airConditioning: false, balcony: false, exterior: false,
    fetchDetails: false, fetchStats: false, fittedWardrobes: false,
    garage: false, garden: false, lift: false, luxury: false, plan: false,
    seaViews: false, storageRoom: false, swimmingPool: false,
    terrace: false, virtualTour: false,
    propertyCodes: [], minPrice: "0", maxPrice: "0",
    minSize: "0", maxSize: "0", publicationDate: "", agency: "",
  };

  console.log(`\n🚀 Starting: ${job.label}`);
  const res = await axios.post(`${BASE}/acts/${ACTOR_ID}/runs`, input, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    timeout: 30000,
  });

  const runId = res.data?.data?.id;
  if (!runId) throw new Error("Failed to start run");
  console.log(`  Run ID: ${runId}`);

  // Poll for completion (max 15 min)
  let waited = 0;
  while (waited < 900000) {
    await new Promise(r => setTimeout(r, 20000));
    waited += 20000;
    process.stdout.write(".");

    const sr = await axios.get(`${BASE}/acts/${ACTOR_ID}/runs/${runId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeout: 15000,
    });

    const status = sr.data?.data?.status;
    if (status === "SUCCEEDED") {
      const datasetId = sr.data?.data?.defaultDatasetId;
      console.log(`\n  ✅ Completed! Dataset: ${datasetId}`);

      const items = await axios.get(`${BASE}/datasets/${datasetId}/items?format=json&limit=10000`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        timeout: 60000,
      });
      return items.data || [];
    }
    if (status === "FAILED" || status === "ABORTED") throw new Error(`Run ${status}`);
  }
  throw new Error("Timeout after 15min");
}

async function main() {
  if (!TOKEN) { console.error("APIFY_TOKEN not set"); process.exit(1); }

  // Check credits
  try {
    const u = await axios.get(`${BASE}/users/me`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 10000,
    });
    const plan = u.data?.data?.plan;
    console.log(`💳 Plan: ${plan?.id} | Limit: $${plan?.maxMonthlyUsageUsd}/mo`);
  } catch (e) {}

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const P = mongoose.model("P", new mongoose.Schema({}, { strict: false }), "properties");
  const before = await P.countDocuments({ status: "active" });
  const beforeMalaga = await P.countDocuments({ status: "active", "location.province": { $regex: /m.laga/i } });
  console.log("Active before:", before, "| Malaga before:", beforeMalaga);

  let totalScraped = 0, totalParticular = 0, totalInserted = 0, totalUpdated = 0, totalShortTerm = 0;
  const seen = new Set();

  for (const job of JOBS) {
    try {
      const items = await runJob(job);
      console.log(`  Downloaded: ${items.length} items`);
      totalScraped += items.length;

      if (items.length > 0) {
        console.log(`  Sample: ${items[0].municipality}, ${items[0].province}`);
      }

      let jobNew = 0;
      for (const item of items) {
        const ci = item.contactInfo || {};
        if (ci.userType !== "private") continue;
        if (isShortTerm(item)) { totalShortTerm++; continue; }

        const mapped = mapItem(item);
        if (!mapped || !mapped.idealista_id) continue;
        if (seen.has(mapped.idealista_id)) continue;
        seen.add(mapped.idealista_id);

        if (mapped.images.length === 0) continue;
        if (mapped.operation === "rent" && mapped.price < 1000) continue;
        if (mapped.operation === "sale" && mapped.price < 200000) continue;

        totalParticular++;

        try {
          const result = await P.updateOne(
            { idealista_id: mapped.idealista_id },
            { $set: mapped, $setOnInsert: { createdAt: new Date() } },
            { upsert: true },
          );
          if (result.upsertedCount > 0) { totalInserted++; jobNew++; }
          else if (result.modifiedCount > 0) totalUpdated++;
        } catch (e) {}
      }
      console.log(`  ✅ ${job.label}: ${jobNew} new`);
    } catch (e) {
      console.log(`  ❌ ${job.label} failed: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  const after = await P.countDocuments({ status: "active" });
  const afterMalaga = await P.countDocuments({ status: "active", "location.province": { $regex: /m.laga/i } });

  console.log("\n══════════════════════════════════════");
  console.log("  Scraped:", totalScraped);
  console.log("  Particular:", totalParticular);
  console.log("  Short-term skipped:", totalShortTerm);
  console.log("  New:", totalInserted);
  console.log("  Updated:", totalUpdated);
  console.log("  Malaga:", afterMalaga, "(was", beforeMalaga + ")");
  console.log("  Total active:", after, "(was", before + ")");
  console.log("══════════════════════════════════════");

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch(e => { console.error(e); process.exit(1); });
