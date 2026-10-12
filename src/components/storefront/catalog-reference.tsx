"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  Search,
  SlidersHorizontal,
  X,
  LayoutGrid,
  List,
  Check,
  ChevronDown,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { ProductCard } from "@/components/storefront/product-card";
import { SearchSuggestions } from "@/components/storefront/search-suggestions";
import { PaginationControls } from "@/components/ui/pagination";
import { useCatalogFilters } from "@/hooks/use-catalog-filters";
import { usePublicProducts } from "@/hooks/use-public-products";
import { usePublicCategories } from "@/hooks/use-public-categories";
import { usePublicBrands } from "@/hooks/use-public-brands";
import { usePublicTags } from "@/hooks/use-public-tags";
import { usePublicAttributeFacets } from "@/hooks/use-public-attribute-facets";
import "./catalog-reference.css";

const sorts = [
  ["newest", "جدیدترین"],
  ["best_selling", "پرفروش‌ترین"],
  ["price_asc", "ارزان‌ترین"],
  ["price_desc", "گران‌ترین"],
  ["rating_desc", "بیشترین امتیاز"],
  ["oldest", "قدیمی‌ترین"],
];
function Section({
  title,
  children,
  count = 0,
}: {
  title: string;
  children: ReactNode;
  count?: number;
}) {
  return (
    <details className="cr-section" open>
      <summary>
        {title}
        {count > 0 && (
          <span className="cr-count">{count.toLocaleString("fa-IR")}</span>
        )}
        <ChevronDown size={16} />
      </summary>
      <div className="cr-section-body">{children}</div>
    </details>
  );
}
function Choice({
  name,
  checked,
  select,
  count,
}: {
  name: string;
  checked: boolean;
  select: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      className="cr-choice"
      role="checkbox"
      aria-checked={checked}
      onClick={select}
    >
      <span className="cr-check">{checked && <Check size={13} />}</span>
      <span>{name}</span>
      {count !== undefined && <small>{count.toLocaleString("fa-IR")}</small>}
    </button>
  );
}

