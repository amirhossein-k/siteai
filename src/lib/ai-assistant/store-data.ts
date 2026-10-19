/**
 * Pure mapping layer between raw Mongo documents / official content modules
 * and the customer-safe shapes the assistant (and the model) is allowed to see.
 *
 * ALLOWLIST ONLY: every output field is copied explicitly. Supplier prices,
 * FIFO cost layers, supplier refs, soldCount, price CAS tokens, payment
 * authority / retry tokens, card PANs, shipping addresses and phone numbers are
 * never read into an output shape.
 */
import { getEffectivePrice, type ProductDiscountInput } from "@/lib/product-pricing";
import { FAQ_ITEMS } from "@/lib/faq-content";
import { TERMS_SECTIONS, TERMS_LAST_UPDATED } from "@/lib/terms-content";
import type {
  AssistantOrderView,
  AssistantProductDetail,
  AssistantProductSummary,
  AssistantVariantDetail,
} from "./types";

type Raw = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function iso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function ref(value: unknown): { name: string; slug: string } {
  if (value && typeof value === "object") {
    const o = value as Raw;
    return { name: str(o.name), slug: str(o.slug) };
  }
  return { name: "", slug: "" };
}

export function plainExcerpt(text: unknown, max: number): string {
  const clean = str(text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean;
}

function activeVariants(raw: Raw): Raw[] {
  const list = Array.isArray(raw.variants) ? (raw.variants as Raw[]) : [];
  return list.filter((v) => v && v.isActive !== false);
}

export function toProductSummary(raw: Raw, now: Date = new Date()): AssistantProductSummary {
  const discount = raw.discount as ProductDiscountInput | undefined;
  const basePrice = num(raw.price);
  const eff = getEffectivePrice(basePrice, discount, now);
  const category = ref(raw.category);
  const brand = ref(raw.brand);
  const images = Array.isArray(raw.images) ? (raw.images as unknown[]).map(str) : [];
  const hasVariants = Boolean(raw.hasVariants);
  let variantPriceRange: { min: number; max: number } | null = null;
  if (hasVariants) {
    const prices = activeVariants(raw).map((v) => getEffectivePrice(num(v.price), discount, now).finalPrice);
    if (prices.length) variantPriceRange = { min: Math.min(...prices), max: Math.max(...prices) };
  }
  const stock = Math.max(0, Math.floor(num(raw.stock)));
  const slug = str(raw.slug);
  return {
    id: str(raw._id),
    name: str(raw.name),
    slug,
    url: `/products/${encodeURIComponent(slug)}`,
    image: images[0] || "",
    originalPrice: eff.originalPrice,
    effectivePrice: eff.finalPrice,
    discountPercent: eff.active ? eff.discountPercent : 0,
    discountAmount: eff.active ? eff.discountAmount : 0,
    discountEndsAt: eff.active && eff.endsAt ? eff.endsAt.toISOString() : null,
    inStock: raw.isActive !== false && stock > 0,
    stock,
    categoryName: category.name,
    categorySlug: category.slug,
    brandName: brand.name,
    brandSlug: brand.slug,
    hasVariants,
    variantPriceRange,
    shortDescription: plainExcerpt(raw.description, 220),
  };
}

export function toProductDetail(
  raw: Raw,
  rating: { average: number; count: number } | null,
  now: Date = new Date()
): AssistantProductDetail {
  const summary = toProductSummary(raw, now);
  const discount = raw.discount as ProductDiscountInput | undefined;
  const variants: AssistantVariantDetail[] = activeVariants(raw).slice(0, 40).map((v) => {
    const attrs = Array.isArray(v.attributes)
      ? (v.attributes as Raw[]).map((a) => ({ name: str(a.name), value: str(a.value) }))
      : [];
    const eff = getEffectivePrice(num(v.price), discount, now);
    const stock = Math.max(0, Math.floor(num(v.stock)));
    return {
      variantId: str(v._id),
      sku: str(v.sku),
      label: attrs.map((a) => `${a.name}: ${a.value}`).join("، "),
      attributes: attrs,
      originalPrice: eff.originalPrice,
      effectivePrice: eff.finalPrice,
      stock,
      inStock: stock > 0,
    };
  });
  const tags = Array.isArray(raw.tags)
    ? (raw.tags as unknown[]).map((t) => (t && typeof t === "object" ? str((t as Raw).name) : "")).filter(Boolean)
    : [];
  return {
    ...summary,
    description: plainExcerpt(raw.description, 1500),
    tags,
    variants,
    rating: rating && rating.count > 0 ? rating : null,
  };
}

// ── Orders ───────────────────────────────────────────────────────────────

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: "در انتظار پرداخت",
  processing: "در حال پردازش",
  confirmed: "تأییدشده",
  shipped: "ارسال‌شده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظار پرداخت",
  paid: "پرداخت‌شده",
  failed: "ناموفق",
  canceled: "لغوشده",
  refunded: "بازگشت وجه",
};

