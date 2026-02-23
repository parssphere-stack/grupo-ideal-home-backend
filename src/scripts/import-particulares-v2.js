/**
 * Import Apify Dataset into MongoDB — PARTICULARES ONLY v2
 *
 * Supports BOTH actor formats:
 *   - igolaizola/idealista-scraper
 *   - dz_omar/idealista-scraper
 *
 * DOUBLE FILTER:
 *   1. contactInfo.userType === "private" (unknown = excluded now)
 *   2. Keyword blacklist on contact name / commercial name
 *
 * Usage: node src/scripts/import-particulares-v2.js [dataset-id]
 */

require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/grupo-ideal-home";
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const DEFAULT_DATASET = process.env.APIFY_DATASET_ID || "";

// ═══════════════════════════════════════
// AGENCY KEYWORD BLACKLIST
// Agar contact name-e listing shaamel ye keyword az in list bood → hazf
// ═══════════════════════════════════════
const AGENCY_KEYWORDS = [
  // Generic real estate terms
  "inmobiliaria",
  "inmobiliario",
  "agencia",
  "agente",
  "agency",
  "real estate",
  "realestate",
  "realty",
  "properties",
  "property",
  // Common suffixes/prefixes
  "grupo",
  "group",
  "gestión",
  "gestion",
  "servicios",
  "services",
  "soluciones",
  "solutions",
  "inversiones",
  "inversión",
  "inversion",
  "consultores",
  "consultoría",
  "consultoria",
  "asociados",
  "partners",
  // Common agency name patterns
  "activa casa",
  "activacasa",
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
  "api ",
  " api",
  "finques",
  "fincas",
  "promot",
  // Corporate indicators
  "s.l.",
  "s.l ",
  " sl ",
  " s.a.",
  " sa ",
  "s.a ",
  "s.l.u",
  "slu",
  "sociedad",
  "limitada",
  // Home/casa agency names
  "casas",
  "pisos",
  "villas",
  "chalets",
  "homes",
  "living",
  "habitat",
  "habitación",
  // Other indicators
  "asesor",
  "broker",
  "promotor",
  "promotora",
  "desarrollo",
  "desarrollos",
  "construcciones",
  "construye",
];

function isAgencyByKeyword(contactName = "", commercialName = "") {
  const combined = `${contactName} ${commercialName}`.toLowerCase().trim();
  if (!combined) return false;
  return AGENCY_KEYWORDS.some((kw) => combined.includes(kw.toLowerCase()));
}

// ═══════════════════════════════════════
// PROPERTY SCHEMA
// ═══════════════════════════════════════
const propertySchema = new mongoose.Schema(
  {
    idealista_id: { type: String, unique: true, required: true },
    title: String,
    description: String,
    price: Number,
    price_per_sqm: Number,
    type: {
      type: String,
      enum: [
        "apartment",
        "house",
        "villa",
        "penthouse",
        "studio",
        "duplex",
        "loft",
        "land",
        "commercial",
        "other",
      ],
    },
    operation: { type: String, enum: ["sale", "rent"] },
    location: {
      address: String,
      city: String,
      district: String,
      neighborhood: String,
      province: String,
      latitude: Number,
      longitude: Number,
    },
    features: {
      size_sqm: Number,
      bedrooms: Number,
      bathrooms: Number,
      floor: String,
      has_elevator: Boolean,
      has_parking: Boolean,
      has_terrace: Boolean,
      has_pool: Boolean,
      has_ac: Boolean,
      has_garden: Boolean,
      is_exterior: Boolean,
    },
    images: [String],
    url: String,
    contact: {
      name: String,
      type: { type: String, enum: ["particular", "agency"] },
      phone: String,
    },
    is_particular: { type: Boolean, default: true },
    status: { type: String, default: "active" },
    source: { type: String, default: "idealista" },
    scraped_at: Date,
  },
  { timestamps: true },
);

const Property = mongoose.model("Property", propertySchema);

