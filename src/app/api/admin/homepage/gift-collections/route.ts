import { createContentRouteHandlers } from "@/lib/homepage-admin-api";
import HomepageGiftCollection from "@/models/HomepageGiftCollection";

/**
 * Admin CRUD for homepage GIFT COLLECTIONS (Session 53).
 * See src/lib/homepage-admin-api.ts for the shared implementation.
 */
export const { GET, POST, PUT, DELETE } = createContentRouteHandlers(
  "gift-collection",
  HomepageGiftCollection
);
