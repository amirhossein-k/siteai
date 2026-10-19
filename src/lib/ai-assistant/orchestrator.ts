/**
 * Model-first orchestration loop.
 *
 *   user turn ─► model (with tool definitions) ─► tool_use? ─► server validates
 *        ▲                                                   + authorizes + runs
 *        └──────────── tool_result (allowlisted data) ◄──────┘
 *   final text ─► deterministic checks (price verification, secret redaction)
 *              ─► product cards built from SERVER data, never from model text.
 *
 * The keyword router (ai-assistant-routing.ts) is no longer a gate: it is only
 * used by the degraded path when the model provider is unavailable.
 */
import { callModel, type ContentBlock, type FetchLike, type ModelMessage, type ProviderConfig } from "./provider";
import { ASSISTANT_TOOLS, executeTool, type ToolExecutionContext } from "./tools";
import { buildJsonProtocolAddendum, buildSystemPrompt, UI_INTENT_HINTS } from "./prompt";
import { extractMoneyAmounts, formatToman, isObjectIdLike, normalizePersian, toLatinDigits } from "./normalize";
import { getPolicyKnowledge, type PolicyTopic } from "./store-data";
import { linksForRoute, routeAssistantQuestion } from "@/lib/ai-assistant-routing";
import type {
  AssistantAuthContext,
  AssistantProductSummary,
  AssistantResult,
  HistoryTurn,
  StoreDataSource,
} from "./types";

export type ToolMode = "native" | "json" | "auto";

export interface RunAssistantInput {
  query: string;
  history: HistoryTurn[];
  uiIntent?: string;
  budgetHint?: number;
  auth: AssistantAuthContext;
  data: StoreDataSource;
  provider: ProviderConfig | null;
  fetchImpl?: FetchLike;
  toolMode?: ToolMode;
  now?: Date;
  /** Values that must never appear in a reply (env secrets). */
  secrets?: string[];
  maxSteps?: number;
  totalBudgetMs?: number;
}

const MAX_TOOL_CALLS_PER_STEP = 4;
const PRICE_TOLERANCE = 0.01;

// ── history → provider messages ─────────────────────────────────────────

export function buildConversation(history: HistoryTurn[], query: string): ModelMessage[] {
  const turns = history.filter((h) => h.content.trim()).slice(-8);
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content += `\n${t.content}`;
    else merged.push({ role: t.role, content: t.content });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  if (merged.length && merged[merged.length - 1].role === "user") {
    // Two user turns in a row (e.g. previous request failed) → fold into the new query.
    const prev = merged.pop()!;
    query = `${prev.content}\n${query}`;
  }
  return [...merged, { role: "user", content: query }];
}

function conversationProductIds(history: HistoryTurn[]): string[] {
  const ids: string[] = [];
  for (const t of [...history].reverse()) {
    for (const id of t.productIds || []) if (isObjectIdLike(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= 8) break;
  }
  return ids.slice(0, 8);
}

// ── deterministic post-checks ───────────────────────────────────────────

export function findUnverifiedAmounts(reply: string, verified: Set<number>, userText: string): number[] {
  const allowed = new Set<number>(extractMoneyAmounts(userText));
  const verifiedList = [...verified];
  const out: number[] = [];
  for (const amount of extractMoneyAmounts(reply)) {
    if (allowed.has(amount)) continue;
    const ok = verifiedList.some((v) => Math.abs(v - amount) <= Math.max(1, v * PRICE_TOLERANCE));
    if (!ok && !out.includes(amount)) out.push(amount);
  }
  return out;
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[محرمانه]");
  return out;
}

export function pickCards(reply: string, seen: Map<string, AssistantProductSummary>): AssistantProductSummary[] {
  const normalizedReply = normalizePersian(reply);
  const hits: Array<{ p: AssistantProductSummary; pos: number }> = [];
  for (const p of seen.values()) {
    const byName = p.name ? normalizedReply.indexOf(normalizePersian(p.name)) : -1;
    const bySlug = p.slug ? reply.indexOf(`/products/${p.slug}`) : -1;
    const pos = byName >= 0 ? byName : bySlug;
    if (pos >= 0) hits.push({ p, pos });
  }
  return hits.sort((a, b) => a.pos - b.pos).slice(0, 4).map((h) => h.p);
}

function routesForTools(log: ToolExecutionContext["log"], cards: number): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  const add = (label: string, href: string) => !out.some((r) => r.href === href) && out.push({ label, href });
  const names = new Set(log.filter((l) => l.ok).map((l) => l.name));
  if (names.has("search_products") || cards) add("محصولات", "/products");
  if (names.has("get_my_orders")) add("سفارش‌ها", "/orders");
  if (names.has("get_store_policy")) {
    add("قوانین و مقررات", "/terms");
    add("سوالات متداول", "/faq");
  }
  return out.slice(0, 4);
}

