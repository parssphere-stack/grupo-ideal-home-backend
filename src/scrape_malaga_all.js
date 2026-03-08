#!/usr/bin/env node
/**
 * Scrape Malaga province — sale 400k+ AND rent 1000€+, particulars only.
 * Run: node src/scrape_malaga_all.js
 */

const mongoose = require("mongoose");
require("dotenv").config();
const { triggerActorRun, waitForRun, importDataset, checkApifyCredits } = require("./services/apify-client");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CITIES = [
  { slug: "malaga-malaga", name: "Málaga city", saleMax: 500, rentMax: 300 },
  { slug: "marbella-malaga", name: "Marbella", saleMax: 500, rentMax: 300 },
  { slug: "estepona-malaga", name: "Estepona", saleMax: 300, rentMax: 200 },
  { slug: "benalmadena-malaga", name: "Benalmádena", saleMax: 300, rentMax: 200 },
  { slug: "fuengirola-malaga", name: "Fuengirola", saleMax: 300, rentMax: 200 },
  { slug: "torremolinos-malaga", name: "Torremolinos", saleMax: 200, rentMax: 200 },
  { slug: "mijas-malaga", name: "Mijas", saleMax: 300, rentMax: 200 },
  { slug: "nerja-malaga", name: "Nerja", saleMax: 200, rentMax: 150 },
  { slug: "rincon-de-la-victoria-malaga", name: "Rincón de la Victoria", saleMax: 200, rentMax: 150 },
  { slug: "alhaurin-de-la-torre-malaga", name: "Alhaurín", saleMax: 200, rentMax: 150 },
  { slug: "velez-malaga-malaga", name: "Vélez-Málaga", saleMax: 200, rentMax: 150 },
  { slug: "manilva-malaga", name: "Manilva", saleMax: 200, rentMax: 100 },
  { slug: "casares-malaga", name: "Casares", saleMax: 200, rentMax: 100 },
  { slug: "benahavis-malaga", name: "Benahavís", saleMax: 300, rentMax: 150 },
  { slug: "ojen-malaga", name: "Ojén", saleMax: 100, rentMax: 50 },
  { slug: "san-roque-cadiz", name: "Sotogrande/San Roque", saleMax: 200, rentMax: 100 },
];

// Build location list: sale + rent for each city
const LOCATIONS = [];
for (const c of CITIES) {
  LOCATIONS.push({
    name: `${c.name} sale 400k+`,
    startUrl: `https://www.idealista.com/venta-viviendas/${c.slug}/con-precio-desde_400000/`,
    maxItems: c.saleMax,
    operation: "sale",
    minPrice: 400000,
  });
  LOCATIONS.push({
    name: `${c.name} rent 1000€+`,
    startUrl: `https://www.idealista.com/alquiler-viviendas/${c.slug}/con-precio-desde_1000/`,
    maxItems: c.rentMax,
    operation: "rent",
    minPrice: 1000,
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const col = mongoose.connection.collection("properties");
  const before = await col.countDocuments();
  console.log(`Properties before: ${before}\n`);

  const credits = await checkApifyCredits();
  if (credits.locked) {
    console.error("Apify account is locked! Cannot scrape.");
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Apify plan: ${credits.plan || "unknown"}\n`);

  let totalNew = 0, totalUpdated = 0;

  for (let i = 0; i < LOCATIONS.length; i++) {
    const loc = LOCATIONS[i];
    try {
      console.log(`\n[${i + 1}/${LOCATIONS.length}] == ${loc.name} ==`);
      const run = await triggerActorRun(loc);
      console.log(`  Run started: ${run.id}`);
      const finished = await waitForRun(run.id, 15);
      const result = await importDataset(finished.defaultDatasetId, loc);
      totalNew += result.newCount || 0;
      totalUpdated += result.updatedCount || 0;
      console.log(`  +${result.newCount} new, ${result.updatedCount} updated`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      if (err.message.includes("402") || err.message.includes("quota") || err.message.includes("payment")) {
        console.error("Apify quota issue — stopping.");
        break;
      }
    }
    await sleep(5000);
  }

  // Assign codes to new properties
  const counterCol = mongoose.connection.collection("counters");
  const needCode = await col.countDocuments({ $or: [{ code: null }, { code: { $exists: false } }] });
  if (needCode > 0) {
    console.log(`\nAssigning codes to ${needCode} new properties...`);
    const current = await counterCol.findOne({ _id: "property_code" });
    let seq = current?.seq || 0;
    while (true) {
      const docs = await col
        .find({ $or: [{ code: null }, { code: { $exists: false } }] }, { projection: { _id: 1 } })
        .sort({ createdAt: 1 }).limit(500).toArray();
      if (!docs.length) break;
      const bulkOps = docs.map((doc) => { seq++; return { updateOne: { filter: { _id: doc._id }, update: { $set: { code: String(10000 + seq) } } } }; });
      await col.bulkWrite(bulkOps, { ordered: false });
    }
    await counterCol.updateOne({ _id: "property_code" }, { $set: { seq } }, { upsert: true });
    console.log(`Codes assigned! Last: ${10000 + seq}`);
  }

  const after = await col.countDocuments();
  console.log(`\n========================================`);
  console.log(`Before: ${before} → After: ${after}`);
  console.log(`New: ${totalNew} | Updated: ${totalUpdated}`);
  console.log(`========================================`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
