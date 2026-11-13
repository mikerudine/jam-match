import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slotKey(day: number, hour: number) {
  return `${day}-${hour}`
}

export function parseSlotKey(key: string): { day: number; hour: number } {
  const [day, hour] = key.split('-').map(Number)
  return { day, hour }
}
