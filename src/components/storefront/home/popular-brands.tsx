"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { usePublicBrands } from "@/hooks/use-public-brands";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/storefront/home/section-header";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Popular Brands (Session 50; Session 53 — CMS-driven title).
 * The public brands API exposes only _id/name/slug (no logo), so tiles show
 * styled initial circles — the same visual language as a logo wall, with zero
 * API changes. Desktop: grid; mobile: horizontal scroll-snap.
 */
export function PopularBrands({ section }: HomepageSectionRendererProps) {
  const { data: brands, isLoading, isError } = usePublicBrands();

  const list = brands ?? [];

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <SectionHeader
        title={section.title || "برندهای محبوب"}
        subtitle={section.subtitle || "فروشندگان و برندهای معتبر فروشگاه"}
        icon={<BadgeCheck className="h-4.5 w-4.5" />}
      />

      {isLoading ? (
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-14 w-14 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : isError || list.length === 0 ? null : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-none md:grid md:grid-cols-4 md:snap-none md:overflow-visible md:pb-0 lg:grid-cols-6 xl:grid-cols-8">
          {list.map((brand) => (
            <Link
              key={brand._id}
              href={`/products?brand=${brand._id}`}
              className="group flex w-[23%] shrink-0 snap-start flex-col items-center gap-2 sm:w-[16%] md:w-auto"
            >
              {/* Session 85 — glass brand tile (dark reference); brand data
                 and the real /products?brand=<id> link unchanged. */}
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-lg font-bold text-muted-foreground shadow-sm ring-1 ring-white/10 backdrop-blur-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lg group-hover:ring-white/20">
                {brand.name[0]}
              </span>
              <span className="max-w-full truncate text-center text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                {brand.name}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
