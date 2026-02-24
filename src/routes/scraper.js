/**
 * Grupo Ideal Home — Auto Scraper
 *
 * GET  /api/scraper/status            — status + counts
 * GET  /api/scraper/runs              — recent runs
 * POST /api/scraper/run               — daily maintenance scrape
 * POST /api/scraper/bigrun            — one-time big scrape (reach 10k)
 * POST /api/scraper/import/:datasetId — import specific Apify dataset
 * POST /api/scraper/cleanup           — mark agency/expired listings inactive
 */

const express = require("express");
const router = express.Router();
const axios = require("axios");
const Property = require("../models/property.model");

const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const ACTOR_ID = "REcGj6dyoIJ9Z7aE6";
const INTERVAL_HOURS = parseInt(process.env.SCRAPE_INTERVAL_HOURS) || 24;

// ── State ────────────────────────────────────────────────────
const state = {
  running: false,
  lastRun: null,
  lastCleanup: null,
  runs: [],
  schedulerActive: false,
  autoLoopActive: false,
};

// ── Agency keyword blacklist ─────────────────────────────────
const AGENCY_KEYWORDS = [
  "inmobiliaria",
  "inmobiliario",
  "agencia",
  "agente",
  "agency",
  "real estate",
  "realestate",
  "realty",
  "gestión inmobiliaria",
  "gestion inmobiliaria",
  "servicios",
  "soluciones",
  "inversiones",
  "inversión",
  "inversion",
  "consultores",
  "consultoría",
  "consultoria",
  "asociados",
  "partners",
  "century 21",
  "century21",
  "remax",
  "re/max",
  "coldwell",
  "engel",
  "voelkers",
  "völkers",
  "lucas fox",
  "lucasfox",
  "barnes",
  "savills",
  "knight frank",
  "jll",
  "cushman",
  "cbre",
  "tecnocasa",
  "habitaclia",
  "fotocasa",
  "pisos.com",
  "s.l.",
  "s.l ",
  "s.a.",
  "s.a ",
  "s.l.u",
  "sociedad limitada",
  "asesor inmobiliario",
  "broker",
  "promotor",
  "promotora",
  "desarrollo inmobiliario",
  "construcciones",
  "administracion de fincas",
  "gestion de alquileres",
  "compraventa",
];

function isAgency(name = "", commercial = "") {
  const combined = `${name} ${commercial}`.toLowerCase();
  if (commercial && commercial.length > 2) return true;
  return AGENCY_KEYWORDS.some((kw) => combined.includes(kw));
}

function isExpired(item) {
  if (item.status && !["good", "renew", ""].includes(item.status)) return true;
  if (item.firstActivationDate) {
    const daysOld =
      (Date.now() - item.firstActivationDate) / (1000 * 60 * 60 * 24);
    if (daysOld > 90) return true;
  }
  return false;
}

