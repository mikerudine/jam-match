import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listInbox, respondToInvite } from '@/api/jams'
import { useAuth } from '@/auth/AuthContext'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import { jamDisplayTitle, type InviteStatus } from '@/types'
import { cn } from '@/lib/utils'

type InboxItem = Awaited<ReturnType<typeof listInbox>>[number]

function isActiveInvite(item: InboxItem): boolean {
  return (
    item.status === 'pending' &&
    new Date(item.expires_at).getTime() > Date.now()
  )
}

function effectiveStatus(item: InboxItem): InviteStatus {
  if (item.status === 'pending' && new Date(item.expires_at).getTime() <= Date.now()) {
    return 'expired'
  }
  return item.status
}

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

  const active = useMemo(() => items.filter(isActiveInvite), [items])
  const history = useMemo(
    () => items.filter((item) => !isActiveInvite(item)),
    [items],
  )

  const statusLabel: Record<InviteStatus, string> = {
    pending: t.inbox.statusPending,
    accepted: t.inbox.statusAccepted,
    skipped: t.inbox.statusSkipped,
    expired: t.inbox.statusExpired,
  }

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
    <div className="space-y-6 pb-4">
      <h1 className="font-display text-2xl">{t.inbox.title}</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-mute">{t.inbox.activeTitle}</h2>
        {active.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-mute">
            {t.inbox.empty}
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl border border-line bg-panel/90 p-4"
              >
                <Link
                  to={`/jams/${item.jam.id}`}
                  className="font-medium text-cream hover:text-teal"
                >
                  {jamDisplayTitle(item.jam, t.formats)}
                </Link>
                <p className="mt-1 text-sm text-mute">
                  {t.inbox.role}: {t.instruments[item.seat.role]}
                  {item.creator ? ` · ${item.creator.display_name}` : ''}
                </p>
                <p className="mt-1 text-xs text-mute">
                  {item.jam.window_start
                    ? new Date(item.jam.window_start).toLocaleString()
                    : t.home.noDate}
                  {item.jam.area ? ` · ${item.jam.area}` : ''}
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
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-mute">{t.inbox.historyTitle}</h2>
        {history.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-mute">
            {t.inbox.historyEmpty}
          </p>
        ) : (
          <ul className="divide-y divide-line/50 rounded-2xl border border-line/70 bg-panel/60">
            {history.map((item) => {
              const status = effectiveStatus(item)
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/jams/${item.jam.id}`}
                      className="block truncate text-sm font-medium text-cream hover:text-teal"
                    >
                      {jamDisplayTitle(item.jam, t.formats)}
                    </Link>
                    <p className="truncate text-xs text-mute">
                      {t.instruments[item.seat.role]}
                      {item.creator ? ` · ${item.creator.display_name}` : ''}
                      {' · '}
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      status === 'accepted' && 'bg-teal/20 text-teal',
                      status === 'skipped' && 'bg-ink/50 text-mute',
                      status === 'expired' && 'bg-amber/15 text-amber',
                      status === 'pending' && 'bg-amber/15 text-amber',
                    )}
                  >
                    {statusLabel[status]}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
