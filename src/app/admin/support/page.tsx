"use client";

import { useEffect, useState } from "react";
import {
  MessageSquareText,
  Search,
  AlertCircle,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import { useAdminConversations } from "@/hooks/use-admin-conversations";
import { ConversationListItem } from "@/components/support/conversation-list-item";
import type { ConversationStatus } from "@/types";

const statusTabs: Array<{ value: ConversationStatus | null; label: string }> = [
  { value: null, label: "همه" },
  { value: "open", label: "در انتظار پاسخ" },
  { value: "pending", label: "در انتظار مشتری" },
  { value: "resolved", label: "حل‌شده" },
  { value: "closed", label: "بسته" },
];

export default function AdminSupportPage() {
  const [status, setStatus] = useState<ConversationStatus | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  const {
    data: paged,
    isLoading,
    isError,
    refetch,
  } = useAdminConversations({
    status: status || undefined,
    search: search || undefined,
    page,
  });

  const conversations = paged?.data || [];
  const totalPages = paged?.totalPages || 1;

  useEffect(() => {
    setPage(1);
  }, [status, search]);

  const submitSearch = () => {
    setSearch(searchInput.trim());
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">مرکز پشتیبانی</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          گفتگوهای مرتبط با سفارش — پیگیری، پاسخ‌دهی و بستن
        </p>
      </div>

      {/* Search + status tabs */}
      <div className="mb-6 space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجو با شماره سفارش، نام یا تلفن مشتری، یا عنوان گفتگو..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSearch()}
              className="pr-9"
            />
          </div>
          <Button onClick={submitSearch}>جستجو</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {statusTabs.map((t) => (
            <Button
              key={t.label}
              variant={status === t.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-2 h-4 w-72" />
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
            <Inbox className="mb-4 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">گفتگویی یافت نشد</h3>
            <p className="text-sm text-muted-foreground">
              {status || search ? "با فیلترهای فعلی گفتگویی نیست" : "هنوز گفتگویی ثبت نشده است"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {conversations.map((c) => (
            <ConversationListItem
              key={c._id}
              conversation={c}
              href={`/admin/support/${c._id}`}
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
