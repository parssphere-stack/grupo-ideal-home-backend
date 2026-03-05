const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    active: { type: Boolean, default: true },
    frequency: {
      type: String,
      enum: ["immediate", "daily", "weekly"],
      default: "daily",
    },
    criteria: {
      city: String,
      operation: String,
      propertyType: String,
      minPrice: Number,
      maxPrice: Number,
      minRooms: Number,
      minSize: Number,
      maxSize: Number,
      hasElevator: Boolean,
      hasParking: Boolean,
      hasPool: Boolean,
      hasTerrace: Boolean,
      isExterior: Boolean,
    },
    lastSentAt: Date,
    lastMatchCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Alert", alertSchema);
