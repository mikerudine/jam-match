/** Max songs each participant may add to one jam (enforced in DB too). */
export const MAX_SONGS_PER_USER = 10

export type VoteValue = -1 | 1

export interface SongRow {
  id: string
  jam_id: string
  added_by: string
  title: string
  artist: string | null
  created_at: string
  updated_at: string
}

export interface SongVoteRow {
  id: string
  song_id: string
  user_id: string
  value: VoteValue
  created_at: string
  updated_at: string
}

export interface SongListItem {
  song: SongRow
  plus: number
  minus: number
  score: number
  hasVeto: boolean
  myVote: VoteValue | null
}

/** Aggregate votes and sort by score desc, then title, then id. */
export function buildSongList(
  songs: SongRow[],
  votes: SongVoteRow[],
  currentUserId: string,
): SongListItem[] {
  const bySong = new Map<string, SongVoteRow[]>()
  for (const v of votes) {
    const list = bySong.get(v.song_id)
    if (list) list.push(v)
    else bySong.set(v.song_id, [v])
  }

  const items: SongListItem[] = songs.map((song) => {
    const songVotes = bySong.get(song.id) ?? []
    let plus = 0
    let minus = 0
    let myVote: VoteValue | null = null
    for (const v of songVotes) {
      if (v.value === 1) plus += 1
      else if (v.value === -1) minus += 1
      if (v.user_id === currentUserId) myVote = v.value
    }
    return {
      song,
      plus,
      minus,
      score: plus - minus,
      hasVeto: minus > 0,
      myVote,
    }
  })

  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const titleCmp = a.song.title.localeCompare(b.song.title, undefined, {
      sensitivity: 'base',
    })
    if (titleCmp !== 0) return titleCmp
    return a.song.id.localeCompare(b.song.id)
  })

  return items
}

export function countOwnSongs(songs: SongRow[], userId: string): number {
  return songs.filter((s) => s.added_by === userId).length
}

export function canAddSong(songs: SongRow[], userId: string): boolean {
  return countOwnSongs(songs, userId) < MAX_SONGS_PER_USER
}

export function normalizeSongTitle(title: string): string {
  return title.trim()
}

export function normalizeSongArtist(artist: string): string | null {
  const t = artist.trim()
  return t.length > 0 ? t : null
}

/** Next vote after tapping +1 / −1 (toggle off if same value). */
export function nextVoteValue(
  current: VoteValue | null,
  tapped: VoteValue,
): VoteValue | null {
  return current === tapped ? null : tapped
}
