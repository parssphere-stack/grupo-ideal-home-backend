const mongoose = require("mongoose");

// Counter schema for auto-incrementing property codes
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", counterSchema);

const propertySchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, sparse: true },
    idealista_id: { type: String, unique: true, required: true },
    title: String,
    description: String,
    price: Number,
    price_per_sqm: Number,
    type: {
      type: String,
      enum: [
        "apartment",
        "house",
        "villa",
        "penthouse",
        "studio",
        "duplex",
        "loft",
        "land",
        "commercial",
        "other",
      ],
    },
    operation: { type: String, enum: ["sale", "rent"] },
    location: {
      address: String,
      city: String,
      district: String,
      neighborhood: String,
      province: String,
      latitude: Number,
      longitude: Number,
    },
    geo: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] }, // [longitude, latitude]
    },
    features: {
      size_sqm: Number,
      bedrooms: Number,
      bathrooms: Number,
      floor: String,
      has_elevator: Boolean,
      has_parking: Boolean,
      has_terrace: Boolean,
      has_pool: Boolean,
      has_ac: Boolean,
      has_garden: Boolean,
      is_exterior: Boolean,
    },
    images: [String],
    url: String,
    contact: {
      name: String,
      type: { type: String, enum: ["particular", "agency"] },
      phone: String,
    },
    is_particular: { type: Boolean, default: true },
    status: { type: String, default: "active" },
    source: { type: String, default: "idealista" },
    price_history: [{ price: Number, date: { type: Date, default: Date.now } }],
    scraped_at: Date,
    validated_at: Date,
    phone_checked_at: Date,
  },
  { timestamps: true },
);

// ── Indexes for fast querying ────────────────────────────────
// GeoJSON 2dsphere index for polygon/geo queries
propertySchema.index({ geo: "2dsphere" });
// Legacy geo index (kept for backwards compat)
propertySchema.index({ "location.latitude": 1, "location.longitude": 1 });

// Filter indexes
propertySchema.index({ operation: 1, status: 1, is_particular: 1 });
propertySchema.index({ "location.city": 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ "features.bedrooms": 1 });
propertySchema.index({ "features.size_sqm": 1 });
propertySchema.index({ type: 1 });
propertySchema.index({ createdAt: -1 });
propertySchema.index({ status: 1, validated_at: 1 });
propertySchema.index({ status: 1, operation: 1, "location.city": 1, "location.neighborhood": 1 });

// Full-text search index
propertySchema.index(
  {
    title: "text",
    description: "text",
    "location.address": "text",
    "location.neighborhood": "text",
    "location.district": "text",
    "location.city": "text",
  },
  {
    weights: {
      title: 10,
      "location.neighborhood": 8,
      "location.district": 6,
      "location.address": 4,
      description: 2,
      "location.city": 3,
    },
    name: "property_text_index",
  },
);

// Auto-populate geo field from lat/lng before saving
propertySchema.pre("save", function (next) {
  const lat = this.location?.latitude;
  const lng = this.location?.longitude;
  if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
    this.geo = { type: "Point", coordinates: [lng, lat] };
  }
  next();
});

// Auto-generate numeric code before saving (10001, 10002, ...)
propertySchema.pre("save", async function (next) {
  if (!this.code) {
    const counter = await Counter.findByIdAndUpdate(
      "property_code",
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    this.code = String(10000 + counter.seq);
  }
  next();
});

module.exports = mongoose.model("Property", propertySchema);
