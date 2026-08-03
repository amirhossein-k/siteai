import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // برای دسته‌بندی‌های تو در تو، مثلا "پوشاک > مردانه > پیراهن"
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    // آیکون یا تصویر دسته‌بندی
    icon: {
      type: String,
      default: "",
    },
    image: {
      type: String,
      default: "",
    },
    // توضیحات کوتاه برای دسته‌بندی
    description: {
      type: String,
      default: "",
      maxlength: 500,
    },
    // ترتیب نمایش (برای مرتب‌سازی دستی)
    sortOrder: {
      type: Number,
      default: 0,
    },
    // وضعیت فعال/غیرفعال
    isActive: {
      type: Boolean,
      default: true,
    },
    // SEO
    metaTitle: {
      type: String,
      default: "",
      maxlength: 70,
    },
    metaDescription: {
      type: String,
      default: "",
      maxlength: 160,
    },
  },
  { timestamps: true }
);

// ایندکس ترکیبی برای جستجوی سریع
// Note: slug unique index is already defined via `unique: true` in the schema field above
CategorySchema.index({ parent: 1, sortOrder: 1 });
CategorySchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.models.Category ||
  mongoose.model("Category", CategorySchema);
