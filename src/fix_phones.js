#!/usr/bin/env node
/**
 * fix_phones.js — Recover phone numbers from Apify run history.
 * Only ADDS phone numbers to properties that are missing them.
 * Never overwrites an existing phone. Free — reads existing datasets only.
 *
 * Run: node src/fix_phones.js
 */

const mongoose = require("mongoose");
require("dotenv").config();
const axios = require("axios");

const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const ACTOR_ID = "REcGj6dyoIJ9Z7aE6";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const col = mongoose.connection.collection("properties");

  // 1. Get all properties missing phone
  const noPhone = await col
    .find(
      { status: "active", $or: [{ "contact.phone": "" }, { "contact.phone": null }, { "contact.phone": { $exists: false } }] },
      { projection: { idealista_id: 1 } },
    )
    .toArray();

  const needsPhone = new Set(noPhone.map((p) => p.idealista_id));
  console.log(`Properties without phone: ${needsPhone.size}\n`);

  if (needsPhone.size === 0) {
    console.log("Nothing to fix!");
    await mongoose.disconnect();
    return;
  }

  // 2. Fetch all succeeded runs (paginate)
  console.log("Fetching Apify run history...");
  let allRuns = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await axios.get(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?limit=${limit}&offset=${offset}&desc=true&status=SUCCEEDED`,
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` }, timeout: 15000 },
    );
    const runs = res.data.data.items;
    allRuns.push(...runs);
    if (runs.length < limit) break;
    offset += limit;
  }

  // Deduplicate datasets
  const seen = new Set();
  const datasets = [];
  for (const r of allRuns) {
    if (r.defaultDatasetId && !seen.has(r.defaultDatasetId)) {
      seen.add(r.defaultDatasetId);
      datasets.push({ id: r.defaultDatasetId, date: r.startedAt });
    }
  }
  console.log(`${allRuns.length} runs → ${datasets.length} unique datasets\n`);

  // 3. Scan datasets for phone numbers
  const phoneMap = new Map(); // idealista_id → phone
  let scanned = 0;

  for (const ds of datasets) {
    scanned++;
    try {
      const url = `https://api.apify.com/v2/datasets/${ds.id}/items?format=json&limit=10000`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
        timeout: 60000,
      });

      let found = 0;
      for (const item of res.data) {
        const id = String(item.propertyCode || item.adId || item.id || "");
        if (!id || !needsPhone.has(id)) continue;

        const ci = item.contactInfo || {};
        const phone = ci.phone1?.phoneNumber || ci.phone || "";
        if (phone && !phoneMap.has(id)) {
          phoneMap.set(id, phone);
          found++;
        }
      }

      if (found > 0) {
        process.stdout.write(`[${scanned}/${datasets.length}] +${found} phones (total: ${phoneMap.size}/${needsPhone.size})\n`);
      }

      // Early exit if all found
      if (phoneMap.size >= needsPhone.size) {
        console.log("\nAll phones found!");
        break;
      }
    } catch (err) {
      // skip failed datasets
    }
  }

  console.log(`\nFound phones for ${phoneMap.size} / ${needsPhone.size} properties`);

  // 4. Update DB
  if (phoneMap.size > 0) {
    console.log("Updating database...");
    const bulkOps = [];
    for (const [idealistaId, phone] of phoneMap) {
      bulkOps.push({
        updateOne: {
          filter: { idealista_id: idealistaId },
          update: { $set: { "contact.phone": phone } },
        },
      });
    }

    // Execute in batches of 500
    for (let i = 0; i < bulkOps.length; i += 500) {
      const batch = bulkOps.slice(i, i + 500);
      await col.bulkWrite(batch, { ordered: false });
    }
    console.log(`Updated ${phoneMap.size} properties with phone numbers`);
  }

  // 5. Final stats
  const total = await col.countDocuments({ status: "active" });
  const withPhone = await col.countDocuments({
    status: "active",
    "contact.phone": { $exists: true, $nin: ["", null] },
  });
  console.log(`\nDB: ${total} active | ${withPhone} with phone (${Math.round((withPhone / total) * 100)}%)`);

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
