import { supabaseConfig } from '@/lib/config'
import { getSupabase } from '@/lib/supabase'

/**
 * Best-effort Telegram notify for a join request.
 * Never throws — join / respond must succeed even if Telegram is down.
 */
export async function notifyJoinRequest(requestId: string): Promise<void> {
  try {
    const supabase = getSupabase()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) return

    const url = `${supabaseConfig.url.replace(/\/$/, '')}/functions/v1/jam-notify`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseConfig.anonKey,
      },
      body: JSON.stringify({ request_id: requestId }),
    })
    if (!res.ok) {
      console.warn('jam-notify HTTP', res.status)
      return
    }
    const payload = (await res.json().catch(() => null)) as {
      ok?: boolean
      skipped?: string
    } | null
    if (payload && payload.ok === false) {
      console.warn('jam-notify skipped', payload.skipped ?? payload)
    }
  } catch (err) {
    console.warn('jam-notify failed', err)
  }
}
