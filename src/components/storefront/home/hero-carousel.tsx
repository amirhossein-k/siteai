"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { cn, isAllowedImageSrc } from "@/lib/utils";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Hero carousel (Session 50; Session 53 — CMS data-driven).
 * Slides fade in/out (opacity cross-fade — RTL-safe, no transform math),
 * auto-advance with pause on hover, manual dots + arrows.
 *
 * Content comes from the CMS via `section.content` (each row = one slide):
 *   - imageDesktop / imageMobile — responsive artwork (fallback: themeColor
 *     gradient, mirroring the pre-CMS gradient art);
 *   - themeColor — Tailwind gradient classes (e.g. "from-zinc-900 via-…") or
 *     a plain hex color.
 * Behavior comes from `section.presentation.behavior` (autoplay/arrows/dots).
 * Renders nothing when the section has no published slides.
 */
export function HeroCarousel({ section }: HomepageSectionRendererProps) {
  const slides = section.content;
  const behavior = section.presentation?.behavior;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const autoplay = behavior?.autoplay ?? true;
  const autoplayMs = Math.max(1000, behavior?.autoplayInterval ?? 6000);
  const showArrows = behavior?.showArrows ?? true;
  const showDots = behavior?.showDots ?? true;

  const next = useCallback(
    () => setIndex((i) => (i + 1) % Math.max(slides.length, 1)),
    [slides.length]
  );

  const prev = useCallback(
    () => setIndex((i) => (i - 1 + Math.max(slides.length, 1)) % Math.max(slides.length, 1)),
    [slides.length]
  );

  useEffect(() => {
    if (!autoplay || paused || slides.length === 0) return;
    timerRef.current = setInterval(next, autoplayMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoplay, paused, slides.length, next, autoplayMs]);

  if (slides.length === 0) return null;

  const isGradient = (theme: string) => theme.startsWith("from-");

  return (
    <section
      className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="اسلایدر فروشگاه"
    >
      {/* Session 85 — container polish only (border/shadow); the CMS slides,
          cross-fade, autoplay, pause-on-hover, arrows/dots and a11y are
          untouched. */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40">
        <div className="relative aspect-[4/3] sm:aspect-[16/9] lg:aspect-[21/9]">
          {slides.map((slide, i) => {
            const gradient = isGradient(slide.themeColor)
              ? `bg-gradient-to-l ${slide.themeColor}`
              : "bg-gradient-to-l from-zinc-900 via-zinc-800 to-zinc-700";
            // Session 61 — next/image throws on unconfigured hosts; skip such
            // artwork and keep the gradient/theme-color fallback (native <img>
            // degraded to a broken image before the migration).
            const imageDesktop = isAllowedImageSrc(slide.imageDesktop)
              ? slide.imageDesktop
              : "";
            const imageMobile = isAllowedImageSrc(slide.imageMobile)
              ? slide.imageMobile
              : "";
            const hasImage = Boolean(imageDesktop || imageMobile);
            return (
              <div
                key={slide._id}
                className={cn(
                  "absolute inset-0 flex flex-col justify-center px-6 transition-opacity duration-700 sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-16",
                  gradient,
                  i === index ? "opacity-100" : "pointer-events-none opacity-0"
                )}
                style={
                  !isGradient(slide.themeColor) && slide.themeColor
                    ? { backgroundColor: slide.themeColor }
                    : undefined
                }
                aria-hidden={i !== index}
                // Session 61 — axe `aria-hidden-focus`: a slide hidden with
                // aria-hidden must not keep focusable content (its CTA link).
                // `inert` removes it from tab order + a11y tree (React 19
                // boolean prop — same pattern as the mobile drawer).
                inert={i !== index}
              >
                {/* Responsive artwork (mobile / desktop) */}
                {imageMobile && (
                  <Image
                    src={imageMobile}
                    alt=""
                    fill
                    sizes="100vw"
                    loading="eager"
                    className="object-cover sm:hidden"
                  />
                )}
                {imageDesktop && (
                  <Image
                    src={imageDesktop}
                    alt=""
                    fill
                    sizes="100vw"
                    loading="eager"
                    className="hidden object-cover sm:block"
                  />
                )}
                {hasImage && (
                  <div
                    className="absolute inset-0 bg-black/30"
                    aria-hidden="true"
                  />
                )}

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
                  {slide.ctaLabel && slide.ctaHref && (
                    <div className="mt-6">
                      <Link
                        href={slide.ctaHref}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
                      >
                        {slide.ctaLabel}
                        <ChevronLeft className="h-4 w-4" />
                      </Link>
                    </div>
                  )}
                </div>

                {/* Decorative art (desktop only, gradient slides) */}
                {!hasImage && (
                  <div
                    className="hidden h-48 w-48 rounded-3xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm lg:block xl:h-56 xl:w-56"
                    aria-hidden="true"
                  >
                    <div className="flex h-full w-full items-center justify-center">
                      <div className="h-24 w-24 rounded-full bg-white/20" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Arrows */}
        {showArrows && (
          <>
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
          </>
        )}

        {/* Dots */}
        {showDots && (
          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide._id}
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
        )}
      </div>
    </section>
  );
}
