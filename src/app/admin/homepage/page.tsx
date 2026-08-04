"use client";

import { useState } from "react";
import { LayoutTemplate, Image as ImageIcon, Megaphone, Gift, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionsEditor } from "@/components/admin/homepage/sections-editor";
import {
  ContentEditor,
  type HomepageContentType,
} from "@/components/admin/homepage/content-editor";
import { useAdminHomepageSections } from "@/hooks/use-admin-homepage";

type Tab = "sections" | HomepageContentType;

/** Renderer component used by each content type (to find its default section). */
const TYPE_COMPONENT: Record<HomepageContentType, string> = {
  "hero-slide": "hero-carousel",
  "campaign-banner": "campaign-banner",
  "gift-collection": "gift-collections",
  "trust-badge": "trust-badges",
};

const DEFAULT_SLUG: Record<HomepageContentType, string> = {
  "hero-slide": "hero",
  "campaign-banner": "campaign-banner",
  "gift-collection": "gift-collections",
  "trust-badge": "trust-badges",
};

const TABS: { id: Tab; label: string; icon: typeof LayoutTemplate }[] = [
  { id: "sections", label: "بخش‌ها", icon: LayoutTemplate },
  { id: "hero-slide", label: "اسلایدر", icon: ImageIcon },
  { id: "campaign-banner", label: "بنر کمپین", icon: Megaphone },
  { id: "gift-collection", label: "کالکشن هدیه", icon: Gift },
  { id: "trust-badge", label: "نشان‌های اعتماد", icon: ShieldCheck },
];

/**
 * Admin — Homepage CMS (Session 53).
 * Tabs: section composition + presentation (Tier 1) and one content editor
 * per content type (Tier 2). Content editors are scoped to a section slug;
 * the default section for the type is preselected, and any other section
 * using the same renderer can be selected from the dropdown.
 */
export default function AdminHomepage() {
  const [tab, setTab] = useState<Tab>("sections");
  const { data: sections } = useAdminHomepageSections();

  const contentType = tab === "sections" ? null : tab;

  // The selected section slug for the current content tab. Defaults to the
  // first section using the type's renderer component; falls back to the
  // canonical slug.
  const defaultSlug = contentType
    ? sections?.find((s) => s.component === TYPE_COMPONENT[contentType])?.slug ??
      DEFAULT_SLUG[contentType]
    : "";
  const [manualSlug, setManualSlug] = useState<string | null>(null);
  const selectedSlug = contentType
    ? manualSlug ?? defaultSlug
    : "";

  const switchTab = (next: Tab) => {
    setTab(next);
    setManualSlug(null);
  };

  const contentSections =
    sections?.filter((s) =>
      contentType ? s.component === TYPE_COMPONENT[contentType] : false
    ) ?? [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">مدیریت صفحه اصلی</h1>
        <p className="text-sm text-muted-foreground">
          بخش‌ها، ترتیب، ظاهر و محتوای صفحه اصلی فروشگاه
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "sections" ? (
        <SectionsEditor />
      ) : (
        <div className="space-y-4">
          {/* Section scope picker */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            <label className="text-sm font-medium">بخش هدف:</label>
            <select
              className="flex h-10 min-w-56 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selectedSlug}
              onChange={(e) => setManualSlug(e.target.value)}
            >
              {contentSections.length === 0 && (
                <option value={defaultSlug}>{defaultSlug}</option>
              )}
              {contentSections.map((s) => (
                <option key={s._id} value={s.slug}>
                  {s.slug} ({s.component})
                </option>
              ))}
            </select>
            <p className="w-full text-xs text-muted-foreground sm:w-auto">
              محتوای این تب به بخش انتخابی متصل می‌شود — چند بخش می‌توانند از یک
              رندرر مشترک استفاده کنند.
            </p>
          </div>

          <ContentEditor type={contentType!} sectionSlug={selectedSlug} />
        </div>
      )}
    </div>
  );
}
