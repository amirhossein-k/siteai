"use client";

import { usePublicProducts } from "@/hooks/use-public-products";

/**
 * Session 50 — shared homepage product pool.
 *
 * ONE query (newest, limit 36) feeds the three product rails — Special Picks
 * (cheapest), Newest Products (first 12) and Premium Collection (priciest) —
 * so the homepage never issues duplicate product requests. Derivation happens
 * client-side from real API data; nothing is faked.
 */
export const HOME_POOL_SIZE = 36;

export function useHomeProductPool() {
  return usePublicProducts({ sort: "newest", limit: HOME_POOL_SIZE });
}
