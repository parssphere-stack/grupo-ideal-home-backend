/**
 * Daily Maintenance Service
 *
 * Runs at 3 AM CET automatically:
 * Phase 1: Agency re-detection (instant, free)
 * Phase 1b: Stale property cleanup — 14+ days with no update/validation → inactive
 * Phase 2: Apify cross-reference — full city scrape, deactivate missing (~20min, ~$0.50/day)
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

// ── Validation schedule — full scrapes rotating by day of week ──
// Each day validates a different city group via Apify cross-reference.
// Properties in our DB that don't appear in the full scrape → inactive.
const VALIDATION_LOCATIONS = [
  // 0 = Sunday: Madrid rent
  [{ name: "Madrid rent", startUrl: "https://www.idealista.com/alquiler-viviendas/madrid-madrid/", maxItems: 2000, matchCity: "Madrid" }],
  // 1 = Monday: Madrid sale
  [{ name: "Madrid sale", startUrl: "https://www.idealista.com/venta-viviendas/madrid-madrid/", maxItems: 2000, matchCity: "Madrid" }],
  // 2 = Tuesday: Málaga rent + sale
  [
    { name: "Málaga rent", startUrl: "https://www.idealista.com/alquiler-viviendas/malaga-malaga/", maxItems: 1500, matchCity: "Málaga" },
    { name: "Málaga sale", startUrl: "https://www.idealista.com/venta-viviendas/malaga-malaga/", maxItems: 1500, matchCity: "Málaga" },
  ],
  // 3 = Wednesday: Marbella sale + rent
  [
    { name: "Marbella sale", startUrl: "https://www.idealista.com/venta-viviendas/marbella-malaga/", maxItems: 1500, matchCity: "Marbella" },
    { name: "Marbella rent", startUrl: "https://www.idealista.com/alquiler-viviendas/marbella-malaga/", maxItems: 1000, matchCity: "Marbella" },
  ],
  // 4 = Thursday: Estepona + Fuengirola
  [
    { name: "Estepona sale", startUrl: "https://www.idealista.com/venta-viviendas/estepona-malaga/", maxItems: 1000, matchCity: "Estepona" },
    { name: "Fuengirola sale", startUrl: "https://www.idealista.com/venta-viviendas/fuengirola-malaga/", maxItems: 1000, matchCity: "Fuengirola" },
  ],
  // 5 = Friday: Benalmádena + Torremolinos
  [
    { name: "Benalmádena rent", startUrl: "https://www.idealista.com/alquiler-viviendas/benalmadena-malaga/", maxItems: 800, matchCity: "Benalmádena" },
    { name: "Torremolinos rent", startUrl: "https://www.idealista.com/alquiler-viviendas/torremolinos-malaga/", maxItems: 800, matchCity: "Torremolinos" },
  ],
  // 6 = Saturday: Nerja + Almuñécar
  [
    { name: "Nerja sale", startUrl: "https://www.idealista.com/venta-viviendas/nerja-malaga/", maxItems: 500, matchCity: "Nerja" },
    { name: "Almuñécar sale", startUrl: "https://www.idealista.com/venta-viviendas/almunecar-granada/", maxItems: 500, matchCity: "Almuñécar" },
  ],
];

// ══════════════════════════════════════════════════════════════
// Phase 2: Apify Cross-Reference Validation
// Scrapes full city listings via Apify, cross-references with DB.
// Properties in our DB not found in the scrape → deactivated.
// ══════════════════════════════════════════════════════════════
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

async function fetchDatasetIds(datasetId) {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=10000`;
  const headers = APIFY_TOKEN ? { Authorization: `Bearer ${APIFY_TOKEN}` } : {};
  const res = await axios.get(url, { headers, timeout: 60000 });
  const items = res.data;
  const ids = new Set();
  for (const item of items) {
    const id = String(item.propertyCode || item.adId || item.id || "");
    if (id) ids.add(id);
  }
  return { ids, totalScraped: items.length };
}

async function validateActiveListings() {
  console.log("[Maintenance] Phase 2: Apify cross-reference validation...");

  if (!APIFY_TOKEN) {
    console.log("[Maintenance] Phase 2: APIFY_TOKEN not set, skipping");
    return { skipped: true, reason: "no token" };
  }

  const credits = await checkApifyCredits();
  if (credits.locked) {
    console.log("[Maintenance] Phase 2: Apify account locked, skipping");
    return { skipped: true, reason: "account locked" };
  }

  const dayOfWeek = new Date().getDay(); // 0=Sun … 6=Sat
  const todaysLocations = VALIDATION_LOCATIONS[dayOfWeek] || [];

  if (todaysLocations.length === 0) {
    console.log("[Maintenance] Phase 2: No validation scheduled today");
    return { skipped: true, reason: "no locations today" };
  }

  let totalDeactivated = 0;
  const results = [];

  for (const loc of todaysLocations) {
    try {
      console.log(`  Validation scrape: ${loc.name}...`);

      // 1. Run full Apify scrape (no 48h filter)
      const actorRun = await triggerActorRun(loc);
      const finishedRun = await waitForRun(actorRun.id, 15);

      // 2. Import dataset normally (upserts + agency filtering)
      const importResult = await importDataset(finishedRun.defaultDatasetId, loc);

      // 3. Fetch all scraped IDs for cross-reference
      const { ids: scrapedIds, totalScraped } = await fetchDatasetIds(finishedRun.defaultDatasetId);
      console.log(`  ${loc.name}: ${scrapedIds.size} unique IDs from ${totalScraped} items`);

      // Safety: if scrape hit maxItems, data may be truncated — skip deactivation
      if (totalScraped >= loc.maxItems * 0.95) {
        console.log(`  ${loc.name}: scrape may be truncated (${totalScraped}/${loc.maxItems}), skipping deactivation`);
        results.push({ location: loc.name, scraped: totalScraped, deactivated: 0, truncated: true });
        continue;
      }

      // Safety: if scrape returned very few results, something may be wrong
      if (totalScraped < 10) {
        console.log(`  ${loc.name}: too few results (${totalScraped}), skipping deactivation`);
        results.push({ location: loc.name, scraped: totalScraped, deactivated: 0, tooFew: true });
        continue;
      }

      // 4. Determine operation from URL
      const operation = loc.startUrl.includes("alquiler") ? "rent" : "sale";

      // 5. Find our active particular properties for this city + operation
      const ourProperties = await Property.find({
        status: "active",
        is_particular: true,
        "location.city": loc.matchCity,
        operation,
      }).select("idealista_id").lean();

      if (ourProperties.length === 0) {
        console.log(`  ${loc.name}: no matching properties in DB`);
        results.push({ location: loc.name, scraped: totalScraped, inDb: 0, deactivated: 0 });
        continue;
      }

      // 6. Cross-reference: DB properties not in scrape → deactivate
      const missing = ourProperties.filter((p) => !scrapedIds.has(p.idealista_id));

      if (missing.length === 0) {
        console.log(`  ${loc.name}: all ${ourProperties.length} listings confirmed active`);
        // Mark all as validated
        await Property.updateMany(
          { idealista_id: { $in: ourProperties.map((p) => p.idealista_id) } },
          { $set: { validated_at: new Date() } },
        );
        results.push({ location: loc.name, scraped: totalScraped, inDb: ourProperties.length, deactivated: 0 });
        continue;
      }

      // Safety cap: don't deactivate more than 30% of a city's listings at once
      const maxDeactivate = Math.ceil(ourProperties.length * 0.3);
      const toDeactivate = missing.length > maxDeactivate ? missing.slice(0, maxDeactivate) : missing;

      if (missing.length > maxDeactivate) {
        console.log(`  ${loc.name}: ${missing.length} missing but capping at ${maxDeactivate} (30% safety limit)`);
      }

      const deactivateIds = toDeactivate.map((p) => p.idealista_id);
      const updateResult = await Property.updateMany(
        { idealista_id: { $in: deactivateIds }, status: "active" },
        { $set: { status: "inactive", validated_at: new Date() } },
      );
      const deactivated = updateResult.modifiedCount || 0;
      totalDeactivated += deactivated;

      // Mark remaining (confirmed active) as validated
      const confirmedIds = ourProperties
        .filter((p) => scrapedIds.has(p.idealista_id))
        .map((p) => p.idealista_id);
      if (confirmedIds.length > 0) {
        await Property.updateMany(
          { idealista_id: { $in: confirmedIds } },
          { $set: { validated_at: new Date() } },
        );
      }

      console.log(`  ${loc.name}: ${deactivated} deactivated | ${confirmedIds.length} confirmed active (${ourProperties.length} in DB, ${scrapedIds.size} on Idealista)`);
      results.push({ location: loc.name, scraped: totalScraped, inDb: ourProperties.length, onIdealista: scrapedIds.size, deactivated });
    } catch (err) {
      console.error(`  ${loc.name} validation failed: ${err.message}`);
      results.push({ location: loc.name, error: err.message });
      // Stop on quota/payment issues
      if (err.message.includes("402") || err.message.includes("quota") || err.message.includes("payment")) {
        console.log("[Maintenance] Phase 2: Apify quota issue — stopping");
        break;
      }
    }
    await sleep(5000);
  }

  console.log(`[Maintenance] Phase 2 done: ${totalDeactivated} listings deactivated across ${results.length} locations`);
  return { totalDeactivated, results };
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
  validateActiveListings,
  deactivateStaleProperties,
  maintenanceState,
};
