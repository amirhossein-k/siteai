"use client";

import { SearchSuggestions } from "@/components/storefront/search-suggestions";

import { useState } from "react";
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
  { value: "oldest", label: "قدیمی‌ترین" },
  { value: "price_asc", label: "ارزان‌ترین" },
  { value: "price_desc", label: "گران‌ترین" },
  { value: "name", label: "نام (الفبا)" },
];

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
    setPage,
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
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">محصولات</h1>
        <p className="mt-2 text-muted-foreground">
          {isLoading ? "..." : `${totalProducts} محصول در فروشگاه`}
        </p>
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
              className="pr-9"
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
          <div className="rounded-lg border p-4 space-y-4">
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
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>

          {/* Results count + Pagination */}
          <div className="mt-8 space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              نمایش {products.length} محصول از {totalProducts} محصول
            </div>
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
