import mongoose from "mongoose";

/**
 * Expense — operating-expense ledger (Session 82 Phase E).
 *
 * APPROVED SCOPE (Session 82 design, Phase E):
 *  - Fields: category, description, amount, expenseDate, paymentMethod,
 *    reference, payee, notes, status (paid | pending | void), createdBy,
 *    updatedBy, voidedAt, voidedBy, voidReason, timestamps.
 *  - Status machine: paid ↔ pending (pay marks paid; edit allowed while not
 *    void) · paid/pending → void (AUDITED void — a voidReason is REQUIRED and
 *    the row is never hard-deleted; voided rows stay for the audit trail and
 *    are EXCLUDED from every financial total).
 *  - Voids are final — no un-void. Corrections after a void are NEW rows.
 *  - Never fabricate data: an expense's amount is exactly what the admin
 *    recorded; nothing is derived or estimated (e.g. no gateway-fee
 *    estimation — the Session 82 decision: gateway fees are entered manually
 *    as category "gateway_fees").
 *
 * ACCOUNTING RULES (server-enforced by the API layer):
 *  - P&L operating expenses = Σ non-void expense amounts in the window.
 *  - Net Profit = Gross Profit − Operating Expenses — only shown when the
 *    expense ledger is authoritative (always post-init; no fake zeros).
 */

/** Expense categories (the approved Session 82 list — DO NOT rename). */
export const EXPENSE_CATEGORIES = [
  "shipping",
  "packaging",
  "advertising",
  "gateway_fees",
  "rent",
  "utilities",
  "salaries",
  "software",
  "maintenance",
  "other",
];

/** Persian labels for the expense categories (UI + Excel). */
export const EXPENSE_CATEGORY_LABELS = {
  shipping: "حمل‌ونقل",
  packaging: "بسته‌بندی",
  advertising: "تبلیغات",
  gateway_fees: "کارمزد درگاه پرداخت",
  rent: "اجاره",
  utilities: "قبوض (آب/برق/گاز)",
  salaries: "حقوق و دستمزد",
  software: "نرم‌افزار و سرویس‌ها",
  maintenance: "تعمیر و نگهداری",
  other: "سایر",
};

/** Expense statuses — paid | pending | void (void = audited, never deleted). */
export const EXPENSE_STATUSES = ["paid", "pending", "void"];

export const EXPENSE_STATUS_LABELS = {
  paid: "پرداخت شده",
  pending: "در انتظار پرداخت",
  void: "باطل شده",
};

/** Expense payment methods (how the store paid — distinct from order methods). */
export const EXPENSE_PAYMENT_METHODS = [
  "cash",
  "bank",
  "card",
  "online",
  "other",
];

export const EXPENSE_PAYMENT_METHOD_LABELS = {
  cash: "نقدی",
  bank: "حواله بانکی",
  card: "کارت",
  online: "پرداخت آنلاین",
  other: "سایر",
};

const ExpenseSchema = new mongoose.Schema(
  {
    // Cost category (approved enum).
    category: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    // Whole-toman amount (the store's currency convention).
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // The business date of the expense (drives the report window).
    expenseDate: {
      type: Date,
      default: () => new Date(),
    },
    paymentMethod: {
      type: String,
      enum: EXPENSE_PAYMENT_METHODS,
      default: null,
    },
    reference: {
      type: String,
      trim: true,
      default: "",
      maxlength: 200,
    },
    payee: {
      type: String,
      trim: true,
      default: "",
      maxlength: 200,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: EXPENSE_STATUSES,
      default: "pending",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Audited void metadata (voidReason REQUIRED by the API — never deleted).
    voidedAt: {
      type: Date,
      default: null,
    },
    voidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    voidReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
  },
  { timestamps: true }
);

// Report windowing + status/category filters + audit listing.
ExpenseSchema.index({ expenseDate: -1, createdAt: -1 });
ExpenseSchema.index({ status: 1, expenseDate: -1 });
ExpenseSchema.index({ category: 1, expenseDate: -1 });

export default mongoose.models.Expense ||
  mongoose.model("Expense", ExpenseSchema);
