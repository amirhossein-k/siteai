import type { Metadata } from "next";
import { Geist, Geist_Mono, Vazirmatn } from "next/font/google";
import "./globals.css";
import Providers from "@/app/Providers";
import { OrganizationJsonLd, WebsiteJsonLd } from "@/components/seo/json-ld-script";
import { APP_NAME, APP_DESCRIPTION, APP_URL } from "@/lib/constants";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} | ${APP_DESCRIPTION}`,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,

  // Session 71 — one source of truth for the public origin (the production
  // guard in constants.ts guarantees APP_URL is a valid absolute URL).
  metadataBase: new URL(APP_URL),

  openGraph: {
    type: "website",
    locale: "fa_IR",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },

  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  other: {
    "application-name": APP_NAME,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} ${vazirmatn.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        <OrganizationJsonLd />
        <WebsiteJsonLd />
      </head>
      <body className="min-h-screen bg-white font-sans dark:bg-zinc-950">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
