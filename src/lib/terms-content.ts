/**
 * Terms & Conditions content (storefront /terms page).
 *
 * SINGLE SOURCE OF TRUTH for the Terms page — the visible sections, the
 * table of contents, the quick-facts strip and the server-rendered copy all
 * read from here, so they can never drift.
 *
 * ORIGIN: adapted from the owner-approved reference
 * (github.com/amirhossein-k/design-terms-and-conditionss, src/App.tsx). The
 * SECTION STRUCTURE and the policy wording follow that reference. Where its
 * generic template text conflicted with THIS codebase or with the
 * owner-approved FAQ (src/lib/faq-content.ts), it was reconciled — each such
 * reconciliation is marked with a `reconciled:` note:
 *
 *   - payment methods: only the ones the checkout actually implements are
 *     listed (online via Zarinpal + cash on delivery). The reference's
 *     «کیف پول مارلو شاپ» and «کارت به کارت» are NOT implemented and were
 *     removed (owner decision).
 *   - return window: 2 days, matching the owner-approved FAQ — the reference's
 *     7-day window is overridden.
 *   - delivery: 1–7 business days (owner-approved FAQ), not the reference's
 *     1–3; named couriers were dropped (no carrier integration in code).
 *   - VAT: the reference claimed prices include VAT, but this project stores
 *     no tax (see src/lib/reports.ts) — the claim was dropped.
 *   - email: the app sends only SMS (no customer email pipeline), so no email
 *     channel is promised.
 *   - refund: no fixed refund-processing SLA is published.
 *
 * Pure data module (no imports, no React, no DB) so it is safe to import from
 * both the server page and the client renderer.
 */

export type TermsIconId =
  | "scroll"
  | "user"
  | "cart"
  | "creditCard"
  | "truck"
  | "rotateCcw"
  | "shield"
  | "lock"
  | "copyright"
  | "ban"
  | "scale"
  | "phone";

export interface TermsSection {
  id: string;
  icon: TermsIconId;
  title: string;
  /** Optional intro paragraph, rendered as a highlighted callout. */
  content?: string;
  /** Optional checklist items. */
  items?: string[];
  /** Optional trailing call-to-action (real internal route only). */
  link?: { label: string; href: string };
}

export interface TermsQuickFact {
  icon: "truck" | "rotateCcw" | "shield";
  label: string;
  value: string;
}

/** Shown in the hero chip. */
export const TERMS_LAST_UPDATED = "مهر ۱۴۰۵";

/** Quick-facts strip under the hero (mirrors the reference's 3 stat cards). */
export const TERMS_QUICK_FACTS: TermsQuickFact[] = [
  { icon: "truck", label: "ارسال", value: "سراسر ایران" },
  { icon: "rotateCcw", label: "مرجوعی کالا", value: "۲ روز" },
  { icon: "shield", label: "پرداخت امن", value: "درگاه زرین‌پال" },
];

