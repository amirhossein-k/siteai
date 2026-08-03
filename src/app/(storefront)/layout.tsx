import { StorefrontHeader } from "@/components/storefront/storefront-header";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";

/**
 * Storefront layout — now a thin server component composing the shared
 * StorefrontHeader (with search) and StorefrontFooter (Session 50 refactor).
 * Behavior unchanged; header/footer extracted for reuse on the homepage.
 */
export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <StorefrontHeader />

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      <StorefrontFooter />
    </div>
  );
}
