/**
 * Agent Dashboard API
 *
 * POST /api/agents/login          — login, returns JWT
 * GET  /api/agents/me             — current agent info
 * GET  /api/agents/list           — all agents (admin)
 * POST /api/agents/create         — create agent (admin)
 *
 * GET  /api/agents/leads          — get properties with lead status + price label
 * POST /api/agents/leads/claim    — claim a property (create lead)
 * PUT  /api/agents/leads/:id      — update lead status/notes
 * GET  /api/agents/stats          — dashboard stats
 */

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Agent = require("../models/agent.model");
const Lead = require("../models/lead.model");
const Property = require("../models/property.model");

const JWT_SECRET = process.env.JWT_SECRET || "grupo-ideal-secret-2024";

// ── Auth middleware ──────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.agent = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (req.agent.role !== "admin")
    return res.status(403).json({ error: "Admin only" });
  next();
}

// ── Price label calculator ───────────────────────────────────
function getPriceLabel(pricePerSqm, median) {
  if (!pricePerSqm || !median) return null;
  const diff = (pricePerSqm - median) / median;
  if (diff <= -0.15)
    return {
      label: "ocasion",
      text: "🔥 Ocasión",
      pct: Math.round(diff * 100),
    };
  if (diff <= 0.15)
    return {
      label: "mercado",
      text: "✅ Precio mercado",
      pct: Math.round(diff * 100),
    };
  if (diff <= 0.3)
    return {
      label: "algo_caro",
      text: "⚠️ Algo caro",
      pct: Math.round(diff * 100),
    };
  return { label: "caro", text: "❌ Caro", pct: Math.round(diff * 100) };
}

// ── Cache medians (refresh every 6h) ────────────────────────
let mediansCache = null;
let mediasCachedAt = 0;

async function getMedians() {
  if (mediansCache && Date.now() - mediasCachedAt < 6 * 3600 * 1000)
    return mediansCache;
  const result = await Property.aggregate([
    {
      $match: {
        status: "active",
        is_particular: true,
        "features.size_sqm": { $gt: 20 },
        price: { $gt: 0 },
      },
    },
    { $addFields: { ppm2: { $divide: ["$price", "$features.size_sqm"] } } },
    {
      $group: {
        _id: { city: "$location.city", operation: "$operation" },
        prices: { $push: "$ppm2" },
        count: { $sum: 1 },
      },
    },
  ]);
  const map = {};
  for (const r of result) {
    if (r.count < 5) continue;
    const sorted = r.prices.filter(Boolean).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const key = `${(r._id.city || "").toLowerCase()}__${r._id.operation}`;
    map[key] = median;
  }
  mediansCache = map;
  mediasCachedAt = Date.now();
  return map;
}

