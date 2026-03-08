const mongoose = require("mongoose");
require("dotenv").config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Property = mongoose.model(
    "Property",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  const stats = await Property.aggregate([
    {
      $group: {
        _id: { city: "$location.city", op: "$operation" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const cities = {};
  for (const s of stats) {
    const city = s._id.city || "Unknown";
    if (!cities[city]) cities[city] = { rent: 0, sale: 0 };
    if (s._id.op === "rent") cities[city].rent = s.count;
    if (s._id.op === "sale") cities[city].sale = s.count;
  }

  console.log("\nCity                    | Alquiler | Venta | Total");
  console.log("------------------------|----------|-------|------");
  Object.entries(cities)
    .map(([c, v]) => [c, v, v.rent + v.sale])
    .sort((a, b) => b[2] - a[2])
    .forEach(([city, v, total]) => {
      console.log(
        `${city.padEnd(24)}| ${String(v.rent).padEnd(8)} | ${String(v.sale).padEnd(5)} | ${total}`,
      );
    });

  await mongoose.disconnect();
}
main().catch(console.error);
