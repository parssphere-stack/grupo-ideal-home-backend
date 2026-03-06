/**
 * AI Smart Search — Tool definition + system prompt
 */

const SEARCH_TOOL = {
  name: "search_properties",
  description:
    "Search the Grupo Ideal Home property database. Call this whenever the user describes what they are looking for. Returns matching properties with price, location, size, rooms, features, and images.",
  input_schema: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description:
          'City to search in. Main cities: "Madrid", "Málaga". Omit to search all.',
      },
      operation: {
        type: "string",
        enum: ["sale", "rent"],
        description: "'sale' for buying, 'rent' for renting.",
      },
      type: {
        type: "string",
        enum: [
          "apartment",
          "house",
          "villa",
          "penthouse",
          "studio",
          "duplex",
          "loft",
          "land",
          "commercial",
        ],
        description:
          "Property type. 'apartment' for flats/pisos, 'house' for houses/chalets/casas, 'villa' for villas, 'penthouse' for penthouses/áticos, 'studio' for studios/estudios.",
      },
      min_price: {
        type: "number",
        description:
          "Minimum price in euros. For rent: monthly. For sale: total price.",
      },
      max_price: {
        type: "number",
        description:
          "Maximum price in euros. For rent: monthly. For sale: total price.",
      },
      min_rooms: {
        type: "integer",
        description: "Minimum number of bedrooms.",
      },
      max_rooms: {
        type: "integer",
        description: "Maximum number of bedrooms.",
      },
      min_size: {
        type: "number",
        description: "Minimum size in square meters.",
      },
      max_size: {
        type: "number",
        description: "Maximum size in square meters.",
      },
      has_elevator: {
        type: "boolean",
        description: "Must have elevator/lift. Only set true when requested.",
      },
      has_parking: {
        type: "boolean",
        description: "Must have parking. Only set true when requested.",
      },
      has_terrace: {
        type: "boolean",
        description: "Must have terrace/balcony. Only set true when requested.",
      },
      has_pool: {
        type: "boolean",
        description: "Must have swimming pool. Only set true when requested.",
      },
      is_exterior: {
        type: "boolean",
        description: "Must be exterior-facing. Only set true when requested.",
      },
      search: {
        type: "string",
        description:
          'Free text search for neighborhood, district, street, or description keywords. Examples: "Chamberí", "near beach", "sea views", "Salamanca".',
      },
      sort: {
        type: "string",
        enum: ["price_asc", "price_desc", "newest", "size_desc"],
        description: "Sort order. Default: newest.",
      },
    },
    required: [],
  },
};

/**
 * Build the system prompt for the AI search agent.
 * @param {string} language - Detected language name (e.g. "Spanish", "English")
 * @param {Object} stats - Live inventory stats
 */
function getSearchSystemPrompt(language, stats) {
  return `You are Sofia, senior real estate consultant at Grupo Ideal Home — a platform for PRIVATE SELLER properties (no agencies) in Madrid and Málaga, Spain.

LANGUAGE: Respond ONLY in ${language}. Every word must be in ${language}. Property names and addresses stay in Spanish.

INVENTORY: ${stats.total} properties | Madrid: ${stats.madrid} | Málaga: ${stats.malaga} | Rent: ${stats.rent} | Sale: ${stats.sale} | Price: ${stats.minPrice}–${stats.maxPrice}€

BEHAVIOR:
- When the user describes what they want, ALWAYS call search_properties with the right filters
- When refining ("cheaper", "with parking", "different area"), remember previous criteria and adjust only what changed
- Give a brief natural-language summary of results (2-4 sentences): how many found, price range, neighborhoods represented
- If no results match, suggest broadening: remove a filter, increase budget, try another area
- If you need more info to search effectively, ask 1-2 clarifying questions (city? budget? buy or rent?)
- Be warm and professional, like a trusted advisor
- When recommending neighborhoods, briefly explain why they fit

NEIGHBORHOODS:
Madrid: Chamberí, Salamanca, Retiro, Malasaña, Chueca, Lavapiés, Centro, Tetuán, Hortaleza, Vallecas, Arganzuela, Carabanchel, La Latina, Moncloa, Usera, Prosperidad, Chamartín
Málaga: Teatinos, Centro, Pedregalejo, El Palo, La Trinidad, Ciudad Jardín, Carranque, El Limonar, Huelin, La Malagueta

PRICE CONTEXT:
- Madrid rent: 700-2,500€/month depending on zone and size
- Madrid sale: 150,000-800,000€ for apartments
- Málaga rent: 600-1,800€/month
- Málaga sale: 120,000-500,000€ for apartments`;
}

/**
 * Detect language from message text.
 * @param {string} text
 * @returns {string} Language name
 */
function detectLanguage(text) {
  const t = (text || "").toLowerCase();

  if (/\b(looking for|bedroom|apartment|house|cheap|near|want to buy|for rent)\b/.test(t))
    return "English";
  if (/\b(wohnung|zimmer|suche|miete|kaufen)\b/.test(t)) return "German";
  if (/\b(appartement|chambre|cherche|louer|acheter)\b/.test(t)) return "French";
  if (/\b(appartamento|camera|cerco|affitto|comprare)\b/.test(t)) return "Italian";
  if (/\b(appartement|kamer|zoek|huur|kopen)\b/.test(t)) return "Dutch";
  if (/\b(квартир|комнат|ищу|аренд|купить)\b/.test(t)) return "Russian";
  if (/\b(квартир|кімнат|шукаю|оренд|купити)\b/.test(t)) return "Ukrainian";

  // Default to Spanish
  return "Spanish";
}

module.exports = { SEARCH_TOOL, getSearchSystemPrompt, detectLanguage };
