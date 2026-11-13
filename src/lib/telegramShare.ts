/**
 * Share a jam deep link via Telegram share sheet, Web Share API, or clipboard.
 */

export interface ShareJamOptions {
  url: string
  text: string
}

function buildTelegramShareUrl(url: string, text: string): string {
  const params = new URLSearchParams({ url, text })
  return `https://t.me/share/url?${params.toString()}`
}

function isTelegramWebApp(
  win: Window,
): win is Window & {
  Telegram: { WebApp: NonNullable<NonNullable<Window['Telegram']>['WebApp']> }
} {
  return Boolean(win.Telegram?.WebApp)
}

/**
 * Prefer Telegram.WebApp.openTelegramLink share sheet inside Mini App;
 * else navigator.share; else open t.me/share/url.
 */
export async function shareJamLink(
  options: ShareJamOptions,
  win: Window = window,
): Promise<'telegram' | 'native' | 'popup'> {
  const shareUrl = buildTelegramShareUrl(options.url, options.text)

  if (isTelegramWebApp(win) && typeof win.Telegram.WebApp.openTelegramLink === 'function') {
    win.Telegram.WebApp.openTelegramLink(shareUrl)
    return 'telegram'
  }

  if (typeof win.navigator.share === 'function') {
    try {
      await win.navigator.share({
        url: options.url,
        text: options.text,
        title: options.text,
      })
      return 'native'
    } catch (err) {
      // User cancel — don't fall through to popup.
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }
      // Share failed (e.g. unsupported) — fall through.
    }
  }

  win.open(shareUrl, '_blank', 'noopener,noreferrer')
  return 'popup'
}

export async function copyTextToClipboard(
  text: string,
  win: Window = window,
): Promise<boolean> {
  try {
    if (win.navigator.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand
  }

  try {
    const el = win.document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.left = '-9999px'
    win.document.body.appendChild(el)
    el.select()
    const ok = win.document.execCommand('copy')
    win.document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

export { buildTelegramShareUrl }
