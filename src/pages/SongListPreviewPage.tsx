/**
 * Dev-only fixture screen for screenshots / visual checks of SongListSection.
 * Route: #/dev/song-list-preview
 */
import { useMemo, useState } from 'react'
import { SongListSection } from '@/components/SongListSection'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import {
  buildSongList,
  type SongRow,
  type SongVoteRow,
  type VoteValue,
} from '@/lib/songList'

const USER = 'user-me'

const initialSongs: SongRow[] = [
  {
    id: 's1',
    jam_id: 'jam-1',
    added_by: USER,
    title: 'Seven Nation Army',
    artist: 'The White Stripes',
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
  },
  {
    id: 's2',
    jam_id: 'jam-1',
    added_by: 'user-other',
    title: 'Karma Police',
    artist: 'Radiohead',
    created_at: '2026-11-01T10:01:00Z',
    updated_at: '2026-11-01T10:01:00Z',
  },
  {
    id: 's3',
    jam_id: 'jam-1',
    added_by: 'user-other',
    title: 'Wonderwall',
    artist: 'Oasis',
    created_at: '2026-11-01T10:02:00Z',
    updated_at: '2026-11-01T10:02:00Z',
  },
]

const initialVotes: SongVoteRow[] = [
  {
    id: 'v1',
    song_id: 's1',
    user_id: USER,
    value: 1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v2',
    song_id: 's1',
    user_id: 'u2',
    value: 1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v3',
    song_id: 's1',
    user_id: 'u3',
    value: 1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v4',
    song_id: 's2',
    user_id: 'u2',
    value: 1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v5',
    song_id: 's2',
    user_id: 'u3',
    value: 1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v6',
    song_id: 's2',
    user_id: 'u4',
    value: -1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v7',
    song_id: 's3',
    user_id: 'u2',
    value: 1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v8',
    song_id: 's3',
    user_id: USER,
    value: -1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
  {
    id: 'v9',
    song_id: 's3',
    user_id: 'u4',
    value: -1,
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-01T11:00:00Z',
  },
]

function PreviewInner() {
  const { t, locale, setLocale } = useLocale()
  const [songs, setSongs] = useState(initialSongs)
  const [votes, setVotes] = useState(initialVotes)

  const items = useMemo(
    () => buildSongList(songs, votes, USER),
    [songs, votes],
  )

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-5 pb-10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-amber">
          {t.jam.confirmedTitle}
        </p>
        <div className="flex gap-1">
          {(['uk', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                locale === code
                  ? 'bg-amber text-ink'
                  : 'border border-line text-mute'
              }`}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h1 className="font-display text-2xl">{t.formats.cover_practice}</h1>
        <p className="mt-2 text-sm text-mute">
          {t.jam.time}: 15.11.2026, 19:00 – 21:00
        </p>
        <p className="text-sm text-mute">{t.jam.place}: Podil · База 12</p>
      </div>

      <SongListSection
        userId={USER}
        items={items}
        songs={songs}
        onAdd={async ({ title, artist }) => {
          setSongs((prev) => [
            ...prev,
            {
              id: `s-${crypto.randomUUID()}`,
              jam_id: 'jam-1',
              added_by: USER,
              title: title.trim(),
              artist: artist.trim() || null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ])
        }}
        onUpdate={async ({ id, title, artist }) => {
          setSongs((prev) =>
            prev.map((s) =>
              s.id === id
                ? {
                    ...s,
                    title: title.trim(),
                    artist: artist.trim() || null,
                    updated_at: new Date().toISOString(),
                  }
                : s,
            ),
          )
        }}
        onDelete={async (songId) => {
          setSongs((prev) => prev.filter((s) => s.id !== songId))
          setVotes((prev) => prev.filter((v) => v.song_id !== songId))
        }}
        onVote={async (songId, value: VoteValue | null) => {
          setVotes((prev) => {
            const without = prev.filter(
              (v) => !(v.song_id === songId && v.user_id === USER),
            )
            if (value === null) return without
            return [
              ...without,
              {
                id: `v-${crypto.randomUUID()}`,
                song_id: songId,
                user_id: USER,
                value,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ]
          })
        }}
      />
    </div>
  )
}

export function SongListPreviewPage() {
  return (
    <LocaleProvider>
      <PreviewInner />
    </LocaleProvider>
  )
}
