import { describe, it, expect } from "vitest";
import {
  COGS_SOURCE_LABELS,
  cogsSource,
  LAYER_SOURCE_LABELS,
  MOVEMENT_LABELS,
} from "@/lib/accounting-v2";

describe("accounting-v2 movement labels", () => {
  it("labels every movement type in Persian (audit-friendly)", () => {
    const types = [
      "opening_balance",
      "receipt",
      "sale",
      "return_restock",
      "cancellation_restock",
      "purchase_return",
      "adjustment",
      "sourcing_change",
    ];
    for (const t of types) {
      expect(MOVEMENT_LABELS[t]).toBeTruthy();
    }
    // Human-readable Persian, not the raw enum.
    expect(MOVEMENT_LABELS.receipt).toBe("دریافت خرید");
    expect(MOVEMENT_LABELS.sale).toBe("فروش");
    expect(MOVEMENT_LABELS.opening_balance).toBe("موجودی اولیه");
    expect(MOVEMENT_LABELS.adjustment).toBe("تعدیل");
  });

  it("covers every enum value the model allows", () => {
    // The model enum (src/models/InventoryMovement.js) — keep in sync.
    const modelTypes = [
      "opening_balance",
      "receipt",
      "sale",
      "return_restock",
      "cancellation_restock",
      "purchase_return",
      "adjustment",
      "sourcing_change",
    ];
    for (const t of modelTypes) {
      expect(Object.prototype.hasOwnProperty.call(MOVEMENT_LABELS, t)).toBe(true);
    }
  });
});

describe("accounting-v2 layer source labels", () => {
  it("labels every layer source the model emits", () => {
    expect(LAYER_SOURCE_LABELS.opening).toBe("موجودی اولیه");
    expect(LAYER_SOURCE_LABELS.receipt).toBe("دریافت خرید");
    expect(LAYER_SOURCE_LABELS.adjustment).toBe("تعدیل");
  });
});

describe("accounting-v2 COGS source classification", () => {
  it("classifies post-cutover FIFO items as fifo", () => {
    expect(cogsSource(100000)).toBe("fifo");
    expect(cogsSource(0)).toBe("fifo"); // zero-cost layer is still a layer
  });

  it("classifies missing fifoUnitCost as the historical snapshot", () => {
    expect(cogsSource(null)).toBe("snapshot");
    expect(cogsSource(undefined)).toBe("snapshot");
  });

  it("exposes the labelled Persian source names", () => {
    expect(COGS_SOURCE_LABELS.fifo).toContain("FIFO");
    expect(COGS_SOURCE_LABELS.snapshot).toContain("اسنپ‌شات");
  });
});
