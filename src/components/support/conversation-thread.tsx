"use client";

import { useState } from "react";
import { Send, Loader2, MessageSquareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  ConversationMessage,
  ConversationSenderRole,
} from "@/types";

interface ConversationThreadProps {
  messages?: ConversationMessage[];
  /** Role of the currently-signed-in viewer (decides bubble alignment/labels). */
  viewerRole: ConversationSenderRole;
  /** Who the viewer is talking to (shown as a muted label on opposite bubbles). */
  peerLabels?: {
    customer?: string;
    supplier?: string;
    admin?: string;
  };
  /** When the conversation is closed, the composer is disabled. */
  disabled?: boolean;
  disabledHint?: string;
  placeholder?: string;
  onSend: (text: string) => Promise<void> | void;
  sending?: boolean;
}

function roleDisplay(
  role: ConversationSenderRole,
  viewerRole: ConversationSenderRole,
  peerLabels?: ConversationThreadProps["peerLabels"]
): string {
  if (role === viewerRole) return "شما";
  if (role === "customer") return peerLabels?.customer || "مشتری";
  if (role === "supplier") return peerLabels?.supplier || "فروشنده";
  return peerLabels?.admin || "پشتیبانی";
}

/**
 * Shared message thread + composer (Session 68) — used by the customer, admin
 * and supplier detail pages. The thread renders chronologically; bubbles from
 * the viewer sit on one side, peer bubbles on the other (RTL-aware).
 */
export function ConversationThread({
  messages,
  viewerRole,
  peerLabels,
  disabled,
  disabledHint,
  placeholder = "پیام خود را بنویسید...",
  onSend,
  sending,
}: ConversationThreadProps) {
  const [text, setText] = useState("");

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText("");
    try {
      await onSend(trimmed);
    } catch {
      // The parent shows the toast; restore the text so nothing is lost.
      setText(trimmed);
    }
  };

  const list = messages || [];

  return (
    <div className="flex flex-col">
      {/* Thread */}
      <div className="max-h-[50vh] min-h-[16rem] space-y-3 overflow-y-auto rounded-xl border bg-muted/30 p-4">
        {list.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageSquareOff className="h-8 w-8" />
            <p className="text-sm">هنوز پیامی در این گفتگو ثبت نشده است</p>
          </div>
        ) : (
          list.map((m) => {
            const mine = m.senderRole === viewerRole;
            return (
              <div
                key={m._id}
                className={cn(
                  "flex",
                  mine ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                    mine
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-card border"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words leading-relaxed">
                    {m.text}
                  </p>
                  <p
                    className={cn(
                      "mt-1 flex items-center gap-2 text-[11px]",
                      mine ? "text-primary-foreground/70" : "text-muted-foreground"
                    )}
                  >
                    <span className="font-medium">
                      {typeof m.sender === "object" && m.sender?.name
                        ? m.sender.name
                        : roleDisplay(m.senderRole, viewerRole, peerLabels)}
                    </span>
                    <span>•</span>
                    <span>
                      {new Date(m.createdAt).toLocaleString("fa-IR", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      {disabled ? (
        <p className="mt-4 rounded-lg border border-muted bg-muted/40 p-3 text-center text-sm text-muted-foreground">
          {disabledHint || "این گفتگو بسته شده است"}
        </p>
      ) : (
        <div className="mt-4 flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            maxLength={2000}
            rows={2}
            className="flex-1 resize-none"
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter sends — plain Enter adds a newline (Persian text).
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <Button
            onClick={() => void submit()}
            disabled={!text.trim() || sending}
            className="gap-2"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            ارسال
          </Button>
        </div>
      )}
    </div>
  );
}
