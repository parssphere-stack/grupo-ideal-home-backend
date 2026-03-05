/**
 * Grupo Ideal Home — Scraper Routes (manual + maintenance)
 *
 * GET  /api/scraper/status                — status + counts
 * GET  /api/scraper/runs                  — recent runs
 * POST /api/scraper/run                   — manual scrape (custom locations)
 * POST /api/scraper/bigrun                — one-time big scrape
 * POST /api/scraper/import/:datasetId     — import specific Apify dataset
 * POST /api/scraper/cleanup               — agency cleanup
 * POST /api/scraper/stop                  — stop auto-loop
 * GET  /api/scraper/maintenance/status    — daily maintenance status
 * POST /api/scraper/maintenance/run       — trigger maintenance manually
 * POST /api/scraper/maintenance/validate  — trigger Phase 2 validation only
 * POST /api/scraper/maintenance/cleanup-stale — trigger stale cleanup only
 */

const express = require("express");
const router = express.Router();
const Property = require("../models/property.model");
const { isAgency } = require("../utils/agency-detector");
const {
  APIFY_TOKEN,
  triggerActorRun,
  waitForRun,
  importDataset,
  checkApifyCredits,
} = require("../services/apify-client");
const {
  runDailyMaintenance,
  validateActiveListings,
  deactivateStaleProperties,
  maintenanceState,
} = require("../services/daily-maintenance");

// ── State ────────────────────────────────────────────────────
const state = {
  running: false,
  lastRun: null,
  lastCleanup: null,
  runs: [],
  autoLoopActive: false,
};

