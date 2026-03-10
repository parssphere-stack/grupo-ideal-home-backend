const mongoose = require('mongoose');

const pageviewSchema = new mongoose.Schema({
  // Session fingerprint (hashed IP + UA, no PII stored)
  sid: { type: String, index: true },
  page: { type: String, default: '/' },
  referrer: String,
  // Device info
  device: { type: String, enum: ['desktop', 'tablet', 'mobile'], default: 'desktop' },
  browser: String,
  os: String,
  // Geo (from request headers / IP)
  country: String,
  city: String,
  // Source
  utm_source: String,
  utm_medium: String,
  utm_campaign: String,
  // Timing
  duration: { type: Number, default: 0 }, // seconds on page
}, {
  timestamps: true,
});

// TTL: auto-delete after 90 days to save space
pageviewSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
// Query indexes
pageviewSchema.index({ createdAt: -1 });
pageviewSchema.index({ page: 1, createdAt: -1 });

module.exports = mongoose.model('Pageview', pageviewSchema);
