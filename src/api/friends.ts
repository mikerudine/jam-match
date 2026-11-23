import { getSupabase } from '@/lib/supabase'
import type { Profile } from '@/types'

export interface FriendshipRow {
  user_a: string
  user_b: string
  initiated_by: string
  created_at: string
}

export async function listFriends(): Promise<Profile[]> {
  const { data, error } = await getSupabase().rpc('list_friends')
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function acceptFriendInvite(
  inviterId: string,
): Promise<FriendshipRow> {
  const { data, error } = await getSupabase().rpc('accept_friend_invite', {
    p_inviter_id: inviterId,
  })
  if (error) throw error
  return data as FriendshipRow
}

export async function removeFriend(otherId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_friend', {
    p_other_id: otherId,
  })
  if (error) throw error
}
