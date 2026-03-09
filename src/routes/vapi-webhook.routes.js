/**
 * VAPI Voice Agent Webhook — Multilingual
 *
 * Handles incoming events from VAPI voice assistant.
 * Supports: es, en, fr, de, it, nl, ru, pl, da, sv, fi
 *
 * VAPI sends POST requests here when the voice assistant needs to call our tools.
 */

const express = require("express");
const router = express.Router();
const { searchProperties } = require("../services/property-search.service");
const Property = require("../models/property.model");

// ── Multilingual voice strings ──────────────────────────────
const VOICE_STRINGS = {
  es: {
    found: (n) => `Encontré ${n} propiedades`,
    showing: (n) => `Te muestro las ${n} mejores`,
    number: (i) => `Número ${i}`,
    monthly: "al mes",
    rooms: (n) => `${n} habitaciones`,
    sqm: (n) => `${n} metros cuadrados`,
    in: "en",
    withPool: "con piscina", withTerrace: "con terraza", withParking: "con parking",
    withLift: "con ascensor", exterior: "exterior",
    moreAvail: (n) => `Hay ${n} propiedades más. ¿Quieres que filtre más o te cuente sobre alguna?`,
    noResults: "No encontré propiedades con esos criterios. Prueba a ampliar la búsqueda — sube el presupuesto o prueba otra zona.",
    notFound: "No he podido encontrar esa propiedad. ¿Puedes indicarme el número de la lista?",
    price: "Precio",
    size: "Tamaño",
    bedrooms: "habitaciones",
    bathrooms: "baños",
    floor: "Planta",
    neighborhood: "Barrio",
    district: "Distrito",
    city: "Ciudad",
    features: "Características",
    pricePerSqm: "Precio por metro",
    daysOnMarket: (n) => `Lleva ${n} días en el mercado`,
    toolError: "Lo siento, ha habido un error. ¿Puedes repetir?",
    unknownTool: "No reconozco esa acción.",
  },
  en: {
    found: (n) => `I found ${n} properties`,
    showing: (n) => `Here are the top ${n}`,
    number: (i) => `Number ${i}`,
    monthly: "per month",
    rooms: (n) => `${n} bedrooms`,
    sqm: (n) => `${n} square meters`,
    in: "in",
    withPool: "with pool", withTerrace: "with terrace", withParking: "with parking",
    withLift: "with elevator", exterior: "exterior-facing",
    moreAvail: (n) => `There are ${n} more available. Want me to narrow it down or tell you about a specific one?`,
    noResults: "I didn't find any properties matching those criteria. Try broadening your search — increase the budget or try a different area.",
    notFound: "I couldn't find that property. Can you tell me the number from the list?",
    price: "Price",
    size: "Size",
    bedrooms: "bedrooms",
    bathrooms: "bathrooms",
    floor: "Floor",
    neighborhood: "Neighborhood",
    district: "District",
    city: "City",
    features: "Features",
    pricePerSqm: "Price per sqm",
    daysOnMarket: (n) => `Listed for ${n} days`,
    toolError: "Sorry, there was an error. Could you repeat that?",
    unknownTool: "I don't recognize that action.",
  },
  fr: {
    found: (n) => `J'ai trouvé ${n} propriétés`,
    showing: (n) => `Voici les ${n} meilleures`,
    number: (i) => `Numéro ${i}`,
    monthly: "par mois",
    rooms: (n) => `${n} chambres`,
    sqm: (n) => `${n} mètres carrés`,
    in: "à",
    withPool: "avec piscine", withTerrace: "avec terrasse", withParking: "avec parking",
    withLift: "avec ascenseur", exterior: "extérieur",
    moreAvail: (n) => `Il y a ${n} propriétés de plus. Voulez-vous que je filtre davantage?`,
    noResults: "Je n'ai trouvé aucune propriété correspondant. Essayez d'élargir la recherche.",
    notFound: "Je n'ai pas trouvé cette propriété. Pouvez-vous me donner le numéro?",
    price: "Prix",
    size: "Surface",
    bedrooms: "chambres",
    bathrooms: "salles de bain",
    floor: "Étage",
    neighborhood: "Quartier",
    district: "Arrondissement",
    city: "Ville",
    features: "Caractéristiques",
    pricePerSqm: "Prix au m²",
    daysOnMarket: (n) => `En ligne depuis ${n} jours`,
    toolError: "Désolé, une erreur s'est produite. Pouvez-vous répéter?",
    unknownTool: "Action non reconnue.",
  },
  de: {
    found: (n) => `Ich habe ${n} Immobilien gefunden`,
    showing: (n) => `Hier sind die besten ${n}`,
    number: (i) => `Nummer ${i}`,
    monthly: "pro Monat",
    rooms: (n) => `${n} Schlafzimmer`,
    sqm: (n) => `${n} Quadratmeter`,
    in: "in",
    withPool: "mit Pool", withTerrace: "mit Terrasse", withParking: "mit Parkplatz",
    withLift: "mit Aufzug", exterior: "Außenlage",
    moreAvail: (n) => `Es gibt ${n} weitere. Soll ich weiter filtern oder über eine bestimmte erzählen?`,
    noResults: "Keine Immobilien gefunden. Versuchen Sie, die Suche zu erweitern.",
    notFound: "Diese Immobilie wurde nicht gefunden. Können Sie mir die Nummer nennen?",
    price: "Preis",
    size: "Größe",
    bedrooms: "Schlafzimmer",
    bathrooms: "Badezimmer",
    floor: "Etage",
    neighborhood: "Viertel",
    district: "Bezirk",
    city: "Stadt",
    features: "Ausstattung",
    pricePerSqm: "Preis pro m²",
    daysOnMarket: (n) => `Seit ${n} Tagen inseriert`,
    toolError: "Entschuldigung, ein Fehler ist aufgetreten. Können Sie das wiederholen?",
    unknownTool: "Unbekannte Aktion.",
  },
  it: {
    found: (n) => `Ho trovato ${n} proprietà`,
    showing: (n) => `Ecco le migliori ${n}`,
    number: (i) => `Numero ${i}`,
    monthly: "al mese",
    rooms: (n) => `${n} camere`,
    sqm: (n) => `${n} metri quadrati`,
    in: "a",
    withPool: "con piscina", withTerrace: "con terrazza", withParking: "con parcheggio",
    withLift: "con ascensore", exterior: "esterno",
    moreAvail: (n) => `Ci sono altre ${n} proprietà. Vuoi che filtri di più?`,
    noResults: "Non ho trovato proprietà con questi criteri. Prova ad ampliare la ricerca.",
    notFound: "Non ho trovato quella proprietà. Puoi indicarmi il numero dalla lista?",
    price: "Prezzo",
    size: "Dimensione",
    bedrooms: "camere",
    bathrooms: "bagni",
    floor: "Piano",
    neighborhood: "Quartiere",
    district: "Distretto",
    city: "Città",
    features: "Caratteristiche",
    pricePerSqm: "Prezzo al m²",
    daysOnMarket: (n) => `In vendita da ${n} giorni`,
    toolError: "Mi dispiace, c'è stato un errore. Puoi ripetere?",
    unknownTool: "Azione non riconosciuta.",
  },
  nl: {
    found: (n) => `Ik heb ${n} woningen gevonden`,
    showing: (n) => `Hier zijn de beste ${n}`,
    number: (i) => `Nummer ${i}`,
    monthly: "per maand",
    rooms: (n) => `${n} slaapkamers`,
    sqm: (n) => `${n} vierkante meter`,
    in: "in",
    withPool: "met zwembad", withTerrace: "met terras", withParking: "met parkeerplaats",
    withLift: "met lift", exterior: "buitenzijde",
    moreAvail: (n) => `Er zijn nog ${n} meer beschikbaar. Wil je dat ik verder filter?`,
    noResults: "Geen woningen gevonden. Probeer de zoekopdracht te verbreden.",
    notFound: "Ik kon die woning niet vinden. Kun je het nummer noemen?",
    price: "Prijs",
    size: "Oppervlakte",
    bedrooms: "slaapkamers",
    bathrooms: "badkamers",
    floor: "Verdieping",
    neighborhood: "Wijk",
    district: "District",
    city: "Stad",
    features: "Kenmerken",
    pricePerSqm: "Prijs per m²",
    daysOnMarket: (n) => `${n} dagen op de markt`,
    toolError: "Sorry, er is een fout opgetreden. Kun je dat herhalen?",
    unknownTool: "Onbekende actie.",
  },
  ru: {
    found: (n) => `Найдено ${n} объектов`,
    showing: (n) => `Вот лучшие ${n}`,
    number: (i) => `Номер ${i}`,
    monthly: "в месяц",
    rooms: (n) => `${n} спален`,
    sqm: (n) => `${n} квадратных метров`,
    in: "в",
    withPool: "с бассейном", withTerrace: "с террасой", withParking: "с парковкой",
    withLift: "с лифтом", exterior: "внешняя сторона",
    moreAvail: (n) => `Есть ещё ${n} объектов. Уточнить поиск или рассказать о конкретном?`,
    noResults: "Не нашёл подходящих объектов. Попробуйте расширить поиск.",
    notFound: "Не могу найти этот объект. Скажите номер из списка.",
    price: "Цена",
    size: "Площадь",
    bedrooms: "спален",
    bathrooms: "ванных",
    floor: "Этаж",
    neighborhood: "Район",
    district: "Округ",
    city: "Город",
    features: "Характеристики",
    pricePerSqm: "Цена за м²",
    daysOnMarket: (n) => `На рынке ${n} дней`,
    toolError: "Извините, произошла ошибка. Повторите, пожалуйста.",
    unknownTool: "Неизвестное действие.",
  },
  pl: {
    found: (n) => `Znalazłam ${n} nieruchomości`,
    showing: (n) => `Oto najlepsze ${n}`,
    number: (i) => `Numer ${i}`,
    monthly: "miesięcznie",
    rooms: (n) => `${n} sypialni`,
    sqm: (n) => `${n} metrów kwadratowych`,
    in: "w",
    withPool: "z basenem", withTerrace: "z tarasem", withParking: "z parkingiem",
    withLift: "z windą", exterior: "na zewnątrz",
    moreAvail: (n) => `Jest jeszcze ${n} więcej. Chcesz, żebym zawęziła wyszukiwanie?`,
    noResults: "Nie znalazłam nieruchomości spełniających te kryteria. Spróbuj poszerzyć wyszukiwanie.",
    notFound: "Nie mogę znaleźć tej nieruchomości. Podaj numer z listy.",
    price: "Cena",
    size: "Powierzchnia",
    bedrooms: "sypialni",
    bathrooms: "łazienek",
    floor: "Piętro",
    neighborhood: "Dzielnica",
    district: "Okręg",
    city: "Miasto",
    features: "Cechy",
    pricePerSqm: "Cena za m²",
    daysOnMarket: (n) => `Na rynku od ${n} dni`,
    toolError: "Przepraszam, wystąpił błąd. Czy możesz powtórzyć?",
    unknownTool: "Nieznana akcja.",
  },
  da: {
    found: (n) => `Jeg fandt ${n} ejendomme`,
    showing: (n) => `Her er de bedste ${n}`,
    number: (i) => `Nummer ${i}`,
    monthly: "om måneden",
    rooms: (n) => `${n} soveværelser`,
    sqm: (n) => `${n} kvadratmeter`,
    in: "i",
    withPool: "med pool", withTerrace: "med terrasse", withParking: "med parkering",
    withLift: "med elevator", exterior: "udvendig",
    moreAvail: (n) => `Der er ${n} flere tilgængelige. Skal jeg filtrere mere?`,
    noResults: "Ingen ejendomme fundet. Prøv at udvide søgningen.",
    notFound: "Kan ikke finde den ejendom. Kan du give mig nummeret?",
    price: "Pris", size: "Størrelse", bedrooms: "soveværelser", bathrooms: "badeværelser",
    floor: "Etage", neighborhood: "Kvarter", district: "Distrikt", city: "By",
    features: "Egenskaber", pricePerSqm: "Pris pr. m²",
    daysOnMarket: (n) => `${n} dage på markedet`,
    toolError: "Beklager, der opstod en fejl. Kan du gentage?",
    unknownTool: "Ukendt handling.",
  },
  sv: {
    found: (n) => `Jag hittade ${n} fastigheter`,
    showing: (n) => `Här är de ${n} bästa`,
    number: (i) => `Nummer ${i}`,
    monthly: "per månad",
    rooms: (n) => `${n} sovrum`,
    sqm: (n) => `${n} kvadratmeter`,
    in: "i",
    withPool: "med pool", withTerrace: "med terrass", withParking: "med parkering",
    withLift: "med hiss", exterior: "utvändig",
    moreAvail: (n) => `Det finns ${n} fler. Vill du att jag filtrerar mer?`,
    noResults: "Inga fastigheter hittades. Försök bredda sökningen.",
    notFound: "Kan inte hitta den fastigheten. Kan du ge mig numret?",
    price: "Pris", size: "Storlek", bedrooms: "sovrum", bathrooms: "badrum",
    floor: "Våning", neighborhood: "Område", district: "Distrikt", city: "Stad",
    features: "Egenskaper", pricePerSqm: "Pris per m²",
    daysOnMarket: (n) => `${n} dagar på marknaden`,
    toolError: "Förlåt, ett fel uppstod. Kan du upprepa?",
    unknownTool: "Okänd åtgärd.",
  },
  fi: {
    found: (n) => `Löysin ${n} kohdetta`,
    showing: (n) => `Tässä parhaat ${n}`,
    number: (i) => `Numero ${i}`,
    monthly: "kuukaudessa",
    rooms: (n) => `${n} makuuhuonetta`,
    sqm: (n) => `${n} neliömetriä`,
    in: "alueella",
    withPool: "uima-altaalla", withTerrace: "terassilla", withParking: "pysäköinnillä",
    withLift: "hissillä", exterior: "ulkopuolella",
    moreAvail: (n) => `${n} lisää saatavilla. Haluatko rajata hakua?`,
    noResults: "Ei löytynyt kohteita. Kokeile laajentaa hakua.",
    notFound: "En löydä tuota kohdetta. Voitko kertoa numeron?",
    price: "Hinta", size: "Koko", bedrooms: "makuuhuonetta", bathrooms: "kylpyhuonetta",
    floor: "Kerros", neighborhood: "Kaupunginosa", district: "Alue", city: "Kaupunki",
    features: "Ominaisuudet", pricePerSqm: "Hinta per m²",
    daysOnMarket: (n) => `${n} päivää markkinoilla`,
    toolError: "Anteeksi, tapahtui virhe. Voitko toistaa?",
    unknownTool: "Tuntematon toiminto.",
  },
};

