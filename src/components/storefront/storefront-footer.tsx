import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { getPublicEnamadSettings } from "@/lib/enamad-settings";

/**
 * Shared storefront footer (Session 50).
 * Extracted verbatim from (storefront)/layout.tsx — no behavior change.
 *
 * Redesign pass (feat/storefront-ui-redesign — presentation only): the brand
 * column gains the storefront logo mark (matching the header), headings and
 * links move onto the theme-agnostic `sf-*` tokens for correct hierarchy in
 * both the dark-glass and light themes, and the bottom bar is restructured.
 * Every link, href and the copyright line are unchanged.
 */
export async function StorefrontFooter() {
  const enamad = await getPublicEnamadSettings();
  return (
    /* Session 85 — footer surface restyle: translucent border on the dark
       storefront (the scoped tokens already darken the text/links). */
    <footer className="border-t border-sf-line bg-transparent">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link
              href="/"
              className="mb-4 inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="blue-grad flex h-11 w-11 items-center justify-center rounded-xl sf-label font-bold text-white shadow-lg shadow-primary/25">
                S
              </span>
              <span className="text-lg font-bold tracking-tight text-sf-strong">
                {APP_NAME}
              </span>
            </Link>
            <p className="sf-meta leading-7 text-sf-dim">
              بهترین مقصد برای خرید آنلاین با کیفیت و قیمت مناسب
            </p>
            {enamad?.code && (
              <div
                className="mt-5 inline-flex rounded-xl border border-sf-line bg-sf-chip p-2"
                aria-label={enamad.altText}
                dangerouslySetInnerHTML={{ __html: enamad.code }}
              />
            )}
          </div>
          <div>
            <h4 className="mb-4 sf-meta font-semibold tracking-tight text-sf-strong">
              لینک‌های سریع
            </h4>
            <ul className="space-y-1">
              {["صفحه اصلی", "محصولات", "سفارشات من", "فروشنده شوید", "درباره ما"].map(
                (item) => (
                  <li key={item}>
                    <Link
                      href={
                        item === "محصولات"
                          ? "/products"
                          : item === "سفارشات من"
                          ? "/orders"
                          : item === "فروشنده شوید"
                          ? "/become-supplier"
                          : item === "درباره ما"
                          ? "/about"
                          : "/"
                      }
                      /* Readability pass — sf-meta (14–15px) on a ≥36px row. */
                      className="inline-flex min-h-9 items-center sf-meta text-sf-dim transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {item}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
          <div>
            <h4 className="mb-4 sf-meta font-semibold tracking-tight text-sf-strong">
              پشتیبانی
            </h4>
            <ul className="space-y-1">
              {/* «سوالات متداول» → /faq and «قوانین و مقررات» → /terms are real
                  routes; «حریم خصوصی» remains a placeholder (#) — no unrelated
                  changes. */}
              {[
                { label: "سوالات متداول", href: "/faq" },
                { label: "قوانین و مقررات", href: "/terms" },
                { label: "حریم خصوصی", href: "#" },
              ].map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    /* Readability pass — sf-meta (14–15px) on a ≥36px row. */
                    className="inline-flex min-h-9 items-center sf-meta text-sf-dim transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-4 sf-meta font-semibold tracking-tight text-sf-strong">
              ارتباط با ما
            </h4>
            <div className="flex gap-3">
              {["اینستاگرام", "تلگرام", "واتساپ"].map((social) => (
                <Link
                  key={social}
                  href="#"
                  aria-label={social}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-sf-line bg-sf-chip sf-label font-medium text-sf-dim transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  {social[0]}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-12 border-t border-sf-line pt-8 text-center">
          <p className="sf-meta text-sf-dim">
            © {new Date().getFullYear()} {APP_NAME}. تمامی حقوق محفوظ است.
          </p>
        </div>
      </div>
    </footer>
  );
}
