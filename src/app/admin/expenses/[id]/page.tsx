"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  ReceiptText,
} from "lucide-react";
import {
  useExpenseDetail,
  useUpdateExpense,
  usePayExpense,
  useVoidExpense,
} from "@/hooks/use-admin-expenses";
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

const toNum = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

export default function AdminExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useExpenseDetail(id);

  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [voidError, setVoidError] = useState("");

  const updateExpense = useUpdateExpense(id);
  const payExpense = usePayExpense(id);
  const voidExpense = useVoidExpense(id);

  const expense = data?.expense;

  // Seed the edit form from the fetched expense (render-phase sync pattern).
  const [prevId, setPrevId] = useState<string | null>(null);
  if (expense && prevId !== expense._id) {
    setPrevId(expense._id);
    setForm({
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      expenseDate: expense.expenseDate
        ? expense.expenseDate.slice(0, 10)
        : "",
      paymentMethod: expense.paymentMethod ?? "",
      reference: expense.reference ?? "",
      payee: expense.payee ?? "",
      notes: expense.notes ?? "",
      status: expense.status,
    });
  }

  const saveEdit = async () => {
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
      await updateExpense.mutateAsync({
        category: form.category,
        description: form.description.trim(),
        amount,
        expenseDate: form.expenseDate || undefined,
        paymentMethod: form.paymentMethod || undefined,
        reference: form.reference.trim() || undefined,
        payee: form.payee.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      showToast.success("هزینه به‌روزرسانی شد");
      setEditMode(false);
      refetch();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
              ?.error
          : undefined;
      setFormError(message || "خطا در به‌روزرسانی هزینه");
    }
  };

  const markPaid = async () => {
    try {
      await payExpense.mutateAsync();
      showToast.success("هزینه به‌عنوان پرداخت‌شده ثبت شد");
      refetch();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
              ?.error
          : undefined;
      showToast.error(message || "خطا در ثبت پرداخت");
    }
  };

  const confirmVoid = async () => {
    setVoidError("");
    if (voidReason.trim().length < 2) {
      setVoidError("دلیل باطل‌سازی الزامی است (حداقل ۲ کاراکتر)");
      return;
    }
    try {
      await voidExpense.mutateAsync(voidReason.trim());
      showToast.success("هزینه باطل شد");
      setShowVoid(false);
      refetch();
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data
              ?.error
          : undefined;
      setVoidError(message || "خطا در باطل‌سازی");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !expense) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                هزینه یافت نشد یا خطا در بارگذاری
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              تلاش مجدد
            </Button>
            <Link href="/admin/expenses">
              <Button variant="ghost" size="sm">
                <ArrowRight className="ml-2 h-4 w-4" />
                بازگشت
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[expense.status] ?? {
    label: expense.status,
    variant: "secondary" as const,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight">
              {expense.description}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {expense.categoryLabel} ·{" "}
            {expense.expenseDate
              ? new Date(expense.expenseDate).toLocaleDateString("fa-IR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/expenses">
            <Button variant="ghost" size="sm">
              <ArrowRight className="ml-2 h-4 w-4" />
              بازگشت
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="ml-2 h-4 w-4" />
            به‌روزرسانی
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">جزئیات هزینه</CardTitle>
          <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
        </CardHeader>
        <CardContent>
          {expense.status === "void" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-red-700 dark:text-red-300">
                    این هزینه باطل شده است و در مجموع‌های مالی لحاظ نمی‌شود
                  </p>
                  <p className="text-red-600/80 dark:text-red-400/80">
                    دلیل: {expense.voidReason}
                  </p>
                  {expense.voidedAt && (
                    <p className="text-xs text-muted-foreground">
                      باطل شده در{" "}
                      {new Date(expense.voidedAt).toLocaleDateString("fa-IR")}
                      {expense.voidedByName ? ` توسط ${expense.voidedByName}` : ""}
                    </p>
                  )}
                </div>
              </div>
              <InfoRow label="مبلغ" value={formatPrice(expense.amount)} bold />
              <InfoRow label="دسته‌بندی" value={expense.categoryLabel} />
              <InfoRow label="روش پرداخت" value={expense.paymentMethodLabel || "—"} />
              <InfoRow label="دریافت‌کننده" value={expense.payee || "—"} />
              <InfoRow label="مرجع" value={expense.reference || "—"} />
              <InfoRow label="ثبت توسط" value={expense.createdByName || "—"} />
              {expense.notes && <InfoRow label="یادداشت" value={expense.notes} />}
            </div>
          ) : editMode ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    دسته‌بندی *
                  </label>
                  <select
                    value={form.category ?? ""}
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
                    value={form.amount ?? ""}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="text-left"
                    aria-label="مبلغ (تومان)"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    تاریخ
                  </label>
                  <Input
                    type="date"
                    value={form.expenseDate ?? ""}
                    onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    روش پرداخت
                  </label>
                  <select
                    value={form.paymentMethod ?? ""}
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
                    value={form.payee ?? ""}
                    onChange={(e) => setForm({ ...form, payee: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    مرجع
                  </label>
                  <Input
                    value={form.reference ?? ""}
                    onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  شرح *
                </label>                  <Input
                    value={form.description ?? ""}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    aria-label="شرح هزینه"
                  />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  یادداشت
                </label>
                <Textarea
                  value={form.notes ?? ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                />
              </div>
              {formError && (
                <p className="rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
                  {formError}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button onClick={saveEdit} disabled={updateExpense.isPending}>
                  {updateExpense.isPending ? (
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  ) : null}
                  ذخیره تغییرات
                </Button>
                <Button variant="ghost" onClick={() => setEditMode(false)}>
                  انصراف
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoRow label="مبلغ" value={formatPrice(expense.amount)} bold />
                <InfoRow label="دسته‌بندی" value={expense.categoryLabel} />
                <InfoRow label="روش پرداخت" value={expense.paymentMethodLabel || "—"} />
                <InfoRow label="دریافت‌کننده" value={expense.payee || "—"} />
                <InfoRow label="مرجع" value={expense.reference || "—"} />
                <InfoRow label="ثبت توسط" value={expense.createdByName || "—"} />
              </div>
              {expense.notes && <InfoRow label="یادداشت" value={expense.notes} />}

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
                  ویرایش
                </Button>
                {expense.status === "pending" && (
                  <Button size="sm" onClick={markPaid} disabled={payExpense.isPending}>
                    {payExpense.isPending ? (
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="ml-2 h-4 w-4" />
                    )}
                    ثبت به‌عنوان پرداخت‌شده
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowVoid(true)}
                >
                  <XCircle className="ml-2 h-4 w-4" />
                  باطل‌سازی
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showVoid && (
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" />
              باطل‌سازی هزینه
            </CardTitle>
            <CardDescription>
              باطل‌سازی قابل بازگشت نیست؛ هزینه ثبت می‌ماند اما در مجموع‌های مالی
              لحاظ نمی‌شود.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                دلیل باطل‌سازی *
              </label>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="مثلاً: ثبت اشتباه — فاکتور شماره X"
                rows={2}
                aria-label="دلیل باطل‌سازی"
              />
            </div>
            {voidError && (
              <p className="rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
                {voidError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={confirmVoid}
                disabled={voidExpense.isPending}
              >
                {voidExpense.isPending ? (
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                ) : null}
                تأیید باطل‌سازی
              </Button>
              <Button variant="ghost" onClick={() => setShowVoid(false)}>
                انصراف
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={bold ? "text-sm font-semibold" : "text-sm"}>{value}</span>
    </div>
  );
}
