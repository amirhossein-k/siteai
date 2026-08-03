import mongoose from "mongoose";

const BrandSchema = new mongoose.Schema(
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
    // توضیحات کوتاه درباره برند
    description: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    // لوگوی برند (URL)
    logo: {
      type: String,
      default: "",
    },
    // وبسایت رسمی برند
    website: {
      type: String,
      default: "",
    },
    // وضعیت فعال/غیرفعال
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Note: slug unique index is already defined via `unique: true` in the schema field above
BrandSchema.index({ isActive: 1, name: 1 });

export default mongoose.models.Brand || mongoose.model("Brand", BrandSchema);
