/**
 * AI Smart Search — Tool definitions + system prompt
 *
 * Tools: search_properties, get_property_details
 * System prompt: conversational, context-aware, with session memory
 */

// ── Tool: search_properties ─────────────────────────────────
const SEARCH_TOOL = {
  name: "search_properties",
  description: `Search the Grupo Ideal Home property database. Call this when:
- User describes what they want (city, budget, rooms, features)
- User refines a previous search ("cheaper", "with parking", "in another area")
- User asks to sort results ("sort by price", "cheapest first")
When REFINING, include ALL previous filters plus the changes. Do NOT drop filters the user set before unless they explicitly ask to remove them.`,
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
        description:
          "Sort order. Use price_asc for 'cheapest first', price_desc for 'most expensive first', newest for 'most recent', size_desc for 'largest first'. Default: newest.",
      },
    },
    required: [],
  },
};

// ── Tool: get_property_details ──────────────────────────────
const GET_PROPERTY_DETAILS_TOOL = {
  name: "get_property_details",
  description: `Get detailed information about a specific property. Call this when:
- User asks about a specific property ("tell me about the first one", "more info on #3")
- User asks property-specific questions ("how long has it been on the market?", "what floor is it on?")
- User references a property by index number from the last search results
Use property_index (1-based) to reference properties from the last search.`,
  input_schema: {
    type: "object",
    properties: {
      property_index: {
        type: "integer",
        description:
          "1-based index of the property in the last search results. E.g., 1 for first, 2 for second.",
      },
      property_id: {
        type: "string",
        description:
          "Property ID or code. Use this if the user specifies a code directly.",
      },
    },
    required: [],
  },
};

// ── All tools ───────────────────────────────────────────────
const TOOLS = [SEARCH_TOOL, GET_PROPERTY_DETAILS_TOOL];

/**
 * Build the system prompt for the AI search agent.
 * @param {string} language - Detected language name
 * @param {Object} stats - Live inventory stats
 * @param {Object} session - Current session (for context)
 */
function getSearchSystemPrompt(language, stats, session) {
  let contextBlock = "";

  // If there are previous filters, tell Claude about them
  if (session?.lastFilters && Object.keys(session.lastFilters).length > 0) {
    contextBlock = `\nLAST SEARCH CONTEXT: The user's previous search used these filters: ${JSON.stringify(session.lastFilters)}
When the user refines ("cheaper", "bigger", "with pool"), keep all previous filters and only change what they asked to change.`;
  }

  // If there are last results, mention them
  if (session?.lastResults?.length > 0) {
    contextBlock += `\nLAST RESULTS: ${session.lastResults.length} properties were shown. The user may reference them by number (e.g., "the first one", "#3", "that penthouse").`;
  }

  return `You are Sofia, senior real estate consultant at Grupo Ideal Home — a platform for PRIVATE SELLER properties (no agencies) in Madrid and Málaga, Spain.

LANGUAGE: Respond ONLY in ${language}. Every word must be in ${language}. Property names and addresses stay in Spanish.

INVENTORY: ${stats.total} properties | Madrid: ${stats.madrid} | Málaga: ${stats.malaga} | Rent: ${stats.rent} | Sale: ${stats.sale} | Price: ${stats.minPrice}–${stats.maxPrice}€
${contextBlock}
BEHAVIOR:
- When the user describes what they want, ALWAYS call search_properties with the right filters
- When refining ("cheaper", "with parking", "different area"), remember ALL previous criteria and adjust ONLY what changed — do NOT drop previous filters
- When the user asks about a specific property ("the first one", "tell me about #3", "how long has it been listed?"), call get_property_details with the property_index
- When sorting ("sort by price", "cheapest first"), call search_properties with the same filters + sort parameter
- Give a brief, warm summary of results (2-4 sentences): how many found, price range, neighborhoods
- Refer to properties by number (#1, #2, etc.) so the user can easily reference them
- If no results match, suggest broadening: remove a filter, increase budget, try another area
- If you need more info, ask 1-2 clarifying questions (city? budget? buy or rent?)
- Be warm, professional, and concise — like a trusted advisor, not a chatbot

CONVERSATIONAL GUIDELINES:
- Greetings → Respond warmly and ask what they're looking for
- Vague requests → Ask 1-2 key questions (city, budget, buy/rent)
- Specific requests → Search immediately
- Follow-ups → Refine without losing context
- Property questions → Get details and answer specifically
- Off-topic → Gently redirect to property search

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

  return "Spanish";
}

module.exports = { TOOLS, SEARCH_TOOL, getSearchSystemPrompt, detectLanguage };
