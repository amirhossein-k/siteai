import Link from "next/link";
import {
  Truck,
  RotateCcw,
  ShieldCheck,
  MessageSquare,
  BadgeCheck,
  Package,
  Tag,
  Sparkles,
  Headphones,
  FileText,
  ShoppingBag,
  ArrowLeft,
  Heart,
  ChevronLeft,
} from "lucide-react";
import { SectionHeader } from "@/components/storefront/home/section-header";
import {
  ABOUT_HERO,
  ABOUT_MISSION,
  ABOUT_STORY,
  ABOUT_HIGHLIGHTS,
  ABOUT_COMMITMENTS,
  ABOUT_VALUES,
  ABOUT_STEPS,
  ABOUT_CTA,
  ABOUT_LINKS,
  type AboutIconId,
} from "@/lib/about-content";
import { APP_NAME } from "@/lib/constants";

/** Icon ids → lucide components (keeps the content module free of React). */
const ICON: Record<AboutIconId, typeof Truck> = {
  truck: Truck,
  rotateCcw: RotateCcw,
  shieldCheck: ShieldCheck,
  messageSquare: MessageSquare,
  badgeCheck: BadgeCheck,
  package: Package,
  tag: Tag,
  sparkles: Sparkles,
  headphones: Headphones,
  fileText: FileText,
  shoppingBag: ShoppingBag,
  heart: Heart,
};

/**
 * About Us page content — Server Component.
 *
 * Adapted from the owner-supplied reference (github.com/amirhossein-k/
 * design-aboutt): the hero → mission strip → story (text + visual) → dark band
 * → values grid → vertical timeline → CTA → helpful-links hierarchy is kept,
 * but the reference's inline-style purple palette is rebuilt on Marloo's
 * `sf-*` tokens, `glass-panel`/`glass-card`/`blue-grad` utilities and lucide
 * icons.
 *
 * The reference's fabricated content (order/customer/product/city counts,
 * founding-year timeline, team members, testimonials, "24/7 support", SSL and
 * authenticity-guarantee claims) is intentionally NOT reproduced — see
 * src/lib/about-content.ts for what replaced it and why.
 *
 * Rendered as a Server Component so the full copy is in the initial HTML.
 * The only motion is the CSS hover lift already used by the storefront cards
 * (globals.css honours prefers-reduced-motion).
 */
