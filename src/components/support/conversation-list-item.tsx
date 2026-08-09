"use client";

import Link from "next/link";
import { MessageSquareText, ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ConversationStatusBadge,
  lastMessageAuthorLabel,
} from "@/components/support/conversation-status-badge";
import { CATEGORY_LABELS } from "@/components/support/conversation-category";
import type { CustomerConversation } from "@/types";

interface ConversationListItemProps {
  conversation: CustomerConversation;
  href: string;
  /** True when viewing from the customer's own account. */
  isCustomerView?: boolean;
}

function orderShortId(order: CustomerConversation["order"]): string {
  if (!order) return "؟";
  const id = typeof order === "object" ? order._id : order;
  return id ? id.slice(-8) : "؟";
}

function supplierName(supplier: CustomerConversation["supplier"]): string {
  if (!supplier) return "";
  return typeof supplier === "object" ? supplier.businessName : "";
}

/**
 * One conversation row — shared across the customer / admin / supplier lists
 * (Session 68). Shows status, subject, related order + supplier, last-message
 * preview, an unread dot and the last activity time.
 */
export function ConversationListItem({
  conversation,
  href,
  isCustomerView,
}: ConversationListItemProps) {
  const unread = isCustomerView
    ? conversation.customerUnread
    : conversation.staffUnread;
  const peerLabel = lastMessageAuthorLabel(
    conversation.lastMessageFrom,
    !!isCustomerView
  );

  return (
    <Link href={href}>
      <Card
        className={cn(
          "transition-all hover:shadow-md hover:border-primary/30 cursor-pointer",
          unread && "border-primary/40 bg-primary/5"
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                unread ? "bg-sky-100 text-sky-700" : "bg-muted text-muted-foreground"
              )}
            >
              <MessageSquareText className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>
                  {conversation.subject}
                </p>
                <ConversationStatusBadge status={conversation.status} className="text-[10px]" />
                {unread && (
                  <span className="h-2 w-2 rounded-full bg-sky-600" aria-label="خوانده‌نشده" />
                )}
              </div>

              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                سفارش #{orderShortId(conversation.order)}
                {supplierName(conversation.supplier) &&
                  ` · ${supplierName(conversation.supplier)}`}
                {CATEGORY_LABELS[conversation.category] &&
                  ` · ${CATEGORY_LABELS[conversation.category]}`}
              </p>

              <p className="mt-1.5 truncate text-sm">
                {conversation.lastMessagePreview || "بدون پیام"}
              </p>

              <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {peerLabel && <span>{peerLabel}</span>}
                {conversation.lastMessageAt && (
                  <>
                    <span>•</span>
                    <span>
                      {new Date(conversation.lastMessageAt).toLocaleDateString("fa-IR", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </>
                )}
              </p>
            </div>

            <ChevronLeft className="mt-1 h-5 w-5 shrink-0 text-muted-foreground/40" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
