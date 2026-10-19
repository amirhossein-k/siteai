import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "پروفایل کاربری",
  robots: { index: false, follow: true },
};

export default function ProfileLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
