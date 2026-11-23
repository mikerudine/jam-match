import {
  AVAIL_DAYS,
  AVAIL_HOUR_END,
  AVAIL_HOUR_START,
  type AvailabilityDateOverrideMode,
} from '@/types'
import { slotKey } from '@/lib/utils'

export type DateOverrideMap = Map<string, AvailabilityDateOverrideMode>

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Mon=0…Sun=6 ISO dates for the week containing `anchor` (local). */
export function isoWeekDates(anchor = new Date()): string[] {
  const dow = (anchor.getDay() + 6) % 7
  const monday = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() - dow,
  )
  return Array.from({ length: AVAIL_DAYS }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return toIsoDateLocal(d)
  })
}

/** Hours shown for a calendar day after applying date overrides. */
export function hoursForCalendarDate(
  dow: number,
  isoDate: string,
  weeklyByDow: number[],
  overrides: DateOverrideMap,
): number {
  const mode = overrides.get(isoDate)
  if (mode === 'off') return 0
  if (mode === 'full') return AVAIL_HOUR_END - AVAIL_HOUR_START + 1
  return weeklyByDow[dow] ?? 0
}

/**
 * Weekly slot keys with current-week date overrides applied:
 * `full` → all 24h that weekday; `off` → none. Other weeks ignore overrides.
 */
export function applyWeekOverridesToSlots(
  weeklyKeys: Iterable<string>,
  overrides: DateOverrideMap,
  weekIsoByDow: string[],
): Set<string> {
  const next = new Set(weeklyKeys)
  for (let dow = 0; dow < AVAIL_DAYS; dow++) {
    const iso = weekIsoByDow[dow]
    if (!iso) continue
    const mode = overrides.get(iso)
    if (mode === 'off') {
      for (let h = AVAIL_HOUR_START; h <= AVAIL_HOUR_END; h++) {
        next.delete(slotKey(dow, h))
      }
    } else if (mode === 'full') {
      for (let h = AVAIL_HOUR_START; h <= AVAIL_HOUR_END; h++) {
        next.add(slotKey(dow, h))
      }
    }
  }
  return next
}

/**
 * Calendar day tap cycle:
 * empty → yellow (`full` = whole day free);
 * yellow → red (`off` = definitely can't);
 * red → empty.
 * Days already lit by the weekly grid skip yellow: lit → red → weekly again.
 */
export function nextDateOverride(
  isoDate: string,
  dow: number,
  weeklyByDow: number[],
  overrides: DateOverrideMap,
): AvailabilityDateOverrideMode | null {
  const current = overrides.get(isoDate)
  if (current === 'full') return 'off'
  if (current === 'off') return null
  if ((weeklyByDow[dow] ?? 0) > 0) return 'off'
  return 'full'
}

export interface OverlapParticipant {
  user_id: string
  display_name: string
  slot_count: number
}

export interface OverlapCell {
  day_of_week: number
  hour: number
  count: number
  /** Who is free in this slot (when provided by RPC). */
  user_ids?: string[]
}

export interface JamScheduleOverlap {
  participant_count: number
  participants: OverlapParticipant[]
  cells: OverlapCell[]
}

export type OverlapIntensity = 'none' | 'partial' | 'full'

/** Distinct colors for hour-grid stripes (dark UI). */
export const PARTICIPANT_PALETTE = [
  '#2dd4bf',
  '#f59e0b',
  '#fb7185',
  '#38bdf8',
  '#a3e635',
  '#f97316',
  '#e2e8f0',
  '#c084fc',
] as const

export function buildOverlapMap(
  cells: OverlapCell[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of cells) {
    map.set(slotKey(c.day_of_week, c.hour), c.count)
  }
  return map
}

export function buildOverlapUsersMap(
  cells: OverlapCell[],
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const c of cells) {
    map.set(slotKey(c.day_of_week, c.hour), c.user_ids ?? [])
  }
  return map
}

/** Stable color per participant (order = display_name sort from API). */
export function participantColorById(
  participants: OverlapParticipant[],
): Map<string, string> {
  const map = new Map<string, string>()
  participants.forEach((p, i) => {
    map.set(p.user_id, PARTICIPANT_PALETTE[i % PARTICIPANT_PALETTE.length]!)
  })
  return map
}

