"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Wallet,
  LogOut,
  ChevronLeft,
  Store,
  MessageSquareText,
  FileUp,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores";

const navItems = [
  {
    title: "داشبورد",
    href: "/supplier/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "محصولات من",
    href: "/supplier/products",
    icon: Package,
  },
  {
    title: "ورود انبوه",
    href: "/supplier/products/import",
    icon: FileUp,
  },
  {
    title: "سفارشات",
    href: "/supplier/orders",
    icon: ShoppingCart,
  },
  {
    title: "کیف پول",
    href: "/supplier/wallet",
    icon: Wallet,
  },
  {
    title: "پاسخ به دیدگاه‌ها",
    href: "/supplier/reviews",
    icon: MessageSquareText,
  },
  {
    // Session 68 — order-linked customer support (own conversations only).
    title: "ارتباط با مشتریان",
    href: "/supplier/support",
    icon: MessageSquareText,
  },
];

interface SupplierSidebarProps {
  /** "desktop" (default) = the fixed lg+ column; "mobile" = drawer panel content. */
  variant?: "desktop" | "mobile";
}

export function SupplierSidebar({ variant = "desktop" }: SupplierSidebarProps) {
  const pathname = usePathname();
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  // In the mobile drawer, a nav click closes the drawer (the sidebar is a
  // client component, so it reads the store directly — no callback needs to
  // cross the RSC -> client boundary). Desktop nav clicks are unchanged.
  const onNavClick = variant === "mobile" ? () => setSidebarOpen(false) : undefined;

  return (
    <aside
      className={cn(
        "w-64 border-l bg-card",
        variant === "desktop"
          ? "hidden lg:flex lg:flex-col"
          : "flex h-full flex-col overflow-y-auto"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-primary-foreground text-sm font-bold">
          S
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">پنل فروشنده</span>
          <span className="text-[10px] text-muted-foreground">فروشگاه من</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.title}</span>
              {isActive && <ChevronLeft className="mr-auto h-4 w-4" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-4">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Store className="h-4 w-4" />
          <span>نمایش فروشگاه</span>
        </Link>
        <Button
          variant="ghost"
          className="mt-1 w-full justify-start gap-3 text-sm font-medium text-muted-foreground"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          <LogOut className="h-4 w-4" />
          <span>خروج</span>
        </Button>
      </div>
    </aside>
  );
}
