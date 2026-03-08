// ══════════════════════════════════════════════════════════════
// remove_short_term.js — Remove short-term rental listings
// Run from: /Users/sam/Desktop/grupo-ideal-home/backend
// node src/remove_short_term.js
// ══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
require("dotenv").config();

// Keywords that indicate short-term / vacation rentals (Spanish + English)
const SHORT_TERM_KEYWORDS = [
  "temporada",
  "temporal",
  "turístico",
  "turistico",
  "turistica",
  "turística",
  "vacacional",
  "vacation",
  "holiday",
  "short term",
  "short-term",
  "corta temporada",
  "alquiler vacacional",
  "weekly",
  "semanal",
  "por noche",
  "nightly",
  "per night",
  "larga estancia",
  "media estancia",
  "alquiler temporal",
  "rental season",
  "tourist",
  "touristic",
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  const Property = mongoose.model(
    "Property",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  // Build regex pattern from keywords (case-insensitive)
  const regexPattern = SHORT_TERM_KEYWORDS.join("|");
  const regex = { $regex: regexPattern, $options: "i" };

  // Find short-term rentals in title or description (only rent, not sale)
  const query = {
    operation: "rent",
    $or: [{ title: regex }, { description: regex }],
  };

  const shortTermListings = await Property.find(query).lean();
  console.log(
    `🔍 Found ${shortTermListings.length} short-term rental listings\n`,
  );

  if (shortTermListings.length === 0) {
    console.log("✅ No short-term rentals found. Database is clean!");
    await mongoose.disconnect();
    return;
  }

  // Show some examples
  console.log("📋 Examples:");
  console.log("─".repeat(60));
  const examples = shortTermListings.slice(0, 10);
  for (const p of examples) {
    const matchedKeywords = SHORT_TERM_KEYWORDS.filter((kw) => {
      const re = new RegExp(kw, "i");
      return re.test(p.title || "") || re.test(p.description || "");
    });
    console.log(`  Title: ${(p.title || "N/A").substring(0, 80)}`);
    console.log(`  Price: ${p.price}€ | Operation: ${p.operation}`);
    console.log(`  City: ${p.location?.city || "N/A"}`);
    console.log(`  Matched: ${matchedKeywords.join(", ")}`);
    console.log(`  URL: ${p.url || "N/A"}`);
    console.log("─".repeat(60));
  }

  // Breakdown by operation type
  const rentCount = shortTermListings.filter(
    (p) => p.operation === "rent",
  ).length;
  const saleCount = shortTermListings.filter(
    (p) => p.operation === "sale",
  ).length;
  console.log(`\n📊 Breakdown:`);
  console.log(`   Rent: ${rentCount}`);
  console.log(`   Sale: ${saleCount}`);

  // Delete them
  const result = await Property.deleteMany(query);
  console.log(`\n🗑️  Deleted ${result.deletedCount} short-term rental listings`);

  // Final stats
  const total = await Property.countDocuments();
  const activeRent = await Property.countDocuments({
    operation: "rent",
    status: "active",
  });
  const activeSale = await Property.countDocuments({
    operation: "sale",
    status: "active",
  });
  console.log(`\n📊 Remaining in DB:`);
  console.log(`   Total: ${total}`);
  console.log(`   Active rent: ${activeRent}`);
  console.log(`   Active sale: ${activeSale}`);

  await mongoose.disconnect();
  console.log("\n✅ Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
