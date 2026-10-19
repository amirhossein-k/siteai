/** Persian text helpers shared by tools, search and price verification. */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/** Canonical form for matching: Arabic ي/ك → Persian, ZWNJ → space, latin digits. */
export function normalizePersian(value: string): string {
  return toLatinDigits(String(value || ""))
    .normalize("NFKC")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ۀ/g, "ه")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u0652]/g, "") // harakat
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex source that matches a normalized token against stored text that may
 * still use Arabic ي/ك or a ZWNJ instead of a space.
 */
export function tolerantTokenPattern(token: string): string {
  return escapeRegex(normalizePersian(token))
    .replace(/ی/g, "[یي]")
    .replace(/ک/g, "[کك]")
    .replace(/ /g, "[\\s\\u200c]?");
}

const SEARCH_STOP_WORDS = new Set([
  "من", "یک", "یه", "برای", "میخوام", "میخواهم", "می خوام", "لطفا", "لطفاً", "محصول",
  "محصولات", "خرید", "چیه", "چی", "دارید", "دارین", "بده", "با", "و", "یا", "از",
  "به", "در", "که", "را", "رو", "تا", "زیر", "حدود", "قیمت", "مناسب", "خوب", "بهترین",
  "پیشنهاد", "کن", "هست", "است", "هستش",
  "میلیون", "ملیون", "هزار", "میلیارد", "تومان", "تومن", "حداکثر", "کمتر", "بالای", "بین",
]);

export function searchTokens(query: string): string[] {
  return normalizePersian(query)
    .replace(/[؟?!،؛,:.()[\]{}"'`«»]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !SEARCH_STOP_WORDS.has(t) && !/^\d+$/.test(t))
    .slice(0, 6);
}

const MULTIPLIERS: Record<string, number> = {
  "هزار": 1_000,
  "تومن": 1,
  "تومان": 1,
  "میلیون": 1_000_000,
  "ملیون": 1_000_000,
  "میلیارد": 1_000_000_000,
  "تومنی": 1,
};

/**
 * Extract every money amount (in toman) written in a text: «۱۲٬۵۰۰٬۰۰۰ تومان»,
 * «20 میلیون», «۳.۵ میلیون», «850,000». Used for deterministic price checks.
 */
export function extractMoneyAmounts(text: string): number[] {
  const t = toLatinDigits(text).replace(/[٬،]/g, ",").replace(/٫/g, ".");
  const out: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(هزار|میلیون|ملیون|میلیارد)?\s*(تومان|تومن)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const raw = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const unit = m[2] ? MULTIPLIERS[m[2]] : 1;
    const hasCurrency = Boolean(m[3]) || Boolean(m[2]);
    const value = Math.round(raw * unit);
    // Bare small numbers ("۲ روز", "۴ گیگ") are not prices.
    if (!hasCurrency && value < 10_000) continue;
    out.push(value);
  }
  return out;
}

export function isObjectIdLike(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

export function formatToman(value: number): string {
  return `${Math.round(value).toLocaleString("fa-IR")} تومان`;
}
