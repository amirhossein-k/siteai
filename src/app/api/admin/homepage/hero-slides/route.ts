import { createContentRouteHandlers } from "@/lib/homepage-admin-api";
import HomepageHeroSlide from "@/models/HomepageHeroSlide";

/**
 * Admin CRUD for homepage HERO SLIDES (Session 53).
 * See src/lib/homepage-admin-api.ts for the shared implementation.
 */
export const { GET, POST, PUT, DELETE } = createContentRouteHandlers(
  "hero-slide",
  HomepageHeroSlide
);
