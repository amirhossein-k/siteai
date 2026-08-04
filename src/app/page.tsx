import { StorefrontHeader } from "@/components/storefront/storefront-header";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import { LazySection } from "@/components/storefront/home/lazy-section";
import { getHomepageComposition } from "@/lib/homepage-content";
import { getHomepageBlock } from "@/lib/homepage-sections/registry";

/**
 * Homepage (Session 50 — UX redesign; Session 53 — CMS data-driven).
 *
 * Thin server component: fetches the PUBLIC homepage composition once
 * server-side (`getHomepageComposition` — enabled, non-deleted sections in
 * sortOrder, each with its published content rows), then renders every
 * section through the block registry. Unknown components are skipped
 * fail-safe (a bad `component` id never crashes the homepage). Below-the-fold
 * sections still lazy-mount on scroll.
 *
 * The homepage is force-dynamic so CMS edits always render live in
 * production (`next start`); without this, Next prerenders `/` statically at
 * build time and the served HTML is stale until a rebuild. See H1.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const composition = await getHomepageComposition();

  return (
    <div className="flex min-h-screen flex-col">
      <StorefrontHeader />

      <main className="flex-1 pb-14">
        {composition.sections.map((section) => {
          const block = getHomepageBlock(section.component);
          if (!block) return null;

          const Renderer = block.renderer;
          if (block.lazy) {
            return (
              <LazySection
                key={section.slug}
                minHeight={block.minHeight}
              >
                <Renderer section={section} />
              </LazySection>
            );
          }
          return <Renderer key={section.slug} section={section} />;
        })}
      </main>

      <StorefrontFooter />
    </div>
  );
}
