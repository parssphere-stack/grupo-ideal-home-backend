/**
 * SearchSession — Persistent AI search sessions
 *
 * Stores conversation history, last search filters, results, and user preferences.
 * Replaces in-memory session store for durability across server restarts.
 * TTL index auto-deletes sessions after 7 days of inactivity.
 */

const mongoose = require("mongoose");

const searchSessionSchema = new mongoose.Schema(
  {
    session_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // Full conversation messages (including tool_use/tool_result blocks)
    messages: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    // Last search filters for refinements
    lastFilters: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Last search result IDs (lightweight — just IDs, not full objects)
    lastResultIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    // Learned user preferences across conversations
    preferences: {
      preferredCity: String,
      preferredOperation: { type: String, enum: ["sale", "rent"] },
      budgetMin: Number,
      budgetMax: Number,
      preferredRooms: Number,
      preferredFeatures: [String], // ["parking", "terrace", "pool", etc.]
      language: String,
    },
    // Session metadata
    language: {
      type: String,
      default: "Spanish",
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    searchCount: {
      type: Number,
      default: 0,
    },
    lastAccess: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-delete sessions after 7 days of inactivity
searchSessionSchema.index({ lastAccess: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

// Compound index for user's recent sessions
searchSessionSchema.index({ user: 1, lastAccess: -1 });

module.exports = mongoose.model("SearchSession", searchSessionSchema);
