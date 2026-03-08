#!/usr/bin/env node
/**
 * Import ALL properties from Apify run history.
 * Filters: rent >= 1000€, sale >= 200,000€, particulars only.
 * Free — just reads existing datasets, no new scrape runs.
 *
 * Run: node src/import_from_apify_history.js
 */

const mongoose = require("mongoose");
require("dotenv").config();
const axios = require("axios");
const { isAgency, isExpired } = require("./utils/agency-detector");

const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const ACTOR_ID = "REcGj6dyoIJ9Z7aE6";

// Type mapping
const TYPE_MAP = {
  flat: "apartment", apartment: "apartment", piso: "apartment",
  house: "house", casa: "house", chalet: "house",
  villa: "villa", penthouse: "penthouse", atico: "penthouse", "ático": "penthouse",
  studio: "studio", estudio: "studio", duplex: "duplex", "dúplex": "duplex",
  loft: "loft", land: "land", terreno: "land",
  commercial: "commercial", oficina: "commercial", local: "commercial",
};

function detectProvince(lat, lon) {
  if (!lat || !lon) return null;
  if (lat >= 36.2 && lat <= 37.3 && lon >= -5.6 && lon <= -3.8) return "Málaga";
  if (lat >= 39.8 && lat <= 41.2 && lon >= -4.6 && lon <= -3.0) return "Madrid";
  if (lat >= 36.7 && lat <= 38.0 && lon >= -4.1 && lon <= -2.5) return "Granada";
  if (lat >= 35.9 && lat <= 36.8 && lon >= -5.9 && lon <= -5.0) return "Cádiz";
  return null;
}

