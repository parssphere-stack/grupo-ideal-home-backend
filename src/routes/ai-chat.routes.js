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

let openaiClient = null;
function getOpenAI() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    const OpenAI = require("openai");
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function chatViaOpenAI(system, messages) {
  const openai = getOpenAI();
  if (!openai) return null;
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages.slice(-8),
    ],
  });
  return response.choices?.[0]?.message?.content || "";
}

router.post("/chat", limiter, async (req, res) => {
  const { system, messages } = req.body;
  if (!messages || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages required" });
  }

  try {
    const anthropic = getClient();
    if (!anthropic) {
      const reply = await chatViaOpenAI(system, messages);
      if (reply === null) {
        return res.status(503).json({ error: "AI service not configured" });
      }
      return res.json({ reply });
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
    console.error("[AI Chat] Anthropic error:", err.message);
    // Dead Anthropic key shouldn't kill the chat if OpenAI is configured
    try {
      const reply = await chatViaOpenAI(system, messages);
      if (reply !== null) return res.json({ reply });
    } catch (oaiErr) {
      console.error("[AI Chat] OpenAI fallback error:", oaiErr.message);
    }
    res.status(500).json({ error: "AI request failed" });
  }
});

module.exports = router;
