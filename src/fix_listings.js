// ══════════════════════════════════════════════════════════════
// fix_listings.js — Run from: /Users/sam/Desktop/grupo-ideal-home/backend
// node fix_listings.js
// ══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
require("dotenv").config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  const Property = mongoose.model(
    "Property",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  // ══════════════════════════════════════════════════════════════
  // TASK 1: REMOVE CHEAP LISTINGS
  // Alquiler < 1000€ and Venta < 250,000€
  // ══════════════════════════════════════════════════════════════

  const rentDelete = await Property.deleteMany({
    operation: "rent",
    price: { $lt: 1000 },
  });
  console.log(`🗑️  Deleted alquiler < 1000€: ${rentDelete.deletedCount}`);

  const saleDelete = await Property.deleteMany({
    operation: "sale",
    price: { $lt: 250000 },
  });
  console.log(`🗑️  Deleted venta < 250,000€: ${saleDelete.deletedCount}`);

  // ══════════════════════════════════════════════════════════════
  // TASK 2: FIX BROKEN IMAGE URLs
  // Idealista images that are blurred/broken get fixed
  // ══════════════════════════════════════════════════════════════

  // Find properties with no images or broken thumbnail
  const noImages = await Property.countDocuments({
    $or: [
      { images: { $exists: false } },
      { images: { $size: 0 } },
      { images: null },
      { thumbnail: null },
      { thumbnail: { $exists: false } },
    ],
  });
  console.log(`\n🔍 Properties with no images: ${noImages}`);

  // Fix blur URLs - remove /blur/ from image paths
  const blurResult = await Property.updateMany(
    { thumbnail: { $regex: "/blur/" } },
    [
      {
        $set: {
          thumbnail: {
            $replaceAll: {
              input: "$thumbnail",
              find: "/blur/",
              replacement: "/",
            },
          },
        },
      },
    ],
  );
  console.log(`🖼️  Fixed blur thumbnails: ${blurResult.modifiedCount}`);

  // Fix blur in images array
  const propsWithBlurImages = await Property.find({
    images: { $elemMatch: { $regex: "/blur/" } },
  });
  let fixedImgCount = 0;
  for (const prop of propsWithBlurImages) {
    const fixedImages = prop.images.map((img) =>
      typeof img === "string" ? img.replace("/blur/", "/") : img,
    );
    await Property.updateOne(
      { _id: prop._id },
      { $set: { images: fixedImages } },
    );
    fixedImgCount++;
  }
  console.log(`🖼️  Fixed blur images arrays: ${fixedImgCount}`);

  // Final count
  const total = await Property.countDocuments();
  const rent = await Property.countDocuments({ operation: "rent" });
  const sale = await Property.countDocuments({ operation: "sale" });
  const rentAvg = await Property.aggregate([
    { $match: { operation: "rent", price: { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: "$price" } } },
  ]);
  const saleAvg = await Property.aggregate([
    { $match: { operation: "sale", price: { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: "$price" } } },
  ]);

  console.log(`\n📊 Final DB Status:`);
  console.log(`   Total: ${total}`);
  console.log(
    `   Alquiler: ${rent} | avg: ${Math.round(rentAvg[0]?.avg || 0)}€`,
  );
  console.log(`   Venta: ${sale} | avg: ${Math.round(saleAvg[0]?.avg || 0)}€`);

  await mongoose.disconnect();
  console.log("\n✅ Done!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
