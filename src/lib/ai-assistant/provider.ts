/**
 * Client for the already-configured Anthropic-compatible Messages endpoint
 * (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL — currently the
 * Chabokan gateway). Same provider and auth headers as before; this module
 * adds native `tools` support and strict response parsing.
 *
 * No secrets are ever logged or returned: errors carry only a category and
 * the HTTP status.
 */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ProviderConfig {
  baseUrl: string;
  token: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

export type ProviderErrorKind = "not_configured" | "timeout" | "http_error" | "network" | "malformed";

export type ModelResponse =
  | { ok: true; content: ContentBlock[]; stopReason: string }
  | { ok: false; error: ProviderErrorKind; status?: number; toolsRejected?: boolean };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function getProviderConfig(env: Record<string, string | undefined> = process.env): ProviderConfig | null {
  const baseUrl = env.ANTHROPIC_BASE_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN;
  const model = env.ANTHROPIC_MODEL;
  if (!baseUrl || !token || !model) return null;
  return {
    baseUrl,
    token,
    model,
    // Per-request timeout. The tool loop can make several requests.
    timeoutMs: Math.min(60_000, Math.max(8_000, Number(env.ANTHROPIC_TIMEOUT_MS) || 20_000)),
    // Tool use + reasoning models need more room than the old 320-token cap.
    maxTokens: Math.min(4_000, Math.max(256, Number(env.ANTHROPIC_MAX_TOKENS) || 1_200)),
  };
}

export function getAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

/** Validate and narrow the provider payload. Unknown block types (e.g. `thinking`) are dropped. */
export function parseMessagesPayload(payload: unknown): ModelResponse {
  if (!payload || typeof payload !== "object") return { ok: false, error: "malformed" };
  const p = payload as { content?: unknown; stop_reason?: unknown };
  if (!Array.isArray(p.content)) return { ok: false, error: "malformed" };
  const content: ContentBlock[] = [];
  for (const raw of p.content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      content.push({ type: "text", text: b.text });
    } else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
      let input = b.input;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          input = { __unparseable: true };
        }
      }
      content.push({ type: "tool_use", id: b.id, name: b.name, input: input ?? {} });
    }
  }
  return { ok: true, content, stopReason: typeof p.stop_reason === "string" ? p.stop_reason : "" };
}

export async function callModel(
  config: ProviderConfig,
  request: { system: string; messages: ModelMessage[]; tools?: unknown[]; temperature?: number },
  fetchImpl: FetchLike = fetch
): Promise<ModelResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: request.temperature ?? 0.3,
      system: request.system,
      messages: request.messages,
    };
    if (request.tools && request.tools.length) {
      body.tools = request.tools;
      body.tool_choice = { type: "auto" };
    }
    const response = await fetchImpl(getAnthropicMessagesUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.token,
        authorization: `Bearer ${config.token}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      let toolsRejected = false;
      if ((response.status === 400 || response.status === 422) && request.tools?.length) {
        const text = await response.text().catch(() => "");
        toolsRejected = /tool/i.test(text);
      }
      return { ok: false, error: "http_error", status: response.status, toolsRejected };
    }
    const payload = await response.json().catch(() => null);
    return parseMessagesPayload(payload);
  } catch (error) {
    const aborted = (error as { name?: string })?.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
