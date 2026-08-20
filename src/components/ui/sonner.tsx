"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Toaster as Sonner } from "sonner";
import { cn } from "@/lib/utils";
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Session 86 — route-aware toast theme.
 *
 * The single shared Toaster (root Providers, one instance) must match the
 * page's visual language: the storefront is the fixed-dark `.storefront`
 * scope (no `dark` class is ever set), while admin/supplier/auth stay light.
 * Sonner renders its fixed-position toaster inline at the mount point (root
 * layout, outside `.storefront`), so its CSS variables resolve to the LIGHT
 * `:root` tokens even on storefront routes. The storefront branch therefore
 * sets `theme="dark"` (sonner's own dark variables + dark rich-colors) AND
 * explicit dark classNames (so whichever rule wins the cascade, the toast is
 * dark/glass). The non-storefront branch is byte-identical to the previous
 * behavior.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");

  // Storefront = everything that is NOT admin/supplier/auth (the storefront
  // is the public default; null pathname during SSR → storefront).
  const isStorefront =
    !pathname ||
    !/^\/(admin|supplier|login|register|forgot-password)(\/|$)/.test(pathname);

  useEffect(() => {
    // Detect dark mode from html class (Tailwind v4 default)
    const html = document.documentElement;
    const updateTheme = () => {
      setTheme(html.classList.contains("dark") ? "dark" : "light");
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={isStorefront ? "dark" : theme}
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
            "group toast group-[.toaster]:shadow-lg",
            isStorefront
              ? // Dark-glass storefront toast (explicit values — the toaster
                // lives outside the .storefront scope so tokens resolve light).
                "group-[.toaster]:bg-[hsl(228_25%_5%)] group-[.toaster]:text-[hsl(0_0%_97%)] group-[.toaster]:border-white/10"
              : // Admin/supplier/auth — unchanged light-token behavior.
                "group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border"
          ),
          description: cn(
            "group-[.toast]:text-muted-foreground",
            isStorefront && "group-[.toast]:text-white/70"
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
