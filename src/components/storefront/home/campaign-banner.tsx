import Link from "next/link";
import { ArrowLeft, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Featured Campaign Banner (Session 50; Session 53 — CMS data-driven).
 * Full-width promotional banner. The ACTIVE banner is the first published
 * row of `section.content` (lowest sortOrder wins — isActive + sortOrder are
 * managed by the admin). Gradient art from `themeColor` (or a hex color);
 * optional desktop/mobile artwork via imageDesktop/imageMobile.
 * Renders nothing when the section has no published banner.
 */
export function CampaignBanner({ section }: HomepageSectionRendererProps) {
  const banner = section.content[0];
  if (!banner) return null;

  const isGradient = banner.themeColor.startsWith("from-");
  const hasImage = Boolean(banner.imageDesktop || banner.imageMobile);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl px-6 py-10 text-white shadow-sm sm:rounded-3xl sm:px-12 sm:py-14",
          isGradient ? `bg-gradient-to-l ${banner.themeColor}` : "bg-gradient-to-l from-indigo-900 via-indigo-800 to-violet-700"
        )}
        style={
          !isGradient && banner.themeColor
            ? { backgroundColor: banner.themeColor }
            : undefined
        }
      >
        {banner.imageMobile && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner.imageMobile}
            alt=""
            className="absolute inset-0 h-full w-full object-cover sm:hidden"
          />
        )}
        {banner.imageDesktop && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner.imageDesktop}
            alt=""
            className="absolute inset-0 hidden h-full w-full object-cover sm:block"
          />
        )}
        {hasImage && (
          <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
        )}

        {/* Decorative rings (gradient-only look) */}
        {!hasImage && (
          <>
            <div
              className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-white/10"
              aria-hidden="true"
            />
            <div
              className="absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-white/10"
              aria-hidden="true"
            />
          </>
        )}

        <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium backdrop-blur">
              <Megaphone className="h-3.5 w-3.5" />
              {banner.tagline || "کمپین ویژه"}
            </span>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {banner.title}
            </h2>
            <p className="mt-2 text-sm leading-7 text-white/85 sm:text-base">
              {banner.subtitle}
            </p>
          </div>
          {banner.ctaLabel && banner.ctaHref && (
            <Link
              href={banner.ctaHref}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
            >
              {banner.ctaLabel}
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
