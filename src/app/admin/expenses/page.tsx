"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PaginationControls } from "@/components/ui/pagination";
import {
  Plus,
  RefreshCw,
  AlertCircle,
  Loader2,
  ReceiptText,
  XCircle,
} from "lucide-react";
import { useAdminExpenses, useCreateExpense } from "@/hooks/use-admin-expenses";
import { showToast } from "@/components/ui/toast";
import { formatPrice } from "@/lib/utils";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  paid: { label: "پرداخت شده", variant: "success" },
  pending: { label: "در انتظار پرداخت", variant: "warning" },
  void: { label: "باطل شده", variant: "destructive" },
};

const CATEGORIES = [
  { value: "shipping", label: "حمل‌ونقل" },
  { value: "packaging", label: "بسته‌بندی" },
  { value: "advertising", label: "تبلیغات" },
  { value: "gateway_fees", label: "کارمزد درگاه پرداخت" },
  { value: "rent", label: "اجاره" },
  { value: "utilities", label: "قبوض (آب/برق/گاز)" },
  { value: "salaries", label: "حقوق و دستمزد" },
  { value: "software", label: "نرم‌افزار و سرویس‌ها" },
  { value: "maintenance", label: "تعمیر و نگهداری" },
  { value: "other", label: "سایر" },
];

const PAYMENT_METHODS = [
  { value: "cash", label: "نقدی" },
  { value: "bank", label: "حواله بانکی" },
  { value: "card", label: "کارت" },
  { value: "online", label: "پرداخت آنلاین" },
  { value: "other", label: "سایر" },
];

const PAGE_SIZE = 20;

const toNum = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

