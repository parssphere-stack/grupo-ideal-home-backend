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
app.get("/api/img", (req, res) => {
  const url = req.query.u;
  if (!url) return res.status(400).send("missing url");

  let parsedUrl;
  try {
    parsedUrl = new URL(decodeURIComponent(url));
    if (!parsedUrl.hostname.includes("idealista.com")) {
      return res.status(403).send("not allowed");
    }
  } catch (e) {
    return res.status(400).send("invalid url");
  }

  const protocol = parsedUrl.protocol === "https:" ? https : http;

  // Full browser headers — Idealista blocks simple bots
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "es-ES,es;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
      // NO Referer header — key to bypass hotlink
    },
  };

  const proxyReq = protocol.request(options, (proxyRes) => {
    const status = proxyRes.statusCode;

    // If Idealista returned error (403, redirect, etc) — log and return 502
    if (status !== 200) {
      console.log(`Idealista returned ${status} for: ${url}`);
      return res.status(502).send(`Idealista returned ${status}`);
    }

    const ct = proxyRes.headers["content-type"] || "";
    // Make sure it's actually an image
    if (!ct.startsWith("image/")) {
      console.log(`Non-image content-type: ${ct} for: ${url}`);
      return res.status(502).send("not an image");
    }

    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    console.error("Proxy error:", e.message);
    res.status(500).send("proxy error");
  });

  proxyReq.setTimeout(12000, () => {
    proxyReq.destroy();
    res.status(504).send("timeout");
  });

  proxyReq.end();
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
const scraperRouter = require("./routes/scraper");
app.use("/api/properties", require("./routes/properties"));
app.use("/api/scraper", scraperRouter);
app.use("/api/agents", require("./routes/agent.routes"));
app.use("/api/properties", require("./routes/enrich"));
app.use("/api/admin", require("./routes/migration"));

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
      if (total < 10000) {
        console.log(`🔄 Auto-resuming scraper loop (${total}/10000)...`);
        if (scraperRouter.startAutoLoop) {
          scraperRouter.startAutoLoop();
        } else {
          const axios = require("axios");
          axios
            .post(`http://localhost:${PORT}/api/scraper/bigrun`)
            .catch(() => {});
        }
      } else {
        console.log(`✅ Target reached (${total}/10000) - scraper idle`);
      }
    } catch (err) {
      console.error("Auto-resume check failed:", err.message);
    }
  });
});
