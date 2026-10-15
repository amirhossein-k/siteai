/**
 * FAQ content (storefront /faq page).
 *
 * SINGLE SOURCE OF TRUTH for the FAQ page — the visible list, the category
 * counts and the FAQPage JSON-LD all read from here, so they can never drift.
 *
 * CONTENT POLICY: answers fall into two groups.
 *   1. Behaviour verifiable in THIS codebase (routes, models and UI copy) —
 *      never contradicted.
 *   2. Store policy that the product owner has EXPLICITLY approved: the
 *      2-day return window, non-returnable product classes, the return
 *      process, delivery timeframes, minimum purchase and order confirmation.
 *      These are marked in the code with an `approved:` note so a future
 *      editor knows they came from the owner, not from the code.
 * Nothing beyond that is invented — no fee amounts, no refund-processing SLA,
 * no phone number and no satisfaction statistic. Channels that do not exist
 * in the app (e.g. customer email) are not promised here.
 *
 * NOTE (owner decision): the return window is deliberately 2 days — it
 * overrides any earlier 7-day window, including the one the Terms page
 * reference used; src/lib/terms-content.ts is aligned to the same 2 days.
 *
 * Pure data module (no imports, no DB, no client/server-only APIs) so it is
 * safe to import from both the server page and the client renderer.
 */

export type FaqCategoryId =
  | "order"
  | "payment"
  | "discount"
  | "shipping"
  | "account"
  | "product"
  | "support"
  | "supplier";

export interface FaqCategory {
  id: FaqCategoryId;
  /** Persian label shown in the sidebar filter. */
  label: string;
}

export interface FaqItem {
  id: string;
  category: FaqCategoryId;
  question: string;
  /**
   * Answer text. Lines are separated by "\n"; a line starting with "• " is
   * rendered as a bullet-list item.
   */
  answer: string;
  /** Editorial highlight — surfaced in the «پرتکرارترین سوالات» grid. */
  popular?: boolean;
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  { id: "order", label: "ثبت سفارش" },
  { id: "payment", label: "پرداخت" },
  { id: "discount", label: "تخفیف و کد" },
  { id: "shipping", label: "ارسال و پیگیری" },
  { id: "account", label: "حساب کاربری" },
  { id: "product", label: "محصولات" },
  { id: "support", label: "پشتیبانی" },
  { id: "supplier", label: "فروشندگی" },
];