// ── JSON protocol (only when the gateway rejects native tools) ──────────

export function parseJsonProtocol(text: string): { toolCalls?: Array<{ name: string; input: unknown }>; final?: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof obj.final === "string") return { final: obj.final };
    if (Array.isArray(obj.tool_calls)) {
      return {
        toolCalls: obj.tool_calls
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map((c) => ({ name: String(c.name || ""), input: c.input ?? {} })),
      };
    }
  } catch {
    return null;
  }
  return null;
}

// ── main loop ───────────────────────────────────────────────────────────

export async function runAssistant(input: RunAssistantInput): Promise<AssistantResult> {
  const now = input.now ?? new Date();
  const ctx: ToolExecutionContext = {
    data: input.data,
    auth: input.auth,
    seenProducts: new Map(),
    verifiedAmounts: new Set(),
    log: [],
  };

  if (!input.provider) return degradedAnswer(input, ctx, "not_configured");

  // Products referenced earlier: re-read from the DB (client text is untrusted).
  let conversationProducts: Array<{ id: string; name: string }> = [];
  const refIds = conversationProductIds(input.history);
  if (refIds.length) {
    try {
      const fresh = await input.data.getProductsByIds(refIds);
      conversationProducts = fresh.map((p) => ({ id: p.id, name: p.name }));
    } catch {
      conversationProducts = [];
    }
  }

  const baseSystem = buildSystemPrompt({
    todayIso: now.toISOString().slice(0, 10),
    isAuthenticated: Boolean(input.auth.customerId),
    conversationProducts,
    uiHint: input.uiIntent ? UI_INTENT_HINTS[input.uiIntent] : undefined,
    budgetHint: input.budgetHint,
  });

  let mode: "native" | "json" = input.toolMode === "json" ? "json" : "native";
  const messages: ModelMessage[] = buildConversation(input.history, input.query);
  const userText = [input.query, ...input.history.filter((h) => h.role === "user").map((h) => h.content)].join("\n");
  const maxSteps = input.maxSteps ?? 6;
  const deadline = Date.now() + (input.totalBudgetMs ?? 55_000);
  let correctionUsed = false;
  let steps = 0;
  let finalText = "";
  let priceCheck: "ok" | "corrected" | "unverified" = "ok";

  while (steps < maxSteps) {
    if (Date.now() > deadline) return degradedAnswer(input, ctx, "timeout");
    steps += 1;
    const lastStep = steps === maxSteps;
    const system = mode === "json" ? baseSystem + buildJsonProtocolAddendum(ASSISTANT_TOOLS) : baseSystem;
    const res = await callModel(
      input.provider,
      { system, messages, tools: mode === "native" ? ASSISTANT_TOOLS : undefined },
      input.fetchImpl
    );

    if (!res.ok) {
      if (res.toolsRejected && mode === "native" && input.toolMode !== "native") {
        mode = "json";
        steps -= 1;
        continue;
      }
      return degradedAnswer(input, ctx, res.error);
    }

    // Gather tool calls (native blocks or JSON protocol).
    let toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let text = res.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();

    if (mode === "native") {
      toolCalls = res.content
        .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    } else {
      const parsed = parseJsonProtocol(text);
      if (parsed?.toolCalls?.length) {
        toolCalls = parsed.toolCalls.map((c, i) => ({ id: `json_${steps}_${i}`, ...c }));
      } else if (parsed?.final) {
        text = parsed.final;
      }
    }

    if (toolCalls.length && !lastStep) {
      const accepted = toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP);
      const results = [] as Array<{ id: string; name: string; ok: boolean; content: string }>;
      for (const call of accepted) {
        const out = await executeTool(call.name, call.input, ctx);
        results.push({ id: call.id, name: call.name, ...out });
      }
      if (mode === "native") {
        messages.push({ role: "assistant", content: res.content.filter((b) => b.type === "text" || b.type === "tool_use") });
        const blocks: ContentBlock[] = results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
          is_error: !r.ok || undefined,
        }));
        // Calls beyond the per-step cap still need a result block.
        for (const extra of toolCalls.slice(MAX_TOOL_CALLS_PER_STEP)) {
          blocks.push({ type: "tool_result", tool_use_id: extra.id, content: '{"error":"too_many_tool_calls"}', is_error: true });
        }
        if (steps === maxSteps - 1) blocks.push({ type: "text", text: "این آخرین فرصت است: دیگر ابزاری صدا نزن و با همین داده‌ها پاسخ نهایی را بنویس." });
        messages.push({ role: "user", content: blocks });
      } else {
        messages.push({ role: "assistant", content: text || "{}" });
        messages.push({
          role: "user",
          content: `نتایج ابزار:\n${results.map((r) => `[${r.name}] ${r.content}`).join("\n")}${steps === maxSteps - 1 ? "\nاین آخرین فرصت است؛ فقط {\"final\": ...} برگردان." : ""}`,
        });
      }
      continue;
    }

    if (!text) {
      // Empty / malformed answer (e.g. tool loop exhausted) → grounded degraded path.
      return degradedAnswer(input, ctx, toolCalls.length ? "tool_loop_exhausted" : "malformed");
    }

    // Secrets never leave the server, even if the model echoes them back.
    text = redactSecrets(text, input.secrets || []);

    // Deterministic price verification against server data.
    const unverified = findUnverifiedAmounts(text, ctx.verifiedAmounts, userText);
    if (unverified.length && !correctionUsed && !lastStep && Date.now() < deadline) {
      correctionUsed = true;
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `[پیام سیستم، نه کاربر] این مبالغ در پاسخ تو در داده‌های ابزار وجود ندارد: ${unverified.map(formatToman).join("، ")}. پاسخ را فقط با قیمت‌های دقیق خروجی ابزار بازنویسی کن (در صورت نیاز دوباره ابزار را صدا بزن) و هیچ رقم ساختگی ننویس. فقط متن پاسخ نهایی به کاربر را بنویس.${mode === "json" ? ' خروجی: {"final": "..."}' : ""}`,
      });
      priceCheck = "corrected";
      continue;
    }
    if (unverified.length) {
      priceCheck = "unverified";
      text += "\n\n⚠️ برخی ارقام این پاسخ با داده‌های فروشگاه تطبیق داده نشد؛ قیمت قطعی همان قیمت روی کارت و صفحه محصول است.";
    }
    finalText = text;
    break;
  }

  if (!finalText) return degradedAnswer(input, ctx, "tool_loop_exhausted");

  const cards = pickCards(finalText, ctx.seenProducts);
  return {
    reply: finalText,
    recommendations: cards,
    relatedRoutes: routesForTools(ctx.log, cards.length),
    meta: {
      provider: "anthropic-compatible",
      toolMode: mode,
      steps,
      toolCalls: ctx.log,
      priceCheck,
      grounded: ctx.log.some((l) => l.ok),
      authRequired: ctx.log.some((l) => l.name === "get_my_orders") && !input.auth.customerId,
    },
    status: 200,
  };
}

