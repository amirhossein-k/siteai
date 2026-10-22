import { createContentRouteHandlers } from "@/lib/homepage-admin-api";
import HomepageSeoAccordionItem from "@/models/HomepageSeoAccordionItem";

/**
 * Admin CRUD for the homepage SEO ACCORDION items (question/answer content
 * managed from the dashboard). See src/lib/homepage-admin-api.ts for the
 * shared implementation: admin-only RBAC, server-side validation against the
 * type contract, draft/published seam and soft-delete.
 */
export const { GET, POST, PUT, DELETE } = createContentRouteHandlers(
  "seo-accordion-item",
  HomepageSeoAccordionItem
);
