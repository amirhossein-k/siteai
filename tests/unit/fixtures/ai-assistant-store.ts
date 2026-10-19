/**
 * Controlled "database" for assistant tests: raw documents shaped like the
 * real Mongo collections — INCLUDING private fields (supplierPrice, cost
 * layers, payment authority, addresses) so tests can prove they never leak.
 * The fixture data source uses the production mappers/ranking from
 * src/lib/ai-assistant/store-data.ts.
 */
import { normalizePersian, searchTokens } from "@/lib/ai-assistant/normalize";
import { orderRefOf, rankProducts, toOrderView, toProductDetail } from "@/lib/ai-assistant/store-data";
import type { StoreDataSource } from "@/lib/ai-assistant/types";

export const NOW = new Date("2026-10-19T09:00:00.000Z");
const PAST = new Date("2026-10-01T00:00:00.000Z");
const FUTURE = new Date("2026-11-30T00:00:00.000Z");

export const IDS = {
  samsung: "64a000000000000000000001",
  redmi: "64a000000000000000000002",
  iphone: "64a000000000000000000003",
  poco: "64a000000000000000000004",
  nokia: "64a000000000000000000005",
  sony: "64a000000000000000000006",
  mug: "64a000000000000000000007",
  inactive: "64a000000000000000000008",
  customerA: "65b0000000000000000000aa",
  customerB: "65b0000000000000000000bb",
  orderA: "66c000000000000000a1b2c3",
  orderB: "66c000000000000000d4e5f6",
};

const mobile = { name: "گوشی موبایل", slug: "mobile" };
const audio = { name: "صوتی و تصویری", slug: "audio" };
const home = { name: "خانه و آشپزخانه", slug: "home" };
const PRIVATE = { supplier: "70000000000000000000000f", priceVersion: 7, costLayers: [{ qty: 5, remaining: 5, unitCost: 9_999_999 }], sourcing: "purchased" };

export const PRODUCTS: Array<Record<string, unknown>> = [
  { _id: IDS.samsung, name: "گوشی موبایل سامسونگ گلکسی A55", slug: "samsung-a55", description: "حافظه داخلی ۲۵۶ گیگابایت، رم ۸ گیگابایت، دوربین اصلی ۵۰ مگاپیکسل، باتری ۵۰۰۰ میلی‌آمپر", images: ["/img/a55.jpg"], price: 18_500_000, supplierPrice: 15_100_000, stock: 5, soldCount: 40, isActive: true, category: mobile, brand: { name: "سامسونگ", slug: "samsung" }, createdAt: "2026-08-01", ...PRIVATE },
  { _id: IDS.redmi, name: "گوشی موبایل شیائومی ردمی نوت 13", slug: "redmi-note-13", description: "حافظه ۱۲۸ گیگابایت، رم ۶ گیگابایت، دوربین ۱۰۸ مگاپیکسل", images: [], price: 12_000_000, supplierPrice: 9_800_000, discount: { type: "percent", value: 10, isActive: true, startsAt: PAST, endsAt: FUTURE }, stock: 3, soldCount: 70, isActive: true, category: mobile, brand: { name: "شیائومی", slug: "xiaomi" }, createdAt: "2026-07-01", ...PRIVATE },
  { _id: IDS.iphone, name: "گوشی موبایل اپل آیفون 15", slug: "iphone-15", description: "حافظه ۱۲۸ گیگابایت", images: [], price: 65_000_000, supplierPrice: 58_000_000, stock: 2, soldCount: 10, isActive: true, category: mobile, brand: { name: "اپل", slug: "apple" }, createdAt: "2026-09-01", ...PRIVATE },
  { _id: IDS.poco, name: "گوشی موبایل شیائومی پوکو X6", slug: "poco-x6", description: "حافظه ۲۵۶ گیگابایت، رم ۱۲ گیگابایت، پردازنده قدرتمند برای بازی", images: [], price: 22_000_000, supplierPrice: 17_000_000, discount: { type: "fixed", value: 3_000_000, isActive: true, startsAt: PAST, endsAt: FUTURE }, stock: 4, soldCount: 25, isActive: true, category: mobile, brand: { name: "شیائومی", slug: "xiaomi" }, createdAt: "2026-09-15", ...PRIVATE },
  { _id: IDS.nokia, name: "گوشی موبایل نوکیا 105", slug: "nokia-105", description: "گوشی ساده", images: [], price: 1_500_000, supplierPrice: 1_000_000, stock: 0, soldCount: 5, isActive: true, category: mobile, brand: { name: "نوکیا", slug: "nokia" }, createdAt: "2026-01-01", ...PRIVATE },
  { _id: IDS.sony, name: "هدفون بی‌سیم سونی WH-CH520", slug: "sony-wh-ch520", description: "هدفون بلوتوثی با ۵۰ ساعت شارژدهی", images: [], price: 3_200_000, supplierPrice: 2_400_000, hasVariants: true, stock: 2, soldCount: 30, isActive: true, category: audio, brand: { name: "سونی", slug: "sony" }, createdAt: "2026-06-01",
    variants: [
      { _id: "64b000000000000000000061", sku: "SONY-BLK", attributes: [{ name: "رنگ", value: "مشکی" }], price: 3_200_000, supplierPrice: 2_400_000, stock: 2, isActive: true, costLayers: [{ unitCost: 2_350_000 }] },
      { _id: "64b000000000000000000062", sku: "SONY-WHT", attributes: [{ name: "رنگ", value: "سفید" }], price: 3_400_000, supplierPrice: 2_500_000, stock: 0, isActive: true },
      { _id: "64b000000000000000000063", sku: "SONY-OLD", attributes: [{ name: "رنگ", value: "قرمز" }], price: 1_000_000, supplierPrice: 900_000, stock: 9, isActive: false },
    ], ...PRIVATE },
  { _id: IDS.mug, name: "ماگ سرامیکی", slug: "ceramic-mug", description: "ماگ ۳۵۰ میلی‌لیتری", images: [], price: 250_000, supplierPrice: 120_000, discount: { type: "percent", value: 30, isActive: true, startsAt: PAST, endsAt: new Date("2026-10-10") }, stock: 20, soldCount: 3, isActive: true, category: home, brand: null, createdAt: "2026-03-01", ...PRIVATE },
  { _id: IDS.inactive, name: "گوشی موبایل مخفی آزمایشی", slug: "hidden", description: "", price: 100, supplierPrice: 1, stock: 99, isActive: false, category: mobile, brand: null, ...PRIVATE },
];

