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

  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
    },
  };

  const proxyReq = protocol.request(options, (proxyRes) => {
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader(
      "Content-Type",
      proxyRes.headers["content-type"] || "image/webp",
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => res.status(500).send("proxy error"));
  proxyReq.setTimeout(10000, () => {
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
