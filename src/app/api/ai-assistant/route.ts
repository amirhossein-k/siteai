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
import { getServerToken } from "@/lib/auth-utils";
import Order from "@/models/Order";
import { FAQ_ITEMS } from "@/lib/faq-content";
import { TERMS_SECTIONS } from "@/lib/terms-content";
import { routeAssistantQuestion, linksForRoute, type AssistantRoute } from "@/lib/ai-assistant-routing";

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
    "محوصل": "محصول",
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

function buildOfficialStorePolicyText(): string {
  const shippingSection = TERMS_SECTIONS.find((s) => s.id === "shipping");
  const returnsSection = TERMS_SECTIONS.find((s) => s.id === "returns");
  const paymentSection = TERMS_SECTIONS.find((s) => s.id === "payment");
  const faqHighlights = FAQ_ITEMS.filter((f) =>
    ["delivery-time", "track-order", "return-policy", "return-process", "defective-product", "payment-methods", "how-to-login", "how-to-use-coupon"].includes(f.id)
  )
    .map((f) => `- ${f.question}: ${f.answer.replace(/\n/g, " ")}`)
    .join("\n");

  return [
    "قوانین رسمی و مصوب مارلو شاپ (از faq-content و terms-content):",
    shippingSection?.items ? `ارسال و تحویل:\n- ${shippingSection.items.join("\n- ")}` : "",
    returnsSection?.items ? `مرجوعی و بازگشت کالا:\n- ${returnsSection.items.join("\n- ")}` : "",
    paymentSection?.items ? `روش‌های پرداخت:\n- ${paymentSection.items.join("\n- ")}` : "",
    `پرسش‌های پرتکرار مصوب:\n${faqHighlights}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const MARLOO_DOMAIN_KNOWLEDGE = `
اطلاعات قطعی مارلو شاپ:
- مارلو شاپ یک فروشگاه اینترنتی فارسی و راست‌به‌چپ است.
- صفحه اصلی: / ، کاتالوگ محصولات: /products ، سبد خرید: /cart ، ورود: /login ، ثبت‌نام: /register ، سوالات متداول: /faq ، قوانین و مقررات: /terms.
- ارسال و تحویل: سفارش‌ها معمولاً ظرف ۱ روز کاری پس از تأیید پرداخت آماده و ارسال می‌شوند و زمان تحویل بسته به مقصد، بین ۱ تا ۷ روز کاری به سراسر ایران است. کد رهگیری از طریق پیامک ارسال شده و در بخش سفارش‌ها (/orders) هم نمایش داده می‌شود. هزینه ارسال بر اساس شرایط سفارش و مقصد هنگام تکمیل سفارش محاسبه می‌شود.
- مرجوعی کالا: مشتری تا ۲ روز پس از دریافت کالا (در صورت عدم استفاده و حفظ بسته‌بندی اصلی) حق ثبت درخواست مرجوعی از طریق حساب کاربری دارد. اگر کالا معیوب یا اشتباه ارسال شده باشد، هزینه ارسال مرجوعی بر عهده مارلو شاپ است. کالاهای بهداشتی و آرایشی بازشده، دیجیتال، شخصی‌سازی‌شده و فاسدشدنی قابل مرجوع نیستند.
- روش‌های پرداخت: پرداخت آنلاین از طریق درگاه امن زرین‌پال (تمام کارت‌های عضو شتاب) و پرداخت در محل (نقدی یا کارت بانکی هنگام تحویل).
- ورود و ثبت‌نام با شماره موبایل و رمز عبور یا کد یک‌بارمصرف (OTP) انجام می‌شود.
- مشتری می‌تواند پروفایل (/profile)، سفارش‌ها (/orders)، علاقه‌مندی‌ها (/wishlist)، کدهای تخفیف (/coupons)، اعلان‌ها (/notifications) و پشتیبانی سفارش‌محور (/support) را مدیریت کند.
\n${buildOfficialStorePolicyText()}
`;

function buildProfessionalRouteReply(route: AssistantRoute, query: string): string {
  const q = query.trim();
  if (route === "shipping") {
    if (/هزینه|رایگان|چقدر/.test(q)) {
      return "📦 **هزینه و شرایط ارسال در مارلو شاپ:**\n• هزینه ارسال بر اساس شرایط سفارش و شهر مقصد، در مرحله **تکمیل سفارش (صفحه پرداخت)** به‌صورت دقیق محاسبه و نمایش داده می‌شود.\n• سفارش‌ها معمولاً ظرف **۱ روز کاری** پس از تأیید پرداخت آماده و ارسال می‌شوند و تحویل آن‌ها بسته به مقصد بین **۱ تا ۷ روز کاری** زمان می‌برد.\n• پس از ارسال، **کد رهگیری مرسوله** از طریق پیامک برایتان ارسال می‌شود و در بخش «سفارش‌ها» نیز قابل مشاهده است.";
    }
    return "🚚 **زمان و نحوه ارسال سفارش در مارلو شاپ:**\n• **زمان آماده‌سازی:** سفارش‌ها معمولاً ظرف **۱ روز کاری** پس از تأیید پرداخت آماده و تحویل شرکت‌های پستی و حمل‌ونقل معتبر می‌شوند.\n• **مدت زمان تحویل:** بسته به شهر مقصد، تحویل سفارش به سراسر ایران معمولاً بین **۱ تا ۷ روز کاری** زمان می‌برد.\n• **رهگیری مرسوله:** بلافاصله پس از ارسال، **کد رهگیری** از طریق پیامک برای شما ارسال می‌شود و از بخش «سفارش‌ها» در حساب کاربری هم قابل پیگیری است.";
  }

  if (route === "policy") {
    return "🔄 **شرایط بازگشت و مرجوعی کالا در مارلو شاپ:**\n• **مهلت مرجوعی:** تا **۲ روز پس از دریافت کالا** (در صورت عدم استفاده و حفظ بسته‌بندی اصلی) می‌توانید درخواست مرجوعی ثبت کنید.\n• **کالای معیوب یا ارسال اشتباه:** در صورتی که کالا معیوب یا مغایر با سفارش باشد، **هزینه ارسال مرجوعی کاملاً بر عهده مارلو شاپ** است و محصول جایگزین یا وجه شما بازگردانده می‌شود.\n• **نحوه ثبت درخواست:** از طریق حساب کاربری و بخش پشتیبانی سفارش، دلیل مرجوعی و تصویر کالا را ارسال کنید تا آدرس مرجوعی برایتان پیامک شود.\n• **استثناها:** کالاهای آرایشی و بهداشتی بازشده، محصولات دیجیتال، کالاهای شخصی‌سازی‌شده و فاسدشدنی قابل مرجوع نیستند.";
  }

  if (route === "account") {
    if (/ورود|وارد|لاگین|ثبت.?نام|رمز/.test(q)) {
      return "🔐 **ورود و حساب کاربری در مارلو شاپ:**\n• برای ورود یا ثبت‌نام، کافی است با **شماره موبایل و رمز عبور** یا **کد تأیید یک‌بارمصرف (پیامکی)** اقدام کنید.\n• اگر رمز عبورتان را فراموش کرده‌اید، در صفحه ورود گزینه **«رمز عبور را فراموش کرده‌اید؟»** را بزنید تا با شماره موبایل بازیابی شود.\n• پس از ورود، از بخش **پروفایل** می‌توانید اطلاعات حساب، آدرس‌ها و سفارش‌های خود را مدیریت کنید.";
    }
    return "👤 **مدیریت حساب کاربری و خدمات مارلو شاپ:**\n• از بخش **پروفایل و حساب کاربری** می‌توانید اطلاعات شخصی و آدرس‌های خود را ویرایش کنید.\n• برای مشاهده وضعیت خریدها به **سفارش‌ها**، برای کالاهای ذخیره‌شده به **علاقه‌مندی‌ها** و برای گفتگو با کارشناسان به **پشتیبانی** مراجعه کنید.";
  }

  return "🧭 **راهنمای بخش‌های اصلی مارلو شاپ:**\n• برای مشاهده و فیلتر کالاها به بخش **محصولات** (`/products`) بروید.\n• برای پیگیری خریدهای قبلی وارد **سفارش‌ها** (`/orders`) شوید و برای مدیریت اطلاعات حساب به **پروفایل** (`/profile`) سر بزنید.";
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
  route?: string;
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
        temperature: 0.3,
        system:
          `تو مشاور رسمی، خوش‌برخورد و حرفه‌ای فروشگاه مارلو شاپ هستی. فقط درباره حوزه مارلو شاپ پاسخ بده. ${MARLOO_DOMAIN_KNOWLEDGE}
${input.liveStoreKnowledge}
قوانین مهم:
۱. برای قوانین ارسال (آماده‌سازی ۱ روز کاری، تحویل ۱ تا ۷ روز کاری به سراسر ایران، کد رهگیری پیامکی) و قوانین مرجوعی (مهلت ۲ روز پس از دریافت در صورت عدم استفاده) دقیقاً از اطلاعات رسمی بالا استفاده کن و پاسخ را ساختاریافته، شفاف و محترمانه بنویس.
۲. برای قیمت، موجودی، تخفیف و ویژگی محصول فقط از کاتالوگ ارسالی استفاده کن و چیزی از خودت نساز.`,
        messages: [
          ...conversation,
          {
            role: "user",
            content: `${input.liveStoreKnowledge}\nمسیرهای مرتبط: ${linksForRoute((input.route || "product") as AssistantRoute).map((r) => `${r.label} (${r.href})`).join("، ") || "ندارد"}\nدرخواست کاربر: ${input.query}\nدسته پرسش: ${input.route || "product"}\nهدف: ${input.intent}\nسقف بودجه: ${input.maxPrice ? `${input.maxPrice.toLocaleString("fa-IR")} تومان` : "تعیین نشده"}\nکاتالوگ پیشنهادی:\n${catalog || "ندارد (سوال اطلاعاتی/راهنمایی)"}`,
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
    const route = routeAssistantQuestion(cleanQuery);
    const relatedRoutes = linksForRoute(route);
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
        reply: "سؤال یا نام محصول مورد نظرتان را بنویسید تا درباره خرید، ارسال، قوانین یا محصولات مارلو شاپ راهنمایی‌تان کنم.",
        recommendations: [],
        relatedRoutes,
        meta: { intent: "search", compared: false, confidence: "high", provider: "scope-guard" },
      });
    }

    if (route === "greeting") {
      return NextResponse.json({
        reply: "سلام! 👋 من دستیار هوشمند مارلو شاپ هستم.\nمی‌توانم درباره **پیشنهاد و مقایسه محصولات**، **زمان و شرایط ارسال**، **قوانین مرجوعی (تا ۲ روز)**، **پیگیری سفارش** و **حساب کاربری** راهنمایی‌تان کنم. دنبال چه چیزی هستید؟",
        recommendations: [],
        relatedRoutes,
        meta: { intent: "greeting", route, compared: false, confidence: "high", provider: "official-store-knowledge" },
      });
    }

    if (route === "out_of_scope") {
      return NextResponse.json({
        reply: "من دستیار تخصصی فروشگاه **مارلو شاپ** هستم و فقط درباره محصولات، قیمت و تخفیف‌ها، زمان ارسال، شرایط مرجوعی، وضعیت سفارش و حساب کاربری پاسخ می‌دهم. چطور می‌توانم در خرید کمکتان کنم؟",
        recommendations: [],
        relatedRoutes,
        meta: { intent: "out_of_scope", route, compared: false, confidence: "high", provider: "scope-guard" },
      });
    }

    if (route === "shipping" || route === "policy" || route === "navigation" || route === "account") {
      const baseReply = buildProfessionalRouteReply(route, cleanQuery);
      const modelReply = await generateModelReply({
        query: cleanQuery,
        intent,
        recommendations: [],
        history,
        liveStoreKnowledge: "قوانین رسمی فروشگاه از ماژول‌های faq-content و terms-content بارگذاری شده است.",
        route,
      });
      return NextResponse.json({
        reply: modelReply || baseReply,
        recommendations: [],
        relatedRoutes,
        meta: {
          route,
          source: "verified-store-policy",
          provider: modelReply ? "anthropic-compatible" : "official-store-knowledge",
          cache: "bypass",
        },
      });
    }

    if (route === "order" || route === "payment") {
      const token = await getServerToken(req);
      if (!token) {
        const guestReply =
          route === "payment"
            ? "💳 **روش‌ها و پیگیری پرداخت در مارلو شاپ:**\n• پرداخت سفارش‌ها به دو صورت **آنلاین (درگاه امن زرین‌پال)** و **پرداخت در محل** انجام می‌شود.\n• در صورت ناموفق بودن پرداخت آنلاین، سفارش تکمیل نمی‌شود و می‌توانید مجدداً پرداخت را انجام دهید.\n• برای بررسی وضعیت پرداخت سفارش خودتان، لطفاً ابتدا **وارد حساب کاربری** شوید."
            : "📦 **پیگیری وضعیت سفارش:**\n• پس از ارسال هر سفارش، **کد رهگیری** از طریق پیامک برایتان ارسال می‌شود.\n• برای اینکه وضعیت دقیق آخرین سفارش شما را همین‌جا بررسی کنم، لطفاً ابتدا **وارد حساب کاربری** خود شوید.";
        return NextResponse.json(
          {
            reply: guestReply,
            recommendations: [],
            relatedRoutes,
            meta: { route, source: "auth-required", provider: "official-store-knowledge", cache: "bypass" },
          },
          { status: 401 }
        );
      }
      await dbConnect();
      const latest = (await Order.findOne({ customer: token.id })
        .select("_id status totalAmount payment.status payment.method shipping.provider shipping.trackingCode shippedAt deliveredAt createdAt")
        .sort({ createdAt: -1 })
        .lean()) as {
        _id: unknown;
        status?: string;
        totalAmount?: number;
        payment?: { status?: string; method?: string };
        shipping?: { provider?: string; trackingCode?: string };
      } | null;
      if (!latest) {
        return NextResponse.json({
          reply: "در حال حاضر هیچ سفارشی در حساب کاربری شما ثبت نشده است. پس از ثبت اولین خرید، می‌توانید وضعیت آماده‌سازی و کد رهگیری مرسوله را از این بخش پیگیری کنید.",
          recommendations: [],
          relatedRoutes,
          meta: { route, source: "mongodb", provider: "database-grounded", cache: "bypass" },
        });
      }
      const paymentStatus = latest.payment?.status || "نامشخص";
      const status = latest.status || "نامشخص";
      const orderShortId = String(latest._id).slice(-8);
      const trackingInfo = latest.shipping?.trackingCode
        ? `\n• **کد رهگیری مرسوله:** \`${latest.shipping.trackingCode}\``
        : "";
      const reply =
        route === "payment"
          ? `💳 **وضعیت پرداخت آخرین سفارش شما (#${orderShortId}):**\n• **وضعیت پرداخت:** «${paymentStatus}»\n• **مبلغ کل سفارش:** ${Number(latest.totalAmount || 0).toLocaleString("fa-IR")} تومان\nبرای مشاهده فاکتور و جزئیات کامل تراکنش، به صفحه «سفارش‌ها» مراجعه کنید.`
          : `📦 **وضعیت آخرین سفارش شما (#${orderShortId}):**\n• **مرحله فعلی:** «${status}»${trackingInfo}\n• سفارش‌ها معمولاً ظرف ۱ روز کاری پس از تأیید پرداخت ارسال شده و طی ۱ تا ۷ روز کاری تحویل می‌شوند. برای مشاهده جزئیات کامل، صفحه سفارش را باز کنید.`;
      return NextResponse.json({
        reply,
        recommendations: [],
        relatedRoutes,
        meta: { route, source: "mongodb", provider: "database-grounded", cache: "bypass", personalized: true },
      });
    }

    await dbConnect();
    const storeKnowledge = await loadStoreKnowledgeFromDatabase();
    const liveStoreKnowledge = formatStoreKnowledge(storeKnowledge);
    const cacheModel = getAssistantCacheModel();
    const cacheKey = semanticCacheKey(`${route}:${cleanQuery}`, intent, maxPrice, category);
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
      "محوصل",
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
        if (history.some((item) => String(item.content || "").includes(nameStr))) {
          score += 8;
        }

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
      route,
    });

    const responsePayload = {
      reply: modelReply || reply,
      recommendations,
      relatedRoutes,
      meta: {
        intent,
        route,
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
