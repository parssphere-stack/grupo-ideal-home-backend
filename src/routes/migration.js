// backend/src/routes/migration.js
// Uses mongoose directly — no require('../models/...') needed
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

function fullImgUrl(url) {
  if (!url) return null;
  return url.replace("/blur/WEB_DETAIL_TOP-XL-P/0/", "/files/");
}

function getPropertyCollection() {
  // Access MongoDB collection directly via mongoose connection
  return mongoose.connection.collection("properties");
}

router.get("/migrate-images/status", async (req, res) => {
  try {
    const col = getPropertyCollection();
    const total = await col.countDocuments();
    const withManyImages = await col.countDocuments({
      $expr: { $gte: [{ $size: { $ifNull: ["$images", []] } }, 10] },
    });
    res.json({ total, withManyImages, needsUpdate: total - withManyImages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/migrate-images", async (req, res) => {
  if (!APIFY_TOKEN)
    return res.status(500).json({ error: "APIFY_API_TOKEN not set" });
  const datasetId = req.body.datasetId || process.env.APIFY_DATASET_ID;
  if (!datasetId) return res.status(400).json({ error: "datasetId required" });

  res.json({
    status: "started",
    message: "Migration running. Check /api/admin/migrate-images/status",
  });
  runMigration(datasetId).catch((e) => console.error("Migration failed:", e));
});

async function runMigration(datasetId) {
  console.log("🔄 Starting image migration from Apify dataset:", datasetId);
  const col = getPropertyCollection();
  let offset = 0;
  const limit = 200;
  let totalUpdated = 0;

  while (true) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`❌ Apify fetch failed: ${resp.status}`);
      break;
    }
    const items = await resp.json();
    if (!items || items.length === 0) break;

    const bulkOps = [];
    for (const item of items) {
      const code = item.propertyCode?.toString();
      if (!code) continue;
      const images = (item.multimedia?.images || [])
        .map((img) => fullImgUrl(img.url))
        .filter(Boolean);
      if (images.length === 0) continue;
      bulkOps.push({
        updateOne: {
          filter: { propertyCode: code },
          update: { $set: { images } },
        },
      });
    }

    if (bulkOps.length > 0) {
      const result = await col.bulkWrite(bulkOps, { ordered: false });
      totalUpdated += result.modifiedCount || result.nModified || 0;
      console.log(
        `  ✅ Offset ${offset}: ${bulkOps.length} ops → ${result.modifiedCount || 0} updated`,
      );
    }

    offset += limit;
    if (items.length < limit) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(
    `🎉 Migration complete: ${totalUpdated} properties updated with full images`,
  );
}

module.exports = router;
