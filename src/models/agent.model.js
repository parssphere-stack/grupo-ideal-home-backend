const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: String,
  password: { type: String, required: true },
  avatar: String,
  role: {
    type: String,
    enum: ['agent', 'manager', 'admin'],
    default: 'agent'
  },
  specialization: [{
    type: String,
    enum: ['residential', 'commercial', 'luxury', 'investment', 'rental']
  }],
  areas: [String], // Districts/neighborhoods they cover
  languages: [String],
  is_active: { type: Boolean, default: true },
  is_available: { type: Boolean, default: true },
  stats: {
    total_leads: { type: Number, default: 0 },
    converted_leads: { type: Number, default: 0 },
    active_listings: { type: Number, default: 0 },
    total_sales: { type: Number, default: 0 },
    rating: { type: Number, default: 0 }
  },
  // Co-brokerage settings
  cobrokerage: {
    enabled: { type: Boolean, default: true },
    commission_split: { type: Number, default: 50 } // percentage
  }
}, {
  timestamps: true
});

agentSchema.index({ is_active: 1, is_available: 1 });
agentSchema.index({ areas: 1 });

module.exports = mongoose.model('Agent', agentSchema);
