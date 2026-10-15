import { describe, expect, it } from "vitest";
import {
  isUndocumentedAddressPolicyQuestion,
  isThemeQuestion,
  routeAssistantQuestion,
} from "@/lib/ai-assistant-routing";

describe("AI assistant question routing", () => {
  it.each([
    ["زمان ارسال محصول چند روزه؟", "shipping"],
    ["هزینه ارسال چقدره؟", "shipping"],
    ["آدرس پستی باید به اسم خودم باشه؟", "shipping"],
    ["میشه سفارشم رو به آدرس محل کارم بفرستید؟", "shipping"],
    ["اسم گیرنده با اسم صاحب حساب فرق داشته باشه مشکلی نیست؟", "shipping"],
    ["بعد از ثبت سفارش می‌تونم آدرس رو عوض کنم؟", "shipping"],
    ["سفارشم کی به دستم می‌رسه؟", "order"],
    ["زمان ارسال محصول چند روز است؟", "shipping"],
    ["هزینهٔ ارسال به شهرستان چقدره؟", "shipping"],
    ["سفارشم کجاست؟", "order"],
    ["پرداخت من ناموفق بود", "payment"],
    ["هدفون زیر دو میلیون معرفی کن", "product"],
    ["چطور وارد حساب شوم؟", "account"],
    ["شرایط مرجوعی چیست؟", "policy"],
  ])("routes %s to %s", (query, expected) => {
    expect(routeAssistantQuestion(query)).toBe(expected);
  });

  it.each([
    "هوا امروز چطوره؟",
    "برای سفر شمال چی بپوشم؟",
    "آدرس منزل دوستم را روی نقشه پیدا کن",
    "ارسال کن فایل را برای دوستم",
    "سفارش غذای رستوران",
  ])("keeps unrelated questions out of scope: %s", (query) => {
    expect(routeAssistantQuestion(query)).toBe("out_of_scope");
  });

  it("does not treat the conversational suffix چطوره as navigation", () => {
    expect(routeAssistantQuestion("هوا امروز چطوره؟")).toBe("out_of_scope");
  });

  it.each([
    "آدرس پستی باید به اسم خودم باشه؟",
    "میشه سفارشم رو به آدرس محل کارم بفرستید؟",
    "اسم گیرنده با اسم صاحب حساب فرق داشته باشه مشکلی نیست؟",
    "بعد از ثبت سفارش می‌تونم آدرس رو عوض کنم؟",
  ])("marks undocumented address rules for deterministic handling: %s", (query) => {
    expect(isUndocumentedAddressPolicyQuestion(query)).toBe(true);
  });

  it("does not treat a generic address question as a store shipping policy question", () => {
    expect(isUndocumentedAddressPolicyQuestion("آدرس سایت شرکت شما چیست؟")).toBe(false);
  });

  it.each([
    "تم روشن نداره سایت؟",
    "چطور حالت روشن رو فعال کنم؟",
    "سایت حالت تاریک هم داره؟",
    "ظاهر سایت رو میشه عوض کرد؟",
  ])("recognizes storefront theme questions: %s", (query) => {
    expect(isThemeQuestion(query)).toBe(true);
    expect(routeAssistantQuestion(query)).toBe("navigation");
  });

  it("does not classify an unrelated use of روشن as a theme question", () => {
    expect(isThemeQuestion("چراغ روشن برای خرید دارید؟")).toBe(false);
  });
});
