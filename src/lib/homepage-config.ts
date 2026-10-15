/**
 * Session 50 — Static homepage configuration (Upgraded for SEO & Conversion).
 *
 * All homepage copy/art lives here so the homepage itself stays a thin
 * composition of sections. Every link points to a real route and every price
 * shown comes from the existing products API.
 */
import { APP_NAME } from "@/lib/constants";

export interface HomepageHeroSlide {
  id: string;
  /** Big Persian headline */
  title: string;
  subtitle: string;
  cta: { label: string; href: string };
  /** Tailwind gradient classes for the slide background art */
  gradient: string;
  /** Small decorative chip text (e.g. a tagline above the title) */
  tagline?: string;
}

export interface HomepageCampaignBanner {
  title: string;
  subtitle: string;
  cta: { label: string; href: string };
  gradient: string;
}

export interface HomepageGiftCollection {
  id: string;
  title: string;
  description: string;
  cta: { label: string; href: string };
  gradient: string;
}

export const homepageConfig = {
  heroSlides: [
    {
      id: "welcome",
      tagline: `${APP_NAME} — خرید هوشمند، سریع و مطمئن`,
      title: "بهترین انتخاب‌ها با قیمت واقعی و ضمانت اصالت",
      subtitle:
        "هزاران کالای منتخب از فروشندگان تاییدشده با ارسال سریع به سراسر کشور و پشتیبانی ۲۴ ساعته. با دستیار هوشمند مارلو، دقیقاً همان چیزی را بخرید که نیاز دارید.",
      cta: { label: "مشاهده و خرید محصولات", href: "/products" },
      gradient: "from-zinc-900 via-slate-800 to-indigo-950",
    },
    {
      id: "newest",
      tagline: "تازه‌های مارلو شاپ",
      title: "کالکشن جدیدترین محصولات فصل",
      subtitle:
        "هر روز محصولات تازه از برندهای معتبر اضافه می‌شوند. اولین نفری باشید که جدیدترین ترندها را با قیمت استثنایی بررسی می‌کنید.",
      cta: { label: "مشاهده جدیدترین‌ها", href: "/products?sort=newest" },
      gradient: "from-emerald-900 via-emerald-800 to-teal-700",
    },
    {
      id: "coupons",
      tagline: "جشنواره تخفیف‌های هوشمند",
      title: "کدهای تخفیف ویژه برای خرید اقتصادی‌تر",
      subtitle:
        "کدهای تخفیف فعال فروشگاه را یکجا ببینید و در مرحله تسویه‌حساب، بدون هیچ کارمزد اضافی روی سبد خریدتان اعمال کنید.",
      cta: { label: "دریافت کد تخفیف", href: "/coupons" },
      gradient: "from-rose-900 via-rose-800 to-pink-700",
    },
  ] satisfies HomepageHeroSlide[],

  campaignBanner: {
    title: "پیشنهادهای شگفت‌انگیز و پرفروش هفته",
    subtitle:
      "منتخبی از محبوب‌ترین کالاهای مارلو شاپ با بیشترین رضایت خریداران و ارسال فوری.",
    cta: { label: "مشاهده پرفروش‌ترین‌ها", href: "/products?sort=best_selling" },
    gradient: "from-indigo-900 via-indigo-800 to-violet-700",
  } satisfies HomepageCampaignBanner,

  giftCollections: [
    {
      id: "gift-loved-ones",
      title: "کالکشن هدیه برای عزیزان",
      description:
        "بهترین ایده‌های هدیه با بسته‌بندی شیک و ارسال سریع برای غافلگیر کردن کسانی که دوستشان دارید.",
      cta: { label: "انتخاب هدیه", href: "/products" },
      gradient: "from-rose-900 via-rose-800 to-red-700",
    },
    {
      id: "gift-home",
      title: "زیبایی و آرامش برای خانه",
      description:
        "مجموعه‌ای از کاربردی‌ترین و شیک‌ترین لوازم خانه با کیفیت تضمینی.",
      cta: { label: "خرید لوازم خانه", href: "/products" },
      gradient: "from-amber-800 via-amber-700 to-yellow-600",
    },
    {
      id: "gift-yourself",
      title: "کالکشن پریمیوم و خاص",
      description:
        "چون لایق بهترین کیفیت هستید؛ گلچینی از محصولات رده‌بالا و اورجینال فروشگاه.",
      cta: { label: "مشاهده کالکشن پریمیوم", href: "/products?sort=price_desc" },
      gradient: "from-slate-800 via-slate-700 to-zinc-600",
    },
  ] satisfies HomepageGiftCollection[],
};
