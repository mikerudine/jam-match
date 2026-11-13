import { getSupabase } from '@/lib/supabase'

const ASKED_KEY = 'jam_tg_write_asked'

/**
 * Ask Telegram once for bot write access (Mini App API ≥ 6.9).
 * Persists a best-effort flag on jam.profiles when granted.
 */
export function requestTelegramWriteAccessOnce(
  win: Window = window,
): void {
  const wa = win.Telegram?.WebApp
  if (!wa || typeof wa.requestWriteAccess !== 'function') return

  try {
    if (win.sessionStorage.getItem(ASKED_KEY) === '1') return
    win.sessionStorage.setItem(ASKED_KEY, '1')
  } catch {
    // sessionStorage may be blocked; still try once per page load.
  }

  try {
    wa.requestWriteAccess((granted) => {
      if (!granted) return
      void persistWriteAccess()
    })
  } catch (err) {
    console.warn('requestWriteAccess failed', err)
  }
}

async function persistWriteAccess(): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('set_telegram_write_access', {
      p_granted: true,
    })
    if (error) console.warn('set_telegram_write_access', error.message)
  } catch (err) {
    console.warn('set_telegram_write_access failed', err)
  }
}

/** Test helper — clear the once-per-session guard. */
export function resetTelegramWriteAccessAskedForTests(
  win: Window = window,
): void {
  try {
    win.sessionStorage.removeItem(ASKED_KEY)
  } catch {
    // ignore
  }
}
