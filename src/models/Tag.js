import mongoose from "mongoose";

const TagSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Note: slug unique index is already defined via `unique: true` in the schema field above
TagSchema.index({ isActive: 1, name: 1 });

export default mongoose.models.Tag || mongoose.model("Tag", TagSchema);