function getStrings(lang) {
  return VOICE_STRINGS[lang] || VOICE_STRINGS.es;
}

// ── Shared search results store (for frontend polling) ──────
// When VAPI webhook executes a search, results are stored here
// Frontend polls /api/vapi/latest-search to get them
const latestVoiceSearch = { ts: 0, filters: {}, properties: [], total: 0 };

// ── GET /api/vapi/latest-search — polled by frontend ────────
router.get("/latest-search", (req, res) => {
  const since = parseInt(req.query.since) || 0;
  if (latestVoiceSearch.ts > since) {
    return res.json({
      ts: latestVoiceSearch.ts,
      filters: latestVoiceSearch.filters,
      properties: latestVoiceSearch.properties,
      total: latestVoiceSearch.total,
    });
  }
  res.json({ ts: latestVoiceSearch.ts }); // no new results
});

// ── In-memory voice session (per call) ──────────────────────
const voiceSessions = new Map();

function getVoiceSession(callId) {
  if (!callId) return { lastFilters: {}, lastResults: [], searchCount: 0, lang: "es" };
  if (voiceSessions.has(callId)) return voiceSessions.get(callId);
  const session = { lastFilters: {}, lastResults: [], searchCount: 0, lang: "es" };
  voiceSessions.set(callId, session);
  setTimeout(() => voiceSessions.delete(callId), 60 * 60 * 1000);
  return session;
}

