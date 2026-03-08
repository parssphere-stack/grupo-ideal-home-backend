// ══════════════════════════════════════════════════════════════
// fix_images.js — Detect and fix broken property images
// Run from: /Users/sam/Desktop/grupo-ideal-home/backend
// node src/fix_images.js
//
// Phase 0: Fix /blur/ URLs
// Phase 1: HEAD-check first image of every active property
// Phase 2: For broken ones, try to re-scrape images from Idealista
// Phase 3: Delete properties that truly have no images
// ══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Check if an image URL is alive ──────────────────────────
async function checkImageUrl(url) {
  if (!url) return "no_url";
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 3,
      validateStatus: () => true,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": randomUA(),
        Accept: "image/webp,image/*,*/*",
        Referer: "https://www.idealista.com/",
        Range: "bytes=0-1023",
      },
    });
    if (res.status === 200 || res.status === 206) return "ok";
    if (res.status === 404 || res.status === 410) return "gone";
    if (res.status === 403 || res.status === 429) return "blocked";
    return "other_" + res.status;
  } catch (e) {
    return "error";
  }
}

// ── Try to scrape fresh images from Idealista page ──────────
async function scrapeImages(url) {
  if (!url) return [];
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-ES,es;q=0.9",
        Referer: "https://www.idealista.com/",
      },
    });
    if (res.status !== 200 || typeof res.data !== "string") return [];
    const html = res.data;
    const images = [];

    // Method 1: window.adDetailData JSON
    const jsonMatch = html.match(/window\.adDetailData\s*=\s*({.+?});/s);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const imgs = data?.adDetail?.multimedia?.images;
        if (imgs) {
          imgs.forEach((img) => {
            const src = (img.url || img.src || "").replace(/\\u002F/g, "/");
            if (src) images.push(src);
          });
        }
      } catch (e) {}
    }

    // Method 2: og:image
    if (images.length === 0) {
      const ogMatches = html.matchAll(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/g);
      for (const m of ogMatches) {
        if (m[1] && !images.includes(m[1])) images.push(m[1]);
      }
    }

    // Method 3: image URLs in scripts
    if (images.length < 3) {
      const imgMatches = html.matchAll(/"url"\s*:\s*"(https:\/\/img\d+\.idealista\.com[^"]+)"/g);
      for (const m of imgMatches) {
        const clean = m[1].replace(/\\u002F/g, "/").replace(/\\/g, "");
        if (!images.includes(clean)) images.push(clean);
      }
    }

    return [...new Set(images)].slice(0, 20);
  } catch (e) {
    return [];
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  const Property = mongoose.model(
    "Property",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  // ── Phase 0: Fix /blur/ URLs ──────────────────────────────
  console.log("═══════════════════════════════════════════");
  console.log("🖼️  Phase 0: Fix /blur/ image URLs");
  console.log("═══════════════════════════════════════════");

  const blurProps = await Property.find({
    status: "active",
    images: { $elemMatch: { $regex: "/blur/" } },
  }).lean();

  let blurFixed = 0;
  for (const prop of blurProps) {
    const fixedImages = prop.images.map((img) =>
      typeof img === "string"
        ? img.replace(/\/blur\/[^/]+\/[^/]+\//g, "/files/")
        : img,
    );
    await Property.updateOne({ _id: prop._id }, { $set: { images: fixedImages } });
    blurFixed++;
  }
  console.log(`Fixed ${blurFixed} properties with /blur/ URLs\n`);

  // ── Phase 1: Check first image of each property ───────────
  console.log("═══════════════════════════════════════════");
  console.log("🔍 Phase 1: Checking images");
  console.log("═══════════════════════════════════════════");

  const properties = await Property.find({ status: "active" })
    .select("_id title images url location")
    .lean();

  console.log(`Checking ${properties.length} properties...\n`);

  const ok = [];
  const broken = []; // 404/410 — image gone
  const noImages = []; // no images array
  const blocked = []; // 403
  let consecutiveBlocked = 0;

  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i];

    if (!prop.images || prop.images.length === 0) {
      noImages.push(prop);
      continue;
    }

    const status = await checkImageUrl(prop.images[0]);

    if (status === "ok") {
      ok.push(prop._id);
      consecutiveBlocked = 0;
    } else if (status === "gone") {
      broken.push(prop);
      consecutiveBlocked = 0;
    } else if (status === "blocked") {
      blocked.push(prop);
      consecutiveBlocked++;
      if (consecutiveBlocked >= 30) {
        console.log(`\n⛔ CDN blocking at ${i + 1}/${properties.length} — stopping checks`);
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    } else {
      // other errors — treat as potentially broken
      broken.push(prop);
      consecutiveBlocked = 0;
    }

    if ((i + 1) % 200 === 0) {
      console.log(
        `  [${i + 1}/${properties.length}] OK: ${ok.length} | Broken: ${broken.length} | No img: ${noImages.length} | Blocked: ${blocked.length}`,
      );
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n📊 Phase 1 Results:`);
  console.log(`  OK: ${ok.length}`);
  console.log(`  Broken (404/gone): ${broken.length}`);
  console.log(`  No images: ${noImages.length}`);
  console.log(`  Blocked: ${blocked.length}`);

  // ── Phase 2: Try to fix broken ones ───────────────────────
  const toFix = [...broken, ...noImages];
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`🔧 Phase 2: Trying to re-scrape images for ${toFix.length} properties`);
  console.log(`═══════════════════════════════════════════`);

  const fixed = [];
  const unfixable = [];
  let blockedScrape = 0;

  for (let i = 0; i < toFix.length; i++) {
    const prop = toFix[i];
    if (!prop.url) {
      unfixable.push(prop);
      continue;
    }

    const newImages = await scrapeImages(prop.url);

    if (newImages.length > 0) {
      // Verify first image actually loads
      const verify = await checkImageUrl(newImages[0]);
      if (verify === "ok") {
        await Property.updateOne({ _id: prop._id }, { $set: { images: newImages } });
        fixed.push(prop);
        console.log(`  [${i + 1}/${toFix.length}] ✅ Fixed: ${(prop.title || "").substring(0, 40)} — ${newImages.length} images`);
      } else {
        unfixable.push(prop);
        console.log(`  [${i + 1}/${toFix.length}] ❌ Images found but don't load: ${(prop.title || "").substring(0, 40)}`);
      }
    } else {
      unfixable.push(prop);
      console.log(`  [${i + 1}/${toFix.length}] ❌ No images on page: ${(prop.title || "").substring(0, 40)}`);
      blockedScrape++;
      if (blockedScrape >= 15) {
        console.log("\n⛔ Too many failures — likely blocked. Marking rest as unfixable.");
        unfixable.push(...toFix.slice(i + 1));
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(`\n📊 Phase 2 Results:`);
  console.log(`  Fixed: ${fixed.length}`);
  console.log(`  Unfixable: ${unfixable.length}`);

  // ── Phase 3: Delete unfixable ─────────────────────────────
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`🗑️  Phase 3: Removing ${unfixable.length} unfixable listings`);
  console.log(`═══════════════════════════════════════════`);

  if (unfixable.length > 0) {
    const ids = unfixable.map((p) => p._id);
    const result = await Property.deleteMany({ _id: { $in: ids } });
    console.log(`Deleted ${result.deletedCount} listings`);
  } else {
    console.log("Nothing to remove!");
  }

  // Final stats
  const totalActive = await Property.countDocuments({ status: "active" });
  const withPhone = await Property.countDocuments({
    status: "active",
    "contact.phone": { $exists: true, $nin: ["", null] },
  });
  console.log(`\n📱 DB: ${totalActive} active | ${withPhone} with phone (${Math.round((withPhone / totalActive) * 100)}%)`);

  await mongoose.disconnect();
  console.log("\n✅ Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
