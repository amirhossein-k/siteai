/**
 * Session 83 — holographic wireframe icons for the futuristic marketplace
 * scene (ported from the marloo-login reference). All are line-art with
 * translucent fills so they read as "holograms".
 */

type IconProps = { className?: string };

export function ShoppingBag({ className }: IconProps) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M34 42c0-16 28-16 28 0" stroke="#00e5ff" strokeWidth="3" strokeLinecap="round" />
      <rect x="25" y="42" width="46" height="44" rx="9" stroke="#00e5ff" strokeWidth="3" fill="rgba(0,229,255,0.08)" />
      <path d="M25 59h46" stroke="#00e5ff" strokeWidth="2" strokeOpacity="0.5" />
      <circle cx="48" cy="71" r="5.5" stroke="#00e5ff" strokeWidth="2" fill="rgba(0,229,255,0.18)" />
      <path d="M35 42v5M61 42v5" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.55" />
    </svg>
  );
}

export function GiftBox({ className }: IconProps) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M37 31C33 21 45 19 48 26c3-7 15-5 11 5" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="20" y="30" width="56" height="16" rx="5" stroke="#a855f7" strokeWidth="3" fill="rgba(168,85,247,0.14)" />
      <rect x="24" y="46" width="48" height="38" rx="6" stroke="#a855f7" strokeWidth="3" fill="rgba(168,85,247,0.08)" />
      <path d="M48 30v54" stroke="#a855f7" strokeWidth="2" strokeOpacity="0.65" />
      <path d="M31 46h34" stroke="#a855f7" strokeWidth="2" strokeOpacity="0.35" />
    </svg>
  );
}

export function Drone({ className }: IconProps) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="33" y="41" width="30" height="14" rx="7" stroke="#00e5ff" strokeWidth="3" fill="rgba(0,229,255,0.12)" />
      <path d="M41 45l-17-14M55 45l17-14M41 51l-17 15M55 51l17 15" stroke="#00e5ff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="31" r="7" stroke="#00e5ff" strokeWidth="2" fill="rgba(0,229,255,0.1)" />
      <circle cx="72" cy="31" r="7" stroke="#00e5ff" strokeWidth="2" fill="rgba(0,229,255,0.1)" />
      <circle cx="24" cy="66" r="7" stroke="#00e5ff" strokeWidth="2" fill="rgba(0,229,255,0.1)" />
      <circle cx="72" cy="66" r="7" stroke="#00e5ff" strokeWidth="2" fill="rgba(0,229,255,0.1)" />
      <circle cx="48" cy="48" r="2.6" fill="#00e5ff" />
      <path d="M44 55v7M52 55v7" stroke="#00e5ff" strokeWidth="2" />
      <rect x="39" y="62" width="18" height="14" rx="3" stroke="#00e5ff" strokeWidth="2" fill="rgba(0,229,255,0.12)" />
    </svg>
  );
}

export function PackageCube({ className }: IconProps) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M48 16 76 32v32L48 80 20 64V32L48 16Z" stroke="#a855f7" strokeWidth="3" strokeLinejoin="round" fill="rgba(168,85,247,0.08)" />
      <path d="M48 16v64" stroke="#a855f7" strokeWidth="2" strokeOpacity="0.6" />
      <path d="M20 32l28 16 28-16" stroke="#a855f7" strokeWidth="2" strokeOpacity="0.6" />
      <path d="M20 64l28-16 28 16" stroke="#a855f7" strokeWidth="2" strokeOpacity="0.6" />
      <circle cx="48" cy="48" r="5" stroke="#a855f7" strokeWidth="2" fill="rgba(168,85,247,0.22)" />
    </svg>
  );
}

export function LogoMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6.5 8.75C6.5 5.6 8.7 3.5 12 3.5s5.5 2.1 5.5 5.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="4.25" y="8.75" width="15.5" height="11" rx="3.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 8.75v1.5M15.5 8.75v1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