export default function AdminExpensesPage() {
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [form, setForm] = useState({
    category: "other",
    description: "",
    amount: "",
    expenseDate: "",
    paymentMethod: "",
    reference: "",
    payee: "",
    notes: "",
    status: "pending",
  });
  const [formError, setFormError] = useState("");
  const createExpense = useCreateExpense();

  const params = useMemo(() => {
    const p: Record<string, string> = { limit: String(PAGE_SIZE) };
    if (status) p.status = status;
    if (category) p.category = category;
    if (appliedQ) p.q = appliedQ;
    if (page > 1) p.page = String(page);
    return p;
  }, [status, category, appliedQ, page]);

  const { data, isLoading, isError, refetch } = useAdminExpenses(params);

  const filterTabs: { key: string; label: string }[] = [
    { key: "", label: "همه" },
    { key: "paid", label: "پرداخت شده" },
    { key: "pending", label: "در انتظار پرداخت" },
    { key: "void", label: "باطل شده" },
  ];

  const submitCreate = async () => {
    setFormError("");
    if (form.description.trim().length < 2) {
      setFormError("شرح هزینه الزامی است (حداقل ۲ کاراکتر)");
      return;
    }
    const amount = toNum(form.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setFormError("مبلغ باید عدد صحیح مثبت (تومان) باشد");
      return;
    }
    try {
      await createExpense.mutateAsync({
        category: form.category,
        description: form.description.trim(),
        amount,
        expenseDate: form.expenseDate || undefined,
        paymentMethod: form.paymentMethod || undefined,
        reference: form.reference.trim() || undefined,
        payee: form.payee.trim() || undefined,
        notes: form.notes.trim() || undefined,
        status: form.status,
      });
      showToast.success("هزینه ثبت شد");
      setShowCreate(false);
      setForm({
        category: "other",
        description: "",
        amount: "",
        expenseDate: "",
        paymentMethod: "",
        reference: "",
        payee: "",
        notes: "",
        status: "pending",
      });
      setPage(1);
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
              ?.error
          : undefined;
      setFormError(message || "خطا در ثبت هزینه");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">هزینه‌ها</h1>
          <p className="text-sm text-muted-foreground">
            دفتر هزینه‌های عملیاتی — باطل‌سازی با ثبت دلیل انجام می‌شود و هرگز
            حذف نمی‌شود
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="ml-2 h-4 w-4" />
            به‌روزرسانی
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="ml-2 h-4 w-4" />
            ثبت هزینه جدید
          </Button>
        </div>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="h-4 w-4" />
              ثبت هزینه جدید
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  دسته‌بندی *
                </label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="h-9 w-full rounded-lg border bg-card px-2 text-sm"
                  aria-label="دسته‌بندی هزینه"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  مبلغ (تومان) *
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="مثلاً 2500000"
                  className="text-left"
                  aria-label="مبلغ (تومان)"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  تاریخ (پیش‌فرض: امروز)
                </label>
                <Input
                  type="date"
                  value={form.expenseDate}
                  onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                  aria-label="تاریخ هزینه"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  وضعیت
                </label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-lg border bg-card px-2 text-sm"
                >
                  <option value="pending">در انتظار پرداخت</option>
                  <option value="paid">پرداخت شده</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  روش پرداخت
                </label>
                <select
                  value={form.paymentMethod}
                  onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                  className="h-9 w-full rounded-lg border bg-card px-2 text-sm"
                >
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  دریافت‌کننده
                </label>
                <Input
                  value={form.payee}
                  onChange={(e) => setForm({ ...form, payee: e.target.value })}
                  placeholder="نام طرف مقابل"
                  aria-label="دریافت‌کننده"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  مرجع
                </label>
                <Input
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="شماره سند / فاکتور"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                شرح *
              </label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="شرح هزینه (مثلاً: کارمزد درگاه پرداخت — خرداد)"
                aria-label="شرح هزینه"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                یادداشت
              </label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="یادداشت اختیاری"
                rows={2}
              />
            </div>
            {formError && (
              <p className="rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
                {formError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                onClick={submitCreate}
                disabled={createExpense.isPending}
              >
                {createExpense.isPending ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="ml-2 h-4 w-4" />
                )}
                ثبت هزینه
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                انصراف
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">لیست هزینه‌ها</CardTitle>
          <span className="text-xs text-muted-foreground">
            {data ? `${data.total.toLocaleString("fa-IR")} هزینه` : ""}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setStatus(tab.key);
                  setPage(1);
                }}
                className={
                  status === tab.key
                    ? "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    : "rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                {tab.label}
              </button>
            ))}
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border bg-card px-2 text-sm"
              aria-label="دسته‌بندی"
            >
              <option value="">همه دسته‌ها</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setAppliedQ(q.trim());
                    setPage(1);
                  }
                }}
                placeholder="جستجوی شرح / دریافت‌کننده / مرجع..."
                className="w-52"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAppliedQ(q.trim());
                  setPage(1);
                }}
              >
                اعمال
              </Button>
            </div>
          </div>

          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                  خطا در بارگذاری هزینه‌ها
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                تلاش مجدد
              </Button>
            </div>
          )}

          {!isLoading && !isError && data && data.expenses.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              هزینه‌ای ثبت نشده است
            </p>
          )}

          {!isLoading && !isError && data && data.expenses.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-2.5 text-right text-xs font-medium">تاریخ</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium">دسته‌بندی</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium">شرح</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium">مبلغ</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium">روش پرداخت</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium">دریافت‌کننده</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium">وضعیت</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.map((e) => {
                    const statusCfg = STATUS_CONFIG[e.status] ?? {
                      label: e.status,
                      variant: "secondary" as const,
                    };
                    return (
                      <tr key={e._id} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          {e.expenseDate
                            ? new Date(e.expenseDate).toLocaleDateString("fa-IR", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              })
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5">{e.categoryLabel}</td>
                        <td className="px-4 py-2.5">{e.description}</td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {formatPrice(e.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {e.paymentMethodLabel || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {e.payee || "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/expenses/${e._id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            جزئیات
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <PaginationControls
              page={page}
              totalPages={data.totalPages}
              onPageChange={(p) => {
                setPage(p);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}

          {data && data.expenses.some((e) => e.status === "void") && (
            <p className="flex items-center gap-1.5 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
              <XCircle className="h-3.5 w-3.5" />
              هزینه‌های باطل‌شده در مجموع‌های مالی (گزارش‌ها و سود و زیان) لحاظ
              نمی‌شوند.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
