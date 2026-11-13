import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createJam, runMatching } from '@/api/jams'
import { fetchProfile } from '@/api/profile'
import { useAuth } from '@/auth/AuthContext'
import { ChipSelect } from '@/components/ChipSelect'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import {
  AREA_OPTIONS,
  GENRE_OPTIONS,
  INSTRUMENTS,
  JAM_FORMATS,
  type Instrument,
  type JamFormat,
  type Profile,
} from '@/types'

function defaultDate() {
  const d = new Date()
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7))
  return d.toISOString().slice(0, 10)
}

export function NewJamPage() {
  const { session } = useAuth()
  const { t } = useLocale()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [format, setFormat] = useState<JamFormat>('free_jam')
  const [genres, setGenres] = useState<string[]>(['rock'])
  const [creatorRole, setCreatorRole] = useState<Instrument>('guitar')
  const [wanted, setWanted] = useState<Instrument[]>(['drums', 'bass'])
  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState('19:00')
  const [end, setEnd] = useState('21:00')
  const [area, setArea] = useState('')
  const [baseName, setBaseName] = useState('')
  const [ttl, setTtl] = useState(3)

  useEffect(() => {
    if (!session) return
    fetchProfile(session.user.id)
      .then((p) => {
        setProfile(p)
        if (p?.instruments?.[0]) setCreatorRole(p.instruments[0])
        if (p?.genres?.length) setGenres(p.genres.slice(0, 3))
        if (p?.preferred_areas?.[0]) setArea(p.preferred_areas[0])
      })
      .finally(() => setLoading(false))
  }, [session])

  function addSeat(role: Instrument) {
    setWanted((w) => [...w, role])
  }

  function removeSeat(index: number) {
    setWanted((w) => w.filter((_, i) => i !== index))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!session || !profile) return
    if (!area.trim()) {
      setError(t.jam.areaRequired)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const window_start = new Date(`${date}T${start}:00`).toISOString()
      const window_end = new Date(`${date}T${end}:00`).toISOString()
      const jamId = await createJam({
        format,
        genres,
        area: area.trim(),
        base_name: baseName.trim() || undefined,
        window_start,
        window_end,
        invite_ttl_hours: ttl,
        creator_role: creatorRole,
        wanted_roles: wanted,
      })
      await runMatching(jamId)
      navigate(`/jams/${jamId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />

  if (!profile?.display_name || profile.instruments.length === 0) {
    return (
      <div className="space-y-3">
        <Link to="/" className="text-sm text-mute">
          ← {t.common.back}
        </Link>
        <p className="text-amber">{t.profile.incomplete}</p>
        <Link to="/profile" className="text-teal underline">
          {t.profile.title}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-mute">
          ← {t.common.back}
        </Link>
        <h1 className="font-display text-2xl">{t.jam.createTitle}</h1>
      </div>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.format}</p>
        <ChipSelect
          multiple={false}
          options={JAM_FORMATS.map((f) => ({ value: f, label: t.formats[f] }))}
          value={[format]}
          onChange={(v) => setFormat((v[0] as JamFormat) || 'free_jam')}
        />
      </section>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.genres}</p>
        <ChipSelect
          options={GENRE_OPTIONS.map((g) => ({ value: g, label: g }))}
          value={genres}
          onChange={setGenres}
        />
      </section>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.lineup}</p>
        <p className="text-xs text-mute">{t.jam.defaults}</p>
        <div className="rounded-xl border border-line bg-panel p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>
              {t.instruments[creatorRole]}{' '}
              <span className="text-mute">({t.common.me})</span>
            </span>
            <select
              value={creatorRole}
              onChange={(e) => setCreatorRole(e.target.value as Instrument)}
              className="rounded-lg border border-line bg-ink px-2 py-1 text-cream"
            >
              {profile.instruments.map((i) => (
                <option key={i} value={i}>
                  {t.instruments[i]}
                </option>
              ))}
            </select>
          </div>
          {wanted.map((role, idx) => (
            <div
              key={`${role}-${idx}`}
              className="mb-2 flex items-center justify-between text-sm"
            >
              <span>{t.instruments[role]}</span>
              <button
                type="button"
                onClick={() => removeSeat(idx)}
                className="text-xs text-danger"
              >
                {t.jam.removeSeat}
              </button>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap gap-2">
            {INSTRUMENTS.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => addSeat(role)}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-mute hover:text-cream"
              >
                + {t.instruments[role]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <label className="text-sm text-mute">
          {t.jam.date}
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-ink px-2 py-2 text-cream"
          />
        </label>
        <label className="text-sm text-mute">
          {t.jam.start}
          <input
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-ink px-2 py-2 text-cream"
          />
        </label>
        <label className="text-sm text-mute">
          {t.jam.end}
          <input
            type="time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-ink px-2 py-2 text-cream"
          />
        </label>
      </div>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.area}</p>
        <ChipSelect
          multiple={false}
          options={AREA_OPTIONS.map((a) => ({ value: a, label: a }))}
          value={area ? [area] : []}
          onChange={(v) => setArea(v[0] || '')}
        />
        {!area && <p className="text-xs text-amber">{t.jam.areaRequired}</p>}
      </section>

      <label className="block text-sm text-mute">
        {t.jam.base}
        <input
          value={baseName}
          onChange={(e) => setBaseName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-cream"
          placeholder="Rehearsal Point / Aza / …"
        />
      </label>

      <label className="block text-sm text-mute">
        {t.jam.ttl}
        <input
          type="number"
          min={1}
          max={48}
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value) || 3)}
          className="mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-cream"
        />
      </label>

      <button
        type="submit"
        disabled={busy || wanted.length === 0 || genres.length === 0 || !area.trim()}
        className="w-full rounded-xl bg-amber px-4 py-3 font-semibold text-ink hover:bg-amber-deep disabled:opacity-60"
      >
        {t.jam.create}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  )
}
