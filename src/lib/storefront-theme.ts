/**
 * Storefront theme architecture (Session 93).
 *
 * The storefront has TWO complete themes driven by one CSS token layer in
 * `src/app/globals.css`:
 *
 *   • `dark`  — the brand direction the storefront shipped with (default).
 *   • `light` — a full, professional white theme.
 *
 * The active theme lives as `data-sf-theme="dark" | "light"` on <html>:
 *
 *   `html:not([data-sf-theme="light"]) .storefront` → dark token set
 *   (anything else)                                  → the light `:root` set
 *
 * That means the DEFAULT (no attribute at all — e.g. JavaScript disabled, or
 * the first paint before the init script runs) is dark, exactly matching the
 * storefront's existing look. Nothing in this module touches the DOM at import
 * time so it is safe to import from Server Components (the root layout imports
 * `STOREFRONT_THEME_INIT_SCRIPT`) and from client components alike.
 *
 * Admin / supplier / auth areas never render `.storefront`, so the theme
 * selection cannot affect them.
 */

export const STOREFRONT_THEME_STORAGE_KEY = "marloo-storefront-theme";

export type StorefrontTheme = "dark" | "light";

/** The storefront's existing visual direction — the safe default. */
export const DEFAULT_STOREFRONT_THEME: StorefrontTheme = "dark";

export const STOREFRONT_THEME_ATTRIBUTE = "data-sf-theme";

export function isStorefrontTheme(value: unknown): value is StorefrontTheme {
  return value === "dark" || value === "light";
}

/**
 * Inline, render-blocking theme initializer.
 *
 * Runs in <head> BEFORE the body paints, so the correct theme is applied
 * without a flash of the wrong theme. Kept as a dependency-free minified IIFE
 * (no imports, no module scope) because it is injected as a raw <script>.
 * Wrapped in try/catch so a blocked localStorage (private mode / strict
 * privacy settings) can never break the page — it simply falls back to dark.
 */
export const STOREFRONT_THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  STOREFRONT_THEME_STORAGE_KEY
)};var a=${JSON.stringify(STOREFRONT_THEME_ATTRIBUTE)};var t=localStorage.getItem(k);if(t!=="light"&&t!=="dark"){t="dark";}document.documentElement.setAttribute(a,t);}catch(e){document.documentElement.setAttribute("data-sf-theme","dark");}})();`;

/* ─────────────────────────────────────────────────────────────────────────────
   Client helpers. Every function below no-ops safely during SSR.
   ──────────────────────────────────────────────────────────────────────────── */

/** Reads the theme currently applied to <html> (falls back to the default). */
export function readStorefrontThemeFromDom(): StorefrontTheme {
  if (typeof document === "undefined") return DEFAULT_STOREFRONT_THEME;
  const value = document.documentElement.getAttribute(
    STOREFRONT_THEME_ATTRIBUTE
  );
  return isStorefrontTheme(value) ? value : DEFAULT_STOREFRONT_THEME;
}

/** Reads the persisted preference (falls back to the default). */
export function readStoredStorefrontTheme(): StorefrontTheme {
  if (typeof window === "undefined") return DEFAULT_STOREFRONT_THEME;
  try {
    const value = window.localStorage.getItem(STOREFRONT_THEME_STORAGE_KEY);
    return isStorefrontTheme(value) ? value : DEFAULT_STOREFRONT_THEME;
  } catch {
    return DEFAULT_STOREFRONT_THEME;
  }
}

/** Notifies subscribers (see `subscribeStorefrontTheme`). */
let themeListeners: Array<() => void> = [];

/**
 * Applies a theme to <html> and (optionally) persists it. No page reload, no
 * navigation — the whole re-theme is a single attribute swap, so it works
 * during a client-side navigation without re-rendering the React tree.
 */
export function applyStorefrontTheme(
  theme: StorefrontTheme,
  { persist = true }: { persist?: boolean } = {}
): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(STOREFRONT_THEME_ATTRIBUTE, theme);
  if (persist) {
    try {
      window.localStorage.setItem(STOREFRONT_THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — the in-memory/DOM theme still applies */
    }
  }
  themeListeners.forEach((listener) => listener());
}

/** `useSyncExternalStore` subscribe contract for the Theme Switcher. */
export function subscribeStorefrontTheme(listener: () => void): () => void {
  themeListeners.push(listener);
  // Cross-tab sync: another tab changing the preference re-applies it here.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STOREFRONT_THEME_STORAGE_KEY) return;
    if (isStorefrontTheme(e.newValue)) {
      applyStorefrontTheme(e.newValue, { persist: false });
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    themeListeners = themeListeners.filter((l) => l !== listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Client snapshot for `useSyncExternalStore`. Returns a primitive so React's
 * snapshot cache stays stable.
 */
export function getStorefrontThemeSnapshot(): StorefrontTheme {
  return readStorefrontThemeFromDom();
}

/** Server/hydration snapshot — always the default (deterministic SSR markup). */
export function getStorefrontThemeServerSnapshot(): StorefrontTheme {
  return DEFAULT_STOREFRONT_THEME;
}
