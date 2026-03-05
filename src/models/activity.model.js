const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["view", "search"], required: true },
    // For "view" events
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property" },
    // For "search" events — snapshot of filters used
    filters: {
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
  },
  { timestamps: true },
);

// Auto-delete activity older than 90 days
activitySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
activitySchema.index({ user: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("Activity", activitySchema);
