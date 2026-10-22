"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Search,
  AlertCircle,
  RefreshCw,
  MessageSquareText,
  Inbox,
  Plus,
  X,
  Loader2,
  Send,
  Trash2,
  Pencil,
  FileText,
} from "lucide-react";
import { showToast } from "@/components/ui/toast";
import {
  useAdminSmsTemplates,
  useCreateSmsTemplate,
  useUpdateSmsTemplate,
  useDeleteSmsTemplate,
  useAdminSmsLogs,
  useSendManualSms,
  useAdminSmsStatus,
} from "@/hooks/use-admin-sms";
import type {
  AdminSmsTemplate,
  SmsMessageType,
  AdminSmsProviderStatus,
  SmsIrTemplate,
  SmsIrTemplateStatus,
} from "@/types";
import { useAdminSmsProviderTemplates } from "@/hooks/use-admin-sms";

/**
 * Session 90 — Admin business-SMS management (پیامک‌ها).
 *
 * Three tabs, mirroring the /admin/suppliers tab pattern:
 *   - قالب‌ها: template CRUD (variables are SERVER-derived from the body —
 *     the UI only edits name/type/body/providerTemplateId/isActive).
 *   - گزارش ارسال: the SmsLog audit trail with status/type filters + search.
 *   - ارسال دستی: template-based (rendered server-side, fail-closed variable
 *     validation) or free-form send through the business-SMS service.
 */

const TYPE_LABELS: Record<SmsMessageType, string> = {
  order_confirmation: "تأیید سفارش",
  shipping_update: "ارسال سفارش",
  tracking_code: "کد رهگیری",
  delivery_followup: "پیگیری تحویل",
  custom: "سفارشی",
};

const STATUS_LABELS: Record<string, string> = {
  sent: "ارسال شده",
  failed: "ناموفق",
};

/** Provider template review status → Persian label. */
const PROVIDER_TEMPLATE_STATUS_LABELS: Record<SmsIrTemplateStatus, string> = {
  pending: "در حال بررسی",
  approved: "تایید شده",
  rejected: "رد شده",
  not_found: "یافت نشد",
  unknown: "نامشخص",
  not_submitted: "ثبت نشده",
};

const PROVIDER_TEMPLATE_STATUS_BADGE: Record<SmsIrTemplateStatus, string> = {
  pending: "secondary",
  approved: "success",
  rejected: "destructive",
  not_found: "destructive",
  unknown: "secondary",
  not_submitted: "secondary",
};

// ============================================================
// Provider monitoring (Phase 1 — read-only SMS.ir probe)
// ============================================================

/** Stable provider error taxonomy → Persian operator explanation. */
const PROVIDER_ERROR_KINDS_FA: Record<string, string> = {
  auth_failed: "خطای احراز هویت (کلید API نامعتبر یا غیرفعال)",
  rate_limited: "محدودیت تعداد درخواست‌های سرویس‌دهنده",
  provider_server_error: "خطای داخلی سرویس‌دهنده",
  provider_logical_error: "خطای منطقی سرویس‌دهنده",
  insufficient_credit: "موجودی حساب SMS.ir کافی نیست",
  invalid_line: "شماره خط ارسال نامعتبر است",
  invalid_recipient: "شماره گیرنده نامعتبر است",
  recipient_blocked: "شماره گیرنده در لیست سیاه سرویس‌دهنده است",
  template_not_found: "قالب در سرویس‌دهنده یافت نشد",
  template_param_invalid: "پارامتر قالب نامعتبر است (مقدار بلند یا نام خالی)",
  template_rejected: "متن قالب توسط سرویس‌دهنده تأیید نشده است",
  plan_restricted: "نیازمند ارتقای پلن SMS.ir",
  line_needs_activation: "خط ارسال نیاز به فعال‌سازی دارد",
  network_timeout: "انقضای زمان اتصال به سرویس‌دهنده",
  network_error: "خطای شبکه در ارتباط با سرویس‌دهنده",
  not_configured: "کلید API سرویس‌دهنده تنظیم نشده است",
  malformed_response: "پاسخ نامعتبر از سرویس‌دهنده",
};

