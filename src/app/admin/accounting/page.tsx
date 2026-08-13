"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  Layers,
  RefreshCw,
} from "lucide-react";
import {
  useAccountingConfig,
  useInitializeAccounting,
  useOpeningCandidates,
  useSetCutoverDate,
} from "@/hooks/use-admin-accounting";
import { formatPrice } from "@/lib/utils";
import type { OpeningBalanceCandidate } from "@/types";

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AccountingPage() {
  const { data: config, isLoading: configLoading } = useAccountingConfig();
  const { data: candidatesData, isLoading: candidatesLoading } =
    useOpeningCandidates();
  const setCutover = useSetCutoverDate();
  const initAccounting = useInitializeAccounting();

  const [cutoverInput, setCutoverInput] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({}); // key → openingCost
  const [dates, setDates] = useState<Record<string, string>>({}); // key → openingDate
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const candidates = useMemo(
    () => candidatesData?.candidates ?? [],
    [candidatesData]
  );

  const keyOf = (c: OpeningBalanceCandidate) =>
    c.variantId ? `${c.productId}:${c.variantId}` : c.productId;

  const canInitialize =
    config?.inventoryInitialized !== true &&
    candidates.length > 0 &&
    confirm &&
    Object.keys(selected).length > 0;

  const runInitialize = async () => {
    const items = candidates
      .filter((c) => selected[keyOf(c)] !== undefined)
      .map((c) => ({
        productId: c.productId,
        variantId: c.variantId,
        openingCost: selected[keyOf(c)],
        openingDate: dates[keyOf(c)] || undefined,
      }));
    const res = await initAccounting.mutateAsync({
      cutoverDate: config?.cutoverDate ?? (cutoverInput || undefined),
      confirmValuation: true,
      items,
    });
    setResult(
      `شروع موجودی انجام شد: ${res.productsInitialized} محصول، ${res.layersCreated} لایه هزینه، ارزش کل ${formatPrice(
        res.totalValue
      )} تومان.` +
        (res.skipped.length
          ? ` (${res.skipped.length} مورد نادیده گرفته شد)`
          : "")
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">حسابداری</h1>
        <p className="text-sm text-muted-foreground">
          تاریخ شروع حسابداری (Cutover) و شروع موجودی اولیه بر اساس لایه‌های هزینه FIFO
        </p>
      </div>

      {/* ---- Config / cutover date ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            پیکربندی حسابداری
          </CardTitle>
          <CardDescription>
            نقطه شروع حسابداری: سفارش‌های پیش از این تاریخ از اسنپ‌شات هزینه قبلی و
            سفارش‌های پس از آن از لایه‌های FIFO محاسبه می‌شوند. روش ارزش‌گذاری: FIFO.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {configLoading || !config ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="cutoverDate">تاریخ شروع حسابداری</Label>
                  <Input
                    id="cutoverDate"
                    type="date"
                    value={
                      config.cutoverDate
                        ? toLocalInputValue(config.cutoverDate)
                        : cutoverInput
                    }
                    disabled={config.inventoryInitialized}
                    onChange={(e) => setCutoverInput(e.target.value)}
                  />
                </div>
                <div>
                  <Label>روش ارزش‌گذاری</Label>
                  <div className="flex h-10 items-center rounded-md border px-3 text-sm">
                    FIFO (لایه‌ای)
                  </div>
                </div>
                <div>
                  <Label>وضعیت</Label>
                  <div className="flex h-10 items-center gap-2 text-sm">
                    {config.inventoryInitialized ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                        موجودی اولیه ثبت شده است
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                        ثبت نشده است
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {!config.inventoryInitialized && (
                <Button
                  onClick={async () => {
                    const date = cutoverInput || config.cutoverDate;
                    if (!date) return;
                    await setCutover.mutateAsync(date);
                  }}
                  disabled={!cutoverInput && !config.cutoverDate}
                >
                  ذخیره تاریخ شروع
                </Button>
              )}
              {config.inventoryInitialized && config.initializedAt && (
                <p className="text-xs text-muted-foreground">
                  ثبت شده در {new Date(config.initializedAt).toLocaleString("fa-IR")}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Opening balance wizard ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            شروع موجودی اولیه (لایه‌های افتتاحیه)
          </CardTitle>
          <CardDescription>
            محصولات امانیِ دارای موجودی را به حالت «خریداری‌شده» تبدیل کنید. قیمت پیشنهادی
            فقط یک راهنما است — هزینه تأییدشده را خودتان وارد کنید. موجودی بدون تأیید هرگز
            ارزش‌گذاری نمی‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {candidatesLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              محصول امانیِ قابل تبدیلی وجود ندارد (یا همه قبلاً به حالت خریداری‌شده تبدیل شده‌اند).
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right text-muted-foreground">
                      <th className="p-2 font-normal">انتخاب</th>
                      <th className="p-2 font-normal">محصول</th>
                      <th className="p-2 font-normal">موجودی</th>
                      <th className="p-2 font-normal">هزینه پیشنهادی (supplierPrice)</th>
                      <th className="p-2 font-normal">هزینه تأییدشده</th>
                      <th className="p-2 font-normal">تاریخ شروع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const k = keyOf(c);
                      const checked = selected[k] !== undefined;
                      return (
                        <tr key={k} className="border-b">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              aria-label={`انتخاب ${c.name}`}
                              checked={checked}
                              onChange={(e) => {
                                const next = { ...selected };
                                if (e.target.checked) {
                                  next[k] = c.stock > 0 ? c.suggestedCost : 0;
                                } else {
                                  delete next[k];
                                }
                                setSelected(next);
                              }}
                            />
                          </td>
                          <td className="p-2">
                            {c.name}
                            {c.variantLabel ? (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                — {c.variantLabel}
                              </span>
                            ) : null}
                          </td>
                          <td className="p-2">{c.stock}</td>
                          <td className="p-2 text-muted-foreground">
                            {c.stock > 0 ? formatPrice(c.suggestedCost) : "—"}
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min={0}
                              className="w-32"
                              value={checked ? selected[k] ?? "" : ""}
                              disabled={!checked}
                              placeholder={c.stock > 0 ? "الزامی" : "—"}
                              onChange={(e) =>
                                setSelected((s) => ({
                                  ...s,
                                  [k]: e.target.value === "" ? 0 : Number(e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="date"
                              className="w-40"
                              value={dates[k] ?? ""}
                              disabled={!checked}
                              onChange={(e) =>
                                setDates((d) => ({ ...d, [k]: e.target.value }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                تأیید می‌کنم ارزش‌گذاری افتتاحیه با هزینه‌های واردشده صحیح است
              </label>

              <div className="flex items-center gap-3">
                <Button
                  onClick={runInitialize}
                  disabled={!canInitialize || initAccounting.isPending}
                >
                  {initAccounting.isPending
                    ? "در حال ثبت…"
                    : "ثبت موجودی اولیه"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void initAccounting.reset()}
                >
                  <RefreshCw className="ml-1 h-4 w-4" />
                  تازه‌سازی
                </Button>
              </div>

              {result && (
                <p className="text-sm text-emerald-600">{result}</p>
              )}
              {initAccounting.isError && (
                <p className="text-sm text-red-600">
                  خطا در ثبت موجودی اولیه. لطفاً ورودی‌ها را بررسی کنید.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
