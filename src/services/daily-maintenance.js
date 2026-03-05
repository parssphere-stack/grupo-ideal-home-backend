/**
 * Daily Maintenance Service
 *
 * Runs at 3 AM CET automatically:
 * Phase 1: Agency re-detection (instant, free)
 * Phase 1b: Stale property cleanup — 14+ days with no update/validation → inactive
 * Phase 2: URL validation for expired listings (~100min, free)
 * Phase 3: Incremental scrape — last 48h only (~15min, ~$0.40/day)
 * Phase 4: Phone enrichment for existing properties (~25min, free)
 * Phase 5: Alert emails — send matching properties to subscribers (~2min)
 */

const axios = require("axios");
const Property = require("../models/property.model");
const { isAgency } = require("../utils/agency-detector");
const {
  APIFY_TOKEN,
  triggerActorRun,
  waitForRun,
  importDataset,
  checkApifyCredits,
} = require("./apify-client");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── State (exposed via /api/scraper/maintenance/status) ──────
const maintenanceState = {
  running: false,
  lastRun: null,
  nextRun: null,
  lastResults: null,
};

// ── 12 Consolidated Locations — last 48 hours only ───────────
const INCREMENTAL_LOCATIONS = [
  {
    name: "Madrid rent",
    operation: "rent",
    startUrl: "https://www.idealista.com/alquiler-viviendas/madrid-madrid/publicado_ultimas-48-horas/",
    maxItems: 200,
  },
  {
    name: "Madrid sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/madrid-madrid/publicado_ultimas-48-horas/",
    maxItems: 200,
  },
  {
    name: "Malaga rent",
    operation: "rent",
    startUrl: "https://www.idealista.com/alquiler-viviendas/malaga-malaga/publicado_ultimas-48-horas/",
    maxItems: 150,
  },
  {
    name: "Malaga sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/malaga-malaga/publicado_ultimas-48-horas/",
    maxItems: 150,
  },
  {
    name: "Marbella sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/marbella-malaga/publicado_ultimas-48-horas/",
    maxItems: 100,
  },
  {
    name: "Marbella rent",
    operation: "rent",
    startUrl: "https://www.idealista.com/alquiler-viviendas/marbella-malaga/publicado_ultimas-48-horas/",
    maxItems: 80,
  },
  {
    name: "Estepona sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/estepona-malaga/publicado_ultimas-48-horas/",
    maxItems: 100,
  },
  {
    name: "Benalmadena+Torremolinos rent",
    operation: "rent",
    startUrl: "https://www.idealista.com/alquiler-viviendas/benalmadena-malaga/publicado_ultimas-48-horas/",
    maxItems: 100,
  },
  {
    name: "Fuengirola+Mijas sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/fuengirola-malaga/publicado_ultimas-48-horas/",
    maxItems: 100,
  },
  {
    name: "Nerja+Axarquia sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/nerja-malaga/publicado_ultimas-48-horas/",
    maxItems: 100,
  },
  {
    name: "Costa Tropical sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/almunecar-granada/publicado_ultimas-48-horas/",
    maxItems: 80,
  },
  {
    name: "Interior Malaga sale",
    operation: "sale",
    startUrl: "https://www.idealista.com/venta-viviendas/alhaurin-de-la-torre-malaga/publicado_ultimas-48-horas/",
    maxItems: 80,
  },
];

// ══════════════════════════════════════════════════════════════
// Phase 1: Agency Re-detection
// ══════════════════════════════════════════════════════════════
async function detectMisclassifiedAgencies() {
  console.log("[Maintenance] Phase 1: Agency re-detection...");
  const active = await Property.find({
    status: "active",
    is_particular: true,
  })
    .select("_id contact.name")
    .lean();

  let deactivated = 0;
  for (const p of active) {
    if (isAgency(p.contact?.name || "", "")) {
      await Property.updateOne(
        { _id: p._id },
        { $set: { status: "inactive", is_particular: false } },
      );
      deactivated++;
    }
  }
  console.log(`[Maintenance] Phase 1 done: ${deactivated} agencies removed from ${active.length} checked`);
  return { checked: active.length, deactivated };
}

