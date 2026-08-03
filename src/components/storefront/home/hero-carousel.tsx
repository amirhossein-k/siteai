"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { homepageConfig } from "@/lib/homepage-config";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 6000;

/**
 * Hero carousel (Session 50).
 * Slides fade in/out (opacity cross-fade — RTL-safe, no transform math),
 * auto-advance with pause on hover, manual dots + arrows. Slide content is
 * configured in homepage-config.ts (gradient art, no external images).
 * Mobile shows a taller single-slide layout; desktop adds a two-column
 * content/art split.
 */
export function HeroCarousel() {
  const slides = homepageConfig.heroSlides;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const next = useCallback(
    () => setIndex((i) => (i + 1) % slides.length),
    [slides.length]
  );

  const prev = useCallback(
    () => setIndex((i) => (i - 1 + slides.length) % slides.length),
    [slides.length]
  );

  useEffect(() => {
    if (paused) return;
    timerRef.current = setInterval(next, AUTOPLAY_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused, next]);

  return (
    <section
      className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="اسلایدر فروشگاه"
    >
      <div className="relative overflow-hidden rounded-2xl border shadow-sm sm:rounded-3xl">
        <div className="relative aspect-[4/3] sm:aspect-[16/9] lg:aspect-[21/9]">
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className={cn(
                "absolute inset-0 flex flex-col justify-center bg-gradient-to-l px-6 transition-opacity duration-700 sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-16",
                slide.gradient,
                i === index ? "opacity-100" : "pointer-events-none opacity-0"
              )}
              aria-hidden={i !== index}
            >
              {/* Copy */}
              <div className="relative z-10 max-w-xl text-white">
                {slide.tagline && (
                  <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium backdrop-blur sm:text-xs">
                    <Sparkles className="h-3.5 w-3.5" />
                    {slide.tagline}
                  </span>
                )}
                <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                  {slide.title}
                </h1>
                <p className="mt-3 max-w-md text-sm leading-7 text-white/85 sm:text-base">
                  {slide.subtitle}
                </p>
                <div className="mt-6">
                  <Link
                    href={slide.cta.href}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    {slide.cta.label}
                    <ChevronLeft className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              {/* Decorative art (desktop only) */}
              <div
                className="hidden h-48 w-48 rounded-3xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm lg:block xl:h-56 xl:w-56"
                aria-hidden="true"
              >
                <div className="flex h-full w-full items-center justify-center">
                  <div className="h-24 w-24 rounded-full bg-white/20" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Arrows */}
        <button
          type="button"
          onClick={prev}
          aria-label="اسلاید قبلی"
          className="absolute right-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-all hover:bg-white/30 md:flex"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="اسلاید بعدی"
          className="absolute left-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-all hover:bg-white/30 md:flex"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Dots */}
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`اسلاید ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === index
                  ? "w-6 bg-white"
                  : "w-1.5 bg-white/50 hover:bg-white/80"
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
