import { useState, type FormEvent } from 'react'
import { requestToJoin } from '@/api/jams'
import { useLocale } from '@/i18n/LocaleContext'
import { INSTRUMENTS, type JamJoinRequest, type JamRequest } from '@/types'

export interface JoinRequestFormProps {
  jam: JamRequest
  existing: JamJoinRequest | null
  onSubmitted: () => void | Promise<void>
  /** Override RPC (preview / tests). */
  submitFn?: (input: {
    jam_id: string
    role: string
    note?: string
  }) => Promise<string>
}

/** Isolated join-request form for non-initiator musicians on an open jam. */
export function JoinRequestForm({
  jam,
  existing,
  onSubmitted,
  submitFn,
}: JoinRequestFormProps) {
  const { t } = useLocale()
  const open =
    jam.status === 'matching' && new Date(jam.window_end).getTime() > Date.now()

  const [role, setRole] = useState('')
  const [custom, setCustom] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  if (existing?.status === 'pending') {
    return (
      <section className="rounded-2xl border border-amber/30 bg-amber/10 p-4 text-sm">
        <p className="font-medium text-amber">{t.jam.joinPending}</p>
        <p className="mt-1 text-mute">
          {t.jam.joinRole}: {existing.role}
          {existing.note ? ` · ${existing.note}` : ''}
        </p>
      </section>
    )
  }

  if (existing?.status === 'accepted') {
    return (
      <section className="rounded-2xl border border-ok/30 bg-ok/10 p-4 text-sm">
        <p className="font-medium text-ok">{t.jam.joinAccepted}</p>
      </section>
    )
  }

  if (existing?.status === 'declined') {
    // Allow a new request after decline — show banner + form below.
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = role.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await (submitFn ?? requestToJoin)({
        jam_id: jam.id,
        role: trimmed,
        note: note.trim() || undefined,
      })
      setRole('')
      setNote('')
      setCustom(false)
      await onSubmitted()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-2xl border border-line bg-panel/90 p-4"
    >
      <div>
        <h2 className="font-display text-lg">{t.jam.joinTitle}</h2>
        <p className="mt-1 text-xs text-mute">{t.jam.joinRoleHint}</p>
      </div>

      {existing?.status === 'declined' ? (
        <p className="text-sm text-danger">{t.jam.joinDeclined}</p>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm text-mute">{t.jam.joinRole}</p>
        <div className="flex flex-wrap gap-2">
          {INSTRUMENTS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setCustom(false)
                setRole(i)
              }}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                !custom && role === i
                  ? 'border-amber/40 bg-amber/20 text-amber'
                  : 'border-line text-mute hover:text-cream'
              }`}
            >
              {t.instruments[i]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCustom(true)
              setRole('')
            }}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              custom
                ? 'border-amber/40 bg-amber/20 text-amber'
                : 'border-line text-mute hover:text-cream'
            }`}
          >
            {t.jam.joinRoleCustom}
          </button>
        </div>
        {custom ? (
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            maxLength={64}
            required
            placeholder="maracas / маракаси / …"
            className="mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-cream"
          />
        ) : null}
      </div>

      <label className="block text-sm text-mute">
        {t.jam.joinNote}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-cream"
        />
      </label>

      <button
        type="submit"
        disabled={busy || !role.trim()}
        className="w-full rounded-xl bg-teal px-4 py-3 font-semibold text-ink disabled:opacity-60"
      >
        {busy ? t.common.loading : t.jam.joinSend}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  )
}
