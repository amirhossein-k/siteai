import mongoose from "mongoose";

/**
 * Customer Review (Session 34).
 *
 * One review per purchased ORDER-ITEM: the unique compound index
 * { customer, product, order } guarantees a customer can review a product at
 * most once per order (order items are already aggregated per product within
 * an order). The order reference also serves as the verified-purchase proof.
 *
 * Moderation workflow: pending → approved / rejected (reviewedBy/reviewedAt/
 * rejectionReason recorded for an immutable audit trail).
 *
 * SEO / storefront only ever aggregate APPROVED reviews (ratingSummary is
 * computed on the fly in the products/reviews APIs — never stored, so it can
 * never drift out of sync with the review collection).
 */
const ReviewSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // Verified-purchase proof + per-order-item uniqueness anchor
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    // --- Denormalized supplier (copied from product.supplier at creation) ---
    // Stable ownership snapshot: even if the product's supplier changes later,
    // the review stays bound to the supplier who sold the item. Used for the
    // supplier reply queue (Session 37).
    //
    // INVARIANT: Review.supplier is ALWAYS copied from product.supplier at
    // creation (see POST /api/reviews). The ONLY write path that creates
    // reviews is that route, so the field cannot drift on the happy path. The
    // reply route independently re-verifies live ownership via
    // Review.product -> Product.supplier (it never trusts this snapshot). Keep
    // this invariant if a future write path ever creates reviews.
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },
    // --- Immutable order-item snapshot for audit (copied at creation) ---
    // Keeps the review readable even if the order/product/variant change later.
    itemSnapshot: {
      name: { type: String, default: "" },
      sku: { type: String, default: "" },
      variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
      variantLabel: { type: String, default: "" },
      image: { type: String, default: "" },
      price: { type: Number, default: 0 },
      quantity: { type: Number, default: 0 },
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    // Moderation workflow
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "" },
    // --- Supplier reply (Session 37) ---
    // Single reply per review (per approved design): author (supplier user),
    // text, at. default null — the atomic reply claim uses `reply: null`
    // (MongoDB matches a missing subdoc with null equality), so a review can
    // receive at most one reply. No admin moderation for replies (sanitized +
    // rate-limited at write time).
    // IMPORTANT: typed subdocument with `default: null`. An INLINE subdoc
    // definition would make Mongoose auto-populate `{ author: null, text: "",
    // at: null }` on every review — the atomic `reply: null` claim would never
    // match and every reply would fail with "already replied". With
    // `type: <Schema>` + `default: null`, the field stays null until set.
    reply: {
      type: new mongoose.Schema(
        {
          author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
          },
          text: { type: String, default: "", maxlength: 1000, trim: true },
          at: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { timestamps: true }
);

// One review per purchased order-item (atomic duplicate prevention)
ReviewSchema.index({ customer: 1, product: 1, order: 1 }, { unique: true });
// Approved-only listing per product (storefront)
ReviewSchema.index({ product: 1, status: 1, createdAt: -1 });
// Admin moderation queue
ReviewSchema.index({ status: 1, createdAt: -1 });
// Supplier reply queue (Session 37)
ReviewSchema.index({ supplier: 1, status: 1, createdAt: -1 });

export default mongoose.models.Review || mongoose.model("Review", ReviewSchema);
