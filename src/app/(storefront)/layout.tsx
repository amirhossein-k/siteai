import { StorefrontHeader } from "@/components/storefront/storefront-header";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import { AiShoppingAssistant } from "@/components/storefront/ai/ai-shopping-assistant";

/**
 * Storefront layout — composes the shared StorefrontHeader, StorefrontFooter,
 * and the floating AiShoppingAssistant across all storefront pages.
 */
export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="storefront dot-grid flex min-h-screen flex-col bg-sf-bg text-sf-body">
      <StorefrontHeader />

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      <AiShoppingAssistant />
      <StorefrontFooter />
    </div>
  );
}
