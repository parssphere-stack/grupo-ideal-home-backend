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

  if (searchResult.total === 0) return s.noResults;

  const count = Math.min(5, searchResult.properties.length);
  const lines = [`${s.found(searchResult.total)}. ${s.showing(count)}:\n`];

  searchResult.properties.forEach((p, i) => {
    const parts = [];
    parts.push(s.number(i + 1));
    if (p.title) parts.push(p.title);
    parts.push(`${p.price?.toLocaleString("es-ES")}€`);
    if (p.operation === "rent") parts.push(s.monthly);
    if (p.rooms) parts.push(s.rooms(p.rooms));
    if (p.size) parts.push(s.sqm(p.size));
    if (p.location?.neighborhood) parts.push(`${s.in} ${p.location.neighborhood}`);
    else if (p.location?.district) parts.push(`${s.in} ${p.location.district}`);
    if (p.hasPool) parts.push(s.withPool);
    if (p.hasTerrace) parts.push(s.withTerrace);
    if (p.hasParking) parts.push(s.withParking);
    lines.push(parts.join(", ") + ".");
  });

  if (searchResult.total > 5) {
    lines.push(`\n${s.moreAvail(searchResult.total - 5)}`);
  }

  return lines.join("\n");
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

  const daysOnMarket = property.scraped_at
    ? Math.floor((Date.now() - new Date(property.scraped_at).getTime()) / 86400000)
    : null;

  const p = property;
  const details = [];
  details.push(p.title || "—");
  details.push(`${s.price}: ${p.price?.toLocaleString("es-ES")}€${p.operation === "rent" ? ` ${s.monthly}` : ""}`);
  if (p.size || p.features?.size_sqm) details.push(`${s.size}: ${p.size || p.features?.size_sqm} m²`);
  if (p.rooms || p.features?.bedrooms) details.push(`${p.rooms || p.features?.bedrooms} ${s.bedrooms}`);
  if (p.bathrooms || p.features?.bathrooms) details.push(`${p.bathrooms || p.features?.bathrooms} ${s.bathrooms}`);
  if (p.floor || p.features?.floor) details.push(`${s.floor} ${p.floor || p.features?.floor}`);
  if (p.location?.neighborhood) details.push(`${s.neighborhood}: ${p.location.neighborhood}`);
  if (p.location?.district) details.push(`${s.district}: ${p.location.district}`);
  if (p.location?.city) details.push(`${s.city}: ${p.location.city}`);

  const feats = [];
  if (p.hasPool || p.features?.has_pool) feats.push(s.withPool);
  if (p.hasTerrace || p.features?.has_terrace) feats.push(s.withTerrace);
  if (p.hasParking || p.features?.has_parking) feats.push(s.withParking);
  if (p.hasLift || p.features?.has_elevator) feats.push(s.withLift);
  if (p.exterior || p.features?.is_exterior) feats.push(s.exterior);
  if (feats.length) details.push(`${s.features}: ${feats.join(", ")}`);

  if (p.price_per_sqm || p.priceByArea) {
    details.push(`${s.pricePerSqm}: ${(p.price_per_sqm || p.priceByArea)?.toLocaleString("es-ES")}€`);
  }
  if (daysOnMarket !== null) details.push(s.daysOnMarket(daysOnMarket));

  return details.join(". ") + ".";
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
  es: "¡Hola! Soy Sofia, tu asesora inmobiliaria de Grupo Ideal Home. ¿En qué puedo ayudarte? Puedo buscar pisos en Madrid o Málaga, en venta o alquiler.",
  en: "Hi! I'm Sofia, your real estate advisor at Grupo Ideal Home. How can I help you? I can search apartments in Madrid or Málaga, for sale or rent.",
  fr: "Bonjour! Je suis Sofia, votre conseillère immobilière chez Grupo Ideal Home. Comment puis-je vous aider? Je peux chercher des appartements à Madrid ou Málaga.",
  de: "Hallo! Ich bin Sofia, Ihre Immobilienberaterin bei Grupo Ideal Home. Wie kann ich Ihnen helfen? Ich kann Wohnungen in Madrid oder Málaga suchen.",
  it: "Ciao! Sono Sofia, la tua consulente immobiliare di Grupo Ideal Home. Come posso aiutarti? Posso cercare appartamenti a Madrid o Málaga.",
  nl: "Hallo! Ik ben Sofia, uw vastgoedadviseur bij Grupo Ideal Home. Hoe kan ik u helpen? Ik kan woningen zoeken in Madrid of Málaga.",
  ru: "Привет! Я София, ваш консультант по недвижимости в Grupo Ideal Home. Чем могу помочь? Могу найти квартиры в Мадриде или Малаге.",
  pl: "Cześć! Jestem Sofia, twoja doradczyni nieruchomości w Grupo Ideal Home. Jak mogę pomóc? Mogę szukać mieszkań w Madrycie lub Maladze.",
  da: "Hej! Jeg er Sofia, din ejendomsrådgiver hos Grupo Ideal Home. Hvordan kan jeg hjælpe? Jeg kan søge lejligheder i Madrid eller Málaga.",
  sv: "Hej! Jag är Sofia, din fastighetsrådgivare på Grupo Ideal Home. Hur kan jag hjälpa dig? Jag kan söka lägenheter i Madrid eller Málaga.",
  fi: "Hei! Olen Sofia, kiinteistöneuvojasi Grupo Ideal Homessa. Miten voin auttaa? Voin etsiä asuntoja Madridista tai Málagasta.",
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

