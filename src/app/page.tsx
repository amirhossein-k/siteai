import { StorefrontHeader } from "@/components/storefront/storefront-header";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import { LazySection } from "@/components/storefront/home/lazy-section";
import { AiShoppingAssistant } from "@/components/storefront/ai/ai-shopping-assistant";
import { getHomepageComposition } from "@/lib/homepage-content";
import { getHomepageBlock } from "@/lib/homepage-sections/registry";

/**
 * Homepage (Session 50 — UX redesign; Session 53 — CMS data-driven;
 * Upgraded with SEO Pre-render & AI Shopping Assistant).
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const composition = await getHomepageComposition();

  return (
    <div className="storefront dot-grid flex min-h-screen flex-col bg-sf-bg text-sf-body">
      <StorefrontHeader />

      <main className="flex-1">
        {composition.sections.map((section) => {
          const block = getHomepageBlock(section.component);
          if (!block) return null;

          const Renderer = block.renderer;
          if (block.lazy) {
            return (
              <LazySection
                key={section.slug}
                minHeight={block.minHeight}
                seoPreRender={true}
              >
                <Renderer section={section} />
              </LazySection>
            );
          }
          return <Renderer key={section.slug} section={section} />;
        })}
      </main>

      <AiShoppingAssistant />
      <StorefrontFooter />
    </div>
  );
}