export default function CatalogReference() {
  const f = useCatalogFilters();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [suggestions, setSuggestions] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { data: categories, isLoading: catsLoading } = usePublicCategories();
  const { data: brands, isLoading: brandsLoading } = usePublicBrands();
  const { data: tags, isLoading: tagsLoading } = usePublicTags();
  const { data: facets, isLoading: facetsLoading } = usePublicAttributeFacets(
    f.queryParams
  );
  const {
    data: paged,
    isLoading,
    isError,
    refetch,
  } = usePublicProducts({ ...f.queryParams, page: f.page });
  const products = paged?.data || [];
  const total = paged?.total || 0;
  const lastExpired = useRef<number | null>(null);
  const onExpired = useCallback(
    (endsAt: string) => {
      const value = new Date(endsAt).getTime();
      if (!Number.isFinite(value) || lastExpired.current === value) return;
      lastExpired.current = value;
      void refetch();
    },
    [refetch]
  );
  // A native modal dialog supplies focus trapping, Escape, and focus restoration.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const restore = () => {
      document.body.style.overflow = previous;
    };
    let previous = document.body.style.overflow;
    const lock = () => {
      previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    };
    dialog.addEventListener("close", restore);
    dialog.addEventListener("catalog-open", lock);
    return () => {
      dialog.removeEventListener("close", restore);
      dialog.removeEventListener("catalog-open", lock);
      restore();
    };
  }, []);
  function openFilters() {
    const d = dialogRef.current;
    if (d) {
      d.showModal();
      d.dispatchEvent(new Event("catalog-open"));
    }
  }
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (f.searchQuery)
    chips.push({
      key: "q",
      label: `جستجو: ${f.searchQuery}`,
      remove: () => f.setSearchQuery(""),
    });
  for (const [key, id, rows, clear] of [
    ["category", f.selectedCategory, categories, f.setSelectedCategory],
    ["brand", f.selectedBrand, brands, f.setSelectedBrand],
    ["tag", f.selectedTag, tags, f.setSelectedTag],
  ] as const) {
    if (id)
      chips.push({
        key,
        label: rows?.find((row) => row._id === id)?.name || id,
        remove: () => clear(""),
      });
  }
  for (const [slug, value] of Object.entries(f.selectedAttributes))
    chips.push({
      key: slug,
      label: `${facets?.find((x) => x.slug === slug)?.name || slug}: ${value}`,
      remove: () => f.setAttribute(slug, ""),
    });
  if (f.minPrice || f.maxPrice)
    chips.push({
      key: "price",
      label: `قیمت: ${f.minPrice || "۰"} تا ${f.maxPrice || "بدون سقف"} تومان`,
      remove: () => {
        f.setMinPrice("");
        f.setMaxPrice("");
      },
    });
  if (f.minRating)
    chips.push({
      key: "rating",
      label: `امتیاز: ${f.minRating} ستاره و بالاتر`,
      remove: () => f.setMinRating(""),
    });
  const emptyDiscount = f.isDiscounted && chips.length === 0 && total === 0;

  function filters(prefix: string) {
    return (
      <>
        <div className="cr-filter-title">
          <h2>فیلترها</h2>
          <button onClick={f.clearFilters}>حذف همه</button>
        </div>
        <label className="cr-search">
          <Search size={17} />
          <input
            aria-label="جستجوی محصولات"
            placeholder="جستجو در محصولات…"
            value={f.searchQuery}
            onChange={(e) => f.setSearchQuery(e.target.value)}
          />
        </label>
        <Section title="دسته‌بندی" count={f.selectedCategory ? 1 : 0}>
          {catsLoading ? (
            <p>در حال دریافت…</p>
          ) : (
            categories?.map((c) => (
              <Choice
                key={c._id}
                name={c.name}
                checked={f.selectedCategory === c._id}
                select={() =>
                  f.setSelectedCategory(
                    f.selectedCategory === c._id ? "" : c._id
                  )
                }
              />
            ))
          )}
        </Section>
        <Section title="برند" count={f.selectedBrand ? 1 : 0}>
          {brandsLoading ? (
            <p>در حال دریافت…</p>
          ) : (
            brands?.map((b) => (
              <Choice
                key={b._id}
                name={b.name}
                checked={f.selectedBrand === b._id}
                select={() =>
                  f.setSelectedBrand(f.selectedBrand === b._id ? "" : b._id)
                }
              />
            ))
          )}
        </Section>
        <Section title="محدوده قیمت">
          <p className="cr-hint">
            مبلغ به تومان، مطابق فیلتر قیمت فعلی فروشگاه
          </p>
          <div className="cr-price-fields">
            <label htmlFor={`${prefix}-min`}>
              از
              <input
                id={`${prefix}-min`}
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={f.minPrice}
                onChange={(e) =>
                  f.setMinPrice(e.target.value.replace(/\D/g, ""))
                }
              />
            </label>
            <label htmlFor={`${prefix}-max`}>
              تا
              <input
                id={`${prefix}-max`}
                type="number"
                min={f.minPrice || "0"}
                step="1"
                inputMode="numeric"
                value={f.maxPrice}
                onChange={(e) =>
                  f.setMaxPrice(e.target.value.replace(/\D/g, ""))
                }
              />
            </label>
          </div>
          <div className="cr-presets">
            {[
              ["زیر ۱۰ میلیون", "", "10000000"],
              ["۱۰ تا ۵۰ میلیون", "10000000", "50000000"],
              ["بالای ۵۰ میلیون", "50000000", ""],
            ].map(([label, min, max]) => (
              <button
                key={label}
                aria-pressed={f.minPrice === min && f.maxPrice === max}
                onClick={() => {
                  f.setMinPrice(min);
                  f.setMaxPrice(max);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {f.minPrice &&
            f.maxPrice &&
            Number(f.minPrice) > Number(f.maxPrice) && (
              <p role="alert" className="cr-price-error">
                حداقل قیمت نباید از حداکثر بیشتر باشد.
              </p>
            )}
        </Section>
        <Section title="حداقل امتیاز" count={f.minRating ? 1 : 0}>
          <p className="cr-hint">فقط محصولات با دیدگاه تأییدشده</p>
          <div className="cr-presets">
            {[
              ["همه", ""],
              ["۳ ستاره و بالاتر", "3"],
              ["۴ ستاره و بالاتر", "4"],
            ].map(([label, value]) => (
              <button
                key={label}
                aria-pressed={f.minRating === value}
                onClick={() => f.setMinRating(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="برچسب" count={f.selectedTag ? 1 : 0}>
          {tagsLoading ? (
            <p>در حال دریافت…</p>
          ) : (
            tags?.map((t) => (
              <Choice
                key={t._id}
                name={t.name}
                checked={f.selectedTag === t._id}
                select={() =>
                  f.setSelectedTag(f.selectedTag === t._id ? "" : t._id)
                }
              />
            ))
          )}
        </Section>
        {facetsLoading ? (
          <p className="cr-hint">در حال دریافت ویژگی‌ها…</p>
        ) : (
          facets?.map((facet) => (
            <Section
              title={facet.name}
              key={facet.slug}
              count={f.selectedAttributes[facet.slug] ? 1 : 0}
            >
              {facet.values.map((v) => (
                <Choice
                  key={v.value}
                  name={v.value}
                  count={v.count}
                  checked={f.selectedAttributes[facet.slug] === v.value}
                  select={() =>
                    f.setAttribute(
                      facet.slug,
                      f.selectedAttributes[facet.slug] === v.value
                        ? ""
                        : v.value
                    )
                  }
                />
              ))}
            </Section>
          ))
        )}
        <Section title="ویژگی‌ها">
          <Link
            href={f.isDiscounted ? "/products" : "/products?discounted=true"}
            className="cr-switch"
            aria-label={
              f.isDiscounted ? "مشاهده همه محصولات" : "محصولات تخفیف‌دار"
            }
          >
            <span>فقط تخفیف‌دار</span>
            <span className={f.isDiscounted ? "on" : ""} />
          </Link>
          <p className="cr-hint">
            فهرست فعلی فروشگاه فقط کالاهای دارای موجودی را نشان می‌دهد.
          </p>
        </Section>
      </>
    );
  }
  return (
    <div className="cr-catalog" dir="rtl">
      <div className="cr-inner">
        <nav className="cr-breadcrumb" aria-label="مسیر صفحه">
          <Link href="/">خانه</Link>
          <span>/</span>
          <span>لیست محصولات</span>
        </nav>
        <header className="cr-hero">
          <div>
            <span className="cr-badge">
              <Sparkles size={15} /> انتخاب دقیق، خرید آسان
            </span>
            <h1>
              {f.isDiscounted ? "محصولات تخفیف‌دار" : "لیست محصولات"}{" "}
              <em>فروشگاه</em>
            </h1>
            <p>
              با جستجو و فیلترهای دقیق، محصول مناسب خود را از میان کالاهای
              فروشگاه پیدا کنید.
            </p>
          </div>
          <div className="cr-metrics">
            <div>
              <strong>{isLoading ? "…" : total.toLocaleString("fa-IR")}</strong>
              <span>نتیجه جستجو</span>
            </div>
            <div>
              <strong>{brands?.length.toLocaleString("fa-IR") || "…"}</strong>
              <span>برند</span>
            </div>
          </div>
        </header>
        <div className="cr-category-rail">
          <button
            aria-pressed={!f.selectedCategory}
            onClick={() => f.setSelectedCategory("")}
          >
            همه محصولات
          </button>
          {categories?.map((c) => (
            <button
              key={c._id}
              aria-pressed={f.selectedCategory === c._id}
              onClick={() =>
                f.setSelectedCategory(f.selectedCategory === c._id ? "" : c._id)
              }
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="cr-layout">
          <aside className="cr-sidebar" aria-label="فیلتر محصولات">
            {filters("desktop")}
          </aside>
          <section className="cr-results" aria-label="نتایج محصولات">
            <div className="cr-toolbar">
              <span>
                <b>{total.toLocaleString("fa-IR")}</b> کالا یافت شد
              </span>
              <div className="cr-toolbar-actions">
                <button className="cr-mobile-filter" onClick={openFilters}>
                  <SlidersHorizontal size={16} /> فیلترها{" "}
                  {f.activeFilterCount > 0 && (
                    <span className="cr-count">{f.activeFilterCount}</span>
                  )}
                </button>
                <label className="cr-sort">
                  <span className="sr-only">مرتب‌سازی</span>
                  <select
                    aria-label="مرتب‌سازی محصولات"
                    value={f.sortBy}
                    onChange={(e) => f.setSortBy(e.target.value)}
                  >
                    {sorts.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="cr-view">
                  <button
                    aria-label="نمایش شبکه‌ای"
                    aria-pressed={view === "grid"}
                    onClick={() => setView("grid")}
                  >
                    <LayoutGrid size={17} />
                  </button>
                  <button
                    aria-label="نمایش فهرستی"
                    aria-pressed={view === "list"}
                    onClick={() => setView("list")}
                  >
                    <List size={17} />
                  </button>
                </div>
              </div>
            </div>
            <div className="cr-main-search">
              <label className="cr-search">
                <Search size={17} />
                <input
                  aria-label="جستجوی محصولات با پیشنهاد"
                  placeholder="جستجوی محصولات..."
                  value={f.searchQuery}
                  onChange={(e) => {
                    f.setSearchQuery(e.target.value);
                    setSuggestions(true);
                  }}
                  onFocus={() => setSuggestions(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSuggestions(false);
                  }}
                />
              </label>
              <SearchSuggestions
                query={f.searchQuery}
                visible={suggestions}
                onSelect={(v) => {
                  f.setSearchQuery(v);
                  setSuggestions(false);
                }}
                onClose={() => setSuggestions(false)}
              />
            </div>
            {chips.length > 0 && (
              <div className="cr-chips">
                {chips.map((c) => (
                  <button key={c.key} onClick={c.remove}>
                    {c.label}
                    <X size={13} />
                    <span className="sr-only">حذف فیلتر</span>
                  </button>
                ))}
                <button className="cr-clear" onClick={f.clearFilters}>
                  پاک کردن همه
                </button>
              </div>
            )}
            {isLoading ? (
              <div className="cr-grid">
                {Array.from({ length: 6 }, (_, i) => (
                  <div className="cr-skeleton" key={i} aria-hidden="true" />
                ))}
              </div>
            ) : isError ? (
              <div className="cr-empty" role="alert">
                <h2>خطا در دریافت محصولات</h2>
                <button onClick={() => void refetch()}>
                  <RefreshCw size={16} /> تلاش مجدد
                </button>
              </div>
            ) : !products.length ? (
              <div className="cr-empty">
                <h2>
                  {emptyDiscount
                    ? "در حال حاضر تخفیف فعالی وجود ندارد"
                    : "محصولی یافت نشد"}
                </h2>
                <p>
                  {emptyDiscount
                    ? "برای مشاهده تخفیف‌های آینده، بعداً دوباره سر بزنید"
                    : "فیلترهای خود را تغییر دهید یا پاک کنید."}
                </p>
                <button onClick={f.clearFilters}>
                  {emptyDiscount ? "مشاهده همه محصولات" : "پاک کردن فیلترها"}
                </button>
              </div>
            ) : (
              <>
                <div className={`cr-grid ${view === "list" ? "cr-list" : ""}`}>
                  {products.map((product) => (
                    <ProductCard
                      key={product._id}
                      product={product}
                      onCountdownExpire={f.isDiscounted ? onExpired : undefined}
                    />
                  ))}
                </div>
                <div className="cr-pagination">
                  <p>
                    نمایش {products.length.toLocaleString("fa-IR")} محصول از{" "}
                    {total.toLocaleString("fa-IR")} محصول
                  </p>
                  <PaginationControls
                    page={f.page}
                    totalPages={paged?.totalPages || 1}
                    hrefFor={f.pageHref}
                  />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
      <dialog
        ref={dialogRef}
        className="cr-drawer"
        aria-labelledby="cr-drawer-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="cr-drawer-head">
          <h2 id="cr-drawer-title">فیلتر محصولات</h2>
          <button
            aria-label="بستن فیلترها"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <div className="cr-drawer-body">{filters("mobile")}</div>
        <div className="cr-drawer-footer">
          <button onClick={() => dialogRef.current?.close()}>
            نمایش نتایج ({total.toLocaleString("fa-IR")})
          </button>
        </div>
      </dialog>
    </div>
  );
}
