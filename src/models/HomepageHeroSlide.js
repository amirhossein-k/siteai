import mongoose from "mongoose";

/**
 * HomepageHeroSlide — Session 53 Homepage CMS, Tier 2 content model for the
 * hero carousel section. Small, focused, evolves independently.
 *
 * Bound to a section instance by `sectionSlug` (validated at the route).
 * Publish seam: `status` (draft|published) + `publishedAt`; `publishAt`
 * reserved for future scheduling (no scheduling logic yet). Soft-delete:
 * `deletedAt`.
 *
 * Public visibility rule (server-side):
 *   status === "published" && deletedAt === null && isActive === true
 */
const HomepageHeroSlideSchema = new mongoose.Schema(
  {
    sectionSlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, default: "", trim: true, maxlength: 300 },
    tagline: { type: String, default: "", trim: true, maxlength: 80 },
    ctaLabel: { type: String, default: "", trim: true, maxlength: 60 },
    ctaHref: { type: String, default: "", trim: true, maxlength: 300 },
    imageDesktop: { type: String, default: "", trim: true, maxlength: 500 },
    imageMobile: { type: String, default: "", trim: true, maxlength: 500 },
    themeColor: { type: String, default: "", trim: true, maxlength: 64 },
    sortOrder: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
    },
    publishedAt: { type: Date, default: null },
    publishAt: { type: Date, default: null }, // reserved for future scheduling
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

HomepageHeroSlideSchema.index({ sectionSlug: 1, sortOrder: 1 });
HomepageHeroSlideSchema.index({
  sectionSlug: 1,
  status: 1,
  isActive: 1,
  deletedAt: 1,
});

export default
  mongoose.models.HomepageHeroSlide ||
  mongoose.model("HomepageHeroSlide", HomepageHeroSlideSchema);