// ══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// POST /api/agents/setup — only works if NO agents exist yet
router.post("/setup", async (req, res) => {
  try {
    const count = await Agent.countDocuments();
    if (count > 0) return res.status(403).json({ error: "Setup already done" });
    const { name, email, password } = req.body;
    const agent = await Agent.create({ name, email, password, role: "admin" });
    res.json({ ok: true, id: agent._id, name: agent.name, email: agent.email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/agents/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const agent = await Agent.findOne({
      email: email?.toLowerCase(),
      active: true,
    });
    if (!agent || !(await agent.comparePassword(password)))
      return res.status(401).json({ error: "Email o contraseña incorrectos" });
    const token = jwt.sign(
      { id: agent._id, name: agent.name, email: agent.email, role: agent.role },
      JWT_SECRET,
      { expiresIn: "30d" },
    );
    res.json({
      token,
      agent: {
        id: agent._id,
        name: agent.name,
        email: agent.email,
        role: agent.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents/me
router.get("/me", auth, async (req, res) => {
  const agent = await Agent.findById(req.agent.id).select("-password");
  res.json(agent);
});

// GET /api/agents/list (admin)
router.get("/list", auth, adminOnly, async (req, res) => {
  const agents = await Agent.find().select("-password").sort({ name: 1 });
  res.json(agents);
});

// POST /api/agents/create (admin)
router.post("/create", auth, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const agent = await Agent.create({ name, email, password, role });
    res.json({
      id: agent._id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// LEADS ROUTES
// ══════════════════════════════════════════════════════════════

// GET /api/agents/leads
router.get("/leads", auth, async (req, res) => {
  try {
    const {
      city,
      operation,
      minPrice,
      maxPrice,
      bedrooms,
      status,
      priceLabel,
      page = 1,
      limit = 30,
      mine,
    } = req.query;

    const query = { status: "active", is_particular: true };
    if (city) query["location.city"] = new RegExp(city, "i");
    if (operation) query.operation = operation;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    if (bedrooms) query["features.bedrooms"] = Number(bedrooms);

    const medians = await getMedians();

    // Get all leads for lock info
    const allLeads = await Lead.find().populate("agent", "name email").lean();
    const leadMap = {};
    for (const l of allLeads) {
      leadMap[String(l.property)] = l;
    }

    // If filtering by status, filter by lead status
    if (status) {
      const propertyIds = allLeads
        .filter((l) => l.status === status)
        .map((l) => l.property);
      query._id = { $in: propertyIds };
    }

    // If "mine" filter
    if (mine === "true") {
      const myLeads = allLeads.filter(
        (l) => String(l.agent._id || l.agent) === req.agent.id,
      );
      query._id = { $in: myLeads.map((l) => l.property) };
    }

    const total = await Property.countDocuments(query);
    const properties = await Property.find(query)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    // Enrich with price label + lead info
    const enriched = properties
      .map((p) => {
        const key = `${(p.location?.city || "").toLowerCase()}__${p.operation}`;
        const median = medians[key];
        const ppm2 =
          p.price && p.features?.size_sqm
            ? p.price / p.features.size_sqm
            : null;
        const priceInfo = getPriceLabel(ppm2, median);
        const lead = leadMap[String(p._id)];
        return {
          ...p,
          pricePerSqm: ppm2 ? Math.round(ppm2) : null,
          medianPricePerSqm: median ? Math.round(median) : null,
          priceLabel: priceInfo,
          lead: lead
            ? {
                id: lead._id,
                status: lead.status,
                agent: lead.agent,
                notes: lead.notes,
                contactedAt: lead.contactedAt,
              }
            : null,
        };
      })
      .filter((p) => {
        if (!priceLabel) return true;
        return p.priceLabel?.label === priceLabel;
      });

    res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      properties: enriched,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agents/leads/claim
router.post("/leads/claim", auth, async (req, res) => {
  try {
    const { propertyId, notes } = req.body;
    const existing = await Lead.findOne({ property: propertyId });
    if (existing) {
      const owner = await Agent.findById(existing.agent).select("name");
      return res
        .status(409)
        .json({ error: `Ya gestionado por ${owner?.name || "otro agente"}` });
    }
    const lead = await Lead.create({
      property: propertyId,
      agent: req.agent.id,
      status: "contactado",
      notes,
    });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/agents/leads/:id
router.put("/leads/:id", auth, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    // Only owner or admin can update
    if (String(lead.agent) !== req.agent.id && req.agent.role !== "admin")
      return res.status(403).json({ error: "No autorizado" });
    const { status, notes } = req.body;
    if (status) lead.status = status;
    if (notes !== undefined) lead.notes = notes;
    lead.updatedAt = new Date();
    await lead.save();
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/agents/leads/:id (admin only - unlock)
router.delete("/leads/:id", auth, adminOnly, async (req, res) => {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/agents/stats
router.get("/stats", auth, async (req, res) => {
  try {
    const medians = await getMedians();
    const total = await Property.countDocuments({
      status: "active",
      is_particular: true,
    });

    // Count ocasiones
    const properties = await Property.find(
      {
        status: "active",
        is_particular: true,
        "features.size_sqm": { $gt: 20 },
        price: { $gt: 0 },
      },
      { price: 1, "features.size_sqm": 1, "location.city": 1, operation: 1 },
    ).lean();

    let ocasiones = 0;
    for (const p of properties) {
      const key = `${(p.location?.city || "").toLowerCase()}__${p.operation}`;
      const median = medians[key];
      const ppm2 = p.price / p.features.size_sqm;
      if (median && (ppm2 - median) / median <= -0.15) ocasiones++;
    }

    const myLeads = await Lead.countDocuments({ agent: req.agent.id });
    const myDeals = await Lead.countDocuments({
      agent: req.agent.id,
      status: "deal",
    });
    const totalLeads = await Lead.countDocuments();
    const totalDeals = await Lead.countDocuments({ status: "deal" });

    res.json({ total, ocasiones, myLeads, myDeals, totalLeads, totalDeals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: assign properties to agent ───────────────────────
// POST /api/agents/assign  { agentId, propertyIds: [...] }  max 50
router.post("/assign", auth, adminOnly, async (req, res) => {
  try {
    const { agentId, propertyIds } = req.body;
    if (!agentId || !Array.isArray(propertyIds))
      return res
        .status(400)
        .json({ error: "agentId and propertyIds required" });
    if (propertyIds.length > 50)
      return res.status(400).json({ error: "Max 50 properties per agent" });

    const agent = await Agent.findByIdAndUpdate(
      agentId,
      {
        assignedProperties: propertyIds,
        assignedAt: new Date(),
        assignedBy: req.agent.id,
      },
      { new: true },
    ).select("-password");

    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json({ success: true, agent, count: propertyIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: get all agents with their assigned properties ─────
router.get("/agents-full", auth, adminOnly, async (req, res) => {
  try {
    const agents = await Agent.find({ role: "agent" })
      .select("-password")
      .populate(
        "assignedProperties",
        "title price operation propertyType address images idealista_id",
      )
      .lean();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent: get my assigned properties (with contact info) ────
router.get("/my-properties", auth, async (req, res) => {
  try {
    const agent = await Agent.findById(req.agent.id)
      .populate({
        path: "assignedProperties",
        match: { status: "active" },
        select:
          "title price operation propertyType address images idealista_id rooms size floor hasLift exterior hasTerrace hasPool contactInfo url scraped_at",
      })
      .lean();

    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Get lead status for each property
    const propIds = (agent.assignedProperties || []).map((p) => p._id);
    const leads = await Lead.find({
      agent: req.agent.id,
      property: { $in: propIds },
    }).lean();

    const leadMap = {};
    for (const l of leads) leadMap[l.property.toString()] = l;

    const properties = (agent.assignedProperties || []).map((p) => ({
      ...p,
      lead: leadMap[p._id.toString()] || null,
    }));

    res.json({
      properties,
      total: properties.length,
      assignedAt: agent.assignedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: browse all properties to pick for assignment ──────
router.get("/browse-properties", auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 50, city, op, q } = req.query;
    const filter = { status: "active", is_particular: true };
    if (city) filter["address.city"] = new RegExp(city, "i");
    if (op) filter.operation = op;
    if (q) {
      filter.$or = [
        { "address.city": new RegExp(q, "i") },
        { "address.street": new RegExp(q, "i") },
        { "address.neighborhood": new RegExp(q, "i") },
      ];
    }
    const total = await Property.countDocuments(filter);
    const props = await Property.find(filter)
      .select(
        "title price operation propertyType address images idealista_id rooms size floor",
      )
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean();
    res.json({ properties: props, total, page: +page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
