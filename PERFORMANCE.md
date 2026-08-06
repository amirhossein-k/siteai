# Performance & Accessibility — فروشگاه من (Online Store)

> **Created:** August 2026 (Session 61 — Performance & Accessibility)
> **Scope:** additive front-end + test-infra work only — **zero business-logic changes, zero model/schema/index/database changes, no money-flow or API behavior changes.**

This document records how the storefront handles image delivery and what the accessibility gate enforces, plus the known image-related debt and the next performance steps.

---

## 1. Image pipeline — `next/image` everywhere in the storefront

All **12 storefront image components** (17 `<Image>` instances) now go through the Next.js image optimizer instead of native `<img>`:

| Area | Files | Images |
| --- | --- | --- |
| Product catalog | `product-card.tsx`, `quick-categories.tsx` (category image) | 2 |
| Product detail | `products/[slug]/page.tsx` (main gallery + thumbnails), `image-lightbox.tsx` (zoom view + thumbs) | 4 |
| Cart / checkout | `cart/page.tsx`, `checkout/page.tsx` | 2 |
| Homepage CMS blocks | `hero-carousel.tsx` (mobile+desktop art), `campaign-banner.tsx`, `gift-collections.tsx` | 6 |
| Supplier surfaces | `supplier-card.tsx`, `suppliers/[id]/page.tsx` (logo), `order-invoice.tsx` (item thumb) | 3 |

Benefits gained:
- **Automatic AVIF/WebP negotiation + responsive `srcset`** from `images.deviceSizes`/`imageSizes` — browsers download only the size they need.
- **Lazy loading by default** (`loading="lazy"` is next/image's default) with `loading="eager"` reserved for above-the-fold/critical images (hero, product main gallery, cart/checkout line items, invoice).
- **Layout stability** — `fill` inside `relative` aspect-ratio containers (product cards, hero, thumbnails) eliminates layout shift while images load; explicit `width/height` where fixed dimensions apply (invoice, lightbox zoom).
- **Built-in `onError` fallbacks preserved** — cards/lightbox/cart still flip to their placeholder on a failed S3 fetch (behavior unchanged).

### Remote host allowlist (security)

`next.config.ts` → `images.remotePatterns` is an **additive allowlist** derived from environment at config-load time (never from user input):
- `LIARA_ENDPOINT` hostname (S3-compatible storage), falling back to the project's known Liara host `c589564.parspack.net` so builds without env still allowlist the right host;
- `NEXT_PUBLIC_APP_URL` hostname when set;
- `localhost` (http + https) — dev-only convenience so locally-imported image URLs keep working through the optimizer.

The optimizer is **never disabled** (`unoptimized` is not set) — all storefront images keep benefiting from format/size negotiation.

### Fail-safe client guard (why it exists)

`next/image` throws a **render-time** error when the `src` host is not in `remotePatterns` — where the old native `<img>` simply degraded to a broken image / `onError` placeholder. To preserve that behavior, every storefront image component renders `<Image>` only when **`isAllowedImageSrc(src)`** (`src/lib/utils.ts`) returns true; otherwise the existing placeholder (gradient art, letter tile, `ImageOff`, icon) is shown. The guard mirrors the allowlist (`LIARA` default host, `NEXT_PUBLIC_APP_URL` host, localhost) plus same-origin relative paths, and rejects protocol-relative `//host`, `data:`/`blob:` and malformed URLs. Trade-off: if the Liara endpoint ever changes in production, the client guard (which cannot read the server-only `LIARA_ENDPOINT`) would downgrade those images to placeholders rather than crash — fail-safe, and the S3 bucket host is expected to be stable.

### Loading strategy summary

- **Eager** (critical / above the fold): hero slides, product detail main image + thumbnails, product-card image (grid is the catalog's first paint), cart/checkout line items, supplier logo, lightbox, invoice.
- **Lazy** (below the fold): quick-categories images (the catalog filter tiles) — everything else inherits next/image's default lazy behavior.

---

## 2. Accessibility gate — axe-core (WCAG A/AA)

`tests/e2e/accessibility.spec.ts` (Journey 11, Session 61) runs **axe-core** (`@axe-core/playwright`) with the `wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa` tags over the highest-traffic **public** pages — homepage, catalog, product detail, supplier detail, login, register — and asserts **zero serious/critical violations** on the desktop `chromium` project.

- Runs as part of the normal `npm run e2e` (and therefore the Session 60 `ci.yml` e2e gate) — no extra CI wiring needed.
- Violations of **any** impact are printed to the run log for debuggability; only serious/critical block.
- `OUT_OF_SCOPE_RULE_IDS` in the spec is the documented escape hatch for violations found in files **outside** the Session 61 fixed set — each entry must carry a file/component note and becomes the Session 62 backlog (the array is empty when the scanned pages are fully clean).

### Session 61 accessibility fixes (files)

- `search-suggestions.tsx` — `role="option"` items now expose `aria-selected={false}` (WAI-ARIA listbox contract; keyboard navigation intentionally out of scope — pointer-only dropdown, no behavior change).
- `image-lightbox.tsx` — the backdrop is now a `<button aria-label="بستن">` (screen readers get a dismissal affordance; `tabIndex={-1}` keeps it out of the tab order exactly like the old click-only div); the zoom container is a labeled `<button>` (`بزرگنمایی/کوچکنمایی تصویر`); the «تلاش مجدد» button is hidden when an image is guard-blocked (host allowlist) rather than a transient network failure.
- `storefront-header.tsx` — icon-only links (wishlist / cart / profile) gained Persian `aria-label`s.
- `hero-carousel.tsx` — hidden (inactive) slides gained `inert` (axe `aria-hidden-focus`: the slides were `aria-hidden` but their CTA links stayed focusable); `inert` removes them from the tab order + a11y tree (React 19 boolean prop).
- `ui/badge.tsx` — the shared `success`/`warning` variants moved from white-on-500 (measured 2.2–2.5:1) to the -700 shades (≈4.9–5.3:1) to meet the WCAG AA 4.5:1 minimum (flagged by the product-detail scan); same green/amber visual language app-wide.
- Verified already-compliant (no changes needed): `mobile-drawer.tsx` (`role="dialog"`, `aria-modal`, `aria-label`, `aria-hidden`/`inert` when closed).

---

## 3. Known image debt (documented, NOT part of Session 61)

Native `<img>` remains in **admin/supplier/UI surfaces** where the images are small, upload-local, or behind auth — the approved Session 61 scope covered the storefront only. Converting these is a candidate follow-up (they cannot be part of the "no admin-area changes" invariant without a new approval):

- `src/components/ui/file-upload.tsx` (upload preview)
- `src/components/admin/homepage/content-editor.tsx` + `image-field.tsx` (CMS image fields)
- `src/app/admin/brands/page.tsx`, `src/app/admin/categories/page.tsx`
- `src/app/supplier/orders/[id]/page.tsx` (order item thumb)

Admin pages are excluded from the axe E2E gate for the same reason (auth surface, not covered by the Session 61 scan).

---

## 4. Next performance steps (candidates — see ROADMAP.md)

- Core Web Vitals tuning + Lighthouse CI gate (fold the a11y scan into a Lighthouse CI workflow).
- Convert the remaining admin/supplier native `<img>` tags to `next/image` (approved scope extension).
- Review `fonts`/preload strategy; `next/image` already negotiates formats, so the biggest remaining wins are bundle-splitting and route-level caching.
- Preconnect to the Liara S3 host from the storefront layout to shave TTFB on image-heavy pages.
