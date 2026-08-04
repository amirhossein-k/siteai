import {
  Truck,
  ShieldCheck,
  Star,
  Headphones,
  Tag,
  Package,
  BadgeCheck,
  RefreshCw,
  Heart,
  Gift,
  CreditCard,
  Store,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/storefront/home/section-header";
import type { HomepageSectionRendererProps } from "@/types";

/**
 * Whitelisted lucide icon map (mirrors TRUST_ICON_WHITELIST in
 * src/lib/homepage-content.ts — the admin can only pick these).
 */
const ICON_MAP: Record<string, LucideIcon> = {
  truck: Truck,
  "shield-check": ShieldCheck,
  star: Star,
  headphones: Headphones,
  tag: Tag,
  package: Package,
  "badge-check": BadgeCheck,
  "refresh-cw": RefreshCw,
  heart: Heart,
  gift: Gift,
  "credit-card": CreditCard,
  store: Store,
};

/**
 * Trust Badges (Session 50; Session 53 — CMS data-driven) — «چرا فروشگاه من؟».
 * Cards from `section.content` (each row = one badge, icon is a whitelisted
 * lucide name). Renders nothing when the section has no published badges.
 */
export function TrustBadges({ section }: HomepageSectionRendererProps) {
  const badges = section.content;
  if (badges.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <SectionHeader
        title={section.title || "چرا فروشگاه من؟"}
        subtitle={
          section.subtitle || "ما متعهد به ارائه بهترین تجربه خرید برای شما هستیم"
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {badges.map((badge) => {
          const Icon = ICON_MAP[badge.icon || ""] || ShieldCheck;
          return (
            <Card
              key={badge._id}
              className="group border transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <CardContent className="p-5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-1.5 text-base font-semibold">{badge.title}</h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {badge.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
