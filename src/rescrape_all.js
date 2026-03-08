#!/usr/bin/env node
/**
 * Full re-scrape — fetches ALL listings (not just last 48h) for every location.
 * Run: node src/rescrape_all.js
 *
 * Uses Apify to scrape Idealista. Cost: ~$2-4 depending on maxItems.
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { triggerActorRun, waitForRun, importDataset, checkApifyCredits } = require("./services/apify-client");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Full scrape locations (no 48h filter — gets everything)
const LOCATIONS = [
  // Madrid
  { name: "Madrid rent", operation: "rent", startUrl: "https://www.idealista.com/alquiler-viviendas/madrid-madrid/", maxItems: 500 },
  { name: "Madrid sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/madrid-madrid/", maxItems: 500 },
  // Malaga
  { name: "Malaga rent", operation: "rent", startUrl: "https://www.idealista.com/alquiler-viviendas/malaga-malaga/", maxItems: 300 },
  { name: "Malaga sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/malaga-malaga/", maxItems: 300 },
  // Marbella
  { name: "Marbella sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/marbella-malaga/", maxItems: 300 },
  { name: "Marbella rent", operation: "rent", startUrl: "https://www.idealista.com/alquiler-viviendas/marbella-malaga/", maxItems: 200 },
  // Estepona
  { name: "Estepona sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/estepona-malaga/", maxItems: 200 },
  // Benalmadena + Torremolinos
  { name: "Benalmadena rent", operation: "rent", startUrl: "https://www.idealista.com/alquiler-viviendas/benalmadena-malaga/", maxItems: 200 },
  // Fuengirola + Mijas
  { name: "Fuengirola sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/fuengirola-malaga/", maxItems: 200 },
  // Nerja
  { name: "Nerja sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/nerja-malaga/", maxItems: 200 },
  // Costa Tropical
  { name: "Costa Tropical sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/almunecar-granada/", maxItems: 150 },
  // Interior Malaga
  { name: "Interior Malaga sale", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/alhaurin-de-la-torre-malaga/", maxItems: 150 },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const before = await mongoose.connection.collection("properties").countDocuments();
  console.log(`Properties before: ${before}\n`);

  // Check Apify credits
  const credits = await checkApifyCredits();
  if (credits.locked) {
    console.error("Apify account is locked! Cannot scrape.");
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Apify plan: ${credits.plan || "unknown"}\n`);

  let totalNew = 0;
  let totalUpdated = 0;

  for (const loc of LOCATIONS) {
    try {
      console.log(`\n== ${loc.name} (max ${loc.maxItems}) ==`);
      const run = await triggerActorRun(loc);
      console.log(`  Run started: ${run.id}`);
      const finished = await waitForRun(run.id, 15);
      const result = await importDataset(finished.defaultDatasetId, loc);
      totalNew += result.newCount;
      totalUpdated += result.updatedCount;
      console.log(`  Done: +${result.newCount} new, ${result.updatedCount} updated`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      if (err.message.includes("402") || err.message.includes("quota") || err.message.includes("payment")) {
        console.error("Apify quota issue — stopping.");
        break;
      }
    }
    await sleep(5000);
  }

  const after = await mongoose.connection.collection("properties").countDocuments();
  console.log(`\n========================================`);
  console.log(`Before: ${before} | After: ${after} | New: ${totalNew} | Updated: ${totalUpdated}`);
  console.log(`========================================`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
