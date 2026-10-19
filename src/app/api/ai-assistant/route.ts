import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limiter";
import { getServerToken } from "@/lib/auth-utils";
import { createAssistantHandler } from "@/lib/ai-assistant/handler";
import { createMongoStoreDataSource } from "@/lib/ai-assistant/mongo-data-source";

/**
 * POST /api/ai-assistant — Marloo shopping assistant.
 *
 * The configured Anthropic-compatible model (ANTHROPIC_* env) is the primary
 * decision-maker: it reads the conversation and calls read-only server tools
 * (product search/details, catalog, official policies, the caller's own
 * orders). Security, authorization, data access and price verification stay
 * deterministic — see src/lib/ai-assistant/*.
 */
const AI_ASSISTANT_LIMIT = { max: 25, windowMs: 15 * 60 * 1000 };

const dataSource = createMongoStoreDataSource();

const handler = createAssistantHandler({
  rateLimit: (key) => rateLimit(key, AI_ASSISTANT_LIMIT),
  getCustomerId: async (req) => {
    const token = await getServerToken(req as NextRequest);
    return token?.id ? String(token.id) : null;
  },
  getDataSource: async () => dataSource,
});

export async function POST(req: NextRequest) {
  return handler(req);
}
