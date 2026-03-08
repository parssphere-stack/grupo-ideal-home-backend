// Check listings without images — are they still on Idealista?
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

async function checkUrl(url) {
  if (!url) return "no_url";
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-ES,es;q=0.9",
        Referer: "https://www.idealista.com/",
      },
    });
    return res.status;
  } catch (e) {
    return "error";
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.model("P", new mongoose.Schema({}, { strict: false }), "properties");

  const noImg = await P.find({
    status: "active",
    $or: [{ images: { $exists: false } }, { images: { $size: 0 } }, { images: null }],
  }).select("_id idealista_id url title").lean();

  console.log("Checking", noImg.length, "listings without images...\n");

  const results = { 200: [], 301: [], 404: [], 403: [], other: [] };
  let blocked = 0;

  for (let i = 0; i < noImg.length; i++) {
    const p = noImg[i];
    const status = await checkUrl(p.url);

    if (status === 200) results[200].push(p);
    else if (status === 301 || status === 302) results[301].push(p);
    else if (status === 404 || status === 410) results[404].push(p);
    else if (status === 403 || status === 429) {
      results[403].push(p);
      blocked++;
      if (blocked >= 20) {
        console.log("Too many 403s, stopping...");
        // Mark remaining as unknown
        for (let j = i + 1; j < noImg.length; j++) results.other.push(noImg[j]);
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    } else results.other.push(p);

    if ((i + 1) % 50 === 0) console.log(`  [${i + 1}/${noImg.length}]`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\nResults:");
  console.log("  200 (still live):", results[200].length);
  console.log("  301 (redirect):", results[301].length);
  console.log("  404 (gone):", results[404].length);
  console.log("  403 (blocked):", results[403].length);
  console.log("  Other:", results.other.length);

  // Delete 404s — they're gone from Idealista
  const toDelete = results[404].map(p => p._id);
  if (toDelete.length > 0) {
    const del = await P.deleteMany({ _id: { $in: toDelete } });
    console.log("\nDeleted", del.deletedCount, "listings that are gone from Idealista");
  }

  const remaining = await P.countDocuments({ status: "active" });
  console.log("Remaining active:", remaining);

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch(e => { console.error(e); process.exit(1); });
