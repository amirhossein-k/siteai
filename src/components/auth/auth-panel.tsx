import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AuthPanelProps {
  /** Brand eyebrow above the hero (rendered with the gradient rule). */
  eyebrow: string;
  /** Hero heading — the page supplies the h1 so its accessible name stays
   *  exactly the E2E-asserted Persian title. */
  title: ReactNode;
  /** One-line subtitle under the hero. */
  subtitle: string;
  /** The actual form content. */
  children: ReactNode;
  /** Bottom security line (mirrors the reference's "Protected by …"). */
  securityNote?: string;
  className?: string;
}

/**
 * Session 83 — the white right-hand panel of the auth split screen (ported
 * from marloo-login's LoginPanel). Ambient cyan/purple glows, centered
 * max-w-md column with staggered entrance, eyebrow → hero → subtitle →
 * form → security note.
 */
export function AuthPanel({
  eyebrow,
  title,
  subtitle,
  children,
  securityNote = "ورود امن · محافظتشده با رمزنگاری و کد تأیید پیامکی",
  className,
}: AuthPanelProps) {
  return (
    <section
      dir="rtl"
      className={cn(
        "relative min-h-screen w-full overflow-x-hidden bg-white lg:h-screen lg:overflow-y-auto",
        className
      )}
    >
      {/* Ambient lighting (ties the two halves together) */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-50 blur-[100px]"
        style={{
          background: "radial-gradient(circle, rgba(0,229,255,0.18), transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full opacity-50 blur-[100px]"
        style={{
          background: "radial-gradient(circle, rgba(168,85,247,0.16), transparent 70%)",
        }}
      />

      <div className="relative flex min-h-screen items-center justify-center px-6 py-12 sm:px-10 lg:min-h-full">
        <div className="stagger w-full max-w-md">
          {/* Eyebrow — zinc-500 for WCAG AA on white (zinc-400 fails) */}
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
            <span className="h-px w-8 bg-gradient-to-r from-cyan-400 to-purple-500" />
            {eyebrow}
          </div>

          {/* Hero */}
          <div className="mt-4">{title}</div>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-500">{subtitle}</p>

          {/* Form */}
          <div className="mt-9">{children}</div>

          {/* Security note */}
          <p className="mt-8 text-center text-xs text-zinc-500">{securityNote}</p>
        </div>
      </div>
    </section>
  );
}
