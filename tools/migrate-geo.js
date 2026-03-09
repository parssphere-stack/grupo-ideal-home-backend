/**
 * Migration: Populate `geo` GeoJSON Point field from existing lat/lng
 *
 * Run once: node tools/migrate-geo.js
 *
 * This updates all properties that have latitude/longitude but no geo field.
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected.");

  const db = mongoose.connection.db;
  const col = db.collection("properties");

  // Find all properties with lat/lng but missing geo
  const cursor = col.find({
    "location.latitude": { $exists: true, $ne: null },
    "location.longitude": { $exists: true, $ne: null },
    $or: [
      { geo: { $exists: false } },
      { "geo.coordinates": { $exists: false } },
    ],
  });

  let updated = 0;
  let skipped = 0;
  const batch = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const lat = parseFloat(doc.location.latitude);
    const lng = parseFloat(doc.location.longitude);

    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
      skipped++;
      continue;
    }

    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            geo: { type: "Point", coordinates: [lng, lat] },
          },
        },
      },
    });

    if (batch.length >= 500) {
      await col.bulkWrite(batch);
      updated += batch.length;
      console.log(`  Updated ${updated} properties...`);
      batch.length = 0;
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await col.bulkWrite(batch);
    updated += batch.length;
  }

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}`);

  // Ensure 2dsphere index exists
  console.log("Ensuring 2dsphere index on geo...");
  await col.createIndex({ geo: "2dsphere" });
  console.log("Index created.");

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
