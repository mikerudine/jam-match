import { useEffect, useState } from 'react'
import {
  listJoinRequestsForJam,
  respondToJoinRequest,
} from '@/api/jams'
import { useLocale } from '@/i18n/LocaleContext'
import {
  isJamOpenForJoin,
  type JamJoinRequest,
  type JamRequest,
  type Profile,
} from '@/types'

type JoinRow = JamJoinRequest & {
  requester: Pick<
    Profile,
    'id' | 'display_name' | 'telegram_handle' | 'instruments'
  > | null
}

export interface JoinRequestsPanelProps {
  jam: JamRequest
  /** Bump to refetch after external changes. */
  refreshKey?: number
  onChanged?: () => void | Promise<void>
  /** Optional fixture rows (preview). */
  initialRows?: JoinRow[]
  respondFn?: (requestId: string, accept: boolean) => Promise<void>
  listFn?: (jamId: string) => Promise<JoinRow[]>
}

/** Initiator panel: pending join requests with Accept / Decline. */
export function JoinRequestsPanel({
  jam,
  refreshKey = 0,
  onChanged,
  initialRows,
  respondFn,
  listFn,
}: JoinRequestsPanelProps) {
  const { t } = useLocale()
  const open = isJamOpenForJoin(jam.status, jam.window_end)

  const [rows, setRows] = useState<JoinRow[]>(initialRows ?? [])
  const [loading, setLoading] = useState(!initialRows)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialRows) {
      setRows(initialRows)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const data = await (listFn ?? listJoinRequestsForJam)(jam.id)
        if (!cancelled) setRows(data)
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t.common.error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [jam.id, refreshKey, initialRows, listFn, t.common.error])

  if (!open) return null

  const pending = rows.filter((r) => r.status === 'pending')

  async function respond(id: string, accept: boolean) {
    setBusyId(id)
    setError(null)
    try {
      await (respondFn ?? respondToJoinRequest)(id, accept)
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: accept ? 'accepted' : 'declined',
                responded_at: new Date().toISOString(),
              }
            : r,
        ),
      )
      await onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel/90 p-4">
      <h2 className="font-display text-lg">{t.jam.joinRequests}</h2>
      {loading ? (
        <p className="text-sm text-mute">{t.common.loading}</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-mute">{t.jam.joinEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-line/80 bg-ink/30 p-3"
            >
              <p className="font-medium">
                {row.role}
                <span className="text-mute">
                  {' '}
                  · {t.jam.joinFrom}{' '}
                  {row.requester?.display_name ?? '…'}
                  {row.requester?.telegram_handle
                    ? ` @${row.requester.telegram_handle}`
                    : ''}
                </span>
              </p>
              {row.note ? (
                <p className="mt-1 text-sm text-mute">{row.note}</p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => respond(row.id, true)}
                  className="flex-1 rounded-xl bg-teal px-3 py-2 text-sm font-semibold text-ink disabled:opacity-60"
                >
                  {t.jam.joinAccept}
                </button>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => respond(row.id, false)}
                  className="flex-1 rounded-xl border border-line px-3 py-2 text-sm text-mute hover:text-cream disabled:opacity-60"
                >
                  {t.jam.joinDecline}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  )
}
