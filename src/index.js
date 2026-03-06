/**
 * Grupo Ideal Home — Backend Server
 * Node.js + Express + MongoDB
 */

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/grupo-ideal-home";

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── IMAGE PROXY — Idealista hotlink fix ─────────────────────
// Idealista broke img4 direct URLs (301→404). Only /blur/ paths still work.
function fixIdealistaUrl(url) {
  if (!url.includes("idealista.com")) return url;
  const u = new URL(url);
  const path = u.pathname;
  // Already has /blur/ — leave it
  if (path.startsWith("/blur/")) return url;
  // /WEB_DETAIL_TOP-XL-P/... → /blur/WEB_DETAIL_TOP-XL-P/...
  if (path.includes("/WEB_DETAIL")) {
    u.pathname = "/blur" + path;
    return u.toString();
  }
  // /files/id.pro.es.image.master/... → /blur/WEB_DETAIL_TOP-XL-P/0/id.pro.es.image.master/...
  if (path.startsWith("/files/")) {
    u.pathname = "/blur/WEB_DETAIL_TOP-XL-P/0/" + path.slice("/files/".length);
    return u.toString();
  }
  return url;
}

function fetchImage(url, res, redirectCount = 0) {
  if (redirectCount > 5) return res.status(502).send("too many redirects");

  // Fix broken Idealista image URLs
  url = fixIdealistaUrl(url);

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return res.status(400).send("invalid url");
  }

  const protocol = parsedUrl.protocol === "https:" ? https : http;

  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Encoding": "identity",
      "Accept-Language": "es-ES,es;q=0.9",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
    },
  };

  const proxyReq = protocol.request(options, (proxyRes) => {
    const status = proxyRes.statusCode;

    // Follow redirects (301, 302, 307, 308)
    if ([301, 302, 307, 308].includes(status)) {
      const location = proxyRes.headers["location"];
      if (!location) return res.status(502).send("redirect without location");
      const nextUrl = location.startsWith("http")
        ? location
        : `${parsedUrl.protocol}//${parsedUrl.hostname}${location}`;
      console.log(`Redirect ${status} -> ${nextUrl}`);
      // Drain response before next request
      proxyRes.resume();
      return fetchImage(nextUrl, res, redirectCount + 1);
    }

    // 405 from Idealista still returns valid image data
    if (status !== 200 && status !== 405) {
      console.log(`Error ${status} for: ${url}`);
      return res.status(502).send(`upstream returned ${status}`);
    }

    const ct = proxyRes.headers["content-type"] || "";
    if (!ct.startsWith("image/")) {
      console.log(`Non-image content-type: ${ct}`);
      return res.status(502).send("not an image");
    }

    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    console.error("Proxy error:", e.message);
    if (!res.headersSent) res.status(500).send("proxy error");
  });

  proxyReq.setTimeout(12000, () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).send("timeout");
  });

  proxyReq.end();
}

app.get("/api/img", (req, res) => {
  const url = req.query.u;
  if (!url) return res.status(400).send("missing url");

  let decoded;
  try {
    decoded = decodeURIComponent(url);
    const check = new URL(decoded);
    if (!check.hostname.includes("idealista.com")) {
      return res.status(403).send("not allowed");
    }
  } catch (e) {
    return res.status(400).send("invalid url");
  }

  fetchImage(decoded, res);
});

// ── MongoDB Connection ──────────────────────────────────────
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected:", MONGODB_URI))
  .catch((err) => {
    console.error("❌ MongoDB error:", err);
    process.exit(1);
  });

// ── Routes ──────────────────────────────────────────────────
app.use("/api/properties", require("./routes/properties"));
app.use("/api/scraper", require("./routes/scraper"));
app.use("/api/agents", require("./routes/agent.routes"));
app.use("/api/properties", require("./routes/enrich"));
app.use("/api/admin", require("./routes/migration"));
app.use("/api/users", require("./routes/user.routes"));
app.use("/api/inbox", require("./routes/inbox.routes"));
app.use("/api/activity", require("./routes/activity.routes"));
app.use("/api/alerts", require("./routes/alert.routes"));
app.use("/api/ai", require("./routes/ai-chat.routes"));
app.use("/api/ai", require("./routes/ai-search.routes"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date(),
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏠 Grupo Ideal Home API`);
  console.log(`   http://localhost:${PORT}/api`);
  console.log(`   http://localhost:${PORT}/api/health\n`);

  mongoose.connection.once("open", async () => {
    try {
      const Property = require("./models/property.model");
      const total = await Property.countDocuments({
        status: "active",
        is_particular: true,
      });
      console.log(`📊 DB has ${total} particulares`);

      // Start daily maintenance (runs at 3 AM CET: agency check + URL validation + incremental scrape + phone enrichment)
      const { startDailyMaintenance } = require("./services/daily-maintenance");
      startDailyMaintenance();
    } catch (err) {
      console.error("Startup check failed:", err.message);
    }
  });
});