function getAssistantConfig(lang = "es") {
  return {
    assistant: {
      name: "Sofia",
      firstMessage: FIRST_MESSAGES[lang] || FIRST_MESSAGES.es,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        systemMessage: `You are Sofia, senior real estate consultant at Grupo Ideal Home — a platform for PRIVATE SELLER properties (no agencies) in Madrid and Málaga, Spain.

CRITICAL LANGUAGE RULE: Detect the language the user speaks and ALWAYS respond in that SAME language. Supported languages: Spanish, English, French, German, Italian, Dutch, Russian, Polish, Danish, Swedish, Finnish. Default to Spanish if unsure.

BEHAVIOR:
- When the user describes what they want, ALWAYS call search_properties with the correct filters
- When refining ("cheaper", "with parking", "another area"), remember previous criteria and only change what was requested
- Summarize results briefly and naturally — how many found, price range, neighborhoods
- If no results, suggest broadening: remove a filter, increase budget, try another area
- If you need more info, ask 1-2 questions (city? budget? buy or rent?)
- Be warm, professional, and concise
- Refer to properties by number (#1, #2) so the user can ask about them
- Keep voice responses SHORT — max 3-4 sentences per turn, this is a phone call not a text chat

NEIGHBORHOODS:
Madrid: Chamberí, Salamanca, Retiro, Malasaña, Chueca, Lavapiés, Centro, Tetuán, Hortaleza, Vallecas, Arganzuela, Carabanchel, La Latina, Moncloa
Málaga: Teatinos, Centro, Pedregalejo, El Palo, La Trinidad, Ciudad Jardín, Carranque, El Limonar, Huelin

PRICE CONTEXT:
- Madrid rent: 700-2,500€/month
- Madrid sale: 150,000-800,000€
- Málaga rent: 600-1,800€/month
- Málaga sale: 120,000-500,000€`,
        tools: [
          {
            type: "function",
            function: {
              name: "search_properties",
              description: "Search the property database. Call when the user describes what they're looking for or wants to refine a previous search.",
              parameters: {
                type: "object",
                properties: {
                  city: { type: "string", description: 'City: "Madrid" or "Málaga". Omit to search all.' },
                  operation: { type: "string", enum: ["sale", "rent"], description: "'sale' for buying, 'rent' for renting." },
                  type: { type: "string", enum: ["apartment", "house", "villa", "penthouse", "studio", "duplex"], description: "Property type." },
                  min_price: { type: "number", description: "Minimum price in euros." },
                  max_price: { type: "number", description: "Maximum price in euros." },
                  min_rooms: { type: "integer", description: "Minimum bedrooms." },
                  max_rooms: { type: "integer", description: "Maximum bedrooms." },
                  min_size: { type: "number", description: "Minimum size in m²." },
                  max_size: { type: "number", description: "Maximum size in m²." },
                  has_elevator: { type: "boolean", description: "With elevator." },
                  has_parking: { type: "boolean", description: "With parking." },
                  has_terrace: { type: "boolean", description: "With terrace." },
                  has_pool: { type: "boolean", description: "With pool." },
                  is_exterior: { type: "boolean", description: "Exterior-facing." },
                  search: { type: "string", description: "Free text: neighborhood, street, keywords." },
                  sort: { type: "string", enum: ["price_asc", "price_desc", "newest", "size_desc"], description: "Sort order." },
                },
              },
            },
          },
          {
            type: "function",
            function: {
              name: "get_property_details",
              description: "Get details about a specific property. Call when user asks about a property ('tell me about the first one', 'more info on #3', 'how long has it been listed').",
              parameters: {
                type: "object",
                properties: {
                  property_index: { type: "integer", description: "Property number from last search (1, 2, 3...)." },
                  property_id: { type: "string", description: "Property ID or code." },
                },
              },
            },
          },
        ],
      },
      voice: {
        provider: "11labs",
        voiceId: "aura-luna-es",
      },
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 600,
      endCallMessage: END_MESSAGES[lang] || END_MESSAGES.es,
    },
  };
}

// ── GET /api/vapi/assistant-config?lang=en ──────────────────
router.get("/assistant-config", (req, res) => {
  const lang = req.query.lang || "es";
  res.json(getAssistantConfig(lang));
});

module.exports = router;
