"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Toaster as Sonner } from "sonner";
import { cn } from "@/lib/utils";
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Route-aware toast theme (Session 86; Session 93 — dual storefront theme).
 *
 * The single shared Toaster (root Providers, one instance) must match the
 * page's visual language: the storefront now has TWO complete themes (selected
 * via `data-sf-theme` on <html>), while admin/supplier/auth stay light.
 *
 * Sonner renders its fixed-position toaster inline at the mount point (root
 * layout, OUTSIDE the `.storefront` wrapper), so the storefront's scoped
 * tokens never reach it. The storefront branch therefore passes sonner's own
 * `theme` (dark/light, matching the customer's selection) AND explicit
 * classNames built from the `--sf-toast-*` variables, which globals.css
 * re-scopes for the dark storefront via `html:has(.storefront)`. The
 * non-storefront branch is unchanged.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  // Storefront theme (dark brand default; "light" only when the customer
  // explicitly selected it — see src/lib/storefront-theme.ts).
  const [storefrontTheme, setStorefrontTheme] = useState<"light" | "dark">(
    "dark"
  );

  // Storefront = everything that is NOT admin/supplier/auth (the storefront
  // is the public default; null pathname during SSR → storefront).
  const isStorefront =
    !pathname ||
    !/^\/(admin|supplier|login|register|forgot-password)(\/|$)/.test(pathname);

  useEffect(() => {
    // Detect dark mode from the html class (Tailwind v4 default) AND the
    // storefront theme attribute added by the theme init script.
    const html = document.documentElement;
    const updateTheme = () => {
      setTheme(html.classList.contains("dark") ? "dark" : "light");
      setStorefrontTheme(
        html.getAttribute("data-sf-theme") === "light" ? "light" : "dark"
      );
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(html, {
      attributes: true,
      attributeFilter: ["class", "data-sf-theme"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={isStorefront ? storefrontTheme : theme}
      className="toaster group"
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: cn(
            "group toast group-[.toaster]:border group-[.toaster]:shadow-xl",
            isStorefront
              ? // Storefront toast — follows the customer's theme through the
                // --sf-toast-* variables (re-scoped for dark in globals.css).
                "group-[.toaster]:bg-[var(--sf-toast-bg)] group-[.toaster]:text-[var(--sf-toast-fg)] group-[.toaster]:border-[var(--sf-toast-line)]"
              : // Admin/supplier/auth — unchanged light-token behavior.
                "group-[.toaster]:border-transparent group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border"
          ),
          description: cn(
            isStorefront
              ? "group-[.toast]:text-[var(--sf-toast-dim)]"
              : "group-[.toast]:text-muted-foreground"
          ),
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
