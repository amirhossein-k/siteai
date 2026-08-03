"use client";

import { useSession } from "next-auth/react";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores";
import { NotificationBell } from "@/components/storefront/notification-bell";

export function SupplierHeader() {
  const { data: session } = useSession();
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-card px-6">
      {/* Mobile menu toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={toggleSidebar}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Search */}
      <div className="hidden flex-1 sm:block">
        <div className="relative max-w-md">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجو در پنل فروشنده..."
            className="pr-9"
          />
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        <NotificationBell href="/supplier/notifications" />

        <div className="flex items-center gap-3 border-r pr-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-medium text-emerald-700">
            {session?.user?.name?.[0] || "S"}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium">
              {session?.user?.name || "فروشنده"}
            </p>
            <p className="text-xs text-muted-foreground">تأمین‌کننده</p>
          </div>
        </div>
      </div>
    </header>
  );
}
