/**
 * Minimal Telegram Bot API helpers for Edge Functions.
 */

export interface TelegramApiResult {
  ok: boolean
  description?: string
  result?: unknown
}

export async function telegramApi(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramApiResult> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let payload: TelegramApiResult
  try {
    payload = (await res.json()) as TelegramApiResult
  } catch {
    return { ok: false, description: `telegram HTTP ${res.status}` }
  }
  if (!res.ok && payload.ok !== false) {
    return { ok: false, description: payload.description ?? `HTTP ${res.status}` }
  }
  return payload
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  replyMarkup?: unknown,
): Promise<TelegramApiResult> {
  return telegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
}

export async function editTelegramMessage(
  botToken: string,
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: unknown,
): Promise<TelegramApiResult> {
  return telegramApi(botToken, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    ...(replyMarkup !== undefined ? { reply_markup: replyMarkup } : {}),
  })
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<TelegramApiResult> {
  return telegramApi(botToken, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: showAlert,
  })
}