export const FAQ_ITEMS: FaqItem[] = [
  // ── ثبت سفارش ──────────────────────────────────────────────────────────
  {
    id: "how-to-order",
    category: "order",
    popular: true,
    question: "چطور می‌توانم سفارش ثبت کنم؟",
    answer:
      "محصول مورد نظر را انتخاب و به سبد خرید اضافه کنید، سپس در صفحه پرداخت اطلاعات ارسال را تکمیل کنید، روش پرداخت را انتخاب کرده و سفارش را نهایی کنید.",
  },
  {
    id: "order-requires-account",
    category: "order",
    question: "برای ثبت سفارش باید حساب کاربری داشته باشم؟",
    answer:
      "بله. برای نهایی کردن سفارش باید وارد حساب کاربری خود شوید. اگر حساب ندارید می‌توانید ثبت‌نام کنید و سپس سفارش را تکمیل کنید.",
  },
  {
    id: "after-order",
    category: "order",
    popular: true,
    question: "پس از ثبت سفارش چه اتفاقی می‌افتد؟",
    answer:
      "وضعیت سفارش شما با پیشرفت مراحل کار تغییر می‌کند و می‌توانید آن را در بخش «سفارشات» حساب کاربری خود پیگیری کنید.",
  },
  {
    id: "cancel-order",
    category: "order",
    question: "آیا می‌توانم سفارشم را لغو کنم؟",
    answer:
      "تا زمانی که سفارش در وضعیت «در انتظار پرداخت» باشد می‌توانید آن را از صفحه جزئیات سفارش لغو کنید.",
  },
  {
    id: "order-confirmation",
    category: "order",
    popular: true,
    // approved: owner-approved order-confirmation answer.
    question: "از کجا بفهمم سفارشم تأیید شده است؟",
    answer:
      "پس از ثبت موفق سفارش، یک پیامک تأییدیه همراه با شماره سفارش برای شما ارسال می‌شود. همچنین می‌توانید وضعیت سفارش خود را در بخش «سفارشات» حساب کاربری ببینید.",
  },
  {
    id: "minimum-purchase",
    category: "order",
    // approved: owner-approved answer (no minimum amount).
    question: "آیا حداقل مبلغی برای خرید وجود دارد؟",
    answer:
      "خیر، حداقل مبلغی برای خرید وجود ندارد. مشمول بودن ارسال رایگان ممکن است به قوانین ارسال قابل اعمال بستگی داشته باشد.",
  },
  {
    id: "order-for-someone-else",
    category: "order",
    // approved: owner-approved answer.
    question: "آیا می‌توانم برای شخص دیگری سفارش ثبت کنم؟",
    answer:
      "بله. در هنگام ثبت سفارش می‌توانید نام گیرنده و آدرس تحویل شخص دیگری را وارد کنید.",
  },

  // ── پرداخت ──────────────────────────────────────────────────────────────
  {
    id: "payment-methods",
    category: "payment",
    popular: true,
    question: "چه روش‌های پرداختی در دسترس است؟",
    answer:
      "دو روش پرداخت در دسترس است:\n• پرداخت آنلاین از طریق درگاه زرین‌پال\n• پرداخت نقدی (پرداخت در محل با کارت بانکی یا پول نقد)",
  },
  {
    id: "payment-safe",
    category: "payment",
    popular: true,
    question: "آیا پرداخت آنلاین امن است؟",
    answer:
      "پرداخت آنلاین از طریق درگاه زرین‌پال انجام می‌شود. فروشگاه اطلاعات کامل کارت بانکی شما را ذخیره نمی‌کند و تنها شناسه پیگیری تراکنش و چهار رقم آخر کارت برای پیگیری سفارش نگه داشته می‌شود.",
  },
  {
    id: "payment-failed",
    category: "payment",
    question: "اگر پرداخت من ناموفق بود چه می‌شود؟",
    answer:
      "در صورت ناموفق بودن پرداخت، سفارش تکمیل نمی‌شود و مبلغی از شما دریافت نمی‌گردد. می‌توانید سفارش را دوباره پرداخت کنید.",
  },

  // ── تخفیف و کد ──────────────────────────────────────────────────────────
  {
    id: "how-to-use-coupon",
    category: "discount",
    popular: true,
    question: "چطور از کد تخفیف استفاده کنم؟",
    answer:
      "در صفحه پرداخت کادر «کد تخفیف» را پر کنید و دکمه اعمال را بزنید؛ مبلغ تخفیف از جمع سفارش کسر می‌شود.",
  },
  {
    id: "one-coupon-per-order",
    category: "discount",
    question: "آیا می‌توانم چند کد تخفیف را همزمان استفاده کنم؟",
    answer: "خیر. در هر سفارش فقط یک کد تخفیف قابل استفاده است.",
  },
  {
    id: "coupon-not-applied",
    category: "discount",
    question: "چرا کد تخفیف من اعمال نمی‌شود؟",
    answer:
      "دلایل رایج عبارت‌اند از:\n• کد منقضی یا غیرفعال شده است\n• سهمیه استفاده از کد تمام شده است\n• مبلغ سبد خرید به حداقل تعیین‌شده برای این کد نرسیده است\n• این کد برای حساب شما در نظر گرفته نشده است",
  },
  {
    id: "where-public-coupons",
    category: "discount",
    question: "کدهای تخفیف عمومی را از کجا ببینم؟",
    answer:
      "کدهای تخفیف فعال در صفحه «کدهای تخفیف» نمایش داده می‌شوند؛ می‌توانید هر کد را کپی کرده و در صفحه پرداخت استفاده کنید.",
  },

  // ── ارسال و پیگیری ──────────────────────────────────────────────────────
  {
    id: "track-order",
    category: "shipping",
    popular: true,
    // approved: owner-approved wording (SMS channel only — the app sends no
    // customer email, so no email channel is promised here).
    question: "چطور سفارشم را پیگیری کنم؟",
    answer:
      "پس از ارسال سفارش، اطلاعات رهگیری از طریق پیامک برای شما ارسال می‌شود. همچنین می‌توانید جزئیات سفارش را در بخش «سفارشات» حساب کاربری خود ببینید.",
  },
  {
    id: "delivery-time",
    category: "shipping",
    popular: true,
    // approved: owner-approved delivery window (1–7 business days).
    question: "ارسال کالا چقدر زمان می‌برد؟",
    answer:
      "سفارش‌ها معمولاً ظرف یک روز کاری پس از تأیید پرداخت آماده و ارسال می‌شوند. زمان تحویل بسته به مقصد، معمولاً بین ۱ تا ۷ روز کاری است.",
  },
  {
    id: "tracking-code",
    category: "shipping",
    question: "کد رهگیری مرسوله را از کجا ببینم؟",
    answer:
      "پس از ارسال سفارش، اطلاعات ارسال و کد رهگیری در صفحه جزئیات همان سفارش نمایش داده می‌شود.",
  },
  {
    id: "order-statuses",
    category: "shipping",
    question: "وضعیت‌های سفارش چه معنایی دارند؟",
    answer:
      "وضعیت هر سفارش یکی از این مرحله‌ها است:\n• در انتظار پرداخت\n• در حال پردازش\n• تأییدشده\n• ارسال‌شده\n• تحویل‌شده\n• لغوشده",
  },

  // ── حساب کاربری ─────────────────────────────────────────────────────────
  {
    id: "how-to-login",
    category: "account",
    popular: true,
    question: "چطور وارد حساب کاربری شوم؟",
    answer:
      "با شماره موبایل و رمز عبور، یا با کد یک‌بارمصرف که به موبایل شما ارسال می‌شود، می‌توانید وارد حساب خود شوید.",
  },
  {
    id: "forgot-password",
    category: "account",
    question: "رمز عبورم را فراموش کرده‌ام؛ چه کنم؟",
    answer:
      "در صفحه ورود گزینه «رمز عبور را فراموش کرده‌اید؟» را انتخاب کنید و مراحل بازیابی را با شماره موبایل خود انجام دهید.",
  },
  {
    id: "edit-profile",
    category: "account",
    question: "اطلاعات حسابم را کجا ویرایش کنم؟",
    answer:
      "از صفحه «پروفایل» می‌توانید اطلاعات حساب کاربری خود را مشاهده و ویرایش کنید.",
  },
  {
    id: "privacy-of-account",
    category: "account",
    question: "اطلاعات من چگونه نگه‌داری می‌شود؟",
    answer:
      "اطلاعات حساب شما برای پردازش سفارش‌ها استفاده می‌شود. توجه داشته باشید اطلاعات کامل کارت بانکی در فروشگاه ذخیره نمی‌شود.",
  },

  // ── محصولات ─────────────────────────────────────────────────────────────
  {
    id: "find-products",
    category: "product",
    popular: true,
    question: "چطور محصول مورد نظرم را پیدا کنم؟",
    answer:
      "در صفحه «محصولات» می‌توانید با جست‌وجو، انتخاب دسته‌بندی و برند، و مرتب‌سازی، محصول مورد نظر خود را پیدا کنید.",
  },
  {
    id: "product-rating",
    category: "product",
    question: "امتیاز محصولات بر چه اساسی محاسبه می‌شود؟",
    answer:
      "امتیاز هر محصول بر اساس دیدگاه‌های تأییدشده کاربران محاسبه می‌شود. تا زمانی که دیدگاهی برای محصول تأیید نشده باشد، «بدون امتیاز» نمایش داده می‌شود.",
  },
  {
    id: "return-policy",
    category: "product",
    // approved: owner-approved 2-day return window (overrides the previous
    // 7-day window).
    question: "آیا می‌توانم محصول را مرجوع کنم؟",
    answer:
      "بله. در صورتی که محصول استفاده نشده باشد، می‌توانید تا ۲ روز پس از دریافت کالا درخواست مرجوعی ثبت کنید.",
  },
  {
    id: "non-returnable-products",
    category: "product",
    // approved: owner-approved list of non-returnable product classes.
    question: "چه محصولاتی قابل مرجوع کردن نیستند؟",
    answer:
      "برخی محصولات به دلایل بهداشتی یا ماهیت خاص قابل مرجوع کردن نیستند:\n• محصولات بهداشتی و آرایشی پس از باز شدن بسته‌بندی\n• محصولات دیجیتال و لایسنس‌های نرم‌افزاری\n• محصولاتی که به سفارش مشتری شخصی‌سازی شده‌اند\n• محصولات فاسدشدنی",
  },
  {
    id: "defective-product",
    category: "product",
    popular: true,
    // approved: owner-approved defective/incorrect-item answer.
    question: "اگر محصول معیوب یا اشتباه باشد چه کنم؟",
    answer:
      "در این صورت بلافاصله با پشتیبانی تماس بگیرید. در چنین مواردی هزینه ارسال مرجوعی بر عهده مارلو شاپ است و در اسرع وقت محصول جایگزین برای شما ارسال می‌شود.",
  },
  {
    id: "return-process",
    category: "product",
    // approved: owner-approved return process steps.
    question: "چطور محصول را مرجوع کنم؟",
    answer:
      "مراحل مرجوع کردن کالا:\n• ثبت درخواست مرجوعی از طریق حساب کاربری\n• اعلام دلیل مرجوعی و ارسال تصویر محصول\n• پس از تأیید، آدرس مرجوعی از طریق پیامک برای شما ارسال می‌شود\n• ارسال محصول در بسته‌بندی اصلی\n• پس از دریافت و بررسی، مبلغ به شما بازگردانده می‌شود",
  },
  {
    id: "product-authenticity",
    category: "product",
    popular: true,
    // approved: owner-approved authenticity/quality statement.
    question: "آیا همه محصولات اصل و باکیفیت هستند؟",
    answer:
      "مارلو شاپ محصولات اصل و باکیفیت را از تأمین‌کنندگان معتبر ارائه می‌دهد و پیش از ارسال، محصولات را بررسی می‌کند.",
  },
  {
    id: "secure-packaging",
    category: "product",
    // approved: owner-approved packaging answer.
    question: "آیا محصولات به‌صورت ایمن بسته‌بندی می‌شوند؟",
    answer:
      "محصولات در بسته‌بندی مقاوم و استاندارد ارسال می‌شوند و اقلام حساس با بسته‌بندی محافظ اضافه ارسال می‌گردند.",
  },
  {
    id: "wishlist",
    category: "product",
    question: "علاقه‌مندی‌ها چیست؟",
    answer:
      "می‌توانید محصولات مورد علاقه خود را به لیست علاقه‌مندی‌ها اضافه کنید تا بعداً راحت‌تر پیدایشان کنید. این ویژگی مخصوص حساب‌های مشتری است.",
  },

  // ── پشتیبانی ────────────────────────────────────────────────────────────
  {
    id: "contact-support",
    category: "support",
    popular: true,
    question: "چطور با پشتیبانی تماس بگیرم؟",
    answer:
      "از صفحه «پشتیبانی» می‌توانید گفتگوی جدیدی با پشتیبانی آغاز کنید.",
  },
  {
    id: "support-conditions",
    category: "support",
    question: "برای شروع گفتگو با پشتیبانی چه شرایطی لازم است؟",
    answer:
      "ایجاد گفتگو برای سفارش‌های پرداخت‌شده (یا بازپرداخت‌شده) امکان‌پذیر است و گفتگو به همان سفارش مرتبط می‌شود.",
  },
  {
    id: "support-type",
    category: "support",
    question: "چه نوع گفتگویی پشتیبانی می‌شود؟",
    answer:
      "در نسخه فعلی گفتگوهای پشتیبانی متنی هستند و در همان صفحه پشتیبانی پیگیری می‌شوند.",
  },

  // ── فروشندگی ────────────────────────────────────────────────────────────
  {
    id: "become-supplier",
    category: "supplier",
    question: "چطور فروشنده شوم؟",
    answer:
      "از صفحه «فروشنده شوید» درخواست خود را ثبت کنید؛ پس از بررسی و تأیید مدیر، حساب شما به فروشنده ارتقا می‌یابد.",
  },
];

/** Category → item count (used by the sidebar badges). */
export function faqCountByCategory(): Record<FaqCategoryId, number> {
  const counts = Object.fromEntries(
    FAQ_CATEGORIES.map((c) => [c.id, 0])
  ) as Record<FaqCategoryId, number>;
  for (const item of FAQ_ITEMS) counts[item.category] += 1;
  return counts;
}

/**
 * The questions/answers for the FAQPage JSON-LD. Answers are flattened to a
 * single line (structured data has no notion of our "\n" bullets).
 */
export function getFaqJsonLdItems(): Array<{ question: string; answer: string }> {
  return FAQ_ITEMS.map((item) => ({
    question: item.question,
    answer: item.answer.replace(/\n• /g, " — ").replace(/\n/g, " "),
  }));
}
