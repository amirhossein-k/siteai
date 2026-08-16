import Link from "next/link";
import { APP_NAME } from "@/lib/constants";

/**
 * Shared storefront footer (Session 50).
 * Extracted verbatim from (storefront)/layout.tsx — no behavior change.
 */
export function StorefrontFooter() {
  return (
    /* Session 85 — footer surface restyle: translucent border on the dark
       storefront (the scoped tokens already darken the text/links). */
    <footer className="border-t border-white/5 bg-transparent">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h4 className="mb-4 text-sm font-semibold text-muted-foreground">
              {APP_NAME}
            </h4>
            <p className="text-sm text-muted-foreground">
              بهترین مقصد برای خرید آنلاین با کیفیت و قیمت مناسب
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold text-muted-foreground">
              لینک‌های سریع
            </h4>
            <ul className="space-y-2">
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
                          : "/"
                      }
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item}
                  </Link>
                  </li>
                )
              )}
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold text-muted-foreground">
              پشتیبانی
            </h4>
            <ul className="space-y-2">
              {["سوالات متداول", "قوانین و مقررات", "حریم خصوصی"].map(
                (item) => (
                  <li key={item}>
                    <Link
                      href="#"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {item}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-sm font-semibold text-muted-foreground">
              ارتباط با ما
            </h4>
            <div className="flex gap-3">
              {["اینستاگرام", "تلگرام", "واتساپ"].map((social) => (
                <Link
                  key={social}
                  href="#"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {social[0]}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-12 border-t pt-8 text-center">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} {APP_NAME}. تمامی حقوق محفوظ است.
          </p>
        </div>
      </div>
    </footer>
  );
}
