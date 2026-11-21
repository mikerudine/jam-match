import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { listMyJams } from '@/api/jams'
import { upsertProfile, fetchProfile } from '@/api/profile'
import { useAuth } from '@/auth/AuthContext'
import { ChipSelect } from '@/components/ChipSelect'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import {
  AREA_OPTIONS,
  GENRE_OPTIONS,
  INSTRUMENTS,
  LEVELS,
  isJamArchived,
  jamDisplayTitle,
  type Instrument,
  type JamRequest,
  type JamSeat,
  type Level,
  type Profile,
} from '@/types'

export function ProfilePage() {
  const { session, auth } = useAuth()
  const { t, locale, setLocale } = useLocale()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [telegram, setTelegram] = useState('')
  const [telegramPhoto, setTelegramPhoto] = useState<string | null>(null)
  const [telegramLinked, setTelegramLinked] = useState(false)
  const [instruments, setInstruments] = useState<string[]>([])
  const [genres, setGenres] = useState<string[]>([])
  const [level, setLevel] = useState<Level>('intermediate')
  const [areas, setAreas] = useState<string[]>([])
  const [demoUrl, setDemoUrl] = useState('')
  const [reliability, setReliability] = useState({ score: 1, count: 0 })
  const [archiveJams, setArchiveJams] = useState<
    Array<JamRequest & { seats: JamSeat[] }>
  >([])
  const [archiveOpen, setArchiveOpen] = useState(false)

  useEffect(() => {
    if (!session) return
    let cancelled = false
    Promise.all([
      fetchProfile(session.user.id),
      listMyJams(session.user.id),
    ])
      .then(([p, jams]) => {
        if (cancelled) return
        if (p) applyProfile(p)
        setArchiveJams(jams.filter((j) => isJamArchived(j)))
      })
      .catch((err) => setError(err instanceof Error ? err.message : t.common.error))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, t.common.error])

  const archiveSorted = useMemo(
    () =>
      [...archiveJams].sort((a, b) => {
        const ae = a.window_end ?? a.created_at
        const be = b.window_end ?? b.created_at
        return be.localeCompare(ae)
      }),
    [archiveJams],
  )

  function applyProfile(p: Profile) {
    setDisplayName(p.display_name)
    setTelegram(p.telegram_handle ?? '')
    setTelegramPhoto(p.telegram_photo_url ?? null)
    setTelegramLinked(p.telegram_id != null)
    setInstruments(p.instruments)
    setGenres(p.genres)
    setLevel(p.level)
    setAreas(p.preferred_areas)
    setDemoUrl(p.demo_url ?? '')
    setReliability({ score: p.reliability_score, count: p.reliability_count })
    if (p.locale === 'uk' || p.locale === 'en') setLocale(p.locale)
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!session) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const p = await upsertProfile({
        id: session.user.id,
        display_name: displayName.trim(),
        telegram_handle: telegram.replace(/^@/, '').trim() || null,
        instruments: instruments as Instrument[],
        genres,
        level,
        preferred_areas: areas,
        demo_url: demoUrl.trim() || null,
        locale,
      })
      applyProfile(p)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading />

  return (
    <form onSubmit={onSave} className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">{t.profile.title}</h1>
        <button
          type="button"
          onClick={() => auth?.signOut()}
          className="text-sm text-mute hover:text-danger"
        >
          {t.auth.signOut}
        </button>
      </div>

      <Field label={t.profile.displayName}>
        <input
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="field"
        />
      </Field>

      <Field label={t.profile.telegram}>
        {telegramPhoto && (
          <img
            src={telegramPhoto}
            alt=""
            className="mb-2 h-12 w-12 rounded-full border border-line object-cover"
            referrerPolicy="no-referrer"
          />
        )}
        <input
          value={telegram}
          onChange={(e) => setTelegram(e.target.value)}
          placeholder="@username"
          className="field"
          readOnly={telegramLinked}
          title={telegramLinked ? t.profile.telegramFromAuth : undefined}
        />
        {telegramLinked && (
          <p className="mt-1 text-xs text-mute">{t.profile.telegramFromAuth}</p>
        )}
      </Field>

      <Field label={t.profile.instruments}>
        <ChipSelect
          options={INSTRUMENTS.map((i) => ({
            value: i,
            label: t.instruments[i],
          }))}
          value={instruments}
          onChange={setInstruments}
        />
      </Field>

      <Field label={t.profile.genres}>
        <ChipSelect
          options={GENRE_OPTIONS.map((g) => ({ value: g, label: g }))}
          value={genres}
          onChange={setGenres}
        />
      </Field>

      <Field label={t.profile.level}>
        <ChipSelect
          multiple={false}
          options={LEVELS.map((l) => ({ value: l, label: t.levels[l] }))}
          value={[level]}
          onChange={(v) => setLevel((v[0] as Level) || 'intermediate')}
        />
      </Field>

      <Field label={t.profile.areas}>
        <ChipSelect
          options={AREA_OPTIONS.map((a) => ({ value: a, label: a }))}
          value={areas}
          onChange={setAreas}
        />
      </Field>

      <Field label={t.profile.demo}>
        <input
          type="url"
          value={demoUrl}
          onChange={(e) => setDemoUrl(e.target.value)}
          placeholder="https://"
          className="field"
        />
      </Field>

      <p className="text-sm text-mute">
        {t.profile.reliability}:{' '}
        <span className="text-teal">
          {(reliability.score * 100).toFixed(0)}% ({reliability.count})
        </span>
      </p>

      {(!displayName.trim() || instruments.length === 0) && (
        <p className="text-sm text-amber">{t.profile.incomplete}</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl bg-amber px-4 py-3 font-semibold text-ink hover:bg-amber-deep disabled:opacity-60"
      >
        {t.profile.save}
      </button>
      {saved && <p className="text-sm text-teal">{t.profile.saved}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {archiveSorted.length > 0 && (
        <section className="rounded-2xl border border-line bg-panel/60 p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={archiveOpen}
            onClick={() => setArchiveOpen((v) => !v)}
          >
            <div>
              <h2 className="font-display text-lg text-cream">
                {t.profile.archive}
              </h2>
              <p className="text-xs text-mute">
                {t.profile.archiveHint} · {archiveSorted.length}
              </p>
            </div>
            <span className="text-mute">{archiveOpen ? '▴' : '▾'}</span>
          </button>
          {archiveOpen && (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {archiveSorted.map((jam) => (
                <li key={jam.id} className="py-3">
                  <Link to={`/jams/${jam.id}`} className="block hover:text-amber">
                    <p className="font-medium text-cream">
                      {jamDisplayTitle(jam, t.formats)}
                    </p>
                    <p className="mt-0.5 text-xs text-mute">
                      {jam.window_start
                        ? new Date(jam.window_start).toLocaleString()
                        : t.home.noDate}
                      {jam.area ? ` · ${jam.area}` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <style>{`
        .field {
          margin-top: 0.4rem;
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid var(--color-line);
          background: var(--color-ink);
          padding: 0.75rem 0.85rem;
          color: var(--color-cream);
          outline: none;
        }
        .field:focus { border-color: var(--color-amber); }
      `}</style>
    </form>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block text-sm text-mute">
      {label}
      <div className="mt-2 text-cream">{children}</div>
    </label>
  )
}
