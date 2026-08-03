import type { Metadata } from "next";
import { NotificationsList } from "@/components/notifications/notifications-list";

export const metadata: Metadata = {
  title: "اعلان‌ها | فروشگاه من",
};

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">اعلان‌ها</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          تازه‌ترین رویدادهای سفارش‌ها و پرداخت‌های شما
        </p>
      </div>
      <NotificationsList />
    </div>
  );
}
