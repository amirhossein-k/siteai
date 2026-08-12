import type { Metadata } from "next";
import { NotificationsList } from "@/components/notifications/notifications-list";

export const metadata: Metadata = {
  title: "اعلان‌ها",
};

/**
 * Admin notifications inbox (Session 80). Thin server page around the shared
 * role-agnostic NotificationsList — every item's `link` is already admin-scoped
 * (e.g. "/admin/orders/<id>"), stored at event time. No duplicated list UI.
 */
export default function AdminNotificationsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">اعلان‌ها</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          رویدادهای سفارش‌ها، پرداخت‌ها و درخواست‌های فروشندگان
        </p>
      </div>
      <NotificationsList />
    </div>
  );
}
