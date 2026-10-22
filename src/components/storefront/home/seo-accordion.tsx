import { ChevronDown } from "lucide-react";
import { SectionHeader } from "@/components/storefront/home/section-header";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * SEO Accordion — admin-managed explanatory content (question/answer blocks)
 * for the homepage, rendered as the last content section before the storefront
 * footer.
 *
 * Server-rendered intentionally:
 *   - content comes from the HomepageSeoAccordionItem content model through
 *     the public projection (published + active + non-deleted rows only,
 *     ordered by the admin's sortOrder) — no client fetch, fully crawlable
 *     initial HTML;
 *   - interactive toggle uses the native <details>/<summary> elements: the
 *     summary IS the accessible disclosure button (keyboard/touch focus and
 *     aria-expanded semantics come from the element itself), so no client
 *     JavaScript, no hydration and no console errors are involved;
 *   - answers are rendered as plain JSX text (React escapes them) — admin
 *     content can never inject HTML/JS into the page.
 *
 * No FAQPage structured data is added here on purpose: /faq already carries
 * the site's canonical FAQPage schema, and duplicated Q&A markup on the
 * homepage would not earn rich results (FAQ rich results are deprecated).
 * Renders nothing when the section has no published items.
 */
export function SeoAccordion({ section }: HomepageSectionRendererProps) {
  const items = section.content;
  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby={`seo-accordion-heading-${section.slug}`}
      className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 sm:pt-12 lg:px-8 lg:pt-14"
    >
      <div id={`seo-accordion-heading-${section.slug}`}>
        <SectionHeader
          title={section.title || "درباره خرید از مارلو شاپ"}
          subtitle={section.subtitle || undefined}
        />
      </div>

      <div className="mx-auto flex max-w-4xl flex-col gap-3 pb-2">
        {items.map((item, index) => (
          <details
            key={item._id}
            /* The first item starts open server-side (no client JS). */
            open={index === 0}
            className="group glass-card rounded-2xl"
          >
            <summary className="flex min-h-12 cursor-pointer list-none flex-row-reverse items-center justify-between gap-3 rounded-2xl px-4 py-3 text-right text-sm font-semibold text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 sm:text-[15px] [&::-webkit-details-marker]:hidden">
              <ChevronDown
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-sf-dim transition-transform duration-200 group-open:rotate-180"
              />
              {/* h3 — the accordion item heading under the section h2. */}
              <h3 className="min-w-0 text-[15px] leading-6 sm:text-base">
                {item.title}
              </h3>
            </summary>
            <div className="border-t border-sf-line px-4 py-4">
              <div className="sf-prose whitespace-pre-line text-sm leading-7 text-sf-dim">
                {item.description}
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
