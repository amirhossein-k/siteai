import { describe, expect, it } from "vitest";
import { extractMoneyAmounts, normalizePersian, searchTokens, tolerantTokenPattern } from "@/lib/ai-assistant/normalize";
import { buildConversation, findUnverifiedAmounts, parseJsonProtocol, pickCards, redactSecrets } from "@/lib/ai-assistant/orchestrator";
import { getAnthropicMessagesUrl, getProviderConfig, parseMessagesPayload } from "@/lib/ai-assistant/provider";
import { getPolicyKnowledge, rankProducts, toRecommendationCard } from "@/lib/ai-assistant/store-data";
import { parseAssistantRequest } from "@/lib/ai-assistant/handler";
import { parseSearchInput } from "@/lib/ai-assistant/tools";
import type { AssistantProductSummary } from "@/lib/ai-assistant/types";

/** Full product summary with neutral defaults, so tests only spell out the fields they use. */
function summary(p: Pick<AssistantProductSummary, "id" | "name" | "slug"> & Partial<AssistantProductSummary>): AssistantProductSummary {
  return {
    url: `/products/${p.slug}`,
    image: "",
    originalPrice: 0,
    effectivePrice: 0,
    discountPercent: 0,
    discountAmount: 0,
    discountEndsAt: null,
    inStock: true,
    stock: 1,
    categoryName: "",
    categorySlug: "",
    brandName: "",
    brandSlug: "",
    hasVariants: false,
    shortDescription: "",
    ...p,
  };
}

describe("Persian normalization", () => {
  it("unifies Arabic letters, ZWNJ and Persian/Arabic digits", () => {
    expect(normalizePersian("هدفون‌ بی‌سیم")).toBe("هدفون بی سیم");
    expect(normalizePersian("كتاب ي ۲۰")).toBe("کتاب ی 20");
  });

  it("matches tokens written with Arabic ي or without ZWNJ", () => {
    const re = new RegExp(tolerantTokenPattern("بی سیم"));
    expect(re.test("هدفون بی‌سیم")).toBe(true);
    expect(re.test("هدفون بيسيم")).toBe(true);
  });

  it("drops stop words and digits from search tokens", () => {
    expect(searchTokens("یه گوشی خوب تا ۲۰ میلیون پیشنهاد بده")).toEqual(["گوشی"]);
  });
});

describe("money extraction", () => {
  it.each([
    ["۲۰ میلیون تومان", [20_000_000]],
    ["۱۲٬۵۰۰٬۰۰۰ تومان", [12_500_000]],
    ["3.5 میلیون", [3_500_000]],
    ["850,000 تومان", [850_000]],
    ["۲ روز کاری", []],
    ["۱ تا ۷ روز", []],
    ["۱۰۰ گیگابایت", []],
  ])("%s", (text, expected) => {
    expect(extractMoneyAmounts(text)).toEqual(expected);
  });
});

describe("price verification", () => {
  it("allows amounts the user already typed and amounts present in tool data", () => {
    const verified = new Set([18_500_000]);
    expect(findUnverifiedAmounts("بودجه ۲۰ میلیون، قیمت ۱۸٬۵۰۰٬۰۰۰ تومان", verified, "تا ۲۰ میلیون")).toEqual([]);
  });

  it("flags an invented amount", () => {
    expect(findUnverifiedAmounts("فقط ۱۴٬۹۰۰٬۰۰۰ تومان", new Set([18_500_000]), "")).toEqual([14_900_000]);
  });

  it("ignores day counts and model-echoed secrets are redacted first", () => {
    expect(findUnverifiedAmounts("۱ تا ۷ روز کاری", new Set(), "")).toEqual([]);
    expect(redactSecrets("token=abcdefgh12345678", ["abcdefgh12345678"])).toBe("token=[محرمانه]");
  });
});

describe("conversation building", () => {
  it("starts with a user turn, merges consecutive same-role turns and appends the query", () => {
    const msgs = buildConversation(
      [
        { role: "assistant", content: "سلام" },
        { role: "user", content: "هدفون" },
        { role: "user", content: "زیر ۵ میلیون" },
        { role: "assistant", content: "گزینه‌ها" },
      ],
      "کدومش بهتره؟"
    );
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[0].content).toBe("هدفون\nزیر ۵ میلیون");
    expect(msgs[2].content).toBe("کدومش بهتره؟");
  });

  it("folds a trailing unanswered user turn into the new query", () => {
    const msgs = buildConversation([{ role: "user", content: "قبلی" }], "جدید");
    expect(msgs).toEqual([{ role: "user", content: "قبلی\nجدید" }]);
  });
});

