/**
 * Alert Preferences API
 *
 * GET    /api/alerts              — list user's alerts
 * POST   /api/alerts              — create alert
 * DELETE /api/alerts/:id          — delete alert
 * POST   /api/alerts/:id/toggle   — enable/disable
 * GET    /api/alerts/:id/unsubscribe — one-click email unsubscribe
 */

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Alert = require("../models/alert.model");
const User = require("../models/user.model");

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

// List alerts
router.get("/", auth, async (req, res) => {
  try {
    const alerts = await Alert.find({ user: req.user.id }).sort({
      createdAt: -1,
    });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// Create alert (max 5 per user)
router.post("/", auth, async (req, res) => {
  try {
    const { frequency, criteria } = req.body;
    if (!criteria)
      return res.status(400).json({ error: "criteria required" });

    const count = await Alert.countDocuments({ user: req.user.id });
    if (count >= 5)
      return res.status(400).json({ error: "Maximum 5 alerts allowed" });

    const alert = await Alert.create({
      user: req.user.id,
      frequency: frequency || "daily",
      criteria,
    });

    await User.findByIdAndUpdate(req.user.id, { alertsEnabled: true });

    res.status(201).json(alert);
  } catch (err) {
    console.error("Create alert error:", err.message);
    res.status(500).json({ error: "Failed to create alert" });
  }
});

// Delete alert
router.delete("/:id", auth, async (req, res) => {
  try {
    await Alert.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete alert" });
  }
});

// Toggle active
router.post("/:id/toggle", auth, async (req, res) => {
  try {
    const alert = await Alert.findOne({
      _id: req.params.id,
      user: req.user.id,
    });
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    alert.active = !alert.active;
    await alert.save();
    res.json({ ok: true, active: alert.active });
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle alert" });
  }
});

// One-click email unsubscribe (no auth — uses token param)
router.get("/:id/unsubscribe", async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) return res.send("<h2>Alert not found</h2>");
    if (String(alert.user) !== req.query.token)
      return res.send("<h2>Invalid link</h2>");
    alert.active = false;
    await alert.save();
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a1a;color:#e0e0e0">
        <h2 style="color:#c49a3a">Alerta desactivada</h2>
        <p>No recibiras mas emails de esta alerta.</p>
        <a href="https://giphomes.com" style="color:#c49a3a">Volver a giphomes.com</a>
      </body></html>
    `);
  } catch {
    res.status(500).send("<h2>Error</h2>");
  }
});

module.exports = router;
