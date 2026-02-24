const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true, unique: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", required: true },
    status: {
      type: String,
      enum: ["contactado", "negociacion", "deal", "descartado"],
      default: "contactado",
    },
    notes: String,
    contactedAt: { type: Date, default: Date.now },
    updatedAt: Date,
  },
  { timestamps: true }
);

leadSchema.index({ agent: 1, status: 1 });
leadSchema.index({ property: 1 });

module.exports = mongoose.model("Lead", leadSchema);
