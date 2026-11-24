import { useEffect, useState } from 'react'
import {
  fetchAvailability,
  fetchAvailabilityDateOverrides,
  replaceAvailability,
  replaceAvailabilityDateOverrides,
} from '@/api/availability'
import { useAuth } from '@/auth/AuthContext'
import { AvailabilityEditor } from '@/components/AvailabilityEditor'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import type { DateOverrideMap } from '@/lib/scheduleOverlap'
import { slotKey } from '@/lib/utils'

export function AvailabilityPage() {
  const { session } = useAuth()
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<DateOverrideMap>(new Map())

  useEffect(() => {
    if (!session) return
    let cancelled = false
    Promise.all([
      fetchAvailability(session.user.id),
      fetchAvailabilityDateOverrides(session.user.id),
    ])
      .then(([slots, rows]) => {
        if (cancelled) return
        setSelected(new Set(slots.map((s) => slotKey(s.day_of_week, s.hour))))
        const map: DateOverrideMap = new Map()
        for (const row of rows) {
          map.set(row.on_date, row.mode)
        }
        setOverrides(map)
      })
      .catch((err) => setError(err instanceof Error ? err.message : t.common.error))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, t.common.error])

  async function save() {
    if (!session) return
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
      await replaceAvailability(session.user.id, slots)
      await replaceAvailabilityDateOverrides(session.user.id, overrideRows)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading />

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="font-display text-2xl">{t.availability.title}</h1>
        <p className="mt-1 text-sm text-mute">{t.availability.hint}</p>
      </div>

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
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-xl bg-amber px-4 py-3 font-semibold text-ink hover:bg-amber-deep disabled:opacity-60"
        >
          {t.availability.save}
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected(new Set())
            setOverrides(new Map())
            setSaved(false)
          }}
          className="rounded-xl border border-line px-4 py-3 text-mute hover:text-cream"
        >
          {t.availability.clear}
        </button>
      </div>
      {saved && <p className="text-sm text-teal">{t.availability.saved}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
