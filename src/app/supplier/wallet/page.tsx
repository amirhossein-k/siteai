"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  TrendingUp,
  AlertCircle,
  RefreshCw,
  Wallet,
  CreditCard,
  Landmark,
  User,
  ArrowUpRight,
  ArrowDownLeft,
  History,
  Banknote,
  Clock,
  CheckCircle2,
  Send,
  MessageSquare,
  CheckCircle,
  XCircle,
  Bot,
  Store,
} from "lucide-react";
import {
  useSupplierWallet,
  useRequestPayout,
} from "@/hooks/use-supplier-wallet";
import {
  useSupplierSettings,
  useUpdateTelegramChatId,
  useTestTelegram,
  useUpdatePublicProfile,
} from "@/hooks/use-supplier-settings";
import { formatPrice } from "@/lib/utils";
import { showToast } from "@/components/ui/toast";
import type { TransactionType } from "@/types";

const transactionTypeConfig: Record<
  TransactionType,
  {
    label: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
  }
> = {
  payout: {
    label: "تسویه",
    icon: ArrowUpRight,
    color: "text-red-600",
    bgColor: "bg-red-50 dark:bg-red-950",
  },
  adjustment: {
    label: "اصلاحیه",
    icon: Banknote,
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950",
  },
  order_credit: {
    label: "اعتبار سفارش",
    icon: ArrowDownLeft,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 dark:bg-emerald-950",
  },
};

