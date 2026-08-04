/**
 * Session 53 — Homepage CMS shared library.
 *
 * Central home for:
 *   - the default section composition (`DEFAULT_SECTIONS`) that seeds the DB
 *     and doubles as the fallback order when no rows exist;
 *   - per-type content field contracts + route-level validation helpers;
 *   - the PUBLIC composition reader used by the storefront homepage
 *     (`getHomepageComposition`) and the public API route.
 *
 * This module is intentionally server-only (imports models + dbConnect).
 * Client code must NOT import it — the admin UI uses the HTTP API via
 * src/hooks/use-admin-homepage.ts.
 */
import { dbConnect } from "@/lib/dbConnect";
import HomepageSection from "@/models/HomepageSection";
import HomepageHeroSlide from "@/models/HomepageHeroSlide";
import HomepageCampaignBanner from "@/models/HomepageCampaignBanner";
import HomepageGiftCollection from "@/models/HomepageGiftCollection";
import HomepageTrustBadge from "@/models/HomepageTrustBadge";
import { sanitizePlainText } from "@/lib/sanitize";
import { homepageConfig } from "@/lib/homepage-config";

// ============================================================
// Default section composition (seed + fallback order)
// ============================================================

export interface DefaultSectionPresentation {
  appearance: {
    themeColor: string;
    background: string;
    spacing: string;
    borderRadius: string;
  };
  behavior: {
    autoplay: boolean;
    autoplayInterval: number;
    showArrows: boolean;
    showDots: boolean;
    countdownEnabled: boolean;
    countdownTarget: "end_of_day" | "fixed" | "off";
    countdownEndsAt: string | null;
    maxItems: number;
    layoutVariant: "grid" | "carousel" | "stacked" | "split";
  };
}

export interface DefaultSection {
  slug: string;
  component: string;
  title: string;
  subtitle: string;
  presentation: DefaultSectionPresentation;
}

const defaultAppearance = () => ({
  themeColor: "",
  background: "",
  spacing: "",
  borderRadius: "",
});

const defaultBehavior = () => ({
  autoplay: true,
  autoplayInterval: 6000,
  showArrows: true,
  showDots: true,
  countdownEnabled: false,
  countdownTarget: "off" as const,
  countdownEndsAt: null,
  maxItems: 12,
  layoutVariant: "grid" as const,
});

/** Seed + fallback composition (Session 50 order preserved). */
export const DEFAULT_SECTIONS: DefaultSection[] = [
  {
    slug: "hero",
    component: "hero-carousel",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: {
        ...defaultBehavior(),
        autoplay: true,
        autoplayInterval: 6000,
        showArrows: true,
        showDots: true,
        layoutVariant: "carousel",
      },
    },
  },
  {
    slug: "quick-categories",
    component: "quick-categories",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: { ...defaultBehavior(), layoutVariant: "grid" },
    },
  },
  {
    slug: "campaign-banner",
    component: "campaign-banner",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: { ...defaultBehavior(), layoutVariant: "split" },
    },
  },
  {
    slug: "special-picks",
    component: "special-picks",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: {
        ...defaultBehavior(),
        countdownEnabled: true,
        countdownTarget: "end_of_day",
        maxItems: 12,
        layoutVariant: "carousel",
      },
    },
  },
  {
    slug: "newest-products",
    component: "newest-products",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: {
        ...defaultBehavior(),
        maxItems: 12,
        layoutVariant: "carousel",
      },
    },
  },
  {
    slug: "premium-collection",
    component: "premium-collection",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: {
        ...defaultBehavior(),
        maxItems: 12,
        layoutVariant: "carousel",
      },
    },
  },
  {
    slug: "popular-brands",
    component: "popular-brands",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: { ...defaultBehavior(), layoutVariant: "grid" },
    },
  },
  {
    slug: "gift-collections",
    component: "gift-collections",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: { ...defaultBehavior(), layoutVariant: "grid" },
    },
  },
  {
    slug: "trust-badges",
    component: "trust-badges",
    title: "",
    subtitle: "",
    presentation: {
      appearance: defaultAppearance(),
      behavior: { ...defaultBehavior(), layoutVariant: "grid" },
    },
  },
];

