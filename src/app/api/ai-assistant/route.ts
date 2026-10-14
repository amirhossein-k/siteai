import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { dbConnect } from "@/lib/dbConnect";
import Product from "@/models/Product";
import Category from "@/models/Category";
import Brand from "@/models/Brand";
import { sanitizePlainText } from "@/lib/sanitize";
import { getEffectivePrice, toPublicDiscount } from "@/lib/product-pricing";
import { rateLimit } from "@/lib/rate-limiter";

const SEMANTIC_CACHE_TTL_MS = Math.max(5 * 60_000, Number(process.env.AI_SEMANTIC_CACHE_TTL_MS || 60 * 60_000));

const getAssistantCacheModel = () => {
  const schema = new mongoose.Schema(
    {
      _id: { type: String },
      normalizedQuery: { type: String, required: true },
      intent: { type: String, required: true },
      maxPrice: { type: Number, default: null },
      category: { type: String, default: "" },
      payload: { type: mongoose.Schema.Types.Mixed, required: true },
      expiresAt: { type: Date, required: true },
    },
    { _id: false, timestamps: true }
  );
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return (mongoose.models.AiAssistantSemanticCache as mongoose.Model<{
    _id: string;
    normalizedQuery: string;
    intent: string;
    maxPrice: number | null;
    category: string;
    payload: unknown;
    expiresAt: Date;
  }>) || mongoose.model("AiAssistantSemanticCache", schema);
};

