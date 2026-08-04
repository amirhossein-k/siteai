import mongoose from "mongoose";

/**
 * HomepageTrustBadge — Session 53 Homepage CMS, Tier 2 content model for the
 * trust-badges section. Bound to a section instance by `sectionSlug`.
 * `icon` is a whitelisted lucide icon name (validated at the route).
 *
 * Publish seam: `status` (draft|published) + `publishedAt`; `publishAt`
 * reserved for future scheduling. Soft-delete: `deletedAt`.
 *
 * Public visibility rule (server-side):
 *   status === "published" && deletedAt === null && isActive === true
 */
const HomepageTrustBadgeSchema = new mongoose.Schema(
  {
    sectionSlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    icon: { type: String, default: "", trim: true, maxlength: 40 },
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

HomepageTrustBadgeSchema.index({ sectionSlug: 1, sortOrder: 1 });
HomepageTrustBadgeSchema.index({
  sectionSlug: 1,
  status: 1,
  isActive: 1,
  deletedAt: 1,
});

export default
  mongoose.models.HomepageTrustBadge ||
  mongoose.model("HomepageTrustBadge", HomepageTrustBadgeSchema);