/**
 * Canonical known renderer component ids (matches the block registry).
 * Kept here so the composition reader can skip unknown components WITHOUT
 * importing the React registry (which would create a circular dependency).
 */
export const HOMEPAGE_COMPONENTS = [
  "hero-carousel",
  "quick-categories",
  "campaign-banner",
  "special-picks",
  "newest-products",
  "premium-collection",
  "popular-brands",
  "gift-collections",
  "trust-badges",
];

export function isKnownHomepageComponent(component: string): boolean {
  return HOMEPAGE_COMPONENTS.includes(component);
}

/** Content model classes keyed by component (server-side resolver adapters). */
export const CONTENT_MODELS_BY_COMPONENT: Record<
  string,
  { model: typeof HomepageHeroSlide; sectionComponent: string } | undefined
> = {
  "hero-carousel": { model: HomepageHeroSlide, sectionComponent: "hero-carousel" },
  "campaign-banner": { model: HomepageCampaignBanner, sectionComponent: "campaign-banner" },
  "gift-collections": { model: HomepageGiftCollection, sectionComponent: "gift-collections" },
  "trust-badges": { model: HomepageTrustBadge, sectionComponent: "trust-badges" },
};

// ============================================================
// Validation helpers (route-level — the project's convention)
// ============================================================

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Internal path or http(s) only — rejects javascript:, //, data:. */
export function isValidHref(value: string): boolean {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return /^https?:\/\//i.test(value);
}

/** Whitelisted lucide icon names for trust badges. */
export const TRUST_ICON_WHITELIST = [
  "truck",
  "shield-check",
  "star",
  "headphones",
  "tag",
  "package",
  "badge-check",
  "refresh-cw",
  "heart",
  "gift",
  "credit-card",
  "store",
];

export function isValidIcon(name: string): boolean {
  return TRUST_ICON_WHITELIST.includes(name);
}

export const CONTENT_STATUSES = ["draft", "published"] as const;
export type HomepageContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * Validate a content row against its type contract. Returns a Persian error
 * message or null when valid. Applies sanitization where noted via `out`.
 */
export function validateContentRow(
  type: "hero-slide" | "campaign-banner" | "gift-collection" | "trust-badge",
  body: Record<string, unknown>,
  out: Record<string, unknown>
): string | null {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const text = (v: unknown) => sanitizePlainText(str(v));

  if (type === "hero-slide") {
    if (!str(body.title)) return "عنوان اسلاید الزامی است";
    if (str(body.title).length > 120) return "عنوان حداکثر ۱۲۰ کاراکتر است";
    if (str(body.ctaHref) && !isValidHref(str(body.ctaHref)))
      return "لینک باید مسیر داخلی یا آدرس http(s) معتبر باشد";
    out.title = text(body.title);
    out.subtitle = text(body.subtitle);
    out.tagline = text(body.tagline);
    out.ctaLabel = text(body.ctaLabel);
    out.ctaHref = str(body.ctaHref);
    out.imageDesktop = str(body.imageDesktop);
    out.imageMobile = str(body.imageMobile);
    out.themeColor = str(body.themeColor);
    return null;
  }

  if (type === "campaign-banner") {
    if (!str(body.title)) return "عنوان بنر الزامی است";
    if (str(body.ctaHref) && !isValidHref(str(body.ctaHref)))
      return "لینک باید مسیر داخلی یا آدرس http(s) معتبر باشد";
    out.title = text(body.title);
    out.subtitle = text(body.subtitle);
    out.tagline = text(body.tagline);
    out.ctaLabel = text(body.ctaLabel);
    out.ctaHref = str(body.ctaHref);
    out.imageDesktop = str(body.imageDesktop);
    out.imageMobile = str(body.imageMobile);
    out.themeColor = str(body.themeColor);
    return null;
  }

  if (type === "gift-collection") {
    if (!str(body.title)) return "عنوان کالکشن الزامی است";
    if (str(body.ctaHref) && !isValidHref(str(body.ctaHref)))
      return "لینک باید مسیر داخلی یا آدرس http(s) معتبر باشد";
    out.title = text(body.title);
    out.description = text(body.description);
    out.ctaLabel = text(body.ctaLabel);
    out.ctaHref = str(body.ctaHref);
    out.imageDesktop = str(body.imageDesktop);
    out.imageMobile = str(body.imageMobile);
    out.themeColor = str(body.themeColor);
    return null;
  }

  // trust-badge
  if (!str(body.title)) return "عنوان نشان الزامی است";
  const icon = str(body.icon);
  if (icon && !isValidIcon(icon)) return "آیکون انتخاب‌شده مجاز نیست";
  out.title = text(body.title);
  out.description = text(body.description);
  out.icon = icon;
  return null;
}

