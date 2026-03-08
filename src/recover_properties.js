// ══════════════════════════════════════════════════════════════
// recover_properties.js — Recover deleted properties from Apify datasets
// Run from: /Users/sam/Desktop/grupo-ideal-home/backend
// node src/recover_properties.js
// ══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const APIFY_TOKEN = process.env.APIFY_TOKEN;

// All datasets from today's Apify runs (actor REcGj6dyoIJ9Z7aE6)
const DATASET_IDS = [
  // New batch (not yet imported)
  "aXb9qr1SKenMx9G2a",
  "GbRHtNHOkkaoSgIiA",
  "I49tQzNavxlOLJzvI",
  "rVOTTkn8QXe4hgRwf",
  "wK2KDTpw9hd14TdSq",
  "8zWZrDwXdZVqfUVnl",
  "Ozr4PoKUzEtbs7fSh",
  "r0zeZPU7he3eBDj6D",
  "fHtff5Fl2lq3Race2",
  "M7Moq0gudxf9POTgB",
  // Previously imported (will deduplicate)
  "GDUIBv6SlS63EBCxW",
  "kPgAxj9KDphcordog",
  "az9qck2Ei3EEbO5Jf",
  "n9v5Btpd51STwkFB6",
  "FsLybjbmri4tLnhKa",
  "zHKMGPyCwPxeW3Nqx",
  "hckkeJLuraYzJaipM",
  "PbHQDn5j7PQYDNiSX",
  "ahdnAj9Cz7G6vgOcA",
];

// ── Property type mapping ──
const PROPERTY_TYPE_MAP = {
  flat: "apartment",
  apartment: "apartment",
  piso: "apartment",
  house: "house",
  chalet: "house",
  casa: "house",
  villa: "villa",
  studio: "studio",
  estudio: "studio",
  penthouse: "penthouse",
  atico: "penthouse",
  "ático": "penthouse",
  duplex: "apartment",
  "dúplex": "apartment",
  loft: "studio",
  land: "land",
  terreno: "land",
  premises: "commercial",
  local: "commercial",
  office: "commercial",
  oficina: "commercial",
  garage: "commercial",
  garaje: "commercial",
};

const CONDITION_MAP = {
  newdevelopment: "new",
  good: "good",
  renew: "needs_renovation",
  refurbished: "renovated",
  new: "new",
  "a reformar": "needs_renovation",
  "buen estado": "good",
  "a estrenar": "new",
  reformado: "renovated",
};

// ── Mapping helpers (from idealista.service.js) ──

function extractExternalId(item) {
  if (item.id || item.propertyCode) return String(item.id || item.propertyCode);
  const url = item.url || item.Url || item.detailUrl || "";
  const match = url.match(/\/inmueble\/(\d+)|\/immobile\/(\d+)|\/(\d+)\/?$/);
  if (match) return match[1] || match[2] || match[3];
  const thumbnail = item.thumbnail || item.MainImage || "";
  const thumbMatch = thumbnail.match(/\/(\d{6,})\./);
  if (thumbMatch) return thumbMatch[1];
  return null;
}

