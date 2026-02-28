// backend/src/routes/migration.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

function fullImgUrl(url) {
  if (!url) return null;
  return url.replace("/blur/WEB_DETAIL_TOP-XL-P/0/", "/files/");
}

function getCol() {
  return mongoose.connection.collection("properties");
}

// Status
router.get("/migrate-images/status", async (req, res) => {
  try {
    const col = getCol();
    const total = await col.countDocuments();
    const withManyImages = await col.countDocuments({
      $expr: { $gte: [{ $size: { $ifNull: ["$images", []] } }, 10] },
    });
    res.json({ total, withManyImages, needsUpdate: total - withManyImages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug sample
router.get("/migrate-images/check-sample", async (req, res) => {
  try {
    const col = getCol();
    const big = await col.findOne({
      $expr: { $gte: [{ $size: { $ifNull: ["$images", []] } }, 10] },
    });
    const small = await col.findOne({
      $expr: { $lte: [{ $size: { $ifNull: ["$images", []] } }, 3] },
    });
    res.json({
      withManyImages: big
        ? {
            idealista_id: big.idealista_id,
            count: big.images?.length,
            sample: big.images?.slice(0, 2),
          }
        : null,
      withFewImages: small
        ? {
            idealista_id: small.idealista_id,
            count: small.images?.length,
            sample: small.images?.slice(0, 2),
          }
        : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Trigger migration
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
  console.log("🔄 Starting image migration — matching by idealista_id");
  const col = getCol();
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
      // Apify uses propertyCode — MongoDB stores it as idealista_id
      const code = item.propertyCode?.toString();
      if (!code) continue;

      const images = (item.multimedia?.images || [])
        .map((img) => fullImgUrl(img.url))
        .filter(Boolean);
      if (images.length === 0) continue;

      bulkOps.push({
        updateOne: {
          filter: { idealista_id: code },
          update: { $set: { images } },
        },
      });
    }

    if (bulkOps.length > 0) {
      const result = await col.bulkWrite(bulkOps, { ordered: false });
      totalUpdated += result.modifiedCount || 0;
      console.log(
        `  ✅ Offset ${offset}: ${bulkOps.length} ops → ${result.modifiedCount || 0} updated`,
      );
    }

    offset += limit;
    if (items.length < limit) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`🎉 Done: ${totalUpdated} properties updated`);
}

module.exports = router;