// ── Tool executors ──────────────────────────────────────────

async function executeSearchProperties(params, session) {
  const filters = { ...params };
  const s = getStrings(session.lang);

  const searchResult = await searchProperties({
    ...filters,
    limit: 5,
    page: 1,
  });

  session.lastFilters = filters;
  session.lastResults = searchResult.properties;
  session.searchCount++;

  // Store for frontend polling — this is how voice search syncs to the listing
  latestVoiceSearch.ts = Date.now();
  latestVoiceSearch.filters = filters;
  latestVoiceSearch.properties = searchResult.properties;
  latestVoiceSearch.total = searchResult.total;

  if (searchResult.total === 0) return s.noResults;

  const props = searchResult.properties;
  const count = props.length;

  // Build concise voice-friendly summary (NOT a full listing)
  const prices = props.map((p) => p.price).filter(Boolean);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const neighborhoods = [...new Set(props.map((p) => p.location?.neighborhood || p.location?.district).filter(Boolean))];

  // Voice-friendly price formatter (no dots/commas that confuse TTS)
  const vPrice = (n) => {
    if (!n) return "";
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)} million euros`;
    if (n >= 1000) return `${Math.round(n / 100) * 100} euros`;
    return `${n} euros`;
  };

  // Short summary: count, price range, neighborhoods — let the AI model compose the natural response
  const summary = [];
  summary.push(`RESULTS: ${searchResult.total} properties found, showing top ${count}.`);
  summary.push(`PRICE RANGE: ${vPrice(minPrice)} to ${vPrice(maxPrice)}`);
  if (neighborhoods.length) summary.push(`AREAS: ${neighborhoods.slice(0, 3).join(", ")}`);

  // Brief per-property data (numbered for reference)
  props.forEach((p, i) => {
    const parts = [`#${i + 1}:`];
    parts.push(vPrice(p.price));
    if (p.operation === "rent") parts.push(s.monthly);
    if (p.rooms) parts.push(`${p.rooms} bedrooms`);
    if (p.size) parts.push(`${p.size} square meters`);
    if (p.location?.neighborhood) parts.push(p.location.neighborhood);
    summary.push(parts.join(", "));
  });

  if (searchResult.total > 5) {
    summary.push(`(${searchResult.total - 5} more available)`);
  }

  return summary.join("\n");
}

