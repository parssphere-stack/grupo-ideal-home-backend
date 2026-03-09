/**
 * Shared property search service
 *
 * Used by: GET /api/properties route AND AI smart search tool.
 * Single source of truth for filter-building + normalization.
 */

const Property = require("../models/property.model");
const Agent = require("../models/agent.model");

/**
 * Search properties with structured filters.
 *
 * @param {Object} params
 * @param {string} [params.search] - Full-text search
 * @param {string} [params.city] - City name (regex match)
 * @param {string} [params.operation] - "sale" | "rent"
 * @param {string} [params.type] - Comma-separated property types
 * @param {number} [params.min_price]
 * @param {number} [params.max_price]
 * @param {number} [params.min_rooms]
 * @param {number} [params.max_rooms]
 * @param {number} [params.min_size]
 * @param {number} [params.max_size]
 * @param {boolean|string} [params.has_elevator]
 * @param {boolean|string} [params.has_parking]
 * @param {boolean|string} [params.has_terrace]
 * @param {boolean|string} [params.has_pool]
 * @param {boolean|string} [params.is_exterior]
 * @param {string} [params.excludeAssigned] - "1" to exclude agent-assigned
 * @param {number} [params.lat]
 * @param {number} [params.lng]
 * @param {number} [params.radius_km]
 * @param {string} [params.sort] - "newest"|"oldest"|"price_asc"|"price_desc"|"size_desc"|"relevance"
 * @param {number} [params.page] - Default 1
 * @param {number} [params.limit] - Default 24, max 10000
 * @returns {Promise<{properties: Array, total: number, page: number, pages: number}>}
 */
