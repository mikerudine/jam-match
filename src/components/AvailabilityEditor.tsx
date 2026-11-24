import { useMemo, useState } from 'react'
import { CollapseSection } from '@/components/CollapseSection'
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

export interface AvailabilityEditorProps {
  selected: Set<string>
  overrides: DateOverrideMap
  onSelectedChange: (next: Set<string>) => void
  onOverridesChange: (next: DateOverrideMap) => void
  /** Start with calendar/hours expanded (jam edit flow). */
  defaultOpen?: boolean
  compact?: boolean
}

export function AvailabilityEditor({
  selected,
  overrides,
  onSelectedChange,
  onOverridesChange,
  defaultOpen = false,
  compact = false,
}: AvailabilityEditorProps) {
  const { t, locale } = useLocale()
  const [calendarOpen, setCalendarOpen] = useState(defaultOpen)
  const [hoursOpen, setHoursOpen] = useState(defaultOpen)
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
    () =>
      buildMonthCalendar(monthAnchor, hoursByDow, null, new Date(), overrides),
    [monthAnchor, hoursByDow, overrides],
  )
  const activeDays = calendar.filter(
    (d) => d.inMonth && d.fullOverlapHours > 0,
  ).length

  function toggle(day: number, hour: number) {
    const weekDate = weekIso[day]
    if (weekDate && overrides.has(weekDate)) {
      const next = new Map(overrides)
      next.delete(weekDate)
      onOverridesChange(next)
    }
    const key = slotKey(day, hour)
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectedChange(next)
  }

  function toggleCalendarDay(isoDate: string, dow: number, inMonth: boolean) {
    if (!inMonth) return
    const mode = nextDateOverride(isoDate, dow, hoursByDow, overrides)
    const next = new Map(overrides)
    if (mode === null) next.delete(isoDate)
    else next.set(isoDate, mode)
    onOverridesChange(next)
  }

  return (
    <div className={cn('space-y-3', compact && 'space-y-2')}>
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
                aria-pressed={lit || mode === 'off'}
                aria-label={day.isoDate}
                onClick={() =>
                  toggleCalendarDay(day.isoDate, day.dow, day.inMonth)
                }
                className={cn(
                  'flex aspect-square flex-col items-center justify-center rounded-md text-xs transition active:scale-95 disabled:cursor-default',
                  !day.inMonth && 'opacity-25',
                  day.isToday && mode !== 'off' && 'font-semibold text-teal',
                  mode === 'off'
                    ? 'bg-danger/35 text-cream ring-1 ring-danger/60'
                    : mode === 'full'
                      ? 'bg-amber/45 text-cream ring-1 ring-amber/50'
                      : lit
                        ? 'bg-amber/30 text-cream'
                        : 'bg-ink/30 text-mute',
                )}
              >
                {day.dayOfMonth}
                {mode === 'off' ? (
                  <span className="text-[9px] text-danger">
                    {t.availability.dayBlocked}
                  </span>
                ) : lit ? (
                  <span className="text-[9px] tabular-nums text-amber">
                    {day.fullOverlapHours}h
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-mute">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-amber/50" />
            {t.availability.legendFree}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-danger/50" />
            {t.availability.legendBlocked}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] text-mute">
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
                      ? 'text-amber'
                      : weekMode === 'off'
                        ? 'text-danger line-through'
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
                        weekMode === 'full' &&
                          on &&
                          'ring-1 ring-inset ring-amber/40',
                        weekMode === 'off' && 'opacity-30',
                      )}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </CollapseSection>
    </div>
  )
}
