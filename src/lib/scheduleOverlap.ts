import { AVAIL_DAYS, AVAIL_HOUR_END, AVAIL_HOUR_START } from '@/types'
import { slotKey } from '@/lib/utils'

export interface OverlapParticipant {
  user_id: string
  display_name: string
  slot_count: number
}

export interface OverlapCell {
  day_of_week: number
  hour: number
  count: number
}

export interface JamScheduleOverlap {
  participant_count: number
  participants: OverlapParticipant[]
  cells: OverlapCell[]
}

export type OverlapIntensity = 'none' | 'partial' | 'full'

export function buildOverlapMap(
  cells: OverlapCell[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of cells) {
    map.set(slotKey(c.day_of_week, c.hour), c.count)
  }
  return map
}

export function overlapIntensity(
  count: number,
  participantCount: number,
): OverlapIntensity {
  if (count <= 0 || participantCount <= 0) return 'none'
  if (participantCount >= 2 && count >= participantCount) return 'full'
  return 'partial'
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
  dayOfMonth: number
  /** ISO weekday Mon=0 … Sun=6 (matches availability_slots). */
  dow: number
  inMonth: boolean
  isToday: boolean
  fullOverlapHours: number
  isJamWindow: boolean
}

/** Build a month grid (Mon-first) with overlap hints per weekday. */
export function buildMonthCalendar(
  anchor: Date,
  fullHoursByDow: number[],
  jamWindow: { start: Date; end: Date } | null,
  today = new Date(),
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
    days.push({
      date: d,
      key,
      dayOfMonth: d.getDate(),
      dow,
      inMonth,
      isToday,
      fullOverlapHours: inMonth ? fullHoursByDow[dow] ?? 0 : 0,
      isJamWindow,
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
