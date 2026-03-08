/**
 * Shared Apify client — used by scraper routes + daily maintenance
 */

const axios = require("axios");
const Property = require("../models/property.model");
const { isAgency, isExpired } = require("../utils/agency-detector");

const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const ACTOR_ID = "REcGj6dyoIJ9Z7aE6";

// ── Province detection from coordinates ──────────────────────
function detectProvince(lat, lon) {
  if (!lat || !lon) return null;
  if (lat >= 36.2 && lat <= 37.3 && lon >= -5.6 && lon <= -3.8) return "Málaga";
  if (lat >= 39.8 && lat <= 41.2 && lon >= -4.6 && lon <= -3.0) return "Madrid";
  if (lat >= 36.7 && lat <= 38.0 && lon >= -4.1 && lon <= -2.5) return "Granada";
  if (lat >= 35.9 && lat <= 36.8 && lon >= -5.9 && lon <= -5.0) return "Cádiz";
  return null;
}

// ── Map Apify item → Property schema ────────────────────────
const TYPE_MAP = {
  flat: "apartment", apartment: "apartment", piso: "apartment",
  house: "house", casa: "house", chalet: "house",
  villa: "villa", penthouse: "penthouse", atico: "penthouse", "ático": "penthouse",
  studio: "studio", estudio: "studio", duplex: "duplex", "dúplex": "duplex",
  loft: "loft", land: "land", terreno: "land",
  commercial: "commercial", oficina: "commercial", local: "commercial",
};

function mapItem(item) {
  const rawType = (item.propertyType || item.typology || "").toLowerCase();

  let images = [];
  if (item.multimedia?.images)
    images = item.multimedia.images.map((i) => i.url || i.src || i).filter(Boolean);
  else if (item.images) images = Array.isArray(item.images) ? item.images : [];
  if (!images.length && item.thumbnail) images = [item.thumbnail];

  const f = item.features || {};
  const ci = item.contactInfo || {};

  return {
    idealista_id: String(item.propertyCode || item.adId || item.id).replace(/^idealista_/, ""),
    title:
      item.title ||
      item.suggestedTexts?.title ||
      `${TYPE_MAP[rawType] || "property"} en ${item.address || ""}`,
    description: item.description || "",
    price: item.price || item.priceInfo?.price?.amount || 0,
    price_per_sqm:
      item.priceByArea ||
      (item.price && item.size ? Math.round(item.price / item.size) : null),
    type: TYPE_MAP[rawType] || "other",
    operation: (item.operation || "sale").toLowerCase(),
    location: (() => {
      const lat = item.latitude || item.location?.latitude || null;
      const lon = item.longitude || item.location?.longitude || null;
      const province =
        item.province || item.location?.province || detectProvince(lat, lon) || "";
      return {
        address: item.address || "",
        city: item.municipality || item.location?.city || "",
        district: item.district || item.location?.district || "",
        neighborhood: item.neighborhood || "",
        province,
        latitude: lat,
        longitude: lon,
      };
    })(),
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

// ── Trigger Apify actor ──────────────────────────────────────
async function triggerActorRun(location) {
  if (!APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  const input = location.startUrl
    ? {
        startUrls: [{ url: location.startUrl }],
        maxItems: location.maxItems || 200,
        userType: "private",
      }
    : {
        locationName: location.name,
        country: "es",
        operation: location.operation || "rent",
        maxItems: location.maxItems || 200,
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
async function waitForRun(runId, maxMinutes = 10) {
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

// ── Import Apify dataset ─────────────────────────────────────
async function importDataset(datasetId, loc = null) {
  console.log(`  Importing dataset: ${datasetId}`);
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=10000`;
  const headers = APIFY_TOKEN ? { Authorization: `Bearer ${APIFY_TOKEN}` } : {};
  const res = await axios.get(url, { headers, timeout: 60000 });
  const items = res.data;
  console.log(`  Fetched ${items.length} items`);

  const particular = [];
  const agencyIds = [];

  for (const item of items) {
    const ci = item.contactInfo || {};
    const id = String(item.propertyCode || item.adId || item.id || "");
    if (!id) continue;
    if (isExpired(item)) { agencyIds.push(id); continue; }
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
  console.log(`  Particular: ${particular.length} | Agency (skip): ${agencyIds.length}`);

  let newCount = 0, updatedCount = 0, errorCount = 0;
  const seenIds = new Set();

  for (const item of particular) {
    let mapped;
    try {
      mapped = mapItem(item);
      if (!mapped.idealista_id) continue;
      seenIds.add(mapped.idealista_id);
      const before = await Property.findOne({ idealista_id: mapped.idealista_id }).lean();
      await Property.findOneAndUpdate(
        { idealista_id: mapped.idealista_id },
        { $set: { ...mapped, status: "active" } },
        { upsert: true, new: true, setDefaultsOnInsert: true, strict: false },
      );
      before ? updatedCount++ : newCount++;
    } catch (err) {
      errorCount++;
      if (errorCount <= 3) console.error(`  Save error (${mapped?.idealista_id}):`, err.message);
    }
  }

  // Note: We no longer deactivate agencies during import.
  // Agency detection is handled by Phase 1 of daily maintenance instead.
  // This prevents accidental deactivation when re-importing old datasets.

  const result = {
    datasetId, total: items.length, particular: particular.length,
    newCount, updatedCount, errorCount, at: new Date(),
  };
  console.log(`  New: ${newCount} | Updated: ${updatedCount} | Errors: ${errorCount}`);
  return result;
}

// ── Check Apify credits ──────────────────────────────────────
async function checkApifyCredits() {
  if (!APIFY_TOKEN) return { limit: 0, used: 0, remaining: 0, locked: true };
  try {
    const res = await axios.get("https://api.apify.com/v2/users/me", {
      headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
      timeout: 10000,
    });
    const data = res.data?.data;
    const limit = data?.plan?.maxMonthlyUsageUsd || 85;
    // Check if features are disabled (account locked)
    const locked = data?.effectivePlatformFeatures?.ACTORS?.isEnabled === false;
    return { limit, locked, plan: data?.plan?.id };
  } catch (e) {
    console.error("Credit check failed:", e.message);
    return { limit: 0, used: 0, remaining: 0, locked: true };
  }
}

module.exports = {
  APIFY_TOKEN,
  ACTOR_ID,
  mapItem,
  triggerActorRun,
  waitForRun,
  importDataset,
  checkApifyCredits,
};