export function AboutPageContent() {
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
                5.1:1 / 6.5:1 (identical to the /faq and /terms hero pills). */}
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-sf-card px-3.5 py-2 sf-label font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {ABOUT_HERO.badge}
            </span>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
              {ABOUT_HERO.title}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl sf-lead text-sf-dim">
              {ABOUT_HERO.lead}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/products"
                className="blue-grad inline-flex min-h-12 items-center gap-2 rounded-xl px-6 py-3 sf-meta font-bold text-white shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                {ABOUT_CTA.primary.label}
              </Link>
              <a
                href="#story"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-sf-line-strong bg-sf-chip px-6 py-3 sf-meta font-semibold text-sf-strong transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                بیشتر بدانید
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Verified highlights ───────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ABOUT_HIGHLIGHTS.map((item) => {
            const Icon = ICON[item.icon];
            return (
              <li
                key={item.label}
                className="glass-card flex items-center gap-3 rounded-2xl p-4"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="sf-meta font-semibold text-sf-strong">
                  {item.label}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Mission band ──────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <p className="blue-grad rounded-3xl px-6 py-6 text-center sf-lead font-semibold text-white shadow-lg shadow-primary/20">
          {ABOUT_MISSION}
        </p>
      </section>

      {/* ── Story ─────────────────────────────────────────────────────── */}
      <section
        id="story"
        className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 pt-12 sm:px-6 lg:px-8"
      >
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <SectionHeader title="داستان ما" subtitle="چرا مارلو شاپ را ساختیم" />
            <div className="space-y-4">
              {ABOUT_STORY.map((paragraph, i) => (
                <p key={i} className="sf-prose text-sf-dim">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>

          {/* Token-based visual (no stock photo is used). */}
          <div
            aria-hidden="true"
            className="glass-panel relative overflow-hidden rounded-3xl p-8 sm:p-10"
          >
            <div className="pointer-events-none absolute -bottom-16 -start-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
            <div className="relative flex flex-col items-center gap-6 text-center">
              <span className="blue-grad flex h-24 w-24 items-center justify-center rounded-3xl text-white shadow-xl shadow-primary/30">
                <ShoppingBag className="h-11 w-11" />
              </span>
              <div>
                <p className="text-lg font-extrabold tracking-tight text-foreground">
                  {APP_NAME}
                </p>
                <p className="mt-1 sf-meta text-sf-dim">
                  خرید ساده، مطمئن و قابل‌اعتماد
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {["کیفیت", "اصالت", "سرعت", "پشتیبانی"].map((word) => (
                  <span
                    key={word}
                    className="rounded-full border border-sf-line bg-sf-chip px-3 py-1 sf-label font-medium text-sf-dim"
                  >
                    {word}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Commitments (dark band — replaces the reference's invented stats) ── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <div className="blue-grad relative overflow-hidden rounded-3xl px-6 py-10 text-white sm:px-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -start-20 h-56 w-56 rounded-full bg-white/10 blur-3xl"
          />
          <div className="relative">
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                تعهد ما به شما
              </h2>
              <p className="mt-2 sf-meta text-white/95">
                مواردی که در هر خرید می‌توانید روی آن‌ها حساب کنید
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ABOUT_COMMITMENTS.map((item) => {
                const Icon = ICON[item.icon];
                return (
                  <li
                    key={item.title}
                    className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm"
                  >
                    <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="text-lg font-bold">{item.title}</h3>
                    <p className="mt-2 sf-label leading-6 text-white">
                      {item.description}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Values ────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <SectionHeader
          title="ارزش‌های ما"
          subtitle="چه چیزی مارلو شاپ را متفاوت می‌کند؟"
          icon={<Heart className="h-5 w-5" aria-hidden="true" />}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ABOUT_VALUES.map((value) => {
            const Icon = ICON[value.icon];
            return (
              <div key={value.title} className="glass-card group rounded-3xl p-6">
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mb-1.5 text-lg font-semibold tracking-tight text-foreground">
                  {value.title}
                </h3>
                <p className="sf-prose text-sf-dim">
                  {value.description}
                </p>
                {value.href && (
                  <Link
                    href={value.href}
                    className="mt-3 inline-flex min-h-9 items-center gap-1 border-b border-primary/40 pb-0.5 sf-meta font-medium text-primary transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    {value.hrefLabel}
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── How ordering works (replaces the reference's founding timeline) ── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-12">
          <div>
            <SectionHeader
              title="مراحل خرید"
              subtitle="از انتخاب محصول تا تحویل و پیگیری سفارش"
            />
            <p className="sf-prose text-sf-dim">
              مسیر خرید در مارلو شاپ روشن و کوتاه است. در هر مرحله، سفارش شما
              وضعیت خود را نشان می‌دهد و می‌توانید آن را در حساب کاربری پیگیری
              کنید.
            </p>
          </div>

          <ol className="space-y-0">
            {ABOUT_STEPS.map((step, index) => {
              const isLast = index === ABOUT_STEPS.length - 1;
              return (
                <li key={step.title} className="flex gap-5">
                  {/* Number bubble + connector */}
                  <div className="flex flex-col items-center">
                    <span className="blue-grad flex h-12 w-12 shrink-0 items-center justify-center rounded-full sf-meta font-extrabold text-white shadow-lg shadow-primary/30">
                      {(index + 1).toLocaleString("fa-IR")}
                    </span>
                    {!isLast && (
                      <span
                        aria-hidden="true"
                        className="my-2 min-h-[36px] w-0.5 flex-1 rounded-full bg-gradient-to-b from-primary to-primary/20"
                      />
                    )}
                  </div>
                  {/* Content */}
                  <div className={isLast ? "pb-0" : "pb-8"}>
                    <h3 className="pt-1.5 text-lg font-bold tracking-tight text-foreground">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 sf-prose text-sf-dim">
                      {step.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* ── Helpful links ─────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <SectionHeader
          title="لینک‌های مفید"
          subtitle="برای اطلاعات بیشتر این صفحه‌ها را ببینید"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ABOUT_LINKS.map((link) => {
            const Icon = ICON[link.icon];
            return (
              <Link
                key={link.href}
                href={link.href}
                className="glass-card group flex items-start gap-4 rounded-3xl p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-lg font-semibold tracking-tight text-foreground">
                    {link.title}
                    <ChevronLeft className="h-4 w-4 text-primary transition-transform group-hover:-translate-x-0.5" />
                  </span>
                  <span className="mt-1 block sf-meta leading-6 text-sf-dim">
                    {link.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <div className="glass-panel relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 right-1/2 h-56 w-56 translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
          />
          <div className="relative">
            <span className="blue-grad mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg shadow-primary/25">
              <ShoppingBag className="h-8 w-8" aria-hidden="true" />
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              {ABOUT_CTA.title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl sf-prose text-sf-dim">
              {ABOUT_CTA.description}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={ABOUT_CTA.primary.href}
                className="blue-grad inline-flex min-h-12 items-center gap-2 rounded-xl px-7 py-3 sf-meta font-bold text-white shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                {ABOUT_CTA.primary.label}
              </Link>
              <Link
                href={ABOUT_CTA.secondary.href}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-sf-line-strong bg-sf-chip px-7 py-3 sf-meta font-semibold text-sf-strong transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <Headphones className="h-4 w-4" aria-hidden="true" />
                {ABOUT_CTA.secondary.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
