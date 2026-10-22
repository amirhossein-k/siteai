import mongoose from "mongoose";

/**
 * HomepageSeoAccordionItem — session: SEO accordion content model (Tier 2) for
 * the `seo-accordion` homepage block. Bound to a section instance by
 * `sectionSlug`, following the exact Session 53 content-model contract used by
 * HomepageHeroSlide / HomepageCampaignBanner / HomepageGiftCollection /
 * HomepageTrustBadge.
 *
 * Field mapping (kept on the shared content contract so the generic admin
 * CRUD factory + public projection apply unchanged):
 *   - `title`       → accordion question (prompt/heading)
 *   - `description` → accordion answer (explanatory text)
 *
 * Publish seam: `status` (draft|published) + `publishedAt`; `publishAt`
 * reserved for future scheduling. Soft-delete: `deletedAt`. Samples created by
 * the seed are DRAFT — nothing is exposed publicly until an admin publishes it.
 *
 * Public visibility rule (server-side, enforced in getContentRowsByComponent):
 *   status === "published" && deletedAt === null && isActive === true
 */
const HomepageSeoAccordionItemSchema = new mongoose.Schema(
  {
    sectionSlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    sortOrder: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    publishedAt: { type: Date, default: null },
    publishAt: { type: Date, default: null }, // reserved for future scheduling
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

HomepageSeoAccordionItemSchema.index({ sectionSlug: 1, sortOrder: 1 });
HomepageSeoAccordionItemSchema.index({
  sectionSlug: 1,
  status: 1,
  isActive: 1,
  deletedAt: 1,
});

export default
  mongoose.models.HomepageSeoAccordionItem ||
  mongoose.model("HomepageSeoAccordionItem", HomepageSeoAccordionItemSchema);
