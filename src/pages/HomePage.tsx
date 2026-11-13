import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listMyJams, runMatching } from '@/api/jams'
import { fetchProfile } from '@/api/profile'
import { useAuth } from '@/auth/AuthContext'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import type { JamRequest, JamSeat, Profile } from '@/types'

type JamRow = JamRequest & { seats: JamSeat[] }

export function HomePage() {
  const { session } = useAuth()
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [jams, setJams] = useState<JamRow[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)

  const reload = useCallback(async () => {
    if (!session) return
    const [p, list] = await Promise.all([
      fetchProfile(session.user.id),
      listMyJams(session.user.id),
    ])
    setProfile(p)
    setJams(list)
  }, [session])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
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

  async function refreshMatching() {
    setMatching(true)
    setError(null)
    try {
      await runMatching()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setMatching(false)
    }
  }

  if (loading) return <Loading />

  const statusLabel: Record<string, string> = {
    matching: t.home.matching,
    confirmed: t.home.confirmed,
    completed: t.home.completed,
    cancelled: t.home.cancelled,
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl">{t.home.title}</h1>
        <Link
          to="/jams/new"
          className="rounded-full bg-teal px-3 py-2 text-sm font-semibold text-ink"
        >
          {t.nav.newJam}
        </Link>
      </div>

      {profile && (!profile.display_name || profile.instruments.length === 0) && (
        <Link
          to="/profile"
          className="block rounded-xl border border-amber/30 bg-amber/10 px-3 py-3 text-sm text-amber"
        >
          {t.profile.incomplete}
        </Link>
      )}

      <button
        type="button"
        onClick={refreshMatching}
        disabled={matching}
        className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-mute hover:text-cream disabled:opacity-60"
      >
        {t.home.runMatch}
      </button>

      {jams.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-mute">
          {t.home.empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {jams.map((jam) => {
            const open = jam.seats.filter((s) => s.status !== 'filled').length
            return (
              <li key={jam.id}>
                <Link
                  to={`/jams/${jam.id}`}
                  className="block rounded-2xl border border-line bg-panel/80 p-4 transition hover:border-amber/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-cream">
                        {t.formats[jam.format]}
                      </p>
                      <p className="mt-1 text-xs text-mute">
                        {new Date(jam.window_start).toLocaleString()} · {jam.area}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        jam.status === 'confirmed'
                          ? 'bg-ok/20 text-ok'
                          : jam.status === 'matching'
                            ? 'bg-amber/20 text-amber'
                            : 'bg-panel-2 text-mute'
                      }`}
                    >
                      {statusLabel[jam.status]}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-mute">
                    {t.home.seats}:{' '}
                    {jam.seats
                      .map((s) =>
                        s.role_label?.trim()
                          ? s.role_label.trim()
                          : t.instruments[s.role],
                      )
                      .join(' · ')}
                    {open > 0 && (
                      <span className="text-amber">
                        {' '}
                        · {t.home.openSeats}: {open}
                      </span>
                    )}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
