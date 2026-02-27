// backend/src/routes/migration.js
// POST /api/admin/migrate-images
// Fetches all items from Apify dataset and updates MongoDB with full images

const express = require("express");
const router = express.Router();

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const APIFY_DATASET_ID = process.env.APIFY_DATASET_ID; // set in Railway env vars

// Helper: convert blur URL to full quality
function fullImgUrl(url) {
  if (!url) return null;
  // Remove blur prefix → get direct CDN path
  return url.replace("/blur/WEB_DETAIL_TOP-XL-P/0/", "/files/");
}

// GET status
router.get("/migrate-images/status", async (req, res) => {
  try {
    const Property = req.app.locals.Property;
    const total = await Property.countDocuments();
    const withImages = await Property.countDocuments({
      "images.1": { $exists: true },
    }); // has at least 2 images
    const withManyImages = await Property.countDocuments({
      $expr: { $gte: [{ $size: { $ifNull: ["$images", []] } }, 10] },
    });
    res.json({
      total,
      withImages,
      withManyImages,
      needsUpdate: total - withManyImages,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST — run migration
router.post("/migrate-images", async (req, res) => {
  if (!APIFY_TOKEN)
    return res.status(500).json({ error: "APIFY_API_TOKEN not set" });

  const datasetId = req.body.datasetId || APIFY_DATASET_ID;
  if (!datasetId)
    return res
      .status(400)
      .json({ error: "datasetId required (body or APIFY_DATASET_ID env)" });

  // Start async — respond immediately
  res.json({
    status: "started",
    message:
      "Migration running in background. Check /api/admin/migrate-images/status",
  });

  runMigration(req.app.locals.Property, datasetId).catch((e) =>
    console.error("Migration failed:", e),
  );
});

async function runMigration(Property, datasetId) {
  console.log("🔄 Starting image migration from Apify dataset:", datasetId);

  let offset = 0;
  const limit = 200;
  let totalUpdated = 0;
  let totalProcessed = 0;

  while (true) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(
        `❌ Apify fetch failed at offset ${offset}: ${resp.status}`,
      );
      break;
    }

    const items = await resp.json();
    if (!items || items.length === 0) break;

    // Batch update MongoDB
    const bulkOps = [];
    for (const item of items) {
      const code = item.propertyCode?.toString();
      if (!code) continue;

      // Extract full images from multimedia
      const rawImgs = item.multimedia?.images || [];
      const images = rawImgs.map((img) => fullImgUrl(img.url)).filter(Boolean);

      if (images.length === 0) continue;

      bulkOps.push({
        updateOne: {
          filter: { propertyCode: code },
          update: { $set: { images } },
        },
      });
    }

    if (bulkOps.length > 0) {
      const result = await Property.bulkWrite(bulkOps, { ordered: false });
      totalUpdated += result.modifiedCount;
      console.log(
        `  ✅ Offset ${offset}: ${bulkOps.length} items → ${result.modifiedCount} updated`,
      );
    }

    totalProcessed += items.length;
    offset += limit;

    if (items.length < limit) break; // last page
    await new Promise((r) => setTimeout(r, 200)); // rate limit
  }

  console.log(
    `🎉 Migration complete: ${totalUpdated}/${totalProcessed} properties updated with full images`,
  );
}

module.exports = router;
