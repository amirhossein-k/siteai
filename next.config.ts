import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/**
 * Session 61 — hostname allowlist for next/image optimization.
 * Derived from env at config-load time (never from user input):
 *   - LIARA_ENDPOINT (S3-compatible storage) → its hostname; fallback is the
 *     project's known Liara host (c589564.parspack.net) so builds without
 *     env still allowlist the right host;
 *   - NEXT_PUBLIC_APP_URL (when set) → its hostname;
 *   - localhost (dev — any locally-served image URL).
 * Additive allowlist only — it never rewrites or blocks existing URLs.
 */
function hostnameOf(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    return new URL(raw).hostname;
  } catch {
    return fallback;
  }
}

const liaraHostname = hostnameOf(
  process.env.LIARA_ENDPOINT,
  "c589564.parspack.net"
);
const appUrlHostname = hostnameOf(process.env.NEXT_PUBLIC_APP_URL, "");

const remotePatterns: NonNullable<
  NextConfig["images"]
>["remotePatterns"] = [{ protocol: "https", hostname: liaraHostname }];
if (appUrlHostname) {
  remotePatterns.push({ protocol: "https", hostname: appUrlHostname });
}
// Dev-only convenience: localhost (http + https) so locally-imported image
// URLs keep working through the optimizer.
remotePatterns.push(
  { protocol: "http", hostname: "localhost" },
  { protocol: "https", hostname: "localhost" }
);

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  // Image optimization (Session 61 — remotePatterns for next/image)
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns,
  },

  // Compress responses
  compress: true,

  // Enable React strict mode
  reactStrictMode: true,
};

export default nextConfig;
