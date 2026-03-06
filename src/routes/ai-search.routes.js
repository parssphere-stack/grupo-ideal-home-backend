/**
 * AI Smart Search
 *
 * POST /api/ai/search — natural language property search with Claude tool use
 */

const express = require("express");
const router = express.Router();
const Anthropic = require("@anthropic-ai/sdk");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const { searchProperties } = require("../services/property-search.service");
const Property = require("../models/property.model");
const {
  SEARCH_TOOL,
  getSearchSystemPrompt,
  detectLanguage,
} = require("../config/ai-search.config");

// ── Rate limiter ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests, please slow down" },
});

// ── Anthropic client (singleton) ────────────────────────────
let client = null;
function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// ── In-memory session store ─────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY = 20; // 10 pairs

function getSession(sessionId) {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.lastAccess = Date.now();
    return { id: sessionId, session };
  }
  const id = sessionId || uuidv4();
  const session = { messages: [], lastAccess: Date.now() };
  sessions.set(id, session);
  return { id, session };
}

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL) sessions.delete(id);
  }
}, 5 * 60 * 1000);

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

// ── Helper: format number ───────────────────────────────────
function fmt(n) {
  return (n || 0).toLocaleString("es-ES");
}

// ── POST /api/ai/search ─────────────────────────────────────
router.post("/search", limiter, async (req, res) => {
  try {
    const anthropic = getClient();
    if (!anthropic) {
      return res.status(503).json({ error: "AI service not configured" });
    }

    const { message, session_id, language } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message required" });
    }

    const userMessage = String(message).trim();

    // Session
    const { id: sessionId, session } = getSession(session_id);

    // Language detection
    const lang = language
      ? { es: "Spanish", en: "English", fr: "French", de: "German", it: "Italian", nl: "Dutch", ru: "Russian" }[language] || detectLanguage(userMessage)
      : detectLanguage(userMessage);

    // Inventory stats for system prompt
    const stats = await getInventoryStats();

    // Add user message to history
    session.messages.push({ role: "user", content: userMessage });

    // Trim history
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY);
    }

    // System prompt
    const systemPrompt = getSearchSystemPrompt(lang, stats);

    // ── Call Claude with tool use ───────────────────────────
    let response;
    try {
      response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        tools: [SEARCH_TOOL],
        messages: session.messages,
      });
    } catch (aiErr) {
      console.error("[AI Search] Claude error:", aiErr.message);
      // Fallback: basic text search
      return fallbackSearch(userMessage, sessionId, res);
    }

    // ── Handle tool use ─────────────────────────────────────
    let properties = [];
    let total = 0;
    let filtersApplied = {};
    let replyText = "";

    const toolUseBlock = response.content.find((b) => b.type === "tool_use");

    if (toolUseBlock && toolUseBlock.name === "search_properties") {
      filtersApplied = toolUseBlock.input || {};

      // Execute search
      const searchResult = await searchProperties({
        ...filtersApplied,
        limit: 6,
        page: 1,
      });
      properties = searchResult.properties;
      total = searchResult.total;

      // Build tool result summary for Claude
      const toolResultContent = JSON.stringify({
        total,
        showing: properties.length,
        properties: properties.map((p) => ({
          title: p.title,
          price: p.price,
          operation: p.operation,
          type: p.propertyType,
          rooms: p.rooms,
          size: p.size,
          city: p.address?.city,
          neighborhood: p.address?.neighborhood,
          district: p.address?.district,
          hasPool: p.hasPool || false,
          hasParking: p.hasParking || false,
          hasTerrace: p.hasTerrace || false,
          hasLift: p.hasLift || false,
          exterior: p.exterior || false,
        })),
      });

      // Send tool result back to Claude for natural language summary
      try {
        const followUp = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          tools: [SEARCH_TOOL],
          messages: [
            ...session.messages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUseBlock.id,
                  content: toolResultContent,
                },
              ],
            },
          ],
        });

        replyText =
          followUp.content.find((b) => b.type === "text")?.text || "";
      } catch (followUpErr) {
        console.error("[AI Search] Follow-up error:", followUpErr.message);
        // Use a generic reply with the data we have
        replyText =
          total > 0
            ? `Found ${total} properties matching your criteria.`
            : "No properties found matching those criteria. Try broadening your search.";
      }
    } else {
      // No tool call — Claude is asking clarifying questions or chatting
      replyText = response.content.find((b) => b.type === "text")?.text || "";
    }

    // Store assistant reply in session
    session.messages.push({ role: "assistant", content: replyText });

    // Trim again
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY);
    }

    res.json({
      reply: replyText,
      properties,
      total,
      filters_applied: filtersApplied,
      session_id: sessionId,
    });
  } catch (err) {
    console.error("[AI Search] Error:", err.message);
    res.status(500).json({ error: "AI search failed" });
  }
});

// ── Fallback: basic keyword search ──────────────────────────
async function fallbackSearch(message, sessionId, res) {
  try {
    const result = await searchProperties({
      search: message,
      limit: 6,
      page: 1,
    });

    res.json({
      reply:
        result.total > 0
          ? `I found ${result.total} properties matching your keywords.`
          : "No properties found. Try different keywords.",
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
