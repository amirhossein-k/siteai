"use client";

import { useSession } from "next-auth/react";
import { Menu, Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/stores";

export function AdminHeader() {
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
            placeholder="جستجو در پنل مدیریت..."
            className="pr-9"
          />
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
            3
          </span>
        </Button>

        <div className="flex items-center gap-3 border-r pr-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
            {session?.user?.name?.[0] || "A"}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium">
              {session?.user?.name || "ادمین"}
            </p>
            <p className="text-xs text-muted-foreground">مدیر سیستم</p>
          </div>
        </div>
      </div>
    </header>
  );
}
