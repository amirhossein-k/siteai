import mongoose from "mongoose";

/**
 * HomepageSection — Session 53 Homepage CMS, Tier 1 (composition layer).
 *
 * One document per homepage SECTION INSTANCE. This is metadata + presentation
 * ONLY — never section content. Content lives in the per-type content models
 * (HomepageHeroSlide / HomepageCampaignBanner / HomepageGiftCollection /
 * HomepageTrustBadge) bound to a section by `sectionSlug`.
 *
 * Identity vs renderer (decoupled on purpose):
 *   - `slug`      — stable, unique, human-meaningful identity (admin URLs,
 *                   analytics keys). IMMUTABLE after creation.
 *   - `component` — renderer identifier resolved through the server-side
 *                   homepage block registry (src/lib/homepage-sections/registry.ts).
 *                   IMMUTABLE after creation.
 *
 * Publishing: the section level only knows visibility (`enabled`). The
 * draft/published seam lives on content models (status + publishedAt), with
 * `publishAt` reserved for future scheduling. Soft-delete: `deletedAt`.
 */
const appearanceSchema = new mongoose.Schema(
  {
    themeColor: { type: String, default: "", trim: true, maxlength: 64 },
    background: { type: String, default: "", trim: true, maxlength: 128 },
    spacing: { type: String, default: "", trim: true, maxlength: 64 },
    borderRadius: { type: String, default: "", trim: true, maxlength: 64 },
  },
  { _id: false }
);

const behaviorSchema = new mongoose.Schema(
  {
    autoplay: { type: Boolean, default: true },
    autoplayInterval: { type: Number, default: 6000, min: 1000 },
    showArrows: { type: Boolean, default: true },
    showDots: { type: Boolean, default: true },
    countdownEnabled: { type: Boolean, default: false },
    countdownTarget: {
      type: String,
      enum: ["end_of_day", "fixed", "off"],
      default: "off",
    },
    countdownEndsAt: { type: Date, default: null },
    maxItems: { type: Number, default: 12, min: 1, max: 100 },
    layoutVariant: {
      type: String,
      enum: ["grid", "carousel", "stacked", "split"],
      default: "grid",
    },
  },
  { _id: false }
);

const HomepageSectionSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    component: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    title: { type: String, default: "", trim: true, maxlength: 120 },
    subtitle: { type: String, default: "", trim: true, maxlength: 300 },
    enabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, min: 0 },
    presentation: {
      appearance: { type: appearanceSchema, default: () => ({}) },
      behavior: { type: behaviorSchema, default: () => ({}) },
    },
    // Soft delete — public queries always exclude deletedAt != null.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

HomepageSectionSchema.index({ enabled: 1, deletedAt: 1, sortOrder: 1 });

export default
  mongoose.models.HomepageSection ||
  mongoose.model("HomepageSection", HomepageSectionSchema);
