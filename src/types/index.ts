// ============================================================
// Shared TypeScript Types
// ============================================================

// --- User & Auth ---
export type UserRole = "customer" | "supplier" | "admin";

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  image?: string;
}

export interface AuthSession {
  user: User;
  expires: string;
}

// --- API Responses ---
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

// --- Common ---
export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface ContactInfo {
  phone: string;
  email?: string;
}

// --- Attribute ---
export type AttributeType = "text" | "color" | "size" | "number";

export interface Attribute {
  _id: string;
  name: string;
  slug: string;
  type: AttributeType;
  values: string[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// --- Product Variant ---
export interface ProductVariantAttribute {
  attributeId: string;
  name: string;
  value: string;
}

export interface ProductVariant {
  _id: string;
  sku: string;
  attributes: ProductVariantAttribute[];
  price: number;
  /** Server-computed effective (post-discount) price — equals price when no discount is active. */
  effectivePrice?: number;
  supplierPrice: number;
  stock: number;
  stockVersion?: number;
  images: string[];
  isActive: boolean;
}

// --- Rich product description (Session 69) ---
// Structured Slate JSON emitted by the @platejs editor; server-validated
// against an allowlist (src/lib/product-description.ts). `description` stays
// the derived plain-text projection.
//
// Deliberately loosely typed at the API boundary: the editor's own TDescendant
// type is not exported from this app, and strict structural validation lives
// server-side. Consumers must only read allowed fields (type, children, text,
// url, align, bold/italic/.../color/backgroundColor marks).
export type RichDescriptionNode = {
  type?: string;
  text?: string;
  url?: string;
  /** Paste-deserializer key from @platejs/link (always "_blank" — server-bounded). */
  target?: string;
  align?: string;
  /** Plate ListPlugin list style on blocks (bounded CSS values: ul/ol/disc/...). */
  listStyleType?: string;
  /** Plate ListPlugin nesting depth (flat list model: block + indent). */
  indent?: number;
  /** Plate ListPlugin ol restart value. */
  listStart?: number;
  /** Plate's stable node id (short alphanumeric, server-bounded). */
  id?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  highlight?: boolean;
  code?: boolean;
  color?: string;
  backgroundColor?: string;
  children?: RichDescriptionNode[];
};

// --- Product discount / sale pricing (Session 77) ---
// The stored config is an OPTIONAL embedded Product.discount subdoc (absent on
// pre-discount products — zero migration). Pricing math + time semantics live
// in src/lib/product-pricing.ts (single source of truth). The STORED config
// is admin/API-only and NEVER appears on public shapes — public payloads
// carry only the ACTIVE-only summary below (discount = null when no discount
// is live, so future/expired/disabled configuration never leaks).
export type ProductDiscountType = "percent" | "fixed";

/** Raw stored/admin-submitted discount (Product.discount subdoc). */
export interface ProductDiscount {
  type: ProductDiscountType;
  /** percent → 1–90; fixed → whole toman amount */
  value: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

/** Active-only public discount summary (product.discount = null when inactive). */
export interface ProductDiscountSummary {
  type: ProductDiscountType;
  value: number;
  /** Badge percentage: configured value for percent, computed for fixed. */
  percent: number;
  /** Absolute toman reduction on the relevant unit price. */
  amount: number;
  startsAt: string | null;
  endsAt: string | null;
}

// --- Product ---
export interface Product {
  _id: string;
  name: string;
  description: string;
  descriptionRich?: RichDescriptionNode[];
  /** Original/base price — NEVER overwritten by a discount. */
  price: number;
  /** Server-computed effective (post-discount) price — equals price when no discount is active. */
  effectivePrice?: number;
  /** Active-only discount summary (null when no discount is live). */
  discount?: ProductDiscountSummary | null;
  images: string[];
  category: string | { _id: string; name: string };
  stock: number;
  isActive?: boolean;
  slug?: string;
  brand?: string | { _id: string; name: string; slug?: string; logo?: string } | null;
  // Session 65/71 — populated relations are `null` at RUNTIME when the
  // referenced Supplier doc was deleted (Mongoose populate → null); consumers
  // must null-check (the product page's supplier badge does).
  supplier?: string | { _id: string; businessName: string } | null;
  hasVariants?: boolean;
  variants?: ProductVariant[];
  ratingSummary?: RatingSummary;
  createdAt: string;
  updatedAt: string;
}

// --- Public Catalog Facets (Session 47) ---

/** Public brand facet (GET /api/brands) — active only, strict projection. */
export interface PublicBrand {
  _id: string;
  name: string;
  slug: string;
}

/** Public tag facet (GET /api/tags) — active only, strict projection. */
export interface PublicTag {
  _id: string;
  name: string;
  slug: string;
}

// --- Attribute Facets (Session 47 extension) ---

/** One value bucket of an attribute facet (GET /api/attributes/facets). */
export interface AttributeFacetValue {
  value: string;
  count: number;
}

/**
 * One attribute facet group (GET /api/attributes/facets) — ACTIVE attributes
 * only, values carrying counts over the currently visible product set.
 */
export interface AttributeFacet {
  slug: string;
  name: string;
  type: AttributeType;
  values: AttributeFacetValue[];
}

/** GET /api/attributes/facets response. */
export interface AttributeFacetsResponse {
  facets: AttributeFacet[];
}

// --- Wishlist (Session 35) ---

/**
 * Wishlist row as returned by GET /api/wishlist.
 * `product` is null when the underlying product was deleted — the UI renders
 * an unavailable placeholder (the row is never silently dropped).
 * `variantId`/`variantSnapshot` are present ONLY on variant-level rows
 * (Session 43): null variantId = product-level row. Product-level and
 * variant-level rows for the same product COEXIST.
 */
export interface WishlistItem {
  _id: string;
  /** شناسه محصول — حتی وقتی خود محصول حذف شده (product=null) قابل حذف از لیست است */
  productId: string;
  product: (Pick<
    Product,
    "_id" | "name" | "slug" | "price" | "stock" | "images" | "hasVariants"
  > & { isActive?: boolean; category?: string | { _id: string; name: string } }) | null;
  /** variant-level row id (null = product-level row) — Session 43 */
  variantId?: string | null;
  /** denormalized variant info saved at add time — Session 43 */
  variantSnapshot?: { sku?: string; label?: string } | null;
  createdAt: string;
}

/** GET /api/wishlist/ids */
export interface WishlistIdsResponse {
  ids: string[];
  /** سرشماری کل اقلام علاقه‌مندی (برای بج هدر) */
  count: number;
}

// --- Wishlist → Cart bulk move (Session 38) ---

export type WishlistCartSkippedReason =
  | "deleted"
  | "inactive"
  | "out_of_stock"
  | "no_available_variant";

/**
 * A ready-to-add cart payload as resolved by POST /api/wishlist/add-to-cart.
 * Mirrors the Zustand CartItemInput contract (id/variantId/sku/variantLabel/
 * slug/name/price/maxQuantity/image) plus an extensible `variant` metadata
 * block reserved for future variant-wishlist support.
 */
export interface WishlistCartAddItem {
  id: string;
  variantId?: string;
  sku?: string;
  variantLabel?: string;
  slug: string;
  name: string;
  price: number;
  /** Live stock at resolution time — the client store clamps quantity to this */
  maxQuantity: number;
  image?: string;
  /** Extensible — reserved for future variant metadata */
  variant?: { id: string; sku?: string; label?: string };
}

/** POST /api/wishlist/add-to-cart response */
export interface WishlistCartAddResult {
  added: WishlistCartAddItem[];
  addedCount: number;
  skipped: Array<{ productId: string; reason: WishlistCartSkippedReason }>;
  skippedCount: number;
}

// --- Reviews & Ratings (Session 34) ---
export type ReviewStatus = "pending" | "approved" | "rejected";

export interface RatingSummary {
  /** میانگین امتیاز دیدگاه‌های تأییدشده (rounded to 1 decimal) */
  average: number;
  /** تعداد دیدگاه‌های تأییدشده */
  count: number;
}

/** Supplier reply on an approved review (Session 37). */
export interface ReviewReply {
  author: { _id: string; name: string } | null;
  text: string;
  at: string | null;
}

/** Immutable order-item snapshot copied at review creation (audit). */
export interface ReviewItemSnapshot {
  name?: string;
  sku?: string;
  variantId?: string | null;
  variantLabel?: string;
  image?: string;
  price?: number;
  quantity?: number;
}

/** Public (approved-only) review as returned by GET /api/reviews */
export interface Review {
  _id: string;
  customer: { _id: string; name: string };
  product: string;
  order: string;
  itemSnapshot?: ReviewItemSnapshot;
  rating: number;
  text: string;
  status: ReviewStatus;
  rejectionReason?: string;
  /** Optional supplier reply (Session 37) — backward compatible */
  reply?: ReviewReply | null;
  createdAt: string;
  updatedAt: string;
}

/** Paginated public reviews + product-level aggregate */
export interface ReviewsResponse extends PaginatedResponse<Review> {
  ratingSummary: RatingSummary;
}

/** Admin queue item (GET /api/admin/reviews) */
export interface AdminReview extends Omit<Review, "customer" | "product"> {
  customer: { _id: string; name: string; phone: string };
  product: { _id: string; name: string; slug: string; images?: string[]; isActive?: boolean };
  reviewedBy?: { _id: string; name: string } | null;
  reviewedAt?: string | null;
  reply?: ReviewReply | null;
}

/** Supplier queue item (GET /api/supplier/reviews) — Session 37 */
export interface SupplierReview extends Omit<Review, "customer" | "product"> {
  customer: { _id: string; name: string };
  product: { _id: string; name: string; slug: string; images?: string[]; isActive?: boolean };
  reply?: ReviewReply | null;
}

/** My-review status for the storefront form (GET /api/reviews/mine) */
export interface MyReviewsResponse {
  reviews: Review[];
  eligibleOrders: Array<{
    _id: string;
    createdAt: string;
    totalAmount: number;
    itemName?: string;
  }>;
}

// --- Coupons & Discounts (Session 39) ---

export type CouponType = "percent" | "fixed";

/**
 * Coupon audience (Session 55) — WHO may redeem the code.
 * - public: anyone (default; a missing eligibility block means public).
 * - assigned_users: only the users in `assignedUsers`.
 * - user_groups: users belonging to any group slug in `groups` (groups are
 *   NOT implemented yet — group coupons are ineligible for everyone, fail-closed).
 */
export type CouponEligibilityMode = "public" | "assigned_users" | "user_groups";

/** Admin view of the eligibility block (GET /api/admin/coupons populates users). */
export interface CouponEligibility {
  mode: CouponEligibilityMode;
  /** ObjectId refs of explicitly-assigned users (mode: assigned_users).
   * Strings in raw POST/PUT payloads; populated user objects in admin GET. */
  assignedUsers: Array<{ _id: string; name: string; phone: string } | string>;
  /** Lowercase group slugs (mode: user_groups) — fail-closed today. */
  groups: string[];
}

/** Admin coupon row (GET /api/admin/coupons). */
export interface Coupon {
  _id: string;
  code: string;
  type: CouponType;
  /** percent → discount percent; fixed → toman amount */
  value: number;
  /** minimum pre-discount subtotal (0 = none) */
  minSubtotal: number;
  /** absolute cap for percent coupons (0 = none) */
  maxDiscount: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  /** Session 44: public marketing coupon (shown on the storefront + checkout picker) */
  isPublic: boolean;
  /** Session 55: who may redeem the code (absent on pre-Session-55 coupons = public). */
  eligibility?: CouponEligibility;
  /** total allowed uses (0 = unlimited) */
  usageLimit: number;
  /** max uses per customer (0 = unlimited) */
  perUserLimit: number;
  usedCount: number;
  createdAt: string;
  updatedAt: string;
}

export type AdminCoupon = Coupon;

/**
 * Public marketing coupon (GET /api/coupons/public) — Session 44.
 * Only isPublic + active + in-window coupons are ever exposed; internal
 * limits (usageLimit/perUserLimit/usedCount) are NEVER returned.
 */
export interface PublicCoupon {
  _id: string;
  code: string;
  type: CouponType;
  /** percent → discount percent; fixed → toman amount */
  value: number;
  /** minimum pre-discount subtotal (0 = none) */
  minSubtotal: number;
  /** absolute cap for percent coupons (0 = none) */
  maxDiscount: number;
  endsAt: string | null;
}

/** GET /api/coupons/public — paginated (Session 27 shape). */
export interface PublicCouponsResponse extends PaginatedResponse<PublicCoupon> {
  /** Total PUBLIC coupons (matches data.length only when all fit on one page). */
  total: number;
}

/** POST /api/coupons/validate — rules preview (no discount math). */
export interface CouponValidationResponse {
  valid: boolean;
  code: string;
  type: CouponType;
  value: number;
  maxDiscount: number;
  minSubtotal: number;
  usageLimit: number;
  perUserLimit: number;
}

/** Order discount snapshot (additive — absent on orders placed before Session 39). */
export interface OrderDiscount {
  code: string;
  couponId: string;
  type: CouponType;
  value: number;
  amount: number;
  released: boolean;
}

// --- Order ---
export interface Order {
  _id: string;
  userId: string;
  products: Array<{
    productId: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
}

export type OrderStatus =
  | "pending"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

// --- SEO ---
export interface SeoMetadata {
  title: string;
  description: string;
  keywords?: string[];
  ogImage?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
}

// ============================================================
// Admin-specific Types
// ============================================================

export type OrderPaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "canceled"
  | "refunded";

export type OrderStatusV2 =
  | "pending_payment"
  | "processing"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface AdminStat {
  totalRevenue: number;
  totalOrders: number;
  totalProducts: number;
  totalUsers: number;
  pendingOrders: number;
  lowStock: number;
  growth: number;
}

// --- Admin Analytics & Reporting (Session 41) ---

/** Per-day bucket in the time series (zero-filled — no gaps). */
export interface AnalyticsTimePoint {
  /** YYYY-MM-DD (UTC) */
  date: string;
  orders: number;
  revenue: number;
}

/** A ranked row in top-products / top-categories. */
export interface AnalyticsTopRow {
  name: string;
  quantity: number;
  revenue: number;
}

/** Coupon usage statistics across the window. */
export interface AnalyticsCouponStats {
  total: number;
  active: number;
  totalUses: number;
  discountedOrders: number;
  totalDiscount: number;
  topCoupons: Array<{ code: string; uses: number; discount: number }>;
}

/** Supplier payout / earnings summary (all-time ledger, window-independent). */
export interface AnalyticsSupplierStats {
  totalEarnings: number;
  totalPaidOut: number;
  paidOutCount: number;
  pendingPayoutAmount: number;
  pendingPayoutCount: number;
  outstandingBalance: number;
  pendingReserve: number;
}

/** Current status funnel for the window. */
export interface AnalyticsOrderStatusRow {
  status: string;
  label: string;
  count: number;
}

/** GET /api/admin/analytics response. */
export interface AdminAnalytics {
  range: number;
  from: string;
  to: string;
  summary: {
    revenue: number;
    orders: number;
    avgOrderValue: number;
    couponSavings: number;
    newCustomers: number;
  };
  timeSeries: AnalyticsTimePoint[];
  topProducts: AnalyticsTopRow[];
  topCategories: AnalyticsTopRow[];
  couponStats: AnalyticsCouponStats;
  supplierStats: AnalyticsSupplierStats;
  ordersByStatus: AnalyticsOrderStatusRow[];
}

export interface AdminProduct {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  /** Session 69 — rich Slate JSON; absent on legacy products. Must be mapped
   * into edit-form defaultValues or the editor mounts empty and a save
   * silently replaces the rich structure with plain text. */
  descriptionRich?: RichDescriptionNode[];
  images?: string[];
  brand?: { _id: string; name: string } | string | null;
  tags?: Array<{ _id: string; name: string; slug: string } | string | null>;
  // Session 65 — populated relations can be `null` at RUNTIME when the
  // referenced Category/Supplier doc was deleted (Mongoose populate → null)
  // and a raw ObjectId string on legacy/edge payloads. Consumers must
  // normalize (see lib/utils.ts relationId), never assume a populated doc.
  category: { _id: string; name: string } | string | null;
  supplier: { _id: string; businessName: string } | string | null;
  supplierPrice: number;
  price: number;
  /** Session 82 Phase A/B — sourcing mode (consignment | purchased). */
  sourcing?: string;
  /** Admin-only stored discount config (absent on pre-discount products). */
  discount?: ProductDiscount | null;
  stock: number;
  hasVariants?: boolean;
  variants?: ProductVariant[];
  isActive: boolean;
  // Session 56 — internal best-sellers counter (units paid, non-refunded).
  // Admin/supplier API responses include it; the PUBLIC products API never
  // does (projection exclusion). Only used to power sort=best_selling.
  soldCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderItem {
  product: string;
  supplier: string;
  variantId?: string;
  sku?: string;
  variantLabel?: string;
  image?: string;
  name: string;
  /** Actual effective unit price the customer paid (Session 77 — == original when no discount). */
  price: number;
  /** Pre-discount unit price snapshot (Session 77 — additive; absent on old orders). */
  originalPrice?: number | null;
  /** Per-unit toman reduction applied at purchase (Session 77 — 0/absent when none). */
  discountAmount?: number;
  supplierPrice: number;
  /** Exact weighted FIFO cost consumed at checkout (Session 82 Phase C —
   * purchased-sourcing, post-cutover only; absent on consignment/pre-cutover). */
  fifoUnitCost?: number | null;
  quantity: number;
}

/**
 * Shipping fulfillment metadata (Session 57). Additive — absent on orders
 * placed before Session 57; renderers must optional-chain. `provider` is the
 * courier name (future courier-integration seam).
 */
export interface OrderShipping {
  provider?: string;
  trackingCode?: string;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  note?: string;
}

export interface AdminOrder {
  _id: string;
  customer: { _id: string; name: string; phone: string };
  items: AdminOrderItem[];
  totalAmount: number;
  /** Pre-discount subtotal (absent on pre-Session-39 orders). */
  subtotalAmount?: number | null;
  /** Applied coupon (absent on pre-Session-39 orders). */
  discount?: OrderDiscount | null;
  shippingAddress?: {
    fullName?: string;
    phone?: string;
    address?: string;
    postalCode?: string;
  };
  /** Shipping fulfillment metadata (Session 57 — additive). */
  shipping?: OrderShipping;
  payment: {
    status: OrderPaymentStatus;
    method?: string;
    refId?: string;
    paidAt?: string | null;
  };
  refund?: {
    reason?: string;
    refundedAt?: string;
    refundedBy?: string;
  };
  status: OrderStatusV2;
  statusHistory?: Array<{
    status: string;
    at: string;
    note?: string;
    /** Who performed the transition (Session 46: "customer" for self-cancel). */
    actor?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /api/orders/[id]/cancel — customer self-service cancellation (Session 46).
 * Only cancellable while the order is awaiting payment
 * (status `pending_payment` + `payment.status` `pending`).
 */
export interface CancelOrderResponse {
  orderId: string;
  status: "cancelled";
  cancelled: boolean;
}

export interface AdminUser {
  _id: string;
  name: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  address?: string;
  supplier?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Supplier Application Types (Session 67)
// ============================================================

export type SupplierApplicationStatus = "pending" | "approved" | "rejected";

/** The applicant's own application (GET /api/supplier-applications/me). */
export interface SupplierApplication {
  _id: string;
  status: SupplierApplicationStatus;
  businessName: string;
  description?: string;
  contactPhone?: string;
  adminNote?: string;
  decidedAt?: string | null;
  createdAt: string;
}

/** Admin queue row (GET /api/admin/supplier-applications). */
export interface AdminSupplierApplication extends SupplierApplication {
  user: {
    _id: string;
    name: string;
    phone: string;
    isActive: boolean;
    role: UserRole;
  } | null;
}

// ============================================================
// Customer Support Conversations (Session 68)
// ============================================================

export type ConversationStatus = "open" | "pending" | "resolved" | "closed";
export type ConversationCategory =
  | "general"
  | "order"
  | "delivery"
  | "product"
  | "refund";
export type ConversationSenderRole = "customer" | "admin" | "supplier";

/** One embedded message in a conversation thread. */
export interface ConversationMessage {
  _id: string;
  sender: { _id: string; name: string } | string;
  /** Server-derived role of the author — never trusted from the client. */
  senderRole: ConversationSenderRole;
  text: string;
  createdAt: string;
}

/**
 * A customer-support conversation (one per customer × SupplierOrder).
 * Shared list shape across the customer/admin/supplier surfaces; `messages`
 * is present only on detail responses.
 *
 * NOTE (Session 68 hardening): `customer`/`order`/`supplier` are populated
 * relations — Mongoose populate() sets them to `null` at RUNTIME when the
 * referenced document was deleted (e.g. a conversation whose supplier was
 * removed). Consumers must use null-safe access (see
 * src/lib/conversation-relations.ts), never the `typeof x === "object"`
 * idiom (`typeof null === "object"`).
 */
export interface CustomerConversation {
  _id: string;
  customer: { _id: string; name: string; phone: string } | string | null;
  order: { _id: string; totalAmount?: number; status?: string } | string | null;
  supplierOrder: string;
  supplier: { _id: string; businessName: string } | string | null;
  product?: { _id: string; name: string } | string | null;
  category: ConversationCategory;
  subject: string;
  status: ConversationStatus;
  /** Staff replied since the customer last read (flipped on customer detail GET). */
  customerUnread: boolean;
  /** Customer replied since staff last read (staff = admin ∪ the conversation's supplier). */
  staffUnread: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  lastMessageFrom: ConversationSenderRole | "";
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  closedBy?: string | null;
  closedAt?: string | null;
  messages?: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/** GET /api/conversations/eligible-orders — the customer's purchased orders. */
export interface EligibleConversationOrder {
  orderId: string;
  orderShortId: string;
  totalAmount: number;
  createdAt: string;
  suppliers: Array<{
    supplierOrderId: string;
    supplierId: string;
    businessName: string;
    amountOwed: number;
    status: string;
  }>;
}

// ============================================================
// Supplier-specific Types
// ============================================================

/**
 * Admin supplier-management row (Session 66) — GET /api/admin/suppliers?all=true.
 * ADMIN-ONLY shape: includes wallet/contact figures + the linked user. These
 * fields must NEVER appear on the PUBLIC supplier endpoints (see PublicSupplier).
 * `user` is null only when the User ref was deleted (Mongoose populate → null).
 */
export interface AdminSupplier {
  _id: string;
  businessName: string;
  logo?: string;
  description?: string;
  contactPhone?: string;
  balance: number;
  pendingReserve: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  user: {
    _id: string;
    name: string;
    phone: string;
    isActive: boolean;
    role: UserRole;
  } | null;
}

// --- Supplier Storefront (Session 42) ---

/**
 * Public supplier storefront profile (GET /api/suppliers).
 * STRICT projection whitelist — NEVER includes user, contactPhone,
 * bankAccount, telegramChatId, balance or pendingReserve.
 */
export interface PublicSupplier {
  _id: string;
  businessName: string;
  logo: string;
  description: string;
  /** Count of this supplier's ACTIVE + in-stock products (storefront rules). */
  productCount: number;
}

export interface SupplierStat {
  totalProducts: number;
  totalOrders: number;
  pendingOrders: number;
  balance: number;
  totalEarnings: number;
  lowStock: number;
}

export type SupplierProduct = AdminProduct;

export interface SupplierInfo {
  _id: string;
  businessName: string;
  contactPhone: string;
  balance: number;
  bankAccount: {
    cardNumber: string;
    iban: string;
    ownerName: string;
  };
}

export type SupplierOrderItemStatus = "pending" | "confirmed" | "rejected" | "shipped" | "delivered";

export interface SupplierOrderItem {
  product: string;
  variantId?: string;
  sku?: string;
  variantLabel?: string;
  image?: string;
  name: string;
  supplierPrice: number;
  quantity: number;
}

export interface SupplierOrder {
  _id: string;
  order: string;
  supplier: string;
  items: SupplierOrderItem[];
  amountOwed: number;
  status: SupplierOrderItemStatus;
  confirmedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  isPaidOut: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Session 82 Phase D — inventory ledger views ---
export type InventoryMovementType =
  | "opening_balance"
  | "receipt"
  | "sale"
  | "return_restock"
  | "cancellation_restock"
  | "purchase_return"
  | "adjustment"
  | "sourcing_change";

export interface InventoryMovementView {
  _id: string;
  product: { _id: string; name: string; slug: string } | string;
  variantId?: string | null;
  type: InventoryMovementType;
  /** Signed quantity (+receipt / −sale). */
  quantity: number;
  unitCost: number;
  totalCost: number;
  sourceRef: string;
  description: string;
  createdBy?: { _id: string; name: string } | string | null;
  createdAt: string;
}

export interface InventoryLayerRow {
  productId: string;
  productName: string;
  slug: string;
  variantId: string | null;
  variantSku: string;
  variantLabel: string;
  qty: number;
  remaining: number;
  unitCost: number;
  value: number;
  acquiredAt: string;
  source: "opening" | "receipt" | "adjustment";
  ref: string;
}

export interface InventoryAdjustmentResponse {
  idempotent: boolean;
  movement: InventoryMovementView;
  product: { _id: string; stock: number };
}

// ============================================================
// Wallet Types
// ============================================================

export type TransactionType = "payout" | "adjustment" | "order_credit";

export type PayoutStatus = "pending" | "approved" | "rejected";

export interface WalletTransaction {
  _id: string;
  supplier: string;
  type: TransactionType;
  amount: number;
  relatedOrder?: string | null;
  note: string;
  balanceAfter: number;
  status?: PayoutStatus;
  reviewedAt?: string | null;
  rejectionReason?: string;
  createdAt: string;
}

export interface WalletInfo {
  balance: number;
  /** موجودی کل منهای رزرو درخواست‌های در انتظار تأیید */
  availableBalance: number;
  /** مبلغ رزرو شده برای درخواست‌های تسویه در انتظار تأیید */
  pendingReserve: number;
  totalEarnings: number;
  totalPaidOut: number;
  pendingPayouts: number;
  bankAccount: {
    cardNumber: string;
    iban: string;
    ownerName: string;
  };
  businessName: string;
  contactPhone: string;
  recentTransactions: WalletTransaction[];
}

/** Admin payout queue item (GET /api/admin/payouts) */
export interface AdminPayout {
  _id: string;
  supplier: {
    _id: string;
    businessName: string;
    balance: number;
    pendingReserve: number;
    bankAccount?: {
      cardNumber?: string;
      iban?: string;
      ownerName?: string;
    };
    user?: { _id: string; name: string; phone: string };
  };
  type: TransactionType;
  amount: number;
  note: string;
  balanceAfter: number;
  status: PayoutStatus;
  reviewedAt?: string | null;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Notifications (Session 36)
// ============================================================

export type NotificationCategory =
  | "order"
  | "payment"
  | "payout"
  | "system"
  | "support";

/** A single inbox item as returned by GET /api/notifications */
export interface NotificationItem {
  _id: string;
  type: string;
  category: NotificationCategory;
  message: string;
  relatedOrder?: string | null;
  link?: string;
  isRead: boolean;
  readAt?: string | null;
  sentToTelegram: boolean;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/notifications — paginated inbox + unread badge count */
export interface NotificationsResponse extends PaginatedResponse<NotificationItem> {
  unreadCount: number;
}

/** GET /api/notifications/unread-count */
export interface UnreadCountResponse {
  count: number;
}

/**
 * SSE push event (Session 40) — delivered to /api/notifications/stream
 * subscribers immediately after a Notification document is committed.
 * The DB write stays the source of truth; this is a delivery hint that lets
 * the client invalidate its React Query cache for instant UI updates.
 */
export interface NotificationStreamEvent {
  id: string;
  type: string;
  category: NotificationCategory;
  message: string;
  link?: string;
  relatedOrder?: string | null;
  isRead: boolean;
  createdAt: string;
}

// ============================================================
// Homepage CMS (Session 53)
// ============================================================

/** Grouped presentation settings stored on a HomepageSection (Tier 1). */
export interface HomepagePresentation {
  appearance: {
    themeColor: string;
    background: string;
    spacing: string;
    borderRadius: string;
  };
  behavior: {
    autoplay: boolean;
    autoplayInterval: number;
    showArrows: boolean;
    showDots: boolean;
    countdownEnabled: boolean;
    countdownTarget: "end_of_day" | "fixed" | "off";
    countdownEndsAt: string | null;
    maxItems: number;
    layoutVariant: "grid" | "carousel" | "stacked" | "split";
  };
}

/** Admin section row (GET /api/admin/homepage/sections). */
export interface AdminHomepageSection {
  _id: string;
  slug: string;
  component: string;
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  presentation: HomepagePresentation;
  createdAt: string;
  updatedAt: string;
}

/** Public content row (strict projection). */
export interface PublicHomepageContent {
  _id: string;
  title: string;
  subtitle: string;
  tagline?: string;
  description?: string;
  ctaLabel: string;
  ctaHref: string;
  imageDesktop: string;
  imageMobile: string;
  themeColor: string;
  icon?: string;
}

/** Public section (GET /api/homepage). */
export interface PublicHomepageSection {
  slug: string;
  component: string;
  title: string;
  subtitle: string;
  presentation: HomepagePresentation;
  content: PublicHomepageContent[];
}

/** GET /api/homepage response. */
export interface PublicHomepageComposition {
  sections: PublicHomepageSection[];
}

/** Props every storefront section renderer receives (registry). */
export interface HomepageSectionRendererProps {
  section: PublicHomepageSection;
}

// ============================================================
// Bulk Product CSV Import/Export (Session 51)
// ============================================================

export type ProductImportRowStatus = "created" | "skipped" | "failed";

/** Per-row result of a product CSV import. */
export interface ProductImportRowResult {
  /** 1-based row number in the CSV (header excluded). */
  rowNumber: number;
  name?: string;
  status: ProductImportRowStatus;
  /** Persian reason (only for skipped/failed rows). */
  reason?: string;
}

/** POST /api/admin/products/import and /api/supplier/products/import response. */
export interface ProductImportReport {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  results: ProductImportRowResult[];
}

// ---------------------------------------------------------------------------
// Admin Reports (Session 81) — accounting-aware reporting subsystem
// ---------------------------------------------------------------------------

/** Date-range presets understood by the reports API (custom = explicit from/to). */
export type ReportPreset =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "lastMonth"
  | "year"
  | "custom";

/** Validated filter inputs for every report endpoint (server-parsed, whitelisted). */
export interface ReportFilters {
  preset: ReportPreset | null;
  /** YYYY-MM-DD (UTC day start) — inclusive. */
  from: string | null;
  /** YYYY-MM-DD (UTC day start) — inclusive. */
  to: string | null;
  productId?: string;
  categoryId?: string;
  customerId?: string;
  orderStatus?: string;
  /** Purchase status (draft/ordered/…/cancelled) — only for the purchases report. */
  purchaseStatus?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  coupon?: string;
  q?: string;
  page: number;
  limit: number;
}

/** KPI summary shared by the dashboard, P&L and per-report summary sheets. */
export interface ReportSummary {
  from: string;
  to: string;
  preset: ReportPreset | null;
  orders: number;
  unitsSold: number;
  grossSales: number;
  productDiscount: number;
  couponDiscount: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number | null;
  refundedOrders: number;
  refunds: number;
  paidAmount: number;
  pendingAmount: number;
  outstandingAmount: number;
  avgOrderValue: number;
  inventoryValue: number;
  inventoryCost: number;
}

/** Generic envelope returned by GET /api/admin/reports/[report]. */
export interface ReportEnvelope<T> {
  report: string;
  filters: ReportFilters;
  summary: ReportSummary;
  rows: T[];
  total: number;
  totals: Record<string, number>;
  page: number;
  limit: number;
  truncated: boolean;
  generatedAt: string;
}

/** Product-level sales line (aggregated from immutable order-item snapshots). */
export interface SalesReportRow {
  productId: string;
  name: string;
  sku: string;
  category: string;
  quantity: number;
  /** Weighted average net unit price (Σ net / Σ qty) — historical, per order line. */
  avgUnitPrice: number;
  grossSales: number;
  productDiscount: number;
  couponDiscount: number;
  netSales: number;
  cogs: number;
  returnedQuantity: number;
  returnedAmount: number;
  netQuantity: number;
  netSalesAfterReturns: number;
  firstSaleAt: string | null;
  lastSaleAt: string | null;
}

export interface OrdersReportRow {
  _id: string;
  orderNo: string;
  createdAt: string;
  customer: { name: string; phone: string } | null;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  itemsCount: number;
  grossAmount: number;
  productDiscount: number;
  couponDiscount: number;
  netAmount: number;
  paidAmount: number;
  refundedAmount: number;
  outstandingAmount: number;
}

export interface PaymentsReportRow {
  _id: string;
  orderNo: string;
  createdAt: string;
  paidAt: string | null;
  customer: { name: string; phone: string } | null;
  method: string;
  status: string;
  refId: string;
  authority: string;
  amount: number;
  paidAmount: number;
  refundedAmount: number;
  outstandingAmount: number;
}

export interface RefundsReportRow {
  _id: string;
  orderNo: string;
  createdAt: string;
  refundedAt: string | null;
  customer: { name: string; phone: string } | null;
  products: string;
  refundAmount: number;
  reason: string;
  refundedBy: string;
  paymentRefId: string;
}

export interface CouponReportRow {
  code: string;
  type: string;
  value: number;
  isActive: boolean;
  usedCount: number;
  uses: number;
  orders: number;
  grossSales: number;
  totalDiscount: number;
  netSales: number;
  avgOrderValue: number;
  firstUseAt: string | null;
  lastUseAt: string | null;
  endsAt: string | null;
}

export interface CustomerSalesRow {
  customerId: string;
  name: string;
  phone: string;
  orders: number;
  units: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  refunds: number;
  netRevenue: number;
  avgOrderValue: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export interface InventoryReportRow {
  productId: string;
  sku: string;
  name: string;
  category: string;
  currentStock: number;
  salesQuantity: number;
  returnedQuantity: number;
  openingStock: number;
  unitCost: number;
  inventoryValue: number;
  retailValue: number;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
  movement: "fast" | "slow" | "no_movement";
  lastSaleAt: string | null;
}

/** One line of the P&L statement (label → amount → %). */
export interface PnlStatementRow {
  key: string;
  label: string;
  amount: number | null;
  /** % of gross sales (top section) or % of net sales (COGS/profit section). */
  percent: number | null;
  /** true when the metric cannot be computed from stored data. */
  unavailable?: boolean;
}

export interface PnlPeriod {
  summary: ReportSummary;
  rows: PnlStatementRow[];
}

export interface ProfitLossReport {
  current: PnlPeriod;
  previous: PnlPeriod | null;
  /** Same-window-vs-previous-window % change for the headline metrics. */
  change: {
    netSales: number | null;
    grossProfit: number | null;
    orders: number | null;
  };
}

export interface DashboardReport {
  summary: ReportSummary;
  byDay: Array<{ date: string; orders: number; netSales: number }>;
  topProducts: Array<{ name: string; quantity: number; netSales: number }>;
  ordersByStatus: Array<{ status: string; label: string; count: number; amount: number }>;
  paymentsSplit: Array<{ status: string; label: string; count: number; amount: number }>;
  pnl: ProfitLossReport;
  reportLinks: Array<{ report: string; title: string }>;
}

// ============================================================
// Admin Accounting (Session 82 Phase A) — cutover + opening inventory
// ============================================================

/** Store-level accounting configuration (singleton doc `accounting`). */
export interface AccountingConfig {
  cutoverDate: string | null;
  valuationMethod: "fifo";
  inventoryInitialized: boolean;
  initializedAt: string | null;
  initializedBy: string | null;
}

/** One FIFO cost layer as returned to the admin UI. */
export interface InventoryCostLayerView {
  qty: number;
  remaining: number;
  unitCost: number;
  acquiredAt: string;
  source: "opening" | "receipt" | "adjustment";
  ref: string;
}

/** A product (or variant) offered for opening-balance initialization. */
export interface OpeningBalanceCandidate {
  productId: string;
  variantId?: string;
  name: string;
  variantLabel?: string;
  stock: number;
  /** Current supplierPrice shown only as a suggested default — never silently accepted. */
  suggestedCost: number;
  sourcing: "consignment" | "purchased";
}

/** Payload row for POST /api/admin/accounting/initialize. */
export interface OpeningBalanceItemInput {
  productId: string;
  variantId?: string;
  /** REQUIRED when stock > 0 — the admin-confirmed opening unit cost. */
  openingCost?: number;
  /** Optional per-product opening date (defaults to the cutover date). */
  openingDate?: string;
}

/** Response of POST /api/admin/accounting/initialize. */
export interface InitializeAccountingResponse {
  initialized: boolean;
  cutoverDate: string;
  productsInitialized: number;
  layersCreated: number;
  totalValue: number;
  skipped: Array<{ productId: string; reason: string }>;
}

// ============================================================
// Admin Purchases (Session 82 Phase B) — procurement
// ============================================================

export type PurchaseStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export type PurchasePaymentStatus = "unpaid" | "partial" | "paid";

export interface PurchaseItemInput {
  product: string;
  variantId?: string;
  quantity: number;
  unitCost: number;
}

/** One received-quantity line of a purchase item (as stored). */
export interface PurchaseItemView {
  id: string;
  product: string;
  variantId: string | null;
  name: string;
  variantLabel: string;
  quantity: number;
  receivedQuantity: number;
  outstanding: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseOrderView {
  id: string;
  number: string;
  supplier: string;
  supplierName?: string;
  purchaseDate: string;
  reference: string;
  notes: string;
  status: PurchaseStatus;
  subtotal: number;
  discount: number;
  additionalCosts: number;
  total: number;
  paymentStatus: PurchasePaymentStatus;
  amountPaid: number;
  amountOutstanding: number;
  items: PurchaseItemView[];
  totalOrdered: number;
  totalReceived: number;
  totalOutstanding: number;
  receipts: Array<{
    key: string;
    items: Array<{ itemId: string; quantity: number }>;
    receivedAt: string;
    receivedBy: string | null;
  }>;
  cancelledAt: string | null;
  cancellationReason: string;
  createdAt: string;
}

/** Row of the purchases report (Session 82 Phase B). */
export interface PurchasesReportRow {
  purchaseId: string;
  number: string;
  supplierName: string;
  purchaseDate: string;
  status: string;
  paymentStatus: string;
  totalOrdered: number;
  totalReceived: number;
  totalOutstanding: number;
  subtotal: number;
  discount: number;
  additionalCosts: number;
  total: number;
  amountPaid: number;
  amountOutstanding: number;
}

export interface PurchasesReport {
  rows: PurchasesReportRow[];
  summary: ReportSummary;
  page: number;
  totalPages: number;
  total: number;
}
