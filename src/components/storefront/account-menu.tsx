"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { User, ShoppingBag, Heart, Bell, LogOut } from "lucide-react";
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
          "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          open && "bg-accent text-accent-foreground"
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
          className="absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border bg-card p-1 shadow-lg"
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
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <div role="separator" className="my-1 h-px bg-border" />

          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-4 w-4" />
            <span>خروج</span>
          </button>
        </div>
      )}
    </div>
  );
}