// ══════════════════════════════════════════════════════════════
// Phase 1b: Stale Property Cleanup
// Properties not re-scraped in 14+ days AND not validated in 14+ days → inactive
// ══════════════════════════════════════════════════════════════
async function deactivateStaleProperties() {
  console.log("[Maintenance] Phase 1b: Stale property cleanup...");

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago

  // Properties not updated (re-scraped) in 14+ days AND not validated in 14+ days
  // updatedAt is the most reliable indicator — gets refreshed on any upsert
  const result = await Property.updateMany(
    {
      status: "active",
      updatedAt: { $lt: cutoff },
      $or: [
        { validated_at: { $exists: false } },
        { validated_at: null },
        { validated_at: { $lt: cutoff } },
      ],
    },
    { $set: { status: "inactive" } },
  );

  const deactivated = result.modifiedCount || 0;
  console.log(`[Maintenance] Phase 1b done: ${deactivated} stale properties deactivated`);
  return { deactivated };
}

// ══════════════════════════════════════════════════════════════
// Phase 2: URL Validation (expired listing detection)
// ══════════════════════════════════════════════════════════════
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

async function checkPropertyUrl(url) {
  if (!url || !url.includes("idealista.com")) return "expired";

  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  try {
    const response = await axios.get(url, {
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

    const status = response.status;
    if (status === 200) {
      const html = typeof response.data === "string" ? response.data : "";
      // If page has property content → active
      if (html.includes("property-description") || html.includes("adDetailData")) return "active";
      // If redirected to "no results" or home
      if (html.includes("no-results") || html.includes("anuncio ya no")) return "expired";
      return "active"; // 200 but ambiguous → assume active
    }
    if (status === 404 || status === 410) return "expired";
    if (status === 301 || status === 302) {
      const loc = response.headers.location || "";
      if (loc.includes("/inmueble/")) return "active";
      return "expired";
    }
    if (status === 403 || status === 429) return "blocked";
    return "error";
  } catch (e) {
    if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") return "blocked";
    return "error";
  }
}

async function validateActiveListings() {
  console.log("[Maintenance] Phase 2: URL validation...");

  // Get properties to validate — prioritize never-validated, then oldest validated
  const properties = await Property.find({ status: "active" })
    .select("_id idealista_id url validated_at")
    .sort({ validated_at: 1 }) // null (never checked) first, then oldest
    .lean();

  let expired = 0, active = 0, blocked = 0, errors = 0;
  let consecutiveBlocked = 0;
  const DELAY = 2000; // 2s between requests
  const MAX_CONSECUTIVE_BLOCKED = 20; // Pause if too many blocks

  for (const prop of properties) {
    if (!prop.url) {
      // No URL = can't validate, skip
      continue;
    }

    const result = await checkPropertyUrl(prop.url);

    if (result === "expired") {
      await Property.updateOne(
        { _id: prop._id },
        { $set: { status: "inactive", validated_at: new Date() } },
      );
      expired++;
      consecutiveBlocked = 0;
    } else if (result === "active") {
      await Property.updateOne(
        { _id: prop._id },
        { $set: { validated_at: new Date() } },
      );
      active++;
      consecutiveBlocked = 0;
    } else if (result === "blocked") {
      blocked++;
      consecutiveBlocked++;
      // If too many consecutive blocks, DataDome is throttling us — stop for today
      if (consecutiveBlocked >= MAX_CONSECUTIVE_BLOCKED) {
        console.log(`[Maintenance] Phase 2: ${MAX_CONSECUTIVE_BLOCKED} consecutive blocks — pausing until tomorrow`);
        break;
      }
    } else {
      errors++;
      consecutiveBlocked = 0;
    }

    await sleep(DELAY);
  }

  console.log(`[Maintenance] Phase 2 done: ${active} active, ${expired} expired, ${blocked} blocked, ${errors} errors`);
  return { total: properties.length, active, expired, blocked, errors };
}

// ══════════════════════════════════════════════════════════════
// Phase 3: Incremental Scrape (Apify — only last 48h listings)
// ══════════════════════════════════════════════════════════════
async function runIncrementalScrape() {
  console.log("[Maintenance] Phase 3: Incremental scrape...");

  if (!APIFY_TOKEN) {
    console.log("[Maintenance] Phase 3: APIFY_TOKEN not set, skipping");
    return { skipped: true, reason: "no token" };
  }

  // Pre-flight: check if account is locked
  const credits = await checkApifyCredits();
  if (credits.locked) {
    console.log("[Maintenance] Phase 3: Apify account locked, skipping scrape");
    return { skipped: true, reason: "account locked" };
  }

  const results = [];
  let totalNew = 0;

  // Run locations sequentially to minimize cost and avoid parallel billing spikes
  for (const loc of INCREMENTAL_LOCATIONS) {
    try {
      console.log(`  Scraping: ${loc.name}...`);
      const actorRun = await triggerActorRun(loc);
      const finishedRun = await waitForRun(actorRun.id, 10);
      const result = await importDataset(finishedRun.defaultDatasetId, loc);
      results.push({ location: loc.name, ...result });
      totalNew += result.newCount;
      console.log(`  ${loc.name}: +${result.newCount} new`);
    } catch (err) {
      console.error(`  ${loc.name} failed: ${err.message}`);
      results.push({ location: loc.name, error: err.message });
      // If quota/payment error, stop remaining locations
      if (err.message.includes("402") || err.message.includes("quota") || err.message.includes("payment")) {
        console.log("[Maintenance] Phase 3: Apify quota issue — stopping remaining locations");
        break;
      }
    }
    // Small delay between locations
    await sleep(5000);
  }

  console.log(`[Maintenance] Phase 3 done: ${totalNew} new properties across ${results.length} locations`);
  return { totalNew, results };
}

// ══════════════════════════════════════════════════════════════
// Phase 4: Phone Number Enrichment (free — direct HTTP)
// ══════════════════════════════════════════════════════════════
function extractPhone(html) {
  // Method 1: "teléfono:" text on page
  const m1 = html.match(/tel[éeÉ]fono[^<]*:\s*([+\d\s().-]{9,15})/i);
  if (m1) return m1[1].replace(/\s/g, "").trim();

  // Method 2: Embedded JSON data
  const jsonMatch = html.match(/window\.adDetailData\s*=\s*({.+?});/s);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      const phone = data?.adDetail?.contactInfo?.phone1?.phoneNumber;
      if (phone) return phone;
    } catch (e) {}
  }

  // Method 3: data-phone attribute
  const btnMatch = html.match(/data-phone="([+\d]{9,15})"/);
  if (btnMatch) return btnMatch[1];

  // Method 4: Spanish mobile/landline in contact section
  const contactSection = html.match(/contacto[\s\S]{0,500}?((?:\+34\s?)?[6789]\d{8})/i);
  if (contactSection) return contactSection[1].replace(/\s/g, "");

  return null;
}

