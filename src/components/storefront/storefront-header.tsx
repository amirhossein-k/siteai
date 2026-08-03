"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, ShoppingCart, User, Heart, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { useCartStore } from "@/stores/cart-store";
import { useWishlistIds } from "@/hooks/use-wishlist";
import { NotificationBell } from "@/components/storefront/notification-bell";
import { SearchSuggestions } from "@/components/storefront/search-suggestions";

/**
 * Shared storefront header (Session 50).
 * Extracted from (storefront)/layout.tsx — identical behavior — plus a
 * header search box wired to the existing Session 49 suggestions endpoint
 * (no new API). Desktop: inline search in the middle; mobile: search icon
 * expands a dedicated search row.
 */
export function StorefrontHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const itemCount = useCartStore((s) =>
    s.items.reduce((sum, i) => sum + i.quantity, 0)
  );
  const { data: wishlist } = useWishlistIds();
  const wishlistCount = wishlist?.count || 0;
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-700 text-white text-sm font-bold shadow-lg dark:from-zinc-50 dark:to-zinc-300 dark:text-zinc-900">
              S
            </div>
            <span className="text-xl font-bold tracking-tight">{APP_NAME}</span>
          </Link>

          <nav className="hidden items-center gap-6 lg:flex">
            <Link
              href="/"
              className={cn(
                "text-sm font-medium transition-colors",
                pathname === "/"
                  ? "text-foreground border-b-2 border-foreground pb-0.5"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              صفحه اصلی
            </Link>
            <Link
              href="/products"
              className={cn(
                "text-sm font-medium transition-colors",
                pathname.startsWith("/products")
                  ? "text-foreground border-b-2 border-foreground pb-0.5"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              محصولات
            </Link>
            <Link
              href="/coupons"
              className={cn(
                "text-sm font-medium transition-colors",
                pathname.startsWith("/coupons")
                  ? "text-foreground border-b-2 border-foreground pb-0.5"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              کدهای تخفیف
            </Link>
            {session && (
              <>
                <Link
                  href="/orders"
                  className={cn(
                    "text-sm font-medium transition-colors",
                    pathname.startsWith("/orders")
                      ? "text-foreground border-b-2 border-foreground pb-0.5"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  سفارشات
                </Link>
                <Link
                  href="/wishlist"
                  className={cn(
                    "text-sm font-medium transition-colors",
                    pathname.startsWith("/wishlist")
                      ? "text-foreground border-b-2 border-foreground pb-0.5"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  علاقه‌مندی‌ها
                </Link>
              </>
            )}
          </nav>

          {/* Desktop search */}
          <div className="relative hidden flex-1 max-w-lg lg:block">
            <HeaderSearchBox />
          </div>

          <div className="ms-auto flex items-center gap-1.5 sm:gap-3">
            {/* Mobile search toggle */}
            <button
              type="button"
              aria-label={mobileSearchOpen ? "بستن جستجو" : "جستجو"}
              onClick={() => setMobileSearchOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:hidden"
            >
              {mobileSearchOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </button>

            {session && <NotificationBell href="/notifications" />}

            {session && (
              <Link
                href="/wishlist"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Heart className="h-5 w-5" />
                {wishlistCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
                    {wishlistCount > 99 ? "99+" : wishlistCount}
                  </span>
                )}
              </Link>
            )}

            <Link
              href="/cart"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              )}
            </Link>

            {session ? (
              <Link
                href="/profile"
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  pathname === "/profile" && "bg-accent text-accent-foreground"
                )}
                title="پروفایل"
              >
                <User className="h-5 w-5" />
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <span className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                    ورود
                  </span>
                </Link>
                <Link
                  href="/register"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
            <HeaderSearchBox autoFocus onNavigated={() => setMobileSearchOpen(false)} />
          </div>
        )}
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
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
        className="h-10 w-full rounded-xl border bg-muted/40 pr-4 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:bg-background"
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
