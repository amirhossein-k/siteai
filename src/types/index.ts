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
  supplierPrice: number;
  stock: number;
  stockVersion?: number;
  images: string[];
  isActive: boolean;
}

// --- Product ---
export interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  images: string[];
  category: string | { _id: string; name: string };
  stock: number;
  isActive?: boolean;
  slug?: string;
  brand?: string | { _id: string; name: string; slug?: string; logo?: string } | null;
  supplier?: string | { _id: string; businessName: string };
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
  images?: string[];
  brand?: { _id: string; name: string } | null;
  tags?: { _id: string; name: string; slug: string }[];
  category: { _id: string; name: string };
  supplier: { _id: string; businessName: string };
  supplierPrice: number;
  price: number;
  stock: number;
  hasVariants?: boolean;
  variants?: ProductVariant[];
  isActive: boolean;
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
  price: number;
  supplierPrice: number;
  quantity: number;
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
// Supplier-specific Types
// ============================================================

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

export type NotificationCategory = "order" | "payment" | "payout" | "system";

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
