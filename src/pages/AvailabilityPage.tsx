import { useEffect, useMemo, useState } from 'react'
import { fetchAvailability, replaceAvailability } from '@/api/availability'
import { useAuth } from '@/auth/AuthContext'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import { cn, slotKey } from '@/lib/utils'
import { AVAIL_HOUR_END, AVAIL_HOUR_START } from '@/types'

export function AvailabilityPage() {
  const { session } = useAuth()
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const hours = useMemo(() => {
    const list: number[] = []
    for (let h = AVAIL_HOUR_START; h <= AVAIL_HOUR_END; h++) list.push(h)
    return list
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    fetchAvailability(session.user.id)
      .then((slots) => {
        if (cancelled) return
        setSelected(new Set(slots.map((s) => slotKey(s.day_of_week, s.hour))))
      })
      .catch((err) => setError(err instanceof Error ? err.message : t.common.error))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, t.common.error])

  function toggle(day: number, hour: number) {
    const key = slotKey(day, hour)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setSaved(false)
  }

  async function save() {
    if (!session) return
    setSaving(true)
    setError(null)
    try {
      const slots = [...selected].map((key) => {
        const [day, hour] = key.split('-').map(Number)
        return { day_of_week: day, hour }
      })
      await replaceAvailability(session.user.id, slots)
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

      <div className="overflow-x-auto rounded-2xl border border-line bg-panel/70 p-2">
        <div
          className="grid min-w-[520px] gap-1"
          style={{ gridTemplateColumns: `2.5rem repeat(7, minmax(0, 1fr))` }}
        >
          <div />
          {t.days.map((d) => (
            <div key={d} className="py-1 text-center text-xs font-medium text-mute">
              {d}
            </div>
          ))}
          {hours.map((hour) => (
            <div key={hour} className="contents">
              <div className="flex items-center justify-end pr-1 text-[10px] text-mute">
                {String(hour).padStart(2, '0')}
              </div>
              {t.days.map((_, day) => {
                const on = selected.has(slotKey(day, hour))
                return (
                  <button
                    key={`${day}-${hour}`}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(day, hour)}
                    className={cn(
                      'h-8 rounded-md text-[10px] transition active:scale-95',
                      on ? 'slot-on' : 'slot-off',
                    )}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

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
