/**
 * GET /api/properties
 *
 * Query params:
 *   search        — full-text search
 *   city          — "Madrid" | "Malaga" | all
 *   operation     — "sale" | "rent"
 *   type          — "apartment" | "house" | ...
 *   min_price     — number
 *   max_price     — number
 *   min_rooms     — number
 *   max_rooms     — number
 *   min_size      — number
 *   max_size      — number
 *   has_elevator  — "1"
 *   has_parking   — "1"
 *   has_terrace   — "1"
 *   has_pool      — "1"
 *   is_exterior   — "1"
 *   sort          — "price_asc" | "price_desc" | "newest" | "size_desc" | "relevance"
 *   page          — number (default 1)
 *   limit         — number (default 24, max 10000)
 *   lat, lng, radius_km — geo filter
 */

const express = require("express");
const router = express.Router();
const Property = require("../models/property.model");
const mongoose = require("mongoose");
const { searchProperties } = require("../services/property-search.service");

// ── GET /api/properties ─────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const result = await searchProperties(req.query);
    res.json({
      data: result.properties,
      total: result.total,
      page: result.page,
      pages: result.pages,
      limit: parseInt(req.query.limit) || 24,
    });
  } catch (err) {
    console.error("Properties error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/properties/stats ────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [stats] = await Property.aggregate([
      { $match: { status: "active", is_particular: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avg_price: { $avg: "$price" },
          min_price: { $min: "$price" },
          max_price: { $max: "$price" },
          avg_size: { $avg: "$features.size_sqm" },
          cities: { $addToSet: "$location.city" },
          sale_count: {
            $sum: { $cond: [{ $eq: ["$operation", "sale"] }, 1, 0] },
          },
          rent_count: {
            $sum: { $cond: [{ $eq: ["$operation", "rent"] }, 1, 0] },
          },
          madrid_count: {
            $sum: {
              $cond: [
                { $regexMatch: { input: "$location.city", regex: /madrid/i } },
                1,
                0,
              ],
            },
          },
          malaga_count: {
            $sum: {
              $cond: [
                { $regexMatch: { input: "$location.city", regex: /m.laga/i } },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    // Price distribution
    const priceDistribution = await Property.aggregate([
      { $match: { status: "active", is_particular: true, price: { $gt: 0 } } },
      {
        $bucket: {
          groupBy: "$price",
          boundaries: [
            0,
            500,
            800,
            1000,
            1200,
            1500,
            2000,
            5000,
            10000,
            Infinity,
          ],
          default: "5000+",
          output: {
            count: { $sum: 1 },
            avg_size: { $avg: "$features.size_sqm" },
          },
        },
      },
    ]);

    // Neighborhoods top 10
    const neighborhoods = await Property.aggregate([
      {
        $match: {
          status: "active",
          is_particular: true,
          "location.neighborhood": { $ne: "" },
        },
      },
      {
        $group: {
          _id: "$location.neighborhood",
          count: { $sum: 1 },
          avg_price: { $avg: "$price" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.json({ ...stats, priceDistribution, neighborhoods });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/properties/:id ──────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const p = await Property.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null },
        { idealista_id: req.params.id },
      ],
    }).lean();

    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