function providerErrorFa(kind: string, messageFa: string): string {
  return PROVIDER_ERROR_KINDS_FA[kind] || messageFa || "خطای ناشناخته سرویس‌دهنده";
}

function providerProbeBadge(state: AdminSmsProviderStatus["credit"]["probeState"]) {
  switch (state) {
    case "ok":
      return <Badge variant="success">تأیید شد</Badge>;
    case "configured_but_unreachable":
      return <Badge variant="destructive">در دسترس نیست</Badge>;
    case "failed":
      return <Badge variant="destructive">ناموفق</Badge>;
    default:
      return <Badge variant="secondary">در انتظار</Badge>;
  }
}

function formatFaDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fa-IR");
}

/**
 * پاسخ به ۱۰ سؤال اصلی مدیر: اتصال، خط، موجودی، وضعیت واقعی سرویس‌دهنده.
 * All values come from the actual provider probe — nothing is fabricated
 * (a never-synced credit is «در دسترس نیست», not a fake 0).
 */
function ProviderStatusCard() {
  const { data, isLoading, isError, refetch } = useAdminSmsStatus();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">وضعیت سرویس‌دهنده (SMS.ir)</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className="ml-2 h-3.5 w-3.5" />
            به‌روزرسانی وضعیت
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-destructive" />
            خطا در دریافت وضعیت سرویس‌دهنده
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              تلاش مجدد
            </Button>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : data ? (
          <div className="space-y-3 text-sm">
            {/* اتصال و احراز هویت */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-muted-foreground">اتصال سرویس‌دهنده</span>
              {data.ok ? (
                <Badge variant="success">متصل</Badge>
              ) : data.config.apiKeyConfigured ? (
                <Badge variant="destructive">ناموفق</Badge>
              ) : (
                <Badge variant="destructive">نیازمند تنظیمات</Badge>
              )}
              {!data.ok &&
                (data.credit.probeMessageFa || data.lines.probeMessageFa
                  ? (data.credit.probeMessageFa || data.lines.probeMessageFa)
                  : providerErrorFa(data.lastError?.kind || "", data.lastError?.messageFa || ""))}
            </div>

            {/* کلید API — status only, never the secret */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-muted-foreground">کلید API</span>
              {data.config.apiKeyConfigured ? (
                <Badge variant="success">تنظیم شده</Badge>
              ) : (
                <Badge variant="destructive">تنظیم نشده</Badge>
              )}
              <span className="text-xs text-muted-foreground">(مقدار واقعی هرگز نمایش داده نمی‌شود)</span>
            </div>

            {/* موجودی */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-muted-foreground">موجودی حساب</span>
              {data.credit.value !== null ? (
                <>
                  <span dir="ltr" className="font-medium">{data.credit.value.toLocaleString("fa-IR")}</span>
                  <span className="text-xs text-muted-foreground">
                    آخرین همگام‌سازی: {formatFaDate(data.credit.lastSyncAt)}
                  </span>
                </>
              ) : (
                <>
                  {providerProbeBadge(data.credit.probeState)}
                  <span className="text-xs text-muted-foreground">موجودی از حساب فعلی در دسترس نیست</span>
                </>
              )}
            </div>

            {/* خط سرویس‌دهنده */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-muted-foreground">خط سرویس‌دهنده</span>
              {data.config.senderLine ? (
                <span dir="ltr" className="font-medium">{data.config.senderLine}</span>
              ) : (
                <Badge variant="secondary">تنظیم نشده</Badge>
              )}
              {data.lines.providerLines.length > 0 && (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  تأییدشده: {data.lines.providerLines.join(", ")}
                </span>
              )}
              {data.senderMismatch.detected && (
                <Badge variant="destructive">ناهنگی خط</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                آخرین بررسی خط: {formatFaDate(data.lines.lastSyncAt)}
              </span>
            </div>

            {/* آخرین خطا */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-muted-foreground">آخرین خطای سرویس‌دهنده</span>
              {data.lastError ? (
                <>
                  <Badge variant="destructive">{providerErrorFa(data.lastError.kind, data.lastError.messageFa)}</Badge>
                  <span className="text-xs text-muted-foreground">{formatFaDate(data.lastError.at)}</span>
                </>
              ) : (
                <Badge variant="success">بدون خطای ثبت‌شده</Badge>
              )}
            </div>

            {/* قابلیت‌ها — truthful capability flags */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-muted-foreground">قابلیت‌ها</span>
              {data.capabilities.otpVerify.configured ? (
                <Badge variant="success">کد تأیید (OTP): فعال</Badge>
              ) : (
                <Badge variant="secondary">کد تأیید (OTP): نیازمند تنظیمات</Badge>
              )}
              <Badge variant="secondary">گزارش دلیوری: از طریق API (بدون وبهوک‌)</Badge>
              <Badge
                variant={data.capabilities.textBulk.available ? "success" : "secondary"}
                title={data.capabilities.textBulk.messageFa}
              >
                ارسال متن آزاد: غیرفعال تا تأیید خط
              </Badge>
            </div>

            <p className="text-[10px] text-muted-foreground">
              توجه: «ارسال شده» فقط به این معناست که درخواست توسط SMS.ir پذیرفته شده — «تحویل» وضعیتی جداگانه است.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AdminSmsPage() {
  const [tab, setTab] = useState<"templates" | "logs" | "send">("templates");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">پیامک‌ها</h1>
        <p className="text-sm text-muted-foreground">
          مدیریت پیامک‌های کسب‌وکار — قالب‌ها، گزارش ارسال و ارسال دستی
        </p>
      </div>

      {/* Tabs (same pattern as /admin/suppliers) */}
      <div className="flex gap-2 border-b">
        {(
          [
            { key: "templates", label: "قالب‌ها" },
            { key: "logs", label: "گزارش ارسال" },
            { key: "send", label: "ارسال دستی" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Phase 1 — provider monitoring (always visible above the tabs) */}
      <ProviderStatusCard />

      {tab === "templates" && <TemplatesPanel />}
      {tab === "logs" && <LogsPanel />}
      {tab === "send" && <SendPanel />}
    </div>
  );
}

// ============================================================
// Templates panel
// ============================================================

function TemplatesPanel() {
  const { data: templates, isLoading, isError, refetch } = useAdminSmsTemplates();
  const createTemplate = useCreateSmsTemplate();
  const updateTemplate = useUpdateSmsTemplate();
  const deleteTemplate = useDeleteSmsTemplate();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AdminSmsTemplate | null>(null);

  async function handleToggle(t: AdminSmsTemplate) {
    try {
      await updateTemplate.mutateAsync({ id: t._id, name: t.name, type: t.type, body: t.body, isActive: !t.isActive });
      showToast.success(t.isActive ? "قالب غیرفعال شد" : "قالب فعال شد");
    } catch {
      showToast.error("خطا در تغییر وضعیت قالب");
    }
  }

  async function handleDelete(t: AdminSmsTemplate) {
    try {
      await deleteTemplate.mutateAsync(t._id);
      showToast.success("قالب حذف شد");
    } catch {
      showToast.error("خطا در حذف قالب");
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          قالب جدید
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">قالب‌های پیامک</CardTitle>
          <Badge variant="secondary">
            {isLoading ? "..." : `${(templates || []).length} قالب`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
              <p className="mb-4 text-muted-foreground">خطا در دریافت قالب‌ها</p>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="ml-2 h-4 w-4" />
                تلاش مجدد
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (templates || []).length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Inbox className="mx-auto mb-3 h-8 w-8" />
              <p>قالبی تعریف نشده است</p>
            </div>
          ) : (
            <div className="divide-y rounded-xl border">
              {(templates || []).map((t) => (
                <div key={t._id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t.name}</p>
                      <Badge variant="secondary">{TYPE_LABELS[t.type]}</Badge>
                      {t.isActive ? (
                        <Badge variant="success">فعال</Badge>
                      ) : (
                        <Badge variant="destructive">غیرفعال</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 max-w-xl truncate text-xs text-muted-foreground">
                      {t.body || "—"}
                    </p>
                    {t.variables.length > 0 && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        متغیرها: {t.variables.join("، ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="ویرایش"
                      onClick={() => {
                        setEditing(t);
                        setShowForm(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={() => handleToggle(t)}
                      disabled={updateTemplate.isPending}
                    >
                      {t.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      title="حذف"
                      onClick={() => handleDelete(t)}
                      disabled={deleteTemplate.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showForm && (
        <TemplateFormModal
          template={editing}
          onClose={() => setShowForm(false)}
          onSubmit={async (data) => {
            try {
              if (editing) {
                await updateTemplate.mutateAsync({ id: editing._id, ...data });
                showToast.success("قالب ویرایش شد");
              } else {
                await createTemplate.mutateAsync(data);
                showToast.success("قالب ایجاد شد");
              }
              setShowForm(false);
            } catch (err: unknown) {
              const message =
                err && typeof err === "object" && "response" in err
                  ? (err as { response?: { data?: { error?: string } } }).response?.data?.error ||
                    "خطا در ذخیره قالب"
                  : "خطا در ذخیره قالب";
              showToast.error(message);
            }
          }}
          isSubmitting={createTemplate.isPending || updateTemplate.isPending}
        />
      )}
    </>
  );
}

// ============================================================
// Template form modal
// ============================================================

interface TemplateFormProps {
  template: AdminSmsTemplate | null;
  onClose: () => void;
  onSubmit: (data: { name: string; type: string; providerTemplateId?: string; body: string }) => Promise<void>;
  isSubmitting: boolean;
}

function TemplateFormModal({ template, onClose, onSubmit, isSubmitting }: TemplateFormProps) {
  const [name, setName] = useState(template?.name || "");
  const [type, setType] = useState<string>(template?.type || "custom");
  const [providerTemplateId, setProviderTemplateId] = useState(template?.providerTemplateId || "");
  const [body, setBody] = useState(template?.body || "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">
              {template ? "ویرایش قالب" : "قالب جدید"}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="sms-template-name" className="mb-1 block text-sm font-medium">
              نام قالب
            </label>
            <Input
              id="sms-template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً تأیید سفارش"
            />
          </div>
          <div>
            <label htmlFor="sms-template-type" className="mb-1 block text-sm font-medium">
              نوع
            </label>
            <select
              id="sms-template-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sms-template-body" className="mb-1 block text-sm font-medium">
              متن قالب (متغیرها با {"{{نام}}"})
            </label>
            <textarea
              id="sms-template-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="سفارش {{orderNo}} ثبت شد"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              متغیرها به‌صورت خودکار از متن شناسایی می‌شوند.
            </p>
          </div>
          <div>
            <label htmlFor="sms-template-provider-id" className="mb-1 block text-sm font-medium">
              شناسه قالب سرویس‌دهنده (اختیاری — sms.ir)
            </label>
            <Input
              id="sms-template-provider-id"
              value={providerTemplateId}
              onChange={(e) => setProviderTemplateId(e.target.value)}
              placeholder="مثلاً 123456"
              dir="ltr"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            انصراف
          </Button>
          <Button onClick={() => onSubmit({ name, type, providerTemplateId, body })} disabled={isSubmitting || !name.trim() || !body.trim()}>
            {isSubmitting && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            ذخیره
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Logs panel
// ============================================================

function LogsPanel() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [messageType, setMessageType] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading, isError, refetch } = useAdminSmsLogs({
    page,
    status: status || undefined,
    messageType: messageType || undefined,
    q: q || undefined,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">گزارش ارسال پیامک</CardTitle>
        <Badge variant="secondary">{isLoading ? "..." : `${data?.total ?? 0} ردیف`}</Badge>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="جستجوی شماره گیرنده..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="pr-9"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">همه وضعیت‌ها</option>
            <option value="sent">ارسال شده</option>
            <option value="failed">ناموفق</option>
          </select>
          <select
            value={messageType}
            onChange={(e) => {
              setMessageType(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">همه انواع</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {isError ? (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <Button variant="outline" onClick={() => refetch()}>
              تلاش مجدد
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (data?.data || []).length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Inbox className="mx-auto mb-3 h-8 w-8" />
            <p>ردیفی یافت نشد</p>
          </div>
        ) : (
          <div className="divide-y rounded-xl border">
            {(data?.data || []).map((l) => (
              <div key={l._id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span dir="ltr">{l.recipient}</span>
                    <Badge variant={l.status === "sent" ? "success" : "destructive"}>
                      {STATUS_LABELS[l.status]}
                    </Badge>
                    <Badge variant="secondary">{TYPE_LABELS[l.messageType]}</Badge>
                  </div>
                  <p className="mt-0.5 max-w-xl truncate text-xs text-muted-foreground">
                    {l.templateName ? `${l.templateName}: ` : ""}
                    {l.message}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {l.createdBy ? `${l.createdBy.name} — ` : ""}
                    {new Date(l.createdAt).toLocaleString("fa-IR")}
                    {l.error ? ` — ${l.error}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {(data?.totalPages ?? 1) > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={!data?.hasPreviousPage} onClick={() => setPage((p) => p - 1)}>
              قبلی
            </Button>
            <span className="text-xs text-muted-foreground">
              صفحه {page} از {data?.totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={!data?.hasNextPage} onClick={() => setPage((p) => p + 1)}>
              بعدی
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Manual send panel
// ============================================================

function SendPanel() {
  const send = useSendManualSms();
  const { data: templates } = useAdminSmsTemplates();
  const activeTemplates = useMemo(
    () => (templates || []).filter((t) => t.isActive && t.body),
    [templates]
  );

  const [mode, setMode] = useState<"template" | "free">("template");
  const [phone, setPhone] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const selectedTemplate = activeTemplates.find((t) => t._id === templateId);

  async function handleSend() {
    try {
      if (mode === "template") {
        const vars: Record<string, string> = {};
        for (const v of selectedTemplate?.variables || []) {
          vars[v] = variableValues[v] ?? "";
        }
        await send.mutateAsync({ phone, templateId, variables: vars });
      } else {
        await send.mutateAsync({ phone, message });
      }
      showToast.success("پیامک با موفقیت ارسال شد");
      setPhone("");
      setMessage("");
      setVariableValues({});
    } catch (err: unknown) {
      const apiMessage =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      showToast.error(apiMessage || "ارسال پیامک ناموفق بود");
    }
  }

  const canSend =
    /^09\d{9}$/.test(phone.trim()) &&
    (mode === "free"
      ? message.trim().length > 0
      : Boolean(templateId) &&
        (selectedTemplate?.variables || []).every(
          (v) => (variableValues[v] ?? "").trim() !== ""
        ));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">ارسال دستی پیامک</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={mode === "template" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("template")}
          >
            با قالب
          </Button>
          <Button
            variant={mode === "free" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("free")}
          >
            متن آزاد
          </Button>
        </div>

        <div>
          <label htmlFor="sms-send-phone" className="mb-1 block text-sm font-medium">
            شماره گیرنده
          </label>
          <Input
            id="sms-send-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09123456789"
            dir="ltr"
            className="max-w-xs"
          />
        </div>

        {mode === "template" ? (
          <>
            <div>
              <label htmlFor="sms-send-template" className="mb-1 block text-sm font-medium">
                قالب
              </label>
              <select
                id="sms-send-template"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setVariableValues({});
                }}
                className="w-full max-w-xs rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="">انتخاب قالب...</option>
                {activeTemplates.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedTemplate && selectedTemplate.variables.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium">متغیرهای قالب</label>
                {selectedTemplate.variables.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-xs text-muted-foreground" dir="ltr">
                      {v}
                    </span>
                    <Input
                      value={variableValues[v] ?? ""}
                      onChange={(e) =>
                        setVariableValues((prev) => ({ ...prev, [v]: e.target.value }))
                      }
                      className="max-w-xs"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div>
            <label htmlFor="sms-send-message" className="mb-1 block text-sm font-medium">
              متن پیام
            </label>
            <textarea
              id="sms-send-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex items-center gap-3 border-t pt-4">
          <Button onClick={handleSend} disabled={!canSend || send.isPending} className="gap-2">
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            ارسال پیامک
          </Button>
          <p className="text-xs text-muted-foreground">
            <MessageSquareText className="ml-1 inline h-3 w-3" />
            هر ارسال در «گزارش ارسال» ثبت می‌شود. حداکثر ۱۰ پیامک در ۱۵ دقیقه.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
