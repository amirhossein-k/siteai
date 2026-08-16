"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ShoppingBag,
  GiftBox,
  Drone,
  PackageCube,
  LogoMark,
} from "@/components/auth/holo-icons";

/**
 * Session 83 — the dark holographic marketplace scene (ported from the
 * marloo-login reference, Persianized). Pure decoration: the whole section is
 * aria-hidden and every animation respects prefers-reduced-motion (auth.css).
 *
 * Hidden below `lg` — the white auth panel owns the mobile viewport.
 */

// Deterministic pseudo-random generator so the starfield is stable across renders.
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Network constellation (percent coordinates, 0-100).
const NODES: [number, number][] = [
  [50, 48], // 0  orb / hub
  [24, 30], // 1  shopping bag
  [72, 30], // 2  gift box
  [26, 74], // 3  drone
  [74, 72], // 4  package cube
  [12, 42], // 5  left mid
  [88, 44], // 6  right mid
  [50, 14], // 7  top center
  [50, 87], // 8  bottom center
  [10, 18], // 9  top-left corner
  [90, 78], // 10 bottom-right corner
];

type EdgeColor = "cyan" | "purple" | "mix";
const EDGES: [number, number, EdgeColor][] = [
  [0, 1, "cyan"],
  [0, 2, "purple"],
  [0, 3, "cyan"],
  [0, 4, "purple"],
  [1, 2, "mix"],
  [3, 4, "mix"],
  [5, 1, "purple"],
  [6, 2, "cyan"],
  [7, 0, "cyan"],
  [8, 0, "purple"],
  [9, 1, "purple"],
  [10, 4, "cyan"],
];

function curved(from: [number, number], to: [number, number]) {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ox = -dy / len;
  const oy = dx / len;
  const bend = Math.min(11, len * 0.16);
  return `M ${from[0]} ${from[1]} Q ${mx + ox * bend} ${my + oy * bend} ${to[0]} ${to[1]}`;
}

const EDGE_COLORS: Record<EdgeColor, string> = {
  cyan: "#00e5ff",
  purple: "#a855f7",
  mix: "url(#trailGrad)",
};

