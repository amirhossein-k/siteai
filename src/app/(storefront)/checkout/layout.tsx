import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "تسویه حساب",
  robots: { index: false, follow: true },
};

export default function CheckoutLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
