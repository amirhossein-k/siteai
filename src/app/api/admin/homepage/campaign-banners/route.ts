import { createContentRouteHandlers } from "@/lib/homepage-admin-api";
import HomepageCampaignBanner from "@/models/HomepageCampaignBanner";

/**
 * Admin CRUD for homepage CAMPAIGN BANNERS (Session 53).
 * See src/lib/homepage-admin-api.ts for the shared implementation.
 */
export const { GET, POST, PUT, DELETE } = createContentRouteHandlers(
  "campaign-banner",
  HomepageCampaignBanner
);
