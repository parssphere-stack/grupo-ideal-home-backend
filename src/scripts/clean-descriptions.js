/**
 * One-time migration: clean contact info from all property descriptions.
 * Usage: node src/scripts/clean-descriptions.js [--dry-run]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Property = require("../models/property.model");
const { cleanDescription } = require("../utils/clean-description");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const props = await Property.find({
    description: { $exists: true, $ne: "" },
  })
    .select("_id description code")
    .lean();

  console.log(`Found ${props.length} properties with descriptions`);
  if (DRY_RUN) console.log("=== DRY RUN — no changes will be saved ===\n");

  let changed = 0;
  let emptied = 0;
  const bulkOps = [];

  for (const p of props) {
    const cleaned = cleanDescription(p.description);

    if (cleaned === p.description) continue;

    changed++;
    if (!cleaned) emptied++;

    if (DRY_RUN) {
      console.log(`[${p.code}] BEFORE: ${p.description.substring(0, 80)}...`);
      console.log(`[${p.code}] AFTER:  ${(cleaned || "(empty)").substring(0, 80)}`);
      console.log();
    } else {
      bulkOps.push({
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { description: cleaned } },
        },
      });
    }
  }

  if (!DRY_RUN && bulkOps.length > 0) {
    console.log(`Executing ${bulkOps.length} bulk updates...`);
    await Property.bulkWrite(bulkOps, { ordered: false });
  }

  console.log(`\nDone. ${changed} descriptions ${DRY_RUN ? "would be" : ""} cleaned (${emptied} emptied).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
