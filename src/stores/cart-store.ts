"use client";

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export interface CartItem {
  /** Composite dedup key — product id, or `productId:variantId` for variants */
  key: string;
  /** Product document id */
  id: string;
  /** Variant subdocument id (present only for variant products) */
  variantId?: string;
  sku?: string;
  /** Human-readable variant label, e.g. "قرمز / L" */
  variantLabel?: string;
  slug: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  maxQuantity: number;
}

export type CartItemInput = Omit<CartItem, "key" | "quantity">;

/** Build the composite dedup key for a cart item */
export function cartItemKey(
  id: string,
  variantId?: string
): string {
  return variantId ? `${id}:${variantId}` : id;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;

  // Actions
  addItem: (item: CartItemInput) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  clearCart: () => void;
  toggleCart: () => void;
  setCartOpen: (open: boolean) => void;

  // Computed
  totalItems: () => number;
  totalPrice: () => number;
}

export const useCartStore = create<CartState>()(
  devtools(
    persist(
      (set, get) => ({
        items: [],
        isOpen: false,

        addItem: (item) => {
          const key = cartItemKey(item.id, item.variantId);
          const existing = get().items.find((i) => i.key === key);
          if (existing) {
            // Increment quantity, but don't exceed max stock
            const newQty = Math.min(existing.quantity + 1, existing.maxQuantity);
            set({
              items: get().items.map((i) =>
                i.key === key ? { ...i, quantity: newQty } : i
              ),
            });
          } else {
            set({
              items: [...get().items, { ...item, key, quantity: 1 }],
            });
          }
        },

        removeItem: (key) => {
          set({ items: get().items.filter((i) => i.key !== key) });
        },

        updateQuantity: (key, quantity) => {
          if (quantity <= 0) {
            get().removeItem(key);
            return;
          }
          const item = get().items.find((i) => i.key === key);
          if (!item) return;
          const clamped = Math.min(quantity, item.maxQuantity);
          set({
            items: get().items.map((i) =>
              i.key === key ? { ...i, quantity: clamped } : i
            ),
          });
        },

        clearCart: () => set({ items: [] }),

        toggleCart: () => set({ isOpen: !get().isOpen }),

        setCartOpen: (open) => set({ isOpen: open }),

        totalItems: () =>
          get().items.reduce((sum, item) => sum + item.quantity, 0),

        totalPrice: () =>
          get().items.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
          ),
      }),
      {
        name: "cart-storage",
        partialize: (state) => ({
          items: state.items,
        }),
        // Normalize legacy persisted items (pre-variant carts had no `key`)
        onRehydrateStorage: () => (state) => {
          if (!state) return;
          state.items = state.items.map((item) => ({
            ...item,
            key: item.key || cartItemKey(item.id, item.variantId),
          }));
        },
      }
    ),
    { name: "CartStore" }
  )
);
