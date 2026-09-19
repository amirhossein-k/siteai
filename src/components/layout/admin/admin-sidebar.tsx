"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Settings,
  LogOut,
  ChevronLeft,
  Store,
  FolderTree,
  Building2,
  Tags,
  Palette,
  Wallet,
  Star,
  Ticket,
  BarChart3,
  FileUp,
  LayoutTemplate,
  MessageSquareText,
  Bell,
  BookOpenCheck,
  Boxes,
  ReceiptText,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores";

const navItems = [
  {
    title: "داشبورد",
    href: "/admin/dashboard",
    icon: LayoutDashboard,
  },
  {
    // Session 80 — full notification inbox (the header bell links here too).
    title: "اعلان‌ها",
    href: "/admin/notifications",
    icon: Bell,
  },
  {
    // Session 81 — expanded reports subsystem (dashboard + sales/orders/
    // payments/refunds/coupons/customers/inventory/pnl + Excel exports).
    // The legacy 7/30/90-day analytics page stays at /admin/analytics.
    title: "گزارش‌ها",
    href: "/admin/reports",
    icon: BarChart3,
  },
  {
    // Session 82 — accounting cutover + opening-inventory FIFO initialization.
    title: "حسابداری",
    href: "/admin/accounting",
    icon: BookOpenCheck,
  },
  {
    // Session 82 Phase B — procurement (PurchaseOrder + receiving + FIFO layers).
    title: "خریدها",
    href: "/admin/purchases",
    icon: FileUp,
  },
  {
    // Session 82 Phase D — inventory adjustments + movement ledger + FIFO layers.
    title: "انبار",
    href: "/admin/inventory",
    icon: Boxes,
  },
  {
    // Session 82 Phase E — expense ledger (audited voids, feeds P&L net profit).
    title: "هزینه‌ها",
    href: "/admin/expenses",
    icon: ReceiptText,
  },
  {
    title: "صفحه اصلی",
    href: "/admin/homepage",
    icon: LayoutTemplate,
  },
  {
    title: "محصولات",
    href: "/admin/products",
    icon: Package,
  },
  {
    title: "ورود انبوه",
    href: "/admin/products/import",
    icon: FileUp,
  },
  {
    title: "برندها",
    href: "/admin/brands",
    icon: Building2,
  },
  {
    title: "برچسب‌ها",
    href: "/admin/tags",
    icon: Tags,
  },
  {
    title: "دسته‌بندی‌ها",
    href: "/admin/categories",
    icon: FolderTree,
  },
  {
    title: "ویژگی‌ها",
    href: "/admin/attributes",
    icon: Palette,
  },
  {
    title: "سفارشات",
    href: "/admin/orders",
    icon: ShoppingCart,
  },
  {
    title: "کاربران",
    href: "/admin/users",
    icon: Users,
  },
  {
    // Session 66 — dedicated supplier-management page (create / promote /
    // deactivate / view status / link to payouts).
    title: "فروشندگان",
    href: "/admin/suppliers",
    icon: Store,
  },
  {
    title: "دیدگاه‌ها",
    href: "/admin/reviews",
    icon: Star,
  },
  {
    // Session 68 — customer support queue (order-linked conversations).
    title: "مرکز پشتیبانی",
    href: "/admin/support",
    icon: MessageSquareText,
  },
  {
    // Session 90 — admin business-SMS management (templates / send log /
    // manual send). Independent from the OTP SMS flow by design.
    title: "پیامک‌ها",
    href: "/admin/sms",
    icon: MessageSquareText,
  },
  {
    title: "کدهای تخفیف",
    href: "/admin/coupons",
    icon: Ticket,
  },
  {
    title: "تسویه فروشندگان",
    href: "/admin/payouts",
    icon: Wallet,
  },
  {
    title: "تنظیمات",
    href: "/admin/settings",
    icon: Settings,
  },
];

interface AdminSidebarProps {
  /** "desktop" (default) = the fixed lg+ column; "mobile" = drawer panel content. */
  variant?: "desktop" | "mobile";
}

export function AdminSidebar({ variant = "desktop" }: AdminSidebarProps) {
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
          // The mobile drawer must keep the store-link/logout footer pinned
          // (Session 82 Phase E — the nav grew past the viewport fold, which
          // pushed «خروج» below the drawer and broke the mobile logout click;
          // only the nav scrolls, exactly like the desktop column).
          : "flex h-full flex-col overflow-hidden"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
          S
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">پنل مدیریت</span>
          <span className="text-[10px] text-muted-foreground">فروشگاه من</span>
        </div>
      </div>

      {/* Navigation */}
      <nav
        className={cn(
          "flex-1 space-y-1 p-4",
          // Mobile: only the nav scrolls so the store-link/logout footer stays
          // pinned (Session 82 Phase E — the 22-item nav outgrew the drawer).
          variant === "mobile" && "min-h-0 overflow-y-auto"
        )}
      >
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
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.title}</span>
              {isActive && (
                <ChevronLeft className="mr-auto h-4 w-4" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Store Link */}
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
