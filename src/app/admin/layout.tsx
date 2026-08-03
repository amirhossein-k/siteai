import type { Metadata } from "next";
import { AdminSidebar } from "@/components/layout/admin/admin-sidebar";
import { AdminHeader } from "@/components/layout/admin/admin-header";
import { MobileDrawer } from "@/components/layout/mobile-drawer";

export const metadata: Metadata = {
  title: {
    default: "پنل مدیریت | فروشگاه من",
    template: "%s | پنل مدیریت",
  },
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" className="flex min-h-screen bg-muted/30">
      <AdminSidebar />
      {/* Mobile drawer (Session 52) — same nav, slides in < lg */}
      <MobileDrawer>
        <AdminSidebar variant="mobile" />
      </MobileDrawer>
      <div className="flex flex-1 flex-col">
        <AdminHeader />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
