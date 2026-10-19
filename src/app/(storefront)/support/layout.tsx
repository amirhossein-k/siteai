import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "پشتیبانی",
  robots: { index: false, follow: true },
};

export default function SupportLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
