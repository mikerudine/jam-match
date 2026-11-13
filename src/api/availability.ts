import { getSupabase } from '@/lib/supabase'
import type { AvailabilitySlot } from '@/types'

export async function fetchAvailability(userId: string): Promise<AvailabilitySlot[]> {
  const { data, error } = await getSupabase()
    .from('availability_slots')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as AvailabilitySlot[]
}

export async function replaceAvailability(
  userId: string,
  slots: Array<{ day_of_week: number; hour: number }>,
): Promise<void> {
  const supabase = getSupabase()
  const { error: delError } = await supabase
    .from('availability_slots')
    .delete()
    .eq('user_id', userId)
  if (delError) throw delError

  if (slots.length === 0) return

  const { error: insError } = await supabase.from('availability_slots').insert(
    slots.map((s) => ({
      user_id: userId,
      day_of_week: s.day_of_week,
      hour: s.hour,
    })),
  )
  if (insError) throw insError
}