function semanticNormalize(value: string) {
  const synonymMap: Record<string, string> = {
    "میخوام": "میخواهم",
    "می‌خوام": "میخواهم",
    "تومن": "تومان",
    "ارزون": "اقتصادی",
    "ارزان": "اقتصادی",
    "پرفروشترین": "پرفروش",
    "پرفروش‌ترین": "پرفروش",
    "کالا": "محصول",
    "اجناس": "محصول",
  };
  const stopWords = new Set(["را", "رو", "یک", "یه", "به", "برای", "لطفا", "من", "از", "در", "با", "میخواهم"]);
  return value
    .normalize("NFKC")
    .replace(/[؟?!،؛,:.()[\]{}"'`]/g, " ")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .toLowerCase()
    .split(/\s+/)
    .map((token) => synonymMap[token] || token)
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .sort()
    .join(" ");
}

function semanticCacheKey(query: string, intent: string, maxPrice?: number, category?: string) {
  const basis = `${semanticNormalize(query)}|${intent}|${maxPrice || ""}|${semanticNormalize(category || "")}`;
  return crypto.createHash("sha256").update(basis).digest("hex");
}

const AI_ASSISTANT_LIMIT = {
  max: 25,
  windowMs: 15 * 60 * 1000,
};

// Keep responses fast and affordable. Override only when needed in production.
const AI_MODEL_TIMEOUT_MS = Math.max(8000, Number(process.env.ANTHROPIC_TIMEOUT_MS || 14000));
const AI_MAX_OUTPUT_TOKENS = Math.min(600, Math.max(160, Number(process.env.ANTHROPIC_MAX_TOKENS || 320)));
const KNOWLEDGE_CACHE_MS = 30_000;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface AssistantRequestBody {
  query?: string;
  intent?: "best_sellers" | "discounted" | "budget" | "newest" | "search" | "compare";
  maxPrice?: number;
  category?: string;
  history?: Array<{ role?: "user" | "assistant"; content?: string }>;
}

function normalizedDigitsPlaceholder(query: string): { maxPrice?: number } {
  const normalized = query.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  const match = normalized.match(/(?:زیر|کمتر از|تا|حدود|بودجه)\s*(\d[\d,]*)\s*(هزار|میلیون|میلیارد)?/i);
  if (!match) return {};
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return {};
  const multiplier = match[2] === "هزار" ? 1000 : match[2] === "میلیون" ? 1000000 : match[2] === "میلیارد" ? 1000000000 : 1;
  return { maxPrice: Math.floor(value * multiplier) };
}

const MARLOO_DOMAIN_KNOWLEDGE = `
اطلاعات قطعی مارلو شاپ:
- مارلو شاپ یک فروشگاه اینترنتی فارسی و راست‌به‌چپ است.
- صفحه اصلی: / ، کاتالوگ محصولات: /products ، سبد خرید: /cart ، ورود: /login ، ثبت‌نام: /register.
- کاربران می‌توانند محصولات و دسته‌بندی‌ها را جست‌وجو کنند، محصول را به سبد خرید اضافه کنند و سفارش ثبت کنند.
- پرداخت آنلاین با درگاه زرین‌پال انجام می‌شود؛ وضعیت سفارش در حساب کاربری قابل پیگیری است.
- ورود و ثبت‌نام با شماره موبایل، رمز عبور یا کد یک‌بارمصرف انجام می‌شود.
- مشتری می‌تواند پروفایل، آدرس، سفارش‌ها (/orders)، علاقه‌مندی‌ها (/wishlist)، کدهای تخفیف (/coupons)، اعلان‌ها (/notifications) و پشتیبانی سفارش‌محور (/support) را مدیریت کند.
- پشتیبانی برای سفارش‌های پرداخت‌شده یا بازپرداخت‌شده از مسیر گفت‌وگوی مرتبط با سفارش انجام می‌شود.
- فروشندگان پنل جداگانه برای محصولات، سفارش‌ها، کیف پول و پشتیبانی دارند.
- دستیار باید برای راهنمایی مسیر داخل سایت، نام فارسی بخش و لینک داخلی مرتبط را پیشنهاد دهد.
- دستیار نباید درباره موجودی، قیمت، تخفیف یا ویژگی محصول چیزی بسازد؛ این موارد فقط از کاتالوگ ارسالی معتبرند.
- شرایط دقیق مرجوعی، هزینه ارسال و استثناها در دانش قطعی فعلی ثبت نشده؛ درباره آن‌ها حدس نزن و کاربر را به پشتیبانی سفارش‌محور هدایت کن.
- اگر سؤال خارج از خرید، محصولات، سفارش، حساب کاربری، پرداخت، تخفیف، ارسال یا پشتیبانی است، کوتاه بگو در حوزه تخصصی مارلو شاپ نیستی.
`;

const SITE_ROUTES = [
  { keywords: /محصول|کالا|خرید|دسته|برند|جستجو/i, label: "محصولات", href: "/products" },
  { keywords: /سبد|کارت خرید/i, label: "سبد خرید", href: "/cart" },
  { keywords: /سفارش|پیگیری|وضعیت سفارش/i, label: "سفارش‌های من", href: "/orders" },
  { keywords: /ورود|ثبت.?نام|رمز|حساب|پروفایل|آدرس/i, label: "حساب کاربری", href: "/profile" },
  { keywords: /علاقه|پسندیده/i, label: "علاقه‌مندی‌ها", href: "/wishlist" },
  { keywords: /کد تخفیف|کوپن/i, label: "کدهای تخفیف", href: "/coupons" },
  { keywords: /اعلان|نوتیفیکیشن/i, label: "اعلان‌ها", href: "/notifications" },
  { keywords: /پشتیبان|مرجوع|بازگشت|تعویض|مشکل سفارش/i, label: "پشتیبانی سفارش", href: "/support" },
];

function getRelatedRoutes(query: string) {
  return SITE_ROUTES.filter((route) => route.keywords.test(query)).slice(0, 3);
}


function classifyDomainQuery(query: string): "greeting" | "policy" | "domain" | "out_of_scope" {
  if (/^(سلام|درود|hi|hello|hey|وقت بخیر|خوبی)[!！؟? .]*$/i.test(query.trim())) return "greeting";
  if (/(مرجوع|مرجوعی|بازگشت کالا|تعویض|شرایط بازگشت|ضمانت بازگشت|refund|return)/i.test(query)) return "policy";
  if (/(محصول|خرید|قیمت|تخفیف|پرفروش|دسته|برند|موجود|سفارش|پرداخت|زرین|ارسال|حساب|ورود|ثبت.?نام|رمز|علاقه|سبد|پشتیبان|فروشنده|کیف پول|کد تخفیف|اعلان|آدرس|مارلو|فروشگاه)/.test(query)) return "domain";
  return "out_of_scope";
}

let knowledgeCache: { expiresAt: number; value: { activeProducts: number | null; discountedProducts: number | null; categories: Array<{ name: string; slug: string }>; brands: Array<{ name: string; slug: string }>; source: string } } | null = null;

async function loadStoreKnowledgeFromDatabase() {
  if (knowledgeCache && knowledgeCache.expiresAt > Date.now()) return knowledgeCache.value;
  try {
    const [activeProducts, categories, brands, discountedProducts] = await Promise.all([
      Product.countDocuments({ isActive: true, stock: { $gt: 0 } }),
      Category.find({ isActive: true, deletedAt: null })
        .select("name slug")
        .sort({ name: 1 })
        .limit(20)
        .lean(),
      Brand.find({ isActive: true, deletedAt: null })
        .select("name slug")
        .sort({ name: 1 })
        .limit(20)
        .lean(),
      Product.countDocuments({
        isActive: true,
        stock: { $gt: 0 },
        "discount.isActive": true,
      }),
    ]);

    const value = {
      activeProducts,
      discountedProducts,
      categories: categories.map((item) => ({
        name: String(item.name || ""),
        slug: String(item.slug || ""),
      })),
      brands: brands.map((item) => ({
        name: String(item.name || ""),
        slug: String(item.slug || ""),
      })),
      source: "mongodb",
    };
    knowledgeCache = { expiresAt: Date.now() + KNOWLEDGE_CACHE_MS, value };
    return value;
  } catch (error) {
    console.warn("Store knowledge snapshot unavailable; using static knowledge", error);
    const value = {
      activeProducts: null,
      discountedProducts: null,
      categories: [],
      brands: [],
      source: "static-fallback",
    };
    return value;
  }
}

function formatStoreKnowledge(snapshot: Awaited<ReturnType<typeof loadStoreKnowledgeFromDatabase>>) {
  const categories = snapshot.categories.length
    ? snapshot.categories.map((item) => `${item.name} (/products?category=${encodeURIComponent(item.slug)})`).join("، ")
    : "در دسترس نیست";
  const brands = snapshot.brands.length
    ? snapshot.brands.map((item) => item.name).join("، ")
    : "در دسترس نیست";

  return `دانش زنده فروشگاه از دیتابیس (${snapshot.source}):
- محصولات فعال و موجود: ${snapshot.activeProducts ?? "در دسترس نیست"}
- محصولات تخفیف‌دار فعال و موجود: ${snapshot.discountedProducts ?? "در دسترس نیست"}
- دسته‌بندی‌های فعال: ${categories}
- برندهای فعال: ${brands}`;
}

function getAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

async function generateModelReply(input: {
  query: string;
  intent: string;
  maxPrice?: number;
  recommendations: Array<{
    name: string;
    effectivePrice: number;
    discountPercent: number;
    reason: string;
    categoryName: string;
    brandName: string;
  }>;
  history: Array<{ role?: "user" | "assistant"; content?: string }>;
  liveStoreKnowledge: string;
}): Promise<string | null> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  const model = process.env.ANTHROPIC_MODEL;
  if (!baseUrl || !token || !model) return null;

  const catalog = input.recommendations
    .map(
      (item, index) =>
        `${index + 1}. ${item.name} | قیمت نهایی: ${item.effectivePrice.toLocaleString("fa-IR")} تومان | تخفیف: ${item.discountPercent}٪ | دلیل: ${item.reason} | دسته: ${item.categoryName || "نامشخص"} | برند: ${item.brandName || "نامشخص"}`
    )
    .join("\n");

  const conversation = input.history.slice(-4).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: String(item.content || "").slice(0, 600),
  }));
  conversation.push({ role: "user", content: input.query });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_MODEL_TIMEOUT_MS);
  try {
    const response = await fetch(getAnthropicMessagesUrl(baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": token,
        "authorization": `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        temperature: 0.35,
        system:
          `تو مشاور رسمی و فارسی مارلو شاپ هستی. فقط درباره حوزه مارلو شاپ پاسخ بده. ${MARLOO_DOMAIN_KNOWLEDGE}
${input.liveStoreKnowledge}
قوانین: برای قیمت، موجودی، تخفیف و ویژگی محصول فقط از کاتالوگ استفاده کن. اگر اطلاعاتی در کاتالوگ یا دانش قطعی بالا نیست، صادقانه بگو «اطلاعات کافی ندارم» و حدس نزن. پاسخ را کوتاه، کاربردی و فارسی بنویس. اگر کاربر سؤال عمومی یا نامرتبط پرسید، وارد آن موضوع نشو.`,
        messages: [
          ...conversation,
          {
            role: "user",
            content: `${input.liveStoreKnowledge}\nمسیرهای مرتبط احتمالی: ${getRelatedRoutes(input.query).map((r) => `${r.label} (${r.href})`).join("، ") || "ندارد"}\nدرخواست: ${input.query}\nهدف: ${input.intent}\nسقف بودجه: ${input.maxPrice ? `${input.maxPrice.toLocaleString("fa-IR")} تومان` : "تعیین نشده"}\nکاتالوگ پیشنهادی:\n${catalog || "گزینه‌ای پیدا نشد"}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = payload.content
      ?.filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (error) {
    console.warn("AI provider unavailable; using local recommendation response", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * POST /api/ai-assistant
 *
 * Smart AI Shopping Advisor & Product Recommendation Engine.
 * Evaluates user natural-language queries in Persian, applies budget/intent
 * filters, scores active in-stock products using effective pricing, discounts,
 * sales velocity (`soldCount`), and text relevance, and returns tailored
 * Persian shopping advice + product cards.
 */
export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "anonymous";

    const rl = await rateLimit(`ai-assistant:${ip}`, AI_ASSISTANT_LIMIT);
    if (rl.limited) {
      return NextResponse.json(
        {
          error:
            "تعداد درخواست‌های شما به دستیار هوشمند بیش از حد مجاز است. لطفاً چند دقیقه دیگر تلاش کنید.",
        },
        { status: 429, headers: rl.headers }
      );
    }

    const body = (await req.json().catch(() => ({}))) as AssistantRequestBody;
    const rawQuery = typeof body.query === "string" ? body.query : "";
    const cleanQuery = sanitizePlainText(rawQuery).trim().slice(0, 200);
    const domainClass = classifyDomainQuery(cleanQuery);
    const relatedRoutes = getRelatedRoutes(cleanQuery);
    const intent = body.intent || "search";
    const history = Array.isArray(body.history)
      ? body.history.slice(-4).filter((item) => typeof item?.content === "string")
      : [];
    const category = typeof body.category === "string"
      ? sanitizePlainText(body.category).trim().slice(0, 80)
      : "";
    const queryNumbers = normalizedDigitsPlaceholder(cleanQuery);
    const maxPrice =
      typeof body.maxPrice === "number" && Number.isFinite(body.maxPrice) && body.maxPrice > 0
        ? Math.floor(body.maxPrice)
        : queryNumbers.maxPrice;

    if (!cleanQuery) {
      return NextResponse.json({
        reply: "سؤال یا نام محصولت را بنویس تا درباره خرید در مارلو شاپ راهنمایی‌ات کنم.",
        recommendations: [],
        relatedRoutes,
        meta: { intent: "search", compared: false, confidence: "high", provider: "scope-guard" },
      });
    }

    if (domainClass === "greeting") {
      return NextResponse.json({
        reply: "سلام! من مشاور خرید مارلو شاپ هستم. می‌توانم درباره محصولات، قیمت، تخفیف، سفارش، پرداخت، ارسال و حساب کاربری راهنمایی‌ات کنم. دنبال چه چیزی هستی؟",
        recommendations: [],
        relatedRoutes,
        meta: { intent: "greeting", compared: false, confidence: "high", provider: "scope-guard" },
      });
    }

    if (domainClass === "policy") {
      return NextResponse.json({
        reply: "شرایط دقیق مرجوعی در اطلاعات فعلی دستیار ثبت نشده و نمی‌خواهم درباره مهلت یا هزینه ارسال حدس بزنم. برای بررسی مورد شما، وارد حساب کاربری > سفارش‌ها شوید و گفت‌وگوی مرتبط با همان سفارش را باز کنید؛ پشتیبانی سفارش‌محور برای سفارش‌های پرداخت‌شده یا بازپرداخت‌شده از همان مسیر پاسخ می‌دهد.",
        recommendations: [],
        relatedRoutes,
        meta: { intent: "return_policy", compared: false, confidence: "high", provider: "scope-guard" },
      });
    }

    if (domainClass === "out_of_scope") {
      return NextResponse.json({
        reply: "من برای راهنمایی خرید در مارلو شاپ ساخته شده‌ام و درباره این موضوع اطلاعات قابل اتکایی ندارم. درباره محصول، قیمت، تخفیف، سفارش، پرداخت، ارسال یا حساب کاربری بپرس.",
        recommendations: [],
        relatedRoutes,
        meta: { intent: "out_of_scope", compared: false, confidence: "high", provider: "scope-guard" },
      });
    }

    await dbConnect();
    const storeKnowledge = await loadStoreKnowledgeFromDatabase();
    const liveStoreKnowledge = formatStoreKnowledge(storeKnowledge);
    const cacheModel = getAssistantCacheModel();
    const cacheKey = semanticCacheKey(cleanQuery, intent, maxPrice, category);
    const cached = await cacheModel.findById(cacheKey).lean();
    if (cached && cached.expiresAt > new Date()) {
      const cachedPayload = cached.payload as Record<string, unknown>;
      return NextResponse.json({
        ...cachedPayload,
        meta: {
          ...((cachedPayload.meta as Record<string, unknown>) || {}),
          provider: "semantic-cache",
          cache: "hit",
          knowledgeSource: storeKnowledge.source,
        },
      });
    }

    // Extract budget numbers from Persian/English query if user typed e.g. "زیر ۵۰۰ هزار تومان"
    const normalizedDigits = cleanQuery.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    );

    const isDiscountQuery =
      intent === "discounted" ||
      /تخفیف|ارزان|حراج|پیشنهاد ویژه|اقتصادی/.test(cleanQuery);
    const isBestSellerQuery =
      intent === "best_sellers" ||
      /پرفروش|محبوب|بهترین|پیشنهاد/.test(cleanQuery);
    const isNewestQuery =
      intent === "newest" || /جدید|تازه|نو/.test(cleanQuery);
    const isCompareQuery =
      intent === "compare" || /مقایسه|فرق|تفاوت|بین/.test(cleanQuery);

    // Tokenize search keywords (exclude common Persian stop words)
    const stopWords = new Set([
      "من",
      "یک",
      "یه",
      "برای",
      "میخوام",
      "میخواهم",
      "لطفا",
      "بهترین",
      "محصول",
      "محصولات",
      "خرید",
      "چیه",
      "چی",
      "دارید",
      "پیشنهاد",
      "بده",
      "با",
      "قیمت",
      "مناسب",
      "خوب",
    ]);

    const keywords = normalizedDigits
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && !stopWords.has(w));

    // Fetch active, in-stock products
    const mongoFilter: Record<string, unknown> = {
      isActive: true,
      stock: { $gt: 0 },
    };

    if (category) {
      mongoFilter.category = category.match(/^[a-f\d]{24}$/i) ? category : undefined;
      if (!mongoFilter.category) delete mongoFilter.category;
    }

    if (keywords.length > 0 && intent === "search") {
      const regexes = keywords.map((kw) => new RegExp(escapeRegex(kw), "i"));
      mongoFilter.$or = [
        { name: { $in: regexes } },
        { description: { $in: regexes } },
      ];
    }

    let rawProducts = await Product.find(mongoFilter)
      .select("name slug description images price discount stock soldCount createdAt hasVariants")
      .populate("category", "name slug")
      .populate("brand", "name slug")
      .sort({ soldCount: -1, createdAt: -1 })
      .limit(30)
      .lean();

    // Fallback: if keyword query had no exact match, recommend top catalog items
    let usedFallback = false;
    if (rawProducts.length === 0) {
      usedFallback = true;
      rawProducts = await Product.find({ isActive: true, stock: { $gt: 0 } })
        .select("name slug description images price discount stock soldCount createdAt hasVariants")
        .populate("category", "name slug")
        .populate("brand", "name slug")
        .sort({ soldCount: -1, createdAt: -1 })
        .limit(20)
        .lean();
    }

    const now = new Date();
    const scoredProducts = rawProducts
      .map((p: Record<string, unknown>) => {
        const basePrice = Number(p.price) || 0;
        const eff = getEffectivePrice(
          basePrice,
          p.discount as Parameters<typeof getEffectivePrice>[1],
          now
        );
        const pubDiscount = toPublicDiscount(eff);

        // Compute smart score
        let score = 0;
        const nameStr = String(p.name || "");
        const descStr = String(p.description || "");

        for (const kw of keywords) {
          if (nameStr.includes(kw)) score += 30;
          else if (descStr.includes(kw)) score += 10;
        }

        if (isDiscountQuery && eff.active) {
          score += 40 + eff.discountPercent;
        }
        if (isBestSellerQuery) {
          score += Math.min(50, (Number(p.soldCount) || 0) * 5);
        }
        if (isNewestQuery) {
          score += 25;
        }
        if (isCompareQuery && eff.active) {
          score += 12;
        }
        // A short conversation memory boost keeps follow-up questions useful.
        if (history.some((item) => String(item.content || "").includes(nameStr))) {
          score += 8;
        }

        // Value bonus for active discounts
        if (eff.active) {
          score += eff.discountPercent * 0.5;
        }

        const images = Array.isArray(p.images) ? (p.images as string[]) : [];
        const categoryObj = p.category as { name?: string; slug?: string } | null;
        const brandObj = p.brand as { name?: string; slug?: string } | null;

        return {
          _id: String(p._id),
          name: nameStr,
          slug: String(p.slug || ""),
          image: images[0] || "",
          price: basePrice,
          effectivePrice: eff.finalPrice,
          discountPercent: eff.active ? eff.discountPercent : 0,
          discount: pubDiscount,
          stock: Number(p.stock) || 0,
          categoryName: categoryObj?.name || "",
          brandName: brandObj?.name || "",
          reason: eff.active
            ? `دارای ${eff.discountPercent}٪ تخفیف فعال (صرفه‌جویی ${eff.discountAmount.toLocaleString("fa-IR")} تومان)`
            : Number(p.soldCount) > 0
            ? "جزو کالاهای پرفروش و محبوب خریداران"
            : "موجودی آماده ارسال با ضمانت اصالت",
          fit: maxPrice ? `در محدوده بودجه شما، تا ${maxPrice.toLocaleString("fa-IR")} تومان` : "انتخاب‌شده بر اساس ارزش خرید و موجودی",
          score,
        };
      })
      .filter((item) => (maxPrice ? item.effectivePrice <= maxPrice : true));

    if (isDiscountQuery) {
      scoredProducts.sort((a, b) => b.discountPercent - a.discountPercent || b.score - a.score);
    } else if (intent === "budget") {
      scoredProducts.sort((a, b) => a.effectivePrice - b.effectivePrice);
    } else {
      scoredProducts.sort((a, b) => b.score - a.score);
    }

    const recommendations = scoredProducts.slice(0, 4);

    // Build conversational Persian response
    let reply = "";
    if (recommendations.length === 0) {
      reply =
        "متأسفانه در حال حاضر محصول موجودی با این مشخصات پیدا نشد. پیشنهاد می‌کنم عبارت دیگری را امتحان کنید یا سقف بودجه را تغییر دهید.";
    } else if (usedFallback && cleanQuery) {
      reply = `مورد دقیقی با عبارت «${cleanQuery}» پیدا نشد، اما بر اساس محبوبیت و ارزش خرید، این ${recommendations.length} محصول برتر فروشگاه را به شما پیشنهاد می‌کنم:`;
    } else if (isDiscountQuery) {
      reply =
        "بهترین محصولات تخفیف‌دار و باارزش فعلی مارلو شاپ را برایتان گلچین کردم تا بیشترین صرفه‌جویی را در خریدتان داشته باشید:";
    } else if (intent === "budget") {
      reply =
        "اقتصادی‌ترین و خوش‌قیمت‌ترین محصولات موجود که کیفیت بالایی دارند:";
    } else if (isBestSellerQuery) {
      reply =
        "این محصولات بیشترین استقبال و رضایت مشتریان مارلو شاپ را داشته‌اند:";
    } else if (isCompareQuery) {
      reply =
        "برای مقایسه، گزینه‌ها را بر اساس قیمت نهایی، تخفیف، محبوبیت و موجودی مرتب کردم. گزینه اول بهترین ارزش خرید فعلی است:";
    } else {
      reply = `بر اساس درخواست شما، ${recommendations.length} گزینه عالی با موجودی آماده ارسال پیدا کردم:`;
    }

    const modelReply = await generateModelReply({
      query: cleanQuery,
      intent,
      maxPrice,
      recommendations,
      history,
      liveStoreKnowledge,
    });

    const responsePayload = {
      reply: modelReply || reply,
      recommendations,
      relatedRoutes,
      meta: {
        intent,
        maxPrice: maxPrice ?? null,
        category: category || null,
        compared: isCompareQuery,
        confidence: modelReply ? "model" : usedFallback ? "medium" : "high",
        provider: modelReply ? "anthropic-compatible" : "local-ranking",
        knowledgeSource: storeKnowledge.source,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        timeoutMs: AI_MODEL_TIMEOUT_MS,
        cache: "miss",
      },
    };

    await cacheModel.findOneAndUpdate(
      { _id: cacheKey },
      {
        $set: {
          normalizedQuery: semanticNormalize(cleanQuery),
          intent,
          maxPrice: maxPrice ?? null,
          category,
          payload: responsePayload,
          expiresAt: new Date(Date.now() + SEMANTIC_CACHE_TTL_MS),
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json(responsePayload, { status: 200, headers: rl.headers });
  } catch (error) {
    console.error("AI Assistant error:", error);
    return NextResponse.json(
      { error: "خطایی در پردازش درخواست دستیار هوشمند رخ داد." },
      { status: 500 }
    );
  }
}
