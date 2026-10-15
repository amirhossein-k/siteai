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

export function routeAssistantQuestion(query: string): AssistantRoute {
  const q = query.trim().toLowerCase();
  if (/^(سلام|درود|hi|hello|hey|وقت بخیر|خوبی)[!！؟? .]*$/i.test(q)) return "greeting";
  if (/(زمان ارسال|چند روز|هزینه ارسال|هزینهٔ ارسال|روش ارسال|ارسال رایگان|مقصد ارسال|تحویل)/.test(q)) return "shipping";
  if (/(مرجوع|مرجوعی|بازگشت کالا|تعویض|شرایط بازگشت|ضمانت بازگشت|refund|return)/i.test(q)) return "policy";
  if (/(سفارشم|سفارش من|پیگیری سفارش|وضعیت سفارش|سفارشم کجاست|کد رهگیری)/.test(q)) return "order";
  if (/(پرداخت من|پرداخت ناموفق|پرداخت موفق|زرین|درگاه|تراکنش|رسید پرداخت)/.test(q)) return "payment";
  if (/(ورود|ثبت.?نام|رمز|پروفایل|حساب کاربری|آدرس|علاقه.?مندی|اعلان|سبد خرید|پشتیبانی|سوالات متداول|قوانین)/.test(q)) return "account";
  if (/(محصول|کالا|خرید|قیمت|تخفیف|پرفروش|دسته|برند|موجود|مقایسه|هدفون|پیراهن|ماگ|پیشنهاد)/.test(q)) return "product";
  if (/(سایت|کجا|چطور|چگونه|بخش|صفحه|لینک)/.test(q)) return "navigation";
  return "out_of_scope";
}

export function linksForRoute(route: AssistantRoute): RouteLink[] {
  const map: Record<AssistantRoute, string[]> = {
    greeting: [], product: ["محصولات"], navigation: ["محصولات", "سفارش‌ها", "پروفایل و حساب کاربری"],
    shipping: ["سفارش‌ها", "پشتیبانی"], policy: ["قوانین و مقررات", "پشتیبانی"],
    order: ["سفارش‌ها", "پشتیبانی"], payment: ["سفارش‌ها", "پشتیبانی"], account: ["پروفایل و حساب کاربری", "سفارش‌ها"], out_of_scope: [],
  };
  return VERIFIED_ROUTE_LINKS.filter((link) => map[route].includes(link.label));
}
