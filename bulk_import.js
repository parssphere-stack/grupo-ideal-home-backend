// Bulk import all Apify datasets to MongoDB
// Run this from Claude Code: node bulk_import.js

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const BACKEND_URL = "https://grupo-ideal-home-backend-production.up.railway.app";

if (!APIFY_TOKEN) {
  console.error("❌ Set APIFY_TOKEN env var first");
  process.exit(1);
}

async function listAllDatasets() {
  let allDatasets = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    const url = `https://api.apify.com/v2/datasets?limit=${limit}&offset=${offset}&unnamed=true&token=${APIFY_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    const items = data.data?.items || [];
    allDatasets = allDatasets.concat(items);
    console.log(`Fetched ${allDatasets.length} datasets so far...`);
    if (items.length < limit) break;
    offset += limit;
  }
  return allDatasets;
}

async function importDataset(datasetId) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/scraper/import/${datasetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  console.log("🔍 Listing all Apify datasets...");
  const datasets = await listAllDatasets();
  console.log(`\n📦 Total datasets found: ${datasets.length}`);
  
  // Filter only datasets with items (not empty)
  const nonEmpty = datasets.filter(d => d.itemCount > 0);
  console.log(`✅ Non-empty datasets: ${nonEmpty.length}`);
  
  // Sort by created date (newest first)
  nonEmpty.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  let totalNew = 0, totalParticular = 0, totalErrors = 0;
  
  for (let i = 0; i < nonEmpty.length; i++) {
    const ds = nonEmpty[i];
    process.stdout.write(`\r[${i+1}/${nonEmpty.length}] Importing ${ds.id} (${ds.itemCount} items)...`);
    
    const result = await importDataset(ds.id);
    
    if (result.error) {
      totalErrors++;
      console.log(`\n❌ Error: ${result.error}`);
    } else {
      totalNew += result.newCount || 0;
      totalParticular += result.particular || 0;
    }
    
    // Small delay to not overwhelm backend
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n\n✅ DONE!`);
  console.log(`   Datasets processed: ${nonEmpty.length}`);
  console.log(`   Total particulares found: ${totalParticular}`);
  console.log(`   New listings added: ${totalNew}`);
  console.log(`   Errors: ${totalErrors}`);
}

main().catch(console.error);
