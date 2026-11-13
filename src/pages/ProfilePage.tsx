import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
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
  type Instrument,
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
  const [instruments, setInstruments] = useState<string[]>([])
  const [genres, setGenres] = useState<string[]>([])
  const [level, setLevel] = useState<Level>('intermediate')
  const [areas, setAreas] = useState<string[]>(['Podil'])
  const [demoUrl, setDemoUrl] = useState('')
  const [reliability, setReliability] = useState({ score: 1, count: 0 })

  useEffect(() => {
    if (!session) return
    let cancelled = false
    fetchProfile(session.user.id)
      .then((p) => {
        if (cancelled || !p) return
        applyProfile(p)
      })
      .catch((err) => setError(err instanceof Error ? err.message : t.common.error))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, t.common.error])

  function applyProfile(p: Profile) {
    setDisplayName(p.display_name)
    setTelegram(p.telegram_handle ?? '')
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
        <input
          value={telegram}
          onChange={(e) => setTelegram(e.target.value)}
          placeholder="@username"
          className="field"
        />
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
