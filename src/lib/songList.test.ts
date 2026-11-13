/**
 * Song list scoring / slot helpers.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_SONGS_PER_USER,
  buildSongList,
  canAddSong,
  countOwnSongs,
  formatSongScoreLine,
  nextVoteValue,
  normalizeSongArtist,
  normalizeSongTitle,
  type SongRow,
  type SongVoteRow,
} from './songList.ts'

function song(
  partial: Partial<SongRow> & Pick<SongRow, 'id' | 'title' | 'added_by'>,
): SongRow {
  return {
    jam_id: 'jam-1',
    artist: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function vote(
  partial: Partial<SongVoteRow> &
    Pick<SongVoteRow, 'id' | 'song_id' | 'user_id' | 'value'>,
): SongVoteRow {
  return {
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('buildSongList', () => {
  it('sorts by score descending and exposes plus/minus/veto/myVote', () => {
    const songs = [
      song({ id: 'a', title: 'Zed', added_by: 'u1' }),
      song({ id: 'b', title: 'Alpha', added_by: 'u2' }),
      song({ id: 'c', title: 'Mid', added_by: 'u1' }),
    ]
    const votes = [
      vote({ id: 'v1', song_id: 'a', user_id: 'u1', value: 1 }),
      vote({ id: 'v2', song_id: 'a', user_id: 'u2', value: -1 }),
      vote({ id: 'v3', song_id: 'b', user_id: 'u1', value: 1 }),
      vote({ id: 'v4', song_id: 'b', user_id: 'u2', value: 1 }),
      vote({ id: 'v5', song_id: 'c', user_id: 'u2', value: 1 }),
    ]

    const list = buildSongList(songs, votes, 'u1')
    assert.equal(list[0].song.id, 'b')
    assert.equal(list[0].score, 2)
    assert.equal(list[0].plus, 2)
    assert.equal(list[0].minus, 0)
    assert.equal(list[0].hasVeto, false)
    assert.equal(list[0].myVote, 1)

    assert.equal(list[1].song.id, 'c')
    assert.equal(list[1].score, 1)
    assert.equal(list[1].myVote, null)

    assert.equal(list[2].song.id, 'a')
    assert.equal(list[2].score, 0)
    assert.equal(list[2].plus, 1)
    assert.equal(list[2].minus, 1)
    assert.equal(list[2].hasVeto, true)
    assert.equal(list[2].myVote, 1)
  })

  it('ties break by title then id', () => {
    const songs = [
      song({ id: '2', title: 'B', added_by: 'u1' }),
      song({ id: '1', title: 'A', added_by: 'u1' }),
      song({ id: '3', title: 'A', added_by: 'u2' }),
    ]
    const list = buildSongList(songs, [], 'u1')
    assert.deepEqual(
      list.map((i) => i.song.id),
      ['1', '3', '2'],
    )
  })
})

describe('slot helpers', () => {
  it('counts own songs and enforces the 10-slot cap in UI logic', () => {
    const songs = Array.from({ length: MAX_SONGS_PER_USER }, (_, i) =>
      song({ id: `s${i}`, title: `T${i}`, added_by: 'me' }),
    )
    songs.push(song({ id: 'other', title: 'Other', added_by: 'them' }))
    assert.equal(countOwnSongs(songs, 'me'), MAX_SONGS_PER_USER)
    assert.equal(canAddSong(songs, 'me'), false)
    assert.equal(canAddSong(songs, 'them'), true)
  })
})

describe('normalize + nextVoteValue', () => {
  it('trims title/artist', () => {
    assert.equal(normalizeSongTitle('  Hello  '), 'Hello')
    assert.equal(normalizeSongArtist('  Band  '), 'Band')
    assert.equal(normalizeSongArtist('   '), null)
  })

  it('toggles vote off when tapping the same value', () => {
    assert.equal(nextVoteValue(null, 1), 1)
    assert.equal(nextVoteValue(1, 1), null)
    assert.equal(nextVoteValue(1, -1), -1)
    assert.equal(nextVoteValue(-1, -1), null)
  })
})

describe('formatSongScoreLine', () => {
  it('shows pluses / minuses · total score', () => {
    assert.equal(formatSongScoreLine(3, 1, 2), '+3 / −1 · 2')
    assert.equal(formatSongScoreLine(1, 2, -1), '+1 / −2 · −1')
    assert.equal(formatSongScoreLine(0, 0, 0), '+0 / −0 · 0')
  })
})