// ── degraded path: provider down / not configured ───────────────────────

function parseBudget(query: string): number | undefined {
  const q = toLatinDigits(query).replace(/[٬،]/g, ",");
  const m = q.match(/(?:زیر|کمتر از|تا|حدود|بودجه|حداکثر)\s*(\d[\d,.]*)\s*(هزار|میلیون|ملیون|میلیارد)?/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const mult = m[2] === "هزار" ? 1e3 : m[2] === "میلیون" || m[2] === "ملیون" ? 1e6 : m[2] === "میلیارد" ? 1e9 : 1;
  return Math.floor(n * mult);
}

const DEGRADED_NOTICE = "ℹ️ دستیار هوشمند موقتاً در دسترس نیست؛ این پاسخ مستقیماً از اطلاعات رسمی و داده‌های فروشگاه تهیه شده است.";

async function degradedAnswer(input: RunAssistantInput, ctx: ToolExecutionContext, reason: string): Promise<AssistantResult> {
  const route = routeAssistantQuestion(input.query);
  const meta = { provider: "fallback-no-model", fallbackReason: reason, route, toolCalls: ctx.log };
  const base = { relatedRoutes: linksForRoute(route), meta };
  const topicByRoute: Partial<Record<string, PolicyTopic>> = { shipping: "shipping", policy: "returns", account: "account" };

  if (route === "greeting") {
    return { ...base, status: 200, recommendations: [], reply: "سلام! 👋 من دستیار خرید مارلو شاپ هستم. درباره محصولات، قیمت و موجودی، ارسال، مرجوعی و سفارش‌هایتان بپرسید." };
  }
  const topic = topicByRoute[route] || (route === "payment" && !input.auth.customerId ? "payment" : undefined);
  if (topic) {
    const k = getPolicyKnowledge(topic);
    const facts = k.facts.filter((f) => !f.startsWith("پرسش:")).slice(0, 7);
    return { ...base, status: 200, recommendations: [], reply: `${DEGRADED_NOTICE}\n\n${facts.map((f) => `• ${f}`).join("\n")}` };
  }
  if (route === "order" || route === "payment") {
    if (!input.auth.customerId) {
      return { ...base, meta: { ...meta, authRequired: true }, status: 200, recommendations: [], reply: "برای مشاهده وضعیت سفارش یا پرداخت، لطفاً ابتدا وارد حساب کاربری شوید (/login). اطلاعات سفارش فقط به صاحب حساب نمایش داده می‌شود." };
    }
    try {
      const [order] = await input.data.getCustomerOrders(input.auth.customerId, { limit: 1 });
      if (!order) return { ...base, status: 200, recommendations: [], reply: "هنوز سفارشی در حساب شما ثبت نشده است." };
      const tracking = order.trackingCode ? `\n• کد رهگیری: ${order.trackingCode}` : "";
      return {
        ...base,
        status: 200,
        recommendations: [],
        reply: `${DEGRADED_NOTICE}\n\n📦 آخرین سفارش شما (#${order.orderRef}):\n• وضعیت: ${order.statusLabel}\n• وضعیت پرداخت: ${order.paymentStatusLabel}\n• مبلغ: ${formatToman(order.totalAmount)}${tracking}\nجزئیات: ${order.url}`,
      };
    } catch {
      return { ...base, status: 503, recommendations: [], reply: "در حال حاضر دسترسی به اطلاعات سفارش ممکن نیست. لطفاً کمی بعد دوباره تلاش کنید یا از بخش سفارش‌ها (/orders) پیگیری کنید." };
    }
  }
  if (route === "product") {
    try {
      const maxPrice = input.budgetHint ?? parseBudget(input.query);
      const sort = input.uiIntent === "discounted" ? "discount" : input.uiIntent === "budget" ? "price_asc" : input.uiIntent === "newest" ? "newest" : input.uiIntent === "best_sellers" ? "best_selling" : "relevance";
      const { products, relaxedQuery } = await input.data.searchProducts({ query: input.query, maxPrice, sort, limit: 4 });
      if (!products.length) {
        return { ...base, status: 200, recommendations: [], reply: `${DEGRADED_NOTICE}\n\nمحصول موجودی با این مشخصات پیدا نشد. عبارت دیگری را امتحان کنید یا از صفحه محصولات (/products) کمک بگیرید.` };
      }
      const lines = products.map((p) => `• **${p.name}**: ${formatToman(p.effectivePrice)}${p.discountPercent ? ` (${p.discountPercent}٪ تخفیف)` : ""}`);
      const head = relaxedQuery ? "مورد دقیقی پیدا نشد؛ این‌ها محصولات موجود فروشگاه هستند:" : "این محصولات موجود با درخواست شما مرتبط‌اند:";
      return { ...base, status: 200, recommendations: products, reply: `${DEGRADED_NOTICE}\n\n${head}\n${lines.join("\n")}` };
    } catch {
      return { ...base, status: 503, recommendations: [], reply: "در حال حاضر دسترسی به اطلاعات محصولات ممکن نیست. لطفاً کمی بعد دوباره تلاش کنید." };
    }
  }
  return {
    ...base,
    status: 503,
    recommendations: [],
    reply: "دستیار هوشمند در این لحظه در دسترس نیست. لطفاً چند لحظه بعد دوباره تلاش کنید، یا از صفحه‌های محصولات (/products)، سوالات متداول (/faq) و پشتیبانی (/support) کمک بگیرید.",
  };
}
