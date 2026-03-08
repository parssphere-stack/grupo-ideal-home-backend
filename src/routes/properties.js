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

// ── Analysis cache ───────────────────────────────────────────
const analysisCache = new Map();
const ANALYSIS_TTL = 10 * 60 * 1000; // 10 minutes

// ── GET /api/properties/:id/analysis ─────────────────────────
router.get("/:id/analysis", async (req, res) => {
  try {
    // Check cache
    const cacheKey = req.params.id;
    const cached = analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ANALYSIS_TTL) {
      return res.json(cached.data);
    }

    // Find target property
    const property = await Property.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null },
        { idealista_id: req.params.id },
        { code: req.params.id.toUpperCase() },
      ],
    }).lean();

    if (!property) return res.status(404).json({ error: "Not found" });

    const price = property.price || 0;
    const sizeSqm = property.features?.size_sqm || 0;
    const pricePerSqm = sizeSqm > 0 ? Math.round(price / sizeSqm) : 0;
    const daysOnMarket = Math.floor(
      (Date.now() - new Date(property.createdAt).getTime()) / 86400000
    );
    const city = property.location?.city || "";
    const neighborhood = property.location?.neighborhood || "";
    const operation = property.operation || "rent";
    const bedrooms = property.features?.bedrooms || 0;
    const propertyType = property.type || "apartment";

    // Size range for "similar" (±25%)
    const sizeMin = sizeSqm > 0 ? Math.round(sizeSqm * 0.75) : 0;
    const sizeMax = sizeSqm > 0 ? Math.round(sizeSqm * 1.25) : 999999;

    // Single $facet aggregation
    const [result] = await Property.aggregate([
      {
        $match: {
          status: "active",
          price: { $gt: 0 },
          "features.size_sqm": { $gt: 0 },
          operation,
          "location.city": city,
          _id: { $ne: property._id },
        },
      },
      {
        $facet: {
          neighborhood: [
            ...(neighborhood
              ? [{ $match: { "location.neighborhood": neighborhood } }]
              : [{ $match: { _id: null } }]),
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                prices: { $push: "$price" },
                avg_price: { $avg: "$price" },
                min_price: { $min: "$price" },
                max_price: { $max: "$price" },
                avg_ppm: {
                  $avg: { $divide: ["$price", "$features.size_sqm"] },
                },
                cheaper: {
                  $sum: { $cond: [{ $lt: ["$price", price] }, 1, 0] },
                },
              },
            },
          ],
          city: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                prices: { $push: "$price" },
                avg_price: { $avg: "$price" },
                min_price: { $min: "$price" },
                max_price: { $max: "$price" },
                avg_ppm: {
                  $avg: { $divide: ["$price", "$features.size_sqm"] },
                },
                cheaper: {
                  $sum: { $cond: [{ $lt: ["$price", price] }, 1, 0] },
                },
              },
            },
          ],
          similar: [
            {
              $match: {
                type: propertyType,
                "features.bedrooms": {
                  $gte: Math.max(0, bedrooms - 1),
                  $lte: bedrooms + 1,
                },
                "features.size_sqm": { $gte: sizeMin, $lte: sizeMax },
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                avg_price: { $avg: "$price" },
                avg_ppm: {
                  $avg: { $divide: ["$price", "$features.size_sqm"] },
                },
                cheaper: {
                  $sum: { $cond: [{ $lt: ["$price", price] }, 1, 0] },
                },
              },
            },
          ],
        },
      },
    ]);

    // Helpers
    function median(arr) {
      if (!arr?.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    }
    function pct(cheaper, total) {
      return total > 0 ? Math.round((cheaper / total) * 100) : 50;
    }
    function buildStats(raw) {
      if (!raw) return null;
      return {
        count: raw.count,
        avg_price: Math.round(raw.avg_price),
        median_price: median(raw.prices),
        min_price: raw.min_price,
        max_price: raw.max_price,
        avg_price_per_sqm: Math.round(raw.avg_ppm || 0),
        percentile: pct(raw.cheaper, raw.count),
      };
    }

    const hood = result.neighborhood[0] || null;
    const cityStats = result.city[0] || null;
    const sim = result.similar[0] || null;

    // Verdict
    const refPpm = hood?.avg_ppm || cityStats?.avg_ppm || 0;
    const diffPct =
      refPpm > 0 ? Math.round(((pricePerSqm - refPpm) / refPpm) * 100) : 0;
    const verdict =
      diffPct < -5 ? "below_market" : diffPct > 5 ? "above_market" : "at_market";

    const response = {
      property: {
        price,
        price_per_sqm: pricePerSqm,
        days_on_market: daysOnMarket,
        city,
        neighborhood,
        operation,
        type: propertyType,
        bedrooms,
        size_sqm: sizeSqm,
      },
      neighborhood: buildStats(hood),
      city: buildStats(cityStats),
      similar: sim
        ? {
            count: sim.count,
            avg_price: Math.round(sim.avg_price),
            avg_price_per_sqm: Math.round(sim.avg_ppm || 0),
            percentile: pct(sim.cheaper, sim.count),
          }
        : null,
      price_history: (property.price_history || []).map((h) => ({
        price: h.price,
        date: h.date,
      })),
      verdict,
      diff_pct: diffPct,
    };

    // Cache (max 500 entries)
    if (analysisCache.size > 500) {
      analysisCache.delete(analysisCache.keys().next().value);
    }
    analysisCache.set(cacheKey, { data: response, ts: Date.now() });

    res.json(response);
  } catch (err) {
    console.error("Analysis error:", err);
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
        { code: req.params.id.toUpperCase() },
      ],
    }).lean();

    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
