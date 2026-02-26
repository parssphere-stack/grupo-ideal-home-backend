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

// ── GET /api/properties ─────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const q = req.query;

    // ── Build filter ─────────────────────────────────────────
    const filter = { status: "active", is_particular: true };

    // Full-text search
    if (q.search && q.search.trim()) {
      filter.$text = { $search: q.search.trim() };
    }

    // City
    if (q.city && q.city !== "all") {
      filter["location.city"] = { $regex: q.city, $options: "i" };
    }

    // Operation
    if (q.operation && ["sale", "rent"].includes(q.operation)) {
      filter.operation = q.operation;
    }

    // Type
    if (q.type) {
      const types = q.type
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length === 1) filter.type = types[0];
      else if (types.length > 1) filter.type = { $in: types };
    }

    // Price range
    const priceFilter = {};
    if (q.min_price) priceFilter.$gte = Number(q.min_price);
    if (q.max_price) priceFilter.$lte = Number(q.max_price);
    if (Object.keys(priceFilter).length) filter.price = priceFilter;

    // Rooms
    const roomsFilter = {};
    if (q.min_rooms) roomsFilter.$gte = Number(q.min_rooms);
    if (q.max_rooms) roomsFilter.$lte = Number(q.max_rooms);
    if (Object.keys(roomsFilter).length)
      filter["features.bedrooms"] = roomsFilter;

    // Size
    const sizeFilter = {};
    if (q.min_size) sizeFilter.$gte = Number(q.min_size);
    if (q.max_size) sizeFilter.$lte = Number(q.max_size);
    if (Object.keys(sizeFilter).length)
      filter["features.size_sqm"] = sizeFilter;

    // Boolean features
    if (q.has_elevator === "1") filter["features.has_elevator"] = true;
    if (q.has_parking === "1") filter["features.has_parking"] = true;
    if (q.has_terrace === "1") filter["features.has_terrace"] = true;
    if (q.has_pool === "1") filter["features.has_pool"] = true;
    if (q.is_exterior === "1") filter["features.is_exterior"] = true;

    // Geo filter (radius)
    if (q.lat && q.lng && q.radius_km) {
      const lat = parseFloat(q.lat);
      const lng = parseFloat(q.lng);
      const radiusRad = parseFloat(q.radius_km) / 6371; // Earth radius km
      filter["location.latitude"] = {
        $gte: lat - parseFloat(q.radius_km) / 111,
        $lte: lat + parseFloat(q.radius_km) / 111,
      };
      filter["location.longitude"] = {
        $gte: lng - parseFloat(q.radius_km) / 80,
        $lte: lng + parseFloat(q.radius_km) / 80,
      };
    }

    // ── Sort ─────────────────────────────────────────────────
    let sort = { createdAt: -1 }; // default: newest
    const sortParam = q.sort || "newest";
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      size_desc: { "features.size_sqm": -1 },
      relevance: filter.$text
        ? { score: { $meta: "textScore" }, createdAt: -1 }
        : { createdAt: -1 },
    };
    sort = sortMap[sortParam] || sort;

    // ── Pagination ───────────────────────────────────────────
    const limit = Math.min(parseInt(q.limit) || 24, 10000);
    const page = Math.max(parseInt(q.page) || 1, 1);
    const skip = (page - 1) * limit;

    // ── Project fields (frontend needs) ─────────────────────
    const projection = {
      idealista_id: 1,
      title: 1,
      price: 1,
      price_per_sqm: 1,
      type: 1,
      operation: 1,
      location: 1,
      features: 1,
      images: { $slice: 3 }, // only first 3 images for list
      url: 1,
      contact: 1,
      is_particular: 1,
      createdAt: 1,
      scraped_at: 1,
      ...(filter.$text ? { score: { $meta: "textScore" } } : {}),
    };

    // ── Execute ──────────────────────────────────────────────
    const [properties, total] = await Promise.all([
      Property.find(filter, projection)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Property.countDocuments(filter),
    ]);

    // ── Normalize for frontend compatibility ─────────────────
    // Frontend expects: rooms, bathrooms, size, floor, hasLift, exterior
    // contactInfo.phone, address.city, address.neighborhood, etc.
    const normalized = properties.map((p) => ({
      _id: p._id,
      idealista_id: p.idealista_id,
      title: p.title,
      price: p.price,
      priceByArea: p.price_per_sqm,
      operation: p.operation,
      propertyType: p.type,
      rooms: p.features?.bedrooms,
      bathrooms: p.features?.bathrooms,
      size: p.features?.size_sqm,
      floor: p.features?.floor,
      hasLift: p.features?.has_elevator,
      hasParking: p.features?.has_parking,
      hasTerrace: p.features?.has_terrace,
      hasPool: p.features?.has_pool,
      exterior: p.features?.is_exterior,
      images: p.images || [],
      url: p.url,
      is_particular: p.is_particular,
      address: {
        street: p.location?.address,
        city: p.location?.city,
        district: p.location?.district,
        neighborhood: p.location?.neighborhood,
        province: p.location?.province,
      },
      location: {
        latitude: p.location?.latitude,
        longitude: p.location?.longitude,
      },
      contactInfo: {
        phone: p.contact?.phone,
        contactName: p.contact?.name,
        userType: "private",
      },
      createdAt: p.createdAt,
      scraped_at: p.scraped_at,
      // text score if search
      _score: p.score,
    }));

    res.json({
      data: normalized,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
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
            10000,
            5000,
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

const mongoose = require("mongoose");
module.exports = router;
