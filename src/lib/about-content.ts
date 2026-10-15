/**
 * About Us content (storefront /about page).
 *
 * SINGLE SOURCE OF TRUTH for the About page — the hero, mission, story,
 * highlights, commitments, values, the "how ordering works" steps and the CTA
 * all read from here.
 *
 * CONTENT POLICY (strict): every statement below is either (a) verified
 * behaviour in THIS codebase, or (b) owner-approved policy already published
 * on the FAQ (src/lib/faq-content.ts) and Terms (src/lib/terms-content.ts)
 * pages. Nothing is invented.
 *
 * The reference page (github.com/amirhossein-k/design-aboutt) supplied the
 * LAYOUT and visual hierarchy only. Its fabricated content was deliberately
 * NOT carried over — no order/customer/product/city counts, no founding-year
 * timeline, no team members, no customer testimonials, no "24/7 support", no
 * SSL/authenticity-guarantee marketing claims. See the session report.
 *
 * Pure data module (no imports, no React, no DB) so it is safe to import from
 * the server page and any future client island.
 */

export type AboutIconId =
  | "truck"
  | "rotateCcw"
  | "shieldCheck"
  | "messageSquare"
  | "badgeCheck"
  | "package"
  | "tag"
  | "sparkles"
  | "headphones"
  | "fileText"
  | "shoppingBag"
  | "heart";

export interface AboutHero {
  badge: string;
  title: string;
  lead: string;
}

export interface AboutHighlight {
  icon: AboutIconId;
  label: string;
}

export interface AboutCard {
  icon: AboutIconId;
  title: string;
  description: string;
  /** Optional internal link (used by the «شفافیت قوانین» value card). */
  href?: string;
  hrefLabel?: string;
}

export interface AboutStep {
  title: string;
  description: string;
}

export interface AboutLink {
  icon: AboutIconId;
  title: string;
  description: string;
  href: string;
}

export const ABOUT_HERO: AboutHero = {
  badge: "با مارلو شاپ آشنا شوید",
  title: "درباره مارلو شاپ",
  lead: "مارلو شاپ یک فروشگاه اینترنتی است که با هدف ارائه محصولات باکیفیت و قیمت مناسب فعالیت می‌کند و تلاش می‌کند خرید آنلاین را برای شما ساده، امن و قابل‌اعتماد کند.",
};

/** The gradient mission band (mirrors the reference's mission strip). */
export const ABOUT_MISSION =
  "مأموریت ما: ارائه محصولات اصل و باکیفیت، ارسال سریع و تجربه‌ای که بتوانید به آن اعتماد کنید.";

export const ABOUT_STORY: string[] = [
  "مارلو شاپ با این هدف راه‌اندازی شد که خرید آنلاین را به تجربه‌ای ساده، سریع و قابل‌اعتماد تبدیل کند. تمرکز ما بر سه چیز است: کیفیت محصول، سادگی مسیر خرید و راحتی پیگیری سفارش.",
  "ما محصولات اصل و باکیفیت را از تأمین‌کنندگان معتبر عرضه می‌کنیم و پیش از ارسال، محصولات را بررسی می‌کنیم تا مطمئن شویم همان چیزی که سفارش داده‌اید به دستتان می‌رسد.",
  "از انتخاب محصول و پرداخت امن تا ارسال سریع، اطلاع‌رسانی با پیامک و پشتیبانی درون‌برنامه‌ای، تلاش می‌کنیم هر مرحله از خرید شما روشن و راحت باشد.",
];

/** Short verified facts (replaces the reference's invented milestone numbers). */
export const ABOUT_HIGHLIGHTS: AboutHighlight[] = [
  { icon: "truck", label: "ارسال به سراسر ایران" },
  { icon: "rotateCcw", label: "مرجوعی تا ۲ روز" },
  { icon: "shieldCheck", label: "پرداخت امن زرین‌پال" },
  { icon: "headphones", label: "پشتیبانی درون‌برنامه‌ای" },
];

/** The dark band (replaces the reference's fabricated statistics section). */
export const ABOUT_COMMITMENTS: AboutCard[] = [
  {
    icon: "truck",
    title: "ارسال سریع",
    description:
      "سفارش‌ها معمولاً ظرف یک روز کاری پس از تأیید پرداخت آماده و ارسال می‌شوند و زمان تحویل بسته به مقصد، بین ۱ تا ۷ روز کاری است.",
  },
  {
    icon: "rotateCcw",
    title: "بازگشت آسان کالا",
    description:
      "در صورت عدم استفاده، تا ۲ روز پس از دریافت کالا می‌توانید درخواست مرجوعی ثبت کنید. اگر کالا معیوب یا اشتباه باشد، هزینه ارسال مرجوعی بر عهده ماست.",
  },
  {
    icon: "shieldCheck",
    title: "پرداخت امن",
    description:
      "پرداخت آنلاین از طریق درگاه زرین‌پال انجام می‌شود و اطلاعات کامل کارت بانکی شما در فروشگاه ذخیره نمی‌شود.",
  },
  {
    icon: "messageSquare",
    title: "اطلاع‌رسانی گام‌به‌گام",
    description:
      "پس از ثبت سفارش، پیامک تأییدیه همراه با شماره سفارش و پس از ارسال، کد رهگیری برای شما ارسال می‌شود.",
  },
];

