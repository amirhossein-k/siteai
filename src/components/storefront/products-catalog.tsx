"use client";

import { SearchSuggestions } from "@/components/storefront/search-suggestions";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  SlidersHorizontal,
  Package,
  X,
  AlertCircle,
  RefreshCw,
  ArrowUpDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductCard } from "@/components/storefront/product-card";
import { PaginationControls } from "@/components/ui/pagination";
import { FilterChipGroup } from "@/components/filter-chip-group";
import { useCatalogFilters } from "@/hooks/use-catalog-filters";
import { usePublicProducts } from "@/hooks/use-public-products";
import { usePublicCategories } from "@/hooks/use-public-categories";
import { usePublicBrands } from "@/hooks/use-public-brands";
import { usePublicTags } from "@/hooks/use-public-tags";
import { usePublicAttributeFacets } from "@/hooks/use-public-attribute-facets";

const sortOptions = [
  { value: "newest", label: "جدیدترین" },
  { value: "best_selling", label: "پرفروش‌ترین" },
  { value: "oldest", label: "قدیمی‌ترین" },
  { value: "price_asc", label: "ارزان‌ترین" },
  { value: "price_desc", label: "گران‌ترین" },
  { value: "name", label: "نام (الفبا)" },
];

/**
 * Interactive catalog (Session 74 — moved verbatim from the /products page).
 *
 * The page.tsx became a Server Component (server-rendered metadata, canonical,
 * robots) and this client component hosts the interactive surface unchanged:
 * React Query data fetching, filters, sorting and pagination behave exactly
 * as before. The page renders it server-side; the initial HTML carries the
 * SEO head while the product grid still hydrates client-side.
 *
 * Session 79 — /products?discounted=true is now a REAL discounted catalog
 * lens: the URL-derived isDiscounted (from useCatalogFilters) drives the
 * H1/exit chip, the honest lens empty state, and the deduplicated
 * countdown-expiry refetch. The server stays authoritative for membership
 * and pricing; this component only renders what the API returns.
 */
