// ══ backend/src/routes/enrich.js ══
// POST /api/properties/:id/enrich
// Fetches full property data from Idealista and returns enriched info

const express = require("express");
const router = express.Router();

// Simple in-memory cache (per process)
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

router.post("/:id/enrich", async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes("idealista.com")) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  // Check cache
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const result = await scrapeIdealista(url);
    // Cache it
    cache.set(url, { ts: Date.now(), data: result });
    res.json(result);
  } catch (e) {
    console.error("Enrich error:", e.message);
    res.status(500).json({ error: "Failed to fetch" });
  }
});

async function scrapeIdealista(url) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Referer: "https://www.idealista.com/",
  };

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();

  // ── Extract images ──
  const images = [];

  // Method 1: JSON-LD or window data
  const windowDataMatch = html.match(/window\.adDetailData\s*=\s*({.+?});/s);
  if (windowDataMatch) {
    try {
      const data = JSON.parse(windowDataMatch[1]);
      const imgs = data?.adDetail?.multimedia?.images;
      if (imgs) {
        imgs.forEach((img) => {
          // Remove blur and get largest size
          const src = (img.url || img.src || "")
            .replace("/blur/[^/]+/", "/")
            .replace("/WEB_DETAIL-", "/WEB_DETAIL-");
          if (src) images.push(src);
        });
      }
    } catch (e) {}
  }

  // Method 2: og:image tags
  if (images.length === 0) {
    const ogMatches = html.matchAll(
      /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/g,
    );
    for (const m of ogMatches) {
      if (m[1] && !images.includes(m[1])) images.push(m[1]);
    }
  }

  // Method 3: image URLs in scripts
  if (images.length < 3) {
    const imgMatches = html.matchAll(
      /"url"\s*:\s*"(https:\/\/img\d+\.idealista\.com[^"]+)"/g,
    );
    for (const m of imgMatches) {
      const clean = m[1]
        .replace("/blur/[^/]+/", "/")
        .replace(/\\u002F/g, "/")
        .replace(/\\/g, "");
      if (!images.includes(clean)) images.push(clean);
    }
  }

  // Method 4: img tags with idealista CDN
  if (images.length < 3) {
    const imgTagMatches = html.matchAll(
      /<img[^>]+src="(https:\/\/img\d+\.idealista\.com\/[^"]+)"/g,
    );
    for (const m of imgTagMatches) {
      const clean = m[1].replace(/\/blur\/\d+_\d+\//, "/");
      if (!images.includes(clean)) images.push(clean);
    }
  }

  // ── Extract description ──
  let description = "";
  const descMatch = html.match(
    /<div[^>]+class="[^"]*adCommentsLanguage[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  if (descMatch) {
    description = descMatch[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ── Extract features ──
  const features = {
    lift: /ascensor/i.test(html),
    terrace: /terraza/i.test(html),
    parking: /garaje|parking/i.test(html),
    pool: /piscina/i.test(html),
    exterior: /exterior/i.test(html),
    ac: /aire acondicionado|climatizaci/i.test(html),
    storage: /trastero/i.test(html),
    garden: /jard[íi]n/i.test(html),
  };

  // ── Extract contact phone (if visible) ──
  let phone = null;
  const phoneMatch = html.match(/tel[éeÉ]fono[^<]*:\s*([+\d\s().-]{9,15})/i);
  if (phoneMatch) phone = phoneMatch[1].replace(/\s/g, "").trim();

  return { images: images.slice(0, 25), description, features, phone };
}

module.exports = router;
