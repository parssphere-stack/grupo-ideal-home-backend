/**
 * AI Chat Proxy
 *
 * POST /api/ai/chat — proxy Claude API calls (keeps API key server-side)
 */

const express = require("express");
const router = express.Router();
const Anthropic = require("@anthropic-ai/sdk");
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests, please slow down" },
});

let client = null;
function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

router.post("/chat", limiter, async (req, res) => {
  try {
    const anthropic = getClient();
    if (!anthropic) {
      return res.status(503).json({ error: "AI service not configured" });
    }

    const { system, messages } = req.body;
    if (!messages || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: "messages required" });
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: system || undefined,
      messages: messages.slice(-8),
    });

    const text = response.content?.[0]?.text || "";
    res.json({ reply: text });
  } catch (err) {
    console.error("[AI Chat] Error:", err.message);
    res.status(500).json({ error: "AI request failed" });
  }
});

module.exports = router;
