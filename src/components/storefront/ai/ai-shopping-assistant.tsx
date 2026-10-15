"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Sparkles,
  X,
  Send,
  ShoppingBag,
  Flame,
  Percent,
  Wallet,
  Clock,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { cn, isAllowedImageSrc } from "@/lib/utils";

interface RecommendedProduct {
  _id: string;
  name: string;
  slug: string;
  image: string;
  price: number;
  effectivePrice: number;
  discountPercent: number;
  stock: number;
  categoryName: string;
  brandName: string;
  reason: string;
}

interface RelatedRoute {
  label: string;
  href: string;
}

interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  products?: RecommendedProduct[];
  relatedRoutes?: RelatedRoute[];
}

const QUICK_PROMPTS = [
  {
    label: "پرفروش‌ترین‌ها",
    query: "پرفروش‌ترین محصولات فروشگاه کدامند؟",
    intent: "best_sellers" as const,
    icon: Flame,
  },
  {
    label: "بیشترین تخفیف",
    query: "محصولات دارای بیشترین تخفیف را پیشنهاد بده",
    intent: "discounted" as const,
    icon: Percent,
  },
  {
    label: "گزینه‌های اقتصادی",
    query: "محصولات خوش‌قیمت و اقتصادی پیشنهاد بده",
    intent: "budget" as const,
    icon: Wallet,
  },
  {
    label: "جدیدترین کالاها",
    query: "جدیدترین محصولات اضافه شده به فروشگاه",
    intent: "newest" as const,
    icon: Clock,
  },
  {
    label: "مقایسه هوشمند",
    query: "این محصولات را از نظر ارزش خرید مقایسه کن",
    intent: "compare" as const,
    icon: Sparkles,
  },
];

function AssistantRichText({ text }: { text: string }) {
  const lines = text.replace(/\\n/g, "\n").split("\n");
  return (
    <div className="space-y-2 text-right">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1" />;
        const match = trimmed.match(/^(?:\d+[.)]|[-•])\s*(.*)$/);
        const content = match ? match[1] : trimmed;
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((part, partIndex) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={partIndex} className="font-extrabold text-sf-strong">
              {part.slice(2, -2)}
            </strong>
          ) : (
            <span key={partIndex}>{part}</span>
          )
        );
        if (match) {
          return (
            <div key={index} className="flex items-start gap-2 rounded-xl bg-sf-bg/40 px-2.5 py-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-[11px] font-bold text-indigo-300">
                {trimmed.match(/^\d+/)?.[0] || "•"}
              </span>
              <span className="leading-6">{rendered}</span>
            </div>
          );
        }
        return <p key={index} className="leading-6">{rendered}</p>;
      })}
    </div>
  );
}