async function enrichPhones() {
  console.log("[Maintenance] Phase 4: Phone enrichment...");

  // Find properties without phone, not checked recently
  const needsPhone = await Property.find({
    status: "active",
    is_particular: true,
    "contact.phone": { $in: ["", null] },
    $or: [
      { phone_checked_at: { $exists: false } },
      { phone_checked_at: null },
      { phone_checked_at: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    ],
  })
    .select("_id url contact")
    .limit(500)
    .lean();

  if (needsPhone.length === 0) {
    console.log("[Maintenance] Phase 4: No properties need phone enrichment");
    return { checked: 0, found: 0 };
  }

  let found = 0, blocked = 0, noPhone = 0;
  let consecutiveBlocked = 0;
  const DELAY = 3000; // 3s between requests

  for (const prop of needsPhone) {
    if (!prop.url) {
      await Property.updateOne({ _id: prop._id }, { $set: { phone_checked_at: new Date() } });
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
            { $set: { "contact.phone": phone, phone_checked_at: new Date() } },
          );
          found++;
        } else {
          await Property.updateOne(
            { _id: prop._id },
            { $set: { phone_checked_at: new Date() } },
          );
          noPhone++;
        }
        consecutiveBlocked = 0;
      } else if (response.status === 403 || response.status === 429) {
        blocked++;
        consecutiveBlocked++;
        if (consecutiveBlocked >= 15) {
          console.log("[Maintenance] Phase 4: Too many blocks — pausing");
          break;
        }
      } else {
        await Property.updateOne(
          { _id: prop._id },
          { $set: { phone_checked_at: new Date() } },
        );
        noPhone++;
      }
    } catch (e) {
      blocked++;
      consecutiveBlocked++;
      if (consecutiveBlocked >= 15) break;
    }

    await sleep(DELAY);
  }

  console.log(`[Maintenance] Phase 4 done: ${found} phones found, ${noPhone} no phone, ${blocked} blocked`);
  return { checked: needsPhone.length, found, noPhone, blocked };
}

