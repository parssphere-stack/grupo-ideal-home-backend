/**
 * Grupo Ideal Home — Backend Server
 * Node.js + Express + MongoDB
 */

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/grupo-ideal-home";

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

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

  // Auto-resume scraper loop after DB is ready
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
