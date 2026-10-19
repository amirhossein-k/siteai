import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "سفارش‌های من",
  robots: { index: false, follow: true },
};

export default function OrdersLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
