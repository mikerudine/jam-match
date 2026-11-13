import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Instrument, JamSeat } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Display seat role: freeform label wins over enum translation. */
export function seatRoleLabel(
  seat: Pick<JamSeat, 'role' | 'role_label'>,
  instruments: Record<Instrument, string>,
): string {
  if (seat.role_label?.trim()) return seat.role_label.trim()
  return instruments[seat.role] ?? seat.role
}

export function slotKey(day: number, hour: number) {
  return `${day}-${hour}`
}

export function parseSlotKey(key: string): { day: number; hour: number } {
  const [day, hour] = key.split('-').map(Number)
  return { day, hour }
}
