import { getSupabase } from '@/lib/supabase'
import type { JamScheduleOverlap } from '@/lib/scheduleOverlap'
import type { SuggestedJamWindow } from '@/types'

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

export async function fetchSuggestedJamWindow(
  jamId: string,
): Promise<SuggestedJamWindow | null> {
  const { data, error } = await getSupabase().rpc('suggest_jam_window', {
    p_jam_id: jamId,
  })
  if (error) throw error
  if (!data || typeof data !== 'object') return null
  const row = data as Partial<SuggestedJamWindow>
  if (!row.window_start || !row.window_end) return null
  return {
    window_start: row.window_start,
    window_end: row.window_end,
    match_count: row.match_count ?? 0,
    participant_count: row.participant_count ?? 0,
    matched_user_ids: row.matched_user_ids,
    matched_names: row.matched_names,
  }
}
