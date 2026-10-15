"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ScrollText,
  UserCircle,
  ShoppingCart,
  CreditCard,
  Truck,
  RotateCcw,
  ShieldCheck,
  Lock,
  Copyright,
  Ban,
  Scale,
  Phone,
  Check,
  List,
  LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TERMS_SECTIONS,
  TERMS_QUICK_FACTS,
  TERMS_LAST_UPDATED,
  type TermsIconId,
} from "@/lib/terms-content";

/** Icon ids → lucide components (keeps the content module free of React). */
const SECTION_ICON: Record<TermsIconId, typeof ScrollText> = {
  scroll: ScrollText,
  user: UserCircle,
  cart: ShoppingCart,
  creditCard: CreditCard,
  truck: Truck,
  rotateCcw: RotateCcw,
  shield: ShieldCheck,
  lock: Lock,
  copyright: Copyright,
  ban: Ban,
  scale: Scale,
  phone: Phone,
};

const FACT_ICON = {
  truck: Truck,
  rotateCcw: RotateCcw,
  shield: ShieldCheck,
} as const;

/**
 * Terms & Conditions page content (client island).
 *
 * Mirrors the owner-approved reference (sticky table of contents with an
 * active-section highlight, numbered section cards, quick-facts strip and an
 * acknowledgement panel) but rebuilt on Marloo's `sf-*` storefront tokens and
 * lucide icons — no reference styling or dependencies are copied.
 *
 * The section copy comes from `src/lib/terms-content.ts`; this component adds
 * only presentation + the two interactions (TOC scroll-spy, acknowledgement).
 * Because it is SSR'd, the full terms text is present in the initial HTML.
 *
 * A11y: semantic <nav aria-label> for the TOC, real buttons with
 * `aria-current`, an `aria-live` acknowledgement confirmation, visible
 * focus rings and a reduced-motion-aware scroll.
 */