/** Normalize the common content fields (sortOrder/isActive/status/sectionSlug). */
export function normalizeContentCommon(
  body: Record<string, unknown>,
  out: Record<string, unknown>
): string | null {
  if (typeof body.sectionSlug === "string" && body.sectionSlug.trim()) {
    const slug = body.sectionSlug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return "شناسه بخش نامعتبر است";
    out.sectionSlug = slug;
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n) || n < 0) return "ترتیب نمایش نامعتبر است";
    out.sortOrder = Math.floor(n);
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") return "وضعیت فعال نامعتبر است";
    out.isActive = body.isActive;
  }
  if (body.status !== undefined) {
    if (!CONTENT_STATUSES.includes(body.status as HomepageContentStatus))
      return "وضعیت انتشار نامعتبر است";
    out.status = body.status;
    out.publishedAt =
      body.status === "published" ? new Date() : null;
  }
  return null;
}

// ============================================================
// Static fallback + seed (migration from homepage-config.ts)
// ============================================================

/**
 * Default trust badges (Session 50 copy) — used both for the static fallback
 * and to seed the trust-badges content model. Icons are whitelisted lucide
 * names validated by isValidIcon.
 */
export const DEFAULT_TRUST_BADGES: Array<{
  title: string;
  description: string;
  icon: string;
}> = [
  {
    title: "ارسال سریع",
    description:
      "ارسال سفارشات در کمترین زمان ممکن به سراسر کشور با پست پیشتاز و پیک موتوری",
    icon: "truck",
  },
  {
    title: "ضمانت اصالت کالا",
    description:
      "تمامی محصولات دارای ضمانت اصالت و گارانتی بازگشت وجه در صورت نارضایتی هستند",
    icon: "shield-check",
  },
  {
    title: "کیفیت عالی",
    description:
      "بهترین محصولات با بالاترین استانداردهای کیفی و قیمت‌های فوق‌العاده مناسب",
    icon: "star",
  },
  {
    title: "پشتیبانی ۲۴ ساعته",
    description:
      "تیم پشتیبانی ما در تمام ساعات شبانه‌روز آماده پاسخگویی به سوالات شماست",
    icon: "headphones",
  },
  {
    title: "تخفیف‌های ویژه",
    description:
      "تخفیف‌های فصلی و جشنواره‌های متنوع برای مشتریان وفادار فروشگاه",
    icon: "tag",
  },
  {
    title: "محصولات متنوع",
    description:
      "بیش از هزاران محصول در دسته‌بندی‌های مختلف با بهترین برندهای معروف",
    icon: "package",
  },
];

