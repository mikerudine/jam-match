import { useCallback, useEffect, useState } from 'react'
import { listInbox, respondToInvite } from '@/api/jams'
import { useAuth } from '@/auth/AuthContext'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'

type InboxItem = Awaited<ReturnType<typeof listInbox>>[number]

export function InboxPage() {
  const { session } = useAuth()
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<InboxItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!session) return
    const list = await listInbox(session.user.id)
    setItems(list)
  }, [session])

  useEffect(() => {
    let cancelled = false
    reload()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t.common.error)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reload, t.common.error])

  async function respond(id: string, accept: boolean) {
    setBusyId(id)
    setError(null)
    try {
      await respondToInvite(id, accept)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <Loading />

  return (
    <div className="space-y-4 pb-4">
      <h1 className="font-display text-2xl">{t.inbox.title}</h1>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-mute">
          {t.inbox.empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl border border-line bg-panel/90 p-4"
            >
              <p className="font-medium">{t.formats[item.jam.format]}</p>
              <p className="mt-1 text-sm text-mute">
                {t.inbox.role}: {t.instruments[item.seat.role]}
                {item.creator ? ` · ${item.creator.display_name}` : ''}
              </p>
              <p className="mt-1 text-xs text-mute">
                {new Date(item.jam.window_start).toLocaleString()} · {item.jam.area}
                {item.jam.base_name ? ` · ${item.jam.base_name}` : ''}
              </p>
              <p className="mt-1 text-xs text-amber">
                {t.inbox.expires}: {new Date(item.expires_at).toLocaleString()}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => respond(item.id, true)}
                  className="flex-1 rounded-xl bg-teal px-3 py-2 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {t.inbox.accept}
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => respond(item.id, false)}
                  className="flex-1 rounded-xl border border-line px-3 py-2 text-sm text-mute hover:text-cream disabled:opacity-60"
                >
                  {t.inbox.skip}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
