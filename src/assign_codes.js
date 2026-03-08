#!/usr/bin/env node
const mongoose = require("mongoose");
require("dotenv").config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const col = mongoose.connection.collection("properties");
  const counterCol = mongoose.connection.collection("counters");

  const total = await col.countDocuments();
  const withCode = await col.countDocuments({ code: { $exists: true, $ne: null } });
  const withoutCode = total - withCode;

  console.log(`Total: ${total} | With code: ${withCode} | Need code: ${withoutCode}`);

  if (withoutCode === 0) {
    console.log("All properties already have codes!");
    await mongoose.disconnect();
    return;
  }

  const current = await counterCol.findOne({ _id: "property_code" });
  let seq = current?.seq || 0;

  const batchSize = 500;
  let assigned = 0;

  while (true) {
    const docs = await col
      .find({ $or: [{ code: null }, { code: { $exists: false } }] }, { projection: { _id: 1 } })
      .sort({ createdAt: 1 })
      .limit(batchSize)
      .toArray();

    if (!docs.length) break;

    const bulkOps = docs.map((doc) => {
      seq++;
      return {
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { code: String(10000 + seq) } },
        },
      };
    });

    await col.bulkWrite(bulkOps, { ordered: false });
    assigned += docs.length;
    console.log(`Assigned: ${assigned} — last code: ${10000 + seq}`);
  }

  await counterCol.updateOne(
    { _id: "property_code" },
    { $set: { seq } },
    { upsert: true },
  );

  console.log(`Done! ${assigned} codes assigned. Counter: ${seq} (last: ${10000 + seq})`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