export const TERMS_SECTIONS: TermsSection[] = [
  {
    id: "intro",
    icon: "scroll",
    title: "مقدمه",
    content:
      "فروشگاه اینترنتی مارلو شاپ (marloo.shop) با هدف ارائه محصولات باکیفیت و قیمت مناسب فعالیت می‌کند. با استفاده از خدمات این فروشگاه، شما به‌عنوان کاربر می‌پذیرید که شرایط و قوانین زیر را مطالعه کرده و با آن‌ها موافقت کرده‌اید. مارلو شاپ حق دارد این قوانین را در هر زمان به‌روزرسانی کند؛ استفاده مستمر از سایت به‌منزله پذیرش تغییرات جدید است.",
  },
  {
    id: "membership",
    icon: "user",
    title: "شرایط عضویت",
    items: [
      "ثبت‌نام در سایت برای تمامی افراد حقیقی و حقوقی آزاد است.",
      "کاربر موظف است اطلاعات صحیح، کامل و به‌روز را هنگام ثبت‌نام وارد کند.",
      "مسئولیت حفاظت از نام کاربری و رمز عبور بر عهده کاربر است.",
      "مارلو شاپ می‌تواند در صورت نقض قوانین، حساب کاربری را تعلیق یا حذف کند.",
      "افراد زیر ۱۸ سال باید با اجازه و نظارت والدین از سایت استفاده کنند.",
    ],
  },
  {
    id: "ordering",
    icon: "cart",
    title: "فرآیند ثبت سفارش",
    items: [
      "کلیه سفارش‌ها پس از پرداخت موفق، نهایی تلقی می‌شوند.",
      "کالاهای موجود در سبد خرید تا زمان تکمیل پرداخت، رزرو نمی‌شوند.",
      // reconciled: تومان is the unit the storefront renders (formatPrice).
      "قیمت‌های درج‌شده در سایت به تومان است.",
      "مارلو شاپ در صورت ناموجود بودن کالا می‌تواند سفارش را لغو و مبلغ را عودت دهد.",
      "تغییر یا لغو سفارش پس از تأیید پرداخت، تابع قوانین بازگشت کالا است.",
      // reconciled: order-confirmation is sent by SMS (sms-order-events ORDER_CREATED).
      "پس از ثبت موفق سفارش، پیامک تأییدیه همراه با شماره سفارش به شماره موبایل ثبت‌شده ارسال می‌شود.",
    ],
  },
  {
    id: "payment",
    icon: "creditCard",
    title: "روش‌های پرداخت",
    content:
      "مارلو شاپ برای پرداخت آنلاین از درگاه امن زرین‌پال استفاده می‌کند و تمامی تراکنش‌ها از طریق درگاه بانکی رمزگذاری‌شده انجام می‌شوند. در صورت ناموفق بودن پرداخت آنلاین، سفارش تکمیل نمی‌شود و مبلغی از شما کسر نمی‌گردد؛ می‌توانید سفارش را دوباره پرداخت کنید.",
    // reconciled: only the two methods the checkout implements.
    items: [
      "پرداخت آنلاین از طریق درگاه زرین‌پال (تمام کارت‌های عضو شتاب)",
      "پرداخت در محل (پرداخت نقدی یا با کارت بانکی هنگام تحویل)",
    ],
  },
  {
    id: "shipping",
    icon: "truck",
    title: "ارسال و تحویل",
    // reconciled: generic carriers + 1–7 business days + SMS tracking.
    items: [
      "ارسال به سراسر ایران از طریق شرکت‌های پستی و حمل‌ونقل معتبر انجام می‌شود.",
      "هزینه ارسال، در صورت وجود، بر اساس شرایط سفارش و مقصد تعیین و هنگام تکمیل سفارش محاسبه می‌شود.",
      "سفارش‌ها معمولاً ظرف یک روز کاری پس از تأیید پرداخت آماده و ارسال می‌شوند.",
      "زمان تحویل بسته به مقصد، معمولاً بین ۱ تا ۷ روز کاری است.",
      "در ایام تعطیل و مناسبت‌های خاص، زمان ارسال ممکن است طولانی‌تر شود.",
      "کد رهگیری مرسوله از طریق پیامک برای شما ارسال می‌شود.",
    ],
  },
  {
    id: "returns",
    icon: "rotateCcw",
    title: "بازگشت و مرجوعی کالا",
    content:
      "مارلو شاپ امکان مرجوع کردن کالا را در شرایط زیر فراهم می‌کند:",
    // reconciled: 2-day window (owner decision), no refund SLA, no invented fees.
    items: [
      "مشتری تا ۲ روز پس از دریافت کالا، در صورت عدم استفاده، حق مرجوعی دارد.",
      "کالا باید در بسته‌بندی اصلی و بدون آسیب‌دیدگی بازگردانده شود.",
      "هزینه ارسال مرجوعی بر عهده مشتری است، مگر در موارد ارسال اشتباه یا معیوب بودن کالا که بر عهده مارلو شاپ است.",
      "کالاهای بهداشتی و آرایشی پس از باز شدن بسته‌بندی، محصولات دیجیتال، محصولات شخصی‌سازی‌شده و کالاهای فاسدشدنی قابل مرجوع نیستند.",
      "پس از تأیید مرجوعی و دریافت کالا، مبلغ به مشتری بازگردانده می‌شود.",
      "مراحل و آدرس مرجوعی از طریق حساب کاربری و پیامک اطلاع‌رسانی می‌شود.",
    ],
  },
  {
    id: "warranty",
    icon: "shield",
    title: "ضمانت و گارانتی",
    items: [
      "کالاهای دارای گارانتی، طبق شرایط گارانتی سازنده پشتیبانی می‌شوند.",
      "گارانتی شامل نقص‌های ذاتی محصول است، نه خرابی ناشی از استفاده نادرست.",
      "برای استفاده از گارانتی، ارائه مدارک خرید لازم است.",
      "محصولات بدون گارانتی، تحت پوشش خدمات پس از فروش سازنده قرار می‌گیرند.",
    ],
  },
  {
    id: "privacy",
    icon: "lock",
    title: "حریم خصوصی و امنیت",
    content:
      "مارلو شاپ به حریم خصوصی کاربران احترام می‌گذارد و اطلاعات شخصی شما را محرمانه نگه می‌دارد:",
    // reconciled: replaced the reference's unverifiable SSL claim with the
    // card-storage fact the app actually guarantees (see the FAQ).
    items: [
      "اطلاعات شخصی شما تنها برای پردازش سفارش و بهبود خدمات استفاده می‌شود.",
      "اطلاعات شما بدون رضایت به اشخاص ثالث فروخته یا واگذار نمی‌شود.",
      "اطلاعات کامل کارت بانکی شما در فروشگاه ذخیره نمی‌شود.",
      "کاربر می‌تواند در هر زمان درخواست حذف اطلاعات خود را ارائه دهد.",
    ],
  },
  {
    id: "intellectual",
    icon: "copyright",
    title: "مالکیت معنوی",
    items: [
      "تمامی محتوا، تصاویر، لوگو و برند مارلو شاپ متعلق به این فروشگاه است.",
      "هرگونه کپی‌برداری، توزیع یا استفاده تجاری بدون مجوز ممنوع است.",
      "نظرات و بررسی‌های کاربران پس از ثبت، متعلق به مارلو شاپ محسوب می‌شوند.",
      "استفاده از لوگو و نام تجاری مارلو شاپ برای اهداف تبلیغاتی نیازمند مجوز کتبی است.",
    ],
  },
  {
    id: "prohibited",
    icon: "ban",
    title: "فعالیت‌های ممنوع",
    items: [
      "استفاده از سایت برای فعالیت‌های غیرقانونی یا تقلب‌آمیز",
      "ایجاد حساب‌های جعلی یا ارائه اطلاعات نادرست",
      "تلاش برای دسترسی غیرمجاز به سیستم‌ها یا داده‌های سایت",
      "ارسال اسپم، محتوای مضر یا اخلال در کار سایت",
      "سوءاستفاده از کدهای تخفیف یا برنامه‌های تشویقی",
      "فروش مجدد محصولات بدون مجوز فروشگاه",
    ],
  },
  {
    id: "dispute",
    icon: "scale",
    title: "حل اختلاف",
    content:
      "در صورت بروز هرگونه اختلاف بین کاربر و مارلو شاپ، طرفین ابتدا از طریق مذاکره مستقیم اقدام به رفع اختلاف می‌کنند. در صورت عدم حل اختلاف، موضوع از طریق سازمان حمایت از مصرف‌کنندگان یا مراجع قانونی ذی‌صلاح در جمهوری اسلامی ایران پیگیری خواهد شد. قوانین حاکم بر این توافق‌نامه، قوانین جمهوری اسلامی ایران است.",
  },
  {
    id: "contact",
    icon: "phone",
    title: "تماس با ما",
    content:
      "در صورت داشتن هرگونه سؤال یا ابهام درباره قوانین و مقررات، می‌توانید با تیم پشتیبانی مارلو شاپ در ارتباط باشید:",
    items: [
      "ایمیل: support@marloo.shop",
      "وب‌سایت: marloo.shop",
      "ساعات پشتیبانی: شنبه تا پنج‌شنبه، ۹ تا ۱۸",
    ],
    // Real internal route — the app's in-app support desk.
    link: { label: "گفتگو با پشتیبانی", href: "/support" },
  },
];
