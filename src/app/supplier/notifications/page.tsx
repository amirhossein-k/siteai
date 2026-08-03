import type { Metadata } from "next";
import { NotificationsList } from "@/components/notifications/notifications-list";

export const metadata: Metadata = {
  title: "اعلان‌ها | پنل فروشنده",
};

export default function SupplierNotificationsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">اعلان‌ها</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          تازه‌ترین رویدادهای سفارش‌ها و کیف پول شما
        </p>
      </div>
      <NotificationsList />
    </div>
  );
}