async function executeGetPropertyDetails(params, session) {
  const s = getStrings(session.lang);
  let property = null;
  const { property_index, property_id } = params;

  if (property_index && session.lastResults?.length) {
    property = session.lastResults[property_index - 1];
  } else if (property_id) {
    const doc = await Property.findOne({
      $or: [{ code: property_id }, { idealista_id: property_id }],
      status: "active",
    }).lean();
    if (doc) property = doc;
  }

  if (!property) return s.notFound;

  // Track last detailed property for agent request fallback
  session.lastDetailedProp = property;

  const p = property;
  const daysOnMarket = p.scraped_at
    ? Math.floor((Date.now() - new Date(p.scraped_at).getTime()) / 86400000)
    : null;

  // Concise structured data — let the AI model compose a natural spoken response
  const details = [];
  details.push(`PROPERTY: ${p.title || "—"}`);
  const vp = p.price >= 1000000 ? `${(p.price/1000000).toFixed(1)} million euros` : p.price >= 1000 ? `${Math.round(p.price/100)*100} euros` : `${p.price} euros`;
  details.push(`PRICE: ${vp}${p.operation === "rent" ? " per month" : ""}`);
  if (p.rooms) details.push(`ROOMS: ${p.rooms}`);
  if (p.bathrooms || p.features?.bathrooms) details.push(`BATHS: ${p.bathrooms || p.features?.bathrooms}`);
  if (p.size || p.features?.size_sqm) details.push(`SIZE: ${p.size || p.features?.size_sqm}m²`);
  if (p.location?.neighborhood) details.push(`AREA: ${p.location.neighborhood}`);
  else if (p.location?.city) details.push(`CITY: ${p.location.city}`);

  const feats = [];
  if (p.hasPool || p.features?.has_pool) feats.push("pool");
  if (p.hasTerrace || p.features?.has_terrace) feats.push("terrace");
  if (p.hasParking || p.features?.has_parking) feats.push("parking");
  if (p.hasLift || p.features?.has_elevator) feats.push("elevator");
  if (feats.length) details.push(`FEATURES: ${feats.join(", ")}`);
  if (daysOnMarket !== null) details.push(`LISTED: ${daysOnMarket} days ago`);

  return details.join(" | ");
}

