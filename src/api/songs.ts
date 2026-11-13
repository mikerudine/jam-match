import { getSupabase } from '@/lib/supabase'
import type { SongRow, SongVoteRow, VoteValue } from '@/lib/songList'
import {
  buildSongList,
  countOwnSongs,
  normalizeSongArtist,
  normalizeSongTitle,
  type SongListItem,
} from '@/lib/songList'

export interface JamSongList {
  items: SongListItem[]
  songs: SongRow[]
  votes: SongVoteRow[]
  ownCount: number
}

export async function listJamSongs(
  jamId: string,
  userId: string,
): Promise<JamSongList> {
  const supabase = getSupabase()

  const { data: songs, error: songErr } = await supabase
    .from('jam_songs')
    .select('*')
    .eq('jam_id', jamId)
  if (songErr) throw songErr

  const songRows = (songs ?? []) as SongRow[]
  const songIds = songRows.map((s) => s.id)

  let voteRows: SongVoteRow[] = []
  if (songIds.length > 0) {
    const { data: votes, error: voteErr } = await supabase
      .from('jam_song_votes')
      .select('*')
      .in('song_id', songIds)
    if (voteErr) throw voteErr
    voteRows = (votes ?? []) as SongVoteRow[]
  }

  return {
    songs: songRows,
    votes: voteRows,
    items: buildSongList(songRows, voteRows, userId),
    ownCount: countOwnSongs(songRows, userId),
  }
}

export async function addJamSong(input: {
  jam_id: string
  title: string
  artist?: string
}): Promise<SongRow> {
  const title = normalizeSongTitle(input.title)
  if (!title) throw new Error('title required')
  const artist = normalizeSongArtist(input.artist ?? '')

  const { data: userData, error: userErr } = await getSupabase().auth.getUser()
  if (userErr) throw userErr
  const uid = userData.user?.id
  if (!uid) throw new Error('not authenticated')

  const { data, error } = await getSupabase()
    .from('jam_songs')
    .insert({
      jam_id: input.jam_id,
      added_by: uid,
      title,
      artist,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as SongRow
}

export async function updateJamSong(input: {
  id: string
  title: string
  artist?: string
}): Promise<SongRow> {
  const title = normalizeSongTitle(input.title)
  if (!title) throw new Error('title required')
  const artist = normalizeSongArtist(input.artist ?? '')

  const { data, error } = await getSupabase()
    .from('jam_songs')
    .update({ title, artist })
    .eq('id', input.id)
    .select('*')
    .single()
  if (error) throw error
  return data as SongRow
}

export async function deleteJamSong(songId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('jam_songs')
    .delete()
    .eq('id', songId)
  if (error) throw error
}

/** Set +1/−1 or remove the current user's vote (value null). */
export async function setSongVote(input: {
  song_id: string
  value: VoteValue | null
}): Promise<void> {
  const supabase = getSupabase()
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr
  const uid = userData.user?.id
  if (!uid) throw new Error('not authenticated')

  if (input.value === null) {
    const { error } = await supabase
      .from('jam_song_votes')
      .delete()
      .eq('song_id', input.song_id)
      .eq('user_id', uid)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('jam_song_votes').upsert(
    {
      song_id: input.song_id,
      user_id: uid,
      value: input.value,
    },
    { onConflict: 'song_id,user_id' },
  )
  if (error) throw error
}
