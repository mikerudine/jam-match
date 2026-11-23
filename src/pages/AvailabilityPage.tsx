import { useEffect, useMemo, useState } from 'react'
import {
  fetchAvailability,
  fetchAvailabilityDateOverrides,
  replaceAvailability,
  replaceAvailabilityDateOverrides,
} from '@/api/availability'
import { useAuth } from '@/auth/AuthContext'
import { CollapseSection } from '@/components/CollapseSection'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import {
  applyWeekOverridesToSlots,
  buildMonthCalendar,
  hoursCountByDayFromKeys,
  hoursList,
  isoWeekDates,
  monthLabel,
  nextDateOverride,
  type DateOverrideMap,
} from '@/lib/scheduleOverlap'
import { cn, slotKey } from '@/lib/utils'
import type { AvailabilityDateOverrideMode } from '@/types'

export function AvailabilityPage() {
  const { session } = useAuth()
  const { t, locale } = useLocale()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<DateOverrideMap>(new Map())
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [hoursOpen, setHoursOpen] = useState(false)
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())

  const hours = useMemo(() => hoursList(), [])
  const hoursByDow = useMemo(
    () => hoursCountByDayFromKeys(selected),
    [selected],
  )
  const weekIso = useMemo(() => isoWeekDates(new Date()), [])
  const displaySelected = useMemo(
    () => applyWeekOverridesToSlots(selected, overrides, weekIso),
    [selected, overrides, weekIso],
  )
  const calendar = useMemo(
    () => buildMonthCalendar(monthAnchor, hoursByDow, null, new Date(), overrides),
    [monthAnchor, hoursByDow, overrides],
  )
  const activeDays = calendar.filter(
    (d) => d.inMonth && d.fullOverlapHours > 0,
  ).length

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

  function toggle(day: number, hour: number) {
    const weekDate = weekIso[day]
    if (weekDate && overrides.has(weekDate)) {
      setOverrides((prev) => {
        const next = new Map(prev)
        next.delete(weekDate)
        return next
      })
    }
    const key = slotKey(day, hour)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setSaved(false)
  }

  function toggleCalendarDay(isoDate: string, dow: number, inMonth: boolean) {
    if (!inMonth) return
    const mode = nextDateOverride(isoDate, dow, hoursByDow, overrides)
    setOverrides((prev) => {
      const next = new Map(prev)
      if (mode === null) next.delete(isoDate)
      else next.set(isoDate, mode)
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

      <CollapseSection
        title={t.availability.calendarTitle}
        summary={t.availability.calendarSummary
          .replace('{days}', String(activeDays))
          .replace('{hours}', String(displaySelected.size))}
        open={calendarOpen}
        onToggle={() => setCalendarOpen((v) => !v)}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label={t.schedule.prevMonth}
            onClick={() =>
              setMonthAnchor(
                (d) => new Date(d.getFullYear(), d.getMonth() - 1, 1),
              )
            }
            className="rounded-lg border border-line px-2 py-1 text-sm text-mute hover:text-cream"
          >
            ←
          </button>
          <p className="font-medium capitalize text-cream">
            {monthLabel(monthAnchor, locale)}
          </p>
          <button
            type="button"
            aria-label={t.schedule.nextMonth}
            onClick={() =>
              setMonthAnchor(
                (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
              )
            }
            className="rounded-lg border border-line px-2 py-1 text-sm text-mute hover:text-cream"
          >
            →
          </button>
        </div>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
        >
          {t.days.map((d) => (
            <div
              key={d}
              className="py-1 text-center text-[10px] font-medium text-mute"
            >
              {d}
            </div>
          ))}
          {calendar.map((day) => {
            const lit = day.fullOverlapHours > 0
            const mode = day.overrideMode
            return (
              <button
                key={day.key}
                type="button"
                disabled={!day.inMonth}
                aria-pressed={lit}
                aria-label={day.isoDate}
                onClick={() =>
                  toggleCalendarDay(day.isoDate, day.dow, day.inMonth)
                }
                className={cn(
                  'flex aspect-square flex-col items-center justify-center rounded-md text-xs transition active:scale-95 disabled:cursor-default',
                  !day.inMonth && 'opacity-25',
                  day.isToday && 'font-semibold text-teal',
                  lit
                    ? mode === 'full'
                      ? 'bg-teal/35 text-cream ring-1 ring-teal/50'
                      : 'bg-amber/30 text-cream'
                    : mode === 'off'
                      ? 'bg-ink/40 text-mute ring-1 ring-dashed ring-line'
                      : 'bg-ink/30 text-mute',
                )}
              >
                {day.dayOfMonth}
                {lit ? (
                  <span
                    className={cn(
                      'text-[9px] tabular-nums',
                      mode === 'full' ? 'text-teal' : 'text-amber',
                    )}
                  >
                    {day.fullOverlapHours}h
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] text-mute">
          {t.availability.calendarHint}
        </p>
      </CollapseSection>

      <CollapseSection
        title={t.availability.hoursTitle}
        summary={t.availability.hoursSummary.replace(
          '{n}',
          String(displaySelected.size),
        )}
        open={hoursOpen}
        onToggle={() => setHoursOpen((v) => !v)}
      >
        <p className="mb-2 text-[11px] text-mute">
          {t.availability.hoursWeekHint}
        </p>
        <div className="w-full min-w-0 rounded-xl border border-line/70 bg-panel-2/40 p-2">
          <div
            className="grid w-full gap-0.5"
            style={{
              gridTemplateColumns: `1.75rem repeat(7, minmax(0, 1fr))`,
            }}
          >
            <div />
            {t.days.map((d, day) => {
              const weekMode: AvailabilityDateOverrideMode | undefined =
                overrides.get(weekIso[day] ?? '')
              return (
                <div
                  key={d}
                  className={cn(
                    'py-1 text-center text-[10px] font-medium sm:text-xs',
                    weekMode === 'full'
                      ? 'text-teal'
                      : weekMode === 'off'
                        ? 'text-mute line-through'
                        : 'text-mute',
                  )}
                >
                  {d}
                </div>
              )
            })}
            {hours.map((hour) => (
              <div key={hour} className="contents">
                <div className="flex items-center justify-end pr-0.5 text-[9px] text-mute sm:text-[10px]">
                  {String(hour).padStart(2, '0')}
                </div>
                {t.days.map((_, day) => {
                  const on = displaySelected.has(slotKey(day, hour))
                  const weekMode = overrides.get(weekIso[day] ?? '')
                  return (
                    <button
                      key={`${day}-${hour}`}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(day, hour)}
                      className={cn(
                        'h-6 rounded-[3px] text-[10px] transition active:scale-95 sm:h-7 sm:rounded-md',
                        on ? 'slot-on' : 'slot-off',
                        weekMode === 'full' && on && 'ring-1 ring-inset ring-teal/40',
                      )}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </CollapseSection>

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
