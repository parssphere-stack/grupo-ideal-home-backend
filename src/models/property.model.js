const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
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
    scraped_at: Date,
  },
  { timestamps: true },
);

// ── Indexes for fast querying ────────────────────────────────
// Geo index for map queries
propertySchema.index({ "location.latitude": 1, "location.longitude": 1 });

// Filter indexes
propertySchema.index({ operation: 1, status: 1, is_particular: 1 });
propertySchema.index({ "location.city": 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ "features.bedrooms": 1 });
propertySchema.index({ "features.size_sqm": 1 });
propertySchema.index({ type: 1 });
propertySchema.index({ createdAt: -1 });

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

module.exports = mongoose.model("Property", propertySchema);
