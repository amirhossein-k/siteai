import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "سبد خرید",
  robots: { index: false, follow: true },
};

export default function CartLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