// ── Map Apify item → Property schema ────────────────────────
function mapItem(item) {
  const typeMap = {
    flat: "apartment",
    apartment: "apartment",
    piso: "apartment",
    house: "house",
    casa: "house",
    chalet: "house",
    villa: "villa",
    penthouse: "penthouse",
    atico: "penthouse",
    ático: "penthouse",
    studio: "studio",
    estudio: "studio",
    duplex: "duplex",
    dúplex: "duplex",
    loft: "loft",
    land: "land",
    terreno: "land",
    commercial: "commercial",
    oficina: "commercial",
    local: "commercial",
  };
  const rawType = (item.propertyType || item.typology || "").toLowerCase();

  let images = [];
  if (item.multimedia?.images)
    images = item.multimedia.images
      .map((i) => i.url || i.src || i)
      .filter(Boolean);
  else if (item.images) images = Array.isArray(item.images) ? item.images : [];
  if (!images.length && item.thumbnail) images = [item.thumbnail];

  const f = item.features || {};
  const ci = item.contactInfo || {};

  return {
    idealista_id: String(item.propertyCode || item.adId || item.id),
    title:
      item.title ||
      item.suggestedTexts?.title ||
      `${typeMap[rawType] || "property"} en ${item.address || ""}`,
    description: item.description || "",
    price: item.price || item.priceInfo?.price?.amount || 0,
    price_per_sqm:
      item.priceByArea ||
      (item.price && item.size ? Math.round(item.price / item.size) : null),
    type: typeMap[rawType] || "other",
    operation: (item.operation || "sale").toLowerCase(),
    location: {
      address: item.address || "",
      city: item.municipality || item.location?.city || "",
      district: item.district || item.location?.district || "",
      neighborhood: item.neighborhood || "",
      province: item.province || item.location?.province || "",
      latitude: item.latitude || item.location?.latitude || null,
      longitude: item.longitude || item.location?.longitude || null,
    },
    features: {
      size_sqm: item.size || f.size_sqm || null,
      bedrooms: item.rooms || f.bedrooms || null,
      bathrooms: item.bathrooms || f.bathrooms || null,
      floor: item.floor || f.floor || null,
      has_elevator: item.hasLift ?? f.has_elevator ?? null,
      has_parking: f.hasParking ?? f.has_parking ?? null,
      has_terrace: f.hasTerrace ?? f.has_terrace ?? null,
      has_pool: f.hasSwimmingPool ?? f.has_pool ?? null,
      has_ac: f.hasAirConditioning ?? f.has_ac ?? null,
      has_garden: f.hasGarden ?? f.has_garden ?? null,
      is_exterior: item.exterior ?? f.is_exterior ?? null,
    },
    images,
    url: item.url || "",
    contact: {
      name: ci.contactName || ci.commercialName || "",
      type: "particular",
      phone: ci.phone1?.phoneNumber || ci.phone || "",
    },
    is_particular: true,
    status: "active",
    source: "idealista",
    scraped_at: new Date(),
  };
}

