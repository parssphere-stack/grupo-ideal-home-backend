/**
 * AI Smart Search — Conversational property search with Claude tool use
 *
 * POST /api/ai/search — natural language property search
 * GET  /api/ai/search/stats — inventory stats
 *
 * Overhauled for Homes.com-level experience:
 * - Upgraded model (claude-sonnet-4-6)
 * - Multi-tool loop with proper history management
 * - Real filter refinement (merges with previous)
 * - Filter transparency in responses
 * - Robust session trimming that preserves tool block integrity
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const { searchProperties } = require("../services/property-search.service");
const Property = require("../models/property.model");
const {
  TOOLS,
  getSearchSystemPrompt,
  detectLanguage,
} = require("../config/ai-search.config");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const InboxConversation = require("../models/inbox-conversation.model");
const JWT_SECRET = process.env.JWT_SECRET || "grupo-ideal-secret-2024";

// ── Rate limiter ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 25,
  message: { error: "Too many requests, please slow down" },
});

// ── AI Provider (Anthropic preferred, OpenAI fallback) ──────
let provider = null; // "anthropic" | "openai"
let anthropicClient = null;
let openaiClient = null;

function getProvider() {
  if (provider) return provider;

  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    provider = "anthropic";
  } else if (process.env.OPENAI_API_KEY) {
    const OpenAI = require("openai");
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    provider = "openai";
  }

  return provider;
}

// ── Convert tools to OpenAI function format ─────────────────
function toolsToOpenAI(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ── Unified AI call: returns { toolCall, text, rawContent } ─
async function callAI(systemPrompt, messages, tools) {
  const prov = getProvider();

  if (prov === "anthropic") {
    // Try preferred model, fall back to Haiku if unavailable
    const models = ["claude-sonnet-4-6-20250514", "claude-haiku-4-5-20251001"];
    let response;
    for (const model of models) {
      try {
        response = await anthropicClient.messages.create({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          tools,
          messages,
        });
        break; // success
      } catch (modelErr) {
        console.warn(`[AI Search] Model ${model} failed:`, modelErr.message);
        if (model === models[models.length - 1]) throw modelErr; // last model, propagate
      }
    }

    const toolUse = response.content.find((b) => b.type === "tool_use");
    const text = response.content.find((b) => b.type === "text")?.text || "";

    return {
      toolCall: toolUse
        ? { id: toolUse.id, name: toolUse.name, input: toolUse.input }
        : null,
      text,
      rawContent: response.content, // needed for history
      stopReason: response.stop_reason,
    };
  }

  if (prov === "openai") {
    // Convert Anthropic-style messages to OpenAI format
    const oaiMessages = [{ role: "system", content: systemPrompt }];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (
          Array.isArray(msg.content) &&
          msg.content[0]?.type === "tool_result"
        ) {
          // Tool result → OpenAI tool message
          const tr = msg.content[0];
          oaiMessages.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content:
              typeof tr.content === "string"
                ? tr.content
                : JSON.stringify(tr.content),
          });
        } else {
          oaiMessages.push({
            role: "user",
            content:
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content),
          });
        }
      } else if (msg.role === "assistant") {
        if (Array.isArray(msg.content)) {
          // Assistant with tool_use blocks
          const textPart =
            msg.content.find((b) => b.type === "text")?.text || "";
          const toolUse = msg.content.find((b) => b.type === "tool_use");
          const oaiMsg = { role: "assistant", content: textPart || null };
          if (toolUse) {
            oaiMsg.tool_calls = [
              {
                id: toolUse.id,
                type: "function",
                function: {
                  name: toolUse.name,
                  arguments: JSON.stringify(toolUse.input),
                },
              },
            ];
          }
          oaiMessages.push(oaiMsg);
        } else {
          oaiMessages.push({ role: "assistant", content: msg.content });
        }
      }
    }

    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2048,
      messages: oaiMessages,
      tools: toolsToOpenAI(tools),
    });

    const choice = response.choices[0];
    const oaiToolCall = choice.message.tool_calls?.[0];

    if (oaiToolCall) {
      // Convert OpenAI tool call to our unified format + Anthropic-style rawContent
      const input = JSON.parse(oaiToolCall.function.arguments || "{}");
      return {
        toolCall: {
          id: oaiToolCall.id,
          name: oaiToolCall.function.name,
          input,
        },
        text: choice.message.content || "",
        rawContent: [
          ...(choice.message.content
            ? [{ type: "text", text: choice.message.content }]
            : []),
          {
            type: "tool_use",
            id: oaiToolCall.id,
            name: oaiToolCall.function.name,
            input,
          },
        ],
        stopReason:
          choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
      };
    }

    return {
      toolCall: null,
      text: choice.message.content || "",
      rawContent: choice.message.content || "",
      stopReason: "end_turn",
    };
  }

  throw new Error("No AI provider configured");
}

// ── Session store (in-memory cache + MongoDB persistence) ───
const SearchSession = require("../models/search-session.model");
const memCache = new Map(); // fast in-memory cache
const MAX_HISTORY = 50; // increased from 40 for better context

async function getSession(sessionId) {
  // 1. Check memory cache first
  if (sessionId && memCache.has(sessionId)) {
    const session = memCache.get(sessionId);
    session.lastAccess = Date.now();
    return { id: sessionId, session };
  }

  // 2. Check MongoDB for existing session
  if (sessionId) {
    const dbSession = await SearchSession.findOne({
      session_id: sessionId,
    }).lean();
    if (dbSession) {
      const session = {
        messages: dbSession.messages || [],
        lastAccess: Date.now(),
        lastFilters: dbSession.lastFilters || {},
        lastResults: [], // not persisted (too large), will be re-populated on next search
        preferences: dbSession.preferences || {},
        language: dbSession.language,
        searchCount: dbSession.searchCount || 0,
        _persisted: true,
      };
      memCache.set(sessionId, session);
      return { id: sessionId, session };
    }
  }

  // 3. Create new session
  const id = sessionId || uuidv4();
  const session = {
    messages: [],
    lastAccess: Date.now(),
    lastFilters: {},
    lastResults: [],
    preferences: {},
    language: null,
    searchCount: 0,
    _persisted: false,
  };
  memCache.set(id, session);
  return { id, session };
}

// Persist session to MongoDB (non-blocking, fire-and-forget)
function persistSession(sessionId, session, language) {
  const update = {
    messages: session.messages,
    lastFilters: session.lastFilters,
    lastResultIds: (session.lastResults || [])
      .map((p) => p._id)
      .filter(Boolean),
    preferences: session.preferences,
    language: language || session.language,
    messageCount: session.messages.length,
    searchCount: session.searchCount || 0,
    lastAccess: new Date(),
  };

  SearchSession.updateOne(
    { session_id: sessionId },
    { $set: update },
    { upsert: true }
  ).catch((err) =>
    console.error("[AI Search] Session persist error:", err.message)
  );
}

// Cleanup memory cache every 10 minutes (MongoDB TTL handles DB cleanup)
setInterval(() => {
  const now = Date.now();
  const TTL = 30 * 60 * 1000;
  for (const [id, s] of memCache) {
    if (now - s.lastAccess > TTL) memCache.delete(id);
  }
}, 10 * 60 * 1000);

// ── Inventory stats cache ───────────────────────────────────
let statsCache = null;
let statsCacheTime = 0;
const STATS_TTL = 5 * 60 * 1000; // 5 minutes

async function getInventoryStats() {
  if (statsCache && Date.now() - statsCacheTime < STATS_TTL) return statsCache;

  const [result] = await Property.aggregate([
    { $match: { status: "active", is_particular: true } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        sale: {
          $sum: { $cond: [{ $eq: ["$operation", "sale"] }, 1, 0] },
        },
        rent: {
          $sum: { $cond: [{ $eq: ["$operation", "rent"] }, 1, 0] },
        },
        madrid: {
          $sum: {
            $cond: [
              { $regexMatch: { input: "$location.city", regex: /madrid/i } },
              1,
              0,
            ],
          },
        },
        malaga: {
          $sum: {
            $cond: [
              { $regexMatch: { input: "$location.city", regex: /m.laga/i } },
              1,
              0,
            ],
          },
        },
        minPrice: { $min: "$price" },
        maxPrice: { $max: "$price" },
      },
    },
  ]);

  statsCache = result || {
    total: 0,
    sale: 0,
    rent: 0,
    madrid: 0,
    malaga: 0,
    minPrice: 0,
    maxPrice: 0,
  };
  statsCacheTime = Date.now();
  return statsCache;
}

// ── Tool executors ──────────────────────────────────────────

async function executeTool(toolName, toolInput, session, currentUser, extraParams) {
  switch (toolName) {
    case "search_properties": {
      const filters = { ...toolInput };
      // If a polygon was drawn on the map, include it in the search
      if (extraParams?.polygon) filters.polygon = extraParams.polygon;

      const searchResult = await searchProperties({
        ...filters,
        limit: 8,
        page: 1,
      });

      // Save to session for follow-ups
      session.lastFilters = filters;
      session.lastResults = searchResult.properties;

      return {
        properties: searchResult.properties,
        total: searchResult.total,
        data: JSON.stringify({
          total: searchResult.total,
          showing: searchResult.properties.length,
          filters_applied: filters,
          properties: searchResult.properties.map((p, i) => ({
            index: i + 1,
            id: p._id,
            code: p.code,
            title: p.title,
            price: p.price,
            operation: p.operation,
            type: p.type,
            rooms: p.rooms,
            bathrooms: p.bathrooms,
            size: p.size,
            floor: p.floor,
            city: p.location?.city,
            neighborhood: p.location?.neighborhood,
            district: p.location?.district,
            hasPool: p.hasPool || false,
            hasParking: p.hasParking || false,
            hasTerrace: p.hasTerrace || false,
            hasLift: p.hasLift || false,
            hasAC: p.hasAC || false,
            exterior: p.exterior || false,
            images: (p.images || []).length,
            createdAt: p.createdAt,
          })),
        }),
      };
    }

    case "get_property_details": {
      // Find property by index in last results or by ID/code
      let property = null;
      const { property_index, property_id } = toolInput;

      if (property_index && session.lastResults?.length) {
        property = session.lastResults[property_index - 1];
      } else if (property_id) {
        const doc = await Property.findOne({
          $or: [
            { _id: property_id },
            { code: property_id },
            { idealista_id: property_id },
          ],
          status: "active",
        }).lean();
        if (doc) {
          property = doc;
        }
      }

      if (!property) {
        return {
          properties: [],
          total: 0,
          data: JSON.stringify({ error: "Property not found" }),
        };
      }

      // Calculate days on market
      const daysOnMarket = property.scraped_at
        ? Math.floor(
            (Date.now() - new Date(property.scraped_at).getTime()) / 86400000
          )
        : null;

      return {
        properties: [property],
        total: 1,
        data: JSON.stringify({
          id: property._id,
          code: property.code,
          title: property.title,
          description: property.description || "",
          price: property.price,
          pricePerSqm: property.priceByArea || property.price_per_sqm,
          operation: property.operation,
          type: property.type,
          rooms: property.rooms || property.features?.bedrooms,
          bathrooms: property.bathrooms || property.features?.bathrooms,
          size: property.size || property.features?.size_sqm,
          floor: property.floor || property.features?.floor,
          city: property.location?.city,
          district: property.location?.district,
          neighborhood: property.location?.neighborhood,
          address: property.location?.address,
          hasPool:
            property.hasPool || property.features?.has_pool || false,
          hasParking:
            property.hasParking || property.features?.has_parking || false,
          hasTerrace:
            property.hasTerrace || property.features?.has_terrace || false,
          hasLift:
            property.hasLift || property.features?.has_elevator || false,
          hasAC: property.hasAC || property.features?.has_ac || false,
          exterior:
            property.exterior || property.features?.is_exterior || false,
          images: (property.images || []).length,
          daysOnMarket,
          contact: property.contact
            ? { name: property.contact.name }
            : null,
        }),
      };
    }

    case "get_neighborhood_info": {
      const { neighborhood, city } = toolInput;
      const match = { status: "active" };
      // Match neighborhood, district, or city fields
      const nRe = new RegExp(
        neighborhood.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      match.$or = [
        { "location.neighborhood": nRe },
        { "location.district": nRe },
        { "address.neighborhood": nRe },
        { "address.district": nRe },
      ];
      if (city) match["location.city"] = new RegExp(city, "i");

      const props = await Property.find(match).lean();
      if (!props.length) {
        return {
          properties: [],
          total: 0,
          data: JSON.stringify({
            neighborhood,
            error: `No properties found in "${neighborhood}". It may not be in our database. Try a nearby neighborhood.`,
          }),
        };
      }

      const rentProps = props.filter((p) => p.operation === "rent");
      const saleProps = props.filter((p) => p.operation === "sale");
      const avgPrice = (arr) =>
        arr.length
          ? Math.round(
              arr.reduce((s, p) => s + (p.price || 0), 0) / arr.length
            )
          : null;
      const minPrice = (arr) =>
        arr.length
          ? Math.min(...arr.map((p) => p.price).filter(Boolean))
          : null;
      const maxPrice = (arr) =>
        arr.length
          ? Math.max(...arr.map((p) => p.price).filter(Boolean))
          : null;
      const avgSize = (arr) => {
        const sizes = arr
          .map((p) => p.size || p.features?.size_sqm)
          .filter(Boolean);
        return sizes.length
          ? Math.round(sizes.reduce((s, v) => s + v, 0) / sizes.length)
          : null;
      };

      const info = {
        neighborhood,
        city: props[0]?.location?.city || city || "Unknown",
        total_properties: props.length,
        rent: {
          count: rentProps.length,
          avg_price: avgPrice(rentProps),
          min_price: minPrice(rentProps),
          max_price: maxPrice(rentProps),
          avg_size_sqm: avgSize(rentProps),
        },
        sale: {
          count: saleProps.length,
          avg_price: avgPrice(saleProps),
          min_price: minPrice(saleProps),
          max_price: maxPrice(saleProps),
          avg_size_sqm: avgSize(saleProps),
        },
        common_types: [
          ...new Set(props.map((p) => p.type).filter(Boolean)),
        ].slice(0, 5),
        features_available: {
          with_pool: props.filter(
            (p) => p.hasPool || p.features?.has_pool
          ).length,
          with_terrace: props.filter(
            (p) => p.hasTerrace || p.features?.has_terrace
          ).length,
          with_parking: props.filter(
            (p) => p.hasParking || p.features?.has_parking
          ).length,
          with_elevator: props.filter(
            (p) => p.hasLift || p.features?.has_elevator
          ).length,
        },
      };

      return {
        properties: [],
        total: props.length,
        data: JSON.stringify(info),
      };
    }

    case "request_agent": {
      const { property_id, property_index, reason, conversation_summary, customer_name, customer_phone, customer_email } = toolInput;
      const AgentRequest = require("../models/agent-request.model");

      // Determine customer info from logged-in user or tool params
      const name = currentUser?.name || customer_name || "";
      const phone = currentUser?.phone || customer_phone || "";
      const email = currentUser?.email || customer_email || "";

      // If no contact info at all, ask for it
      if (!name && !phone && !email && !currentUser) {
        return {
          properties: [],
          total: 0,
          data: JSON.stringify({
            error:
              "No contact info available. Ask the user for their name and phone number so an agent can call them back.",
          }),
        };
      }

      // Look up the property from session results or DB
      let interestedProperty = {};
      const Property = require("../models/property.model");
      try {
        let prop = null;
        // Try by property_index from last search results
        if (property_index && session?.lastResults?.length) {
          prop = session.lastResults[property_index - 1];
        }
        // Try by property_id
        if (!prop && property_id) {
          prop = await Property.findById(property_id).lean();
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
      } catch (err) {
        console.error("[AI Search] Property lookup error:", err.message);
      }

      // Build budget string from session filters
      const filters = session?.lastFilters || {};
      let budgetStr = "";
      if (filters.min_price || filters.max_price) {
        budgetStr = [filters.min_price && `${filters.min_price.toLocaleString("es-ES")}€`, filters.max_price && `${filters.max_price.toLocaleString("es-ES")}€`].filter(Boolean).join(" – ");
      }

      // Create AgentRequest + InboxConversation (linked together)
      let agentReqDoc = null;
      try {
        agentReqDoc = await AgentRequest.create({
          customerName: name,
          customerPhone: phone,
          customerEmail: email,
          language: session?.language || "es",
          summary: conversation_summary || reason,
          lookingFor: reason,
          budget: budgetStr,
          preferredArea: filters.city || filters.search || "",
          source: "chat",
          sessionId: null,
          interestedProperty,
        });
      } catch (err) {
        console.error("[AI Search] AgentRequest create error:", err.message);
      }

      // Create inbox conversation for two-way messaging (if user is logged in)
      if (currentUser) {
        try {
          // Build a friendly first message
          const propTitle = interestedProperty.title || reason;
          const systemMsg = conversation_summary
            ? `${conversation_summary}`
            : `Solicitud: ${reason}`;

          const convo = new InboxConversation({
            user: currentUser._id,
            property: interestedProperty.propertyId || undefined,
            agentRequest: agentReqDoc?._id || undefined,
            subject: propTitle,
            messages: [
              {
                sender: "system",
                text: systemMsg,
              },
            ],
          });
          await convo.save();

          // Link back: AgentRequest → InboxConversation
          if (agentReqDoc) {
            agentReqDoc.inboxConversation = convo._id;
            await agentReqDoc.save();
          }
        } catch (err) {
          console.error("[AI Search] InboxConversation create error:", err.message);
        }
      }

      return {
        properties: [],
        total: 0,
        data: JSON.stringify({
          success: true,
          message: `Agent request created for ${name || "customer"}. An agent will contact them soon.`,
        }),
      };
    }

    default:
      return {
        properties: [],
        total: 0,
        data: JSON.stringify({ error: "Unknown tool" }),
      };
  }
}

// ── POST /api/ai/search ─────────────────────────────────────
router.post("/search", limiter, async (req, res) => {
  try {
    if (!getProvider()) {
      return res.status(503).json({
        error:
          "AI service not configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY",
      });
    }

    const { message, session_id, language, polygon } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message required" });
    }

    const userMessage = String(message).trim();

    // Optional auth — extract user if token present
    let currentUser = null;
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        currentUser = await User.findById(decoded.id)
          .select("name email phone")
          .lean();
      } catch {}
    }

    // Session (async — may load from MongoDB)
    const { id: sessionId, session } = await getSession(session_id);

    // Language detection
    const lang = language
      ? {
          es: "Spanish",
          en: "English",
          fr: "French",
          de: "German",
          it: "Italian",
          nl: "Dutch",
          ru: "Russian",
          pl: "Polish",
          pt: "Portuguese",
          ar: "Arabic",
          zh: "Chinese",
        }[language] || detectLanguage(userMessage)
      : detectLanguage(userMessage);

    // Inventory stats for system prompt
    const stats = await getInventoryStats();

    // System prompt (includes last search context if available)
    const systemPrompt = getSearchSystemPrompt(
      lang,
      stats,
      session,
      currentUser
    );

    // Add user message to history
    session.messages.push({ role: "user", content: userMessage });

    // Trim history (keep recent, but preserve tool blocks integrity)
    trimHistory(session);

    // ── Agentic tool loop ───────────────────────────────────
    // AI may call multiple tools in sequence before giving a final answer
    let properties = [];
    let total = 0;
    let filtersApplied = {};
    let replyText = "";
    let loopCount = 0;
    const MAX_LOOPS = 5; // increased from 3 for complex queries

    let currentMessages = [...session.messages];

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      let aiResult;
      try {
        aiResult = await callAI(systemPrompt, currentMessages, TOOLS);
      } catch (aiErr) {
        console.error(`[AI Search] ${provider} error:`, aiErr.message);
        return fallbackSearch(userMessage, sessionId, res);
      }

      if (aiResult.toolCall) {
        const { id, name, input } = aiResult.toolCall;

        // Execute the tool (with error handling)
        let toolResult;
        try {
          toolResult = await executeTool(
            name,
            input,
            session,
            currentUser,
            { polygon }
          );
        } catch (toolErr) {
          console.error(`[AI Search] Tool ${name} error:`, toolErr.message);
          toolResult = {
            properties: [],
            total: 0,
            data: JSON.stringify({ error: `Tool execution failed: ${toolErr.message}` }),
          };
        }

        if (name === "search_properties") {
          filtersApplied = input || {};
          properties = toolResult.properties;
          total =
            toolResult.total !== undefined ? toolResult.total : 0;
        } else if (
          name === "get_property_details" &&
          toolResult.properties.length
        ) {
          properties = toolResult.properties;
          total = 1;
        }

        // Store full tool_use + tool_result in conversation (KEY for context)
        currentMessages.push({
          role: "assistant",
          content: aiResult.rawContent,
        });
        currentMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: id,
              content: toolResult.data,
            },
          ],
        });

        // If stop reason is end_turn but there was a tool call, keep going
        // Only break if stop reason is end_turn AND there's no tool call
        if (aiResult.stopReason === "end_turn" && aiResult.text) {
          replyText = aiResult.text;
          break;
        }

        continue;
      }

      // No tool call — final text response
      replyText = aiResult.text;
      break;
    }

    // If loop exhausted without getting a text reply, generate a fallback summary
    if (!replyText && properties.length > 0) {
      replyText = `I found ${total} properties matching your criteria.`;
    } else if (!replyText) {
      replyText = "I wasn't able to complete the search. Could you rephrase your request?";
    }

    // Save full conversation to session (including tool blocks)
    session.messages = currentMessages;
    session.messages.push({ role: "assistant", content: replyText });
    if (Object.keys(filtersApplied).length)
      session.searchCount = (session.searchCount || 0) + 1;
    trimHistory(session);

    // Persist to MongoDB (non-blocking)
    persistSession(sessionId, session, lang);

    res.json({
      reply: replyText,
      properties,
      total,
      filters_applied: filtersApplied,
      session_id: sessionId,
      provider,
    });
  } catch (err) {
    console.error("[AI Search] Error:", err.message);
    res.status(500).json({ error: "AI search failed" });
  }
});

// Note: /api/ai/chat is handled by ai-chat.routes.js

// ── GET /api/ai/search/stats ────────────────────────────────
router.get("/search/stats", async (req, res) => {
  try {
    const stats = await getInventoryStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// ── Trim history keeping tool block pairs intact ────────────
function trimHistory(session) {
  if (session.messages.length <= MAX_HISTORY) return;

  // Find a safe cut point — don't split in the middle of a tool_use/tool_result pair
  let cutIndex = session.messages.length - MAX_HISTORY;

  // Walk forward to find a safe starting point
  // A safe point is a plain user message (not a tool_result) that isn't preceded by a tool_use
  for (let i = cutIndex; i < session.messages.length - 10; i++) {
    const msg = session.messages[i];

    // Skip tool_result messages (orphaned without their tool_use)
    if (
      msg.role === "user" &&
      Array.isArray(msg.content) &&
      msg.content[0]?.type === "tool_result"
    ) {
      continue;
    }

    // Skip assistant messages with tool_use (their result comes next)
    if (
      msg.role === "assistant" &&
      Array.isArray(msg.content) &&
      msg.content.some((b) => b.type === "tool_use")
    ) {
      continue;
    }

    // This is a safe cut point (plain user or assistant message)
    cutIndex = i;
    break;
  }

  session.messages = session.messages.slice(cutIndex);
}

// ── Fallback: basic keyword search ──────────────────────────
async function fallbackSearch(message, sessionId, res) {
  try {
    const result = await searchProperties({
      search: message,
      limit: 8,
      page: 1,
    });

    res.json({
      reply:
        result.total > 0
          ? `I found ${result.total} properties matching your keywords. Here are the top results.`
          : "No properties found with those criteria. Try different keywords or broaden your search.",
      properties: result.properties,
      total: result.total,
      filters_applied: { search: message },
      session_id: sessionId,
    });
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
}

module.exports = router;
