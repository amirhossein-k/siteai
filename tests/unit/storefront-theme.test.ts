import { describe, it, expect } from "vitest";
import {
  DEFAULT_STOREFRONT_THEME,
  STOREFRONT_THEME_ATTRIBUTE,
  STOREFRONT_THEME_INIT_SCRIPT,
  STOREFRONT_THEME_STORAGE_KEY,
  applyStorefrontTheme,
  getStorefrontThemeServerSnapshot,
  isStorefrontTheme,
  readStorefrontThemeFromDom,
  readStoredStorefrontTheme,
} from "@/lib/storefront-theme";

/**
 * Session 93 — storefront dual-theme module.
 *
 * These tests pin the CONTRACT the CSS depends on: the <html> attribute name,
 * the persistence key, the dark default, and the no-DOM safety of every
 * helper (the module is imported by the root Server Component, so it must never
 * touch `window`/`document` at import time).
 */
describe("storefront theme", () => {
  it("exposes a stable attribute + storage key", () => {
    expect(STOREFRONT_THEME_ATTRIBUTE).toBe("data-sf-theme");
    expect(STOREFRONT_THEME_STORAGE_KEY).toBe("marloo-storefront-theme");
  });

  it("defaults to the brand's existing dark direction", () => {
    expect(DEFAULT_STOREFRONT_THEME).toBe("dark");
    expect(getStorefrontThemeServerSnapshot()).toBe("dark");
  });

  it("only accepts the two supported themes", () => {
    expect(isStorefrontTheme("dark")).toBe(true);
    expect(isStorefrontTheme("light")).toBe(true);
    expect(isStorefrontTheme("system")).toBe(false);
    expect(isStorefrontTheme("")).toBe(false);
    expect(isStorefrontTheme(null)).toBe(false);
    expect(isStorefrontTheme(undefined)).toBe(false);
    expect(isStorefrontTheme(1)).toBe(false);
  });

  it("ships a render-blocking init script that applies the attribute", () => {
    // Self-invoking, so it can be injected as a bare <script> before paint.
    expect(STOREFRONT_THEME_INIT_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(STOREFRONT_THEME_INIT_SCRIPT.trimEnd().endsWith("})();")).toBe(true);

    // Reads the persisted preference…
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain(STOREFRONT_THEME_STORAGE_KEY);
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain("localStorage.getItem");
    // …writes it onto <html>…
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain(
      "document.documentElement.setAttribute"
    );
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain(STOREFRONT_THEME_ATTRIBUTE);
    // …validates the stored value…
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain('t!=="light"');
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain('t!=="dark"');
    // …falls back to dark, and can never throw on blocked storage.
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain("catch");
    expect(STOREFRONT_THEME_INIT_SCRIPT).toContain('"dark"');
  });

  it("is a pure no-op without a DOM (Node / server render)", () => {
    expect(typeof document).toBe("undefined");
    expect(readStorefrontThemeFromDom()).toBe("dark");
    expect(readStoredStorefrontTheme()).toBe("dark");
    expect(() => applyStorefrontTheme("light")).not.toThrow();
  });
});
