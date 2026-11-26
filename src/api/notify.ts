import { supabaseConfig } from '@/lib/config'
import { getSupabase } from '@/lib/supabase'

export type NotifyResult =
  | { ok: true; notified?: string }
  | { ok: false; skipped: string }

async function callJamNotify(
  body:
    | { request_id: string }
    | { invite_id: string }
    | { cancel_jam_id: string },
): Promise<NotifyResult> {
  try {
    const supabase = getSupabase()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { ok: false, skipped: 'no_session' }
    }

    const url = `${supabaseConfig.url.replace(/\/$/, '')}/functions/v1/jam-notify`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseConfig.anonKey,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn('jam-notify HTTP', res.status)
      return { ok: false, skipped: `http_${res.status}` }
    }
    const payload = (await res.json().catch(() => null)) as {
      ok?: boolean
      skipped?: string
      notified?: string
    } | null
    if (!payload) {
      return { ok: false, skipped: 'invalid_response' }
    }
    if (payload.ok === false) {
      console.warn('jam-notify skipped', payload.skipped ?? payload)
      return { ok: false, skipped: payload.skipped ?? 'unknown' }
    }
    return { ok: true, notified: payload.notified }
  } catch (err) {
    console.warn('jam-notify failed', err)
    return { ok: false, skipped: 'client_error' }
  }
}

/**
 * Best-effort Telegram notify for a join request.
 * Never throws — join / respond must succeed even if Telegram is down.
 */
export async function notifyJoinRequest(
  requestId: string,
): Promise<NotifyResult> {
  return callJamNotify({ request_id: requestId })
}

/**
 * Best-effort Telegram notify for a matching invite (invitee DM).
 * Never throws — matching / skip cascade must succeed even if Telegram is down.
 */
export async function notifyMatchingInvite(
  inviteId: string,
): Promise<NotifyResult> {
  return callJamNotify({ invite_id: inviteId })
}

/** Best-effort Telegram notify that a jam was cancelled (members). */
export async function notifyJamCancelled(jamId: string): Promise<NotifyResult> {
  return callJamNotify({ cancel_jam_id: jamId })
}
