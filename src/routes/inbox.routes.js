/**
 * Inbox API
 *
 * GET    /api/inbox              — list conversations
 * GET    /api/inbox/:id          — get conversation
 * POST   /api/inbox              — create conversation
 * POST   /api/inbox/:id/reply    — add message
 * PATCH  /api/inbox/:id/read     — mark messages read
 */

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const InboxConversation = require("../models/inbox-conversation.model");

const JWT_SECRET = process.env.JWT_SECRET || "grupo-ideal-secret-2024";

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ── List conversations ───────────────────────────────────────
router.get("/", auth, async (req, res) => {
  try {
    const convos = await InboxConversation.find({ user: req.user.id })
      .populate("property", "title price location images")
      .sort({ updatedAt: -1 });

    const result = convos.map((c) => {
      const last = c.messages[c.messages.length - 1];
      const unread = c.messages.filter(
        (m) => !m.read && m.sender !== "buyer",
      ).length;
      return {
        _id: c._id,
        property: c.property,
        subject: c.subject,
        status: c.status,
        lastMessage: last
          ? { text: last.text, sender: last.sender, timestamp: last.timestamp }
          : null,
        unread,
        updatedAt: c.updatedAt,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ── Get single conversation ──────────────────────────────────
router.get("/:id", auth, async (req, res) => {
  try {
    const convo = await InboxConversation.findOne({
      _id: req.params.id,
      user: req.user.id,
    }).populate("property", "title price location images");

    if (!convo) return res.status(404).json({ error: "Not found" });
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// ── Create conversation ──────────────────────────────────────
router.post("/", auth, async (req, res) => {
  try {
    const { propertyId, subject, message } = req.body;

    // Check if conversation already exists for this property
    if (propertyId) {
      const existing = await InboxConversation.findOne({
        user: req.user.id,
        property: propertyId,
        status: "open",
      });
      if (existing) {
        return res.json(existing);
      }
    }

    const convo = new InboxConversation({
      user: req.user.id,
      property: propertyId || undefined,
      subject: subject || "New conversation",
      messages: message
        ? [{ sender: "buyer", text: message }]
        : [{ sender: "system", text: "Conversation started" }],
    });

    await convo.save();
    await convo.populate("property", "title price location images");
    res.status(201).json(convo);
  } catch (err) {
    console.error("Create conversation error:", err.message);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// ── Reply to conversation ────────────────────────────────────
router.post("/:id/reply", auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Message text required" });

    const convo = await InboxConversation.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!convo) return res.status(404).json({ error: "Not found" });

    convo.messages.push({ sender: "buyer", text });
    await convo.save();

    res.json({ ok: true, message: convo.messages[convo.messages.length - 1] });
  } catch (err) {
    res.status(500).json({ error: "Failed to send reply" });
  }
});

// ── Mark messages as read ────────────────────────────────────
router.patch("/:id/read", auth, async (req, res) => {
  try {
    const convo = await InboxConversation.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!convo) return res.status(404).json({ error: "Not found" });

    convo.messages.forEach((m) => {
      if (m.sender !== "buyer") m.read = true;
    });
    await convo.save();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

module.exports = router;
