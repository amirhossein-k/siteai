import mongoose from "mongoose";

/**
 * Customer Wishlist (Sessions 35 + 43).
 *
 * Product- AND variant-level wishlist rows coexist (Session 43):
 *   - product-level rows:  variantId = null  (customer saved the product)
 *   - variant-level rows:  variantId = <variant ObjectId> + variantSnapshot
 *     { sku, label } denormalized at save time (customer saved a specific
 *     size/color/etc.)
 * The unique index { user, product, variantId } allows BOTH kinds for the
 * same product while keeping each (user, product, variantId) atomic-unique
 * (MongoDB treats null as a value, so at most one product-level row per
 * user+product, and each variant row is distinct).
 *
 * Records are never silently deleted when a product becomes inactive or is
 * removed: the wishlist row stays, and the APIs return the product's current
 * state (isActive: false) or a null-product placeholder so the customer can
 * see WHY an item is unavailable and remove it themselves.
 */
const WishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    // --- Session 43: variant-level wishlist (variantId null = product-level) ---
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    variantSnapshot: {
      sku: { type: String, default: "" },
      label: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// One wishlist row per (user, product, variantId) — atomic duplicate
// prevention. variantId null = product-level row; a real variantId = a
// variant-level row. Product-level + variant rows COEXIST for one product
// (Session 43 index migration: {user,product} → {user,product,variantId}).
WishlistSchema.index({ user: 1, product: 1, variantId: 1 }, { unique: true });
// Wishlist page query (newest first)
WishlistSchema.index({ user: 1, createdAt: -1 });

export default mongoose.models.Wishlist ||
  mongoose.model("Wishlist", WishlistSchema);
