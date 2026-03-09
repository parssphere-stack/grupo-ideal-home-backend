/**
 * AgentRequest — Customer requests to speak with a human agent
 *
 * Created when the AI voice/chat agent detects the user wants
 * to talk to a real person. Stores conversation summary, contact info,
 * and assignment tracking.
 */

const mongoose = require("mongoose");

const agentRequestSchema = new mongoose.Schema(
  {
    // Customer info (collected by AI during conversation)
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    customerEmail: { type: String, default: "" },
    language: { type: String, default: "es" },

    // AI conversation summary
    summary: { type: String, required: true },
    // What they're looking for
    lookingFor: { type: String, default: "" },
    // Budget range mentioned
    budget: { type: String, default: "" },
    // Preferred city/area
    preferredArea: { type: String, default: "" },

    // Source: "voice" (VAPI) or "chat" (text AI)
    source: { type: String, enum: ["voice", "chat"], default: "chat" },

    // VAPI call ID for voice sessions
    callId: { type: String, default: null },
    // AI session ID for chat sessions
    sessionId: { type: String, default: null },

    // Assignment
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    assignedAt: { type: Date, default: null },

    // Status tracking
    status: {
      type: String,
      enum: ["new", "assigned", "contacted", "completed", "dismissed"],
      default: "new",
    },

    // Property the customer is interested in
    interestedProperty: {
      propertyId: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
      title: { type: String, default: "" },
      price: { type: Number, default: null },
      operation: { type: String, default: "" },
      rooms: { type: Number, default: null },
      size: { type: Number, default: null },
      neighborhood: { type: String, default: "" },
      city: { type: String, default: "" },
      imageUrl: { type: String, default: "" },
    },

    // Agent notes
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Index for admin dashboard queries
agentRequestSchema.index({ status: 1, createdAt: -1 });
agentRequestSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model("AgentRequest", agentRequestSchema);
