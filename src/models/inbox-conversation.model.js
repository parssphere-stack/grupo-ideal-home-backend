const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ["buyer", "agent", "system"],
    required: true,
  },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
});

const inboxConversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
    },
    agentRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AgentRequest",
    },
    subject: String,
    messages: [messageSchema],
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("InboxConversation", inboxConversationSchema);
