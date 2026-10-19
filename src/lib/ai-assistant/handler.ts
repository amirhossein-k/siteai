/**
 * Framework-agnostic POST handler for /api/ai-assistant. The Next.js route
 * injects the real dependencies (rate limiter, NextAuth session, Mongo data
 * source); tests inject fixtures + a mocked provider `fetch`.
 */
import { sanitizePlainText } from "@/lib/sanitize";
import { getProviderConfig, type FetchLike } from "./provider";
import { runAssistant, type ToolMode } from "./orchestrator";
import { isObjectIdLike } from "./normalize";
import { toRecommendationCard } from "./store-data";
import type { HistoryTurn, StoreDataSource } from "./types";

export interface AssistantHandlerDeps {
  rateLimit(key: string): Promise<{ limited: boolean; headers?: Record<string, string> }>;
  /** Customer id from the verified server session (NextAuth JWT + tokenVersion), or null. */
  getCustomerId(req: Request): Promise<string | null>;
  getDataSource(): Promise<StoreDataSource>;
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

const UI_INTENTS = new Set(["best_sellers", "discounted", "budget", "newest", "search", "compare"]);
const MAX_QUERY_CHARS = 500;
const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 800;

export interface ParsedAssistantRequest {
  query: string;
  history: HistoryTurn[];
  uiIntent?: string;
  budgetHint?: number;
}

export function parseAssistantRequest(body: unknown): ParsedAssistantRequest {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const query = typeof b.query === "string" ? sanitizePlainText(b.query).slice(0, MAX_QUERY_CHARS).trim() : "";
  const history: HistoryTurn[] = [];
  if (Array.isArray(b.history)) {
    for (const item of b.history.slice(-MAX_HISTORY_TURNS)) {
      if (!item || typeof item !== "object") continue;
      const h = item as Record<string, unknown>;
      if (typeof h.content !== "string") continue;
      const content = sanitizePlainText(h.content).slice(0, MAX_TURN_CHARS).trim();
      if (!content) continue;
      const role = h.role === "assistant" ? "assistant" : "user";
      const productIds = Array.isArray(h.productIds) ? h.productIds.filter(isObjectIdLike).slice(0, 8) : undefined;
      history.push({ role, content, productIds: role === "assistant" ? productIds : undefined });
    }
  }
  // Client intent is only a UI hint for the model, never a routing decision.
  const uiIntent = typeof b.intent === "string" && UI_INTENTS.has(b.intent) && b.intent !== "search" ? b.intent : undefined;
  const budgetHint =
    typeof b.maxPrice === "number" && Number.isFinite(b.maxPrice) && b.maxPrice > 0 && b.maxPrice < 1e12
      ? Math.floor(b.maxPrice)
      : undefined;
  return { query, history, uiIntent, budgetHint };
}

function secretValues(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => v && v.length >= 8 && /(TOKEN|SECRET|KEY|PASSWORD|MONGODB|URI|MERCHANT)/i.test(k) && !k.startsWith("NEXT_PUBLIC_"))
    .map(([, v]) => v as string);
}

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...(headers || {}) },
  });
}

export function createAssistantHandler(deps: AssistantHandlerDeps) {
  return async function POST(req: Request): Promise<Response> {
    const env = deps.env ?? process.env;
    try {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
      const rl = await deps.rateLimit(`ai-assistant:${ip}`);
      if (rl.limited) {
        return json(
          { error: "تعداد درخواست‌های شما به دستیار هوشمند بیش از حد مجاز است. لطفاً چند دقیقه دیگر تلاش کنید." },
          429,
          rl.headers
        );
      }

      const body = await req.json().catch(() => ({}));
      const parsed = parseAssistantRequest(body);
      if (!parsed.query) {
        return json({
          reply: "سؤال یا نام محصول مورد نظرتان را بنویسید تا درباره خرید، ارسال، قوانین یا محصولات مارلو شاپ راهنمایی‌تان کنم.",
          recommendations: [],
          relatedRoutes: [],
          meta: { provider: "input-guard" },
        });
      }

      const [customerId, data] = await Promise.all([deps.getCustomerId(req), deps.getDataSource()]);
      const mode = String(env.AI_ASSISTANT_TOOL_MODE || "auto");
      const result = await runAssistant({
        ...parsed,
        auth: { customerId },
        data,
        provider: getProviderConfig(env),
        fetchImpl: deps.fetchImpl,
        toolMode: (["native", "json", "auto"].includes(mode) ? mode : "auto") as ToolMode,
        now: deps.now?.(),
        secrets: secretValues(env),
        totalBudgetMs: Math.min(90_000, Math.max(10_000, Number(env.AI_ASSISTANT_TOTAL_BUDGET_MS) || 55_000)),
      });
      return json(
        { reply: result.reply, recommendations: result.recommendations.map(toRecommendationCard), relatedRoutes: result.relatedRoutes, meta: result.meta },
        result.status,
        rl.headers
      );
    } catch (error) {
      console.error("AI Assistant error:", (error as Error)?.message || error);
      return json({ error: "خطایی در پردازش درخواست دستیار هوشمند رخ داد." }, 500);
    }
  };
}