// ── Import Apify dataset ─────────────────────────────────────
async function importDataset(datasetId, loc = null) {
  console.log(`\n📦 Importing dataset: ${datasetId}`);
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=10000`;
  const headers = APIFY_TOKEN ? { Authorization: `Bearer ${APIFY_TOKEN}` } : {};
  const res = await axios.get(url, { headers, timeout: 60000 });
  const items = res.data;
  console.log(`   ✅ Fetched ${items.length} items`);

  const particular = [];
  const agencyIds = [];

  for (const item of items) {
    const ci = item.contactInfo || {};
    const id = String(item.propertyCode || item.adId || item.id || "");
    if (!id) continue;
    if (isExpired(item)) {
      agencyIds.push(id);
      continue;
    }
    if (
      ci.userType !== "private" ||
      ci.micrositeShortName ||
      isAgency(ci.contactName, ci.commercialName)
    ) {
      agencyIds.push(id);
    } else {
      particular.push(item);
    }
  }
  console.log(
    `   🔍 Particular: ${particular.length} | Agency (skip): ${agencyIds.length}`,
  );

  let newCount = 0,
    updatedCount = 0,
    errorCount = 0;
  const seenIds = new Set();

  for (const item of particular) {
    let mapped;
    try {
      mapped = mapItem(item);
      if (!mapped.idealista_id) continue;
      seenIds.add(mapped.idealista_id);
      const before = await Property.findOne({
        idealista_id: mapped.idealista_id,
      }).lean();
      await Property.findOneAndUpdate(
        { idealista_id: mapped.idealista_id },
        { $set: { ...mapped, status: "active" } },
        { upsert: true, new: true, setDefaultsOnInsert: true, strict: false },
      );
      before ? updatedCount++ : newCount++;
    } catch (err) {
      errorCount++;
      if (errorCount <= 3)
        console.error(
          `   ⚠️ Save error (${mapped?.idealista_id}):`,
          err.message,
        );
    }
  }

  let deactivatedCount = 0;
  if (loc && seenIds.size > 0) {
    const cityRegex = new RegExp(loc.name.split(" ")[0], "i");
    const query = {
      status: "active",
      is_particular: true,
      "location.city": cityRegex,
    };
    if (loc.operation && loc.operation !== "rent,sale")
      query.operation = loc.operation;

    if (agencyIds.length > 0) {
      const agencyResult = await Property.updateMany(
        { idealista_id: { $in: agencyIds }, status: "active" },
        { $set: { status: "inactive", is_particular: false } },
      );
      deactivatedCount += agencyResult.modifiedCount;
      if (agencyResult.modifiedCount > 0)
        console.log(
          `   🏢 Agency listings deactivated: ${agencyResult.modifiedCount}`,
        );
    }

    const existingIds = await Property.find(query)
      .select("idealista_id")
      .lean();
    const missingIds = existingIds
      .map((p) => p.idealista_id)
      .filter((id) => !seenIds.has(id));
    if (missingIds.length > 0) {
      const deactResult = await Property.updateMany(
        { idealista_id: { $in: missingIds } },
        { $set: { status: "inactive" } },
      );
      deactivatedCount += deactResult.modifiedCount;
      console.log(
        `   🗑️  Deactivated (not in scrape): ${deactResult.modifiedCount}`,
      );
    }
  }

  const result = {
    datasetId,
    total: items.length,
    particular: particular.length,
    newCount,
    updatedCount,
    errorCount,
    deactivatedCount,
    at: new Date(),
  };
  console.log(
    `   📊 New: ${newCount} | Updated: ${updatedCount} | Removed: ${deactivatedCount} | Errors: ${errorCount}`,
  );
  return result;
}

// ── Trigger Apify actor ──────────────────────────────────────
async function triggerActorRun(location) {
  if (!APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  const input = {
    locationName: location.name,
    country: "es",
    operation: location.operation || "rent",
    maxItems: location.maxItems || 2500,
    userType: "private",
  };
  const res = await axios.post(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
    input,
    {
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    },
  );
  return res.data.data;
}

// ── Wait for run to finish ───────────────────────────────────
async function waitForRun(runId, maxMinutes = 30) {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15000));
    const r = await axios.get(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${runId}`,
      { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } },
    );
    const s = r.data.data.status;
    if (s === "SUCCEEDED") return r.data.data;
    if (s === "FAILED" || s === "ABORTED") throw new Error(`Run ${runId} ${s}`);
  }
  throw new Error(`Run ${runId} timed out after ${maxMinutes}min`);
}

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

  const BATCH_SIZE = 8;
  try {
    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
      const batch = locations.slice(i, i + BATCH_SIZE);
      console.log(
        `\n🚀 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map((l) => l.name).join(", ")}`,
      );
      const batchResults = await Promise.all(
        batch.map(async (loc) => {
          try {
            const actorRun = await triggerActorRun(loc);
            const finishedRun = await waitForRun(actorRun.id);
            const importResult = await importDataset(
              finishedRun.defaultDatasetId,
              loc,
            );
            return { location: loc.name, ...importResult };
          } catch (err) {
            console.error(`   ❌ ${loc.name} failed:`, err.message);
            return { location: loc.name, error: err.message };
          }
        }),
      );
      run.results.push(...batchResults);
    }
    run.status = "completed";
    run.finishedAt = new Date();
    state.lastRun = run;
    console.log("\n✅ Scrape cycle complete");

    if (state.autoLoopActive) {
      const total = await Property.countDocuments({
        status: "active",
        is_particular: true,
      });
      console.log(`\n🔄 Auto-loop check: ${total}/10000`);
      if (total < 10000) {
        console.log(`⏳ Under 10k — scheduling next bigrun in 2 minutes...`);
        setTimeout(
          async () => {
            try {
              await runScrapeImport(BIG_SCRAPE_LOCATIONS);
            } catch (err) {
              console.error("Auto-loop bigrun failed:", err.message);
              state.autoLoopActive = false;
            }
          },
          2 * 60 * 1000,
        );
      } else {
        console.log(
          `✅ Target reached! ${total} particulares. Auto-loop stopped.`,
        );
        state.autoLoopActive = false;
      }
    }
  } finally {
    state.running = false;
  }
  return run;
}

