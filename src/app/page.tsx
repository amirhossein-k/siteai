import { StorefrontHeader } from "@/components/storefront/storefront-header";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import { HeroCarousel } from "@/components/storefront/home/hero-carousel";
import { QuickCategories } from "@/components/storefront/home/quick-categories";
import { CampaignBanner } from "@/components/storefront/home/campaign-banner";
import { SpecialPicks } from "@/components/storefront/home/special-picks";
import { NewestProducts } from "@/components/storefront/home/newest-products";
import { PremiumCollection } from "@/components/storefront/home/premium-collection";
import { PopularBrands } from "@/components/storefront/home/popular-brands";
import { GiftCollections } from "@/components/storefront/home/gift-collections";
import { TrustBadges } from "@/components/storefront/home/trust-badges";
import { LazySection } from "@/components/storefront/home/lazy-section";

/**
 * Homepage (Session 50 — Homepage UX Redesign).
 * Thin server-component composition of reusable, self-contained sections
 * (each section owns its own max-width container + vertical rhythm). Every
 * section reuses existing APIs + hooks; no fake data; the single product pool
 * query feeds all three product rails. Below-the-fold sections lazy-mount on
 * scroll.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <StorefrontHeader />

      <main className="flex-1 pb-14">
        {/* 1. Hero Carousel */}
        <HeroCarousel />

        {/* 2. Quick Categories */}
        <QuickCategories />

        {/* 3. Featured Campaign Banner */}
        <CampaignBanner />

        {/* 4. Special Picks (real prices, countdown) */}
        <SpecialPicks />

        {/* 5. Newest Products */}
        <LazySection>
          <NewestProducts />
        </LazySection>

        {/* 6. Premium Collection */}
        <LazySection>
          <PremiumCollection />
        </LazySection>

        {/* 7. Popular Brands */}
        <LazySection minHeight={200}>
          <PopularBrands />
        </LazySection>

        {/* 8. Gift Collections */}
        <LazySection minHeight={260}>
          <GiftCollections />
        </LazySection>

        {/* 9. Trust Badges */}
        <LazySection minHeight={280}>
          <TrustBadges />
        </LazySection>
      </main>

      <StorefrontFooter />
    </div>
  );
}
