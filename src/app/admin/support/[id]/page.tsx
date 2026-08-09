"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  RefreshCw,
  ChevronRight,
  CheckCheck,
  Lock,
  RotateCcw,
  Package,
  Store,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAdminConversation,
  useAdminSendConversationMessage,
  useAdminUpdateConversationStatus,
} from "@/hooks/use-admin-conversations";
import { ConversationThread } from "@/components/support/conversation-thread";
import { ConversationStatusBadge } from "@/components/support/conversation-status-badge";
import { CATEGORY_LABELS } from "@/components/support/conversation-category";
import {
  getCustomerName,
  getOrderShortId,
  getSupplierName,
} from "@/lib/conversation-relations";
import { showToast } from "@/components/ui/toast";
import type { ConversationStatus } from "@/types";

export default function AdminSupportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: conversation, isLoading, isError, refetch } = useAdminConversation(id);
  const send = useAdminSendConversationMessage();
  const updateStatus = useAdminUpdateConversationStatus();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <Skeleton className="mb-4 h-8 w-48" />
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !conversation) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">گفتگو یافت نشد</p>
            <Button variant="outline" onClick={() => router.push("/admin/support")}>
              بازگشت به صف پشتیبانی
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const customer =
    conversation.customer && typeof conversation.customer === "object"
      ? conversation.customer
      : null;
  const orderShort = getOrderShortId(conversation.order);
  const supplierName = getSupplierName(conversation.supplier);
  const closed = conversation.status === "closed";

  const handleSend = async (text: string) => {
    try {
      await send.mutateAsync({ id, text });
      refetch();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ارسال پیام"
          : "خطا در ارسال پیام";
      showToast.error(msg);
    }
  };

  const handleStatus = async (status: ConversationStatus) => {
    try {
      await updateStatus.mutateAsync({ id, status });
      showToast.success("وضعیت گفتگو به‌روزرسانی شد");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در تغییر وضعیت"
          : "خطا در تغییر وضعیت";
      showToast.error(msg);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/support" className="transition-colors hover:text-foreground">
          مرکز پشتیبانی
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{conversation.subject}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{conversation.subject}</h1>
            <ConversationStatusBadge status={conversation.status} className="text-sm" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {CATEGORY_LABELS[conversation.category]} · سفارش #{orderShort}
            {supplierName && ` · ${supplierName}`}
            {customer && ` · ${customer.name} (${customer.phone})`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {closed ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => void handleStatus("open")}
              disabled={updateStatus.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              بازگشایی
            </Button>
          ) : (
            <>
              {conversation.status !== "resolved" && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => void handleStatus("resolved")}
                  disabled={updateStatus.isPending}
                >
                  <CheckCheck className="h-4 w-4" />
                  حل شد
                </Button>
              )}
              <Button
                variant="destructive"
                className="gap-2"
                onClick={() => void handleStatus("closed")}
                disabled={updateStatus.isPending}
              >
                <Lock className="h-4 w-4" />
                بستن گفتگو
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Context */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Package className="h-4 w-4" />
            <span className="font-medium text-foreground">سفارش #{orderShort}</span>
          </div>
          {supplierName && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Store className="h-4 w-4" />
              {supplierName}
            </div>
          )}
          {customer && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" />
              {customer.name} — {customer.phone}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thread + composer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">گفتگو</CardTitle>
        </CardHeader>
        <CardContent>
          <ConversationThread
            messages={conversation.messages}
            viewerRole="admin"
            peerLabels={{ customer: getCustomerName(conversation.customer) || "مشتری", supplier: supplierName || "فروشنده" }}
            disabled={closed}
            disabledHint="این گفتگو بسته شده است. برای ارسال پیام ابتدا آن را بازگشایی کنید."
            placeholder="پاسخ پشتیبانی را بنویسید... (Ctrl+Enter برای ارسال)"
            onSend={handleSend}
            sending={send.isPending}
          />
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-center">
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          بروزرسانی
        </Button>
      </div>
    </div>
  );
}