export default function SupplierWalletPage() {
  const {
    data: wallet,
    isLoading,
    isError,
    refetch,
  } = useSupplierWallet();

  const requestPayout = useRequestPayout();
  const { data: settings, isLoading: settingsLoading } = useSupplierSettings();
  const updateTelegramId = useUpdateTelegramChatId();
  const testTelegram = useTestTelegram();

  const [showPayoutForm, setShowPayoutForm] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payoutNote, setPayoutNote] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramInputOpen, setTelegramInputOpen] = useState(false);
  const [profileLogo, setProfileLogo] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profileDirty, setProfileDirty] = useState(false);
  const updateProfile = useUpdatePublicProfile();

  // Sync profile fields once settings arrive (Session 42).
  useEffect(() => {
    if (!settingsLoading && settings) {
      setProfileLogo(settings.logo || "");
      setProfileDescription(settings.description || "");
    }
  }, [settingsLoading, settings]);

  const handlePayout = async () => {
    if (payoutAmount <= 0) {
      showToast.error("مبلغ باید بیشتر از صفر باشد");
      return;
    }
    if (wallet && payoutAmount > (wallet.availableBalance ?? wallet.balance)) {
      showToast.error("موجودی قابل برداشت کافی نیست");
      return;
    }

    try {
      await requestPayout.mutateAsync({
        amount: payoutAmount,
        note: payoutNote,
      });
      showToast.success("درخواست تسویه با موفقیت ثبت شد");
      setShowPayoutForm(false);
      setPayoutAmount(0);
      setPayoutNote("");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response: { data: { error: string } } }).response?.data
              ?.error || "خطا در ثبت درخواست"
          : "خطا در ثبت درخواست";
      showToast.error(message);
    }
  };

  // Format transactions for display
  const transactions = useMemo(() => {
    if (!wallet?.recentTransactions) return [];
    return wallet.recentTransactions;
  }, [wallet]);

  // --- Error State ---
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">کیف پول</h1>
          <p className="text-sm text-muted-foreground">
            مدیریت موجودی و تسویه حساب
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
            <p className="mb-4 text-muted-foreground">
              خطا در دریافت اطلاعات کیف پول
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="ml-2 h-4 w-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">کیف پول</h1>
        <p className="text-sm text-muted-foreground">
          مدیریت موجودی، تسویه حساب و تاریخچه تراکنش‌ها
        </p>
      </div>

      {/* Balance & Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Available Balance */}
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">موجودی قابل برداشت</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
                <Wallet className="h-4 w-4 text-emerald-600" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-40" />
            ) : (
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {wallet ? formatPrice(wallet.availableBalance ?? wallet.balance) : "—"}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              {wallet && (wallet.availableBalance ?? wallet.balance) > 0 && (
                <Button
                  size="sm"
                  className="mt-1 w-full gap-1 bg-emerald-600 hover:bg-emerald-700 text-xs"
                  onClick={() => setShowPayoutForm(true)}
                >
                  <Banknote className="h-3 w-3" />
                  درخواست تسویه
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pending Reserve */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">در انتظار تأیید</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-40" />
            ) : (
              <p className="mt-2 text-2xl font-bold text-amber-600">
                {wallet ? formatPrice(wallet.pendingReserve ?? 0) : "—"}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              مبلغ رزرو شده تا تأیید مدیر
            </p>
          </CardContent>
        </Card>

        {/* Total Earnings */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">درآمد کل</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-40" />
            ) : (
              <p className="mt-2 text-2xl font-bold">
                {wallet ? formatPrice(wallet.totalEarnings) : "—"}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              مجموع اعتبار از سفارشات تحویل شده
            </p>
          </CardContent>
        </Card>

        {/* Total Earnings */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">درآمد کل</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-40" />
            ) : (
              <p className="mt-2 text-2xl font-bold">
                {wallet ? formatPrice(wallet.totalEarnings) : "—"}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              مجموع اعتبار از سفارشات تحویل شده
            </p>
          </CardContent>
        </Card>

        {/* Total Paid Out */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">تسویه شده</p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                <CheckCircle2 className="h-4 w-4 text-blue-600" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-40" />
            ) : (
              <p className="mt-2 text-2xl font-bold">
                {wallet ? formatPrice(wallet.totalPaidOut) : "—"}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              مجموع مبالغ تسویه شده
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payout Form Modal */}
      {showPayoutForm && wallet && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader>
            <CardTitle className="text-lg">درخواست تسویه حساب</CardTitle>
            <CardDescription>
              موجودی قابل برداشت:{" "}
              {formatPrice(wallet.availableBalance ?? wallet.balance)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Bank Account Info */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="mb-2 text-sm font-medium">اطلاعات بانکی</p>
              <div className="space-y-1 text-sm text-muted-foreground">
                {wallet.bankAccount?.ownerName && (
                  <p>صاحب حساب: {wallet.bankAccount.ownerName}</p>
                )}
                {wallet.bankAccount?.cardNumber && (
                  <p dir="ltr">شماره کارت: {wallet.bankAccount.cardNumber}</p>
                )}
                {wallet.bankAccount?.iban && (
                  <p dir="ltr">شبا: {wallet.bankAccount.iban}</p>
                )}
                {!wallet.bankAccount?.iban &&
                  !wallet.bankAccount?.cardNumber && (
                    <p className="text-amber-600">
                      اطلاعات بانکی ثبت نشده است. لطفاً با پشتیبانی تماس بگیرید.
                    </p>
                  )}
              </div>
            </div>

            {/* Amount Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">مبلغ تسویه (تومان)</label>
              <div className="relative">
                <input
                  type="number"
                  min={1000}
                  max={wallet.availableBalance ?? wallet.balance}
                  value={payoutAmount || ""}
                  onChange={(e) =>
                    setPayoutAmount(Number(e.target.value) || 0)
                  }
                  placeholder="مثال: ۵۰۰۰۰۰"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
              {/* Quick amount buttons */}
              <div className="flex gap-2 flex-wrap">
                {[100000, 500000, 1000000, 2000000, 5000000].map(
                  (amount) => (
                    <Button
                      key={amount}
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => setPayoutAmount(amount)}
                      disabled={amount > (wallet.availableBalance ?? wallet.balance)}
                    >
                      {formatPrice(amount)}
                    </Button>
                  )
                )}
                {(wallet.availableBalance ?? wallet.balance) > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() =>
                      setPayoutAmount(wallet.availableBalance ?? wallet.balance)
                    }
                  >
                    کل موجودی
                  </Button>
                )}
              </div>
            </div>

            {/* Note */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                توضیحات (اختیاری)
              </label>
              <textarea
                value={payoutNote}
                onChange={(e) => setPayoutNote(e.target.value)}
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="توضیحات درخواست تسویه..."
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPayoutForm(false);
                  setPayoutAmount(0);
                  setPayoutNote("");
                }}
              >
                انصراف
              </Button>
              <Button
                onClick={handlePayout}
                disabled={
                  payoutAmount <= 0 ||
                  payoutAmount > (wallet.availableBalance ?? wallet.balance)
                }
                loading={requestPayout.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {requestPayout.isPending
                  ? "در حال ثبت..."
                  : "ثبت درخواست تسویه"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bank Account Card */}
      {wallet && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">اطلاعات بانکی</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <User className="h-4 w-4" />
                  <span className="text-xs">صاحب حساب</span>
                </div>
                <p className="font-medium">
                  {wallet.bankAccount?.ownerName || "—"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <CreditCard className="h-4 w-4" />
                  <span className="text-xs">شماره کارت</span>
                </div>
                <p className="font-medium font-mono text-sm" dir="ltr">
                  {wallet.bankAccount?.cardNumber
                    ? wallet.bankAccount.cardNumber.replace(
                        /(\d{4})(?=\d)/g,
                        "$1-"
                      )
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Landmark className="h-4 w-4" />
                  <span className="text-xs">شبا</span>
                </div>
                <p className="font-medium font-mono text-sm" dir="ltr">
                  {wallet.bankAccount?.iban || "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Telegram Bot Connection */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">اتصال ربات تلگرام</CardTitle>
          </div>
          {!settingsLoading && settings?.telegramChatId ? (
            <Badge
              variant="success"
              className="gap-1 text-xs"
            >
              <CheckCircle className="h-3 w-3" />
              متصل
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-xs">
              <XCircle className="h-3 w-3" />
              قطع
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            با اتصال ربات تلگرام، هنگام ثبت سفارش جدید بلافاصله از طریق تلگرام
            مطلع خواهید شد.
          </p>

          {settingsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : telegramInputOpen ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  آیدی عددی چت تلگرام
                </label>
                <Input
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="مثال: 123456789"
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  برای دریافت آیدی عددی، به ربات{" "}
                  <span
                    dir="ltr"
                    className="font-mono text-primary"
                  >
                    @userinfobot
                  </span>{" "}
                  یک پیام بدهید.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={async () => {
                    if (!telegramChatId.trim()) {
                      showToast.error("لطفاً آیدی چت را وارد کنید");
                      return;
                    }
                    try {
                      await updateTelegramId.mutateAsync(
                        telegramChatId.trim()
                      );
                      showToast.success(
                        "ربات تلگرام با موفقیت متصل شد"
                      );
                      setTelegramInputOpen(false);
                    } catch {
                      showToast.error("خطا در ذخیره تنظیمات");
                    }
                  }}
                  loading={updateTelegramId.isPending}
                >
                  <Send className="h-4 w-4" />
                  ذخیره
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTelegramInputOpen(false);
                    setTelegramChatId(
                      settings?.telegramChatId || ""
                    );
                  }}
                >
                  انصراف
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {settings?.telegramChatId
                      ? `آیدی چت: ${settings.telegramChatId}`
                      : "هنوز متصل نشده است"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    setTelegramChatId(
                      settings?.telegramChatId || ""
                    );
                    setTelegramInputOpen(true);
                  }}
                >
                  <Send className="h-3 w-3" />
                  {settings?.telegramChatId
                    ? "ویرایش"
                    : "اتصال"}
                </Button>
              </div>

              {/* Test message button — only when connected */}
              {settings?.telegramChatId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-xs"
                  onClick={async () => {
                    try {
                      await testTelegram.mutateAsync();
                      showToast.success(
                        "✅ پیام تست با موفقیت ارسال شد. تلگرام خود را بررسی کنید."
                      );
                    } catch (err: unknown) {
                      const message =
                        err && typeof err === "object" && "response" in err
                          ? (err as { response: { data: { error: string } } })
                              .response?.data?.error ||
                            "خطا در ارسال پیام تست"
                          : "خطا در ارسال پیام تست";
                      showToast.error(message);
                    }
                  }}
                  loading={testTelegram.isPending}
                >
                  <Send className="h-3 w-3" />
                  {testTelegram.isPending
                    ? "در حال ارسال..."
                    : "ارسال پیام تست"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Store Public Profile (Session 42) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">پروفایل عمومی فروشگاه</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            قابل مشاهده برای مشتریان
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            این اطلاعات در صفحه عمومی فروشگاه شما ({" "}
            <span dir="ltr" className="font-mono text-xs">
              /suppliers/[id]
            </span>{" "}
            ) و کنار محصولات‌تان نمایش داده می‌شود. آدرس لوگو را وارد کنید یا
            توضیح کوتاهی درباره کسب‌وکار بنویسید.
          </p>

          {settingsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">آدرس لوگو</label>
                <Input
                  dir="ltr"
                  value={profileLogo}
                  onChange={(e) => {
                    setProfileLogo(e.target.value);
                    setProfileDirty(true);
                  }}
                  placeholder="https://.../logo.png"
                />
                <p className="text-xs text-muted-foreground">
                  در صورت خالی بودن، به‌جای آن آیکن فروشگاه نمایش داده می‌شود.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">توضیحات فروشگاه</label>
                <textarea
                  value={profileDescription}
                  onChange={(e) => {
                    setProfileDescription(e.target.value);
                    setProfileDirty(true);
                  }}
                  rows={3}
                  maxLength={500}
                  placeholder="درباره محصولات و کسب‌وکار خود بنویسید..."
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <p className="text-left text-xs text-muted-foreground">
                  {profileDescription.length}/۵۰۰
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={!profileDirty}
                  loading={updateProfile.isPending}
                  onClick={async () => {
                    try {
                      await updateProfile.mutateAsync({
                        logo: profileLogo,
                        description: profileDescription,
                      });
                      showToast.success("پروفایل فروشگاه بروزرسانی شد");
                      setProfileDirty(false);
                    } catch {
                      showToast.error("خطا در ذخیره پروفایل");
                    }
                  }}
                >
                  <CheckCircle className="h-4 w-4" />
                  ذخیره پروفایل
                </Button>
                {profileDirty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setProfileLogo(settings?.logo || "");
                      setProfileDescription(settings?.description || "");
                      setProfileDirty(false);
                    }}
                  >
                    انصراف
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">تاریخچه تراکنش‌ها</CardTitle>
          </div>
          <Badge variant="secondary">
            {isLoading
              ? "..."
              : `${transactions.length} تراکنش`}
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <History className="mx-auto mb-3 h-8 w-8" />
              <p>هیچ تراکنشی یافت نشد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => {
                const config =
                  transactionTypeConfig[tx.type as TransactionType];
                const Icon = config?.icon || DollarSign;
                const isPositive =
                  tx.type !== "payout" && (tx.amount || 0) >= 0;

                // Payout approval status badge (payout requests only)
                const payoutStatusBadge =
                  tx.type === "payout" && tx.status
                    ? tx.status === "pending"
                      ? { label: "در انتظار تأیید", variant: "warning" as const }
                      : tx.status === "approved"
                      ? { label: "تأیید شده", variant: "success" as const }
                      : { label: "رد شده", variant: "destructive" as const }
                    : null;

                return (
                  <div
                    key={tx._id}
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          config?.bgColor || "bg-muted"
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 ${
                            config?.color || "text-muted-foreground"
                          }`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">
                            {config?.label || tx.type}
                          </p>
                          {payoutStatusBadge && (
                            <Badge
                              variant={payoutStatusBadge.variant}
                              className="text-[10px]"
                            >
                              {payoutStatusBadge.label}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {tx.createdAt
                              ? new Date(tx.createdAt).toLocaleDateString(
                                  "fa-IR",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
                              : "—"}
                          </span>
                          {tx.note && (
                            <>
                              <span className="text-xs text-muted-foreground">
                                •
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {tx.note}
                              </span>
                            </>
                          )}
                        </div>
                        {tx.status === "rejected" && tx.rejectionReason && (
                          <p className="mt-0.5 text-xs text-destructive">
                            دلیل رد: {tx.rejectionReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-left">
                      <p
                        className={`text-sm font-bold ${
                          isPositive ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {isPositive ? "+" : ""}
                        {formatPrice(Math.abs(tx.amount || 0))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        مانده: {formatPrice(tx.balanceAfter || 0)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