async function executeGetNeighborhoodInfo(params) {
  const { neighborhood, city } = params;
  const match = { status: "active" };
  const nRe = new RegExp(neighborhood.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  match.$or = [
    { "location.neighborhood": nRe },
    { "location.district": nRe },
    { "address.neighborhood": nRe },
    { "address.district": nRe },
  ];
  if (city) match["location.city"] = new RegExp(city, "i");

  const props = await Property.find(match).lean();
  if (!props.length) return `No properties found in "${neighborhood}".`;

  const rent = props.filter((p) => p.operation === "rent");
  const sale = props.filter((p) => p.operation === "sale");
  const avg = (arr) => arr.length ? Math.round(arr.reduce((s, p) => s + (p.price || 0), 0) / arr.length) : null;

  const lines = [`NEIGHBORHOOD: ${neighborhood} (${props[0]?.location?.city || city || "?"})`];
  lines.push(`TOTAL: ${props.length} properties`);
  if (rent.length) lines.push(`RENT: ${rent.length} available, avg ${avg(rent)?.toLocaleString("es-ES")}€/month`);
  if (sale.length) lines.push(`SALE: ${sale.length} available, avg ${avg(sale)?.toLocaleString("es-ES")}€`);
  const pools = props.filter((p) => p.hasPool || p.features?.has_pool).length;
  const terraces = props.filter((p) => p.hasTerrace || p.features?.has_terrace).length;
  if (pools || terraces) lines.push(`FEATURES: ${pools} with pool, ${terraces} with terrace`);

  return lines.join(" | ");
}

async function executeRequestHumanAgent(params, session, callId) {
  const AgentRequest = require("../models/agent-request.model");
  console.log("[VAPI] request_human_agent raw params:", JSON.stringify(params));

  // Validate: at minimum we need a name and phone
  const name = (params.customer_name || params.customerName || "").trim();
  const phone = (params.customer_phone || params.customerPhone || "").trim();

  if (!name || !phone) {
    console.warn("[VAPI] request_human_agent missing name/phone:", { name, phone });
    return "ERROR: You must collect the customer's name and phone number before calling this tool. Please ask for their name and phone, then call request_human_agent again with customer_name and customer_phone filled in.";
  }

  // Look up interested property from voice session
  let interestedProperty = {};
  let prop = null;
  const propIndex = parseInt(params.property_index || params.propertyIndex);

  // 1. Try by explicit property_index
  if (session.lastResults?.length && propIndex >= 1) {
    prop = session.lastResults[propIndex - 1];
  }
  // 2. Fallback: if user viewed property details, use that
  if (!prop && session.lastDetailedProp) {
    prop = session.lastDetailedProp;
  }
  // 3. Fallback: if only 1 result in last search, use it
  if (!prop && session.lastResults?.length === 1) {
    prop = session.lastResults[0];
  }

  if (prop) {
    interestedProperty = {
      propertyId: prop._id,
      title: prop.title || `${prop.type || "Property"} in ${prop.location?.neighborhood || prop.location?.city || ""}`,
      price: prop.price,
      operation: prop.operation || "",
      rooms: prop.rooms || null,
      size: prop.size || null,
      neighborhood: prop.location?.neighborhood || prop.location?.district || "",
      city: prop.location?.city || "",
      imageUrl: prop.images?.[0] || "",
    };
  }

  try {
    await AgentRequest.create({
      customerName: name,
      customerPhone: phone,
      customerEmail: (params.customer_email || params.customerEmail || "").trim(),
      language: session.lang || "es",
      summary: params.summary || "Customer requested to speak with an agent",
      lookingFor: params.looking_for || params.lookingFor || "",
      budget: params.budget || "",
      preferredArea: params.preferred_area || params.preferredArea || "",
      source: "voice",
      callId: callId || null,
      interestedProperty,
    });
    console.log("[VAPI] AgentRequest created for:", name, phone);
    return "DONE: Request saved. A human agent will contact the customer soon.";
  } catch (err) {
    console.error("[VAPI] Request agent error:", err.message);
    return "ERROR: Failed to save request. Please try again.";
  }
}

// ── Detect language from VAPI call metadata ─────────────────
function detectLangFromCall(message) {
  // VAPI may send language info in call metadata or assistant overrides
  const assistantOverrides = message.call?.assistantOverrides;
  if (assistantOverrides?.language) {
    const code = assistantOverrides.language.substring(0, 2).toLowerCase();
    if (VOICE_STRINGS[code]) return code;
  }
  // Check transcriber language
  const transcriberLang = message.call?.transcriber?.language;
  if (transcriberLang) {
    const code = transcriberLang.substring(0, 2).toLowerCase();
    if (VOICE_STRINGS[code]) return code;
  }
  return "es"; // default Spanish
}

// ── Main webhook handler ────────────────────────────────────

router.post("/webhook", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message?.type) {
      return res.json({ ok: true });
    }

    const callId = message.call?.id;

    // ── Handle tool calls ─────────────────────────────────
    if (message.type === "tool-calls") {
      const session = getVoiceSession(callId);
      // Detect language from call if not set yet
      if (session.lang === "es" && message.call) {
        session.lang = detectLangFromCall(message);
      }

      // VAPI sends tool calls in different formats depending on version
      let toolCallList = message.toolCallList || [];
      // toolWithToolCallList wraps each tool with its toolCall
      if (!toolCallList.length && message.toolWithToolCallList) {
        toolCallList = message.toolWithToolCallList.map(t => ({
          ...t.toolCall,
          name: t.toolCall?.name || t.function?.name,
          parameters: t.toolCall?.parameters || {},
          function: t.toolCall?.function || t.function,
        }));
      }
      console.log(`[VAPI] Processing ${toolCallList.length} tool calls, raw payload:`,
        JSON.stringify(toolCallList.map(tc => ({ name: tc.name, keys: Object.keys(tc), params: tc.parameters, funcArgs: tc.function?.arguments }))));
      const s = getStrings(session.lang);
      const results = [];

      for (const tc of toolCallList) {
        const toolName = tc.name || tc.function?.name;
        const toolCallId = tc.id || tc.toolCall?.id;

        // Parse params from all possible VAPI formats
        let params = tc.parameters || tc.toolCall?.parameters || {};
        // VAPI often sends args as JSON string in function.arguments
        if (!Object.keys(params).length && tc.function?.arguments) {
          try {
            params = typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
          } catch (e) { console.warn("[VAPI] Failed to parse function.arguments:", e.message); }
        }
        // Also check tc.arguments (may be string or object)
        if (!Object.keys(params).length && tc.arguments) {
          try {
            params = typeof tc.arguments === "string"
              ? JSON.parse(tc.arguments)
              : tc.arguments;
          } catch (e) { console.warn("[VAPI] Failed to parse tc.arguments:", e.message); }
        }
        console.log(`[VAPI] Tool: ${toolName}, params:`, JSON.stringify(params));

        let result = "";

        try {
          if (toolName === "search_properties") {
            result = await executeSearchProperties(params, session);
          } else if (toolName === "get_property_details") {
            result = await executeGetPropertyDetails(params, session);
          } else if (toolName === "get_neighborhood_info") {
            result = await executeGetNeighborhoodInfo(params);
          } else if (toolName === "request_human_agent") {
            result = await executeRequestHumanAgent(params, session, callId);
          } else {
            result = s.unknownTool;
          }
        } catch (err) {
          console.error(`[VAPI] Tool error (${toolName}):`, err.message);
          result = s.toolError;
        }

        results.push({ toolCallId, name: toolName, result });
      }

      return res.json({ results });
    }

    // ── Handle assistant request (dynamic config) ─────────
    if (message.type === "assistant-request") {
      const lang = detectLangFromCall(message);
      return res.json(getAssistantConfig(lang));
    }

    // ── Handle language change ────────────────────────────
    if (message.type === "language-change-detected") {
      const session = getVoiceSession(callId);
      const newLang = message.language?.substring(0, 2).toLowerCase();
      if (newLang && VOICE_STRINGS[newLang]) {
        session.lang = newLang;
        console.log(`[VAPI] Call ${callId}: language changed to ${newLang}`);
      }
      return res.json({ ok: true });
    }

    // ── Handle status updates ─────────────────────────────
    if (message.type === "status-update") {
      console.log(`[VAPI] Call ${callId}: ${message.status}`);
      if (message.status === "ended" && callId) voiceSessions.delete(callId);
      return res.json({ ok: true });
    }

    // ── Handle end of call report ─────────────────────────
    if (message.type === "end-of-call-report") {
      console.log(`[VAPI] Call ended. Duration: ${message.durationSeconds}s, Cost: $${message.cost}`);
      if (callId) voiceSessions.delete(callId);
      return res.json({ ok: true });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[VAPI] Webhook error:", err.message);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// ── Assistant config — multilingual ─────────────────────────

const FIRST_MESSAGES = {
  es: "¡Hola! Soy Sofia de Grupo Ideal Home. ¿Qué tipo de propiedad estás buscando?",
  en: "Hi! I'm Sofia from Grupo Ideal Home. What kind of property are you looking for?",
  fr: "Bonjour! Je suis Sofia de Grupo Ideal Home. Quel type de bien recherchez-vous?",
  de: "Hallo! Ich bin Sofia von Grupo Ideal Home. Was für eine Immobilie suchen Sie?",
  it: "Ciao! Sono Sofia di Grupo Ideal Home. Che tipo di immobile cerchi?",
  nl: "Hallo! Ik ben Sofia van Grupo Ideal Home. Wat voor woning zoekt u?",
  ru: "Привет! Я София из Grupo Ideal Home. Какую недвижимость вы ищете?",
  pl: "Cześć! Jestem Sofia z Grupo Ideal Home. Jakiej nieruchomości szukasz?",
  da: "Hej! Jeg er Sofia fra Grupo Ideal Home. Hvad slags bolig leder du efter?",
  sv: "Hej! Jag är Sofia från Grupo Ideal Home. Vilken typ av bostad letar du efter?",
  fi: "Hei! Olen Sofia Grupo Ideal Homesta. Millaista asuntoa etsit?",
};

const END_MESSAGES = {
  es: "¡Gracias por contactar con Grupo Ideal Home! Espero haberte ayudado. ¡Hasta pronto!",
  en: "Thank you for contacting Grupo Ideal Home! I hope I was helpful. See you soon!",
  fr: "Merci d'avoir contacté Grupo Ideal Home! J'espère vous avoir aidé. À bientôt!",
  de: "Vielen Dank für Ihre Kontaktaufnahme mit Grupo Ideal Home! Ich hoffe, ich konnte helfen. Bis bald!",
  it: "Grazie per aver contattato Grupo Ideal Home! Spero di esserti stata utile. A presto!",
  nl: "Bedankt voor het contact met Grupo Ideal Home! Ik hoop dat ik heb geholpen. Tot ziens!",
  ru: "Спасибо за обращение в Grupo Ideal Home! Надеюсь, я помогла. До скорой встречи!",
  pl: "Dziękuję za kontakt z Grupo Ideal Home! Mam nadzieję, że pomogłam. Do zobaczenia!",
  da: "Tak fordi du kontaktede Grupo Ideal Home! Jeg håber, jeg var til hjælp. Vi ses!",
  sv: "Tack för att du kontaktade Grupo Ideal Home! Jag hoppas jag kunde hjälpa. Vi ses!",
  fi: "Kiitos yhteydenotosta Grupo Ideal Homeen! Toivottavasti olin avuksi. Nähdään!",
};

// ── Voice Configuration ─────────────────────────────────────
// Use per-language voices for better pronunciation and naturalness
const VOICE_MAP = {
  es: { provider: "azure", voiceId: "es-ES-ElviraNeural" },
  en: { provider: "azure", voiceId: "en-US-JennyNeural" },
  fr: { provider: "azure", voiceId: "fr-FR-DeniseNeural" },
  de: { provider: "azure", voiceId: "de-DE-KatjaNeural" },
  it: { provider: "azure", voiceId: "it-IT-ElsaNeural" },
  nl: { provider: "azure", voiceId: "nl-NL-ColetteNeural" },
  ru: { provider: "azure", voiceId: "ru-RU-SvetlanaNeural" },
  pl: { provider: "azure", voiceId: "pl-PL-ZofiaNeural" },
  pt: { provider: "azure", voiceId: "pt-PT-RaquelNeural" },
};

function getAssistantConfig(lang = "es") {
  const serverUrl = process.env.VAPI_SERVER_URL || "https://grupo-ideal-home-backend-production.up.railway.app/api/vapi/webhook";
  return {
    assistant: {
      name: "Sofia",
      serverUrl,
      firstMessage: FIRST_MESSAGES[lang] || FIRST_MESSAGES.es,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        systemMessage: `You are Sofia, a senior real estate consultant at Grupo Ideal Home — Madrid and Málaga, Spain.

LANGUAGE: Match the user's language. Default: Spanish.

STYLE: Warm, brief, action-oriented. 1-2 sentences max per turn.

CRITICAL BEHAVIOR — SEARCH IMMEDIATELY:
- When the user mentions ANY property criteria, call search_properties RIGHT AWAY. Do NOT ask clarifying questions first.
- Example: User says "pisos en Madrid" → IMMEDIATELY call search_properties with city:"Madrid". Do NOT ask "what neighborhood?".
- Example: User says "alquiler Chamberí" → IMMEDIATELY call search_properties with city:"Madrid", operation:"rent", search:"Chamberí".
- If the user's speech sounds like a neighborhood name (even misspelled), TRY IT as search text. Example: "Chamartin" → search:"Chamartín". "Salavanca" → search:"Salamanca".
- Only ask follow-up questions AFTER showing initial results: "He encontrado 45 pisos. ¿Quieres filtrar por precio o habitaciones?"

TOOL PARAMETERS:
- operation: "rent" for alquiler/rent, "sale" for comprar/buy
- city: "Madrid" for Madrid neighborhoods (Chamberí, Salamanca, Retiro, Malasaña, Chueca, Lavapiés, Centro, Tetuán, Hortaleza, Vallecas, Arganzuela, Carabanchel, La Latina, Moncloa, Chamartín, Usera, Prosperidad). "Málaga" for Málaga neighborhoods (Teatinos, Pedregalejo, El Palo, La Trinidad, Huelin, La Malagueta)
- search: neighborhood/district/street name
- REFINEMENT: keep ALL previous filters, only change what user asked

TOOLS:
- search_properties → search/filter properties
- get_property_details → details about result #1, #2, etc.
- get_neighborhood_info → area info/stats
- request_human_agent → save request for a real agent to contact the customer

CRITICAL — AGENT REQUESTS:
You CANNOT schedule visits, confirm appointments, or make offers. You are an AI voice assistant — only real human agents can do these things.

When the customer wants ANY of these, you MUST:
1. Ask for their name and phone: "¡Me alegra que te guste! Para que un agente te contacte, ¿me das tu nombre y número de teléfono?"
2. Once you have name + phone, call request_human_agent IMMEDIATELY with all details including property_index, summary, and their preferred times
3. Say: "¡Perfecto! He pasado tu solicitud a nuestro equipo. Un agente te contactará pronto para coordinar." Do NOT say you confirmed a visit.

Triggers — call request_human_agent when customer:
- Shows interest ("me gusta", "I like this one", "quiero más información", "this looks good")
- Wants to visit ("quiero visitarlo", "can I see it?", "puedo ir a verlo")
- Wants to talk to a person, make an offer, or negotiate
- Asks about availability or next steps

NEVER say "te confirmo la visita" or "tu cita está programada". You CANNOT confirm visits — only real agents can.
If the customer mentions preferred times (e.g. "mañana por la mañana"), include that in the summary field so the real agent knows.

PRICE CONTEXT: Madrid rent 700-2500€/mo, sale 150k-800k€. Málaga rent 600-1800€/mo, sale 120k-500k€.`,
        tools: [
          {
            type: "function",
            function: {
              name: "search_properties",
              description: "Search the property database. Call when user describes what they want or refines a previous search. When REFINING, include ALL previous filters plus the changes. Do NOT drop filters the user set before unless they explicitly ask to remove them.",
              parameters: {
                type: "object",
                properties: {
                  city: { type: "string", description: 'City to search in. MUST be "Madrid" or "Málaga". Infer from neighborhood: Chamberí/Salamanca/Retiro/Malasaña/Chueca/Lavapiés/Tetuán/Hortaleza/Vallecas/Arganzuela/Carabanchel/La Latina/Moncloa → "Madrid". Teatinos/Pedregalejo/El Palo/La Trinidad/Ciudad Jardín/Carranque/El Limonar/Huelin/La Malagueta → "Málaga".' },
                  operation: { type: "string", enum: ["sale", "rent"], description: "'sale' for buying/comprar, 'rent' for renting/alquiler. ALWAYS set this when the user specifies buy or rent." },
                  type: { type: "string", enum: ["apartment", "house", "villa", "penthouse", "studio", "duplex"] },
                  min_price: { type: "number", description: "Minimum price in euros. For rent: monthly. For sale: total." },
                  max_price: { type: "number", description: "Maximum price in euros. For rent: monthly. For sale: total." },
                  min_rooms: { type: "integer", description: "Minimum bedrooms." },
                  max_rooms: { type: "integer", description: "Maximum bedrooms." },
                  min_size: { type: "number", description: "Minimum size in m²." },
                  max_size: { type: "number", description: "Maximum size in m²." },
                  has_elevator: { type: "boolean" },
                  has_parking: { type: "boolean" },
                  has_terrace: { type: "boolean" },
                  has_pool: { type: "boolean" },
                  is_exterior: { type: "boolean" },
                  search: { type: "string", description: "Neighborhood, district, street name, or keywords. Examples: 'Chamberí', 'near beach', 'Salamanca'. Put the neighborhood name here." },
                  sort: { type: "string", enum: ["price_asc", "price_desc", "newest", "size_desc"] },
                },
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get_property_details",
              description: "Get details about a specific property by number or ID.",
              parameters: {
                type: "object",
                properties: {
                  property_index: { type: "integer", description: "Property number from last search (1, 2, 3...)." },
                  property_id: { type: "string" },
                },
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get_neighborhood_info",
              description: "Get neighborhood/area insights — average prices, property counts, market stats. Call when user asks about an area ('How is Chamberí?', 'Is Salamanca expensive?', 'What's the average rent in Centro?').",
              parameters: {
                type: "object",
                properties: {
                  neighborhood: { type: "string", description: "Neighborhood or district name. E.g. 'Chamberí', 'Teatinos', 'Salamanca'." },
                  city: { type: "string", description: '"Madrid" or "Málaga". Infer from neighborhood name. Helps narrow results.' },
                },
                required: ["neighborhood"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "request_human_agent",
              description: "Save a request for a human agent to contact the customer. Call this when: (1) customer shows interest in a specific property ('me gusta', 'I like this', 'quiero más información', 'can I visit?'), (2) customer explicitly asks for a human agent, (3) customer wants to schedule a visit or make an offer. ALWAYS collect name and phone first.",
              parameters: {
                type: "object",
                properties: {
                  customer_name: { type: "string", description: "Customer's name." },
                  customer_phone: { type: "string", description: "Customer's phone number." },
                  customer_email: { type: "string", description: "Customer's email (optional)." },
                  summary: { type: "string", description: "Brief summary of what the customer is looking for and what was discussed." },
                  looking_for: { type: "string", description: "What type of property they want." },
                  budget: { type: "string", description: "Their budget range." },
                  preferred_area: { type: "string", description: "Preferred city/neighborhood." },
                  property_index: { type: "integer", description: "Property number from last search that the customer is interested in (1, 2, 3...). Include this if the customer liked a specific property." },
                },
                required: ["customer_name", "customer_phone", "summary"],
              },
            },
          },
        ],
      },
      voice: VOICE_MAP[lang] || VOICE_MAP.es,
      // ── Conversation behavior ──
      interruptionsEnabled: true,
      numWordsToInterruptAssistant: 2,
      backgroundDenoisingEnabled: true,
      backchannelingEnabled: false,
      responseDuration: 0.8,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 600,
      endCallMessage: END_MESSAGES[lang] || END_MESSAGES.es,
      transcriber: {
        provider: "deepgram",
        model: "nova-3",
        // Use Spanish for Spanish speakers (much better accuracy for neighborhood names)
        // Falls back to multi for other languages
        language: lang === "es" ? "es" : lang === "en" ? "en" : lang === "fr" ? "fr" : lang === "de" ? "de" : lang === "it" ? "it" : "multi",
      },
    },
  };
}

// ── GET /api/vapi/assistant-config?lang=en ──────────────────
router.get("/assistant-config", (req, res) => {
  const lang = req.query.lang || "es";
  res.json(getAssistantConfig(lang));
});

module.exports = router;