export const ORDERS: Array<Record<string, unknown>> = [
  { _id: IDS.orderA, customer: IDS.customerA, status: "shipped", totalAmount: 10_800_000, createdAt: "2026-10-15T10:00:00Z",
    payment: { status: "paid", method: "zarinpal", authority: "A0000000000000000000000000SECRET", refId: "REF-123", cardPan: "603799******1234", retryToken: "retry-secret" },
    shipping: { provider: "پست پیشتاز", trackingCode: "TRK-A-111", shippedAt: "2026-10-16T08:00:00Z", deliveredAt: null, note: "internal note" },
    shippingAddress: { fullName: "مشتری الف", phone: "09120000001", address: "تهران، خیابان محرمانه", postalCode: "1111111111" },
    items: [{ name: "گوشی موبایل شیائومی ردمی نوت 13", variantLabel: "", quantity: 1, price: 10_800_000, supplierPrice: 9_800_000, fifoUnitCost: 9_700_000 }] },
  { _id: IDS.orderB, customer: IDS.customerB, status: "processing", totalAmount: 3_200_000, createdAt: "2026-10-18T10:00:00Z",
    payment: { status: "paid", method: "manual" },
    shipping: { provider: "", trackingCode: "TRK-B-999" },
    shippingAddress: { fullName: "مشتری ب", phone: "09129999999", address: "شیراز، کوچه خصوصی" },
    items: [{ name: "هدفون بی‌سیم سونی WH-CH520", variantLabel: "رنگ: مشکی", quantity: 1, price: 3_200_000, supplierPrice: 2_400_000 }] },
];

export interface FixtureStore extends StoreDataSource {
  calls: Record<string, unknown[][]>;
}

