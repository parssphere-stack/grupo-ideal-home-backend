// Remove agency listings — keep only particulars
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.APIFY_TOKEN;
const DATASETS = [
  "aXb9qr1SKenMx9G2a","GbRHtNHOkkaoSgIiA","I49tQzNavxlOLJzvI","rVOTTkn8QXe4hgRwf",
  "wK2KDTpw9hd14TdSq","8zWZrDwXdZVqfUVnl","Ozr4PoKUzEtbs7fSh","r0zeZPU7he3eBDj6D",
  "fHtff5Fl2lq3Race2","M7Moq0gudxf9POTgB","GDUIBv6SlS63EBCxW","kPgAxj9KDphcordog",
  "az9qck2Ei3EEbO5Jf","n9v5Btpd51STwkFB6","FsLybjbmri4tLnhKa","zHKMGPyCwPxeW3Nqx",
  "hckkeJLuraYzJaipM","PbHQDn5j7PQYDNiSX","ahdnAj9Cz7G6vgOcA",
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const P = mongoose.model("P", new mongoose.Schema({}, { strict: false }), "properties");

  const beforeCount = await P.countDocuments();
  console.log("DB before:", beforeCount);

  // Collect professional vs private IDs from Apify
  const proIds = new Set();
  const privIds = new Set();

  for (const ds of DATASETS) {
    try {
      const r = await axios.get(`https://api.apify.com/v2/datasets/${ds}/items`, {
        params: { token: TOKEN, format: "json" },
        timeout: 30000,
      });
      for (const item of r.data) {
        const ut = item.contactInfo && item.contactInfo.userType;
        const id = item.propertyCode || item.id;
        if (!id) continue;
        const key = "idealista_" + id;
        if (ut === "private") {
          privIds.add(key);
        } else {
          proIds.add(key);
        }
      }
      console.log(`  Dataset ${ds}: ${r.data.length} items`);
    } catch (e) {
      console.log(`  Skip ${ds}: ${e.message}`);
    }
  }

  // Only delete professionals that are NOT also seen as private
  const toDelete = [];
  for (const id of proIds) {
    if (!privIds.has(id)) toDelete.push(id);
  }

  console.log(`\nProfessional (agency) to delete: ${toDelete.length}`);
  console.log(`Private (particular) to keep: ${privIds.size}`);

  if (toDelete.length > 0) {
    const result = await P.deleteMany({ idealista_id: { $in: toDelete } });
    console.log(`Deleted: ${result.deletedCount} agency listings`);
  }

  // Also update the contact info for private ones with phone numbers
  let phonesUpdated = 0;
  for (const ds of DATASETS) {
    try {
      const r = await axios.get(`https://api.apify.com/v2/datasets/${ds}/items`, {
        params: { token: TOKEN, format: "json" },
        timeout: 30000,
      });
      for (const item of r.data) {
        const ut = item.contactInfo && item.contactInfo.userType;
        if (ut !== "private") continue;
        const id = item.propertyCode || item.id;
        if (!id) continue;
        const phone = item.contactInfo.phone1 && item.contactInfo.phone1.phoneNumber;
        const name = item.contactInfo.contactName;
        if (phone) {
          await P.updateOne(
            { idealista_id: "idealista_" + id },
            { $set: { "contact.phone": phone, "contact.name": name || null, "contact.type": "particular" } },
          );
          phonesUpdated++;
        }
      }
    } catch (e) {}
  }
  console.log(`Updated ${phonesUpdated} particular contacts with phone numbers`);

  const afterTotal = await P.countDocuments();
  const afterActive = await P.countDocuments({ status: "active" });
  console.log(`\nDB after: ${afterTotal} total | ${afterActive} active`);

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });
