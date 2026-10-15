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
 *
 * Redesign pass (feat/storefront-ui-redesign — presentation only): a layered
 * gradient scrim deepens the stage and lifts text contrast on both artwork and
 * gradient slides, the page-blend fade ties the hero into the sections below,
 * the copy/CTA/control cluster is refined, and the active slide gets a slow
 * motion-safe zoom. CMS slides, cross-fade, autoplay, pause-on-hover,
 * arrows/dots, `inert` hidden slides and every aria attribute are unchanged.
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

  /** Shared control-button treatment (arrow buttons) — glass pill with a
   *  hover lift and a real focus-visible ring (a11y was previously visual
   *  only). */
  const arrowButton =
    "absolute top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 md:flex";

  return (
    <section
      className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="اسلایدر فروشگاه"
    >
      {/* Session 85 — container polish only (border/shadow); the CMS slides,
          cross-fade, autoplay, pause-on-hover, arrows/dots and a11y are
          untouched. Redesign pass — an inset hairline highlight adds depth on
          the dark glass without affecting the light theme surface. */}
      <div className="relative overflow-hidden rounded-3xl border border-sf-line shadow-2xl ring-1 ring-inset ring-white/10">
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
            const active = i === index;
            return (
              <div
                key={slide._id}
                className={cn(
                  "absolute inset-0 flex flex-col justify-center px-6 transition-opacity duration-700 sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-16",
                  gradient,
                  active ? "opacity-100" : "pointer-events-none opacity-0"
                )}
                style={
                  !isGradient(slide.themeColor) && slide.themeColor
                    ? { backgroundColor: slide.themeColor }
                    : undefined
                }
                aria-hidden={!active}
                // Session 61 — axe `aria-hidden-focus`: a slide hidden with
                // aria-hidden must not keep focusable content (its CTA link).
                // `inert` removes it from tab order + a11y tree (React 19
                // boolean prop — same pattern as the mobile drawer).
                inert={!active}
              >
                {/* Responsive artwork (mobile / desktop) — the active slide
                    drifts into a slow zoom (motion-safe only), so the stage
                    feels alive without distracting. */}
                {imageMobile && (
                  <Image
                    src={imageMobile}
                    alt=""
                    fill
                    sizes="100vw"
                    loading="eager"
                    className={cn(
                      "object-cover sm:hidden motion-safe:transition-transform motion-safe:duration-[7000ms] motion-safe:ease-out",
                      active ? "motion-safe:scale-105" : "scale-100"
                    )}
                  />
                )}
                {imageDesktop && (
                  <Image
                    src={imageDesktop}
                    alt=""
                    fill
                    sizes="100vw"
                    loading="eager"
                    className={cn(
                      "hidden object-cover sm:block motion-safe:transition-transform motion-safe:duration-[7000ms] motion-safe:ease-out",
                      active ? "motion-safe:scale-105" : "scale-100"
                    )}
                  />
                )}

                {/* Depth scrim — darkens the copy side (RTL start) so text
                    keeps AA contrast on both artwork and gradient slides. */}
                <div
                  className="absolute inset-0 bg-gradient-to-l from-black/55 via-black/20 to-transparent"
                  aria-hidden="true"
                />
                {hasImage && (
                  <div className="absolute inset-0 bg-black/25" aria-hidden="true" />
                )}
                {/* Bottom-up vignette (sits under the controls) for dot
                    legibility and a grounded stage. */}
                <div
                  className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent"
                  aria-hidden="true"
                />

                {/* Copy */}
                <div className="relative z-10 max-w-xl text-white">
                  {slide.tagline && (
                    <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3.5 py-1.5 sf-label font-medium shadow-sm backdrop-blur">
                      <Sparkles className="h-3.5 w-3.5" />
                      {slide.tagline}
                    </span>
                  )}
                  <h1 className="text-3xl font-extrabold leading-[1.15] tracking-tight drop-shadow-sm sm:text-4xl lg:text-5xl xl:text-6xl">
                    {slide.title}
                  </h1>
                  <p className="mt-4 max-w-lg sf-prose text-white">
                    {slide.subtitle}
                  </p>
                  {slide.ctaLabel && slide.ctaHref && (
                    <div className="mt-6">
                      <Link
                        href={slide.ctaHref}
                        className="group inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-5 py-3 sf-meta font-semibold text-zinc-900 shadow-lg shadow-black/20 transition-all hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
                      >
                        {slide.ctaLabel}
                        <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                      </Link>
                    </div>
                  )}
                </div>

                {/* Decorative art (desktop only, gradient slides) */}
                {!hasImage && (
                  <div
                    className="relative hidden h-48 w-48 rounded-3xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm lg:block xl:h-56 xl:w-56"
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

          {/* Page-blend fade — dissolves the hero's lower edge into the
              storefront surface so the next section flows in. Decorative;
              kept below the controls (z-20). */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-sf-page to-transparent"
            aria-hidden="true"
          />
        </div>

        {/* Arrows */}
        {showArrows && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="اسلاید قبلی"
              className={cn(arrowButton, "right-3")}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="اسلاید بعدی"
              className={cn(arrowButton, "left-3")}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Dots */}
        {showDots && (
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide._id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`اسلاید ${i + 1}`}
                aria-current={i === index}
                /* Readability pass — a 24×24 hit target (the visible bar used
                   to be the whole 6px-tall button). */
                className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "block h-1.5 rounded-full transition-all duration-300",
                    i === index
                      ? "w-6 bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)]"
                      : "w-3 bg-white/60"
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
