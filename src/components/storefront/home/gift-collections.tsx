import Link from "next/link";
import { Gift, ArrowLeft } from "lucide-react";
import { homepageConfig } from "@/lib/homepage-config";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/storefront/home/section-header";

/**
 * Gift Collections (Session 50).
 * Large visual cards driven by homepage-config.ts — static content, no
 * backend. Desktop: 3-col grid; mobile: stacked full-width cards.
 */
export function GiftCollections() {
  const collections = homepageConfig.giftCollections;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <SectionHeader
        title="کالکشن‌های هدیه"
        subtitle="هدیه‌ای متفاوت برای عزیزانتان"
        icon={<Gift className="h-4.5 w-4.5" />}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {collections.map((collection) => (
          <Link
            key={collection.id}
            href={collection.cta.href}
            className={cn(
              "group relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:p-8",
              collection.gradient
            )}
          >
            {/* Decorative circle */}
            <div
              className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10 transition-transform duration-500 group-hover:scale-125"
              aria-hidden="true"
            />
            <div className="relative">
              <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <Gift className="h-5 w-5" />
              </span>
              <h3 className="text-lg font-bold sm:text-xl">{collection.title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/85">
                {collection.description}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 transition-colors group-hover:underline">
                {collection.cta.label}
                <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
