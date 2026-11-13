import { useState, type FormEvent } from 'react'
import {
  MAX_SONGS_PER_USER,
  canAddSong,
  formatSongScoreLine,
  nextVoteValue,
  type SongListItem,
  type SongRow,
  type VoteValue,
} from '@/lib/songList'
import { cn } from '@/lib/utils'
import { useLocale } from '@/i18n/LocaleContext'

export interface SongListSectionProps {
  userId: string
  items: SongListItem[]
  songs: SongRow[]
  busy?: boolean
  onAdd: (input: { title: string; artist: string }) => Promise<void>
  onUpdate: (input: {
    id: string
    title: string
    artist: string
  }) => Promise<void>
  onDelete: (songId: string) => Promise<void>
  onVote: (songId: string, value: VoteValue | null) => Promise<void>
}

export function SongListSection({
  userId,
  items,
  songs,
  busy = false,
  onAdd,
  onUpdate,
  onDelete,
  onVote,
}: SongListSectionProps) {
  const { t } = useLocale()
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editArtist, setEditArtist] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const ownCount = songs.filter((s) => s.added_by === userId).length
  const slotsLeft = canAddSong(songs, userId)

  async function run(action: () => Promise<void>) {
    setLocalError(null)
    setPending(true)
    try {
      await action()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setPending(false)
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !slotsLeft) return
    await run(async () => {
      await onAdd({ title, artist })
      setTitle('')
      setArtist('')
    })
  }

  function startEdit(item: SongListItem) {
    setEditingId(item.song.id)
    setEditTitle(item.song.title)
    setEditArtist(item.song.artist ?? '')
    setLocalError(null)
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId || !editTitle.trim()) return
    await run(async () => {
      await onUpdate({ id: editingId, title: editTitle, artist: editArtist })
      setEditingId(null)
    })
  }

  async function handleVote(item: SongListItem, tapped: VoteValue) {
    const next = nextVoteValue(item.myVote, tapped)
    await run(() => onVote(item.song.id, next))
  }

  const disabled = busy || pending

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel/90 p-4 anim-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">{t.songs.title}</h2>
          <p className="mt-1 text-sm text-mute">{t.songs.hint}</p>
        </div>
        <p
          className={cn(
            'shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs tabular-nums',
            ownCount >= MAX_SONGS_PER_USER ? 'text-amber' : 'text-mute',
          )}
          aria-label={t.songs.slotsUsed
            .replace('{used}', String(ownCount))
            .replace('{max}', String(MAX_SONGS_PER_USER))}
        >
          {ownCount}/{MAX_SONGS_PER_USER}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-mute">{t.songs.empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const mine = item.song.added_by === userId
            const editing = editingId === item.song.id

            return (
              <li
                key={item.song.id}
                className={cn(
                  'rounded-xl border px-3 py-2.5 transition-colors',
                  item.hasVeto
                    ? 'border-danger/50 bg-danger/10'
                    : 'border-line/70 bg-panel-2/60',
                )}
              >
                {editing ? (
                  <form onSubmit={saveEdit} className="space-y-2">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={200}
                      required
                      className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm"
                      placeholder={t.songs.titlePlaceholder}
                      disabled={disabled}
                    />
                    <input
                      value={editArtist}
                      onChange={(e) => setEditArtist(e.target.value)}
                      maxLength={200}
                      className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm"
                      placeholder={t.songs.artistPlaceholder}
                      disabled={disabled}
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={disabled || !editTitle.trim()}
                        className="rounded-lg bg-amber px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
                      >
                        {t.songs.save}
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-line px-3 py-1.5 text-sm text-mute"
                      >
                        {t.songs.cancel}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">{item.song.title}</p>
                      {item.song.artist ? (
                        <p className="mt-0.5 text-sm text-mute">
                          {item.song.artist}
                        </p>
                      ) : null}
                      <p
                        className={cn(
                          'mt-1.5 text-xs tabular-nums',
                          item.hasVeto ? 'font-medium text-danger' : 'text-mute',
                        )}
                        aria-label={t.songs.score}
                      >
                        {formatSongScoreLine(item.plus, item.minus, item.score)}
                        {item.hasVeto ? ` · ${t.songs.veto}` : ''}
                      </p>
                      {mine ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => startEdit(item)}
                            className="text-xs text-teal"
                          >
                            {t.songs.edit}
                          </button>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => run(() => onDelete(item.song.id))}
                            className="text-xs text-danger"
                          >
                            {t.songs.delete}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={item.myVote === 1}
                        aria-label={t.songs.voteUp}
                        onClick={() => handleVote(item, 1)}
                        className={cn(
                          'h-9 w-9 rounded-lg border text-sm font-semibold transition-colors',
                          item.myVote === 1
                            ? 'border-teal bg-teal text-ink'
                            : 'border-line text-mute hover:border-teal/60',
                        )}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={item.myVote === -1}
                        aria-label={t.songs.voteDown}
                        onClick={() => handleVote(item, -1)}
                        className={cn(
                          'h-9 w-9 rounded-lg border text-sm font-semibold transition-colors',
                          item.myVote === -1
                            ? 'border-danger bg-danger text-ink'
                            : 'border-line text-mute hover:border-danger/60',
                        )}
                      >
                        −
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {slotsLeft ? (
        <form onSubmit={handleAdd} className="space-y-2 border-t border-line/60 pt-3">
          <p className="text-sm text-mute">{t.songs.add}</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2.5 text-sm"
            placeholder={t.songs.titlePlaceholder}
            disabled={disabled}
          />
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2.5 text-sm"
            placeholder={t.songs.artistPlaceholder}
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={disabled || !title.trim()}
            className="w-full rounded-xl bg-amber px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {t.songs.addButton}
          </button>
        </form>
      ) : (
        <p className="border-t border-line/60 pt-3 text-sm text-amber">
          {t.songs.limitReached}
        </p>
      )}

      {localError ? <p className="text-sm text-danger">{localError}</p> : null}
    </section>
  )
}
