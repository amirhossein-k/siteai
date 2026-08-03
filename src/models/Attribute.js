import mongoose from "mongoose";

/**
 * Attribute — global definitions for product variant dimensions
 * (e.g. رنگ = color, سایز = size). Products reference these via
 * variant.attributes[] (attributeId + denormalized name + value).
 */
const AttributeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["text", "color", "size", "number"],
      default: "text",
    },
    // Preset allowed values (e.g. ["قرمز", "آبی", "سبز"])
    values: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.models.Attribute ||
  mongoose.model("Attribute", AttributeSchema);
