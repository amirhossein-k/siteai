"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { useAppStore } from "@/stores";
import { cn } from "@/lib/utils";

interface MobileDrawerProps {
  /** Drawer content — typically the same sidebar component used on desktop (variant="mobile"). */
  children: ReactNode;
}

/**
 * Mobile sidebar drawer (Session 52 — mobile dashboard navigation fix).
 *
 * The desktop sidebars are `hidden lg:flex` (desktop-only), and the header
 * Menu button toggles `isSidebarOpen` in the app store — but nothing rendered
 * that state on mobile, so the button did nothing. This fixed overlay +
 * slide-in panel consumes `isSidebarOpen` and renders the sidebar content on
 * mobile (< lg). Desktop behavior is unchanged: the drawer is `lg:hidden`
 * and inert when closed.
 *
 * NOTE: children must be plain ReactNode (NOT a function). The layouts are
 * Server Components — passing a function (render-prop) into this client
 * component throws "Functions are not valid as a child of Client Components".
 * Nav links close the drawer themselves via the store (they are client
 * components), so no close callback needs to cross the boundary.
 *
 * RTL-aware: the panel slides in from the right (dir="rtl" layouts).
 */
export function MobileDrawer({ children }: MobileDrawerProps) {
  const isOpen = useAppStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);

  const close = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, close]);

  return (
    <div
      className={cn("fixed inset-0 z-50 lg:hidden", !isOpen && "pointer-events-none")}
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
        onClick={close}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="منوی پیمایش"
        className={cn(
          "absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-hidden bg-card shadow-xl transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={close}
          aria-label="بستن منو"
          className="absolute left-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {children}
      </div>
    </div>
  );
}
