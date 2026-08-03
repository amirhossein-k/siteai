"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import axios from "axios";
import type { PaginatedResponse, WishlistItem, WishlistIdsResponse } from "@/types";

export const wishlistKeys = {
  all: ["wishlist"] as const,
  ids: () => [...wishlistKeys.all, "ids"] as const,
  lists: () => [...wishlistKeys.all, "list"] as const,
  list: (page = 1) => [...wishlistKeys.lists(), page] as const,
};

const fetchIds = async (): Promise<WishlistIdsResponse> => {
  const { data } = await axios.get("/api/wishlist/ids");
  return data;
};

const fetchWishlist = async (
  page = 1
): Promise<PaginatedResponse<WishlistItem>> => {
  const { data } = await axios.get(`/api/wishlist?page=${page}`);
  return data;
};

const addToWishlist = async (productId: string, variantId?: string) => {
  const { data } = await axios.post("/api/wishlist", {
    productId,
    // undefined variantId → product-level row (never silently pick a default)
    ...(variantId ? { variantId } : {}),
  });
  return data;
};

const removeFromWishlist = async (productId: string, variantId?: string) => {
  const { data } = await axios.delete("/api/wishlist", {
    data: {
      productId,
      // variantId present → remove exactly that variant row;
      // absent → remove ALL rows for the product (product-card heart).
      ...(variantId ? { variantId } : {}),
    },
  });
  return data;
};

/**
 * The authenticated customer's wishlist product ids (+ count).
 * One cached fetch serves every heart on every card/detail page.
 */
export function useWishlistIds() {
  const { data: session, status } = useSession();
  const isCustomer = session?.user?.role === "customer";

  return useQuery({
    queryKey: wishlistKeys.ids(),
    queryFn: fetchIds,
    enabled: status === "authenticated" && !!isCustomer,
    staleTime: 60_000,
  });
}

/** Paginated wishlist items for the /wishlist page. */
export function useWishlistItems(page = 1) {
  const { data: session, status } = useSession();
  const isCustomer = session?.user?.role === "customer";

  return useQuery({
    queryKey: wishlistKeys.list(page),
    queryFn: () => fetchWishlist(page),
    enabled: status === "authenticated" && !!isCustomer,
  });
}

/**
 * Toggle a wishlist row with optimistic UI.
 *
 * Session 43 — variant-aware: `variantId` present → add/remove exactly that
 * variant row; absent → product-level add, or (on remove) the product-card
 * semantics of removing ALL rows for the product. `inWishlist` is always the
 * PRODUCT-level heart state (ids is deduped to one id per product), so a
 * variant-remove keeps the productId in `ids` optimistically (other rows may
 * still exist) — onSettled invalidation self-corrects within one round-trip.
 */
export function useToggleWishlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      productId,
      inList,
      variantId,
    }: {
      productId: string;
      inList: boolean;
      variantId?: string;
    }) =>
      inList
        ? removeFromWishlist(productId, variantId)
        : addToWishlist(productId, variantId),
    // Optimistic: flip the heart + badge immediately
    onMutate: async ({ productId, inList, variantId }) => {
      await queryClient.cancelQueries({ queryKey: wishlistKeys.ids() });
      const previous = queryClient.getQueryData<WishlistIdsResponse>(
        wishlistKeys.ids()
      );
      if (previous) {
        // Only a variantId-less remove drops the deduped product id (that is
        // the remove-all-rows semantics). Variant removes keep it.
        const nextIds = inList && !variantId
          ? previous.ids.filter((id) => id !== productId)
          : !inList && !previous.ids.includes(productId)
          ? [...previous.ids, productId]
          : previous.ids;
        queryClient.setQueryData<WishlistIdsResponse>(wishlistKeys.ids(), {
          ids: nextIds,
          count: Math.max(0, previous.count + (inList ? -1 : 1)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(wishlistKeys.ids(), ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: wishlistKeys.all });
    },
  });
}
