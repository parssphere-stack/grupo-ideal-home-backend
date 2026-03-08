#!/usr/bin/env node
const axios = require("axios");
require("dotenv").config();

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = "REcGj6dyoIJ9Z7aE6";

async function main() {
  const input = {
    locationName: "Estepona, Málaga",
    country: "es",
    operation: "sale",
    maxItems: 5,
    userType: "private",
  };

  console.log("Testing with locationName:", JSON.stringify(input));

  const res = await axios.post(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
    input,
    {
      headers: { Authorization: `Bearer ${APIFY_TOKEN}`, "Content-Type": "application/json" },
      timeout: 30000,
    },
  );

  const runId = res.data.data.id;
  console.log("Run started:", runId);

  let status = "";
  while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
    await new Promise((r) => setTimeout(r, 10000));
    const r = await axios.get(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${runId}`,
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
    );
    status = r.data.data.status;
    console.log("Status:", status);
  }

  if (status === "SUCCEEDED") {
    const r2 = await axios.get(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${runId}`,
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
    );
    const dsId = r2.data.data.defaultDatasetId;
    const items = await axios.get(
      `https://api.apify.com/v2/datasets/${dsId}/items?format=json&limit=5`,
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
    );
    console.log("\nResults:");
    for (const item of items.data) {
      console.log(`  ${item.propertyCode} | ${item.municipality} | ${item.province} | ${item.price}€ | ${(item.address || "").substring(0, 40)}`);
    }
  } else {
    console.log("Run failed:", status);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
