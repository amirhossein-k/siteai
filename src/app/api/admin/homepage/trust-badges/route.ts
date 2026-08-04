import { createContentRouteHandlers } from "@/lib/homepage-admin-api";
import HomepageTrustBadge from "@/models/HomepageTrustBadge";

/**
 * Admin CRUD for homepage TRUST BADGES (Session 53).
 * See src/lib/homepage-admin-api.ts for the shared implementation.
 */
export const { GET, POST, PUT, DELETE } = createContentRouteHandlers(
  "trust-badge",
  HomepageTrustBadge
);
