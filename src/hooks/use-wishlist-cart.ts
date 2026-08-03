"use client";

import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import type { WishlistCartAddResult } from "@/types";

const addWishlistToCart = async (
  productIds?: string[]
): Promise<WishlistCartAddResult> => {
  const { data } = await axios.post("/api/wishlist/add-to-cart", {
    // undefined → resolver processes ALL of the customer's wishlist rows
    productIds: productIds && productIds.length > 0 ? productIds : undefined,
  });
  return data;
};

/**
 * Session 38 — Wishlist → Cart bulk resolver mutation.
 *
 * Calls POST /api/wishlist/add-to-cart (customer-only, server resolves FRESH
 * product/variant state — never stock-reserves). The caller maps the returned
 * `added` items into the Zustand cart via `addItem` (idempotent on the
 * composite key; quantity clamps to maxQuantity). Wishlist rows are NOT
 * modified, so no cache invalidation is needed here.
 */
export function useAddWishlistToCart() {
  return useMutation({
    mutationFn: (productIds?: string[]) => addWishlistToCart(productIds),
  });
}