export function createFixtureStore(opts: { failSearch?: boolean } = {}): FixtureStore {
  const calls: Record<string, unknown[][]> = { searchProducts: [], getProductsByIds: [], getProductBySlug: [], getCatalogOverview: [], getCustomerOrders: [] };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const visible = () => clone(PRODUCTS).filter((p) => p.isActive !== false);
  return {
    calls,
    async searchProducts(input) {
      calls.searchProducts.push([input]);
      if (opts.failSearch) throw new Error("db down");
      let docs = visible().filter((p) => input.includeOutOfStock || Number(p.stock) > 0);
      if (input.categorySlug) docs = docs.filter((p) => (p.category as { slug: string })?.slug === input.categorySlug);
      if (input.brandSlug) docs = docs.filter((p) => (p.brand as { slug: string } | null)?.slug === input.brandSlug);
      const tokens = searchTokens(input.query || "");
      const match = (p: Record<string, unknown>) => {
        const hay = normalizePersian(`${p.name} ${p.description} ${(p.category as { name?: string })?.name || ""} ${(p.brand as { name?: string } | null)?.name || ""}`);
        return tokens.some((t) => hay.includes(t));
      };
      let relaxedQuery = false;
      let candidates = tokens.length ? docs.filter(match) : docs;
      if (tokens.length && !candidates.length) {
        relaxedQuery = true;
        candidates = docs;
      }
      return { products: rankProducts(candidates, input, tokens, normalizePersian, NOW), relaxedQuery };
    },
    async getProductsByIds(ids) {
      calls.getProductsByIds.push([ids]);
      const docs = visible();
      return ids.map((id) => docs.find((d) => d._id === id)).filter(Boolean).map((d) => toProductDetail(d!, { average: 4.5, count: 12 }, NOW));
    },
    async getProductBySlug(slug) {
      calls.getProductBySlug.push([slug]);
      const d = visible().find((p) => p.slug === slug);
      return d ? toProductDetail(d, null, NOW) : null;
    },
    async getCatalogOverview() {
      calls.getCatalogOverview.push([]);
      return {
        categories: [mobile, audio, home].map((c) => ({ ...c, url: `/products?category=${c.slug}` })),
        brands: [{ name: "سامسونگ", slug: "samsung" }, { name: "شیائومی", slug: "xiaomi" }],
        activeInStockProducts: 6,
        discountedProducts: 2,
      };
    },
    async getCustomerOrders(customerId, o) {
      calls.getCustomerOrders.push([customerId, o]);
      const own = clone(ORDERS).filter((x) => x.customer === customerId);
      const filtered = o.orderRef ? own.filter((x) => orderRefOf(x._id).endsWith(o.orderRef!)) : own;
      return filtered.slice(0, o.limit).map(toOrderView);
    },
  };
}

// ── Mock Anthropic-compatible provider ──────────────────────────────────

export type ScriptStep =
  | { kind: "tool"; calls: Array<{ name: string; input: unknown }>; text?: string }
  | { kind: "text"; text: string }
  | { kind: "raw"; status?: number; body: unknown }
  | { kind: "throw"; error: unknown };

export interface MockProvider {
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>;
}

export function mockProvider(script: ScriptStep[]): MockProvider {
  const requests: MockProvider["requests"] = [];
  let i = 0;
  let toolSeq = 0;
  const fetchImpl = async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const step = script[i++];
    if (!step) throw new Error(`mock provider: no scripted response for request #${i}`);
    if (step.kind === "throw") throw step.error;
    if (step.kind === "raw") {
      return new Response(typeof step.body === "string" ? step.body : JSON.stringify(step.body), { status: step.status ?? 200, headers: { "content-type": "application/json" } });
    }
    const content =
      step.kind === "text"
        ? [{ type: "thinking", thinking: "..." }, { type: "text", text: step.text }]
        : [
            ...(step.text ? [{ type: "text", text: step.text }] : []),
            ...step.calls.map((c) => ({ type: "tool_use", id: `toolu_${++toolSeq}`, name: c.name, input: c.input })),
          ];
    return new Response(JSON.stringify({ id: "msg", type: "message", role: "assistant", content, stop_reason: step.kind === "tool" ? "tool_use" : "end_turn" }), { status: 200 });
  };
  return { fetchImpl, requests };
}

export const TEST_ENV = {
  ANTHROPIC_BASE_URL: "https://mock-gateway.test",
  ANTHROPIC_AUTH_TOKEN: "sk-test-SECRET-TOKEN-1234567890",
  ANTHROPIC_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free",
  MONGODB_URI: "mongodb://admin:SuperSecretPass@db.internal:27017/marlooai",
  NEXTAUTH_SECRET: "nextauth-secret-value-xyz",
};
