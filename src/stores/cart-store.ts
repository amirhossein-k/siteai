"use client";

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";

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
export function cartItemKey(id: string, variantId?: string): string {
  return variantId ? `${id}:${variantId}` : id;
}

/** localStorage key for the guest cart — kept identical to the pre-fix key so
 *  existing browser guest carts survive the migration. */
const CART_STORAGE_NAME = "cart-storage";

/**
 * Resolve the storage key for a cart owner:
 *  - guests (ownerId = null) share ONE browser-level cart under the legacy key;
 *  - signed-in users get an isolated per-user cart (`cart-storage:<userId>`)
 *    so User A's cart can never surface for User B on the same browser.
 */
function cartStorageKey(ownerId: string | null): string {
  return ownerId ? `${CART_STORAGE_NAME}:${ownerId}` : CART_STORAGE_NAME;
}

/** Owner of the in-memory cart right now (kept in sync with `ownerId` state). */
let currentOwnerId: string | null = null;
/**
 * True once an owner swap happened — guards the async rehydration merge so a
 * stale guest hydration can never overwrite an already-swapped user cart.
 *
 * INVARIANT: this flag must stay FALSE on the `setOwner` no-op path (same
 * owner as current). zustand persists hydrates EXACTLY once per store
 * lifetime, reading the guest key at creation; the only set of a persisted
 * state that must still be honoured is that first guest hydration before any
 * owner change. Setting the flag on a no-op would wrongly discard it.
 */
let ownerSwapped = false;

/** Resolve the underlying Storage: window.localStorage in the browser, or the
 *  in-memory shim the Session 38 verify script installs on globalThis in Node.
 *  Returns undefined where persistence is unavailable (SSR / hermetic tests). */
function getBaseStorage(): Storage | undefined {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  const g = globalThis as unknown as { localStorage?: Storage };
  return g.localStorage ?? undefined;
}

function readRawStorage(ownerId: string | null): string | null {
  const base = getBaseStorage();
  if (!base) return null;
  try {
    return base.getItem(cartStorageKey(ownerId));
  } catch {
    return null;
  }
}

/** Read + unwrap the persisted envelope ({ state, version } — zustand persist
 *  format) for a given owner. Returns null when absent/unreadable. */
function readPersistedItems(ownerId: string | null): CartItem[] | null {
  const raw = readRawStorage(ownerId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      state?: { items?: unknown };
    } | null;
    const items = parsed?.state?.items;
    return Array.isArray(items) ? (items as CartItem[]) : null;
  } catch {
    return null;
  }
}

function removePersistedCart(ownerId: string | null): void {
  const base = getBaseStorage();
  if (!base) return;
  try {
    base.removeItem(cartStorageKey(ownerId));
  } catch {
    /* best effort */
  }
}

/** Normalize persisted items (legacy pre-variant carts had no `key`). */
function normalizeItems(items: CartItem[]): CartItem[] {
  return items.map((item) => ({
    ...item,
    key: item.key || cartItemKey(item.id, item.variantId),
  }));
}

/** Merge two item lists by composite key, capping quantities at maxQuantity. */
function mergeItems(base: CartItem[], incoming: CartItem[]): CartItem[] {
  const byKey = new Map<string, CartItem>();
  for (const item of [...base, ...incoming]) {
    const existing = byKey.get(item.key);
    if (existing) {
      byKey.set(item.key, {
        ...existing,
        quantity: Math.min(
          existing.quantity + item.quantity,
          existing.maxQuantity
        ),
      });
    } else {
      byKey.set(item.key, { ...item });
    }
  }
  return [...byKey.values()];
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  /** id of the user whose cart is loaded right now (null = guest browser cart) */
  ownerId: string | null;

  // Actions
  addItem: (item: CartItemInput) => void;
  removeItem: (key: string) => void;
  updateQuantity: (key: string, quantity: number) => void;
  clearCart: () => void;
  toggleCart: () => void;
  setCartOpen: (open: boolean) => void;
  /**
   * Switch the loaded cart to a different owner — called on login, logout and
   * account switches (see CartOwnerSync). Persists the previous owner's cart
   * (already written on every mutation) and loads the new owner's saved cart.
   * A one-time guest → user adoption moves the browser's guest cart into the
   * logged-in user's cart, but ONLY when that user has no saved cart, then
   * clears the guest copy — guest carts can never leak into another account.
   */
  setOwner: (userId: string | null) => void;

  // Computed
  totalItems: () => number;
  totalPrice: () => number;
}

