import Link from "next/link";
import Image from "next/image";
import { Gift, ArrowLeft } from "lucide-react";
import { cn, isAllowedImageSrc } from "@/lib/utils";
import { SectionHeader } from "@/components/storefront/home/section-header";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Gift Collections (Session 50; Session 53 — CMS data-driven).
 * Large visual cards from `section.content` (each row = one collection).
 * Desktop: 3-col grid; mobile: stacked full-width cards. Renders nothing
 * when the section has no published collections.
 */
export function GiftCollections({ section }: HomepageSectionRendererProps) {
  const collections = section.content;
  if (collections.length === 0) return null;

  const isGradient = (theme: string) => theme.startsWith("from-");

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <SectionHeader
        title={section.title || "کالکشن‌های هدیه"}
        subtitle={section.subtitle || "هدیه‌ای متفاوت برای عزیزانتان"}
        icon={<Gift className="h-4.5 w-4.5" />}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {collections.map((collection) => {
          // Session 61 — next/image throws on unconfigured hosts; skip such
          // artwork and keep the gradient/decorative fallback (native <img>
          // degraded to a broken image before the migration).
          const imageDesktop = isAllowedImageSrc(collection.imageDesktop)
            ? collection.imageDesktop
            : "";
          const imageMobile = isAllowedImageSrc(collection.imageMobile)
            ? collection.imageMobile
            : "";
          const hasImage = Boolean(imageDesktop || imageMobile);
          return (
            <Link
              key={collection._id}
              href={collection.ctaHref || "/products"}
              className={cn(
                "group relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:p-8",
                isGradient(collection.themeColor)
                  ? collection.themeColor
                  : "from-slate-800 via-slate-700 to-zinc-600"
              )}
              style={
                !isGradient(collection.themeColor) && collection.themeColor
                  ? { backgroundColor: collection.themeColor }
                  : undefined
              }
            >
              {imageMobile && (
                <Image
                  src={imageMobile}
                  alt=""
                  fill
                  sizes="100vw"
                  loading="eager"
                  className="object-cover md:hidden"
                />
              )}
              {imageDesktop && (
                <Image
                  src={imageDesktop}
                  alt=""
                  fill
                  sizes="100vw"
                  loading="eager"
                  className="hidden object-cover md:block"
                />
              )}
              {hasImage && (
                <div
                  className="absolute inset-0 bg-black/35"
                  aria-hidden="true"
                />
              )}

              {/* Decorative circle */}
              {!hasImage && (
                <div
                  className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10 transition-transform duration-500 group-hover:scale-125"
                  aria-hidden="true"
                />
              )}

              <div className="relative">
                {!hasImage && (
                  <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                    <Gift className="h-5 w-5" />
                  </span>
                )}
                <h3 className="text-lg font-bold sm:text-xl">
                  {collection.title}
                </h3>
                {collection.description && (
                  <p className="mt-2 text-sm leading-6 text-white/85">
                    {collection.description}
                  </p>
                )}
                {collection.ctaLabel && (
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 transition-colors group-hover:underline">
                    {collection.ctaLabel}
                    <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