export default function ProductsCatalogPage() {
  const {
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    selectedBrand,
    setSelectedBrand,
    selectedTag,
    setSelectedTag,
    selectedAttributes,
    setAttribute,
    sortBy,
    setSortBy,
    page,
    pageHref,
    isDiscounted,
    activeFilterCount,
    queryParams,
    clearFilters,
  } = useCatalogFilters();
  const [showFilters, setShowFilters] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const { data: categories, isLoading: catsLoading } = usePublicCategories();
  const { data: brands, isLoading: brandsLoading } = usePublicBrands();
  const { data: tags, isLoading: tagsLoading } = usePublicTags();
  const { data: facets, isLoading: facetsLoading } =
    usePublicAttributeFacets(queryParams);
  const {
    data: paged,
    isLoading,
    isError,
    refetch,
  } = usePublicProducts({ ...queryParams, page });

  const products = paged?.data || [];
  const totalProducts = paged?.total || 0;
  const totalPages = paged?.totalPages || 1;

  // Session 79 — discounted-catalog countdown expiry: every card's countdown
  // reports through ProductCard.onCountdownExpire; cards sharing the same
  // endsAt collapse into exactly ONE refetch (the same dedupe pattern as the
  // homepage rail). No polling, no per-card requests; endsAt:null cards never
  // fire. Wired only on the lens so the full catalog keeps its exact behavior.
  const lastExpiredTargetRef = useRef<number | null>(null);
  const handleCountdownExpire = useCallback(
    (endsAt: string) => {
      const ms = new Date(endsAt).getTime();
      if (!Number.isFinite(ms) || lastExpiredTargetRef.current === ms) return;
      lastExpiredTargetRef.current = ms;
      void refetch();
    },
    [refetch]
  );

  const categoryName = (id: string) =>
    categories?.find((c) => c._id === id)?.name || "دسته";
  const brandName = (id: string) =>
    brands?.find((b) => b._id === id)?.name || "برند";
  const tagName = (id: string) =>
    tags?.find((t) => t._id === id)?.name || "برچسب";

  const hasActiveFilters =
    searchQuery ||
    selectedCategory ||
    selectedBrand ||
    selectedTag ||
    Object.keys(selectedAttributes).length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header — Session 79: the discounted lens gets its own H1 + an
          exit link back to the full catalog (count/subtitle unchanged). */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white">
            {/* \u200C = نیم‌فاصله — same «محصولات تخفیف‌دار» spelling as the
                homepage section title (consistent Persian typography). */}
            {isDiscounted ? "محصولات تخفیف\u200Cدار" : "محصولات"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {isLoading ? "..." : `${totalProducts} محصول در فروشگاه`}
          </p>
        </div>
        {isDiscounted && (
          <Link
            href="/products"
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-muted-foreground backdrop-blur transition-colors hover:bg-white/10 hover:text-white"
          >
            مشاهده همه محصولات
          </Link>
        )}
      </div>

      {/* Search & Filter Bar */}
      <div className="mb-6 space-y-4">
        {/* Search row */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجوی محصولات..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSuggestionsOpen(false);
              }}
              className="border-white/10 bg-white/5 pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSuggestionsOpen(false);
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <SearchSuggestions
              query={searchQuery}
              visible={suggestionsOpen}
              onSelect={(suggestion) => {
                setSearchQuery(suggestion);
                setSuggestionsOpen(false);
              }}
              onClose={() => setSuggestionsOpen(false)}
            />
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            فیلترها
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="text-xs mr-1">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4 backdrop-blur">
            <FilterChipGroup
              title="دسته‌بندی"
              options={categories || []}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
              loading={catsLoading}
            />

            <FilterChipGroup
              title="برند"
              options={brands || []}
              selected={selectedBrand}
              onSelect={setSelectedBrand}
              loading={brandsLoading}
            />

            <FilterChipGroup
              title="برچسب"
              options={tags || []}
              selected={selectedTag}
              onSelect={setSelectedTag}
              loading={tagsLoading}
            />

            {/* Attribute facets (Session 47 extension) */}
            {facetsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : facets && facets.length > 0 ? (
              facets.map((facet) => (
                <FilterChipGroup
                  key={facet.slug}
                  title={facet.name}
                  options={facet.values.map((v) => ({
                    _id: v.value,
                    name: v.value,
                  }))}
                  counts={Object.fromEntries(
                    facet.values.map((v) => [v.value, v.count])
                  )}
                  selected={selectedAttributes[facet.slug] || ""}
                  onSelect={(value) => setAttribute(facet.slug, value)}
                />
              ))
            ) : null}

            {/* Sort */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                مرتب‌سازی
              </label>
              <div className="flex flex-wrap gap-2">
                {sortOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={sortBy === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortBy(option.value)}
                    className="gap-1"
                  >
                    {option.value === "price_asc" ||
                    option.value === "price_desc" ? (
                      <ArrowUpDown className="h-3 w-3" />
                    ) : null}
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Active filters summary */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">
                  فیلترهای فعال:
                </span>
                {searchQuery && (
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer"
                    onClick={() => {
                      setSearchQuery("");
                      setSuggestionsOpen(false);
                    }}
                  >
                    {searchQuery}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {selectedCategory && (
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer"
                    onClick={() => setSelectedCategory("")}
                  >
                    {categoryName(selectedCategory)}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {selectedBrand && (
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer"
                    onClick={() => setSelectedBrand("")}
                  >
                    {brandName(selectedBrand)}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {selectedTag && (
                  <Badge
                    variant="secondary"
                    className="gap-1 cursor-pointer"
                    onClick={() => setSelectedTag("")}
                  >
                    {tagName(selectedTag)}
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {Object.entries(selectedAttributes).map(([slug, value]) => (
                  <Badge
                    key={slug}
                    variant="secondary"
                    className="gap-1 cursor-pointer"
                    onClick={() => setAttribute(slug, "")}
                  >
                    {facets?.find((f) => f.slug === slug)?.name || slug}: {value}
                    <X className="h-3 w-3" />
                  </Badge>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    clearFilters();
                    setSuggestionsOpen(false);
                  }}
                >
                  پاک کردن همه
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Mobile: Active filter chips */}
        {!showFilters && activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2">
            {searchQuery && (
              <Badge
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => {
                  setSearchQuery("");
                  setSuggestionsOpen(false);
                }}
              >
                جستجو: {searchQuery}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {selectedCategory && (
              <Badge
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => setSelectedCategory("")}
              >
                {categoryName(selectedCategory)}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {selectedBrand && (
              <Badge
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => setSelectedBrand("")}
              >
                {brandName(selectedBrand)}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {selectedTag && (
              <Badge
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => setSelectedTag("")}
              >
                {tagName(selectedTag)}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {Object.entries(selectedAttributes).map(([slug, value]) => (
              <Badge
                key={slug}
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => setAttribute(slug, "")}
              >
                {facets?.find((f) => f.slug === slug)?.name || slug}: {value}
                <X className="h-3 w-3" />
              </Badge>
            ))}
            {sortBy !== "newest" && (
              <Badge variant="secondary" className="gap-1">
                {sortOptions.find((o) => o.value === sortBy)?.label}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Products Grid */}
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-square w-full rounded-xl" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="mb-3 h-12 w-12 text-destructive" />
          <h3 className="mb-2 text-lg font-semibold">خطا در دریافت محصولات</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            ممکن است اتصال اینترنت خود را بررسی کنید
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="ml-2 h-4 w-4" />
            تلاش مجدد
          </Button>
        </div>
      ) : !products || products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Package className="mb-3 h-12 w-12 text-muted-foreground" />
          {/* Session 79 — honest lens empty state: only when the server
              returned ZERO matches (total === 0) AND no other filter could
              be responsible. A filtered search or an out-of-range page keeps
              the existing messaging. */}
          {isDiscounted && !hasActiveFilters && totalProducts === 0 ? (
            <>
              <h3 className="mb-2 text-lg font-semibold">
                در حال حاضر تخفیف فعالی وجود ندارد
              </h3>
              <p className="mb-4 text-sm text-muted-foreground">
                {/* JS string literal (NOT JSX text) so the \u200C نیم‌فاصله
                    escape is processed — JSX text would print it literally. */}
                {"برای مشاهده تخفیف\u200Cهای آینده، بعداً دوباره سر بزنید"}
              </p>
              <Link
                href="/products"
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-muted-foreground backdrop-blur transition-colors hover:bg-white/10 hover:text-white"
              >
                مشاهده همه محصولات
              </Link>
            </>
          ) : (
            <>
              <h3 className="mb-2 text-lg font-semibold">محصولی یافت نشد</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "هیچ محصولی با فیلترهای انتخاب شده یافت نشد"
                  : "هنوز محصولی در فروشگاه ثبت نشده است"}
              </p>
              {hasActiveFilters && (
                <Button variant="outline" onClick={clearFilters}>
                  پاک کردن فیلترها
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product._id}
                product={product}
                onCountdownExpire={
                  isDiscounted ? handleCountdownExpire : undefined
                }
              />
            ))}
          </div>

          {/* Results count + Pagination (Session 76 — real crawlable <a> links
              built from the URL; the page derives from ?page= so back/forward
              and direct URL loads work natively). */}
          <div className="mt-8 space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              نمایش {products.length} محصول از {totalProducts} محصول
            </div>
            <PaginationControls
              page={page}
              totalPages={totalPages}
              hrefFor={pageHref}
            />
          </div>
        </>
      )}
    </div>
  );
}
