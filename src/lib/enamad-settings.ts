import { dbConnect } from "@/lib/dbConnect";
import EnamadSettings from "@/models/EnamadSettings";

const TRUST_HOSTS = ["trustseal.enamad.ir", "enamad.ir"];

/**
 * Shape of the single untyped EnamadSettings mongoose document (the model is
 * a .js file, so `findOne().lean()` loses its schema typing at the seam).
 */
export interface EnamadSettingsDoc {
  key?: string;
  enabled?: boolean;
  code?: string;
  altText?: string;
}

function safeHttpsUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && TRUST_HOSTS.includes(url.hostname)
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

/** Keep only the anchor/image pair used by the official Enamad embed code. */
export function sanitizeEnamadCode(raw: unknown): string {
  const input = String(raw || "").slice(0, 20_000);
  const anchor = input.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i);
  const image = input.match(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/i);
  const href = safeHttpsUrl(anchor?.[1]);
  const src = safeHttpsUrl(image?.[1]);
  if (!href || !src) return "";
  return `<a href="${href}" target="_blank" rel="noopener noreferrer"><img src="${src}" alt="نماد اعتماد الکترونیکی" loading="lazy" /></a>`;
}

export async function getPublicEnamadSettings() {
  try {
    await dbConnect();
    const settings = (await EnamadSettings.findOne({ key: "footer" }).lean()) as EnamadSettingsDoc | null;
    if (!settings?.enabled || !settings.code) return null;
    return {
      code: sanitizeEnamadCode(settings.code),
      altText: String(settings.altText || "نماد اعتماد الکترونیکی"),
    };
  } catch {
    return null;
  }
}