export function orderRefOf(id: unknown): string {
  return str(id).slice(-8).toUpperCase();
}

export function toOrderView(raw: Raw): AssistantOrderView {
  const payment = (raw.payment as Raw) || {};
  const shipping = (raw.shipping as Raw) || {};
  const items = Array.isArray(raw.items) ? (raw.items as Raw[]) : [];
  const status = str(raw.status) || "unknown";
  const paymentStatus = str(payment.status) || "unknown";
  const method = str(payment.method);
  return {
    orderRef: orderRefOf(raw._id),
    url: `/orders/${str(raw._id)}`,
    status,
    statusLabel: ORDER_STATUS_LABELS[status] || "نامشخص",
    paymentStatus,
    paymentStatusLabel: PAYMENT_STATUS_LABELS[paymentStatus] || "نامشخص",
    paymentMethod: method === "zarinpal" ? "پرداخت آنلاین (زرین‌پال)" : method === "manual" ? "پرداخت در محل" : "نامشخص",
    totalAmount: num(raw.totalAmount),
    createdAt: iso(raw.createdAt),
    shippingProvider: str(shipping.provider),
    trackingCode: str(shipping.trackingCode),
    shippedAt: iso(shipping.shippedAt ?? raw.shippedAt),
    deliveredAt: iso(shipping.deliveredAt ?? raw.deliveredAt),
    items: items.slice(0, 10).map((i) => ({
      name: str(i.name),
      variantLabel: str(i.variantLabel),
      quantity: num(i.quantity),
      unitPrice: num(i.price),
    })),
  };
}

// ── Official store policies (terms-content + faq-content) ───────────────

export type PolicyTopic =
  | "shipping"
  | "returns"
  | "payment"
  | "warranty"
  | "orders"
  | "account"
  | "discounts"
  | "support"
  | "privacy"
  | "products";

export const POLICY_TOPICS: PolicyTopic[] = [
  "shipping", "returns", "payment", "warranty", "orders", "account", "discounts", "support", "privacy", "products",
];

const TOPIC_SOURCES: Record<PolicyTopic, { terms: string[]; faqCategories: string[]; faqIds: string[] }> = {
  shipping: { terms: ["shipping"], faqCategories: ["shipping"], faqIds: ["minimum-purchase", "order-for-someone-else"] },
  returns: { terms: ["returns"], faqCategories: [], faqIds: ["return-policy", "non-returnable-products", "defective-product", "return-process"] },
  payment: { terms: ["payment"], faqCategories: ["payment"], faqIds: [] },
  warranty: { terms: ["warranty"], faqCategories: [], faqIds: ["product-authenticity", "defective-product"] },
  orders: { terms: ["ordering"], faqCategories: ["order"], faqIds: ["order-statuses", "track-order"] },
  account: { terms: ["membership"], faqCategories: ["account"], faqIds: [] },
  discounts: { terms: [], faqCategories: ["discount"], faqIds: [] },
  support: { terms: ["contact"], faqCategories: ["support"], faqIds: [] },
  privacy: { terms: ["privacy"], faqCategories: [], faqIds: ["privacy-of-account", "payment-safe"] },
  products: { terms: [], faqCategories: ["product"], faqIds: [] },
};

/**
 * Facts derived from the actual application code, not from marketing copy.
 * Keep in sync with the checkout implementation.
 */
const SYSTEM_FACTS: Partial<Record<PolicyTopic, string[]>> = {
  shipping: [
    "منطقه خدمات: ارسال به سراسر ایران.",
    "در سیستم فروشگاه هیچ جدول یا فرمول خودکاری برای محاسبه رقم هزینه ارسال ثبت نشده است؛ در سبد خرید و صفحه تکمیل خرید، هزینه ارسال به‌صورت «متغیر» نمایش داده می‌شود. بنابراین هیچ رقم مشخصی برای هزینه ارسال قابل اعلام نیست.",
  ],
  payment: ["در فرآیند تکمیل خرید فقط دو روش وجود دارد: پرداخت آنلاین زرین‌پال و پرداخت در محل."],
};

export interface PolicyKnowledge {
  topic: PolicyTopic;
  lastUpdated: string;
  sources: string[];
  facts: string[];
  links: Array<{ label: string; href: string }>;
}

