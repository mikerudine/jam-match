import { getSupabase } from '@/lib/supabase'
import type { Profile } from '@/types'

export interface EnsureProfileInput {
  display_name?: string | null
  telegram_id?: number | null
  telegram_username?: string | null
  telegram_first_name?: string | null
  telegram_last_name?: string | null
  telegram_photo_url?: string | null
}

/** Idempotent jam.profiles row for auth.uid() — call after every sign-in. */
export async function ensureProfile(
  input: EnsureProfileInput = {},
): Promise<Profile> {
  const { data, error } = await getSupabase().rpc('ensure_profile', {
    p_display_name: input.display_name ?? null,
    p_telegram_id: input.telegram_id ?? null,
    p_telegram_username: input.telegram_username ?? null,
    p_telegram_first_name: input.telegram_first_name ?? null,
    p_telegram_last_name: input.telegram_last_name ?? null,
    p_telegram_photo_url: input.telegram_photo_url ?? null,
  })
  if (error) throw error
  return data as Profile
}

/** Own profile including telegram_id (hidden from table SELECT for others). */
export async function fetchProfile(_userId?: string): Promise<Profile | null> {
  const { data, error } = await getSupabase().rpc('get_own_profile')
  if (error) throw error
  return (data as Profile | null) ?? null
}

export async function upsertProfile(
  profile: Partial<Profile> & { id: string; display_name: string },
): Promise<Profile> {
  const {
    telegram_id: _tid,
    telegram_write_access: _twa,
    ...safe
  } = profile
  const { error } = await getSupabase()
    .from('profiles')
    .upsert(
      {
        ...safe,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
  if (error) throw error
  const mine = await fetchProfile(profile.id)
  if (!mine) throw new Error('profile missing after upsert')
  return mine
}
