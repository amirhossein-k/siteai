"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  X,
  LayoutGrid,
  ShoppingBag,
  CreditCard,
  Ticket,
  Truck,
  UserCircle,
  Package,
  Headphones,
  Store,
  ChevronDown,
  LifeBuoy,
  MessagesSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FAQ_CATEGORIES,
  FAQ_ITEMS,
  faqCountByCategory,
  type FaqCategoryId,
} from "@/lib/faq-content";

/** Sidebar/filter icon per category (lucide — matches the storefront language). */
const CATEGORY_ICON: Record<FaqCategoryId, typeof ShoppingBag> = {
  order: ShoppingBag,
  payment: CreditCard,
  discount: Ticket,
  shipping: Truck,
  account: UserCircle,
  product: Package,
  support: Headphones,
  supplier: Store,
};

type CategoryFilter = FaqCategoryId | "all";

/** Render an answer: plain paragraph, or an intro + bullet list. */
function AnswerText({ text }: { text: string }) {
  const lines = text.split("\n");
  const bullets = lines.filter((l) => l.startsWith("• ")).map((l) => l.slice(2));
  const intro = lines.filter((l) => !l.startsWith("• "));

  if (bullets.length === 0) {
    return <p className="sf-prose text-sf-dim">{text}</p>;
  }

  return (
    <div className="space-y-2">
      {intro.map((line, i) => (
        <p key={i} className="sf-prose text-sf-dim">
          {line}
        </p>
      ))}
      <ul className="list-disc space-y-2 ps-5 sf-prose text-sf-dim">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * FAQ page content (client island).
 *
 * Search + category filtering + accordion disclosure, driven entirely by the
 * static `src/lib/faq-content.ts` data (no fetches, no invented content). The
 * surrounding page (server component) supplies the header/footer via the
 * storefront layout, the breadcrumb and the FAQPage JSON-LD.
 *
 * A11y: real <button>/aria-expanded disclosure with a labelled region, an
 * sr-only labelled search box, aria-pressed filter buttons, an aria-live
 * result count, and a plain-text «پرتکرارترین» quick-jump grid. Reduced motion
 * is honoured globally by globals.css.
 */
export function FaqPageContent() {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => faqCountByCategory(), []);

  const popular = useMemo(() => FAQ_ITEMS.filter((f) => f.popular), []);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return FAQ_ITEMS.filter((item) => {
      const matchCategory =
        activeCategory === "all" || item.category === activeCategory;
      const matchSearch =
        !normalizedQuery ||
        item.question.toLowerCase().includes(normalizedQuery) ||
        item.answer.toLowerCase().includes(normalizedQuery);
      return matchCategory && matchSearch;
    });
  }, [activeCategory, normalizedQuery]);

  const isFiltered = normalizedQuery.length > 0 || activeCategory !== "all";
  const activeLabel =
    FAQ_CATEGORIES.find((c) => c.id === activeCategory)?.label ?? "همه سوالات";

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const resetFilters = () => {
    setQuery("");
    setActiveCategory("all");
    setOpenId(null);
  };

  const jumpTo = (id: string) => {
    setQuery("");
    setActiveCategory("all");
    setOpenId(id);
    if (typeof document !== "undefined") {
      window.setTimeout(() => {
        document
          .getElementById(`faq-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    }
  };

  return (
    <div className="pb-16">
      {/* ── Hero + search ─────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <div className="glass-panel relative overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-10 sm:py-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-1/2 h-64 w-64 translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
          />
          <div className="relative">
            {/* Readability pass — the pill used a translucent `bg-primary/10`,
                so the decorative blue glow behind the hero tinted the surface
                and dropped the label to 3.0–4.2:1 (measured from rendered
                pixels) in BOTH themes. An opaque card surface makes the
                primary label a solid 6.2:1 (light) / 5.3:1 (dark). */}
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-sf-card px-3.5 py-2 sf-label font-semibold text-primary">
              <MessagesSquare className="h-3.5 w-3.5" />
              پاسخ به سوالات رایج مشتریان
            </span>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
              سوالات متداول
            </h1>
            <p className="mx-auto mt-4 max-w-2xl sf-lead text-sf-dim">
              پاسخ پرسش‌های رایج درباره ثبت سفارش، پرداخت، تخفیف، ارسال، حساب
              کاربری و پشتیبانی فروشگاه را اینجا بیابید.
            </p>

            <div className="relative mx-auto mt-7 max-w-xl">
              <label htmlFor="faq-search" className="sr-only">
                جست‌وجو در سوالات متداول
              </label>
              <Search
                className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sf-dim"
                aria-hidden="true"
              />
              <input
                id="faq-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveCategory("all");
                  setOpenId(null);
                }}
                placeholder="جست‌وجو در سوالات…"
                className="h-12 w-full rounded-full border border-sf-line bg-sf-chip ps-11 pe-4 sf-prose text-sf-strong outline-none transition-all placeholder:text-sf-dim focus:border-primary/60 focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {/* Honest meta strip — derived from the content itself. */}
            <p className="mt-4 sf-meta text-sf-dim">
              {FAQ_ITEMS.length.toLocaleString("fa-IR")} پرسش در{" "}
              {FAQ_CATEGORIES.length.toLocaleString("fa-IR")} دسته‌بندی
            </p>
          </div>
        </div>
      </section>

      {/* ── Popular quick-jump ────────────────────────────────────────── */}
      {!isFiltered && (
        <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LayoutGrid className="h-4.5 w-4.5" />
            </span>
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              پرتکرارترین سوالات
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {popular.map((faq) => (
              <button
                key={faq.id}
                type="button"
                onClick={() => jumpTo(faq.id)}
                className="glass-card flex items-start gap-3 rounded-2xl p-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 sf-label font-bold text-primary">
                  ؟
                </span>
                <span className="sf-meta font-medium leading-7 text-sf-strong">
                  {faq.question}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Main: filters + list ──────────────────────────────────────── */}
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-10 sm:px-6 lg:grid-cols-[260px_1fr] lg:px-8">
        {/* Category sidebar. `min-w-0` lets the column shrink rather than
            forcing the grid track wider than the viewport when the reader
            enlarges text only (WCAG 1.4.4). */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-sf-line bg-sf-card/50 p-4">
            <p              className="mb-3 border-b border-sf-line pb-3 sf-meta font-bold text-primary">
              دسته‌بندی‌ها
            </p>
            <div className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:gap-1">
              <button
                type="button"
                aria-pressed={activeCategory === "all"}
                onClick={() => {
                  setActiveCategory("all");
                  setQuery("");
                  setOpenId(null);
                }}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start sf-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  activeCategory === "all"
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-sf-dim hover:bg-sf-chip hover:text-sf-strong"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <LayoutGrid className="h-4 w-4 shrink-0" />
                  همه سوالات
                </span>
                <span
                  className={cn(
                    "min-w-[28px] rounded-full px-2 py-1 text-center sf-label font-bold",
                    activeCategory === "all"
                      ? "bg-primary text-primary-foreground"
                      : "bg-sf-chip text-primary"
                  )}
                >
                  {FAQ_ITEMS.length.toLocaleString("fa-IR")}
                </span>
              </button>

              {FAQ_CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICON[cat.id];
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      setActiveCategory(cat.id);
                      setQuery("");
                      setOpenId(null);
                    }}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start sf-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                      isActive
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-sf-dim hover:bg-sf-chip hover:text-sf-strong"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0" />
                      {cat.label}
                    </span>
                    <span
                      className={cn(
                        "min-w-[28px] rounded-full px-2 py-1 text-center sf-label font-bold",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-sf-chip text-primary"
                      )}
                    >
                      {counts[cat.id].toLocaleString("fa-IR")}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Support CTA — links to the REAL support page (no fake form). */}
            <div className="blue-grad mt-4 rounded-2xl p-5 text-center text-white">
              <LifeBuoy className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              <p className="sf-meta font-semibold">پاسخ خود را پیدا نکردید؟</p>
              {/* Readability pass — plain white instead of white/85 so the
                  label clears AA on the brand gradient. */}
              <p className="mt-1 sf-meta text-white/95">
                تیم پشتیبانی آماده کمک به شماست.
              </p>
              <Link
                href="/support"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2.5 sf-label font-semibold text-zinc-900 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              >
                <Headphones className="h-4 w-4" />
                رفتن به پشتیبانی
              </Link>
            </div>
          </div>
        </aside>

        {/* FAQ list */}
        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                {normalizedQuery
                  ? `نتایج جست‌وجو برای «${query.trim()}»`
                  : activeLabel}
              </h2>
              <span
                aria-live="polite"
                className="rounded-full border border-primary/30 bg-primary/10 px-3 py-0.5 sf-label font-bold text-primary"
              >
                {filtered.length.toLocaleString("fa-IR")} پرسش
              </span>
            </div>
            {isFiltered && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-sf-chip px-3 py-2 sf-label text-sf-dim transition-colors hover:text-sf-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <X className="h-3.5 w-3.5" />
                پاک کردن فیلتر
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-sf-line-strong bg-sf-card/40 p-10 text-center">
              <Search
                className="mx-auto mb-4 h-10 w-10 text-sf-dim/50"
                aria-hidden="true"
              />
              <h3 className="mb-2 text-xl font-bold text-foreground">
                نتیجه‌ای یافت نشد
              </h3>
              <p className="mx-auto mb-5 max-w-md sf-prose text-sf-dim">
                سوال شما در فهرست سوالات متداول نبود. می‌توانید از صفحه پشتیبانی
                بپرسید.
              </p>
              <Link
                href="/support"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 sf-meta font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <Headphones className="h-4 w-4" />
                پرسیدن از پشتیبانی
              </Link>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {filtered.map((faq) => {
                const isOpen = openId === faq.id;
                const buttonId = `faq-q-${faq.id}`;
                const panelId = `faq-a-${faq.id}`;
                return (
                  <li
                    key={faq.id}
                    id={`faq-${faq.id}`}
                    className={cn(
                      "overflow-hidden rounded-2xl border bg-sf-card/50 transition-colors",
                      isOpen
                        ? "border-primary/40 ring-1 ring-primary/20"
                        : "border-sf-line hover:border-sf-line-strong"
                    )}
                  >
                    <h3 className="m-0">
                      <button
                        type="button"
                        id={buttonId}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => toggle(faq.id)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 sm:px-5"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sf-label font-bold transition-colors",
                              isOpen
                                ? "bg-primary text-primary-foreground"
                                : "bg-primary/10 text-primary"
                            )}
                            aria-hidden="true"
                          >
                            ؟
                          </span>
                          <span
                            className={cn(
                              "sf-prose transition-colors",
                              isOpen
                                ? "font-bold text-foreground"
                                : "font-semibold text-sf-strong"
                            )}
                          >
                            {faq.question}
                          </span>
                          {faq.popular && (
                            <span className="hidden shrink-0 rounded-full border border-sf-warning/40 bg-sf-warning/10 px-2 py-1 sf-label font-bold text-sf-warning sm:inline-block">
                              پرتکرار
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                            isOpen
                              ? "bg-primary text-primary-foreground"
                              : "bg-sf-chip text-primary"
                          )}
                          aria-hidden="true"
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform duration-300",
                              isOpen && "rotate-180"
                            )}
                          />
                        </span>
                      </button>
                    </h3>
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      className={cn(
                        "grid transition-all duration-300 ease-out",
                        isOpen
                          ? "grid-rows-[1fr] opacity-100"
                          : "grid-rows-[0fr] opacity-0"
                      )}
                    >
                      <div className="overflow-hidden">
                        <div className="border-t border-sf-line px-4 py-5 ps-14 sm:px-5 sm:ps-16">
                          <AnswerText text={faq.answer} />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