export function getPolicyKnowledge(topic: PolicyTopic): PolicyKnowledge {
  const src = TOPIC_SOURCES[topic];
  const facts: string[] = [];
  const sources: string[] = [];
  for (const id of src.terms) {
    const section = TERMS_SECTIONS.find((s) => s.id === id);
    if (!section) continue;
    sources.push(`terms:${id}`);
    if (section.content) facts.push(section.content);
    for (const item of section.items || []) facts.push(item);
  }
  const faqs = FAQ_ITEMS.filter((f) => src.faqCategories.includes(f.category) || src.faqIds.includes(f.id));
  const seen = new Set<string>();
  for (const f of faqs) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    sources.push(`faq:${f.id}`);
    facts.push(`پرسش: ${f.question} | پاسخ رسمی: ${f.answer.replace(/\n/g, " ")}`);
  }
  for (const fact of SYSTEM_FACTS[topic] || []) {
    sources.push("system:checkout");
    facts.push(fact);
  }
  const links: Array<{ label: string; href: string }> = [
    { label: "قوانین و مقررات", href: "/terms" },
    { label: "سوالات متداول", href: "/faq" },
  ];
  if (topic === "orders" || topic === "shipping") links.push({ label: "سفارش‌ها", href: "/orders" });
  if (topic === "support" || topic === "returns") links.push({ label: "پشتیبانی", href: "/support" });
  return { topic, lastUpdated: TERMS_LAST_UPDATED, sources, facts, links };
}

/** Shape consumed by the existing chat UI product cards (backward compatible). */
export interface RecommendationCard {
  _id: string;
  name: string;
  slug: string;
  image: string;
  price: number;
  effectivePrice: number;
  discountPercent: number;
  stock: number;
  categoryName: string;
  brandName: string;
  reason: string;
}

export function toRecommendationCard(p: AssistantProductSummary): RecommendationCard {
  const reason = !p.inStock
    ? "ناموجود"
    : p.discountPercent > 0
    ? `دارای ${p.discountPercent.toLocaleString("fa-IR")}٪ تخفیف فعال`
    : p.hasVariants && p.variantPriceRange && p.variantPriceRange.min !== p.variantPriceRange.max
    ? "قیمت بسته به تنوع انتخابی متفاوت است"
    : "موجود";
  return {
    _id: p.id,
    name: p.name,
    slug: p.slug,
    image: p.image,
    price: p.originalPrice,
    effectivePrice: p.effectivePrice,
    discountPercent: p.discountPercent,
    stock: p.stock,
    categoryName: p.categoryName,
    brandName: p.brandName,
    reason,
  };
}

/**
 * Post-query filtering + ranking on EFFECTIVE prices (shared by the Mongo data
 * source and the test fixtures, so ranking behaviour is covered by tests).
 * Raw docs may contain `soldCount` / `createdAt`; they are used for ordering
 * only and never copied into the output.
 */
export function rankProducts(
  docs: Raw[],
  input: { maxPrice?: number; minPrice?: number; onlyDiscounted?: boolean; sort?: string; limit?: number },
  tokens: string[],
  normalize: (s: string) => string,
  now: Date = new Date()
): AssistantProductSummary[] {
  const scored = docs
    .map((doc) => {
      const p = toProductSummary(doc, now);
      const name = normalize(p.name);
      const hay = normalize(`${p.categoryName} ${p.brandName} ${str(doc.description)}`);
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += 3;
        else if (hay.includes(t)) score += 1;
      }
      return { p, score, sold: num(doc.soldCount), created: new Date(str(doc.createdAt) || 0).getTime() || 0 };
    })
    .filter(({ p }) => (input.maxPrice ? p.effectivePrice <= input.maxPrice : true))
    .filter(({ p }) => (input.minPrice ? p.effectivePrice >= input.minPrice : true))
    .filter(({ p }) => (input.onlyDiscounted ? p.discountPercent > 0 : true));

  const sort = input.sort || "relevance";
  scored.sort((a, b) => {
    switch (sort) {
      case "price_asc": return a.p.effectivePrice - b.p.effectivePrice;
      case "price_desc": return b.p.effectivePrice - a.p.effectivePrice;
      case "best_selling": return b.sold - a.sold;
      case "newest": return b.created - a.created;
      case "discount": return b.p.discountPercent - a.p.discountPercent || b.sold - a.sold;
      default: return b.score - a.score || b.sold - a.sold;
    }
  });
  return scored.slice(0, input.limit || 6).map((s) => s.p);
}
