/**
 * Session 65 — Cart store per-user isolation (hermetic).
 *
 * Loads the REAL `src/stores/cart-store.ts` in-process (vitest node env) with
 * an in-memory localStorage shim and proves:
 *   - guest carts persist under the legacy `cart-storage` key;
 *   - a signed-in user's cart lives under `cart-storage:<userId>` only;
 *   - one-time guest → user adoption moves the guest cart into THAT user's
 *     cart and clears the guest key (never into a different account);
 *   - logout detaches the user's cart (guest cart shows, user's cart is kept
 *     in its own key) and re-login restores it;
 *   - User B never sees User A's items on the same browser;
 *   - legacy pre-variant persisted items (no `key`) are normalized.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CartItem } from "@/stores/cart-store";

/** Minimal in-memory Storage shim (mirrors the verify-wishlist-cart.js one). */
function makeShim(): Storage {
  const raw = new Map<string, string>();
  const shim = {
    raw,
    getItem: (k: string) => (raw.has(k) ? raw.get(k)! : null),
    setItem: (k: string, v: string) => {
      raw.set(k, String(v));
    },
    removeItem: (k: string) => {
      raw.delete(k);
    },
  } as unknown as Storage;
  return shim;
}

const flushHydration = () => new Promise((r) => setTimeout(r, 0));

function envelope(items: CartItem[]): string {
  return JSON.stringify({ state: { items }, version: 0 });
}

function item(id: string, quantity = 1, maxQuantity = 5): CartItem {
  return {
    key: id,
    id,
    slug: "slug-" + id,
    name: "Product " + id,
    price: 1000,
    quantity,
    maxQuantity,
  };
}

describe("cart-store per-user isolation", () => {
  beforeEach(() => {
    // Fresh storage + fresh module registry per test — the store is a module
    // singleton with module-level owner state that must not leak between tests.
    globalThis.localStorage = makeShim();
    vi.resetModules();
  });

  it("guest cart persists under the legacy key and is rehydrated on load", async () => {
    const shim = globalThis.localStorage;
    shim.setItem("cart-storage", envelope([item("p1", 2)]));
    const { useCartStore } = await import("@/stores/cart-store");
    await flushHydration();

    const store = useCartStore.getState();
    expect(store.items).toHaveLength(1);
    expect(store.items[0].key).toBe("p1");
    expect(store.items[0].quantity).toBe(2);
    expect(store.ownerId).toBeNull();
  });

  it("first login adopts the browser guest cart into THAT user's cart and clears the guest key", async () => {
    const shim = globalThis.localStorage;
    shim.setItem("cart-storage", envelope([item("p1", 2)]));
    const { useCartStore } = await import("@/stores/cart-store");
    await flushHydration();

    useCartStore.getState().setOwner("userA");

    const state = useCartStore.getState();
    expect(state.ownerId).toBe("userA");
    // Guest items moved into A's isolated key…
    const aRaw = shim.getItem("cart-storage:userA");
    expect(aRaw).not.toBeNull();
    expect(JSON.parse(aRaw!).state.items).toHaveLength(1);
    // …and the guest copy is gone so a later user can never see it.
    expect(shim.getItem("cart-storage")).toBeNull();
  });

  it("a user with a saved cart does NOT get the guest cart merged in", async () => {
    const shim = globalThis.localStorage;
    // A already has a saved cart; the guest cart must stay untouched.
    shim.setItem("cart-storage:userA", envelope([item("pA", 1)]));
    shim.setItem("cart-storage", envelope([item("pG", 1)]));
    const { useCartStore } = await import("@/stores/cart-store");
    await flushHydration();

    useCartStore.getState().setOwner("userA");

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("pA");
    // Guest cart preserved in the guest key (shown again on logout).
    const guestRaw = shim.getItem("cart-storage");
    expect(guestRaw).not.toBeNull();
    expect(JSON.parse(guestRaw!).state.items).toHaveLength(1);
  });

  it("logout detaches the user cart; re-login restores exactly that user's cart", async () => {
    const shim = globalThis.localStorage;
    shim.setItem("cart-storage:userA", envelope([item("pA", 3)]));
    const { useCartStore } = await import("@/stores/cart-store");
    await flushHydration();

    useCartStore.getState().setOwner("userA");
    expect(useCartStore.getState().items.map((i) => i.key)).toEqual(["pA"]);

    // Logout → guest browser cart (empty here) — A's cart stays in A's key.
    useCartStore.getState().setOwner(null);
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().ownerId).toBeNull();
    const aRawAfterLogout = shim.getItem("cart-storage:userA");
    expect(aRawAfterLogout).not.toBeNull();
    expect(JSON.parse(aRawAfterLogout!).state.items).toHaveLength(1);

    // Re-login as A → cart restored from A's key.
    useCartStore.getState().setOwner("userA");
    expect(useCartStore.getState().items.map((i) => i.key)).toEqual(["pA"]);
  });

  it("User B never sees User A's cart on the same browser", async () => {
    const shim = globalThis.localStorage;
    shim.setItem("cart-storage:userA", envelope([item("pA", 3)]));
    const { useCartStore } = await import("@/stores/cart-store");
    await flushHydration();

    useCartStore.getState().setOwner("userA");
    expect(useCartStore.getState().items.map((i) => i.key)).toEqual(["pA"]);

    // Account switch → B's cart is empty (no saved cart, no guest items left).
    useCartStore.getState().setOwner("userB");
    const stateB = useCartStore.getState();
    expect(stateB.ownerId).toBe("userB");
    expect(stateB.items).toHaveLength(0);
    // A's cart remains untouched in A's key.
    const aRawStill = shim.getItem("cart-storage:userA");
    expect(aRawStill).not.toBeNull();
    expect(JSON.parse(aRawStill!).state.items).toHaveLength(1);
  });

  it("legacy persisted items without a `key` are normalized on hydration", async () => {
    const shim = globalThis.localStorage;
    // Pre-variant cart shape: no `key` field.
    shim.setItem(
      "cart-storage",
      JSON.stringify({
        state: {
          items: [
            { id: "pLegacy", slug: "s", name: "n", price: 100, quantity: 1, maxQuantity: 5 },
          ],
        },
        version: 0,
      })
    );
    const { useCartStore } = await import("@/stores/cart-store");
    await flushHydration();

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("pLegacy");
  });

  it("addItem merge + maxQuantity cap still work after owner swaps", async () => {
    const { useCartStore } = await import("@/stores/cart-store");
    await flushHydration();

    useCartStore.getState().setOwner("userA");
    const addItem = useCartStore.getState().addItem;

    for (let i = 0; i < 4; i++) {
      addItem({ id: "p1", slug: "s", name: "n", price: 100, maxQuantity: 2 });
    }
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2); // capped at maxQuantity

    // Logout keeps the merge/cap semantics intact for guests.
    useCartStore.getState().setOwner(null);
    addItem({ id: "p2", slug: "s2", name: "n2", price: 200, maxQuantity: 3 });
    expect(useCartStore.getState().items.map((i) => i.key)).toEqual(["p2"]);
  });
});
