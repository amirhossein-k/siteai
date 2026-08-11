import mongoose from "mongoose";

/**
 * Embedded Product Variant — one row of the variant matrix.
 * The subdocument `_id` serves as the `variantId` used in cart/order flows.
 */
const ProductVariantSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
    },
    // Denormalized attribute selections: [{ attributeId, name, value }]
    attributes: [
      {
        attributeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Attribute",
          required: true,
        },
        name: { type: String, required: true },
        value: { type: String, required: true },
      },
      { _id: false },
    ],
    // قیمت این تنوع — کاملاً جایگزین قیمت پایه محصول می‌شود
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    supplierPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    // optimistic concurrency lock per variant
    stockVersion: {
      type: Number,
      default: 0,
    },
    images: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

const ProductSchema = new mongoose.Schema(
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
    description: {
      type: String,
      default: "",
    },
    // Session 69 — rich product description: Slate JSON tree from the
    // @platejs editor (server-validated against an allowlist in
    // src/lib/product-description.ts). `description` above stays as the
    // derived plain-text projection (search/CSV/JSON-LD/legacy rendering).
    // ADDITIVE & OPTIONAL — legacy products have only `description`.
    descriptionRich: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    images: {
      type: [String],
      default: [],
    },
    // برند محصول (اختیاری)
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
    },
    // برچسب‌های محصول (چندتایی)
    tags: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Tag",
      default: [],
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    // قیمتی که فروشنده از تو می‌گیره (هزینه‌ی تمام‌شده)
    supplierPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    // قیمتی که مشتری توی سایت می‌بینه و پرداخت می‌کنه
    // برای محصولات دارای تنوع، این مقدار = کمترین قیمت تنوع فعال است
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    // برای محصولات دارای تنوع، این مقدار = مجموع موجودی تنوع‌های فعال است
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    // نسخه موجودی برای optimistic concurrency (محصول ساده)
    stockVersion: {
      type: Number,
      default: 0,
    },
    // آیا محصول دارای تنوع است؟
    hasVariants: {
      type: Boolean,
      default: false,
    },
    // تنوع‌های محصول (خالی برای محصولات ساده)
    variants: {
      type: [ProductVariantSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Product discount / sale pricing (optional embedded subdocument).
    // ABSENT on all pre-discount products — zero migration. Admin-only write
    // (the supplier product routes never map it). Pricing math + validation
    // live in src/lib/product-pricing.ts (single source of truth); this is
    // storage only. Public shapes NEVER expose the raw subdoc — only the
    // active-only metadata computed by getEffectivePrice/toPublicDiscount.
    discount: {
      type: new mongoose.Schema(
        {
          type: {
            type: String,
            enum: ["percent", "fixed"],
            required: true,
          },
          // percent → discount percent (1–90); fixed → whole toman amount
          value: {
            type: Number,
            required: true,
            min: 1,
          },
          startsAt: { type: Date, default: null },
          endsAt: { type: Date, default: null },
          isActive: {
            type: Boolean,
            default: true,
          },
        },
        { _id: false }
      ),
      default: undefined,
    },
    // Session 56 — Best-Sellers: total units SOLD (paid, non-refunded).
    // Incremented at payment verify (pending→paid claim) and decremented at
    // admin refund (paid→refunded claim) — both exactly-once by construction.
    // Product-level sum across ALL variants; per-variant sales tracking is
    // future scope (documented in NEXT_SESSION.md). INTERNAL: never exposed
    // through the public products API (excluded by projection) — it exists
    // only to power the sort=best_selling ranking.
    soldCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// حاشیه سود هر واحد محصول (virtual، توی دیتابیس ذخیره نمی‌شه)
ProductSchema.virtual("margin").get(function () {
  return this.price - this.supplierPrice;
});
ProductSchema.set("toJSON", { virtuals: true });

// Globally unique SKU across all products (sparse — simple products excluded)
ProductSchema.index({ "variants.sku": 1 }, { unique: true, sparse: true });

// Best-sellers ranking (Session 56) — most-sold first, newest as tie-breaker.
// Non-unique; serves the public sort=best_selling path. soldCount is internal
// (excluded from public responses) — the index only powers the sort.
ProductSchema.index({ soldCount: -1, createdAt: -1 });

// Active-discount queries (homepage «محصولات تخفیف‌دار» rail): filters
// discount.isActive + startsAt/endsAt window at request time. Non-unique;
// catalog size is small — the index is cheap insurance, not a dependency.
ProductSchema.index({
  "discount.isActive": 1,
  "discount.startsAt": 1,
  "discount.endsAt": 1,
});

// Auto-increment stockVersion whenever stock changes (via save)
ProductSchema.pre("save", function (next) {
  if (this.isModified("stock")) {
    this.stockVersion = (this.stockVersion || 0) + 1;
  }
  next();
});

// Auto-increment stockVersion for findOneAndUpdate (used by findByIdAndUpdate)
// This covers admin/supplier direct stock edits via product PUT handlers.
// IMPORTANT: Only adds $inc: { stockVersion: 1 } if stockVersion is NOT already
// being explicitly set in the update query. Avoids Mongoose conflict error
// when the same path appears in both $set and $inc.
// Variant-level stock changes use the "variants.$" path — the top-level
// `stock` summary is updated alongside, which keeps the summary version bumping.
ProductSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  if (update && typeof update === "object") {
    const setUpdate = update.$set;
    const hasStockInc = update.$inc && update.$inc.stock !== undefined;
    const hasStockSet = setUpdate && setUpdate.stock !== undefined;
    const hasStockDirect = update.stock !== undefined;

    // Skip if stockVersion is already being explicitly set or incremented
    const versionAlreadyInc = update.$inc && update.$inc.stockVersion !== undefined;
    const versionAlreadySet = setUpdate && setUpdate.stockVersion !== undefined;

    if ((hasStockInc || hasStockSet || hasStockDirect) && !versionAlreadyInc && !versionAlreadySet) {
      const existingInc = update.$inc || {};
      this.setUpdate({
        ...update,
        $inc: {
          ...existingInc,
          stockVersion: 1,
        },
      });
    }
  }
  next();
});

export default mongoose.models.Product ||
  mongoose.model("Product", ProductSchema);
