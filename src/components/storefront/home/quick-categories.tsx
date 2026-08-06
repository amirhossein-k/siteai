"use client";

import Link from "next/link";
import Image from "next/image";
import { LayoutGrid } from "lucide-react";
import { usePublicCategories } from "@/hooks/use-public-categories";
import { Skeleton } from "@/components/ui/skeleton";
import { isAllowedImageSrc } from "@/lib/utils";
import { SectionHeader } from "@/components/storefront/home/section-header";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Quick Categories (Session 50).
 * Desktop: dense responsive grid of rounded tiles. Mobile: horizontal
 * scroll-snap row (independent layout, not a squeezed grid). Each tile links
 * to the catalog with the category pre-selected (useCatalogFilters reads the
 * ?category= URL param once on mount).
 */
export function QuickCategories({ section }: HomepageSectionRendererProps) {
  const { data: categories, isLoading, isError } = usePublicCategories();

  const count = categories?.length ?? 0;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <SectionHeader
        title={section.title || "دسته‌بندی‌های محبوب"}
        subtitle={section.subtitle || "از میان دسته‌بندی‌های فروشگاه انتخاب کنید"}
        icon={<LayoutGrid className="h-4.5 w-4.5" />}
      />

      {isLoading ? (
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-16 w-16 rounded-2xl sm:h-20 sm:w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : isError || count === 0 ? (
        <p className="rounded-xl border bg-muted/30 p-5 text-center text-sm text-muted-foreground">
          دسته‌بندی‌ها در دسترس نیستند
        </p>
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-none md:grid md:grid-cols-4 md:snap-none md:overflow-visible md:pb-0 lg:grid-cols-6 xl:grid-cols-8">
          {categories!.map((category) => {
            // Session 61 — next/image throws on unconfigured hosts; fall back
            // to the letter tile (native <img> degraded to a broken image).
            const categoryImage = isAllowedImageSrc(category.image)
              ? category.image
              : "";
            return (
              <Link
                key={category._id}
                href={`/products?category=${category._id}`}
                className="group flex w-[23%] shrink-0 snap-start flex-col items-center gap-2 sm:w-[16%] md:w-auto"
              >
                <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-muted to-muted/60 text-lg font-bold text-muted-foreground shadow-sm ring-1 ring-border transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lg sm:h-20 sm:w-20 sm:rounded-3xl">
                  {categoryImage ? (
                    <Image
                      src={categoryImage}
                      alt={category.name}
                      fill
                      sizes="80px"
                      loading="lazy"
                      className="object-cover"
                    />
                  ) : (
                    <span>{category.name[0]}</span>
                  )}
                </span>
                <span className="max-w-full truncate text-center text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                  {category.name}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