// ── Cleanup ──────────────────────────────────────────────────
async function runCleanup() {
  console.log("\n🧹 Running agency cleanup...");
  const active = await Property.find({ status: "active" })
    .select("_id contact")
    .lean();
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
  console.log(`   🏢 Agency listings removed: ${agencyFound}`);
  return result;
}

// ── Location configs ─────────────────────────────────────────
const DAILY_LOCATIONS = [
  { name: "malaga", operation: "rent", maxItems: 2500 },
  { name: "madrid", operation: "rent", maxItems: 2500 },
  { name: "benalmadena", operation: "rent", maxItems: 2500 },
  { name: "fuengirola", operation: "rent", maxItems: 2500 },
  { name: "higueron fuengirola", operation: "rent", maxItems: 1500 },
  { name: "marbella", operation: "rent", maxItems: 1500 },
  { name: "torremolinos", operation: "rent", maxItems: 1500 },
  { name: "malaga", operation: "sale", maxItems: 1000 },
  { name: "madrid", operation: "sale", maxItems: 1000 },
];

const BIG_SCRAPE_LOCATIONS = [
  // ── Málaga ciudad ──────────────────────────────────────────
  { name: "malaga", operation: "rent", maxItems: 2500 },
  { name: "malaga", operation: "sale", maxItems: 2500 },
  { name: "malaga este", operation: "rent", maxItems: 1500 },
  { name: "malaga este", operation: "sale", maxItems: 1500 },
  { name: "pedregalejo malaga", operation: "rent", maxItems: 1500 },
  { name: "pedregalejo malaga", operation: "sale", maxItems: 1500 },
  { name: "teatinos malaga", operation: "rent", maxItems: 1500 },
  { name: "teatinos malaga", operation: "sale", maxItems: 1500 },
  { name: "churriana malaga", operation: "rent", maxItems: 1000 },
  { name: "campanillas malaga", operation: "rent", maxItems: 1000 },

  // ── Costa del Sol ──────────────────────────────────────────
  { name: "torremolinos", operation: "rent", maxItems: 2500 },
  { name: "torremolinos", operation: "sale", maxItems: 1500 },
  { name: "benalmadena", operation: "rent", maxItems: 2500 },
  { name: "benalmadena costa", operation: "rent", maxItems: 2500 },
  { name: "arroyo de la miel", operation: "rent", maxItems: 1500 },
  { name: "benalmadena", operation: "sale", maxItems: 1500 },
  { name: "fuengirola", operation: "rent", maxItems: 2500 },
  { name: "los boliches", operation: "rent", maxItems: 2500 },
  { name: "fuengirola", operation: "sale", maxItems: 1500 },
  { name: "mijas costa", operation: "rent", maxItems: 2500 },
  { name: "mijas costa", operation: "sale", maxItems: 1500 },
  { name: "mijas", operation: "rent", maxItems: 2500 },
  { name: "mijas", operation: "sale", maxItems: 1500 },
  { name: "higueron fuengirola", operation: "rent", maxItems: 2500 },
  { name: "higueron fuengirola", operation: "sale", maxItems: 2000 },

  // ── Marbella / Estepona ────────────────────────────────────
  { name: "marbella", operation: "rent", maxItems: 2500 },
  { name: "marbella", operation: "sale", maxItems: 2500 },
  { name: "nueva andalucia marbella", operation: "rent", maxItems: 1500 },
  { name: "nueva andalucia marbella", operation: "sale", maxItems: 1500 },
  { name: "san pedro de alcantara", operation: "rent", maxItems: 1500 },
  { name: "san pedro de alcantara", operation: "sale", maxItems: 1500 },
  { name: "estepona", operation: "rent", maxItems: 2500 },
  { name: "estepona", operation: "sale", maxItems: 1500 },

  // ── Axarquía ──────────────────────────────────────────────
  { name: "nerja", operation: "rent", maxItems: 2000 },
  { name: "nerja", operation: "sale", maxItems: 1500 },
  { name: "torre del mar", operation: "rent", maxItems: 1500 },
  { name: "torre del mar", operation: "sale", maxItems: 1000 },
  { name: "velez malaga", operation: "rent", maxItems: 1500 },
  { name: "rincon de la victoria", operation: "rent", maxItems: 1500 },

  // ── Interior Málaga ───────────────────────────────────────
  { name: "alhaurin de la torre", operation: "rent", maxItems: 1500 },
  { name: "alhaurin de la torre", operation: "sale", maxItems: 1000 },
  { name: "alhaurin el grande", operation: "rent", maxItems: 1000 },
  { name: "alhaurin el grande", operation: "sale", maxItems: 1000 },
  { name: "coin malaga", operation: "rent", maxItems: 1000 },
  { name: "antequera", operation: "rent", maxItems: 1000 },
  { name: "ronda malaga", operation: "rent", maxItems: 1000 },

  // ── Madrid ciudad ─────────────────────────────────────────
  { name: "madrid", operation: "rent", maxItems: 2500 },
  { name: "madrid", operation: "sale", maxItems: 2500 },

  // ── Madrid barrios ────────────────────────────────────────
  { name: "chamberi madrid", operation: "rent", maxItems: 2500 },
  { name: "chamberi madrid", operation: "sale", maxItems: 1500 },
  { name: "salamanca madrid", operation: "rent", maxItems: 2500 },
  { name: "salamanca madrid", operation: "sale", maxItems: 1500 },
  { name: "retiro madrid", operation: "rent", maxItems: 2500 },
  { name: "retiro madrid", operation: "sale", maxItems: 1500 },
  { name: "centro madrid", operation: "rent", maxItems: 2500 },
  { name: "centro madrid", operation: "sale", maxItems: 1500 },
  { name: "latina madrid", operation: "rent", maxItems: 2000 },
  { name: "latina madrid", operation: "sale", maxItems: 1000 },
  { name: "carabanchel madrid", operation: "rent", maxItems: 2000 },
  { name: "carabanchel madrid", operation: "sale", maxItems: 1000 },
  { name: "vallecas madrid", operation: "rent", maxItems: 2000 },
  { name: "tetuan madrid", operation: "rent", maxItems: 2000 },
  { name: "tetuan madrid", operation: "sale", maxItems: 1000 },
  { name: "hortaleza madrid", operation: "rent", maxItems: 1500 },
  { name: "fuencarral madrid", operation: "rent", maxItems: 1500 },
  { name: "ciudad lineal madrid", operation: "rent", maxItems: 1500 },
  { name: "moncloa madrid", operation: "rent", maxItems: 1500 },
  { name: "arganzuela madrid", operation: "rent", maxItems: 1500 },
  { name: "puente de vallecas", operation: "rent", maxItems: 1500 },
  { name: "san blas madrid", operation: "rent", maxItems: 1000 },
  { name: "usera madrid", operation: "rent", maxItems: 1000 },
  { name: "villaverde madrid", operation: "rent", maxItems: 1000 },
  { name: "moratalaz madrid", operation: "rent", maxItems: 1000 },

  // ── Madrid municipios ─────────────────────────────────────
  { name: "getafe", operation: "rent", maxItems: 1500 },
  { name: "alcala de henares", operation: "rent", maxItems: 1500 },
  { name: "leganes", operation: "rent", maxItems: 1000 },
  { name: "mostoles", operation: "rent", maxItems: 1000 },
  { name: "alcorcon", operation: "rent", maxItems: 1500 },
  { name: "fuenlabrada", operation: "rent", maxItems: 1500 },
  { name: "parla", operation: "rent", maxItems: 1000 },
  { name: "torrejon de ardoz", operation: "rent", maxItems: 1500 },
  { name: "pozuelo de alarcon", operation: "rent", maxItems: 1500 },
  { name: "pozuelo de alarcon", operation: "sale", maxItems: 1000 },
  { name: "majadahonda", operation: "rent", maxItems: 1500 },
  { name: "majadahonda", operation: "sale", maxItems: 1000 },
  { name: "las rozas madrid", operation: "rent", maxItems: 1500 },
  { name: "collado villalba", operation: "rent", maxItems: 1000 },
  { name: "boadilla del monte", operation: "rent", maxItems: 1000 },
];

