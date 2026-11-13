import { getSupabase } from '@/lib/supabase'
import type { Profile } from '@/types'

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function upsertProfile(
  profile: Partial<Profile> & { id: string; display_name: string },
): Promise<Profile> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .upsert(
      {
        ...profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data as Profile
}
