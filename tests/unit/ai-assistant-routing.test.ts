import { describe, expect, it } from "vitest";
import { routeAssistantQuestion } from "@/lib/ai-assistant-routing";

describe("AI assistant question routing", () => {
  it.each([
    ["زمان ارسال چند روز است؟", "shipping"],
    ["هزینه ارسال چقدر است؟", "shipping"],
    ["سفارشم کجاست؟", "order"],
    ["پرداخت من ناموفق بود", "payment"],
    ["هدفون زیر دو میلیون معرفی کن", "product"],
    ["چطور وارد حساب شوم؟", "account"],
    ["شرایط مرجوعی چیست؟", "policy"],
  ])("routes %s to %s", (query, expected) => {
    expect(routeAssistantQuestion(query)).toBe(expected);
  });
});
