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
  try {
    await AgentRequest.create({
      customerName: params.customer_name || "",
      customerPhone: params.customer_phone || "",
      customerEmail: params.customer_email || "",
      language: session.lang || "es",
      summary: params.summary || "Customer requested to speak with an agent",
      lookingFor: params.looking_for || "",
      budget: params.budget || "",
      preferredArea: params.preferred_area || "",
      source: "voice",
      callId: callId || null,
    });
    return "DONE: Request saved. A human agent will contact the customer soon.";
  } catch (err) {
    console.error("[VAPI] Request agent error:", err.message);
    return "Request saved. An agent will contact you soon.";
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

      const toolCallList = message.toolCallList || message.toolWithToolCallList || [];
      const s = getStrings(session.lang);
      const results = [];

      for (const tc of toolCallList) {
        const toolName = tc.name || tc.function?.name;
        const toolCallId = tc.id || tc.toolCall?.id;
        const params = tc.parameters || tc.arguments || tc.toolCall?.parameters || {};

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

// ── Language-specific Azure voices for natural TTS ──────────
const AZURE_VOICES = {
  es: "es-ES-ElviraNeural",
  en: "en-US-JennyNeural",
  fr: "fr-FR-DeniseNeural",
  de: "de-DE-KatjaNeural",
  it: "it-IT-ElsaNeural",
  nl: "nl-NL-ColetteNeural",
  ru: "ru-RU-SvetlanaNeural",
  pl: "pl-PL-ZofiaNeural",
  da: "da-DK-ChristelNeural",
  sv: "sv-SE-SofieNeural",
  fi: "fi-FI-NooraNeural",
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
        systemMessage: `You are Sofia, a deeply knowledgeable senior real estate consultant at Grupo Ideal Home — specializing in properties in Madrid and Málaga, Spain. 15 years of experience. You genuinely care about finding the perfect home for every client.

LANGUAGE: Detect and match the user's language. Supported: es, en, fr, de, it, nl, ru, pl, da, sv, fi. Default: Spanish.

PERSONALITY — You are a trusted advisor, NOT a chatbot:
- Speak like a knowledgeable friend — warm, confident, natural
- Use natural conversational fillers: "a ver...", "¡oye, qué bien!", "mira...", "fíjate que..."
- Show genuine enthusiasm for great matches: "¡Este te va a encantar!"
- Be empathetic about budget constraints: "Entiendo, a ver qué encontramos"
- Share brief market insights: "Esa zona ha subido bastante, pero hay oportunidades"

CONVERSATION RULES — THIS IS A PHONE CALL:
- MAX 1-2 short sentences per turn. Like a real phone call.
- Give the overview, NOT a list: "Encontré 23 pisos, desde 180k en Teatinos — ¿te cuento los mejores?"
- ONLY give details when asked. Never volunteer full property specs unprompted.
- ONE question per turn. Never stack questions.
- When giving results, use numbers: "El primero está en Chamberí, 2 habitaciones por 1.200€. El segundo..."
- If no results: suggest alternatives — "No encontré exactamente eso, pero en la zona de al lado hay opciones interesantes"

TOOL PARAMETER RULES (follow EXACTLY):
1. OPERATION: rent/alquiler/louer/miete → "rent". buy/comprar/acheter/kaufen → "sale". ALWAYS set when specified.
2. CITY: Infer from neighborhood:
   - Madrid: Chamberí, Salamanca, Retiro, Malasaña, Chueca, Lavapiés, Centro, Tetuán, Hortaleza, Vallecas, Arganzuela, Carabanchel, La Latina, Moncloa, Usera, Prosperidad, Chamartín
   - Málaga: Teatinos, Pedregalejo, El Palo, La Trinidad, Ciudad Jardín, Carranque, El Limonar, Huelin, La Malagueta
   - "Centro" is ambiguous — ask which city
3. SEARCH: Put neighborhood/district/street in "search" parameter
4. REFINEMENT: When user says "cheaper/bigger/with pool" — keep ALL previous filters, change only what they asked
5. NEVER guess parameters. If unsure, ASK.

TOOLS:
- search_properties → when they describe what they want
- get_property_details → when they ask about a specific result (#1, #2, etc.)
- get_neighborhood_info → when they ask about an area
- request_human_agent → when they want a person. Collect name + phone first.

PRICE CONTEXT:
- Madrid rent: 700-2,500€/month | Madrid sale: 150,000-800,000€
- Málaga rent: 600-1,800€/month | Málaga sale: 120,000-500,000€`,
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
              description: "Save a request for a human agent to contact the customer. Call ONLY when the customer explicitly wants to talk to a real person. Collect their name and phone number first.",
              parameters: {
                type: "object",
                properties: {
                  customer_name: { type: "string", description: "Customer's name." },
                  customer_phone: { type: "string", description: "Customer's phone number." },
                  customer_email: { type: "string", description: "Customer's email (optional)." },
                  summary: { type: "string", description: "Brief summary of what the customer is looking for and discussed." },
                  looking_for: { type: "string", description: "What type of property they want." },
                  budget: { type: "string", description: "Their budget range." },
                  preferred_area: { type: "string", description: "Preferred city/neighborhood." },
                },
                required: ["customer_name", "customer_phone", "summary"],
              },
            },
          },
        ],
      },
      voice: {
        provider: "azure",
        voiceId: AZURE_VOICES[lang] || AZURE_VOICES.es,
      },
      // ── Conversation behavior ──
      // Let user interrupt anytime — AI stops talking and listens
      interruptionsEnabled: true,
      // How many words AI says before interruption is possible (low = more responsive)
      numWordsToInterruptAssistant: 1,
      // Background noise reduction for cleaner voice input
      backgroundDenoisingEnabled: true,
      // Natural backchannel sounds ("mm-hmm", "okay") while user talks
      backchannelingEnabled: true,
      // Shorter silence before AI considers user done talking
      responseDuration: 0.6,
      silenceTimeoutSeconds: 20,
      maxDurationSeconds: 600,
      endCallMessage: END_MESSAGES[lang] || END_MESSAGES.es,
      transcriber: {
        provider: "deepgram",
        model: "nova-3",
        language: "multi",
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
