"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  applyStorefrontTheme,
  getStorefrontThemeServerSnapshot,
  getStorefrontThemeSnapshot,
  subscribeStorefrontTheme,
  type StorefrontTheme,
} from "@/lib/storefront-theme";

interface ThemeSwitcherProps {
  /**
   * `icon` (default) — square icon-only button: used in the storefront header
   * icon cluster (desktop + mobile). `full` — icon + the current theme name:
   * used where horizontal room exists (account menu / wider header layouts).
   */
  variant?: "icon" | "full";
  className?: string;
}

/**
 * Storefront Theme Switcher (Session 93).
 *
 * Toggles the customer-facing theme between «تاریک» (dark) and «روشن» (light).
 *
 * Accessibility / UX contract:
 *  - a real <button> with an explicit `aria-label` that names the CURRENT
 *    state and the action ("حالت نمایش: تاریک. تغییر به روشن") — the state is
 *    therefore never communicated by colour alone;
 *  - the icon swaps between lucide `Moon` and `Sun` (shape, not colour);
 *  - `aria-pressed` reflects the light theme so assistive tech can read it;
 *  - 40×40px hit area (44px on touch via the padded wrapper below), visible
 *    `focus-visible` ring, `title` tooltip;
 *  - applying the theme is a single attribute swap on <html> — no reload, no
 *    navigation, so there is never a layout jump.
 */
export function ThemeSwitcher({
  variant = "icon",
  className,
}: ThemeSwitcherProps) {
  // `useSyncExternalStore` keeps SSR/hydration deterministic (server snapshot =
  // dark) while reading the live <html> attribute on the client — no
  // hydration mismatch warnings, no need for a mounted-state flag.
  const theme = useSyncExternalStore(
    subscribeStorefrontTheme,
    getStorefrontThemeSnapshot,
    getStorefrontThemeServerSnapshot
  );

  const nextTheme: StorefrontTheme = theme === "dark" ? "light" : "dark";
  const currentLabel = theme === "dark" ? "تاریک" : "روشن";
  const nextLabel = nextTheme === "dark" ? "تاریک" : "روشن";
  const Icon = theme === "dark" ? Moon : Sun;

  return (
    <button
      type="button"
      data-theme-switcher
      aria-label={`حالت نمایش: ${currentLabel}. تغییر به ${nextLabel}`}
      aria-pressed={theme === "light"}
      title={`تغییر به حالت ${nextLabel}`}
      onClick={() => applyStorefrontTheme(nextTheme)}
      className={cn(
        // Discoverability polish: a quiet chip surface + hairline border makes
        // the icon read as a button at a glance, while `sf-icon-btn` keeps the
        // token-driven hover (chip bg + strong text) and 40px target. The
        // primary-tinted hover border adds an unmistakable affordance without
        // extra visual weight.
        "sf-icon-btn group h-10 gap-2 border border-sf-line bg-sf-chip/80 px-2.5 text-sm font-medium hover:border-primary/50",
        variant === "full" && "px-3",
        // Visible focus treatment for both themes (ring token = brand blue).
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        {/* `key` remounts the icon on change so the tw-animate-css entry
            animation replays — a subtle, fast, purposeful micro-interaction. */}
        <Icon
          key={theme}
          aria-hidden="true"
          className="h-5 w-5 animate-in fade-in zoom-in-75 duration-200"
        />
      </span>
      {variant === "full" && (
        <span
          key={theme}
          className="hidden animate-in fade-in duration-200 sm:inline"
        >
          {currentLabel}
        </span>
      )}
    </button>
  );
}
