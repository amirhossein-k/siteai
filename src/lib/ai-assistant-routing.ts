export type AssistantRoute =
  | "greeting"
  | "product"
  | "navigation"
  | "shipping"
  | "policy"
  | "order"
  | "payment"
  | "account"
  | "out_of_scope";

export interface RouteLink { label: string; href: string; }

export const VERIFIED_ROUTE_LINKS: RouteLink[] = [
  { label: "محصولات", href: "/products" },
  { label: "سبد خرید", href: "/cart" },
  { label: "سفارش‌ها", href: "/orders" },
  { label: "پروفایل و حساب کاربری", href: "/profile" },
  { label: "علاقه‌مندی‌ها", href: "/wishlist" },
  { label: "کدهای تخفیف", href: "/coupons" },
  { label: "اعلان‌ها", href: "/notifications" },
  { label: "پشتیبانی", href: "/support" },
  { label: "سوالات متداول", href: "/faq" },
  { label: "قوانین و مقررات", href: "/terms" },
];

function normalizePersianQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ۀ/g, "ه")
    .replace(/\u200c/g, " ");
}

const shippingContext =
  /(تحویل|مرسوله|پست|پستی|رهگیری|ردگیری|گیرنده|صورتحساب|فاکتور|صاحب حساب|محل کار)/;
const orderContext = /(سفارش|خریدم|مرسوله|بسته)/;
const deliveryStatusContext =
  /(کجاست|چه وقت|کی میرس|کی می‌رس|کی می رس|به دستم|وضعیت|پیگیری|رهگیری|ردگیری|تحویل)/;
const addressDetailContext =
  /(آدرس|نشانی|گیرنده|نام خودم|اسم خودم|نام صاحب حساب|اسم صاحب حساب|محل کار|محل دیگری|شخص دیگر|صورتحساب|فاکتور)/;
const themeContext = /(تم|حالت(?: نمایش)?|حالت رنگ|ظاهر|پوسته)/;
const themeMode = /(روشن|تاریک|سفید|مشکی|دارک|لایت|dark|light|عوض|تغییر)/i;

export function isThemeQuestion(query: string): boolean {
  const q = normalizePersianQuery(query);
  return themeContext.test(q) && themeMode.test(q);
}

export function isUndocumentedAddressPolicyQuestion(query: string): boolean {
  const q = normalizePersianQuery(query);
  return (
    addressDetailContext.test(q) &&
    /(باید|لازمه|ضروری|میشه|می\s*شه|امکان|فرق|متفاوت|تغییر|عوض|بعد از ثبت|به اسم)/.test(q) &&
    (shippingContext.test(q) || orderContext.test(q))
  );
}

export function routeAssistantQuestion(query: string): AssistantRoute {
  const q = normalizePersianQuery(query);
  if (/^(سلام|درود|hi|hello|hey|وقت بخیر|خوبی)[!！؟? .]*$/i.test(q)) return "greeting";
  if (/(مرجوع|مرجوعی|بازگشت کالا|تعویض|شرایط بازگشت|ضمانت بازگشت|گارانتی|refund|return)/i.test(q)) return "policy";
  if (orderContext.test(q) && deliveryStatusContext.test(q)) return "order";
  if (
    /(زمان ارسال|چند روز.*(ارسال|تحویل|سفارش)|هزینه ارسال|هزینهٔ ارسال|روش ارسال|ارسال رایگان|مقصد ارسال|تحویل سفارش|تحویل کالا|ارسال کالا|ارسال محصول|آدرس پستی|آدرس تحویل)/.test(q) ||
    (addressDetailContext.test(q) && (shippingContext.test(q) || orderContext.test(q)))
  ) return "shipping";
  if (/(سفارشم|سفارش من|پیگیری سفارش|وضعیت سفارش|سفارشم کجاست|کد رهگیری)/.test(q)) return "order";
  if (/(پرداخت من|پرداخت ناموفق|پرداخت موفق|زرین|درگاه|تراکنش|رسید پرداخت)/.test(q)) return "payment";
  if (/(ورود|وارد|لاگین|ثبت.?نام|رمز|پروفایل|حساب|علاقه.?مندی|اعلان|سبد خرید|پشتیبانی|سوالات متداول|قوانین)/.test(q)) return "account";
  if (/(محصول|کالا|خرید|قیمت|تخفیف|پرفروش|دسته|برند|موجود|مقایسه|هدفون|پیراهن|ماگ|پیشنهاد)/.test(q)) return "product";
  if (
    /(سایت|کجا|بخش|صفحه|لینک)/.test(q) ||
    /(چطور|چگونه).*(وارد|فعال|تغییر|پیدا|باز|استفاده|کار)/.test(q)
  ) return "navigation";
  return "out_of_scope";
}

export function linksForRoute(route: AssistantRoute): RouteLink[] {
  const map: Record<AssistantRoute, string[]> = {
    greeting: [],
    product: ["محصولات"],
    navigation: ["محصولات", "سفارش‌ها", "پروفایل و حساب کاربری"],
    shipping: ["سفارش‌ها", "سوالات متداول", "پشتیبانی"],
    policy: ["قوانین و مقررات", "سوالات متداول", "پشتیبانی"],
    order: ["سفارش‌ها", "پشتیبانی"],
    payment: ["سفارش‌ها", "پشتیبانی"],
    account: ["پروفایل و حساب کاربری", "سفارش‌ها", "سوالات متداول"],
    out_of_scope: [],
  };
  return VERIFIED_ROUTE_LINKS.filter((link) => map[route].includes(link.label));
}
