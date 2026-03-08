const mongoose = require("mongoose");
require("dotenv").config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const P = mongoose.model(
    "P",
    new mongoose.Schema({}, { strict: false }),
    "properties",
  );

  const totalActive = await P.countDocuments({ status: "active" });

  const withPhone = await P.countDocuments({
    status: "active",
    "contact.phone": { $exists: true, $nin: ["", null] },
  });

  const noPhone = totalActive - withPhone;

  // How many were already checked (Phase 4) but still no phone?
  const checkedNoPhone = await P.countDocuments({
    status: "active",
    phone_checked_at: { $exists: true, $ne: null },
    $or: [
      { "contact.phone": { $exists: false } },
      { "contact.phone": "" },
      { "contact.phone": null },
    ],
  });

  const notCheckedNoPhone = noPhone - checkedNoPhone;

  console.log("═══════════════════════════════════════");
  console.log("📱 PHONE STATUS");
  console.log("═══════════════════════════════════════");
  console.log(`Total active: ${totalActive}`);
  console.log(`With phone: ${withPhone} (${Math.round((withPhone / totalActive) * 100)}%)`);
  console.log(`No phone: ${noPhone} (${Math.round((noPhone / totalActive) * 100)}%)`);
  console.log(`  → Checked (Phase 4) but no phone: ${checkedNoPhone}`);
  console.log(`  → Not checked yet: ${notCheckedNoPhone}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