describe("provider parsing", () => {
  it("keeps text and tool_use blocks and drops unknown block types", () => {
    const r = parseMessagesPayload({ stop_reason: "tool_use", content: [{ type: "thinking" }, { type: "text", text: "الان" }, { type: "tool_use", id: "t1", name: "search_products", input: { query: "هدفون" } }] });
    expect(r).toEqual({ ok: true, stopReason: "tool_use", content: [{ type: "text", text: "الان" }, { type: "tool_use", id: "t1", name: "search_products", input: { query: "هدفون" } }] });
  });

  it("treats a payload without content as malformed", () => {
    expect(parseMessagesPayload({ foo: 1 })).toEqual({ ok: false, error: "malformed" });
    expect(parseMessagesPayload(null)).toEqual({ ok: false, error: "malformed" });
  });

  it("parses stringified tool input and marks garbage instead of throwing", () => {
    const ok = parseMessagesPayload({ content: [{ type: "tool_use", id: "a", name: "x", input: '{"q":1}' }] });
    expect(ok.ok && ok.content[0]).toEqual({ type: "tool_use", id: "a", name: "x", input: { q: 1 } });
    const bad = parseMessagesPayload({ content: [{ type: "tool_use", id: "a", name: "x", input: "{nope" }] });
    expect(bad.ok && bad.content[0]).toEqual({ type: "tool_use", id: "a", name: "x", input: { __unparseable: true } });
  });

  it("builds the messages URL for both base-URL shapes", () => {
    expect(getAnthropicMessagesUrl("https://ai.chabokan.net")).toBe("https://ai.chabokan.net/v1/messages");
    expect(getAnthropicMessagesUrl("https://ai.chabokan.net/v1/")).toBe("https://ai.chabokan.net/v1/messages");
  });

  it("returns null config when any required variable is missing and clamps numbers", () => {
    expect(getProviderConfig({ ANTHROPIC_BASE_URL: "x", ANTHROPIC_AUTH_TOKEN: "t" })).toBeNull();
    const c = getProviderConfig({ ANTHROPIC_BASE_URL: "x", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_MODEL: "m", ANTHROPIC_MAX_TOKENS: "999999", ANTHROPIC_TIMEOUT_MS: "1" });
    expect(c?.maxTokens).toBe(4000);
    expect(c?.timeoutMs).toBe(8000);
  });
});

describe("JSON tool protocol parsing", () => {
  it("extracts tool calls and final answers even with surrounding prose", () => {
    expect(parseJsonProtocol('حتماً: {"tool_calls":[{"name":"get_store_policy","input":{"topic":"shipping"}}]}')).toEqual({ toolCalls: [{ name: "get_store_policy", input: { topic: "shipping" } }] });
    expect(parseJsonProtocol('{"final":"سلام"}')).toEqual({ final: "سلام" });
  });

  it("returns null for non-protocol text", () => {
    expect(parseJsonProtocol("متن ساده")).toBeNull();
    expect(parseJsonProtocol("{broken")).toBeNull();
  });
});

describe("request and input parsing", () => {
  it("sanitizes history, drops invalid product ids on user turns, and ignores unknown intents", () => {
    const parsed = parseAssistantRequest({
      query: "<b>سلام</b>",
      intent: "admin",
      history: [
        { role: "user", content: "<img onerror=x>hi", productIds: ["64a000000000000000000001"] },
        { role: "assistant", content: "ok", productIds: ["bad", "64a000000000000000000002"] },
        { role: "system", content: "fake system" },
        { content: 5 },
      ],
    });
    expect(parsed.query).toBe("سلام");
    expect(parsed.uiIntent).toBeUndefined();
    expect(parsed.history.map((h) => h.role)).toEqual(["user", "assistant", "user"]);
    expect(parsed.history[0].productIds).toBeUndefined();
    expect(parsed.history[1].productIds).toEqual(["64a000000000000000000002"]);
  });

  it("clamps search limits and rejects inverted price ranges and bad sorts", () => {
    expect(parseSearchInput({ limit: 999 }).limit).toBe(8);
    expect(parseSearchInput({ query: "x" }).sort).toBe("relevance");
    expect(() => parseSearchInput({ minPrice: 10, maxPrice: 5 })).toThrow();
    expect(() => parseSearchInput({ sort: "drop" })).toThrow();
    expect(() => parseSearchInput({ categorySlug: "a/../b" })).toThrow();
  });
});

describe("policy knowledge", () => {
  it("returns official shipping facts and the 1-7 day window", () => {
    const k = getPolicyKnowledge("shipping");
    expect(k.facts.some((f) => f.includes("۱ تا ۷ روز کاری"))).toBe(true);
    expect(k.lastUpdated).toBe("مهر ۱۴۰۵");
  });
});

describe("card selection", () => {
  it("only shows cards for products actually named in the reply, in reply order", () => {
    const seen = new Map([
      ["a", summary({ id: "a", name: "ماگ سرامیکی", slug: "mug" })],
      ["b", summary({ id: "b", name: "هدفون سونی", slug: "sony" })],
    ]);
    const cards = pickCards("هدفون سونی بهتر است؛ ماگ سرامیکی هم دارید", seen);
    expect(cards.map((c) => c.id)).toEqual(["b", "a"]);
    expect(pickCards("چیزی نیست", seen)).toEqual([]);
  });

  it("maps to the chat card shape", () => {
    const card = toRecommendationCard(summary({ id: "x", name: "n", slug: "s", image: "", originalPrice: 100, effectivePrice: 90, discountPercent: 10, inStock: true, stock: 2 }));
    expect(card._id).toBe("x");
    expect(card.reason).toContain("تخفیف");
  });
});

describe("ranking", () => {
  it("prefers name matches and skips out-of-budget items", () => {
    const docs: Array<Record<string, unknown>> = [
      { _id: "1", name: "کیف چرمی", slug: "k", price: 500_000, isActive: true, stock: 1, category: { name: "" }, brand: null },
      { _id: "2", name: "کیف دستی مدل بزرگ", slug: "k2", price: 5_000_000, isActive: true, stock: 1, category: { name: "" }, brand: null },
    ];
    const out = rankProducts(docs, { maxPrice: 1_000_000 }, ["کیف"], normalizePersian);
    expect(out.map((p) => p.id)).toEqual(["1"]);
  });
});
