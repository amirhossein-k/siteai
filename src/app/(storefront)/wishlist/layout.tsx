import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "علاقه‌مندی‌ها",
  robots: { index: false, follow: true },
};

export default function WishlistLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
