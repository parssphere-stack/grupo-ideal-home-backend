#!/usr/bin/env node
/**
 * Thorough agency detection — multi-signal check.
 * Checks: contact name, description, title, shared phones, business-name patterns.
 * Run: node src/thorough_agency_check.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { AGENCY_KEYWORDS } = require("./utils/agency-detector");

// Extra keywords to check in description/title (beyond contact name)
const DESC_AGENCY_SIGNALS = [
  // Spanish agency phrases
  "nuestra oficina", "nuestras oficinas", "nuestra agencia",
  "equipo de profesionales", "equipo profesional",
  "le presentamos", "les presentamos",
  "contacte con nosotros", "contacta con nosotros",
  "no dude en contactar", "no dudes en contactar",
  "llámenos", "llámanos",
  "pida cita", "pedir cita", "solicite información",
  "visita nuestro", "visite nuestro",
  "más información en nuestra",
  "gestión integral", "asesoramiento personalizado",
  "estamos a su disposición", "estamos a tu disposición",
  "nuestro departamento",
  "empresa dedicada",
  "somos una empresa", "somos un equipo",
  "años de experiencia en el sector",
  "compromiso con nuestros clientes",
  "servicio personalizado",
  "cartera de propiedades", "cartera de inmuebles",
  "disponemos de", "disponemos una",
  "honorarios", "comisión del", "comision del",
  "sin comisión de comprador",
  // English agency phrases
  "our office", "our agency", "our team",
  "contact us", "get in touch",
  "schedule a viewing", "book a viewing",
  "years of experience",
  "our portfolio", "our properties",
  "we offer", "we provide",
  "management company", "property management",
  "letting agent", "estate agent",
  // Brand names often in descriptions
  "www.", ".com", ".es",
  "©", "®", "™",
];

// Business name patterns (regex) — names that look like companies not people
const BUSINESS_NAME_PATTERNS = [
  /\b(s\.?l\.?u?\.?|s\.?a\.?|sl|sa)\b/i,
  /\b(group|grupo|holding|corp|company)\b/i,
  /\b(properties|propiedades|inmuebles|estates|realty)\b/i,
  /\b(invest|capital|asset|patrimonio)\b/i,
  /\b(soluciones|solutions|services|servicios)\b/i,
  /\b(gestión|gestion|management|consulting)\b/i,
  /\b(promotora|promotor|developer|construcciones)\b/i,
  /\b(asociados|partners|and\s+co)\b/i,
  /\b(real\s*estate|inmobiliaria|inmobiliario)\b/i,
  /\d{2,}/, // names with numbers usually not personal
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const col = mongoose.connection.collection("properties");
  const total = await col.countDocuments();
  console.log(`Total properties: ${total}\n`);

  // Fetch all properties
  const allProps = await col.find({}, {
    projection: {
      _id: 1, idealista_id: 1, title: 1, description: 1, price: 1, operation: 1,
      "contact.name": 1, "contact.phone": 1, "contact.type": 1,
      "location.city": 1, url: 1, code: 1,
    },
  }).toArray();

  console.log(`Loaded ${allProps.length} properties for analysis\n`);

  // ── Signal 1: Contact name matches agency keywords ──
  console.log("=== Signal 1: Contact name agency keywords ===");
  const signal1 = [];
  for (const p of allProps) {
    const name = (p.contact?.name || "").toLowerCase();
    if (!name) continue;
    const matched = AGENCY_KEYWORDS.filter((kw) => name.includes(kw));
    if (matched.length > 0) {
      signal1.push({ ...p, reason: `Contact name: "${p.contact.name}" matches: ${matched.join(", ")}` });
    }
  }
  console.log(`  Found: ${signal1.length} matches\n`);

  // ── Signal 2: Business-like contact names ──
  console.log("=== Signal 2: Business-like contact names ===");
  const signal2 = [];
  for (const p of allProps) {
    const name = (p.contact?.name || "").trim();
    if (!name || name.length < 3) continue;
    // Already caught by signal 1?
    if (signal1.find((s) => s._id.equals(p._id))) continue;

    const matchedPatterns = BUSINESS_NAME_PATTERNS.filter((re) => re.test(name));
    if (matchedPatterns.length > 0) {
      signal2.push({ ...p, reason: `Business name pattern: "${name}"` });
    }
  }
  console.log(`  Found: ${signal2.length} matches\n`);

  // ── Signal 3: Shared phone numbers (3+ listings = agency) ──
  console.log("=== Signal 3: Shared phone numbers ===");
  const phoneMap = {};
  for (const p of allProps) {
    const phone = (p.contact?.phone || "").replace(/\s+/g, "");
    if (phone && phone.length >= 6) {
      if (!phoneMap[phone]) phoneMap[phone] = [];
      phoneMap[phone].push(p);
    }
  }
  const signal3 = [];
  const sharedPhones = Object.entries(phoneMap)
    .filter(([, props]) => props.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [phone, props] of sharedPhones) {
    for (const p of props) {
      if (!signal1.find((s) => s._id.equals(p._id)) && !signal2.find((s) => s._id.equals(p._id))) {
        signal3.push({ ...p, reason: `Shared phone ${phone} (${props.length} listings)` });
      }
    }
  }
  console.log(`  Shared phones (3+ listings): ${sharedPhones.length} phones, ${signal3.length} new properties`);
  for (const [phone, props] of sharedPhones.slice(0, 15)) {
    const names = [...new Set(props.map((p) => p.contact?.name || "?"))];
    console.log(`    ${phone}: ${props.length} listings — names: ${names.join(", ")}`);
  }
  console.log();

  // ── Signal 4: Description/title contains agency language ──
  console.log("=== Signal 4: Description/title agency language ===");
  const signal4 = [];
  const alreadyFlagged = new Set([...signal1, ...signal2, ...signal3].map((s) => s._id.toString()));

  for (const p of allProps) {
    if (alreadyFlagged.has(p._id.toString())) continue;
    const text = `${p.title || ""} ${p.description || ""}`.toLowerCase();
    // Only flag if multiple agency signals in text (to avoid false positives)
    const matched = DESC_AGENCY_SIGNALS.filter((kw) => text.includes(kw.toLowerCase()));
    // Need at least 2 signals to flag from description alone
    if (matched.length >= 2) {
      signal4.push({ ...p, reason: `Description signals (${matched.length}): ${matched.slice(0, 5).join(", ")}` });
    }
  }
  console.log(`  Found: ${signal4.length} matches\n`);

  // ── Combine all signals ──
  const allFlagged = new Map();
  for (const list of [signal1, signal2, signal3, signal4]) {
    for (const p of list) {
      const key = p._id.toString();
      if (!allFlagged.has(key)) {
        allFlagged.set(key, { ...p, reasons: [p.reason] });
      } else {
        allFlagged.get(key).reasons.push(p.reason);
      }
    }
  }

  console.log("========================================");
  console.log(`TOTAL FLAGGED: ${allFlagged.size} properties`);
  console.log(`  Signal 1 (contact keywords): ${signal1.length}`);
  console.log(`  Signal 2 (business names): ${signal2.length}`);
  console.log(`  Signal 3 (shared phones): ${signal3.length}`);
  console.log(`  Signal 4 (description language): ${signal4.length}`);
  console.log("========================================\n");

  // Print details
  let i = 0;
  for (const [, p] of allFlagged) {
    i++;
    if (i <= 50) {
      console.log(`${i}. [${p.code || "?"}] ${(p.title || "").substring(0, 70)}`);
      console.log(`   Contact: "${p.contact?.name || ""}" | Phone: ${p.contact?.phone || "N/A"}`);
      console.log(`   Price: ${p.price}€ | ${p.operation} | ${p.location?.city || "?"}`);
      for (const r of p.reasons) console.log(`   → ${r}`);
      console.log();
    }
  }
  if (allFlagged.size > 50) {
    console.log(`... and ${allFlagged.size - 50} more\n`);
  }

  // Summary: strong vs weak signals
  const strongIds = new Set();
  for (const p of [...signal1, ...signal2, ...signal3]) strongIds.add(p._id.toString());
  const weakOnly = [...allFlagged.entries()].filter(([id]) => !strongIds.has(id));

  console.log(`\nSTRONG signals (contact name / business name / shared phone): ${strongIds.size}`);
  console.log(`WEAK only (description language only): ${weakOnly.length}`);

  // Ask: delete strong?
  if (strongIds.size > 0) {
    console.log(`\nDeleting ${strongIds.size} properties with STRONG agency signals...`);
    const idsToDelete = [...strongIds].map((id) => new mongoose.Types.ObjectId(id));
    const result = await col.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`Deleted: ${result.deletedCount}`);
  }

  // For weak signals, just mark them for review (don't auto-delete)
  if (weakOnly.length > 0) {
    console.log(`\n${weakOnly.length} weak-signal properties NOT auto-deleted (description only).`);
    console.log("Review these manually if needed.");
  }

  const remaining = await col.countDocuments();
  const active = await col.countDocuments({ status: "active" });
  console.log(`\nRemaining: ${remaining} total (${active} active)`);

  await mongoose.disconnect();
  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });
