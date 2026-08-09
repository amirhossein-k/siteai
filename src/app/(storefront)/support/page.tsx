"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  MessageSquareText,
  Plus,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import {
  useCustomerConversations,
  useEligibleConversationOrders,
  useCreateConversation,
} from "@/hooks/use-customer-conversations";
import { ConversationListItem } from "@/components/support/conversation-list-item";
import { CATEGORY_OPTIONS } from "@/components/support/conversation-category";
import { showToast } from "@/components/ui/toast";
import type { ConversationStatus } from "@/types";

const statusFilters: Array<{ value: ConversationStatus | null; label: string }> = [
  { value: null, label: "همه" },
  { value: "open", label: "باز" },
  { value: "pending", label: "در انتظار پاسخ شما" },
  { value: "resolved", label: "حل‌شده" },
  { value: "closed", label: "بسته" },
];

export default function CustomerSupportPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [statusFilter, setStatusFilter] = useState<ConversationStatus | null>(null);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [supplierOrderId, setSupplierOrderId] = useState("");
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const create = useCreateConversation();

  const {
    data: paged,
    isLoading,
    isError,
    refetch,
  } = useCustomerConversations({ status: statusFilter || undefined, page });

  const { data: eligibleOrders } = useEligibleConversationOrders();

  const conversations = paged?.data || [];
  const totalPages = paged?.totalPages || 1;

  // Prefill the create form from /support?order=<orderId> (order-detail button).
  useEffect(() => {
    const pre = searchParams.get("order");
    if (pre) {
      setOrderId(pre);
      setShowCreate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  // Reset the supplier picker whenever the order changes.
  useEffect(() => {
    setSupplierOrderId("");
  }, [orderId]);

  const selectedOrder = useMemo(
    () => eligibleOrders?.find((o) => o.orderId === orderId),
    [eligibleOrders, orderId]
  );

  // --- Not logged in ---
  if (!session) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <MessageSquareText className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">پشتیبانی و پیگیری سفارش‌ها</h1>
          <p className="mb-8 text-muted-foreground">
            برای پیگیری سفارش و دریافت پشتیبانی وارد حساب کاربری شوید
          </p>
          <Button size="lg" onClick={() => router.push("/login?callbackUrl=/support")}>
            ورود به حساب
          </Button>
        </div>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!subject.trim() || !message.trim() || !orderId || !supplierOrderId) {
      showToast.error("لطفاً سفارش، فروشنده، عنوان و متن پیام را وارد کنید");
      return;
    }
    try {
      const conv = await create.mutateAsync({
        orderId,
        supplierOrderId,
        category,
        subject: subject.trim(),
        message: message.trim(),
      });
      showToast.success("گفتگو با موفقیت ایجاد شد");
      setShowCreate(false);
      setSubject("");
      setMessage("");
      router.push(`/support/${conv._id}`);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data?: { error?: string } } }).response?.data
              ?.error || "خطا در ایجاد گفتگو"
          : "خطا در ایجاد گفتگو";
      showToast.error(msg);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          صفحه اصلی
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">پشتیبانی و پیگیری سفارش‌ها</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">پشتیبانی و پیگیری سفارش‌ها</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            پیگیری سفارش، وضعیت ارسال، مشکلات کالا و بازپرداخت
          </p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)} className="gap-2">
          {showCreate ? null : <Plus className="h-4 w-4" />}
          {showCreate ? "بستن فرم" : "شروع گفتگو جدید"}
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="mb-6 border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg">شروع گفتگوی جدید</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {eligibleOrders && eligibleOrders.length === 0 ? (
              <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                برای شروع گفتگو ابتدا باید یک سفارش پرداخت‌شده داشته باشید.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="conversation-order" className="mb-1.5 block text-sm font-medium">سفارش</label>
                    <select
                      id="conversation-order"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">انتخاب سفارش...</option>
                      {eligibleOrders?.map((o) => (
                        <option key={o.orderId} value={o.orderId}>
                          سفارش #{o.orderShortId}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="conversation-supplier" className="mb-1.5 block text-sm font-medium">فروشنده</label>
                    <select
                      id="conversation-supplier"
                      value={supplierOrderId}
                      onChange={(e) => setSupplierOrderId(e.target.value)}
                      disabled={!selectedOrder || selectedOrder.suppliers.length === 0}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                    >
                      <option value="">
                        {selectedOrder && selectedOrder.suppliers.length === 0
                          ? "فروشنده‌ای برای این سفارش نیست"
                          : "انتخاب فروشنده..."}
                      </option>
                      {selectedOrder?.suppliers.map((s) => (
                        <option key={s.supplierOrderId} value={s.supplierOrderId}>
                          {s.businessName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="conversation-category" className="mb-1.5 block text-sm font-medium">موضوع</label>
                    <select
                      id="conversation-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="conversation-subject" className="mb-1.5 block text-sm font-medium">
                      عنوان گفتگو
                    </label>
                    <Input
                      id="conversation-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      maxLength={120}
                      placeholder="مثلاً: پیگیری وضعیت ارسال"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="conversation-message" className="mb-1.5 block text-sm font-medium">
                    پیام شما
                  </label>
                  <Textarea
                    id="conversation-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="توضیح دهید چه کمکی نیاز دارید..."
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCreate(false)}>
                    انصراف
                  </Button>
                  <Button onClick={() => void handleCreate()} disabled={create.isPending}>
                    {create.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                    ایجاد گفتگو
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Status filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {statusFilters.map((f) => (
          <Button
            key={f.label}
            variant={statusFilter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-2 h-4 w-64" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">خطا در دریافت گفتگوها</p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquareText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">گفتگویی یافت نشد</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              {statusFilter
                ? "هیچ گفتگویی با این وضعیت ندارید"
                : "برای شروع گفتگو با پشتیبانی، از دکمه بالا استفاده کنید"}
            </p>
            {!statusFilter && (
              <Button onClick={() => setShowCreate(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                شروع گفتگو جدید
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {conversations.map((c) => (
            <ConversationListItem
              key={c._id}
              conversation={c}
              href={`/support/${c._id}`}
              isCustomerView
            />
          ))}
        </div>
      )}

      {!isLoading && conversations.length > 0 && totalPages > 1 && (
        <div className="mt-6">
          <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