/**
 * Persist storage that redirects every read/write to the CURRENT owner's cart
 * key. `currentOwnerId` is resolved at access time, so rehydration always hits
 * the guest key at store creation and every subsequent write lands on the
 * owner key active at that moment.
 */
const ownerScopedStorage = createJSONStorage(() => ({
  // Resolve the underlying storage on EVERY access so SSR/Node environments
  // without storage simply no-op instead of breaking persist's typing.
  getItem: () => {
    const base = getBaseStorage();
    if (!base) return null;
    return base.getItem(cartStorageKey(currentOwnerId));
  },
  setItem: (_name: string, value: string) => {
    const base = getBaseStorage();
    if (!base) return;
    base.setItem(cartStorageKey(currentOwnerId), value);
  },
  removeItem: () => {
    const base = getBaseStorage();
    if (!base) return;
    base.removeItem(cartStorageKey(currentOwnerId));
  },
}));

export const useCartStore = create<CartState>()(
  devtools(
    persist(
      (set, get) => ({
        items: [],
        isOpen: false,
        ownerId: null,

        addItem: (item) => {
          const key = cartItemKey(item.id, item.variantId);
          const existing = get().items.find((i) => i.key === key);
          if (existing) {
            // Increment quantity, but don't exceed max stock
            const newQty = Math.min(
              existing.quantity + 1,
              existing.maxQuantity
            );
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

        setOwner: (userId) => {
          const next = userId || null;
          if (next === currentOwnerId) return;
          const prev = currentOwnerId;

          // Guest → signed-in: adopt the browser's guest cart into THIS user's
          // cart, but only when the user has no saved cart yet (first login on
          // this device). The guest key is cleared right after so the guest
          // cart never resurfaces for a later user on the same browser.
          if (prev === null && next !== null) {
            const guestItems = readPersistedItems(null);
            const userItems = readPersistedItems(next);
            if (
              guestItems &&
              guestItems.length > 0 &&
              (!userItems || userItems.length === 0)
            ) {
              currentOwnerId = next;
              ownerSwapped = true;
              set({
                ownerId: next,
                items: mergeItems(
                  normalizeItems(userItems || []),
                  normalizeItems(guestItems)
                ),
              });
              removePersistedCart(null);
              return;
            }
          }

          // Logout (→ null) / login with a saved cart / account switch:
          // the previous owner's items are already persisted (every mutation
          // writes), so this is a straight load of the next owner's cart.
          currentOwnerId = next;
          ownerSwapped = true;
          const saved = readPersistedItems(next);
          set({ ownerId: next, items: saved ? normalizeItems(saved) : [] });
        },

        totalItems: () =>
          get().items.reduce((sum, item) => sum + item.quantity, 0),

        totalPrice: () =>
          get().items.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
          ),
      }),
      {
        name: CART_STORAGE_NAME,
        storage: ownerScopedStorage,
        partialize: (state) => ({
          items: state.items,
        }),
        // Async rehydration must never overwrite a cart that setOwner already
        // swapped (initial guest hydration can resolve after a login swap).
        merge: (persistedState, currentState) => {
          if (ownerSwapped) return currentState;
          return {
            ...currentState,
            ...(persistedState as Partial<CartState>),
          };
        },
        // Normalize legacy persisted items (pre-variant carts had no `key`)
        onRehydrateStorage: () => (state) => {
          if (!state) return;
          state.items = normalizeItems(state.items);
        },
      }
    ),
    { name: "CartStore" }
  )
);
