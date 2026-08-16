/**
 * Session 83 — shared style constants for the auth pages (login / register /
 * OTP). One place for the marloo-inspired input + CTA button look so the
 * password forms and the OTP panel stay visually identical.
 *
 * RTL note: the leading icon sits at the RIGHT (reading start in RTL) and the
 * password eye toggle at the LEFT (reading end) — the mirrored version of the
 * reference's LTR layout.
 */
export const AUTH_INPUT_CLASS =
  "h-auto w-full rounded-2xl border border-zinc-200 bg-zinc-50/70 py-3.5 pr-12 pl-4 text-[15px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-500 focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50";

/** Password field with the eye toggle on the left — extra left padding. */
export const AUTH_INPUT_WITH_ACTION_CLASS =
  "h-auto w-full rounded-2xl border border-zinc-200 bg-zinc-50/70 py-3.5 pr-12 pl-12 text-[15px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-500 focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Neon shimmer CTA — used on every auth submit button.
 * The gradient endpoints are deepened (cyan-700 → purple-600) so white text
 * keeps ≥4.5:1 contrast (WCAG AA); the outer glow + shimmer keep the neon
 * look of the reference.
 */
export const AUTH_SUBMIT_CLASS =
  "btn-shimmer relative h-auto w-full rounded-2xl bg-gradient-to-r from-[#0e7490] to-[#7c3aed] px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_14px_34px_-8px_rgba(0,229,255,0.55)] transition duration-300 hover:brightness-105 hover:shadow-[0_18px_44px_-8px_rgba(168,85,247,0.6)] active:scale-[0.99]";

export const AUTH_LABEL_CLASS = "text-sm font-medium text-zinc-700";
