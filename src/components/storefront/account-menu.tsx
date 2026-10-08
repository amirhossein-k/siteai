"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { User, ShoppingBag, Heart, Bell, LogOut, Store, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Session 63 — storefront account menu (logout + account links).
 *
 * Replaces the header's plain profile <Link> when the user is signed in.
 * Desktop + mobile (tap-driven). RTL-aware: the icons cluster sits at the RTL
 * end (left) of the header, so the panel anchors to the trigger's LEFT edge
 * and extends rightward into the viewport — no overflow on any breakpoint.
 *
 * A11y (Session 61 axe discipline): the trigger exposes `aria-haspopup="menu"`
 * + `aria-expanded`; the panel is a `role="menu"` with `role="menuitem"`
 * entries; Escape closes the panel and returns focus to the trigger; outside
 * pointer-down and route changes close it too. Full arrow-key navigation is
 * intentionally OUT of scope (pointer-first — the same decision the
 * search-suggestions listbox documents).
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();
  // Session 63.1 — wishlist is a customer-only feature (the page + API gate
  // on role === "customer"), so its menu item must not appear for admin /
  // supplier sessions — otherwise an authenticated non-customer lands on the
  // wishlist page's "please sign in" prompt.
  const isCustomer = session?.user?.role === "customer";
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = "account-menu-panel";

  // Close on route change (navigating from inside the menu re-renders).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on outside pointer-down; Escape closes and returns focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Focus management: move into the panel when it opens.
  useEffect(() => {
    if (open) {
      panelRef.current
        ?.querySelector<HTMLElement>("[role='menuitem']")
        ?.focus();
    }
  }, [open]);

  const items = [
    { href: "/profile", label: "پروفایل", icon: User },
    { href: "/orders", label: "سفارشات", icon: ShoppingBag },
    // Wishlist is customer-only — hidden for admin/supplier sessions.
    ...(isCustomer
      ? [{ href: "/wishlist", label: "علاقه‌مندی‌ها", icon: Heart }]
      : []),
    // Session 67 — become-a-supplier entry (customer-only; suppliers/admins
    // already have their own dashboards and never need the application page).
    ...(isCustomer
      ? [{ href: "/become-supplier", label: "فروشنده شوید", icon: Store }]
      : []),
    // Session 68 — order-linked customer support (customer-only).
    ...(isCustomer
      ? [{ href: "/support", label: "پشتیبانی و پیگیری سفارش‌ها", icon: MessageSquareText }]
      : []),
    { href: "/notifications", label: "اعلان‌ها", icon: Bell },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="حساب کاربری"
        title="حساب کاربری"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "sf-icon-btn h-10 w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
          open && "bg-sf-chip text-sf-strong"
        )}
      >
        <User className="h-5 w-5" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label="حساب کاربری"
          className="absolute left-0 top-full z-50 mt-2 w-60 animate-in fade-in slide-in-from-top-2 overflow-hidden rounded-2xl border border-sf-line bg-popover p-1.5 shadow-2xl duration-150"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-sf-dim hover:bg-sf-chip hover:text-sf-strong"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <div role="separator" className="my-1.5 h-px bg-sf-line" />

          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60"
          >
            <LogOut className="h-4 w-4" />
            <span>خروج</span>
          </button>
        </div>
      )}
    </div>
  );
}
