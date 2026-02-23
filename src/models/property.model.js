const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  external_id: {
    type: String,
    unique: true,
    sparse: true
  },
  source: {
    type: String,
    enum: ['idealista', 'fotocasa', 'manual', 'mls'],
    default: 'manual'
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  type: {
    type: String,
    enum: ['apartment', 'house', 'villa', 'studio', 'penthouse', 'commercial', 'land'],
    required: true
  },
  operation: {
    type: String,
    enum: ['sale', 'rent'],
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  price_per_sqm: Number,
  currency: {
    type: String,
    default: 'EUR'
  },
  location: {
    address: String,
    city: String,
    district: String,
    neighborhood: String,
    postal_code: String,
    province: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  features: {
    size_sqm: Number,
    bedrooms: Number,
    bathrooms: Number,
    floor: Number,
    has_elevator: Boolean,
    has_parking: Boolean,
    has_terrace: Boolean,
    has_pool: Boolean,
    has_garden: Boolean,
    has_storage: Boolean,
    has_ac: Boolean,
    has_heating: Boolean,
    energy_rating: String,
    year_built: Number,
    condition: {
      type: String,
      enum: ['new', 'good', 'needs_renovation', 'renovated'],
    }
  },
  images: [String],
  url: String,
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  },
  status: {
    type: String,
    enum: ['active', 'reserved', 'sold', 'rented', 'inactive'],
    default: 'active'
  },
  views: { type: Number, default: 0 },
  inquiries: { type: Number, default: 0 },
  last_scraped_at: Date,
  price_history: [{
    price: Number,
    date: Date
  }]
}, {
  timestamps: true
});

// Indexes
propertySchema.index({ operation: 1, 'location.city': 1, price: 1 });
propertySchema.index({ 'location.district': 1, type: 1 });
propertySchema.index({ 'features.bedrooms': 1, price: 1 });
propertySchema.index({ status: 1 });
propertySchema.index({ source: 1, status: 1, last_scraped_at: 1 });
propertySchema.index({ external_id: 1 });

// Virtual: price formatted
propertySchema.virtual('price_formatted').get(function () {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  }).format(this.price);
});

module.exports = mongoose.model('Property', propertySchema);