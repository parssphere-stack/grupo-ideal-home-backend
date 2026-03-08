// ══════════════════════════════════════════════════════════════
// enrich_phones.js — Check all properties without phone
// Run from: /Users/sam/Desktop/grupo-ideal-home/backend
// node src/enrich_phones.js
// ══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
];

function extractPhone(html) {
  const m1 = html.match(/tel[éeÉ]fono[^<]*:\s*([+\d\s().-]{9,15})/i);
  if (m1) return m1[1].replace(/\s/g, "").trim();

  const jsonMatch = html.match(/window\.adDetailData\s*=\s*({.+?});/s);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      const phone = data?.adDetail?.contactInfo?.phone1?.phoneNumber;
      if (phone) return phone;
    } catch (e) {}
  }

  const btnMatch = html.match(/data-phone="([+\d]{9,15})"/);
  if (btnMatch) return btnMatch[1];

  const contactSection = html.match(
    /contacto[\s\S]{0,500}?((?:\+34\s?)?[6789]\d{8})/i,
  );
  if (contactSection) return contactSection[1].replace(/\s/g, "");

  return null;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  const Property = mongoose.model(
    "Property",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  const needsPhone = await Property.find({
    status: "active",
    $or: [
      { "contact.phone": { $exists: false } },
      { "contact.phone": "" },
      { "contact.phone": null },
    ],
  })
    .select("_id url contact title location")
    .lean();

  console.log(`📱 Properties without phone: ${needsPhone.length}\n`);

  if (needsPhone.length === 0) {
    console.log("✅ All properties have phone numbers!");
    await mongoose.disconnect();
    return;
  }

  let found = 0,
    noPhone = 0,
    blocked = 0,
    noUrl = 0;
  let consecutiveBlocked = 0;
  const DELAY = 3500;

  for (let i = 0; i < needsPhone.length; i++) {
    const prop = needsPhone[i];
    const progress = `[${i + 1}/${needsPhone.length}]`;

    if (!prop.url) {
      await Property.updateOne(
        { _id: prop._id },
        { $set: { phone_checked_at: new Date() } },
      );
      noUrl++;
      continue;
    }

    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    try {
      const response = await axios.get(prop.url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
          "User-Agent": ua,
          "Accept-Language": "es-ES,es;q=0.9",
          Accept: "text/html,application/xhtml+xml",
          Referer: "https://www.idealista.com/",
        },
      });

      if (response.status === 200 && typeof response.data === "string") {
        const phone = extractPhone(response.data);
        if (phone) {
          await Property.updateOne(
            { _id: prop._id },
            {
              $set: { "contact.phone": phone, phone_checked_at: new Date() },
            },
          );
          found++;
          console.log(
            `${progress} ✅ ${phone} — ${(prop.title || "").substring(0, 40)} (${prop.location?.city || "?"})`,
          );
        } else {
          await Property.updateOne(
            { _id: prop._id },
            { $set: { phone_checked_at: new Date() } },
          );
          noPhone++;
          console.log(
            `${progress} ❌ No phone — ${(prop.title || "").substring(0, 40)}`,
          );
        }
        consecutiveBlocked = 0;
      } else if (response.status === 403 || response.status === 429) {
        blocked++;
        consecutiveBlocked++;
        console.log(`${progress} 🚫 Blocked (${response.status})`);
        if (consecutiveBlocked >= 15) {
          console.log("\n⛔ Too many blocks — stopping.");
          break;
        }
        // Wait longer when blocked
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      } else {
        // 404, 410, etc — listing probably gone
        await Property.updateOne(
          { _id: prop._id },
          { $set: { phone_checked_at: new Date() } },
        );
        noPhone++;
        console.log(
          `${progress} ⚠️ HTTP ${response.status} — ${(prop.title || "").substring(0, 40)}`,
        );
      }
    } catch (e) {
      blocked++;
      consecutiveBlocked++;
      if (consecutiveBlocked >= 15) {
        console.log("\n⛔ Too many errors — stopping.");
        break;
      }
    }

    await new Promise((r) => setTimeout(r, DELAY));
  }

  console.log("\n═══════════════════════════════════════");
  console.log("📊 RESULTS");
  console.log("═══════════════════════════════════════");
  console.log(`Phone found: ${found}`);
  console.log(`No phone: ${noPhone}`);
  console.log(`Blocked: ${blocked}`);
  console.log(`No URL: ${noUrl}`);

  // Final stats
  const totalActive = await Property.countDocuments({ status: "active" });
  const totalWithPhone = await Property.countDocuments({
    status: "active",
    "contact.phone": { $exists: true, $nin: ["", null] },
  });
  console.log(
    `\n📱 DB: ${totalWithPhone}/${totalActive} active have phone (${Math.round((totalWithPhone / totalActive) * 100)}%)`,
  );

  await mongoose.disconnect();
  console.log("\n✅ Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
