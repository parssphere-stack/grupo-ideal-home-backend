#!/usr/bin/env node
/**
 * Scrape Malaga province — sale only, 400k+, particulars only.
 * Run: node src/scrape_malaga_sale.js
 */

const mongoose = require("mongoose");
require("dotenv").config();
const { triggerActorRun, waitForRun, importDataset } = require("./services/apify-client");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOCATIONS = [
  { name: "Málaga city sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/malaga-malaga/con-precio-desde_400000/", maxItems: 500 },
  { name: "Marbella sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/marbella-malaga/con-precio-desde_400000/", maxItems: 500 },
  { name: "Estepona sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/estepona-malaga/con-precio-desde_400000/", maxItems: 300 },
  { name: "Benalmádena sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/benalmadena-malaga/con-precio-desde_400000/", maxItems: 300 },
  { name: "Fuengirola sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/fuengirola-malaga/con-precio-desde_400000/", maxItems: 300 },
  { name: "Torremolinos sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/torremolinos-malaga/con-precio-desde_400000/", maxItems: 200 },
  { name: "Mijas sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/mijas-malaga/con-precio-desde_400000/", maxItems: 300 },
  { name: "Nerja sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/nerja-malaga/con-precio-desde_400000/", maxItems: 200 },
  { name: "Rincón de la Victoria sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/rincon-de-la-victoria-malaga/con-precio-desde_400000/", maxItems: 200 },
  { name: "Alhaurín sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/alhaurin-de-la-torre-malaga/con-precio-desde_400000/", maxItems: 200 },
  { name: "Vélez-Málaga sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/velez-malaga-malaga/con-precio-desde_400000/", maxItems: 200 },
  { name: "Manilva sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/manilva-malaga/con-precio-desde_400000/", maxItems: 200 },
  { name: "Casares sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/casares-malaga/con-precio-desde_400000/", maxItems: 200 },
  { name: "Benahavís sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/benahavis-malaga/con-precio-desde_400000/", maxItems: 300 },
  { name: "Ojén sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/ojen-malaga/con-precio-desde_400000/", maxItems: 100 },
  { name: "Sotogrande/San Roque sale 400k+", startUrl: "https://www.idealista.com/venta-viviendas/san-roque-cadiz/con-precio-desde_400000/", maxItems: 200 },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const col = mongoose.connection.collection("properties");
  const before = await col.countDocuments();
  console.log(`Properties before: ${before}\n`);

  let totalNew = 0, totalUpdated = 0;

  for (const loc of LOCATIONS) {
    try {
      console.log(`\n== ${loc.name} ==`);
      const run = await triggerActorRun(loc);
      console.log(`  Run started: ${run.id}`);
      const finished = await waitForRun(run.id, 15);
      const result = await importDataset(finished.defaultDatasetId, loc);
      totalNew += result.newCount || 0;
      totalUpdated += result.updatedCount || 0;
      console.log(`  +${result.newCount} new, ${result.updatedCount} updated`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      if (err.message.includes("402") || err.message.includes("quota")) {
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