export function TermsPageContent() {
  const [activeId, setActiveId] = useState<string>(TERMS_SECTIONS[0].id);
  const [agreed, setAgreed] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const ids = useMemo(() => TERMS_SECTIONS.map((s) => s.id), []);

  // Scroll-spy: the active TOC item follows the section nearest the viewport
  // top. IntersectionObserver over each section (rootMargin biases the top so
  // a section lights up as soon as it reaches the header).
  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -65% 0px", threshold: 0 }
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
    setActiveId(id);
  };

  return (
    <div className="pb-16">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <div className="glass-panel relative overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-10 sm:py-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-1/2 h-64 w-64 translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
          />
          <div className="relative">
            {/* Readability pass — a translucent `bg-primary/10` over the hero's
                decorative glow tinted the surface and left this label at
                3.6:1 (dark) / 4.1:1 (light), measured from rendered pixels.
                An opaque card surface gives the same primary text a solid
                5.1:1 / 6.5:1 (identical to the /faq hero pill). */}
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-sf-card px-3.5 py-2 sf-label font-semibold text-primary">
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              آخرین بازنگری: {TERMS_LAST_UPDATED}
            </span>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
              قوانین و مقررات
            </h1>
            <p className="mx-auto mt-4 max-w-2xl sf-lead text-sf-dim">
              لطفاً پیش از استفاده از خدمات فروشگاه مارلو شاپ، این قوانین را با
              دقت مطالعه فرمایید.
            </p>
          </div>
        </div>
      </section>

      {/* ── Quick facts ───────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {TERMS_QUICK_FACTS.map((fact) => {
            const Icon = FACT_ICON[fact.icon];
            return (
              <div
                key={fact.label}
                className="glass-card flex items-center gap-3 rounded-2xl p-4"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="sf-meta text-sf-dim">{fact.label}</p>
                  <p className="sf-meta font-bold text-sf-strong">
                    {fact.value}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── TOC + sections ────────────────────────────────────────────── */}
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-10 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
        {/* Table of contents. `min-w-0` lets the column shrink instead of
            forcing the grid track wider than the viewport when the reader
            enlarges text only (WCAG 1.4.4 — the previous `truncate` labels
            kept the track at their full un-wrapped width). */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-3xl border border-sf-line bg-sf-card/50 p-4">
            <p              className="mb-3 flex items-center gap-2 border-b border-sf-line pb-3 sf-meta font-bold text-primary">
              <List className="h-4 w-4" aria-hidden="true" />
              فهرست مطالب
            </p>
            <nav aria-label="فهرست مطالب">
              <ul className="flex min-w-0 flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:gap-1">
                {TERMS_SECTIONS.map((section) => {
                  const Icon = SECTION_ICON[section.icon];
                  const isActive = activeId === section.id;
                  return (
                    <li key={section.id} className="min-w-0 lg:w-full">
                      <button
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => scrollToSection(section.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start sf-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                          isActive
                            ? "bg-primary/10 font-semibold text-primary"
                            : "text-sf-dim hover:bg-sf-chip hover:text-sf-strong"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {/* Readability pass — title wraps instead of being
                            ellipsised, so no TOC entry is ever cut off. */}
                        <span className="min-w-0 leading-snug">{section.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="blue-grad mt-4 rounded-2xl p-5 text-center text-white">
              <Lock className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
              <p className="sf-meta font-semibold">حریم خصوصی شما</p>
              {/* Readability pass — plain white instead of white/85 so the label
                  clears AA on the brand gradient. */}
              <p className="mt-1 sf-meta text-white/95">
                اطلاعات شما نزد ما محرمانه و امن است.
              </p>
            </div>
          </div>
        </aside>

        {/* Sections */}
        <main ref={contentRef} className="min-w-0">
          {TERMS_SECTIONS.map((section, index) => {
            const Icon = SECTION_ICON[section.icon];
            return (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`terms-h-${section.id}`}
                className="glass-card mb-4 scroll-mt-24 rounded-3xl p-5 sm:p-7"
              >
                {/* `flex-wrap` keeps the number + heading readable when text is
                    enlarged: at 200% text size the section icon drops to its own
                    line instead of squeezing the heading out of the viewport. */}
                <div className="mb-5 flex min-w-0 flex-wrap items-center gap-3 border-b border-sf-line pb-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  {/* `min-w-0` lets long Persian headings wrap instead of
                      widening the section past the viewport at large text. */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="blue-grad flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sf-label font-bold text-white"
                      aria-hidden="true"
                    >
                      {(index + 1).toLocaleString("fa-IR")}
                    </span>
                    <h2
                      id={`terms-h-${section.id}`}
                      className="text-xl font-bold tracking-tight text-foreground"
                    >
                      {section.title}
                    </h2>
                  </div>
                </div>

                {section.content && (
                  <p className="mb-4 rounded-xl border-s-4 border-primary bg-sf-chip p-4 sf-prose text-sf-dim">
                    {section.content}
                  </p>
                )}

                {section.items && (
                  <ul className="space-y-0.5">
                    {section.items.map((item, i) => (
                      <li
                        key={i}
                        className={cn(
                          "flex items-start gap-3 py-3 sf-prose text-sf-dim",
                          i < section.items!.length - 1 &&
                            "border-b border-sf-line"
                        )}
                      >
                        <span
                          className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
                          aria-hidden="true"
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="min-w-0">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {section.link && (
                  <Link
                    href={section.link.href}
                    className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 sf-meta font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <LifeBuoy className="h-4 w-4" />
                    {section.link.label}
                  </Link>
                )}
              </section>
            );
          })}

          {/* ── Acknowledgement ─────────────────────────────────────────── */}
          <div
            className={cn(
              "mt-6 rounded-3xl p-8 text-center transition-colors",
              agreed
                ? "border border-sf-success/40 bg-sf-success/10"
                : "blue-grad text-white"
            )}
          >
            {agreed ? (
              <>
                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-sf-success/20 text-sf-success">
                  <Check className="h-7 w-7" aria-hidden="true" />
                </span>
                <h3
                  aria-live="polite"
                  className="text-xl font-bold text-sf-strong"
                >
                  موافقت شما ثبت شد!
                </h3>
                <p className="mx-auto mt-2 max-w-lg sf-prose text-sf-dim">
                  از اینکه قوانین مارلو شاپ را مطالعه کردید سپاسگزاریم. اکنون
                  می‌توانید با خیال آسوده خرید کنید.
                </p>
                <Link
                  href="/products"
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-6 py-3 sf-meta font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <ShoppingCart className="h-4 w-4" />
                  شروع خرید
                </Link>
              </>
            ) : (
              <>
                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white">
                  <ScrollText className="h-7 w-7" aria-hidden="true" />
                </span>
                <h3 className="text-xl font-bold">موافقت با قوانین</h3>
                <p className="mx-auto mt-2 max-w-lg sf-prose text-white">
                  با کلیک روی دکمه زیر، تأیید می‌کنید که قوانین و مقررات مارلو
                  شاپ را مطالعه کرده و با آن‌ها موافقت می‌نمایید.
                </p>
                <button
                  type="button"
                  onClick={() => setAgreed(true)}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-6 py-3 sf-meta font-semibold text-zinc-900 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
                >
                  <Check className="h-4 w-4" />
                  قوانین را مطالعه کردم و موافقم
                </button>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
