"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  RefreshCw,
  ChevronRight,
  CheckCheck,
  RotateCcw,
  Lock,
  Package,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCustomerConversation,
  useSendConversationMessage,
  useUpdateConversationStatus,
} from "@/hooks/use-customer-conversations";
import { ConversationThread } from "@/components/support/conversation-thread";
import {
  ConversationStatusBadge,
} from "@/components/support/conversation-status-badge";
import { CATEGORY_LABELS } from "@/components/support/conversation-category";
import {
  getOrderShortId,
  getOrderId,
  getSupplierName,
} from "@/lib/conversation-relations";
import { showToast } from "@/components/ui/toast";
import type { ConversationStatus } from "@/types";

export default function CustomerSupportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();

  const { data: conversation, isLoading, isError, refetch } = useCustomerConversation(id);
  const send = useSendConversationMessage();
  const updateStatus = useUpdateConversationStatus();

  // --- Not logged in ---
  if (!session) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 text-center">
        <p className="text-muted-foreground">لطفاً وارد حساب خود شوید</p>
        <Button className="mt-4" onClick={() => router.push("/login")}>
          ورود
        </Button>
      </div>
    );
  }

  // --- Loading ---
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

  // --- Error ---
  if (isError || !conversation) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/support" className="transition-colors hover:text-foreground">
            پشتیبانی و پیگیری سفارش‌ها
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">جزئیات گفتگو</span>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">گفتگو یافت نشد</p>
            <Button variant="outline" onClick={() => router.push("/support")}>
              بازگشت به گفتگوها
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const orderShort = getOrderShortId(conversation.order);
  const orderId = getOrderId(conversation.order);
  const supplierName = getSupplierName(conversation.supplier);
  const productName =
    typeof conversation.product === "object" && conversation.product !== null
      ? conversation.product.name
      : undefined;

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
      showToast.success(status === "resolved" ? "گفتگو حل‌شده علامت خورد" : "گفتگو بازگشایی شد");
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
        <Link href="/support" className="transition-colors hover:text-foreground">
          پشتیبانی و پیگیری سفارش‌ها
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
          </p>
        </div>
        <div className="flex gap-2">
          {conversation.status === "resolved" || conversation.status === "closed" ? (
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
        </div>
      </div>

      {/* Order context */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Package className="h-4 w-4" />
            {orderId ? (
              <Link href={`/orders/${orderId}`} className="font-medium text-foreground hover:underline">
                سفارش #{orderShort}
              </Link>
            ) : (
              <span className="font-medium text-foreground">سفارش #{orderShort}</span>
            )}
          </div>
          {productName && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Package className="h-4 w-4" />
              {productName}
            </div>
          )}
          {supplierName && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Store className="h-4 w-4" />
              {supplierName}
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
            viewerRole="customer"
            peerLabels={{ supplier: supplierName || "فروشنده" }}
            disabled={closed}
            disabledHint="این گفتگو بسته شده است. برای ارسال پیام، ابتدا آن را بازگشایی کنید."
            placeholder="پاسخ خود را بنویسید... (Ctrl+Enter برای ارسال)"
            onSend={handleSend}
            sending={send.isPending}
          />
        </CardContent>
      </Card>

      {closed && (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" />
          گفتگو بسته شده است
        </p>
      )}

      {/* Refresh for new replies */}
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          بروزرسانی
        </Button>
      </div>
    </div>
  );
}