/**
 * Map the Session 50 static configuration (homepage-config.ts) into content
 * model rows for a component + section slug. Used for the DB seed and the
 * static fallback — content models are small, typed and DB-agnostic here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStaticContent(component: string, sectionSlug: string): any[] {
  if (component === "hero-carousel") {
    return homepageConfig.heroSlides.map((s) => ({
      sectionSlug,
      title: s.title,
      subtitle: s.subtitle,
      tagline: s.tagline ?? "",
      ctaLabel: s.cta.label,
      ctaHref: s.cta.href,
      imageDesktop: "",
      imageMobile: "",
      themeColor: s.gradient,
    }));
  }
  if (component === "campaign-banner") {
    const b = homepageConfig.campaignBanner;
    return [
      {
        sectionSlug,
        title: b.title,
        subtitle: b.subtitle,
        tagline: "",
        ctaLabel: b.cta.label,
        ctaHref: b.cta.href,
        imageDesktop: "",
        imageMobile: "",
        themeColor: b.gradient,
      },
    ];
  }
  if (component === "gift-collections") {
    return homepageConfig.giftCollections.map((c) => ({
      sectionSlug,
      title: c.title,
      description: c.description,
      ctaLabel: c.cta.label,
      ctaHref: c.cta.href,
      imageDesktop: "",
      imageMobile: "",
      themeColor: c.gradient,
    }));
  }
  if (component === "trust-badges") {
    return DEFAULT_TRUST_BADGES.map((b) => ({
      sectionSlug,
      title: b.title,
      description: b.description,
      icon: b.icon,
    }));
  }
  return [];
}

/**
 * Idempotent seed — the migration from homepage-config.ts.
 *   - Inserts the 9 DEFAULT_SECTIONS rows when the sections collection is empty;
 *   - For each content-bearing section, inserts static-config rows when that
 *     section has no content yet.
 * Safe to call on every admin sections GET (cheap existence checks).
 */
export async function seedHomepageContent(): Promise<void> {
  await dbConnect();

  // TOCTOU-safe: if two concurrent first-time requests both pass the
  // count-then-insert check, the loser hits E11000 on the unique slug index.
  // That is expected (the winner already seeded) — swallow it instead of 500.
  // insertMany (not bulkWrite) is kept on purpose: it applies Mongoose
  // defaults + validation, which the public reader depends on.
  const sectionCount = await HomepageSection.countDocuments({ deletedAt: null });
  if (sectionCount === 0) {
    try {
      await HomepageSection.insertMany(
        DEFAULT_SECTIONS.map((s) => ({
          slug: s.slug,
          component: s.component,
          title: s.title,
          subtitle: s.subtitle,
          presentation: s.presentation,
        }))
      );
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code !== 11000) throw err; // only the seed race is expected
    }
  }

  for (const section of DEFAULT_SECTIONS) {
    const entry = CONTENT_MODELS_BY_COMPONENT[section.component];
    if (!entry) continue;
    const existing = await entry.model.countDocuments({
      sectionSlug: section.slug,
    });
    if (existing > 0) continue;
    const rows = mapStaticContent(section.component, section.slug);
    if (rows.length > 0) {
      try {
        await entry.model.insertMany(rows);
      } catch (err) {
        const code = (err as { code?: number })?.code;
        if (code !== 11000) throw err;
      }
    }
  }
}

/** Build the PUBLIC composition from the static config (empty-DB fallback). */
function buildStaticFallback(): PublicHomepageComposition {
  const sections: PublicHomepageSection[] = DEFAULT_SECTIONS.map((s) => {
    const rows = mapStaticContent(s.component, s.slug);
    return {
      slug: s.slug,
      component: s.component,
      title: s.title,
      subtitle: s.subtitle,
      presentation: s.presentation,
      content: rows.map((r) => ({
        _id: "static-" + s.slug + "-" + (r.title ?? ""),
        title: r.title ?? "",
        subtitle: r.subtitle ?? "",
        tagline: r.tagline ?? "",
        description: r.description ?? "",
        ctaLabel: r.ctaLabel ?? "",
        ctaHref: r.ctaHref ?? "",
        imageDesktop: r.imageDesktop ?? "",
        imageMobile: r.imageMobile ?? "",
        themeColor: r.themeColor ?? "",
        icon: r.icon ?? "",
      })),
    };
  });
  return { sections };
}

