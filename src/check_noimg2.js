// Check imageless listings against Apify datasets
// If a listing ID doesn't appear in ANY recent dataset, it's likely removed
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.APIFY_TOKEN;
const BASE = "https://api.apify.com/v2";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.model("P", new mongoose.Schema({}, { strict: false }), "properties");

  // Get all imageless listing IDs
  const noImg = await P.find({
    status: "active",
    $or: [{ images: { $exists: false } }, { images: { $size: 0 } }, { images: null }],
  }).select("_id idealista_id url").lean();

  console.log("Imageless listings:", noImg.length);

  // Build set of their IDs (strip idealista_ prefix if present)
  const noImgIds = new Set();
  const idToDoc = {};
  for (const p of noImg) {
    const id = String(p.idealista_id || "").replace("idealista_", "");
    if (id) {
      noImgIds.add(id);
      idToDoc[id] = p;
    }
  }
  console.log("Unique IDs to check:", noImgIds.size);

  // Scan all Apify datasets to see which IDs appear
  const foundIds = new Set();
  const foundWithImages = {}; // id -> images array

  // Get all dataset IDs
  let allDatasets = [];
  for (let offset = 0; offset < 200; offset += 50) {
    try {
      const res = await axios.get(`${BASE}/actor-runs`, {
        params: { token: TOKEN, limit: 50, desc: 1, offset },
        timeout: 15000,
      });
      const runs = res.data?.data?.items || [];
      if (runs.length === 0) break;
      for (const r of runs) {
        if (r.status === "SUCCEEDED" && r.defaultDatasetId) {
          allDatasets.push(r.defaultDatasetId);
        }
      }
    } catch (e) { break; }
  }

  // Deduplicate
  allDatasets = [...new Set(allDatasets)];
  console.log("Datasets to scan:", allDatasets.length, "\n");

  for (let i = 0; i < allDatasets.length; i++) {
    const ds = allDatasets[i];
    try {
      const res = await axios.get(`${BASE}/datasets/${ds}/items`, {
        params: { token: TOKEN, format: "json" },
        timeout: 30000,
      });
      for (const item of res.data || []) {
        const id = String(item.propertyCode || item.id || "");
        if (noImgIds.has(id)) {
          foundIds.add(id);
          // Check if this item has images
          let images = [];
          if (item.multimedia && item.multimedia.images) {
            images = item.multimedia.images.map(img => img.url || img.src).filter(Boolean);
          } else if (item.images && Array.isArray(item.images)) {
            images = item.images.map(img => typeof img === "string" ? img : img.url || img.src || null).filter(Boolean);
          }
          if (images.length > 0 && (!foundWithImages[id] || foundWithImages[id].length < images.length)) {
            foundWithImages[id] = images.slice(0, 20);
          }
        }
      }
    } catch (e) {}

    if ((i + 1) % 20 === 0) console.log(`  Scanned ${i + 1}/${allDatasets.length} datasets | found: ${foundIds.size}`);
  }

  const notFound = [];
  for (const id of noImgIds) {
    if (!foundIds.has(id)) notFound.push(id);
  }

  console.log("\nResults:");
  console.log("  Found in Apify datasets:", foundIds.size);
  console.log("  With images in Apify:", Object.keys(foundWithImages).length);
  console.log("  NOT found (gone from Idealista):", notFound.length);

  // Fix images for those found with images
  let fixed = 0;
  for (const [id, images] of Object.entries(foundWithImages)) {
    const doc = idToDoc[id];
    if (doc) {
      await P.updateOne({ _id: doc._id }, { $set: { images } });
      fixed++;
    }
  }
  console.log("  Fixed images for:", fixed, "listings");

  // Delete not found
  if (notFound.length > 0) {
    const deleteIds = notFound.map(id => idToDoc[id]?._id).filter(Boolean);
    const del = await P.deleteMany({ _id: { $in: deleteIds } });
    console.log("  Deleted gone listings:", del.deletedCount);
  }

  // Delete remaining ones that are in Apify but have no images anywhere
  const stillNoImg = [];
  for (const id of foundIds) {
    if (!foundWithImages[id]) stillNoImg.push(id);
  }
  if (stillNoImg.length > 0) {
    const deleteIds = stillNoImg.map(id => idToDoc[id]?._id).filter(Boolean);
    const del = await P.deleteMany({ _id: { $in: deleteIds } });
    console.log("  Deleted (in Apify but no images):", del.deletedCount);
  }

  const remaining = await P.countDocuments({ status: "active" });
  console.log("\nFinal active:", remaining);

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch(e => { console.error(e); process.exit(1); });