// ═══════════════════════════════════════
// DATA MAPPING
// ═══════════════════════════════════════
function mapProperty(item) {
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
  const mappedType = typeMap[rawType] || "other";

  let images = [];
  if (item.multimedia?.images) {
    images = item.multimedia.images
      .map((img) => img.url || img.src || img)
      .filter(Boolean);
  } else if (item.images) {
    images = Array.isArray(item.images) ? item.images : [];
  }
  if (images.length === 0 && item.thumbnail) images = [item.thumbnail];

  const features = item.features || {};
  const hasFeature = (key) => {
    if (features[key] !== undefined) return features[key];
    if (item[key] !== undefined) return item[key];
    return undefined;
  };

  const ci = item.contactInfo || {};

  return {
    idealista_id: String(
      item.propertyCode ||
        item.adId ||
        item.id ||
        `idealista-${Date.now()}-${Math.random()}`,
    ),
    title:
      item.title ||
      item.suggestedTexts?.title ||
      `${mappedType} en ${item.address || item.municipality || ""}`,
    description: item.description || "",
    price: item.price || item.priceInfo?.price?.amount || 0,
    price_per_sqm:
      item.priceByArea ||
      (item.price && item.size ? Math.round(item.price / item.size) : null),
    type: mappedType,
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
      size_sqm: item.size || features.size_sqm || null,
      bedrooms: item.rooms || features.bedrooms || null,
      bathrooms: item.bathrooms || features.bathrooms || null,
      floor: item.floor || features.floor || null,
      has_elevator: item.hasLift ?? hasFeature("has_elevator") ?? null,
      has_parking:
        hasFeature("hasParking") ?? hasFeature("has_parking") ?? null,
      has_terrace:
        hasFeature("hasTerrace") ?? hasFeature("has_terrace") ?? null,
      has_pool: hasFeature("hasSwimmingPool") ?? hasFeature("has_pool") ?? null,
      has_ac: hasFeature("hasAirConditioning") ?? hasFeature("has_ac") ?? null,
      has_garden: hasFeature("hasGarden") ?? hasFeature("has_garden") ?? null,
      is_exterior: item.exterior ?? hasFeature("is_exterior") ?? null,
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

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
async function main() {
  const datasetId = process.argv[2] || DEFAULT_DATASET;

  if (!datasetId) {
    console.error("❌ No dataset ID provided!");
    console.error("Usage: node import-particulares-v2.js <dataset-id>");
    process.exit(1);
  }

  console.log("\n🏠 Grupo Ideal Home — Particular Import v2 (Double Filter)");
  console.log("═".repeat(55));
  console.log(`📦 Dataset: ${datasetId}`);

  // 1. Fetch from Apify
  console.log("\n📥 Fetching data from Apify...");
  let items;
  try {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=10000`;
    const headers = APIFY_TOKEN
      ? { Authorization: `Bearer ${APIFY_TOKEN}` }
      : {};
    const res = await axios.get(url, { headers });
    items = res.data;
    console.log(`   ✅ Fetched ${items.length} items`);
  } catch (err) {
    console.error(`   ❌ Failed to fetch: ${err.message}`);
    process.exit(1);
  }

  // 2. DOUBLE FILTER
  console.log("\n🔍 Applying double filter...");

  let passedUserType = 0;
  let failedUserType = 0;
  let failedKeyword = 0;
  let unknownExcluded = 0;
  const filteredItems = [];
  const keywordRejected = [];

  items.forEach((item) => {
    const ci = item.contactInfo || {};
    const userType = ci.userType || "unknown";
    const contactName = ci.contactName || "";
    const commercialName = ci.commercialName || "";

    // FILTER 1: userType — faghat "private" — unknown ham hazf
    if (userType !== "private") {
      if (userType === "unknown" || userType === "") {
        unknownExcluded++;
      } else {
        failedUserType++;
      }
      return;
    }

    passedUserType++;

    // FILTER 2: Keyword blacklist
    if (isAgencyByKeyword(contactName, commercialName)) {
      failedKeyword++;
      keywordRejected.push({
        contactName,
        commercialName,
        id: item.propertyCode || item.adId,
      });
      return;
    }

    filteredItems.push(item);
  });

  console.log(`\n📊 Filter Results:`);
  console.log(`   ✅ Passed userType=private:      ${passedUserType}`);
  console.log(`   ❌ Rejected (professional):       ${failedUserType}`);
  console.log(`   ❓ Rejected (unknown/empty):      ${unknownExcluded}`);
  console.log(`   🔑 Rejected (keyword blacklist):  ${failedKeyword}`);
  console.log(`   📦 Final particular listings:     ${filteredItems.length}`);

  if (keywordRejected.length > 0) {
    console.log(`\n   🔑 Keyword-rejected (sample):`);
    keywordRejected.slice(0, 10).forEach((r) => {
      console.log(
        `      ❌ [${r.id}] "${r.contactName}" / "${r.commercialName}"`,
      );
    });
  }

  if (filteredItems.length === 0) {
    console.log("\n⚠️  No particular listings passed both filters!");
    process.exit(0);
  }

  // 3. Connect MongoDB
  console.log("\n🔌 Connecting to MongoDB...");
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("   ✅ Connected");
  } catch (err) {
    console.error(`   ❌ MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }

  // 4. Import
  console.log(`\n📤 Importing ${filteredItems.length} listings...`);

  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const item of filteredItems) {
    try {
      const mapped = mapProperty(item);
      const result = await Property.findOneAndUpdate(
        { idealista_id: mapped.idealista_id },
        mapped,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (
        result.createdAt &&
        result.updatedAt &&
        result.createdAt.getTime() === result.updatedAt.getTime()
      ) {
        newCount++;
      } else {
        updatedCount++;
      }
    } catch (err) {
      errorCount++;
      if (!err.message.includes("duplicate")) {
        console.error(`   ⚠️  Error: ${err.message}`);
      }
    }
  }

  // 5. Summary
  console.log("\n" + "═".repeat(55));
  console.log("📊 Import Results:");
  console.log(`   ✅ New listings:        ${newCount}`);
  console.log(`   🔄 Updated:             ${updatedCount}`);
  console.log(`   ❌ Errors:              ${errorCount}`);
  console.log(`   📦 Total in DB:         ${newCount + updatedCount}`);
  console.log(
    `   🚫 Total rejected:      ${failedUserType + failedKeyword + unknownExcluded}`,
  );
  console.log("═".repeat(55));

  await mongoose.disconnect();
  console.log("\n✅ Done! Double filter applied — DB tamize!\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
