/**
 * Shared types for the tool-using Marloo shopping assistant.
 *
 * Everything in this folder except `mongo-data-source.ts` is free of
 * mongoose / Next.js imports so the whole conversational pipeline
 * (handler → orchestrator → tools → data source) can be exercised in unit
 * tests with a fixture data source and a mocked model provider.
 */

export type ChatRole = "user" | "assistant";

/** One sanitized turn of client-supplied history (UNTRUSTED input). */
export interface HistoryTurn {
  role: ChatRole;
  content: string;
  /** Product ids the assistant showed as cards on that turn (validated 24-hex). */
  productIds?: string[];
}

/** Public, customer-safe product summary. Never contains cost/supplier data. */
export interface AssistantProductSummary {
  id: string;
  name: string;
  slug: string;
  url: string;
  image: string;
  /** Base price in toman (before product discount). */
  originalPrice: number;
  /** Current selling price in toman (server-computed via getEffectivePrice). */
  effectivePrice: number;
  discountPercent: number;
  /** Toman saved by the currently active product discount (0 when none). */
  discountAmount: number;
  discountEndsAt: string | null;
  inStock: boolean;
  stock: number;
  categoryName: string;
  categorySlug: string;
  brandName: string;
  brandSlug: string;
  hasVariants: boolean;
  /** Effective price range across ACTIVE variants (only when hasVariants). */
  variantPriceRange?: { min: number; max: number } | null;
  shortDescription: string;
}

export interface AssistantVariantDetail {
  variantId: string;
  sku: string;
  label: string;
  attributes: Array<{ name: string; value: string }>;
  originalPrice: number;
  effectivePrice: number;
  stock: number;
  inStock: boolean;
}

export interface AssistantProductDetail extends AssistantProductSummary {
  description: string;
  tags: string[];
  variants: AssistantVariantDetail[];
  rating: { average: number; count: number } | null;
}

export type ProductSort =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "best_selling"
  | "newest"
  | "discount";

export interface ProductSearchInput {
  query?: string;
  categorySlug?: string;
  brandSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  onlyDiscounted?: boolean;
  includeOutOfStock?: boolean;
  sort?: ProductSort;
  limit?: number;
}

export interface ProductSearchResult {
  products: AssistantProductSummary[];
  /** True when the text query matched nothing and the filter-only result is returned. */
  relaxedQuery: boolean;
}

export interface CatalogOverview {
  categories: Array<{ name: string; slug: string; url: string }>;
  brands: Array<{ name: string; slug: string }>;
  activeInStockProducts: number | null;
  discountedProducts: number | null;
}

export type OrderStatus =
  | "pending_payment"
  | "processing"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

/** Customer-safe order view (own orders only). */
export interface AssistantOrderView {
  orderRef: string;
  url: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  paymentStatusLabel: string;
  paymentMethod: string;
  totalAmount: number;
  createdAt: string | null;
  shippingProvider: string;
  trackingCode: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: Array<{ name: string; variantLabel: string; quantity: number; unitPrice: number }>;
}

/**
 * Read-only access to authoritative store data. The Mongo implementation reuses
 * the storefront's own models + pricing helpers; tests use fixtures.
 */
export interface StoreDataSource {
  searchProducts(input: ProductSearchInput): Promise<ProductSearchResult>;
  getProductsByIds(ids: string[]): Promise<AssistantProductDetail[]>;
  getProductBySlug(slug: string): Promise<AssistantProductDetail | null>;
  getCatalogOverview(): Promise<CatalogOverview>;
  /** MUST filter by customerId server-side. */
  getCustomerOrders(customerId: string, opts: { orderRef?: string; limit: number }): Promise<AssistantOrderView[]>;
}

export interface AssistantAuthContext {
  /** Authenticated customer id from the server session; null for guests. */
  customerId: string | null;
}

export interface AssistantResult {
  reply: string;
  recommendations: AssistantProductSummary[];
  relatedRoutes: Array<{ label: string; href: string }>;
  meta: Record<string, unknown>;
  status: number;
}