function mapItem(item) {
  const rawType = (item.propertyType || item.typology || "").toLowerCase();
  let images = [];
  if (item.multimedia?.images)
    images = item.multimedia.images.map((i) => i.url || i.src || i).filter(Boolean);
  else if (item.images) images = Array.isArray(item.images) ? item.images : [];
  if (!images.length && item.thumbnail) images = [item.thumbnail];

  const f = item.features || {};
  const ci = item.contactInfo || {};
  const lat = item.latitude || item.location?.latitude || null;
  const lon = item.longitude || item.location?.longitude || null;

  return {
    idealista_id: String(item.propertyCode || item.adId || item.id).replace(/^idealista_/, ""),
    title: item.title || item.suggestedTexts?.title || `${TYPE_MAP[rawType] || "property"} en ${item.address || ""}`,
    description: item.description || "",
    price: item.price || item.priceInfo?.price?.amount || 0,
    price_per_sqm: item.priceByArea || (item.price && item.size ? Math.round(item.price / item.size) : null),
    type: TYPE_MAP[rawType] || "other",
    operation: (item.operation || "sale").toLowerCase(),
    location: {
      address: item.address || "",
      city: item.municipality || item.location?.city || "",
      district: item.district || item.location?.district || "",
      neighborhood: item.neighborhood || "",
      province: item.province || item.location?.province || detectProvince(lat, lon) || "",
      latitude: lat,
      longitude: lon,
    },
    features: {
      size_sqm: item.size || f.size_sqm || null,
      bedrooms: item.rooms || f.bedrooms || null,
      bathrooms: item.bathrooms || f.bathrooms || null,
      floor: item.floor || f.floor || null,
      has_elevator: item.hasLift ?? f.has_elevator ?? null,
      has_parking: f.hasParking ?? f.has_parking ?? null,
      has_terrace: f.hasTerrace ?? f.has_terrace ?? null,
      has_pool: f.hasSwimmingPool ?? f.has_pool ?? null,
      has_ac: f.hasAirConditioning ?? f.has_ac ?? null,
      has_garden: f.hasGarden ?? f.has_garden ?? null,
      is_exterior: item.exterior ?? f.is_exterior ?? null,
    },
    images,
    url: item.url || "",
    contact: {
      name: ci.contactName || ci.commercialName || "",
      type: "particular",
      phone: ci.phone1?.phoneNumber || ci.phone || "",
    },
    is_particular: true,
    status: "active",
    source: "idealista",
    scraped_at: new Date(),
  };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const col = mongoose.connection.collection("properties");
  const before = await col.countDocuments();
  console.log(`Properties before: ${before}\n`);

  // Fetch ALL succeeded runs (paginate)
  console.log("Fetching Apify run history...");
  let allRuns = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await axios.get(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?limit=${limit}&offset=${offset}&desc=true&status=SUCCEEDED`,
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` }, timeout: 15000 },
    );
    const runs = res.data.data.items;
    allRuns.push(...runs);
    console.log(`  Fetched ${runs.length} runs (offset ${offset}, total so far: ${allRuns.length})`);
    if (runs.length < limit) break;
    offset += limit;
  }

  console.log(`Total succeeded runs: ${allRuns.length}\n`);

  // Deduplicate datasets
  const seen = new Set();
  const datasets = [];
  for (const r of allRuns) {
    if (r.defaultDatasetId && !seen.has(r.defaultDatasetId)) {
      seen.add(r.defaultDatasetId);
      datasets.push({ id: r.defaultDatasetId, date: r.startedAt });
    }
  }
  console.log(`Unique datasets: ${datasets.length}\n`);

  let totalNew = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;

  for (let i = 0; i < datasets.length; i++) {
    const ds = datasets[i];
    const date = new Date(ds.date).toLocaleString("en-GB");
    process.stdout.write(`[${i + 1}/${datasets.length}] ${ds.id} (${date}) `);

    try {
      // Fetch dataset items
      const url = `https://api.apify.com/v2/datasets/${ds.id}/items?format=json&limit=10000`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
        timeout: 60000,
      });
      const items = res.data;

      let dsNew = 0, dsUpdated = 0, dsSkipped = 0, dsErrors = 0;

      for (const item of items) {
        const ci = item.contactInfo || {};
        const id = String(item.propertyCode || item.adId || item.id || "");
        if (!id) continue;

        // Skip agencies
        if (isExpired(item)) { dsSkipped++; continue; }
        if (ci.userType !== "private" || ci.micrositeShortName || isAgency(ci.contactName, ci.commercialName)) {
          dsSkipped++;
          continue;
        }

        // Map and check price filter
        const mapped = mapItem(item);
        const price = mapped.price || 0;
        const op = mapped.operation;

        // Filter: rent >= 1000, sale >= 200000
        if (op === "rent" && price < 1000) { dsSkipped++; continue; }
        if (op === "sale" && price < 200000) { dsSkipped++; continue; }

        try {
          const before = await col.findOne({ idealista_id: mapped.idealista_id }, { projection: { _id: 1 } });
          await col.updateOne(
            { idealista_id: mapped.idealista_id },
            { $set: { ...mapped, status: "active" } },
            { upsert: true },
          );
          before ? dsUpdated++ : dsNew++;
        } catch (err) {
          dsErrors++;
        }
      }

      totalNew += dsNew;
      totalUpdated += dsUpdated;
      totalSkipped += dsSkipped;
      totalErrors += dsErrors;

      console.log(`→ ${items.length} items | +${dsNew} new, ${dsUpdated} upd, ${dsSkipped} skip`);
    } catch (err) {
      console.log(`→ FAILED: ${err.message}`);
      totalErrors++;
    }
  }

  // Assign codes to properties without one
  const needCode = await col.countDocuments({ $or: [{ code: null }, { code: { $exists: false } }] });
  if (needCode > 0) {
    console.log(`\nAssigning codes to ${needCode} new properties...`);
    const counterCol = mongoose.connection.collection("counters");
    const current = await counterCol.findOne({ _id: "property_code" });
    let seq = current?.seq || 0;

    while (true) {
      const docs = await col
        .find({ $or: [{ code: null }, { code: { $exists: false } }] }, { projection: { _id: 1 } })
        .sort({ createdAt: 1 })
        .limit(500)
        .toArray();
      if (!docs.length) break;

      const bulkOps = docs.map((doc) => {
        seq++;
        return { updateOne: { filter: { _id: doc._id }, update: { $set: { code: String(10000 + seq) } } } };
      });
      await col.bulkWrite(bulkOps, { ordered: false });
    }

    await counterCol.updateOne({ _id: "property_code" }, { $set: { seq } }, { upsert: true });
    console.log(`Codes assigned! Last: ${10000 + seq}`);
  }

  const after = await col.countDocuments();
  const active = await col.countDocuments({ status: "active" });

  console.log(`\n========================================`);
  console.log(`Before: ${before} → After: ${after} (active: ${active})`);
  console.log(`New: ${totalNew} | Updated: ${totalUpdated} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);
  console.log(`========================================`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
