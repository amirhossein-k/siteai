/**
 * Session 53 — Homepage block registry (server-only module).
 *
 * Maps a `HomepageSection.component` identifier to:
 *   - the storefront renderer (React component);
 *   - a content RESOLVER ADAPTER (function) that returns plain public content
 *     rows for the section. The registry NEVER stores raw Mongoose models —
 *     database access is isolated behind the adapters in
 *     src/lib/homepage-content.ts (`CONTENT_MODELS_BY_COMPONENT`), so
 *     rendering/orchestration stays decoupled from the database layer.
 *
 * Adding a future block = 1 registry entry here (+ content model + admin
 * editor). No shared architecture changes.
 */
import type { ComponentType } from "react";
import type { HomepageSectionRendererProps } from "@/types";
import { getContentRowsByComponent } from "@/lib/homepage-content";

// Storefront section renderers (all accept HomepageSectionRendererProps).
import { HeroCarousel } from "@/components/storefront/home/hero-carousel";
import { QuickCategories } from "@/components/storefront/home/quick-categories";
import { CampaignBanner } from "@/components/storefront/home/campaign-banner";
import { SpecialPicks } from "@/components/storefront/home/special-picks";
import { NewestProducts } from "@/components/storefront/home/newest-products";
import { PremiumCollection } from "@/components/storefront/home/premium-collection";
import { PopularBrands } from "@/components/storefront/home/popular-brands";
import { GiftCollections } from "@/components/storefront/home/gift-collections";
import { TrustBadges } from "@/components/storefront/home/trust-badges";

export interface HomepageBlockDefinition {
  /** Renderer identifier stored on HomepageSection.component. */
  component: string;
  /** Storefront renderer. */
  renderer: ComponentType<HomepageSectionRendererProps>;
  /**
   * Content resolver adapter — returns plain public content rows (or []).
   * Data-driven sections (no content model) omit this.
   */
  resolveContent?: (sectionSlug: string) => Promise<unknown[]>;
  /** Whether the section is content-bearing (admin shows a content editor). */
  hasContent: boolean;
  /** Lazy-load below the fold (IntersectionObserver wrapper). */
  lazy?: boolean;
  minHeight?: number;
}

/**
 * Resolver adapters — thin wrappers over the server-side content adapters.
 * Keeps this registry free of any direct model imports.
 */
const resolveHeroSlides = (sectionSlug: string) =>
  getContentRowsByComponent("hero-carousel", sectionSlug);
const resolveCampaignBanners = (sectionSlug: string) =>
  getContentRowsByComponent("campaign-banner", sectionSlug);
const resolveGiftCollections = (sectionSlug: string) =>
  getContentRowsByComponent("gift-collections", sectionSlug);
const resolveTrustBadges = (sectionSlug: string) =>
  getContentRowsByComponent("trust-badges", sectionSlug);

/**
 * The one place a new homepage block is registered. Order is irrelevant —
 * page order comes from HomepageSection.sortOrder (seeded by DEFAULT_SECTIONS).
 */
export const homepageBlockRegistry: Record<string, HomepageBlockDefinition> = {
  "hero-carousel": {
    component: "hero-carousel",
    renderer: HeroCarousel,
    resolveContent: resolveHeroSlides,
    hasContent: true,
  },
  "quick-categories": {
    component: "quick-categories",
    renderer: QuickCategories,
    hasContent: false,
  },
  "campaign-banner": {
    component: "campaign-banner",
    renderer: CampaignBanner,
    resolveContent: resolveCampaignBanners,
    hasContent: true,
  },
  "special-picks": {
    component: "special-picks",
    renderer: SpecialPicks,
    hasContent: false,
  },
  "newest-products": {
    component: "newest-products",
    renderer: NewestProducts,
    hasContent: false,
    lazy: true,
    minHeight: 320,
  },
  "premium-collection": {
    component: "premium-collection",
    renderer: PremiumCollection,
    hasContent: false,
    lazy: true,
    minHeight: 320,
  },
  "popular-brands": {
    component: "popular-brands",
    renderer: PopularBrands,
    hasContent: false,
    lazy: true,
    minHeight: 200,
  },
  "gift-collections": {
    component: "gift-collections",
    renderer: GiftCollections,
    resolveContent: resolveGiftCollections,
    hasContent: true,
    lazy: true,
    minHeight: 260,
  },
  "trust-badges": {
    component: "trust-badges",
    renderer: TrustBadges,
    resolveContent: resolveTrustBadges,
    hasContent: true,
    lazy: true,
    minHeight: 280,
  },
};

/** Safe lookup — returns undefined for unknown components (fail-safe skip). */
export function getHomepageBlock(
  component: string
): HomepageBlockDefinition | undefined {
  return homepageBlockRegistry[component];
}
