import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLocale } from '@/i18n/LocaleContext'
import {
  buildMonthCalendar,
  buildOverlapMap,
  fullOverlapHoursByDay,
  hoursList,
  monthLabel,
  overlapIntensity,
  type JamScheduleOverlap,
} from '@/lib/scheduleOverlap'
import { cn, slotKey } from '@/lib/utils'

export interface JamScheduleOverlapProps {
  data: JamScheduleOverlap
  windowStart?: string | null
  windowEnd?: string | null
}

export function JamScheduleOverlapSection({
  data,
  windowStart,
  windowEnd,
}: JamScheduleOverlapProps) {
  const { t, locale } = useLocale()
  const [monthAnchor, setMonthAnchor] = useState(() => {
    if (windowStart) return new Date(windowStart)
    return new Date()
  })

  const hours = useMemo(() => hoursList(), [])
  const countMap = useMemo(() => buildOverlapMap(data.cells), [data.cells])
  const fullByDow = useMemo(
    () => fullOverlapHoursByDay(data.cells, data.participant_count),
    [data.cells, data.participant_count],
  )
  const jamWindow = useMemo(() => {
    if (!windowStart || !windowEnd) return null
    return { start: new Date(windowStart), end: new Date(windowEnd) }
  }, [windowStart, windowEnd])

  const calendar = useMemo(
    () => buildMonthCalendar(monthAnchor, fullByDow, jamWindow),
    [monthAnchor, fullByDow, jamWindow],
  )

  const missing = data.participants.filter((p) => p.slot_count === 0)
  const fullCells = data.cells.filter(
    (c) =>
      data.participant_count >= 2 && c.count >= data.participant_count,
  ).length

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-panel/90 p-4 anim-rise">
      <div>
        <h2 className="font-display text-lg">{t.schedule.title}</h2>
        <p className="mt-1 text-sm text-mute">{t.schedule.hint}</p>
      </div>

      <ul className="flex flex-wrap gap-2">
        {data.participants.map((p) => (
          <li
            key={p.user_id}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs',
              p.slot_count > 0
                ? 'border-teal/40 bg-teal/10 text-cream'
                : 'border-amber/40 bg-amber/10 text-amber',
            )}
          >
            {p.display_name}
            {p.slot_count > 0
              ? ` · ${p.slot_count}`
              : ` · ${t.schedule.noSlots}`}
          </li>
        ))}
      </ul>

      {missing.length > 0 ? (
        <p className="text-sm text-amber">
          {t.schedule.missingHint.replace(
            '{names}',
            missing.map((p) => p.display_name).join(', '),
          )}{' '}
          <Link to="/availability" className="underline underline-offset-2">
            {t.nav.availability}
          </Link>
        </p>
      ) : null}

      {/* Month calendar — weekdays tinted by full-overlap hour count */}
      <div className="rounded-xl border border-line/70 bg-panel-2/40 p-3">
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
          {calendar.map((day) => (
            <div
              key={day.key}
              className={cn(
                'flex aspect-square flex-col items-center justify-center rounded-md text-xs',
                !day.inMonth && 'opacity-25',
                day.isJamWindow && 'ring-2 ring-amber',
                day.isToday && 'font-semibold text-teal',
                day.fullOverlapHours > 0
                  ? 'bg-teal/25 text-cream'
                  : 'bg-ink/30 text-mute',
              )}
              title={
                day.fullOverlapHours > 0
                  ? t.schedule.dayOverlapTitle.replace(
                      '{n}',
                      String(day.fullOverlapHours),
                    )
                  : undefined
              }
            >
              {day.dayOfMonth}
              {day.fullOverlapHours > 0 ? (
                <span className="text-[9px] tabular-nums text-teal">
                  {day.fullOverlapHours}h
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-mute">{t.schedule.calendarHint}</p>
      </div>

      {/* Hour square — intersection heat map */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-mute">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[2px] bg-teal/80" />
            {t.schedule.legendFull}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[2px] bg-amber/50" />
            {t.schedule.legendPartial}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[2px] bg-ink/50 ring-1 ring-line" />
            {t.schedule.legendNone}
          </span>
        </div>
        <div className="w-full min-w-0 rounded-xl border border-line/70 bg-panel-2/40 p-2">
          <div
            className="grid w-full gap-0.5"
            style={{
              gridTemplateColumns: `1.75rem repeat(7, minmax(0, 1fr))`,
            }}
          >
            <div />
            {t.days.map((d) => (
              <div
                key={d}
                className="py-1 text-center text-[10px] font-medium text-mute sm:text-xs"
              >
                {d}
              </div>
            ))}
            {hours.map((hour) => (
              <div key={hour} className="contents">
                <div className="flex items-center justify-end pr-0.5 text-[9px] text-mute sm:text-[10px]">
                  {String(hour).padStart(2, '0')}
                </div>
                {t.days.map((_, day) => {
                  const count = countMap.get(slotKey(day, hour)) ?? 0
                  const intensity = overlapIntensity(
                    count,
                    data.participant_count,
                  )
                  return (
                    <div
                      key={`${day}-${hour}`}
                      title={
                        count > 0
                          ? t.schedule.cellTitle
                              .replace('{count}', String(count))
                              .replace(
                                '{total}',
                                String(data.participant_count),
                              )
                          : undefined
                      }
                      className={cn(
                        'h-6 rounded-[3px] sm:h-7 sm:rounded-md',
                        intensity === 'full' && 'bg-teal/85',
                        intensity === 'partial' && 'bg-amber/45',
                        intensity === 'none' && 'bg-ink/40',
                      )}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-sm text-mute">
          {data.participant_count < 2
            ? t.schedule.needMorePeople
            : fullCells > 0
              ? t.schedule.fullSummary.replace('{n}', String(fullCells))
              : t.schedule.noFullOverlap}
        </p>
      </div>
    </section>
  )
}
