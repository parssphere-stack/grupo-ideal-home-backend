const mongoose = require("mongoose");
require("dotenv").config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Property = mongoose.model(
    "Property",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  const total = await Property.countDocuments();
  const active = await Property.countDocuments({ status: "active" });
  const inactive = total - active;
  console.log("═══════════════════════════════════════════");
  console.log("📊 TOTAL OVERVIEW");
  console.log("═══════════════════════════════════════════");
  console.log(`Total: ${total} | Active: ${active} | Inactive: ${inactive}`);

  // By city + operation
  const byCityOp = await Property.aggregate([
    { $match: { status: "active" } },
    {
      $group: {
        _id: {
          city: "$location.city",
          operation: "$operation",
          province: "$location.province",
        },
        count: { $sum: 1 },
        avgPrice: { $avg: "$price" },
        minPrice: { $min: "$price" },
        maxPrice: { $max: "$price" },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const cityMap = {};
  for (const r of byCityOp) {
    const city = r._id.city || "Unknown";
    if (!cityMap[city]) {
      cityMap[city] = { province: r._id.province, rent: null, sale: null };
    }
    cityMap[city][r._id.operation] = {
      count: r.count,
      avg: Math.round(r.avgPrice),
      min: r.minPrice,
      max: r.maxPrice,
    };
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("🏙️  BY CITY (active only)");
  console.log("═══════════════════════════════════════════");

  const sorted = Object.entries(cityMap).sort((a, b) => {
    const totalA = (a[1].rent?.count || 0) + (a[1].sale?.count || 0);
    const totalB = (b[1].rent?.count || 0) + (b[1].sale?.count || 0);
    return totalB - totalA;
  });

  for (const [city, data] of sorted) {
    const rentCount = data.rent?.count || 0;
    const saleCount = data.sale?.count || 0;
    const totalCity = rentCount + saleCount;
    console.log(`\n📍 ${city} (${data.province || "?"}) — ${totalCity} total`);
    if (data.rent)
      console.log(
        `   🔑 Rent: ${rentCount} | avg: ${data.rent.avg}€ | range: ${data.rent.min}€–${data.rent.max}€`,
      );
    if (data.sale)
      console.log(
        `   🏠 Sale: ${saleCount} | avg: ${data.sale.avg}€ | range: ${data.sale.min}€–${data.sale.max}€`,
      );
  }

  // By property type
  const byType = await Property.aggregate([
    { $match: { status: "active" } },
    { $group: { _id: "$type", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  console.log("\n═══════════════════════════════════════════");
  console.log("🏗️  BY PROPERTY TYPE");
  console.log("═══════════════════════════════════════════");
  for (const t of byType) console.log(`   ${t._id || "unknown"}: ${t.count}`);

  // Age of data
  const oldest = await Property.findOne({ status: "active" })
    .sort({ scraped_at: 1 })
    .lean();
  const newest = await Property.findOne({ status: "active" })
    .sort({ scraped_at: -1 })
    .lean();
  console.log("\n═══════════════════════════════════════════");
  console.log("📅 DATA FRESHNESS");
  console.log("═══════════════════════════════════════════");
  console.log(
    "Oldest scrape:",
    oldest?.scraped_at?.toISOString()?.split("T")[0] || "N/A",
  );
  console.log(
    "Newest scrape:",
    newest?.scraped_at?.toISOString()?.split("T")[0] || "N/A",
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
