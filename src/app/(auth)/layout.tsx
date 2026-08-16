import "./auth.css";

/**
 * Session 83 — minimal full-viewport layout for the authentication pages
 * (login / register). No storefront header/footer here: the marloo-inspired
 * split-screen design (dark holographic scene + white panel) must own the
 * whole viewport, exactly like the reference.
 *
 * The URL structure is unchanged (/login, /register) — only the route-group
 * wrapper changed. All authentication logic lives in the pages below and is
 * untouched.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen w-full bg-white">{children}</div>;
}
