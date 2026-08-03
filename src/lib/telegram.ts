/**
 * Telegram Bot Notification Service
 *
 * Sends messages to suppliers via Telegram Bot API.
 * The bot token is read from TELEGRAM_BOT_TOKEN env var.
 * If the token is not set, all operations silently no-op.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

/**
 * Format a Persian number for display
 */
function toPersianDigits(num: number): string {
  return new Intl.NumberFormat("fa-IR").format(num);
}

/**
 * Send a plain text message to a Telegram chat
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<boolean> {
  const token = getBotToken();
  if (!token) {
    console.warn(
      "[Telegram] TELEGRAM_BOT_TOKEN not set — skipping message"
    );
    return false;
  }

  try {
    const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(
        `[Telegram] Failed to send message to ${chatId}:`,
        errBody
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Telegram] Error sending message:", error);
    return false;
  }
}

/**
 * Send a new-order notification to a supplier.
 *
 * @param chatId - The supplier's Telegram chat ID
 * @param orderId - The MongoDB Order ID (short display version)
 * @param customerName - Name of the customer who placed the order
 * @param itemsSummary - Human-readable items summary e.g. "۲ × محصول تست"
 * @param totalAmount - Total amount owed to the supplier
 * @param shippingAddress - Brief shipping address
 */
export async function sendNewOrderNotification(
  chatId: string,
  orderId: string,
  customerName: string,
  itemsSummary: string,
  totalAmount: number,
  shippingAddress: string
): Promise<boolean> {
  const message = [
    "<b>🆕 سفارش جدید!</b>",
    "",
    `📦 <b>شماره سفارش:</b> #${orderId.slice(-8)}`,
    `👤 <b>مشتری:</b> ${customerName}`,
    "",
    `<b>محصولات:</b>`,
    itemsSummary,
    "",
    `💰 <b>مبلغ:</b> ${toPersianDigits(totalAmount)} تومان`,
    `📍 <b>آدرس تحویل:</b> ${shippingAddress}`,
    "",
    `🔗 برای مشاهده جزئیات وارد پنل فروشندگی شوید.`,
  ].join("\n");

  return sendTelegramMessage(chatId, message);
}

/**
 * Get admin Telegram chat ID from environment variable
 */
function getAdminChatId(): string | null {
  return process.env.ADMIN_TELEGRAM_CHAT_ID || null;
}

/**
 * Send a new-order notification to the admin.
 */
export async function sendAdminNewOrderNotification(
  orderId: string,
  customerName: string,
  itemsCount: number,
  totalAmount: number,
  shippingAddress: string
): Promise<boolean> {
  const chatId = getAdminChatId();
  if (!chatId) return false;

  const message = [
    "<b>🆕 سفارش جدید در فروشگاه!</b>",
    "",
    `📦 <b>شماره سفارش:</b> #${orderId.slice(-8)}`,
    `👤 <b>مشتری:</b> ${customerName}`,
    `📊 <b>تعداد اقلام:</b> ${itemsCount}`,
    `💰 <b>مبلغ کل:</b> ${toPersianDigits(totalAmount)} تومان`,
    `📍 <b>آدرس تحویل:</b> ${shippingAddress}`,
    "",
    `🔗 برای مشاهده جزئیات وارد پنل مدیریت شوید.`,
  ].join("\n");

  return sendTelegramMessage(chatId, message);
}

/**
 * Send an order status update notification to the admin.
 */
export async function sendAdminOrderStatusNotification(
  orderId: string,
  newStatus: string,
  actor: string,
  note?: string
): Promise<boolean> {
  const chatId = getAdminChatId();
  if (!chatId) return false;

  const statusLabels: Record<string, string> = {
    pending_payment: "در انتظار پرداخت",
    processing: "در حال پردازش",
    confirmed: "✅ تأیید شد",
    shipped: "📦 ارسال شد",
    delivered: "✓ تحویل شد",
    cancelled: "❌ لغو شد",
  };

  const statusLabel = statusLabels[newStatus] || newStatus;

  const message = [
    `<b>📋 بروزرسانی وضعیت سفارش</b>`,
    "",
    `📦 <b>شماره سفارش:</b> #${orderId.slice(-8)}`,
    `📌 <b>وضعیت جدید:</b> ${statusLabel}`,
    `👤 <b>توسط:</b> ${actor}`,
    ...(note ? [`📝 <b>یادداشت:</b> ${note}`] : []),
  ].join("\n");

  return sendTelegramMessage(chatId, message);
}

/**
 * Send an order status update notification to a supplier.
 */
export async function sendOrderStatusNotification(
  chatId: string,
  orderId: string,
  newStatus: string,
  note?: string
): Promise<boolean> {
  const statusLabels: Record<string, string> = {
    confirmed: "✅ تأیید شد",
    shipped: "📦 ارسال شد",
    delivered: "✓ تحویل شد",
    rejected: "❌ رد شد",
  };

  const statusLabel = statusLabels[newStatus] || newStatus;

  const message = [
    `<b>📋 بروزرسانی وضعیت سفارش</b>`,
    "",
    `📦 <b>شماره سفارش:</b> #${orderId.slice(-8)}`,
    `📌 <b>وضعیت جدید:</b> ${statusLabel}`,
    ...(note ? [`📝 <b>یادداشت:</b> ${note}`] : []),
  ].join("\n");

  return sendTelegramMessage(chatId, message);
}

/**
 * Send a payout status notification to a supplier (Session 45).
 *
 * @param chatId - The supplier's Telegram chat ID
 * @param amount - The payout amount in toman
 * @param status - "approved" | "rejected"
 * @param reason - Rejection reason (required for rejected, ignored for approved)
 */
export async function sendPayoutStatusNotification(
  chatId: string,
  amount: number,
  status: "approved" | "rejected",
  reason?: string
): Promise<boolean> {
  const header =
    status === "approved"
      ? "<b>✅ درخواست تسویه تأیید شد</b>"
      : "<b>❌ درخواست تسویه رد شد</b>";

  const message = [
    header,
    "",
    `💰 <b>مبلغ:</b> ${toPersianDigits(amount)} تومان`,
    ...(status === "rejected" && reason
      ? [`📝 <b>دلیل:</b> ${reason}`]
      : []),
    "",
    `🔗 برای مشاهده جزئیات وارد پنل فروشندگی شوید.`,
  ].join("\n");

  return sendTelegramMessage(chatId, message);
}

/**
 * Send a new-review notification to a supplier (Session 45).
 *
 * @param chatId - The supplier's Telegram chat ID
 * @param productName - The reviewed product name
 * @param rating - The star rating 1-5
 */
export async function sendNewReviewNotification(
  chatId: string,
  productName: string,
  rating: number
): Promise<boolean> {
  const message = [
    "<b>⭐ دیدگاه جدید برای محصول شما</b>",
    "",
    `📦 <b>محصول:</b> ${productName}`,
    `⭐ <b>امتیاز:</b> ${toPersianDigits(rating)} از ۵`,
    "",
    `🔗 برای پاسخ‌گویی وارد پنل فروشندگی شوید.`,
  ].join("\n");

  return sendTelegramMessage(chatId, message);
}