export const ABOUT_VALUES: AboutCard[] = [
  {
    icon: "badgeCheck",
    title: "کیفیت و اصالت",
    description:
      "محصولات اصل و باکیفیت را از تأمین‌کنندگان معتبر عرضه می‌کنیم و پیش از ارسال، آن‌ها را بررسی می‌کنیم.",
  },
  {
    icon: "package",
    title: "بسته‌بندی ایمن",
    description:
      "محصولات در بسته‌بندی مقاوم و استاندارد ارسال می‌شوند و اقلام حساس با بسته‌بندی محافظ اضافه ارسال می‌گردند.",
  },
  {
    icon: "tag",
    title: "قیمت مناسب",
    description:
      "تلاش می‌کنیم محصولات را با قیمت مناسب ارائه کنیم و در کنار آن، کدهای تخفیف و پیشنهادهای ویژه‌ای برای شما در نظر بگیریم.",
  },
  {
    icon: "sparkles",
    title: "خرید ساده",
    description:
      "از جست‌وجو و انتخاب محصول تا پرداخت و پیگیری سفارش، مسیر خرید را ساده و روشن نگه داشته‌ایم.",
  },
  {
    icon: "headphones",
    title: "پشتیبانی پاسخگو",
    description:
      "تیم پشتیبانی از طریق صفحه پشتیبانی فروشگاه، شنبه تا پنج‌شنبه از ساعت ۹ تا ۱۸ پاسخگوی شماست.",
  },
  {
    icon: "fileText",
    title: "شفافیت قوانین",
    description:
      "شرایط خرید، ارسال، بازگشت کالا و قوانین فروشگاه به‌صورت شفاف در دسترس شماست.",
    href: "/terms",
    hrefLabel: "مطالعه قوانین و مقررات",
  },
];

/** Replaces the reference's fabricated founding-history timeline. */
export const ABOUT_STEPS: AboutStep[] = [
  {
    title: "انتخاب محصول",
    description: "محصول مورد نظر خود را انتخاب و به سبد خرید اضافه می‌کنید.",
  },
  {
    title: "تکمیل اطلاعات و پرداخت",
    description:
      "اطلاعات ارسال را تکمیل و روش پرداخت (آنلاین زرین‌پال یا پرداخت در محل) را انتخاب می‌کنید.",
  },
  {
    title: "تأیید سفارش",
    description:
      "پس از ثبت موفق سفارش، پیامک تأییدیه همراه با شماره سفارش برای شما ارسال می‌شود.",
  },
  {
    title: "ارسال و رهگیری",
    description:
      "سفارش آماده و ارسال می‌شود و کد رهگیری از طریق پیامک اطلاع‌رسانی می‌گردد.",
  },
  {
    title: "پیگیری و پشتیبانی",
    description:
      "وضعیت سفارش را در حساب کاربری پیگیری می‌کنید و در صورت نیاز از صفحه پشتیبانی با ما در ارتباط هستید.",
  },
];

export const ABOUT_CTA = {
  title: "خرید خود را از مارلو شاپ شروع کنید",
  description:
    "محصولات باکیفیت، ارسال سریع و پشتیبانی پاسخگو در انتظار شماست.",
  primary: { label: "مشاهده محصولات", href: "/products" },
  secondary: { label: "گفتگو با پشتیبانی", href: "/support" },
};

/** Real internal destinations only (replaces the reference's dead links). */
export const ABOUT_LINKS: AboutLink[] = [
  {
    icon: "messageSquare",
    title: "سوالات متداول",
    description: "پاسخ پرسش‌های رایج درباره سفارش، پرداخت، ارسال و بازگشت کالا.",
    href: "/faq",
  },
  {
    icon: "fileText",
    title: "قوانین و مقررات",
    description: "شرایط عضویت، پرداخت، ارسال، مرجوعی و حریم خصوصی فروشگاه.",
    href: "/terms",
  },
  {
    icon: "headphones",
    title: "پشتیبانی",
    description: "در صورت نیاز، گفتگوی جدیدی با تیم پشتیبانی آغاز کنید.",
    href: "/support",
  },
];
