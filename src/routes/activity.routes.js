/**
 * Activity Tracking API
 *
 * POST /api/activity/view     — track property view
 * POST /api/activity/search   — track search filters
 */

const express = require("express");
const router = express.Router();
const Activity = require("../models/activity.model");
const { userAuth: auth } = require("../middleware/auth");

// Track property view (dedupe 30min)
router.post("/view", auth, async (req, res) => {
  try {
    const { propertyId } = req.body;
    if (!propertyId) return res.status(400).json({ error: "propertyId required" });

    const recent = await Activity.findOne({
      user: req.user.id,
      type: "view",
      property: propertyId,
      createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) },
    });
    if (recent) return res.json({ ok: true, deduplicated: true });

    await Activity.create({ user: req.user.id, type: "view", property: propertyId });
    res.json({ ok: true });
  } catch (err) {
    console.error("Activity view error:", err.message);
    res.status(500).json({ error: "Failed to track view" });
  }
});

// Track search (throttle 1/min)
router.post("/search", auth, async (req, res) => {
  try {
    const { filters } = req.body;
    if (!filters) return res.status(400).json({ error: "filters required" });

    const recent = await Activity.findOne({
      user: req.user.id,
      type: "search",
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
    });
    if (recent) return res.json({ ok: true, throttled: true });

    await Activity.create({ user: req.user.id, type: "search", filters });
    res.json({ ok: true });
  } catch (err) {
    console.error("Activity search error:", err.message);
    res.status(500).json({ error: "Failed to track search" });
  }
});

module.exports = router;
