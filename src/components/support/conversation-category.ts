import type { ConversationCategory } from "@/types";

/** Persian labels for conversation categories (Session 68). */
export const CATEGORY_LABELS: Record<ConversationCategory, string> = {
  general: "عمومی",
  order: "پیگیری سفارش",
  delivery: "مسائل ارسال",
  product: "مشکل کالا",
  refund: "بازگشت و بازپرداخت",
};

export const CATEGORY_OPTIONS: Array<{ value: ConversationCategory; label: string }> = (
  Object.keys(CATEGORY_LABELS) as ConversationCategory[]
).map((value) => ({ value, label: CATEGORY_LABELS[value] }));
