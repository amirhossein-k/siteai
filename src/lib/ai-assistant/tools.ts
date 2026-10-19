/**
 * Read-only tools the model may call. The model only PROPOSES calls; every
 * call is validated here (allowlisted name, typed + clamped input) and
 * authorized against the server-side session before the data source runs.
 * Tool output is built exclusively from the allowlisted shapes in
 * store-data.ts, so private fields cannot reach the model.
 */
import { isObjectIdLike, normalizePersian } from "./normalize";
import { POLICY_TOPICS, type PolicyTopic, getPolicyKnowledge } from "./store-data";
import type {
  AssistantAuthContext,
  AssistantProductSummary,
  ProductSearchInput,
  ProductSort,
  StoreDataSource,
} from "./types";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const SORTS: ProductSort[] = ["relevance", "price_asc", "price_desc", "best_selling", "newest", "discount"];

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: "search_products",
    description:
      "جستجوی محصولات واقعی فروشگاه با قیمت فروش فعلی (پس از تخفیف)، تخفیف فعال و موجودی لحظه‌ای. برای پیشنهاد، مقایسه، بودجه، تخفیف‌ها، پرفروش‌ها و جدیدترین‌ها استفاده کن. query را به فارسی ساده و بدون غلط تایپی بنویس (مثلاً «گوشی موبایل»، «هدفون بی‌سیم»). اگر نتیجه‌ای نیامد با کلمه هم‌معنی یا عمومی‌تر دوباره جستجو کن. قیمت‌ها به تومان است.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "عبارت جستجو (نام، نوع یا ویژگی محصول). برای فیلتر کلی خالی بگذار." },
        categorySlug: { type: "string", description: "slug دسته از get_catalog_overview" },
        brandSlug: { type: "string", description: "slug برند از get_catalog_overview" },
        minPrice: { type: "number", description: "حداقل قیمت نهایی به تومان" },
        maxPrice: { type: "number", description: "حداکثر قیمت نهایی (بودجه) به تومان؛ ۲۰ میلیون = 20000000" },
        onlyDiscounted: { type: "boolean" },
        includeOutOfStock: { type: "boolean", description: "پیش‌فرض false؛ فقط وقتی کاربر صریحاً درباره کالای ناموجود می‌پرسد true کن" },
        sort: { type: "string", enum: SORTS },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_product_details",
    description:
      "جزئیات کامل و به‌روز یک یا چند محصول (حداکثر ۴) شامل توضیحات/مشخصات، تنوع‌ها (رنگ/سایز و...)، قیمت و موجودی هر تنوع، تخفیف و امتیاز. برای «موجوده؟»، «مشخصاتش چیه؟» و مقایسه «این یا اون» استفاده کن. شناسه‌ها را از نتایج ابزار یا فهرست «محصولات مطرح‌شده در گفتگو» بردار؛ هرگز شناسه نساز.",
    input_schema: {
      type: "object",
      properties: {
        productIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
        slug: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_catalog_overview",
    description: "فهرست دسته‌بندی‌ها و برندهای فعال فروشگاه و تعداد کالاهای موجود/تخفیف‌دار. وقتی نمی‌دانی فروشگاه چه چیزهایی دارد یا slug دسته/برند لازم داری استفاده کن.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_store_policy",
    description:
      "متن رسمی و مصوب قوانین فروشگاه از صفحات قوانین و سوالات متداول: ارسال و زمان تحویل و هزینه ارسال (shipping)، مرجوعی (returns)، روش‌های پرداخت (payment)، گارانتی/اصالت (warranty)، ثبت و لغو سفارش (orders)، حساب کاربری (account)، کد تخفیف (discounts)، پشتیبانی و تماس (support)، حریم خصوصی (privacy)، محصولات (products). هر سوال درباره قوانین را فقط با خروجی این ابزار جواب بده.",
    input_schema: {
      type: "object",
      properties: { topic: { type: "string", enum: POLICY_TOPICS } },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    name: "get_my_orders",
    description:
      "سفارش‌های همین کاربرِ واردشده (فقط سفارش‌های خودش) با وضعیت، وضعیت پرداخت، کد رهگیری و اقلام. اگر کاربر وارد نشده باشد خطای auth_required برمی‌گردد. orderRef همان ۸ کاراکتر آخر شماره سفارش است (اختیاری).",
    input_schema: {
      type: "object",
      properties: {
        orderRef: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 5 },
      },
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = new Set(ASSISTANT_TOOLS.map((t) => t.name));

export interface ToolExecutionContext {
  data: StoreDataSource;
  auth: AssistantAuthContext;
  /** Every product the tools returned this turn, keyed by id (cards + price verification). */
  seenProducts: Map<string, AssistantProductSummary>;
  /** Raw money amounts that appeared in tool output (verification allowlist). */
  verifiedAmounts: Set<number>;
  log: Array<{ name: string; ok: boolean; error?: string }>;
}

export interface ToolOutcome {
  ok: boolean;
  content: string;
}

class ToolInputError extends Error {}

function asObject(input: unknown): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ToolInputError("input must be an object");
  return input as Record<string, unknown>;
}
function optString(o: Record<string, unknown>, key: string, max = 120): string | undefined {
  const v = o[key];
  if (v == null || v === "") return undefined;
  if (typeof v !== "string") throw new ToolInputError(`${key} must be a string`);
  return v.slice(0, max);
}
function optNumber(o: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = o[key];
  if (v == null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(/[,٬]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ToolInputError(`${key} must be a number`);
  return Math.min(max, Math.max(min, n));
}
function optBool(o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  if (v == null) return undefined;
  if (typeof v !== "boolean") throw new ToolInputError(`${key} must be a boolean`);
  return v;
}

function rememberProduct(ctx: ToolExecutionContext, p: AssistantProductSummary) {
  ctx.seenProducts.set(p.id, p);
  for (const n of [p.effectivePrice, p.originalPrice, p.discountAmount]) if (n > 0) ctx.verifiedAmounts.add(n);
  if (p.variantPriceRange) {
    ctx.verifiedAmounts.add(p.variantPriceRange.min);
    ctx.verifiedAmounts.add(p.variantPriceRange.max);
  }
}

const MAX_TOOL_OUTPUT_CHARS = 14_000;

function serialize(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}…(truncated)` : text;
}

export function parseSearchInput(input: unknown): ProductSearchInput {
  const o = asObject(input);
  const sortRaw = optString(o, "sort", 20);
  if (sortRaw && !SORTS.includes(sortRaw as ProductSort)) throw new ToolInputError("invalid sort");
  const minPrice = optNumber(o, "minPrice", 0, 1e12);
  const maxPrice = optNumber(o, "maxPrice", 0, 1e12);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) throw new ToolInputError("minPrice > maxPrice");
  const slug = (k: string) => {
    const v = optString(o, k, 80);
    if (v && !/^[\p{L}\p{N}_-]+$/u.test(v)) throw new ToolInputError(`invalid ${k}`);
    return v;
  };
  return {
    query: optString(o, "query", 100),
    categorySlug: slug("categorySlug"),
    brandSlug: slug("brandSlug"),
    minPrice,
    maxPrice,
    onlyDiscounted: optBool(o, "onlyDiscounted"),
    includeOutOfStock: optBool(o, "includeOutOfStock"),
    sort: (sortRaw as ProductSort) || "relevance",
    limit: Math.round(optNumber(o, "limit", 1, 8) ?? 6),
  };
}

export async function executeTool(name: string, input: unknown, ctx: ToolExecutionContext): Promise<ToolOutcome> {
  if (!TOOL_NAMES.has(name)) {
    ctx.log.push({ name: String(name).slice(0, 40), ok: false, error: "unknown_tool" });
    return { ok: false, content: serialize({ error: "unknown_tool", allowed: [...TOOL_NAMES] }) };
  }
  try {
    const result = await runTool(name, input, ctx);
    ctx.log.push({ name, ok: true });
    return { ok: true, content: serialize(result) };
  } catch (error) {
    const isInput = error instanceof ToolInputError;
    const code = isInput ? "invalid_input" : "data_unavailable";
    ctx.log.push({ name, ok: false, error: code });
    if (!isInput) console.warn(`[ai-assistant] tool ${name} failed`, error);
    return {
      ok: false,
      content: serialize({
        error: code,
        detail: isInput ? (error as Error).message : "داده فروشگاه در این لحظه در دسترس نیست؛ به کاربر بگو و حدس نزن.",
      }),
    };
  }
}

async function runTool(name: string, input: unknown, ctx: ToolExecutionContext): Promise<unknown> {
  switch (name) {
    case "search_products": {
      const parsed = parseSearchInput(input);
      const res = await ctx.data.searchProducts(parsed);
      res.products.forEach((p) => rememberProduct(ctx, p));
      return {
        currency: "toman",
        relaxedQuery: res.relaxedQuery,
        note: res.relaxedQuery
          ? "هیچ محصولی با عبارت جستجو مطابقت نداشت؛ این‌ها فقط با فیلترهای دیگر آمده‌اند. صریحاً به کاربر بگو کالای دقیق پیدا نشد."
          : undefined,
        count: res.products.length,
        products: res.products,
      };
    }
    case "get_product_details": {
      const o = asObject(input);
      const slug = optString(o, "slug", 120);
      const idsRaw = o.productIds;
      if (idsRaw != null && !Array.isArray(idsRaw)) throw new ToolInputError("productIds must be an array");
      const ids = Array.isArray(idsRaw) ? idsRaw.slice(0, 4) : [];
      const invalid = ids.filter((id) => !isObjectIdLike(id));
      if (invalid.length) throw new ToolInputError("productIds must be ids returned by tools (24-hex)");
      if (!ids.length && !slug) throw new ToolInputError("productIds or slug is required");
      const products = ids.length ? await ctx.data.getProductsByIds(ids as string[]) : [];
      if (slug && !ids.length) {
        const bySlug = await ctx.data.getProductBySlug(normalizePersian(slug).replace(/\s+/g, "-"));
        if (bySlug) products.push(bySlug);
      }
      products.forEach((p) => {
        rememberProduct(ctx, p);
        p.variants.forEach((v) => {
          if (v.effectivePrice > 0) ctx.verifiedAmounts.add(v.effectivePrice);
          if (v.originalPrice > 0) ctx.verifiedAmounts.add(v.originalPrice);
        });
      });
      const found = new Set(products.map((p) => p.id));
      return {
        currency: "toman",
        products,
        notFound: ids.filter((id) => !found.has(id as string)),
      };
    }
    case "get_catalog_overview":
      return ctx.data.getCatalogOverview();
    case "get_store_policy": {
      const o = asObject(input);
      const topic = optString(o, "topic", 20);
      if (!topic || !POLICY_TOPICS.includes(topic as PolicyTopic)) throw new ToolInputError("invalid topic");
      return getPolicyKnowledge(topic as PolicyTopic);
    }
    case "get_my_orders": {
      // Authorization is decided by the SERVER session only — never by model input.
      if (!ctx.auth.customerId) {
        return { error: "auth_required", message: "کاربر وارد حساب نشده است؛ اطلاعات هیچ سفارشی قابل نمایش نیست.", loginUrl: "/login" };
      }
      const o = asObject(input);
      const refRaw = optString(o, "orderRef", 40);
      const orderRef = refRaw ? refRaw.replace(/^#/, "").trim().slice(-8).toUpperCase() : undefined;
      if (orderRef && !/^[A-F0-9]{4,8}$/.test(orderRef)) throw new ToolInputError("orderRef must be hex characters of the order number");
      const limit = Math.round(optNumber(o, "limit", 1, 5) ?? 3);
      const orders = await ctx.data.getCustomerOrders(ctx.auth.customerId, { orderRef, limit });
      orders.forEach((ord) => {
        if (ord.totalAmount > 0) ctx.verifiedAmounts.add(ord.totalAmount);
        ord.items.forEach((i) => i.unitPrice > 0 && ctx.verifiedAmounts.add(i.unitPrice));
      });
      return { count: orders.length, orders, note: orders.length ? undefined : "هیچ سفارشی (با این مشخصات) برای این کاربر ثبت نشده است." };
    }
    default:
      throw new ToolInputError("unknown tool");
  }
}