function Floater({
  x,
  y,
  tilt = 0,
  amp = -16,
  drift = 0,
  dur = 7,
  delay = 0,
  children,
}: {
  x: number;
  y: number;
  tilt?: number;
  amp?: number;
  drift?: number;
  dur?: number;
  delay?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div
        className="floaty"
        style={
          {
            "--tilt": `${tilt}deg`,
            "--amp": `${amp}px`,
            "--drift": `${drift}px`,
            "--dur": `${dur}s`,
            "--delay": `${delay}s`,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

function Chip({
  className,
  color = "cyan",
  label,
  value,
  dur = 8,
  delay = 0,
}: {
  className?: string;
  color?: "cyan" | "purple";
  label: string;
  value: string;
  dur?: number;
  delay?: number;
}) {
  return (
    <div className={cn("absolute z-10", className)}>
      <div
        className="floaty glass-chip flex items-center gap-3"
        style={
          { "--amp": "-9px", "--dur": `${dur}s`, "--delay": `${delay}s` } as CSSProperties
        }
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            color === "cyan"
              ? "bg-cyan-300 shadow-[0_0_10px_#00e5ff]"
              : "bg-purple-400 shadow-[0_0_10px_#a855f7]"
          )}
        />
        <div className="leading-tight">
          <p className="text-[11px] text-white/45">{label}</p>
          <p className="text-xs font-semibold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function HolographicScene({ className }: { className?: string }) {
  const stars = useMemo(() => {
    const rnd = mulberry32(20260214);
    return Array.from({ length: 70 }, () => {
      const cyan = rnd() > 0.45;
      return {
        x: rnd() * 100,
        y: rnd() * 100,
        s: 1 + rnd() * 2.4,
        c: cyan ? "rgba(0,229,255," : "rgba(255,255,255,",
        d: 2 + rnd() * 4,
        delay: rnd() * 5,
      };
    });
  }, []);

  return (
    <section
      aria-hidden="true"
      className={cn("relative overflow-hidden bg-[#0b0b12]", className)}
    >
      {/* Base gradient backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(160deg, #0c0c14 0%, #0e0e17 45%, #08080d 100%)" }}
      />

      {/* Ambient aurora glows */}
      <div
        className="absolute -left-24 -top-20 h-[26rem] w-[26rem] rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(0,229,255,0.28), transparent 65%)" }}
      />
      <div
        className="absolute -bottom-24 -right-16 h-[28rem] w-[28rem] rounded-full blur-[130px]"
        style={{ background: "radial-gradient(circle, rgba(168,85,247,0.3), transparent 65%)" }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[110px]"
        style={{ background: "radial-gradient(circle, rgba(124,58,237,0.22), transparent 70%)" }}
      />

      {/* Tech grid */}
      <div className="absolute inset-0 scene-grid" />

      {/* Starfield */}
      {stars.map((st, i) => (
        <span
          key={i}
          className="star absolute rounded-full"
          style={
            {
              left: `${st.x}%`,
              top: `${st.y}%`,
              width: st.s,
              height: st.s,
              background: `${st.c}0.9)`,
              boxShadow: `0 0 ${Math.round(st.s * 3)}px ${st.c}0.8)`,
              "--dur": `${st.d}s`,
              "--delay": `${st.delay}s`,
            } as CSSProperties
          }
        />
      ))}

      {/* Light-trail network */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="trailGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        {EDGES.map((e, i) => {
          const d = curved(NODES[e[0]], NODES[e[1]]);
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={EDGE_COLORS[e[2]]}
              strokeWidth={1.2}
              strokeOpacity={0.45}
              vectorEffect="non-scaling-stroke"
              className="trail"
              style={{ "--dur": `${3 + (i % 3)}s` } as CSSProperties}
            />
          );
        })}
      </svg>

      {/* Network nodes */}
      {NODES.map(([x, y], i) => {
        if (i === 0) return null;
        const cyan = i % 2 === 0;
        const ping = i === 5 || i === 8;
        return (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span
              className={cn("block h-2 w-2 rounded-full", cyan ? "bg-cyan-300" : "bg-purple-400")}
              style={{
                boxShadow: cyan
                  ? "0 0 10px rgba(0,229,255,0.9)"
                  : "0 0 10px rgba(168,85,247,0.9)",
              }}
            />
            {ping && <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-cyan-300/40" />}
          </div>
        );
      })}

      {/* Central holographic orb + orbit rings */}
      <div className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2">
        <div className="orb-pulse">
          <div className="relative flex items-center justify-center">
            <div className="h-36 w-36 rounded-full orb-core" />

            <div className="spin-slow absolute h-52 w-52 rounded-full border border-dashed border-cyan-300/30 ring-pulse">
              <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_10px_#00e5ff]" />
            </div>
            <div className="spin-rev absolute h-72 w-72 rounded-full border border-dashed border-purple-400/30">
              <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-400 shadow-[0_0_10px_#a855f7]" />
            </div>
            <div className="spin-slow absolute h-40 w-40 rounded-full border border-cyan-200/20" />
          </div>
        </div>
      </div>

      {/* Floating holographic products */}
      <Floater x={24} y={30} tilt={-8} amp={-18} dur={7}>
        <ShoppingBag className="h-28 w-28 glow-cyan" />
      </Floater>
      <Floater x={72} y={30} tilt={8} amp={-14} dur={8.5} delay={0.6}>
        <GiftBox className="h-24 w-24 glow-purple" />
      </Floater>
      <Floater x={26} y={74} tilt={6} amp={-16} dur={9} delay={1.1}>
        <Drone className="h-28 w-28 glow-cyan" />
      </Floater>
      <Floater x={74} y={72} tilt={-6} amp={-18} dur={7.6} delay={0.3}>
        <PackageCube className="h-28 w-28 glow-purple" />
      </Floater>

      {/* Small accent floaters */}
      <Floater x={16} y={55} tilt={-12} amp={-10} dur={6} delay={1.6}>
        <PackageCube className="h-10 w-10 opacity-70 glow-purple" />
      </Floater>
      <Floater x={85} y={20} tilt={10} amp={-12} dur={6.5} delay={0.9}>
        <ShoppingBag className="h-12 w-12 opacity-80 glow-cyan" />
      </Floater>

      {/* Floating HUD data chips */}
      <Chip className="left-[7%] top-[60%]" label="ارسال اکسپرس" value="۱۲ دقیقه" dur={7.5} />
      <Chip className="right-[6%] top-[26%]" color="purple" label="پیشنهاد ویژه" value="٪۴۰ تخفیف" dur={8.5} delay={0.8} />
      <Chip className="left-[11%] top-[33%]" color="purple" label="در مدار شما" value="۲٬۴۱۸ کالا" dur={7} delay={1.4} />
      <Chip className="right-[7%] top-[61%]" label="سفارش #۲۲۱۸" value="در حال ارسال" dur={9} delay={0.4} />

      {/* Brand badge */}
      <div className="absolute left-6 top-6 z-20 flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#00e5ff] to-[#a855f7] shadow-[0_0_20px_rgba(0,229,255,0.5)]">
          <LogoMark className="h-5 w-5 text-white" />
        </div>
        <div className="leading-tight">
          <span className="text-lg font-bold text-white">
            فروشگاه <span className="neon-cyan">من</span>
          </span>
          <span className="block text-[10px] uppercase tracking-[0.22em] text-white/40">
            بازار آنلاین
          </span>
        </div>
      </div>

      {/* Live indicator */}
      <div className="absolute right-6 top-6 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 backdrop-blur-md">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-widest text-white/70">
          شبکه آنلاین
        </span>
      </div>

      {/* Holographic scan line */}
      <div className="scanline pointer-events-none absolute left-0 right-0 h-10 bg-gradient-to-b from-transparent via-cyan-400/[0.07] to-transparent" />

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />
    </section>
  );
}