// ── Big scrape locations (kept for manual one-time use) ──────
const BIG_SCRAPE_LOCATIONS = [
  { name: "malaga", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/malaga/con-precio-desde_80000/", maxItems: 5000 },
  { name: "malaga este", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/malaga/este/con-precio-desde_80000/", maxItems: 3000 },
  { name: "teatinos malaga", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/malaga/teatinos-universidad/con-precio-desde_80000/", maxItems: 3000 },
  { name: "pedregalejo malaga", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/malaga/pedregalejo-el-palo/con-precio-desde_80000/", maxItems: 3000 },
  { name: "torremolinos", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/torremolinos-malaga/con-precio-desde_80000/", maxItems: 3000 },
  { name: "benalmadena", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/benalmadena-malaga/con-precio-desde_80000/", maxItems: 3000 },
  { name: "fuengirola", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/fuengirola-malaga/con-precio-desde_80000/", maxItems: 3000 },
  { name: "mijas costa", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/mijas-malaga/mijas-costa/con-precio-desde_80000/", maxItems: 3000 },
  { name: "marbella", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/marbella-malaga/con-precio-desde_200000/", maxItems: 5000 },
  { name: "estepona", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/estepona-malaga/con-precio-desde_100000/", maxItems: 3000 },
  { name: "benahavis", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/benahavis-malaga/con-precio-desde_150000/", maxItems: 2500 },
  { name: "nerja", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/nerja-malaga/", maxItems: 3000 },
  { name: "almunecar granada", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/almunecar-granada/", maxItems: 2500 },
  { name: "rincon de la victoria", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/rincon-de-la-victoria-malaga/", maxItems: 2500 },
  { name: "alhaurin de la torre", operation: "sale", startUrl: "https://www.idealista.com/venta-viviendas/alhaurin-de-la-torre-malaga/", maxItems: 2500 },
];

// ── Run scrape + import for list of locations ────────────────
async function runScrapeImport(locations) {
  if (state.running) throw new Error("Already running");
  state.running = true;

  const run = {
    id: Date.now(),
    startedAt: new Date(),
    locations: locations.map((l) => l.name),
    status: "running",
    results: [],
  };
  state.runs.unshift(run);
  if (state.runs.length > 20) state.runs.pop();

  const BATCH_SIZE = 4; // Reduced from 8 to save credits
  try {
    // Pre-flight credit check
    const credits = await checkApifyCredits();
    if (credits.locked) {
      throw new Error("Apify account locked — monthly limit exceeded");
    }

    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
      const batch = locations.slice(i, i + BATCH_SIZE);
      console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map((l) => l.name).join(", ")}`);
      const batchResults = await Promise.all(
        batch.map(async (loc) => {
          try {
            const actorRun = await triggerActorRun(loc);
            const finishedRun = await waitForRun(actorRun.id, 15);
            const importResult = await importDataset(finishedRun.defaultDatasetId, loc);
            return { location: loc.name, ...importResult };
          } catch (err) {
            console.error(`  ${loc.name} failed:`, err.message);
            return { location: loc.name, error: err.message };
          }
        }),
      );
      run.results.push(...batchResults);
    }
    run.status = "completed";
    run.finishedAt = new Date();
    state.lastRun = run;

    if (state.autoLoopActive) {
      const allFailed = run.results.every((r) => r.error);
      const totalNew = run.results.reduce((sum, r) => sum + (r.newCount || 0), 0);

      if (allFailed || totalNew === 0) {
        console.log("Auto-loop stopped (all failed or no new listings)");
        state.autoLoopActive = false;
      } else {
        console.log(`${totalNew} new found — next bigrun in 5 minutes...`);
        setTimeout(async () => {
          try { await runScrapeImport(BIG_SCRAPE_LOCATIONS); }
          catch (err) { console.error("Auto-loop failed:", err.message); state.autoLoopActive = false; }
        }, 5 * 60 * 1000);
      }
    }
  } finally {
    state.running = false;
  }
  return run;
}

// ── Cleanup ──────────────────────────────────────────────────
async function runCleanup() {
  console.log("Running agency cleanup...");
  const active = await Property.find({ status: "active" }).select("_id contact").lean();
  let agencyFound = 0;
  for (const p of active) {
    if (isAgency(p.contact?.name || "")) {
      await Property.updateOne(
        { _id: p._id },
        { $set: { status: "inactive", is_particular: false } },
      );
      agencyFound++;
    }
  }
  const result = { agencyRemoved: agencyFound, at: new Date() };
  state.lastCleanup = result;
  console.log(`Agency listings removed: ${agencyFound}`);
  return result;
}

// ══════════════════════════════════════════════════════════════
// Routes
// ══════════════════════════════════════════════════════════════

router.get("/status", async (req, res) => {
  try {
    const total = await Property.countDocuments({ status: "active", is_particular: true });
    const madrid = await Property.countDocuments({ status: "active", is_particular: true, "location.city": /madrid/i });
    const malaga = await Property.countDocuments({ status: "active", is_particular: true, "location.city": /m.laga/i });
    const rent = await Property.countDocuments({ status: "active", is_particular: true, operation: "rent" });
    const sale = await Property.countDocuments({ status: "active", is_particular: true, operation: "sale" });
    const withPhone = await Property.countDocuments({ status: "active", is_particular: true, "contact.phone": { $exists: true, $ne: "" } });
    const latest = await Property.findOne({}, {}, { sort: { scraped_at: -1 } }).select("scraped_at").lean();
    res.json({
      running: state.running,
      autoLoopActive: state.autoLoopActive,
      lastRun: state.lastRun,
      lastCleanup: state.lastCleanup,
      apifyConfigured: !!APIFY_TOKEN,
      maintenance: {
        lastRun: maintenanceState.lastRun,
        nextRun: maintenanceState.nextRun,
        running: maintenanceState.running,
      },
      counts: { total, madrid, malaga, rent, sale, withPhone },
      lastScrapeDate: latest?.scraped_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/runs", (req, res) => res.json(state.runs));

router.post("/run", async (req, res) => {
  try {
    if (!APIFY_TOKEN) return res.status(400).json({ error: "APIFY_TOKEN not configured" });
    if (state.running) return res.status(409).json({ error: "Already running" });
    const locations = req.body.locations;
    if (!locations || !Array.isArray(locations)) {
      return res.status(400).json({ error: "Provide locations array in body" });
    }
    runScrapeImport(locations).catch((err) => console.error("Manual run failed:", err.message));
    res.json({ message: "Scrape started", locations: locations.map((l) => l.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/bigrun", async (req, res) => {
  try {
    if (!APIFY_TOKEN) return res.status(400).json({ error: "APIFY_TOKEN not configured" });
    if (state.running) return res.status(409).json({ error: "Already running" });

    // Credit check before expensive operation
    const credits = await checkApifyCredits();
    if (credits.locked) {
      return res.status(402).json({ error: "Apify account locked — monthly limit exceeded" });
    }

    runScrapeImport(BIG_SCRAPE_LOCATIONS).catch((err) => {
      console.error("Big run failed:", err.message);
      state.autoLoopActive = false;
    });
    state.autoLoopActive = true;
    res.json({
      message: "Big scrape started",
      zones: BIG_SCRAPE_LOCATIONS.length,
      locations: BIG_SCRAPE_LOCATIONS.map((l) => `${l.name} [${l.operation}]`),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/import/:datasetId", async (req, res) => {
  try {
    const result = await importDataset(req.params.datasetId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cleanup", async (req, res) => {
  try {
    const result = await runCleanup();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/stop", (req, res) => {
  state.autoLoopActive = false;
  res.json({ message: "Auto-loop stopped", running: state.running });
});

// ── Maintenance routes ───────────────────────────────────────
router.get("/maintenance/status", (req, res) => {
  res.json({
    running: maintenanceState.running,
    lastRun: maintenanceState.lastRun,
    nextRun: maintenanceState.nextRun,
    lastResults: maintenanceState.lastResults,
  });
});

router.post("/maintenance/run", async (req, res) => {
  if (maintenanceState.running) {
    return res.status(409).json({ error: "Maintenance already running" });
  }
  runDailyMaintenance().catch((err) =>
    console.error("Manual maintenance failed:", err.message),
  );
  res.json({ message: "Daily maintenance started (agency detection + stale cleanup + URL validation + incremental scrape + phone enrichment + alerts)" });
});

// Trigger just Phase 2 validation (Apify cross-reference)
router.post("/maintenance/validate", async (req, res) => {
  try {
    const result = await validateActiveListings();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger just stale property cleanup (instant)
router.post("/maintenance/cleanup-stale", async (req, res) => {
  try {
    const result = await deactivateStaleProperties();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
