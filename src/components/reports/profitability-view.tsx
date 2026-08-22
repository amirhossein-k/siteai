"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Info,
  Package,
  ReceiptText,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type {
  ProfitabilityKpi,
  WaterfallStep,
  ProductProfitRow,
  CategoryProfitRow,
  ExpenseAnalysisRow,
  DiagnosticInsight,
  FinancialHealthIndicator,
  TrendBucket,
} from "@/lib/profitability";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function money(v: number | null): string {
  if (v === null) return "—";
  return formatPrice(v);
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(v)}٪`;
}

function ChangeIcon({ value }: { value: number | null }) {
  if (value === null) return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  if (value > 0) return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
  if (value < 0) return <TrendingDown className="h-3.5 w-3.5 text-red-600" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

const INSIGHT_ICONS: Record<string, typeof TrendingUp> = {
  positive: CheckCircle2,
  negative: AlertTriangle,
  warning: AlertTriangle,
  neutral: Info,
};

const INSIGHT_COLORS: Record<string, string> = {
  positive: "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950",
  negative: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
  warning: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
  neutral: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
};

const LOW_MARGIN_THRESHOLD = 10; // percent

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function WaterfallCard({ steps }: { steps: WaterfallStep[] }) {
  // Find max absolute value for scaling
  const maxAbs = Math.max(...steps.map((s) => Math.abs(s.amount)), 1);

  return (
    <div className="space-y-2">
      {steps.map((step) => {
        const widthPctVal = Math.max(
          2,
          Math.min(80, (Math.abs(step.amount) / maxAbs) * 70)
        );
        const isNeg = step.amount < 0;
        const isKey =
          step.key === "netSales" ||
          step.key === "grossProfit" ||
          step.key === "netProfit";

        return (
          <div key={step.key} className="flex items-center gap-3">
            <span
              className={`w-36 shrink-0 text-right text-sm ${isKey ? "font-semibold" : "text-muted-foreground"}`}
            >
              {step.label}
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div
                  className={`h-5 rounded-sm transition-all ${
                    isNeg
                      ? "bg-red-300 dark:bg-red-700"
                      : isKey && step.key === "netProfit" && step.amount < 0
                        ? "bg-red-400 dark:bg-red-600"
                        : "bg-emerald-300 dark:bg-emerald-700"
                  }`}
                  style={{ width: `${widthPctVal}%` }}
                />
                <span
                  className={`min-w-[100px] text-left text-sm font-medium ${
                    isNeg
                      ? "text-red-600 dark:text-red-400"
                      : step.key === "netProfit" && step.amount < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {isNeg ? "−" : ""}
                  {money(Math.abs(step.amount))}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProductTable({
  products,
  title,
}: {
  products: ProductProfitRow[];
  title: string;
}) {
  const [sortKey, setSortKey] =
    useState<keyof ProductProfitRow>("grossProfit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = [...products].sort((a, b) => {
    const av = Number(a[sortKey] ?? 0);
    const bv = Number(b[sortKey] ?? 0);
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const toggle = (key: keyof ProductProfitRow) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortHeader = (label: string, field: keyof ProductProfitRow) => (
    <th
      className="cursor-pointer select-none px-3 py-2 text-right text-xs font-medium text-muted-foreground hover:text-foreground"
      onClick={() => toggle(field)}
    >
      {label}{" "}
      {sortKey === field ? (sortDir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {sortHeader("محصول", "name")}
                {sortHeader("تعداد", "quantity")}
                {sortHeader("فروش خالص", "netSales")}
                {sortHeader("COGS", "cogs")}
                {sortHeader("سود ناخالص", "grossProfit")}
                {sortHeader("حاشیه سود", "grossMargin")}
                {sortHeader("سهم از سود", "profitShare")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr
                  key={p.productId}
                  className={`border-b last:border-0 ${
                    p.grossProfit < 0
                      ? "bg-red-50 dark:bg-red-950"
                      : p.grossMargin !== null && p.grossMargin < LOW_MARGIN_THRESHOLD
                        ? "bg-amber-50 dark:bg-amber-950"
                        : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    {p.sku && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {p.sku}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {new Intl.NumberFormat("fa-IR").format(p.quantity)}
                  </td>
                  <td className="px-3 py-2 text-right">{money(p.netSales)}</td>
                  <td className="px-3 py-2 text-right">{money(p.cogs)}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${
                      p.grossProfit < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {money(p.grossProfit)}
                  </td>
                  <td className="px-3 py-2 text-right">{pct(p.grossMargin)}</td>
                  <td className="px-3 py-2 text-right">{pct(p.profitShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryTable({
  categories,
}: {
  categories: CategoryProfitRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">سودآوری به تفکیک دسته‌بندی</CardTitle>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            اطلاعات کافی برای تحلیل سودآوری دسته‌بندی‌ها وجود ندارد.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    دسته‌بندی
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    تعداد فروش
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    فروش خالص
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    COGS
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    سود ناخالص
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    حاشیه سود
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr
                    key={c.categoryId}
                    className={`border-b last:border-0 ${
                      c.grossProfit < 0
                        ? "bg-red-50 dark:bg-red-950"
                        : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium">
                      {c.categoryName}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {new Intl.NumberFormat("fa-IR").format(c.quantity)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(c.netSales)}
                    </td>
                    <td className="px-3 py-2 text-right">{money(c.cogs)}</td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        c.grossProfit < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {money(c.grossProfit)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {pct(c.grossMargin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExpenseAnalysis({
  expenses,
}: {
  expenses: ExpenseAnalysisRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ReceiptText className="h-4 w-4" />
          تحلیل هزینه‌های عملیاتی
        </CardTitle>
      </CardHeader>
      <CardContent>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            در این بازه هزینه عملیاتی ثبت نشده است.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    دسته‌بندی
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    مبلغ
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    سهم از کل هزینه‌ها
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    سهم از سود ناخالص
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.category} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {e.categoryLabel}
                    </td>
                    <td className="px-3 py-2 text-right">{money(e.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      {pct(e.pctOfTotalExpenses)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {pct(e.pctOfGrossProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Diagnostics({
  insights,
}: {
  insights: DiagnosticInsight[];
}) {
  if (insights.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          تحلیل وضعیت سودآوری
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((ins) => {
          const Icon = INSIGHT_ICONS[ins.type] ?? Info;
          return (
            <div
              key={ins.key}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${INSIGHT_COLORS[ins.type] ?? ""}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{ins.text}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function HealthIndicators({
  indicators,
}: {
  indicators: FinancialHealthIndicator[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          شاخص‌های سلامت مالی
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {indicators.map((ind) => (
            <div
              key={ind.key}
              className="rounded-lg border p-3 text-center"
            >
              <p className="text-xs text-muted-foreground">{ind.label}</p>
              <p className="mt-1 text-lg font-bold">{pct(ind.value)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendChart({ trend }: { trend: TrendBucket[] }) {
  if (trend.length === 0) return null;

  const maxVal = Math.max(
    ...trend.map((t) => Math.max(t.netSales, t.cogs, Math.abs(t.netProfit))),
    1
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">روند فروش و سود</CardTitle>
        <CardDescription>
          مقایسه فروش خالص، COGS، سود ناخالص و سود خالص در طول زمان
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {/* Legend */}
          <div className="mb-3 flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded bg-emerald-500" /> فروش خالص
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded bg-amber-500" /> COGS
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded bg-blue-500" /> سود ناخالص
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded bg-violet-500" /> سود خالص
            </span>
          </div>

          {trend.map((t) => (
            <div key={t.label} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-left text-xs text-muted-foreground">
                {t.label}
              </span>
              <div className="flex flex-1 gap-1">
                {/* Stacked bars */}
                <div
                  className="h-4 rounded-sm bg-emerald-400 dark:bg-emerald-600"
                  style={{
                    width: `${(Math.abs(t.netSales) / maxVal) * 50}%`,
                  }}
                  title={`فروش خالص: ${money(t.netSales)}`}
                />
                <div
                  className="h-4 rounded-sm bg-amber-400 dark:bg-amber-600"
                  style={{
                    width: `${(Math.abs(t.cogs) / maxVal) * 50}%`,
                  }}
                  title={`COGS: ${money(t.cogs)}`}
                />
                <div
                  className={`h-4 rounded-sm ${
                    t.grossProfit >= 0
                      ? "bg-blue-400 dark:bg-blue-600"
                      : "bg-red-400 dark:bg-red-600"
                  }`}
                  style={{
                    width: `${(Math.abs(t.grossProfit) / maxVal) * 50}%`,
                  }}
                  title={`سود ناخالص: ${money(t.grossProfit)}`}
                />
                <div
                  className={`h-4 rounded-sm ${
                    t.netProfit >= 0
                      ? "bg-violet-400 dark:bg-violet-600"
                      : "bg-red-500 dark:bg-red-500"
                  }`}
                  style={{
                    width: `${(Math.abs(t.netProfit) / maxVal) * 50}%`,
                  }}
                  title={`سود خالص: ${money(t.netProfit)}`}
                />
              </div>
              <span className="w-24 shrink-0 text-left text-xs font-medium">
                {money(t.netSales)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface ProfitabilityViewProps {
  kpis: ProfitabilityKpi[];
  waterfall: WaterfallStep[];
  products: ProductProfitRow[];
  categories: CategoryProfitRow[];
  expenses: ExpenseAnalysisRow[];
  diagnostics: DiagnosticInsight[];
  health: FinancialHealthIndicator[];
  trend: TrendBucket[];
}

export function ProfitabilityView({
  kpis,
  waterfall,
  products,
  categories,
  expenses,
  diagnostics,
  health,
  trend,
}: ProfitabilityViewProps) {
  const [activeTab, setActiveTab] = useState<
    "products" | "categories" | "ranking"
  >("products");

  const lossProducts = products.filter((p) => p.grossProfit < 0);
  const lowMarginProducts = products.filter(
    (p) =>
      p.netSales > 0 &&
      p.grossMargin !== null &&
      p.grossMargin < LOW_MARGIN_THRESHOLD &&
      p.grossProfit >= 0
  );
  const highMarginProducts = [...products]
    .filter((p) => p.grossMargin !== null)
    .sort((a, b) => (b.grossMargin ?? 0) - (a.grossMargin ?? 0))
    .slice(0, 10);
  const topProfitProducts = [...products]
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Section 1: Executive Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">خلاصه مدیریتی سودآوری</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {kpis.map((kpi) => {
              const isProfit =
                kpi.key === "grossProfit" || kpi.key === "netProfit";
              const isLoss =
                isProfit && kpi.value !== null && kpi.value < 0;
              return (
                <div
                  key={kpi.key}
                  className={`rounded-lg border p-3 ${
                    isLoss
                      ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                      : ""
                  }`}
                >
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p
                    className={`mt-1 text-lg font-bold ${
                      isLoss
                        ? "text-red-600 dark:text-red-400"
                        : isProfit
                          ? "text-emerald-600 dark:text-emerald-400"
                          : ""
                    }`}
                  >
                    {kpi.format === "money"
                      ? money(kpi.value)
                      : pct(kpi.value)}
                  </p>
                  <ChangeIcon value={kpi.changePercent} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Waterfall */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">آبشار سودآوری</CardTitle>
          <CardDescription>
            مسیر تبدیل فروش ناخالص به سود خالص
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WaterfallCard steps={waterfall} />
        </CardContent>
      </Card>

      {/* Section 3: Trend */}
      <TrendChart trend={trend} />

      {/* Section 8: Diagnostics */}
      <Diagnostics insights={diagnostics} />

      {/* Section 9: Financial Health */}
      <HealthIndicators indicators={health} />

      {/* Section 7: Expense Analysis */}
      <ExpenseAnalysis expenses={expenses} />

      {/* Section 4 & 5: Product/Category/Ranking tabs */}
      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={activeTab === "products" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("products")}
        >
          <Package className="ml-1 h-4 w-4" />
          سودآوری محصولات
        </Button>
        <Button
          variant={activeTab === "categories" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("categories")}
        >
          سودآوری دسته‌بندی‌ها
        </Button>
        <Button
          variant={activeTab === "ranking" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("ranking")}
        >
          رتبه‌بندی
        </Button>
      </div>

      {activeTab === "products" && (
        <>
          {products.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                اطلاعات کافی برای تحلیل سودآوری محصولات وجود ندارد.
              </CardContent>
            </Card>
          ) : (
            <ProductTable
              products={products}
              title="سودآوری هر محصول"
            />
          )}
        </>
      )}

      {activeTab === "categories" && (
        <CategoryTable categories={categories} />
      )}

      {activeTab === "ranking" && (
        <div className="space-y-6">
          {/* Most profitable */}
          <ProductTable
            products={topProfitProducts}
            title="پرسودترین محصولات"
          />

          {/* Highest margin */}
          <ProductTable
            products={highMarginProducts}
            title="بیشترین حاشیه سود"
          />

          {/* Low margin */}
          {lowMarginProducts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  محصولات با حاشیه سود پایین (زیر {LOW_MARGIN_THRESHOLD}٪)
                </CardTitle>
                <CardDescription>
                  این محصولات فروش دارند اما سود کمی ایجاد می‌کنند.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          محصول
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          فروش خالص
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          سود ناخالص
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          حاشیه سود
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowMarginProducts.map((p) => (
                        <tr key={p.productId} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{p.name}</td>
                          <td className="px-3 py-2 text-right">
                            {money(p.netSales)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money(p.grossProfit)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {pct(p.grossMargin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Loss-making */}
          {lossProducts.length > 0 && (
            <Card className="border-red-200 dark:border-red-800">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-4 w-4" />
                  محصولات زیان‌ده ({lossProducts.length} مورد)
                </CardTitle>
                <CardDescription>
                  این محصولات در بازه انتخاب‌شده حاشیه سود منفی داشته‌اند.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          محصول
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          فروش خالص
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          COGS
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          سود ناخالص
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          حاشیه سود
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lossProducts.map((p) => (
                        <tr
                          key={p.productId}
                          className="border-b bg-red-50 dark:bg-red-950"
                        >
                          <td className="px-3 py-2 font-medium">{p.name}</td>
                          <td className="px-3 py-2 text-right">
                            {money(p.netSales)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {money(p.cogs)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-red-600 dark:text-red-400">
                            {money(p.grossProfit)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {pct(p.grossMargin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