// ══════════════════════════════════════════════════════════════
// Orchestrator
// ══════════════════════════════════════════════════════════════
async function runDailyMaintenance() {
  if (maintenanceState.running) {
    console.log("[Maintenance] Already running, skipping");
    return;
  }

  maintenanceState.running = true;
  const startedAt = new Date();
  console.log(`\n=== DAILY MAINTENANCE START: ${startedAt.toISOString()} ===`);

  const results = {};

  try {
    // Phase 1: Agency detection (~30s)
    results.agencies = await detectMisclassifiedAgencies();

    // Phase 1b: Stale property cleanup (instant)
    results.stale = await deactivateStaleProperties();

    // Phase 2: URL validation (~100min)
    results.validation = await validateActiveListings();

    // Phase 3: Incremental scrape (~15min)
    results.scrape = await runIncrementalScrape();

    // Phase 4: Phone enrichment (~25min)
    results.phones = await enrichPhones();

    // Phase 5: Alert emails (~2min)
    const { processAlerts } = require("./alert-mailer");
    results.alerts = await processAlerts();
  } catch (err) {
    console.error("[Maintenance] Fatal error:", err.message);
    results.error = err.message;
  }

  const finishedAt = new Date();
  const durationMin = Math.round((finishedAt - startedAt) / 60000);

  maintenanceState.running = false;
  maintenanceState.lastRun = finishedAt;
  maintenanceState.lastResults = { ...results, startedAt, finishedAt, durationMin };

  // Get updated counts
  try {
    const total = await Property.countDocuments({ status: "active", is_particular: true });
    const withPhone = await Property.countDocuments({
      status: "active", is_particular: true,
      "contact.phone": { $exists: true, $ne: "" },
    });
    maintenanceState.lastResults.dbCounts = { total, withPhone };
  } catch (e) {}

  console.log(`=== DAILY MAINTENANCE DONE in ${durationMin}min ===\n`);
  return results;
}

// ── Scheduler ────────────────────────────────────────────────
function startDailyMaintenance() {
  // Calculate next 3 AM CET (UTC+1, or UTC+2 in summer)
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0); // 3 AM CET ≈ 2 AM UTC
  if (next <= now) next.setDate(next.getDate() + 1);

  maintenanceState.nextRun = next;
  const msUntilStart = next - now;
  const hoursUntil = Math.round(msUntilStart / 3600000 * 10) / 10;

  console.log(`[Maintenance] Scheduled daily at 3 AM CET (in ${hoursUntil}h)`);

  setTimeout(() => {
    runDailyMaintenance().catch((err) =>
      console.error("[Maintenance] Run failed:", err.message),
    );
    // Repeat every 24 hours
    setInterval(() => {
      maintenanceState.nextRun = new Date(Date.now() + 24 * 60 * 60 * 1000);
      runDailyMaintenance().catch((err) =>
        console.error("[Maintenance] Run failed:", err.message),
      );
    }, 24 * 60 * 60 * 1000);
  }, msUntilStart);
}

module.exports = {
  startDailyMaintenance,
  runDailyMaintenance,
  deactivateStaleProperties,
  maintenanceState,
};
