import type { Metadata } from "next";
import { SupplierSidebar } from "@/components/layout/supplier/supplier-sidebar";
import { SupplierHeader } from "@/components/layout/supplier/supplier-header";
import { MobileDrawer } from "@/components/layout/mobile-drawer";

export const metadata: Metadata = {
  title: {
    default: "پنل فروشنده | فروشگاه من",
    template: "%s | پنل فروشنده",
  },
  robots: { index: false, follow: false },
};

export default function SupplierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" className="flex min-h-screen bg-muted/30">
      <SupplierSidebar />
      {/* Mobile drawer (Session 52) — same nav, slides in < lg */}
      <MobileDrawer>
        <SupplierSidebar variant="mobile" />
      </MobileDrawer>
      <div className="flex flex-1 flex-col">
        <SupplierHeader />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
