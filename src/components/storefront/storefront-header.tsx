"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  ShoppingCart,
  Heart,
  X,
  Home,
  Package,
  Tag,
  ClipboardList,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { useCartStore } from "@/stores/cart-store";
import { useWishlistIds } from "@/hooks/use-wishlist";
import { NotificationBell } from "@/components/storefront/notification-bell";
import { SearchSuggestions } from "@/components/storefront/search-suggestions";
import { AccountMenu } from "@/components/storefront/account-menu";
import { ThemeSwitcher } from "@/components/storefront/theme-switcher";

/**
 * Shared storefront header (Session 50; Session 93 — UI/UX modernization).
 *
 * Session 93 changes (presentation only — every link, gate and behavior is
 * unchanged):
 *  - all surfaces/labels now use the theme-agnostic `sf-*` tokens so the bar
 *    renders correctly in BOTH the dark and the light storefront theme
 *    (`glass-strong` is token-driven and adapts automatically);
 *  - the Theme Switcher joins the action cluster (desktop + mobile reachable);
 *  - nav links get a pill-shaped active state with a real focus-visible ring;
 *  - every action icon is a 40px (44px touch) hit target via `sf-icon-btn`;
 *  - a compact, horizontally scrollable nav row makes primary destinations
 *    reachable on phones (previously the nav was `lg:flex` only, so mobile had
 *    no navigation at all);
 *  - counter badges keep AA-contrast fills.
 */
export function StorefrontHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  // Session 63.1 — wishlist is a CUSTOMER-only feature (the page gate renders
  // the sign-in prompt and the API 403s for every other role), so its header
  // entry points (desktop nav link, heart icon, account-menu item) must only
  // appear for authenticated customers. Other roles must never see a link
  // that lands on the "please sign in" prompt.
  const isCustomer = session?.user?.role === "customer";
  const itemCount = useCartStore((s) =>
    s.items.reduce((sum, i) => sum + i.quantity, 0)
  );
  const { data: wishlist } = useWishlistIds();
  const wishlistCount = wishlist?.count || 0;
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  /** Primary destinations — shared by the desktop nav and the mobile nav row. */
  const navItems = [
    { href: "/", label: "صفحه اصلی", icon: Home, exact: true },
    { href: "/products", label: "محصولات", icon: Package, exact: false },
    ...(session
      ? [
          { href: "/coupons", label: "کدهای تخفیف", icon: Tag, exact: false },
          { href: "/orders", label: "سفارشات", icon: ClipboardList, exact: false },
        ]
      : []),
    ...(isCustomer
      ? [{ href: "/wishlist", label: "علاقه‌مندی‌ها", icon: Heart, exact: false }]
      : []),
  ];

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    /* `glass-strong` is token-driven: a translucent dark glass bar in the dark
       theme and a frosted white bar in the light theme. */
    <header className="glass-strong sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-3">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="blue-grad flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold text-white shadow-lg shadow-primary/25">
              S
            </span>
            <span className="text-xl font-bold tracking-tight text-foreground">
              {APP_NAME}
            </span>
          </Link>

          <nav aria-label="ناوبری اصلی" className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => {
              const active = isActive(item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-sf-dim hover:bg-sf-chip hover:text-sf-strong"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop search */}
          <div className="relative hidden max-w-lg flex-1 lg:block">
            <HeaderSearchBox />
          </div>

          <div className="ms-auto flex items-center gap-1 sm:gap-1.5">
            {/* Mobile search toggle */}
            <button
              type="button"
              aria-label={mobileSearchOpen ? "بستن جستجو" : "جستجو"}
              aria-expanded={mobileSearchOpen}
              onClick={() => setMobileSearchOpen((v) => !v)}
              className="sf-icon-btn h-10 w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 lg:hidden"
            >
              {mobileSearchOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </button>

            <ThemeSwitcher className="hidden md:inline-flex" />

            {session && <NotificationBell href="/notifications" />}

            {isCustomer && (
              <Link
                href="/wishlist"
                aria-label={
                  wishlistCount > 0
                    ? `علاقه‌مندی‌ها، ${wishlistCount} مورد`
                    : "علاقه‌مندی‌ها"
                }
                className="sf-icon-btn relative h-10 w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
              >
                <Heart className="h-5 w-5" />
                {wishlistCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
                    {wishlistCount > 99 ? "99+" : wishlistCount}
                  </span>
                )}
              </Link>
            )}

            <Link
              href="/cart"
              aria-label={
                itemCount > 0 ? `سبد خرید، ${itemCount} کالا` : "سبد خرید"
              }
              className="sf-icon-btn relative h-10 w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-700 px-1 text-[9px] font-bold text-white">
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              )}
            </Link>

            {session ? (
              <AccountMenu />
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden rounded-xl px-3 py-2 text-sm font-medium text-sf-dim transition-colors hover:bg-sf-chip hover:text-sf-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:block"
                >
                  ورود
                </Link>
                <Link
                  href="/register"
                  className="rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  ثبت‌نام
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Mobile search row */}
        {mobileSearchOpen && (
          <div className="relative pb-3 lg:hidden">
            <HeaderSearchBox
              autoFocus
              onNavigated={() => setMobileSearchOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Mobile primary nav — a compact, scrollable chip row (the desktop nav
          above is lg-only, so phones previously had no navigation at all).
          Every chip is a real link with a 40px hit target. */}
      <div className="lg:hidden">
        <nav
          aria-label="ناوبری موبایل"
          className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 pb-2 scrollbar-none sm:px-6"
        >
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={`m-${item.href}`}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-sf-line bg-sf-chip text-sf-dim hover:text-sf-strong"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
          {/* Theme switcher stays reachable on the narrowest screens. */}
          <ThemeSwitcher className="md:hidden" />
        </nav>
      </div>
    </header>
  );
}

interface HeaderSearchBoxProps {
  autoFocus?: boolean;
  onNavigated?: () => void;
}

/**
 * Search input + Session 49 suggestions dropdown.
 * Selecting a suggestion navigates to the catalog with ?search= prefilled
 * (useCatalogFilters seeds its state from the URL once on mount).
 */
function HeaderSearchBox({ autoFocus, onNavigated }: HeaderSearchBoxProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const navigate = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    router.push(`/products?search=${encodeURIComponent(trimmed)}`);
    setQuery("");
    setOpen(false);
    onNavigated?.();
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sf-dim" />
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        aria-label="جستجو در محصولات"
        placeholder="جستجو در محصولات…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate(query);
          if (e.key === "Escape") setOpen(false);
        }}
        /* Theme-agnostic search pill: chip surface + line border in both
           themes, brand-blue focus border and ring. */
        className="h-10 w-full rounded-full border border-sf-line bg-sf-chip pr-4 pl-9 text-sm text-sf-strong outline-none transition-all placeholder:text-sf-dim focus:border-primary/60 focus:ring-2 focus:ring-primary/25"
      />
      <SearchSuggestions
        query={query}
        visible={open}
        onSelect={navigate}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