async function searchProperties(params) {
  const q = params || {};

  // ── Build filter ─────────────────────────────────────────
  const filter = { status: "active", is_particular: true };

  // Full-text search (accent/diacritic-insensitive regex)
  if (q.search && String(q.search).trim()) {
    const searchTerm = String(q.search).trim();
    // Build accent-insensitive regex from search term
    const searchNorm = searchTerm
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const searchRegex = searchNorm.replace(/[aeiouns]/gi, (ch) => {
      const map = {
        a: "[aáàäâã]",
        e: "[eéèëê]",
        i: "[iíìïî]",
        o: "[oóòöôõ]",
        u: "[uúùüû]",
        n: "[nñ]",
        s: "[sś]",
      };
      return map[ch.toLowerCase()] || ch;
    });
    const rgx = { $regex: searchRegex, $options: "i" };
    // Search across location fields + title + description with accent tolerance
    filter.$or = [
      { "location.neighborhood": rgx },
      { "location.district": rgx },
      { "location.address": rgx },
      { title: rgx },
      { description: rgx },
    ];
  }

  // City (accent-insensitive regex using Unicode character classes)
  if (q.city && q.city !== "all") {
    // Normalize: strip accents for regex matching so "malaga" matches "Málaga"
    const cityNorm = q.city
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    // Build regex that matches both accented and unaccented forms
    const cityRegex = cityNorm.replace(/[aeiouns]/gi, (ch) => {
      const map = {
        a: "[aáàäâã]",
        e: "[eéèëê]",
        i: "[iíìïî]",
        o: "[oóòöôõ]",
        u: "[uúùüû]",
        n: "[nñ]",
        s: "[sś]",
      };
      return map[ch.toLowerCase()] || ch;
    });
    filter["location.city"] = { $regex: cityRegex, $options: "i" };
  }

  // Operation
  if (q.operation && ["sale", "rent"].includes(q.operation)) {
    filter.operation = q.operation;
  }

  // Type
  if (q.type) {
    const types = String(q.type)
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

  // Boolean features — accept both "1" (from query string) and true (from tool use)
  const isTruthy = (v) => v === "1" || v === true;
  if (isTruthy(q.has_elevator)) filter["features.has_elevator"] = true;
  if (isTruthy(q.has_parking)) filter["features.has_parking"] = true;
  if (isTruthy(q.has_terrace)) filter["features.has_terrace"] = true;
  if (isTruthy(q.has_pool)) filter["features.has_pool"] = true;
  if (isTruthy(q.is_exterior)) filter["features.is_exterior"] = true;
  if (isTruthy(q.has_ac)) filter["features.has_ac"] = true;

  // Exclude already-assigned properties
  if (q.excludeAssigned === "1") {
    const allAgents = await Agent.find({}, "assignedProperties").lean();
    const assignedIds = allAgents.flatMap((a) => a.assignedProperties || []);
    if (assignedIds.length) filter._id = { $nin: assignedIds };
  }

  // Geo filter (radius)
  if (q.lat && q.lng && q.radius_km) {
    const lat = parseFloat(q.lat);
    const radiusKm = parseFloat(q.radius_km);
    filter["location.latitude"] = {
      $gte: lat - radiusKm / 111,
      $lte: lat + radiusKm / 111,
    };
    filter["location.longitude"] = {
      $gte: parseFloat(q.lng) - radiusKm / 80,
      $lte: parseFloat(q.lng) + radiusKm / 80,
    };
  }

  // Polygon geo filter (array of [lng, lat] coordinates)
  // Accepts: q.polygon as JSON string or array of [lng, lat] pairs
  if (q.polygon) {
    let coords = q.polygon;
    if (typeof coords === "string") {
      try {
        coords = JSON.parse(coords);
      } catch {
        coords = null;
      }
    }
    if (Array.isArray(coords) && coords.length >= 3) {
      // Ensure polygon is closed (first point == last point)
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([...first]);
      }
      filter.geo = {
        $geoWithin: {
          $geometry: {
            type: "Polygon",
            coordinates: [coords],
          },
        },
      };
    }
  }

  // ── Sort ─────────────────────────────────────────────────
  let sort = { createdAt: -1 };
  const sortParam = q.sort || "newest";
  const sortMap = {
    // Named sort values (used by AI search + legacy)
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    size_desc: { "features.size_sqm": -1 },
    relevance: { createdAt: -1 },
    // Frontend sort values (dash prefix = descending)
    "-scraped_at": { scraped_at: -1 },
    price: { price: 1 },
    "-price": { price: -1 },
    "-size": { "features.size_sqm": -1 },
  };
  sort = sortMap[sortParam] || sort;

  // ── Pagination ───────────────────────────────────────────
  const limit = Math.min(parseInt(q.limit) || 24, 10000);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const skip = (page - 1) * limit;

  // ── Project fields ───────────────────────────────────────
  const projection = {
    code: 1,
    idealista_id: 1,
    title: 1,
    description: 1,
    price: 1,
    price_per_sqm: 1,
    type: 1,
    operation: 1,
    location: 1,
    features: 1,
    images: 1,
    url: 1,
    contact: 1,
    is_particular: 1,
    createdAt: 1,
    scraped_at: 1,
  };

  // ── Execute ──────────────────────────────────────────────
  const [properties, total] = await Promise.all([
    Property.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
    Property.countDocuments(filter),
  ]);

  // ── Normalize for frontend compatibility ─────────────────
  const normalized = properties.map((p) => ({
    _id: p._id,
    code: p.code,
    idealista_id: p.idealista_id,
    title: p.title,
    price: p.price,
    priceByArea: p.price_per_sqm,
    operation: p.operation,
    type: p.type,
    rooms: p.features?.bedrooms,
    bathrooms: p.features?.bathrooms,
    size: p.features?.size_sqm,
    floor: p.features?.floor,
    hasLift: p.features?.has_elevator,
    hasParking: p.features?.has_parking,
    hasTerrace: p.features?.has_terrace,
    hasPool: p.features?.has_pool,
    hasAC: p.features?.has_ac,
    exterior: p.features?.is_exterior,
    images: p.images || [],
    url: p.url,
    is_particular: p.is_particular,
    location: {
      city: p.location?.city,
      district: p.location?.district,
      neighborhood: p.location?.neighborhood,
      zone: p.location?.neighborhood || p.location?.district,
      province: p.location?.province,
      address: p.location?.address,
      latitude: p.location?.latitude,
      longitude: p.location?.longitude,
    },
    contact: {
      phone: p.contact?.phone,
      name: p.contact?.name,
    },
    description: p.description || "",
    createdAt: p.createdAt,
    scraped_at: p.scraped_at,
  }));

  return {
    properties: normalized,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

module.exports = { searchProperties };
