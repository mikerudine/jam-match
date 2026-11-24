import { useEffect, useState } from 'react'
import {
  fetchJamAvailability,
  replaceJamAvailability,
  resetJamAvailability,
} from '@/api/availability'
import { AvailabilityEditor } from '@/components/AvailabilityEditor'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import type { DateOverrideMap } from '@/lib/scheduleOverlap'
import { slotKey } from '@/lib/utils'

export interface JamMyAvailabilitySectionProps {
  jamId: string
  userId: string
  onSaved?: () => void
}

export function JamMyAvailabilitySection({
  jamId,
  userId,
  onSaved,
}: JamMyAvailabilitySectionProps) {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [customized, setCustomized] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<DateOverrideMap>(new Map())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const bundle = await fetchJamAvailability(jamId, userId)
      setCustomized(bundle.customized)
      setSelected(
        new Set(bundle.slots.map((s) => slotKey(s.day_of_week, s.hour))),
      )
      const map: DateOverrideMap = new Map()
      for (const row of bundle.overrides) {
        map.set(row.on_date, row.mode)
      }
      setOverrides(map)
      setSaved(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const bundle = await fetchJamAvailability(jamId, userId)
        if (cancelled) return
        setCustomized(bundle.customized)
        setSelected(
          new Set(bundle.slots.map((s) => slotKey(s.day_of_week, s.hour))),
        )
        const map: DateOverrideMap = new Map()
        for (const row of bundle.overrides) {
          map.set(row.on_date, row.mode)
        }
        setOverrides(map)
        setSaved(false)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t.common.error)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [jamId, userId, t.common.error])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const slots = [...selected].map((key) => {
        const [day, hour] = key.split('-').map(Number)
        return { day_of_week: day, hour }
      })
      const overrideRows = [...overrides.entries()].map(([on_date, mode]) => ({
        on_date,
        mode,
      }))
      await replaceJamAvailability(jamId, userId, slots, overrideRows)
      setCustomized(true)
      setSaved(true)
      setEditing(false)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setSaving(false)
    }
  }

  async function resetToProfile() {
    setSaving(true)
    setError(null)
    try {
      await resetJamAvailability(jamId, userId)
      setEditing(false)
      await load()
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-line bg-panel/90 p-4">
        <Loading />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/90 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-cream">
            {t.jam.myAvailabilityTitle}
          </h2>
          <p className="mt-1 text-xs text-mute">
            {customized
              ? t.jam.myAvailabilityCustom
              : t.jam.myAvailabilityFromProfile}
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(true)
              setSaved(false)
            }}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-cream hover:border-amber/60"
          >
            {t.jam.myAvailabilityEdit}
          </button>
        ) : null}
      </div>

      {editing ? (
        <>
          <AvailabilityEditor
            selected={selected}
            overrides={overrides}
            onSelectedChange={(next) => {
              setSelected(next)
              setSaved(false)
            }}
            onOverridesChange={(next) => {
              setOverrides(next)
              setSaved(false)
            }}
            defaultOpen
            compact
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-amber px-4 py-2.5 text-sm font-semibold text-ink hover:bg-amber-deep disabled:opacity-60"
            >
              {t.jam.myAvailabilitySave}
            </button>
            {customized ? (
              <button
                type="button"
                onClick={resetToProfile}
                disabled={saving}
                className="rounded-xl border border-line px-4 py-2.5 text-sm text-mute hover:text-cream disabled:opacity-60"
              >
                {t.jam.myAvailabilityReset}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                void load()
              }}
              disabled={saving}
              className="rounded-xl border border-line px-4 py-2.5 text-sm text-mute hover:text-cream disabled:opacity-60"
            >
              {t.common.cancel}
            </button>
          </div>
        </>
      ) : null}

      {saved && !editing ? (
        <p className="text-sm text-teal">{t.jam.myAvailabilitySaved}</p>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  )
}
