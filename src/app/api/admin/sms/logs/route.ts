import { NextResponse, NextRequest } from "next/server";
import { dbConnect } from "@/lib/dbConnect";
import { requireRoleOrError, serverError } from "@/lib/auth-utils";
import {
  parsePaginationParams,
  buildPaginatedResponse,
  escapeRegex,
} from "@/lib/pagination";
import SmsLog from "@/models/SmsLog";

/**
 * Session 90 — Admin business-SMS log listing (Phase 1b).
 *
 * GET /api/admin/sms/logs
 *   Admin-only. Paginated (Session 76 helpers), newest first. Filters:
 *     ?status=sent|failed        — final outcome
 *     ?messageType=<enum>        — business message type
 *     ?q=<recipient substring>   — escaped recipient search
 *     ?templateId=<objectId>     — sends of one template
 *   Bounded page size via PAGINATION.MAX_PAGE_SIZE. Populates the actor and
 *   customer user names only (no phone-hash/token material exists here).
 */
const LOG_STATUSES = ["sent", "failed"] as const;
const LOG_TYPES = [
  "order_confirmation",
  "shipping_update",
  "tracking_code",
  "delivery_followup",
  "custom",
] as const;

export async function GET(req: NextRequest) {
  const { error } = await requireRoleOrError(req, ["admin"]);
  if (error) return error;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const { page, limit, skip } = parsePaginationParams(searchParams);

    const filter: Record<string, unknown> = {};
    const status = searchParams.get("status");
    if (status && (LOG_STATUSES as readonly string[]).includes(status)) {
      filter.status = status;
    }
    const messageType = searchParams.get("messageType");
    if (messageType && (LOG_TYPES as readonly string[]).includes(messageType)) {
      filter.messageType = messageType;
    }
    const templateId = searchParams.get("templateId");
    if (templateId && /^[0-9a-fA-F]{24}$/.test(templateId)) {
      filter.template = templateId;
    }
    const q = (searchParams.get("q") || "").trim();
    if (q) {
      filter.recipient = { $regex: escapeRegex(q) };
    }

    const [rows, total] = await Promise.all([
      SmsLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name")
        .populate("user", "name")
        .lean(),
      SmsLog.countDocuments(filter),
    ]);

    return NextResponse.json(
      buildPaginatedResponse(
        rows.map((l) => ({
          _id: String(l._id),
          recipient: l.recipient,
          user: l.user
            ? { _id: String((l.user as { _id: unknown })._id), name: (l.user as { name: string }).name }
            : null,
          order: l.order ? String(l.order) : null,
          template: l.template ? String(l.template) : null,
          templateName: l.templateName || "",
          messageType: l.messageType,
          provider: l.provider,
          providerMessageId: l.providerMessageId || "",
          status: l.status,
          error: l.error || "",
          errorMessage: l.errorMessage || "",
          message: l.message || "",
          sentAt: l.sentAt ? l.sentAt.toISOString() : null,
          createdBy: l.createdBy
            ? { _id: String((l.createdBy as { _id: unknown })._id), name: (l.createdBy as { name: string }).name }
            : null,
          createdAt: l.createdAt.toISOString(),
        })),
        total,
        page,
        limit
      )
    );
  } catch (error) {
    console.error("Error fetching SMS logs:", error);
    return serverError();
  }
}