export function AiShoppingAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [budget, setBudget] = useState<number | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "bot",
      text: "سلام! من دستیار هوشمند خرید مارلو شاپ هستم ✨ دنبال چه محصولی می‌گردید یا چه بودجه‌ای در نظر دارید تا بهترین گزینه‌ها را با مقایسه قیمت به شما پیشنهاد دهم؟",
    },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Monotonic id source. `Date.now()` is impure and the React compiler lint
  // rejects calling it while rendering (it could not prove `askAssistant` is
  // only ever invoked from an event); a ref counter is stable and unique.
  const messageIdRef = useRef(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  const askAssistant = async (
    queryText: string,
    intent: "best_sellers" | "discounted" | "budget" | "newest" | "search" | "compare" = "search"
  ) => {
    const trimmed = queryText.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${++messageIdRef.current}`,
      sender: "user",
      text: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          intent,
          maxPrice: budget,
          history: messages.slice(-4).map((m) => ({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.text,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            sender: "bot",
            text: data.error || "مشکلی پیش آمد. لطفاً دوباره امتحان کنید.",
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: data.reply,
          products: data.recommendations || [],
          relatedRoutes: data.relatedRoutes || [],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: "ارتباط با سرور برقرار نشد. لطفاً اتصال اینترنت خود را بررسی کنید.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="دستیار هوشمند خرید مارلو"
        className={cn(
          /* Readability pass — sf-label (15px) keeps the trigger on the shared
             storefront reading scale instead of text-sm (14px). */
          "fixed bottom-5 left-5 z-50 flex items-center gap-2.5 rounded-full px-4 py-3 sf-label font-semibold text-white shadow-2xl transition-all duration-300",
          "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 hover:scale-105 hover:shadow-indigo-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        )}
      >
        <Sparkles className="h-5 w-5 animate-pulse" />
        <span className="hidden sm:inline">مشاور هوشمند خرید</span>
      </button>

      {/* Assistant Modal / Drawer */}
      {open && (
        <div
          role="dialog"
          aria-label="پنل دستیار هوشمند خرید"
          className="glass-strong fixed bottom-20 left-4 right-4 z-50 flex max-h-[80vh] flex-col overflow-hidden rounded-3xl border border-sf-line shadow-2xl sm:left-5 sm:right-auto sm:w-[400px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-sf-line bg-gradient-to-l from-indigo-600/20 via-violet-600/15 to-transparent px-4 py-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-sf-strong">
                  دستیار هوشمند مارلو شاپ
                </h3>
                <p className="text-xs text-sf-dim">
                  پیشنهاد و مقایسه هوشمند کالاها
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="بستن دستیار هوشمند"
              className="sf-icon-btn flex h-8 w-8 items-center justify-center rounded-full"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Budget chips: makes intent explicit without forcing users to type numbers. */}
          <div className="flex items-center gap-2 border-b border-sf-line px-3 py-2 overflow-x-auto no-scrollbar">
            <span className="shrink-0 text-[11px] text-sf-dim">بودجه:</span>
            {[500000, 2000000, 5000000].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setBudget(budget === value ? undefined : value)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition ${budget === value ? "border-indigo-400 bg-indigo-500/20 text-indigo-300" : "border-sf-line bg-sf-chip text-sf-dim hover:text-sf-strong"}`}
              >
                تا {value.toLocaleString("fa-IR")} تومان
              </button>
            ))}
          </div>

          {/* Quick Action Chips */}
          <div className="flex gap-2 overflow-x-auto border-b border-sf-line px-3 py-2.5 no-scrollbar">
            {QUICK_PROMPTS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.intent}
                  type="button"
                  disabled={loading}
                  onClick={() => askAssistant(item.query, item.intent)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-sf-line bg-sf-chip px-3 py-1.5 text-xs font-medium text-sf-strong transition hover:border-indigo-500/60 hover:bg-indigo-500/10 disabled:opacity-50"
                >
                  <Icon className="h-3.5 w-3.5 text-indigo-400" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Messages Container */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto p-4"
            style={{ maxHeight: "420px" }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-2",
                  msg.sender === "user" ? "items-start" : "items-end"
                )}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed sm:text-sm",
                    msg.sender === "user"
                      ? "bg-indigo-600 text-white rounded-br-none"
                      : "border border-sf-line bg-sf-chip text-sf-strong rounded-bl-none"
                  )}
                >
                  <AssistantRichText text={msg.text} />
                </div>

                {/* Contextual site navigation */}
                {msg.relatedRoutes && msg.relatedRoutes.length > 0 && (
                  <div className="flex w-full flex-wrap gap-2">
                    {msg.relatedRoutes.map((route) => (
                      <Link
                        key={route.href}
                        href={route.href}
                        onClick={() => setOpen(false)}
                        className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                      >
                        رفتن به {route.label} ←
                      </Link>
                    ))}
                  </div>
                )}

                {/* Product Recommendations */}
                {msg.products && msg.products.length > 0 && (
                  <div className="w-full space-y-2.5 pt-1">
                    {msg.products.map((prod) => {
                      const validImg = isAllowedImageSrc(prod.image);
                      return (
                        <Link
                          key={prod._id}
                          href={`/products/${encodeURIComponent(prod.slug)}`}
                          onClick={() => setOpen(false)}
                          className="group flex items-center gap-3 rounded-2xl border border-sf-line bg-sf-chip/70 p-2.5 transition hover:border-indigo-500/60 hover:bg-sf-chip"
                        >
                          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-sf-line bg-zinc-900">
                            {validImg ? (
                              <Image
                                src={prod.image}
                                alt={prod.name}
                                fill
                                sizes="56px"
                                className="object-cover transition group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sf-dim">
                                <ShoppingBag className="h-5 w-5" />
                              </div>
                            )}
                            {prod.discountPercent > 0 && (
                              <span className="absolute top-1 right-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                {prod.discountPercent}٪
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-xs font-bold text-sf-strong group-hover:text-indigo-400">
                              {prod.name}
                            </h4>
                            <p className="mt-0.5 truncate text-[11px] text-emerald-400">
                              {prod.reason}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-xs font-extrabold text-sf-strong">
                                {prod.effectivePrice.toLocaleString("fa-IR")}{" "}
                                تومان
                              </span>
                              {prod.discountPercent > 0 && (
                                <span className="text-[11px] text-sf-dim line-through">
                                  {prod.price.toLocaleString("fa-IR")}
                                </span>
                              )}
                            </div>
                          </div>

                          <ArrowLeft className="h-4 w-4 shrink-0 text-sf-dim transition group-hover:-translate-x-1 group-hover:text-indigo-400" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-sf-dim">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                <span>در حال بررسی کاتالوگ و انتخاب بهترین گزینه‌ها...</span>
              </div>
            )}
          </div>

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              askAssistant(input, "search");
            }}
            className="flex items-center gap-2 border-t border-sf-line p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="مثلاً: هدفون خوب تا ۲ میلیون، مقایسه کن..."
              className="h-10 flex-1 rounded-full border border-sf-line bg-sf-chip px-4 text-xs text-sf-strong outline-none placeholder:text-sf-dim focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              aria-label="ارسال پیام"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
