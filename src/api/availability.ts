import { getSupabase } from '@/lib/supabase'
import type {
  AvailabilityDateOverride,
  AvailabilityDateOverrideMode,
  AvailabilitySlot,
} from '@/types'

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

export async function fetchAvailabilityDateOverrides(
  userId: string,
): Promise<AvailabilityDateOverride[]> {
  const { data, error } = await getSupabase()
    .from('availability_date_overrides')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as AvailabilityDateOverride[]
}

export async function replaceAvailabilityDateOverrides(
  userId: string,
  overrides: Array<{ on_date: string; mode: AvailabilityDateOverrideMode }>,
): Promise<void> {
  const supabase = getSupabase()
  const { error: delError } = await supabase
    .from('availability_date_overrides')
    .delete()
    .eq('user_id', userId)
  if (delError) throw delError

  if (overrides.length === 0) return

  const { error: insError } = await supabase
    .from('availability_date_overrides')
    .insert(
      overrides.map((o) => ({
        user_id: userId,
        on_date: o.on_date,
        mode: o.mode,
      })),
    )
  if (insError) throw insError
}

export interface JamAvailabilityBundle {
  customized: boolean
  slots: Array<{ day_of_week: number; hour: number }>
  overrides: Array<{ on_date: string; mode: AvailabilityDateOverrideMode }>
}

/** Effective schedule for a jam: custom if saved, else profile. */
export async function fetchJamAvailability(
  jamId: string,
  userId: string,
): Promise<JamAvailabilityBundle> {
  const supabase = getSupabase()
  const { data: marker, error: markerErr } = await supabase
    .from('jam_availability')
    .select('jam_id')
    .eq('jam_id', jamId)
    .eq('user_id', userId)
    .maybeSingle()
  if (markerErr) throw markerErr

  if (marker) {
    const [{ data: slots, error: slotsErr }, { data: rows, error: rowsErr }] =
      await Promise.all([
        supabase
          .from('jam_availability_slots')
          .select('day_of_week, hour')
          .eq('jam_id', jamId)
          .eq('user_id', userId),
        supabase
          .from('jam_availability_date_overrides')
          .select('on_date, mode')
          .eq('jam_id', jamId)
          .eq('user_id', userId),
      ])
    if (slotsErr) throw slotsErr
    if (rowsErr) throw rowsErr
    return {
      customized: true,
      slots: (slots ?? []) as Array<{ day_of_week: number; hour: number }>,
      overrides: (rows ?? []) as Array<{
        on_date: string
        mode: AvailabilityDateOverrideMode
      }>,
    }
  }

  const [slots, overrides] = await Promise.all([
    fetchAvailability(userId),
    fetchAvailabilityDateOverrides(userId),
  ])
  return {
    customized: false,
    slots: slots.map((s) => ({ day_of_week: s.day_of_week, hour: s.hour })),
    overrides: overrides.map((o) => ({ on_date: o.on_date, mode: o.mode })),
  }
}

export async function replaceJamAvailability(
  jamId: string,
  userId: string,
  slots: Array<{ day_of_week: number; hour: number }>,
  overrides: Array<{ on_date: string; mode: AvailabilityDateOverrideMode }>,
): Promise<void> {
  const supabase = getSupabase()
  const { error: upsertErr } = await supabase.from('jam_availability').upsert(
    { jam_id: jamId, user_id: userId, updated_at: new Date().toISOString() },
    { onConflict: 'jam_id,user_id' },
  )
  if (upsertErr) throw upsertErr

  const { error: delSlots } = await supabase
    .from('jam_availability_slots')
    .delete()
    .eq('jam_id', jamId)
    .eq('user_id', userId)
  if (delSlots) throw delSlots

  const { error: delOv } = await supabase
    .from('jam_availability_date_overrides')
    .delete()
    .eq('jam_id', jamId)
    .eq('user_id', userId)
  if (delOv) throw delOv

  if (slots.length > 0) {
    const { error } = await supabase.from('jam_availability_slots').insert(
      slots.map((s) => ({
        jam_id: jamId,
        user_id: userId,
        day_of_week: s.day_of_week,
        hour: s.hour,
      })),
    )
    if (error) throw error
  }

  if (overrides.length > 0) {
    const { error } = await supabase
      .from('jam_availability_date_overrides')
      .insert(
        overrides.map((o) => ({
          jam_id: jamId,
          user_id: userId,
          on_date: o.on_date,
          mode: o.mode,
        })),
      )
    if (error) throw error
  }
}

/** Drop jam-specific schedule → fall back to profile. */
export async function resetJamAvailability(
  jamId: string,
  userId: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('jam_availability')
    .delete()
    .eq('jam_id', jamId)
    .eq('user_id', userId)
  if (error) throw error
}
