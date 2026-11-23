import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listBrowseJams,
  listMyJams,
  runMatching,
  type BrowseJamRow,
} from '@/api/jams'
import { fetchProfile } from '@/api/profile'
import { useAuth } from '@/auth/AuthContext'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import { cn } from '@/lib/utils'
import {
  isJamArchived,
  jamDisplayTitle,
  type JamRequest,
  type JamSeat,
  type Profile,
} from '@/types'

type HomeTab = 'mine' | 'friends' | 'matches' | 'all'
type MyJamRow = JamRequest & { seats: JamSeat[] }

export function HomePage() {
  const { session } = useAuth()
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<HomeTab>('mine')
  const [myJams, setMyJams] = useState<MyJamRow[]>([])
  const [browse, setBrowse] = useState<BrowseJamRow[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)

  const reload = useCallback(async () => {
    if (!session) return
    const [p, mine, feed] = await Promise.all([
      fetchProfile(session.user.id),
      listMyJams(session.user.id),
      listBrowseJams(),
    ])
    setProfile(p)
    setMyJams(mine)
    setBrowse(feed)
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

  const myOpen = useMemo(
    () => myJams.filter((j) => !isJamArchived(j)),
    [myJams],
  )

  const myIds = useMemo(() => new Set(myOpen.map((j) => j.id)), [myOpen])

  const friendsJams = useMemo(
    () =>
      browse.filter(
        (j) => j.is_friend_creator && !j.i_am_participant && !myIds.has(j.id),
      ),
    [browse, myIds],
  )

  const matchJams = useMemo(
    () =>
      browse.filter(
        (j) =>
          j.covers_my_availability &&
          !j.i_am_participant &&
          !myIds.has(j.id),
      ),
    [browse, myIds],
  )

  const allJams = useMemo(() => browse, [browse])

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

  const tabs: Array<{ id: HomeTab; label: string; count: number }> = [
    { id: 'mine', label: t.home.tabMine, count: myOpen.length },
    { id: 'friends', label: t.home.tabFriends, count: friendsJams.length },
    { id: 'matches', label: t.home.tabMatches, count: matchJams.length },
    { id: 'all', label: t.home.tabAll, count: allJams.length },
  ]

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

      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === item.id
                ? 'bg-teal text-ink'
                : 'border border-line text-mute hover:text-cream',
            )}
          >
            {item.label}
            <span className="ml-1 tabular-nums opacity-70">{item.count}</span>
          </button>
        ))}
      </div>

      {tab === 'mine' ? (
        <button
          type="button"
          onClick={refreshMatching}
          disabled={matching}
          className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-mute hover:text-cream disabled:opacity-60"
        >
          {t.home.runMatch}
        </button>
      ) : null}

      {tab === 'mine' && (
        <JamList
          empty={t.home.emptyMine}
          statusLabel={statusLabel}
          items={myOpen.map((jam) => ({
            id: jam.id,
            title: jamDisplayTitle(jam, t.formats),
            when: jam.window_start
              ? new Date(jam.window_start).toLocaleString()
              : t.home.noDate,
            area: jam.area,
            status: jam.status,
            meta:
              jam.seats
                .map((s) =>
                  s.role_label?.trim()
                    ? s.role_label.trim()
                    : t.instruments[s.role],
                )
                .join(' · ') || t.home.lineupOpen,
            openSeats: jam.seats.filter((s) => s.status !== 'filled').length,
          }))}
          openSeatsLabel={t.home.openSeats}
          seatsLabel={t.home.seats}
        />
      )}

      {tab === 'friends' && (
        <BrowseList
          empty={t.home.emptyFriends}
          statusLabel={statusLabel}
          rows={friendsJams}
          t={t}
        />
      )}

      {tab === 'matches' && (
        <BrowseList
          empty={t.home.emptyMatches}
          statusLabel={statusLabel}
          rows={matchJams}
          t={t}
        />
      )}

      {tab === 'all' && (
        <BrowseList
          empty={t.home.emptyAll}
          statusLabel={statusLabel}
          rows={allJams}
          t={t}
        />
      )}

      <Link to="/profile" className="block text-center text-sm text-mute hover:text-cream">
        {t.home.archiveHint}
      </Link>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

function BrowseList({
  rows,
  empty,
  statusLabel,
  t,
}: {
  rows: BrowseJamRow[]
  empty: string
  statusLabel: Record<string, string>
  t: ReturnType<typeof useLocale>['t']
}) {
  return (
    <JamList
      empty={empty}
      statusLabel={statusLabel}
      openSeatsLabel={t.home.openSeats}
      items={rows.map((jam) => ({
        id: jam.id,
        title: jamDisplayTitle(jam, t.formats),
        when: jam.window_start
          ? new Date(jam.window_start).toLocaleString()
          : t.home.noDate,
        area: jam.area,
        status: jam.status,
        meta: [
          `${t.home.organizer}: ${jam.creator_display_name}`,
          jam.base_name,
          jam.covers_my_availability ? t.home.timeMatchBadge : null,
        ]
          .filter(Boolean)
          .join(' · '),
        openSeats: jam.open_count,
      }))}
    />
  )
}

function JamList({
  items,
  empty,
  statusLabel,
  openSeatsLabel,
  seatsLabel,
}: {
  items: Array<{
    id: string
    title: string
    when: string
    area: string | null
    status: string
    meta: string
    openSeats: number
  }>
  empty: string
  statusLabel: Record<string, string>
  openSeatsLabel: string
  seatsLabel?: string
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-mute">
        {empty}
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {items.map((jam) => (
        <li key={jam.id}>
          <Link
            to={`/jams/${jam.id}`}
            className="block rounded-2xl border border-line bg-panel/80 p-4 transition hover:border-amber/40"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-cream">{jam.title}</p>
                <p className="mt-1 text-xs text-mute">
                  {jam.when}
                  {jam.area ? ` · ${jam.area}` : ''}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px]',
                  jam.status === 'confirmed'
                    ? 'bg-ok/20 text-ok'
                    : jam.status === 'matching'
                      ? 'bg-amber/20 text-amber'
                      : 'bg-panel-2 text-mute',
                )}
              >
                {statusLabel[jam.status] ?? jam.status}
              </span>
            </div>
            <p className="mt-3 text-xs text-mute">
              {seatsLabel ? `${seatsLabel}: ${jam.meta}` : jam.meta}
              {jam.openSeats > 0 ? (
                <span className="text-amber">
                  {' '}
                  · {openSeatsLabel}: {jam.openSeats}
                </span>
              ) : null}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
