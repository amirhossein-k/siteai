import Link from "next/link";
import { ArrowLeft, Megaphone } from "lucide-react";
import { homepageConfig } from "@/lib/homepage-config";
import { cn } from "@/lib/utils";

/**
 * Featured Campaign Banner (Session 50).
 * Full-width promotional banner driven by homepage-config.ts — pure static
 * content, no backend. Gradient art only (no image dependency).
 */
export function CampaignBanner() {
  const banner = homepageConfig.campaignBanner;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl bg-gradient-to-l px-6 py-10 text-white shadow-sm sm:rounded-3xl sm:px-12 sm:py-14",
          banner.gradient
        )}
      >
        {/* Decorative rings */}
        <div
          className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-white/10"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-white/10"
          aria-hidden="true"
        />

        <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium backdrop-blur">
              <Megaphone className="h-3.5 w-3.5" />
              کمپین ویژه
            </span>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {banner.title}
            </h2>
            <p className="mt-2 text-sm leading-7 text-white/85 sm:text-base">
              {banner.subtitle}
            </p>
          </div>
          <Link
            href={banner.cta.href}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
          >
            {banner.cta.label}
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
