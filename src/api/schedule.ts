import { getSupabase } from '@/lib/supabase'
import type { JamScheduleOverlap } from '@/lib/scheduleOverlap'

export async function fetchJamScheduleOverlap(
  jamId: string,
): Promise<JamScheduleOverlap> {
  const { data, error } = await getSupabase().rpc('get_jam_schedule_overlap', {
    p_jam_id: jamId,
  })
  if (error) throw error
  const payload = (data ?? {}) as Partial<JamScheduleOverlap>
  return {
    participant_count: payload.participant_count ?? 0,
    participants: payload.participants ?? [],
    cells: payload.cells ?? [],
  }
}
