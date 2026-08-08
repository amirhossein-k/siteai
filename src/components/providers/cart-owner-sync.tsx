"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useCartStore } from "@/stores/cart-store";

/**
 * Keeps the persisted cart scoped to the signed-in user (or the guest browser
 * cart when signed out).
 *
 * Mounted inside the SessionProvider so it always has the live session. Every
 * time the session's user id changes — login, logout, account switch — it tells
 * the cart store to swap to that owner's isolated cart key. Guests (no session)
 * keep the legacy shared browser-level cart.
 *
 * This is the single fix for the "User B sees User A's cart" leak: the cart is
 * now persisted under `cart-storage:<userId>` per user, never under one
 * browser-wide key, and logout detaches the user's cart instead of leaving it
 * visible.
 */
export function CartOwnerSync() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    useCartStore.getState().setOwner(userId);
  }, [userId]);

  return null;
}