// ── Scheduler ────────────────────────────────────────────────
function startScheduler() {
  if (state.schedulerActive) return;
  state.schedulerActive = true;
  const intervalMs = INTERVAL_HOURS * 60 * 60 * 1000;
  console.log(`⏰ Scraper scheduled every ${INTERVAL_HOURS}h`);
  const tick = async () => {
    console.log("\n⏰ Scheduled daily scrape starting...");
    try {
      await runScrapeImport(DAILY_LOCATIONS);
      await runCleanup(30);
    } catch (err) {
      console.error("Scheduled scrape failed:", err.message);
    }
  };
  if (process.env.SCRAPE_ON_START === "true") setTimeout(tick, 5000);
  setInterval(tick, intervalMs);
}

if (APIFY_TOKEN) startScheduler();

// ── Routes ────────────────────────────────────────────────────
router.get("/status", async (req, res) => {
  try {
    const total = await Property.countDocuments({
      status: "active",
      is_particular: true,
    });
    const madrid = await Property.countDocuments({
      status: "active",
      is_particular: true,
      "location.city": /madrid/i,
    });
    const malaga = await Property.countDocuments({
      status: "active",
      is_particular: true,
      "location.city": /m.laga/i,
    });
    const rent = await Property.countDocuments({
      status: "active",
      is_particular: true,
      operation: "rent",
    });
    const sale = await Property.countDocuments({
      status: "active",
      is_particular: true,
      operation: "sale",
    });
    const latest = await Property.findOne({}, {}, { sort: { scraped_at: -1 } })
      .select("scraped_at")
      .lean();
    res.json({
      running: state.running,
      schedulerActive: state.schedulerActive,
      autoLoopActive: state.autoLoopActive,
      intervalHours: INTERVAL_HOURS,
      lastRun: state.lastRun,
      lastCleanup: state.lastCleanup,
      apifyConfigured: !!APIFY_TOKEN,
      counts: { total, madrid, malaga, rent, sale },
      target: { total: 10000, remaining: Math.max(0, 10000 - total) },
      lastScrapeDate: latest?.scraped_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/runs", (req, res) => res.json(state.runs));

router.post("/run", async (req, res) => {
  try {
    if (!APIFY_TOKEN)
      return res.status(400).json({ error: "APIFY_TOKEN not configured" });
    if (state.running)
      return res.status(409).json({ error: "Already running" });
    const locations = req.body.locations || DAILY_LOCATIONS;
    runScrapeImport(locations).catch((err) =>
      console.error("Manual run failed:", err.message),
    );
    res.json({
      message: "Daily scrape started",
      locations: locations.map((l) => l.name),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/bigrun", async (req, res) => {
  try {
    if (!APIFY_TOKEN)
      return res.status(400).json({ error: "APIFY_TOKEN not configured" });
    if (state.running)
      return res.status(409).json({ error: "Already running" });
    runScrapeImport(BIG_SCRAPE_LOCATIONS).catch((err) => {
      console.error("Big run failed:", err.message);
      state.autoLoopActive = false;
    });
    state.autoLoopActive = true;
    res.json({
      message: "Big scrape started — this will take ~60-90 minutes",
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
    state.lastImport = result;
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

// Export helper for index.js auto-resume on startup
router.startAutoLoop = () => {
  if (!state.autoLoopActive && !state.running) {
    state.autoLoopActive = true;
    runScrapeImport(BIG_SCRAPE_LOCATIONS).catch((err) => {
      console.error("Auto-resume bigrun failed:", err.message);
      state.autoLoopActive = false;
    });
  }
};

module.exports = router;