/** Equal vertical stripes for who is free in a cell. */
export function stripedCellBackground(colors: string[]): string | undefined {
  if (colors.length === 0) return undefined
  if (colors.length === 1) return colors[0]
  const stops = colors.flatMap((c, i) => {
    const a = ((i / colors.length) * 100).toFixed(2)
    const b = (((i + 1) / colors.length) * 100).toFixed(2)
    return [`${c} ${a}%`, `${c} ${b}%`]
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export function overlapIntensity(
  count: number,
  participantCount: number,
): OverlapIntensity {
  if (count <= 0 || participantCount <= 0) return 'none'
  if (participantCount >= 2 && count >= participantCount) return 'full'
  return 'partial'
}

/** People who filled weekly availability — empty schedules don't block "full". */
export function activeSchedulerCount(
  participants: OverlapParticipant[],
): number {
  return participants.filter((p) => p.slot_count > 0).length
}

export function hoursList(): number[] {
  const list: number[] = []
  for (let h = AVAIL_HOUR_START; h <= AVAIL_HOUR_END; h++) list.push(h)
  return list
}

/** Count full-overlap hours for a weekday (Mon=0…Sun=6). */
export function fullOverlapHoursByDay(
  cells: OverlapCell[],
  participantCount: number,
): number[] {
  const byDay = Array.from({ length: AVAIL_DAYS }, () => 0)
  if (participantCount < 2) return byDay
  for (const c of cells) {
    if (c.count >= participantCount && c.day_of_week >= 0 && c.day_of_week < AVAIL_DAYS) {
      byDay[c.day_of_week] += 1
    }
  }
  return byDay
}

/** Count selected hours per weekday from slot keys `day-hour`. */
export function hoursCountByDayFromKeys(keys: Iterable<string>): number[] {
  const byDay = Array.from({ length: AVAIL_DAYS }, () => 0)
  for (const key of keys) {
    const [day] = key.split('-').map(Number)
    if (day >= 0 && day < AVAIL_DAYS) byDay[day] += 1
  }
  return byDay
}

export interface CalendarDay {
  date: Date
  key: string
  /** YYYY-MM-DD for override storage. */
  isoDate: string
  dayOfMonth: number
  /** ISO weekday Mon=0 … Sun=6 (matches availability_slots). */
  dow: number
  inMonth: boolean
  isToday: boolean
  fullOverlapHours: number
  isJamWindow: boolean
  overrideMode: AvailabilityDateOverrideMode | null
}

/** Build a month grid (Mon-first) with overlap hints per weekday / date. */
export function buildMonthCalendar(
  anchor: Date,
  fullHoursByDow: number[],
  jamWindow: { start: Date; end: Date } | null,
  today = new Date(),
  overrides: DateOverrideMap = new Map(),
): CalendarDay[] {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const first = new Date(year, month, 1)
  // JS getDay: Sun=0…Sat=6 → Mon=0…Sun=6
  const firstDow = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - firstDow)
  const days: CalendarDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const dow = (d.getDay() + 6) % 7
    const inMonth = d.getMonth() === month
    const isoDate = toIsoDateLocal(d)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    let isJamWindow = false
    if (jamWindow) {
      const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
      const s = new Date(
        jamWindow.start.getFullYear(),
        jamWindow.start.getMonth(),
        jamWindow.start.getDate(),
      )
      const e = new Date(
        jamWindow.end.getFullYear(),
        jamWindow.end.getMonth(),
        jamWindow.end.getDate(),
        23,
        59,
        59,
        999,
      )
      isJamWindow = noon.getTime() >= s.getTime() && noon.getTime() <= e.getTime()
    }
    const overrideMode = overrides.get(isoDate) ?? null
    days.push({
      date: d,
      key,
      isoDate,
      dayOfMonth: d.getDate(),
      dow,
      inMonth,
      isToday,
      fullOverlapHours: inMonth
        ? hoursForCalendarDate(dow, isoDate, fullHoursByDow, overrides)
        : 0,
      isJamWindow,
      overrideMode: inMonth ? overrideMode : null,
    })
  }
  return days
}

export function monthLabel(anchor: Date, locale: string): string {
  return anchor.toLocaleDateString(locale === 'uk' ? 'uk-UA' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  })
}
