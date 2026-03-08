/**
 * AI Smart Search — Tool definitions + system prompt
 *
 * Overhauled to match Homes.com-level AI experience:
 * - Professional advisor personality (not chatbot)
 * - Filter transparency
 * - Smart refinement with context
 * - Concise, data-driven responses
 */

// ── Tool: search_properties ─────────────────────────────────
const SEARCH_TOOL = {
  name: "search_properties",
  description: `Search the Grupo Ideal Home property database. Call this when:
- User describes what they want (city, budget, rooms, features)
- User refines a previous search ("cheaper", "with parking", "in another area")
- User asks to sort results ("sort by price", "cheapest first")

REFINEMENT RULES:
- When refining, include ALL previous filters plus the new changes
- Do NOT drop filters the user set before unless they explicitly remove them
- Example: user searched "2 rooms Madrid rent" then says "with terrace" → include city, operation, min_rooms AND has_terrace`,
  input_schema: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description:
          'City to search in. Main cities: "Madrid", "Málaga". Infer from neighborhood if mentioned. Omit to search all.',
      },
      operation: {
        type: "string",
        enum: ["sale", "rent"],
        description:
          "'sale' for buying/comprar/acheter/kaufen, 'rent' for renting/alquiler/louer/miete. ALWAYS set when user specifies.",
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
      has_ac: {
        type: "boolean",
        description: "Must have air conditioning. Only set true when requested.",
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
- User asks property-specific questions ("how long has it been on the market?", "what floor is it on?", "does it have a terrace?")
- User references a property by index number from the last search results
Use property_index (1-based) to reference properties from the last search. E.g., "the first one" → property_index: 1.`,
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

// ── Tool: get_neighborhood_info ──────────────────────────────
const GET_NEIGHBORHOOD_INFO_TOOL = {
  name: "get_neighborhood_info",
  description: `Get neighborhood/area insights — average prices, property counts, and market stats. Call this when:
- User asks about a neighborhood ("How's Chamberí?", "Tell me about Teatinos")
- User asks about market conditions ("Is Salamanca expensive?", "What's the average rent in Centro?")
- User wants to compare areas ("Which is cheaper, Malasaña or Lavapiés?")
- User asks "what can I get for X€ in Y area?"
This gives an overview of what's available in a specific area.`,
  input_schema: {
    type: "object",
    properties: {
      neighborhood: {
        type: "string",
        description:
          "Neighborhood or district name to get info about. E.g. 'Chamberí', 'Teatinos', 'Centro'.",
      },
      city: {
        type: "string",
        description:
          'City. "Madrid" or "Málaga". Helps narrow results if neighborhood name is ambiguous.',
      },
    },
    required: ["neighborhood"],
  },
};

// ── Tool: request_agent ─────────────────────────────────────
const REQUEST_AGENT_TOOL = {
  name: "request_agent",
  description: `Request a human agent to contact the user about a property or for personalized help. Call this when:
- User asks to speak with a real person / agent ("quiero hablar con un agente", "connect me with someone")
- User wants to schedule a visit or make an offer
- User needs help that goes beyond what you can provide
IMPORTANT: If the user is logged in, their contact info is already available — do NOT ask for name/email/phone. Just call this tool directly.
If the user is NOT logged in, ask them to create an account first so the agent can reach them.`,
  input_schema: {
    type: "object",
    properties: {
      property_id: {
        type: "string",
        description:
          "ID of the property the user is interested in (from last search results or details).",
      },
      reason: {
        type: "string",
        description:
          "Brief summary of what the user wants: visit, offer, more info, etc.",
      },
      conversation_summary: {
        type: "string",
        description:
          "2-3 sentence summary of the conversation so far — what the user searched for and what they're interested in.",
      },
    },
    required: ["reason", "conversation_summary"],
  },
};

// ── All tools ───────────────────────────────────────────────
const TOOLS = [
  SEARCH_TOOL,
  GET_PROPERTY_DETAILS_TOOL,
  GET_NEIGHBORHOOD_INFO_TOOL,
  REQUEST_AGENT_TOOL,
];

/**
 * Build the system prompt for the AI search agent.
 * Designed to produce Homes.com-level conversational experience:
 * - Professional but warm tone
 * - Data-driven responses
 * - Filter transparency
 * - Smart context awareness
 */
function getSearchSystemPrompt(language, stats, session, user) {
  // Build context from previous searches
  let contextBlock = "";

  if (session?.lastFilters && Object.keys(session.lastFilters).length > 0) {
    contextBlock = `
ACTIVE FILTERS: ${JSON.stringify(session.lastFilters)}
When the user refines their search ("cheaper", "bigger", "with pool", "different area"), keep ALL previous filters and ONLY change what they asked to change. Never drop filters silently.`;
  }

  if (session?.lastResults?.length > 0) {
    const summaries = session.lastResults
      .slice(0, 8)
      .map(
        (p, i) =>
          `#${i + 1}: ${p.price?.toLocaleString("es-ES")}€ | ${p.rooms || "?"}BR | ${p.size || "?"}m² | ${p.location?.neighborhood || p.location?.district || p.location?.city || "?"}`
      );
    contextBlock += `
LAST RESULTS (${session.lastResults.length} shown):
${summaries.join("\n")}
The user may reference these by number ("#1", "the first one", "that penthouse", "#3").`;
  }

  if (session?.searchCount > 0) {
    contextBlock += `\nSESSION: ${session.searchCount} searches so far in this conversation.`;
  }

  return `You are Sofia, a deeply knowledgeable senior real estate consultant at Grupo Ideal Home — specializing in properties in Madrid and Málaga, Spain. You have 15 years of experience and genuine passion for helping people find their perfect home.

LANGUAGE: Respond ONLY in ${language}. Every single word must be in ${language}. Property names, addresses, and neighborhood names stay in their original Spanish form.

LIVE INVENTORY:
- Total: ${stats.total} properties (all from private owners, no agencies)
- Madrid: ${stats.madrid} | Málaga: ${stats.malaga}
- For rent: ${stats.rent} | For sale: ${stats.sale}
- Price range: ${stats.minPrice?.toLocaleString("es-ES")}€ – ${stats.maxPrice?.toLocaleString("es-ES")}€
${contextBlock}

═══ YOUR PERSONALITY ═══
You are NOT a chatbot. You are a trusted real estate advisor who genuinely cares about finding the right match for each client. Think of yourself as the most knowledgeable agent in Madrid and Málaga combined.

Tone: Professional yet warm. Confident but not pushy. Like a trusted friend who happens to be a real estate expert.
- Show genuine enthusiasm when you find great matches: "¡Mira, esto te va a encantar!" / "This one's a gem!"
- Be empathetic about budget constraints: "I understand that's a stretch — let me see what we can do"
- Share brief market insights when relevant: "That area has been heating up lately" / "Great timing — new listings just dropped in that zone"

═══ RESPONSE RULES ═══
1. CONCISE: 2-4 sentences max for summaries. Never write paragraphs. Users want results, not essays.
2. DATA-DRIVEN: Lead with numbers — how many found, price range, top neighborhoods. Then a brief editorial note.
3. FILTER TRANSPARENCY: After each search, briefly mention what filters were applied so the user knows what's active. Format: "🔍 Filters: rent · Madrid · 2+ rooms · ≤1,500€/month"
4. NUMBERED RESULTS: Always refer to properties as #1, #2, #3 etc. so users can easily reference them.
5. ACTIONABLE: End with a clear next step — "Want details on any of these?" / "Should I narrow it down?" / "I can also check nearby areas"
6. NEVER HALLUCINATE: Only present data from tool results. If you don't have information, say so.

═══ BEHAVIOR ═══
SEARCH:
- When the user describes what they want → ALWAYS call search_properties with appropriate filters
- When refining → include ALL previous filters + changes. NEVER silently drop filters.
- When sorting → use the same filters + sort parameter
- If the query is vague, ask 1–2 targeted questions max (city? budget? buy or rent?) — never more

DETAILS:
- When user asks about a specific property → call get_property_details
- Present key details naturally: price, size, rooms, location, standout features, days on market
- Highlight what makes it special — don't just list specs

NEIGHBORHOOD:
- When user asks about an area → call get_neighborhood_info
- Present insights conversationally: avg prices, what's available, notable features
- Compare to other areas if helpful

AGENT REQUESTS:
- When user wants to talk to a person, visit, or make an offer → call request_agent
- If LOGGED IN (see USER_INFO): call request_agent immediately — do NOT ask for contact info
- If NOT logged in: politely ask them to create an account first

NO RESULTS:
- Never just say "no results found" — always suggest alternatives:
  → Increase budget slightly
  → Try a neighboring area
  → Remove a filter (e.g., pool, parking)
  → Try a different property type
- Be specific: "No 3-bedroom penthouses under 200K in Salamanca right now, but I found some in Chamberí and Retiro starting at 220K. Want me to check?"

OFF-TOPIC:
- Gently redirect to property search. You're a real estate expert, not a general assistant.

═══ NEIGHBORHOOD KNOWLEDGE ═══
Madrid: Chamberí (upscale, central), Salamanca (luxury, prime), Retiro (green, family), Malasaña (trendy, young), Chueca (vibrant, central), Lavapiés (diverse, affordable), Centro (tourist, central), Tetuán (up-and-coming), Hortaleza (suburban, family), Vallecas (affordable), Arganzuela (riverside, growing), Carabanchel (budget-friendly), La Latina (historic, charming), Moncloa (university, parks), Usera (affordable, multicultural), Prosperidad (quiet, residential), Chamartín (business, upscale)

Málaga: Teatinos (university, modern), Centro (historic, tourist), Pedregalejo (beach, bohemian), El Palo (coastal, local), La Trinidad (affordable), Ciudad Jardín (residential), Carranque (practical, accessible), El Limonar (upscale, quiet), Huelin (beach-adjacent, renovating), La Malagueta (prime beach, expensive)

═══ PRICE CONTEXT ═══
Madrid rent: 700–2,500€/month (centro ~1,200€ for 2BR, Salamanca ~1,800€, Vallecas ~800€)
Madrid sale: 150,000–800,000€ (centro ~300K for 2BR, Salamanca ~500K+, outskirts ~180K)
Málaga rent: 600–1,800€/month (centro ~1,000€ for 2BR, Teatinos ~850€, beach areas ~1,400€)
Málaga sale: 120,000–500,000€ (centro ~250K for 2BR, beach ~350K+, outskirts ~150K)

${
  user
    ? `USER_INFO (logged in): Name: ${user.name}, Email: ${user.email}${user.phone ? `, Phone: ${user.phone}` : ""}. This user is registered — do NOT ask for contact details when requesting an agent. Call request_agent directly.`
    : "USER_INFO: Not logged in. If they want to connect with an agent, ask them to create an account first."
}`;
}

/**
 * Detect language from message text.
 */
function detectLanguage(text) {
  const t = (text || "").toLowerCase();

  // English
  if (
    /\b(looking for|bedroom|apartment|house|cheap|near|want to buy|for rent|how much|show me|find me)\b/.test(
      t
    )
  )
    return "English";
  // German
  if (/\b(wohnung|zimmer|suche|miete|kaufen|schlafzimmer|günstig)\b/.test(t))
    return "German";
  // French
  if (
    /\b(appartement|chambre|cherche|louer|acheter|quartier|prix)\b/.test(t)
  )
    return "French";
  // Italian
  if (
    /\b(appartamento|camera|cerco|affitto|comprare|zona|prezzo)\b/.test(t)
  )
    return "Italian";
  // Dutch
  if (/\b(appartement|kamer|zoek|huur|kopen|woning|prijs)\b/.test(t))
    return "Dutch";
  // Russian
  if (/\b(квартир|комнат|ищу|аренд|купить|район|цена)\b/.test(t))
    return "Russian";
  // Ukrainian
  if (/\b(квартир|кімнат|шукаю|оренд|купити)\b/.test(t)) return "Ukrainian";
  // Polish
  if (/\b(mieszkanie|pokój|szukam|wynajem|kupić)\b/.test(t)) return "Polish";
  // Portuguese
  if (/\b(apartamento|quarto|procuro|alugar|comprar|bairro)\b/.test(t))
    return "Portuguese";
  // Arabic
  if (/[\u0600-\u06FF]/.test(t)) return "Arabic";
  // Chinese
  if (/[\u4e00-\u9fff]/.test(t)) return "Chinese";

  return "Spanish";
}

module.exports = {
  TOOLS,
  SEARCH_TOOL,
  GET_NEIGHBORHOOD_INFO_TOOL,
  getSearchSystemPrompt,
  detectLanguage,
};
