const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    detected_language: String,
    tokens_used: Number,
    response_time_ms: Number
  }
});

const leadInfoSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  budget_min: Number,
  budget_max: Number,
  looking_for: {
    type: String,
    enum: ['buy', 'rent', 'invest', 'unknown'],
    default: 'unknown'
  },
  property_type: {
    type: String,
    enum: ['apartment', 'house', 'villa', 'studio', 'penthouse', 'commercial', 'land', 'unknown'],
    default: 'unknown'
  },
  preferred_areas: [String],
  bedrooms: Number,
  special_requirements: [String],
  timeline: String,
  has_financing: Boolean,
  has_visited: Boolean,
  nationality: String,
  score: {
    type: Number,
    default: 0
  }
});

const conversationSchema = new mongoose.Schema({
  session_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  channel: {
    type: String,
    enum: ['widget', 'instagram', 'whatsapp', 'phone', 'idealista'],
    default: 'widget'
  },
  language: {
    type: String,
    default: 'es'
  },
  status: {
    type: String,
    enum: ['active', 'qualified', 'handed_off', 'closed', 'spam'],
    default: 'active'
  },
  messages: [messageSchema],
  lead_info: {
    type: leadInfoSchema,
    default: () => ({})
  },
  assigned_agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  },
  handed_off_at: Date,
  source_url: String,
  ip_address: String,
  user_agent: String,
  tags: [String]
}, {
  timestamps: true
});

// Indexes
conversationSchema.index({ status: 1, createdAt: -1 });
conversationSchema.index({ 'lead_info.score': -1 });
conversationSchema.index({ channel: 1 });

// Virtual: message count
conversationSchema.virtual('message_count').get(function () {
  return this.messages.length;
});

// Method: add message
conversationSchema.methods.addMessage = function (role, content, metadata = {}) {
  this.messages.push({ role, content, metadata });
  return this.save();
};

// Method: get conversation history for AI
conversationSchema.methods.getAIHistory = function (maxMessages = 20) {
  const recent = this.messages.slice(-maxMessages);
  return recent.map(m => ({
    role: m.role,
    content: m.content
  }));
};

module.exports = mongoose.model('Conversation', conversationSchema);
