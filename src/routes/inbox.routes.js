/**
 * Inbox API — Two-way messaging between clients and agents
 *
 * CLIENT endpoints (userAuth):
 *   GET    /api/inbox              — list my conversations
 *   GET    /api/inbox/:id          — get conversation
 *   POST   /api/inbox              — create conversation
 *   POST   /api/inbox/:id/reply    — add buyer message
 *   PATCH  /api/inbox/:id/read     — mark agent messages as read
 *
 * ADMIN/AGENT endpoints (agentAuth):
 *   GET    /api/inbox/admin/all         — list all conversations (admin)
 *   GET    /api/inbox/admin/:id         — get any conversation (admin)
 *   POST   /api/inbox/admin/:id/reply   — send agent message to client
 *   PATCH  /api/inbox/admin/:id/read    — mark buyer messages as read
 */

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const InboxConversation = require("../models/inbox-conversation.model");
const { userAuth: auth } = require("../middleware/auth");

const JWT_SECRET = process.env.JWT_SECRET || "grupo-ideal-secret-2024";

// ── Agent auth middleware ────────────────────────────────────
function agentAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.agent = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ══════════════════════════════════════════════════════════════
// CLIENT ENDPOINTS
// ══════════════════════════════════════════════════════════════

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
  // Skip admin routes
  if (req.params.id === "admin") return res.status(404).json({ error: "Not found" });
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

// ── Reply to conversation (buyer) ───────────────────────────
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

// ── Mark messages as read (buyer marks agent messages) ───────
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

// ══════════════════════════════════════════════════════════════
// ADMIN/AGENT ENDPOINTS
// ══════════════════════════════════════════════════════════════

// ── List all conversations (admin) ──────────────────────────
router.get("/admin/all", agentAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const total = await InboxConversation.countDocuments(filter);
    const convos = await InboxConversation.find(filter)
      .populate("user", "name email phone")
      .populate("property", "title price location images")
      .populate("agentRequest")
      .sort({ updatedAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit);

    const result = convos.map((c) => {
      const last = c.messages[c.messages.length - 1];
      const unreadAgent = c.messages.filter(
        (m) => !m.read && m.sender === "buyer",
      ).length;
      return {
        _id: c._id,
        user: c.user || { name: c.customerName, email: c.customerEmail, phone: c.customerPhone },
        property: c.property,
        agentRequest: c.agentRequest,
        subject: c.subject,
        status: c.status,
        messageCount: c.messages.length,
        lastMessage: last
          ? { text: last.text, sender: last.sender, timestamp: last.timestamp }
          : null,
        unreadAgent,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt,
      };
    });

    res.json({ conversations: result, total });
  } catch (err) {
    console.error("Admin inbox list error:", err.message);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ── Get single conversation (admin) ─────────────────────────
router.get("/admin/:id", agentAuth, async (req, res) => {
  try {
    const convo = await InboxConversation.findById(req.params.id)
      .populate("user", "name email phone")
      .populate("property", "title price location images")
      .populate("agentRequest");

    if (!convo) return res.status(404).json({ error: "Not found" });
    const obj = convo.toObject();
    if (!obj.user && (obj.customerName || obj.customerEmail)) {
      obj.user = { name: obj.customerName, email: obj.customerEmail, phone: obj.customerPhone };
    }
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// ── Reply to conversation (agent/admin) ─────────────────────
router.post("/admin/:id/reply", agentAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Message text required" });

    const convo = await InboxConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ error: "Not found" });

    convo.messages.push({ sender: "agent", text });
    await convo.save();

    res.json({ ok: true, message: convo.messages[convo.messages.length - 1] });
  } catch (err) {
    res.status(500).json({ error: "Failed to send reply" });
  }
});

// ── Mark buyer messages as read (agent) ─────────────────────
router.patch("/admin/:id/read", agentAuth, async (req, res) => {
  try {
    const convo = await InboxConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ error: "Not found" });

    convo.messages.forEach((m) => {
      if (m.sender === "buyer") m.read = true;
    });
    await convo.save();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// ── Create conversation from AgentRequest (admin) ───────────
const AgentRequest = require("../models/agent-request.model");

router.post("/admin/create-from-request", agentAuth, async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "requestId required" });

    const agentReq = await AgentRequest.findById(requestId);
    if (!agentReq) return res.status(404).json({ error: "Request not found" });

    // Check if conversation already exists
    if (agentReq.inboxConversation) {
      const existing = await InboxConversation.findById(agentReq.inboxConversation);
      if (existing) return res.json(existing);
    }

    // Build subject from request info
    const subject = agentReq.lookingFor || agentReq.summary || "Solicitud de cliente";

    // Create conversation (with or without a registered user)
    const convo = new InboxConversation({
      user: null,
      customerName: agentReq.customerName || "",
      customerPhone: agentReq.customerPhone || "",
      customerEmail: agentReq.customerEmail || "",
      property: agentReq.interestedProperty?.propertyId || undefined,
      agentRequest: agentReq._id,
      subject,
      messages: [
        {
          sender: "system",
          text: agentReq.summary || `Solicitud: ${agentReq.lookingFor || "Contacto con agente"}`,
        },
      ],
    });
    await convo.save();

    // Link back
    agentReq.inboxConversation = convo._id;
    await agentReq.save();

    await convo.populate("property", "title price location images");
    res.status(201).json(convo);
  } catch (err) {
    console.error("Create from request error:", err.message);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

module.exports = router;