// ============================================================
// Content resolver adapter (used by the block registry)
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPublicContentRow(r: any): PublicHomepageContent {
  return {
    _id: typeof r._id?.toString === "function" ? r._id.toString() : String(r._id ?? ""),
    title: r.title ?? "",
    subtitle: r.subtitle ?? "",
    tagline: r.tagline ?? "",
    description: r.description ?? "",
    ctaLabel: r.ctaLabel ?? "",
    ctaHref: r.ctaHref ?? "",
    imageDesktop: r.imageDesktop ?? "",
    imageMobile: r.imageMobile ?? "",
    themeColor: r.themeColor ?? "",
    icon: r.icon ?? "",
  };
}

/**
 * CONTENT RESOLVER ADAPTER — the only server-side access path for section
 * content (used by the block registry). Returns PUBLIC rows for a component's
 * content model scoped to a section slug:
 *   - published + active + non-deleted only (public visibility rule);
 *   - strict projection (internal fields excluded);
 *   - ordered by sortOrder.
 * Unknown components return [] (fail-safe — never crashes the homepage).
 */
export async function getContentRowsByComponent(
  component: string,
  sectionSlug: string
): Promise<PublicHomepageContent[]> {
  const entry = CONTENT_MODELS_BY_COMPONENT[component];
  if (!entry) return [];

  const rows = await entry.model
    .find({
      sectionSlug,
      status: "published",
      isActive: true,
      deletedAt: null,
    })
    .select(CONTENT_PROJECTION)
    .sort({ sortOrder: 1 })
    .lean();

  return rows.map(toPublicContentRow);
}

// ============================================================
// Public composition reader (storefront)
// ============================================================

/** Public content row shape (strict projection — internal fields excluded). */
export interface PublicHomepageContent {
  _id: string;
  title: string;
  subtitle: string;
  tagline?: string;
  description?: string;
  ctaLabel: string;
  ctaHref: string;
  imageDesktop: string;
  imageMobile: string;
  themeColor: string;
  icon?: string;
}

/** One enabled section in the public composition. */
export interface PublicHomepageSection {
  slug: string;
  component: string;
  title: string;
  subtitle: string;
  presentation: DefaultSectionPresentation;
  content: PublicHomepageContent[];
}

export interface PublicHomepageComposition {
  sections: PublicHomepageSection[];
}

const CONTENT_PROJECTION =
  "_id title subtitle tagline description ctaLabel ctaHref imageDesktop imageMobile themeColor icon sortOrder";

/**
 * Build the PUBLIC homepage composition:
 *   - enabled, non-deleted sections ordered by sortOrder;
 *   - for content-bearing components, published + active + non-deleted rows
 *     (projection excludes isActive/status/publishedAt/publishAt/deletedAt);
 *   - unknown components are skipped (fail-safe — never crash the homepage).
 */
export async function getHomepageComposition(): Promise<PublicHomepageComposition> {
  await dbConnect();

  // Empty DB (CMS never bootstrapped) → static fallback so the storefront is
  // never broken and matches the pre-CMS homepage exactly.
  const sectionCount = await HomepageSection.countDocuments({ deletedAt: null });
  if (sectionCount === 0) return buildStaticFallback();

  const sections = await HomepageSection.find({ enabled: true, deletedAt: null })
    .sort({ sortOrder: 1 })
    .lean();

  const result: PublicHomepageSection[] = [];

  for (const section of sections) {
    // Fail-safe: unknown components are skipped (never crash the homepage).
    if (!isKnownHomepageComponent(section.component)) continue;

    // Resolve content through the component resolver adapter — no model access here.
    const content = await getContentRowsByComponent(section.component, section.slug);

    result.push({
      slug: section.slug,
      component: section.component,
      title: section.title ?? "",
      subtitle: section.subtitle ?? "",
      presentation: section.presentation ?? {
        appearance: defaultAppearance(),
        behavior: defaultBehavior(),
      },
      content,
    });
  }

  return { sections: result };
}
