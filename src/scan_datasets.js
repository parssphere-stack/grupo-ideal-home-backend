// Scan all datasets for non-Madrid data
const axios = require("axios");
require("dotenv").config();
const TOKEN = process.env.APIFY_TOKEN;

async function main() {
  let allDS = [];
  for (let offset = 0; offset < 200; offset += 50) {
    try {
      const r = await axios.get("https://api.apify.com/v2/actor-runs", {
        params: { token: TOKEN, limit: 50, desc: 1, offset }, timeout: 15000,
      });
      const runs = r.data?.data?.items || [];
      if (runs.length === 0) break;
      for (const run of runs) {
        if (run.status === "SUCCEEDED" && run.defaultDatasetId) allDS.push(run.defaultDatasetId);
      }
    } catch (e) { break; }
  }
  allDS = [...new Set(allDS)];
  console.log("Total datasets:", allDS.length);

  let foundNonMadrid = false;
  for (let i = 0; i < allDS.length; i++) {
    try {
      const r = await axios.get(`https://api.apify.com/v2/datasets/${allDS[i]}/items`, {
        params: { token: TOKEN, format: "json", limit: 10 }, timeout: 10000,
      });
      for (const item of r.data || []) {
        if (item.province && item.province !== "Madrid") {
          console.log(`NON-MADRID: ${allDS[i]} | ${item.province} | ${item.municipality}`);
          foundNonMadrid = true;
          break;
        }
      }
    } catch (e) {}
    if ((i + 1) % 30 === 0) console.log(`  Scanned ${i + 1}/${allDS.length}`);
  }
  if (!foundNonMadrid) console.log("\nALL datasets are Madrid only!");
}

main().catch(console.error);
