/**
 * Session 93 — the price-stamp line on the PUBLIC product detail view.
 *
 * Deviation #3 of the approved plan: the indicator must render the SERVER-built
 * label and must render NOTHING when the payload carries no label (legacy
 * products / list payloads) — never a placeholder such as «-» or «نامشخص», and
 * never a client-side re-derivation of the timestamp.
 *
 * No @testing-library/react in this repo: the component is rendered with
 * `renderToStaticMarkup` (same approach as tests/unit/product-description.test.ts).
 * The interactive collaborators are stubbed so the render is deterministic and
 * DOM-free; every PRICING/render decision stays the component's own.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));

// react-query hooks need a provider that a static render cannot supply.
vi.mock("@/hooks/use-wishlist", () => ({
  useWishlistIds: () => ({ data: undefined }),
  useToggleWishlist: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/stores/cart-store", () => ({
  useCartStore: (selector: (state: { addItem: () => void }) => unknown) =>
    selector({ addItem: vi.fn() }),
}));

// next/image needs the Next runtime; a plain <img> keeps the static render pure.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) =>
    React.createElement("a", { href: String(href) }, children),
}));

// Descendant sections that themselves require a QueryClientProvider; they are
// unrelated to the price card under test, so they render as inert markers. The
// price card + meta area (where the stamp line lives) stay REAL.
vi.mock("@/components/storefront/reviews-section", () => ({
  ReviewsSection: () => React.createElement("div", { "data-stub": "reviews" }),
}));
vi.mock("@/components/storefront/variant-selector", () => ({
  VariantSelector: () => React.createElement("div", { "data-stub": "variants" }),
}));
vi.mock("@/components/storefront/discount-countdown", () => ({
  DiscountCountdown: () => React.createElement("div", { "data-stub": "countdown" }),
}));
vi.mock("@/components/storefront/image-lightbox", () => ({
  ImageLightbox: () => null,
}));

import { ProductDetailView } from "@/components/storefront/product-detail-view";
import type { Product } from "@/types";

const LABEL = "آخرین تغییر تنظیمات قیمت و تخفیف: ۲۵ آبان ۱۴۰۳ ساعت ۰۳:۳۰";

function product(overrides: Partial<Product> = {}): Product {
  return {
    _id: "6aaab0a2351255a9fdea5c01",
    name: "گوشی تست",
    slug: "stamp-view-item",
    description: "توضیح",
    price: 1000000,
    effectivePrice: 1000000,
    discount: null,
    images: [],
    category: { _id: "6aaab0a2351255a9fdea5c02", name: "موبایل", slug: "mobile" },
    stock: 5,
    hasVariants: false,
    variants: [],
    isActive: true,
    ratingSummary: null,
    ...overrides,
  } as Product;
}

function render(p: Product): string {
  return renderToStaticMarkup(React.createElement(ProductDetailView, { product: p }));
}

describe("product detail — price-stamp line", () => {
  it("renders the server label verbatim when the payload carries one", () => {
    const html = render(product({ priceLastUpdatedLabel: LABEL }));
    expect(html).toContain(LABEL);
    // The label's own prefix proves it is the price-stamp line, not stray copy.
    expect(html).toContain("آخرین تغییر تنظیمات قیمت و تخفیف");
  });

  it("renders NOTHING when the label is absent (legacy product)", () => {
    const html = render(product({ priceLastUpdatedLabel: null }));
    expect(html).not.toContain("آخرین تغییر تنظیمات قیمت و تخفیف");
  });

  it("renders nothing when the field is entirely missing (pre-Session-93 payload)", () => {
    const html = render(product());
    expect(html).not.toContain("آخرین تغییر تنظیمات قیمت و تخفیف");
  });

  it("treats an EMPTY string as absent — never an empty row or placeholder", () => {
    const html = render(product({ priceLastUpdatedLabel: "" }));
    expect(html).not.toContain("آخرین تغییر");
  });

  it("the rendered string is the server's — no timestamp is re-derived client-side", () => {
    // A distinctive label must appear exactly as supplied.
    const custom = "آخرین تغییر تنظیمات قیمت و تخفیف: ۱ فروردین ۱۴۰۴ ساعت ۰۹:۰۵";
    const html = render(product({ priceLastUpdatedLabel: custom }));
    expect(html).toContain(custom);
  });
});