function extractPrice(item) {
  if (typeof item.price === "number") return item.price;
  if (typeof item.price === "string") {
    const cleaned = item.price.replace(/[^0-9.,]/g, "").replace(/\./g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  if (item.priceInfo?.price?.amount) return item.priceInfo.price.amount;
  return null;
}

function extractFloor(item) {
  if (item.floor != null) {
    const f = String(item.floor).toLowerCase();
    if (f === "bj" || f === "bajo" || f === "ground") return 0;
    const num = parseInt(f);
    return isNaN(num) ? null : num;
  }
  return null;
}

function hasFeature(item, keywords) {
  const parts = [
    item.description || "",
    item.comment || "",
  ];
  if (Array.isArray(item.characteristics)) parts.push(...item.characteristics);
  if (Array.isArray(item.features)) parts.push(...item.features);
  else if (item.features && typeof item.features === "object") parts.push(JSON.stringify(item.features));
  if (Array.isArray(item.amenities)) parts.push(...item.amenities);
  const searchIn = parts.join(" ").toLowerCase();
  return keywords.some((kw) => searchIn.includes(kw.toLowerCase())) || false;
}

function guessPropertyType(item) {
  const text = [
    item.title || "",
    item.description || "",
    ...(item.characteristics || []),
  ].join(" ").toLowerCase();
  if (text.includes("ático") || text.includes("penthouse") || text.includes("atico")) return "penthouse";
  if (text.includes("villa")) return "villa";
  if (text.includes("chalet") || text.includes("casa")) return "house";
  if (text.includes("estudio") || text.includes("studio") || text.includes("loft")) return "studio";
  if (text.includes("local") || text.includes("oficina") || text.includes("office")) return "commercial";
  if (text.includes("terreno") || text.includes("land") || text.includes("parcela")) return "land";
  return "apartment";
}

function extractImages(item) {
  if (item.images && Array.isArray(item.images)) {
    return item.images
      .map((img) => (typeof img === "string" ? img : img.url || img.src || img.originalUrl || null))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (item.multimedia?.images) {
    return item.multimedia.images.map((img) => img.url || img.src).filter(Boolean).slice(0, 20);
  }
  if (item.MainImage || item.thumbnail) {
    return [item.MainImage || item.thumbnail];
  }
  return [];
}

function extractCondition(item) {
  const raw = (item.status || item.condition || "").toLowerCase();
  if (CONDITION_MAP[raw]) return CONDITION_MAP[raw];
  const text = [item.description || "", ...(item.characteristics || [])].join(" ").toLowerCase();
  if (text.includes("obra nueva") || text.includes("a estrenar") || text.includes("new build")) return "new";
  if (text.includes("reformado") || text.includes("refurbished") || text.includes("renovated")) return "renovated";
  if (text.includes("a reformar") || text.includes("to refurbish") || text.includes("to renovate")) return "needs_renovation";
  if (text.includes("buen estado") || text.includes("good condition")) return "good";
  return null;
}

function mapToProperty(item) {
  const externalId = extractExternalId(item);
  if (!externalId) return null;

  const rawType = (item.propertyType || item.typology || item.type || "").toLowerCase();
  const type = PROPERTY_TYPE_MAP[rawType] || guessPropertyType(item);

  const operation = item.operation === "rent" || item.operation === "alquiler" ? "rent" : "sale";

  const price = extractPrice(item);
  if (!price) return null;

  const title =
    item.title ||
    `${type === "apartment" ? "Piso" : "Propiedad"} en ${item.address || item.neighborhood || "España"}`;

  const sizeSqm = item.size || item.constructedArea || item.propertySpecs?.constructedArea || null;
  const pricePerSqm = price && sizeSqm ? Math.round(price / sizeSqm) : null;

  const images = extractImages(item);

  return {
    idealista_id: `idealista_${externalId}`,
    source: "idealista",
    title,
    description: item.description || item.comment || null,
    type: type || "apartment",
    operation,
    price,
    price_per_sqm: pricePerSqm,
    location: {
      address: item.address || item.street || null,
      city: item.municipality || item.city || null,
      district: item.district || item.neighborhood || null,
      neighborhood: item.neighborhood || item.subNeighborhood || null,
      province: item.province || null,
      latitude: item.latitude || item.coordinates?.lat || null,
      longitude: item.longitude || item.coordinates?.lng || null,
    },
    features: {
      size_sqm: sizeSqm,
      bedrooms: item.rooms || item.bedrooms || item.propertySpecs?.rooms || null,
      bathrooms: item.bathrooms || item.propertySpecs?.bathrooms || null,
      floor: extractFloor(item),
      has_elevator: hasFeature(item, ["elevator", "ascensor", "lift"]),
      has_parking: hasFeature(item, ["parking", "garaje", "garage"]),
      has_terrace: hasFeature(item, ["terrace", "terraza", "balcony", "balcón"]),
      has_pool: hasFeature(item, ["pool", "piscina", "swimming"]),
      has_garden: hasFeature(item, ["garden", "jardín", "jardin"]),
      has_ac: hasFeature(item, ["air conditioning", "aire acondicionado", "a/c", "clima"]),
    },
    images,
    url: item.url || item.Url || item.detailUrl || null,
    contact: {
      name: item.contactName || null,
      type: item.isParticular || item.contactType === "particular" ? "particular" : "agency",
      phone: item.phone || item.contactPhone || null,
    },
    is_particular: item.isParticular ?? true,
    status: "active",
    scraped_at: new Date(),
  };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  const Property = mongoose.model(
    "Property",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  const beforeCount = await Property.countDocuments();
  console.log(`📊 DB before recovery: ${beforeCount} properties\n`);

  let totalDownloaded = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const seenIds = new Set();

  for (const datasetId of DATASET_IDS) {
    console.log(`\n═══ Downloading dataset: ${datasetId} ═══`);

    try {
      const res = await axios.get(
        `https://api.apify.com/v2/datasets/${datasetId}/items`,
        {
          params: { token: APIFY_TOKEN, format: "json" },
          timeout: 30000,
        },
      );

      const items = res.data;
      console.log(`  Downloaded ${items.length} items`);
      totalDownloaded += items.length;

      for (const item of items) {
        const mapped = mapToProperty(item);
        if (!mapped) {
          totalSkipped++;
          continue;
        }

        // Deduplicate across datasets
        if (seenIds.has(mapped.idealista_id)) {
          continue;
        }
        seenIds.add(mapped.idealista_id);

        try {
          const result = await Property.updateOne(
            { idealista_id: mapped.idealista_id },
            {
              $set: mapped,
              $setOnInsert: { createdAt: new Date() },
            },
            { upsert: true },
          );

          if (result.upsertedCount > 0) {
            totalInserted++;
          } else if (result.modifiedCount > 0) {
            totalUpdated++;
          }
        } catch (e) {
          totalErrors++;
          if (totalErrors <= 5) {
            console.error(`  ⚠️ Error upserting ${mapped.idealista_id}: ${e.message}`);
          }
        }
      }

      console.log(`  ✅ Processed. Running totals — inserted: ${totalInserted}, updated: ${totalUpdated}`);
    } catch (e) {
      console.error(`  ❌ Failed to download dataset ${datasetId}: ${e.message}`);
    }
  }

  const afterCount = await Property.countDocuments();
  const activeCount = await Property.countDocuments({ status: "active" });

  console.log(`\n══════════════════════════════════════════`);
  console.log(`📊 Recovery Complete:`);
  console.log(`  Downloaded: ${totalDownloaded} items from ${DATASET_IDS.length} datasets`);
  console.log(`  Unique properties: ${seenIds.size}`);
  console.log(`  Inserted: ${totalInserted}`);
  console.log(`  Updated: ${totalUpdated}`);
  console.log(`  Skipped (no ID/price): ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  DB total: ${afterCount} (was ${beforeCount})`);
  console.log(`  Active: ${activeCount}`);
  console.log(`══════════════════════════════════════════`);

  await mongoose.disconnect();
  console.log("\n✅ Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
