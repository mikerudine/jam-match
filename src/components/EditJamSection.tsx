import { useMemo, useState, type FormEvent } from 'react'
import { updateJam, type UpdateJamInput } from '@/api/jams'
import { ChipSelect } from '@/components/ChipSelect'
import { useLocale } from '@/i18n/LocaleContext'
import {
  AREA_OPTIONS,
  GENRE_OPTIONS,
  INSTRUMENTS,
  JAM_FORMATS,
  type Instrument,
  type JamFormat,
  type JamRequest,
  type JamSeat,
} from '@/types'

function toLocalDate(iso: string) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toLocalTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export interface EditJamSectionProps {
  jam: JamRequest
  seats: JamSeat[]
  onUpdated: () => void | Promise<void>
  /** Override RPC save (preview / tests). Defaults to updateJam. */
  saveFn?: (input: UpdateJamInput) => Promise<void>
}

/** Isolated edit UI for the jam initiator — keep JamDetailPage merge-friendly. */
export function EditJamSection({
  jam,
  seats,
  onUpdated,
  saveFn,
}: EditJamSectionProps) {
  const { t } = useLocale()
  const canEdit =
    jam.status === 'matching' && new Date(jam.window_end).getTime() > Date.now()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const creatorSeat = useMemo(
    () => seats.find((s) => s.is_creator) ?? null,
    [seats],
  )
  const editableSeats = useMemo(
    () => seats.filter((s) => !s.is_creator),
    [seats],
  )

  const [format, setFormat] = useState<JamFormat>(jam.format)
  const [genres, setGenres] = useState<string[]>(jam.genres)
  const [creatorRole, setCreatorRole] = useState<Instrument>(
    creatorSeat?.role ?? 'guitar',
  )
  const [keptSeatIds, setKeptSeatIds] = useState<string[]>(
    editableSeats.map((s) => s.id),
  )
  const [addRoles, setAddRoles] = useState<Instrument[]>([])
  const [date, setDate] = useState(toLocalDate(jam.window_start))
  const [start, setStart] = useState(toLocalTime(jam.window_start))
  const [end, setEnd] = useState(toLocalTime(jam.window_end))
  const [area, setArea] = useState(jam.area)
  const [baseName, setBaseName] = useState(jam.base_name ?? '')
  const [ttl, setTtl] = useState(jam.invite_ttl_hours)

  if (!canEdit || !creatorSeat) return null

  function resetFromJam() {
    setFormat(jam.format)
    setGenres(jam.genres)
    setCreatorRole(creatorSeat!.role)
    setKeptSeatIds(editableSeats.map((s) => s.id))
    setAddRoles([])
    setDate(toLocalDate(jam.window_start))
    setStart(toLocalTime(jam.window_start))
    setEnd(toLocalTime(jam.window_end))
    setArea(jam.area)
    setBaseName(jam.base_name ?? '')
    setTtl(jam.invite_ttl_hours)
    setError(null)
  }

  function openEditor() {
    resetFromJam()
    setOpen(true)
  }

  function removeSeat(seat: JamSeat) {
    if (seat.status === 'filled' || seat.filled_by) {
      setError(t.jam.cannotRemoveFilled)
      return
    }
    setKeptSeatIds((ids) => ids.filter((id) => id !== seat.id))
    setError(null)
  }

  function restoreSeat(seatId: string) {
    setKeptSeatIds((ids) => (ids.includes(seatId) ? ids : [...ids, seatId]))
  }

  function addSeat(role: Instrument) {
    setAddRoles((roles) => [...roles, role])
  }

  function removeAdded(index: number) {
    setAddRoles((roles) => roles.filter((_, i) => i !== index))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const window_start = new Date(`${date}T${start}:00`).toISOString()
      const window_end = new Date(`${date}T${end}:00`).toISOString()
      const payload: UpdateJamInput = {
        jam_id: jam.id,
        format,
        genres,
        area,
        base_name: baseName.trim() || undefined,
        window_start,
        window_end,
        invite_ttl_hours: ttl,
        creator_role: creatorRole,
        keep_seat_ids: [creatorSeat!.id, ...keptSeatIds],
        add_roles: addRoles,
      }
      await (saveFn ?? updateJam)(payload)
      setOpen(false)
      await onUpdated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.common.error
      if (/accepted participant|cannot remove a seat with an accepted/i.test(msg)) {
        setError(t.jam.cannotRemoveFilled)
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const keptCount = keptSeatIds.length + addRoles.length

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={openEditor}
          className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-cream hover:border-amber/50 hover:text-amber"
        >
          {t.jam.edit}
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-amber/30 bg-panel/90 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg">{t.jam.editTitle}</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          className="text-sm text-mute hover:text-cream"
        >
          {t.common.cancel}
        </button>
      </div>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.format}</p>
        <ChipSelect
          multiple={false}
          options={JAM_FORMATS.map((f) => ({ value: f, label: t.formats[f] }))}
          value={[format]}
          onChange={(v) => setFormat((v[0] as JamFormat) || 'free_jam')}
        />
      </section>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.genres}</p>
        <ChipSelect
          options={GENRE_OPTIONS.map((g) => ({ value: g, label: g }))}
          value={genres}
          onChange={setGenres}
        />
      </section>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.lineup}</p>
        <div className="rounded-xl border border-line bg-ink/40 p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>
              {t.instruments[creatorRole]}{' '}
              <span className="text-mute">({t.common.me})</span>
            </span>
            <select
              value={creatorRole}
              onChange={(e) => setCreatorRole(e.target.value as Instrument)}
              className="rounded-lg border border-line bg-ink px-2 py-1 text-cream"
            >
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {t.instruments[i]}
                </option>
              ))}
            </select>
          </div>

          {editableSeats.map((seat) => {
            const kept = keptSeatIds.includes(seat.id)
            const filled = seat.status === 'filled' || Boolean(seat.filled_by)
            return (
              <div
                key={seat.id}
                className="mb-2 flex items-center justify-between gap-2 text-sm"
              >
                <span className={kept ? '' : 'text-mute line-through'}>
                  {t.instruments[seat.role]}
                  {filled ? (
                    <span className="text-mute"> · {t.jam.seatFilled}</span>
                  ) : null}
                </span>
                {kept ? (
                  <button
                    type="button"
                    onClick={() => removeSeat(seat)}
                    className="text-xs text-danger"
                  >
                    {t.jam.removeSeat}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => restoreSeat(seat.id)}
                    className="text-xs text-teal"
                  >
                    {t.jam.restoreSeat}
                  </button>
                )}
              </div>
            )
          })}

          {addRoles.map((role, idx) => (
            <div
              key={`new-${role}-${idx}`}
              className="mb-2 flex items-center justify-between text-sm"
            >
              <span>
                {t.instruments[role]}{' '}
                <span className="text-mute">({t.jam.newSeat})</span>
              </span>
              <button
                type="button"
                onClick={() => removeAdded(idx)}
                className="text-xs text-danger"
              >
                {t.jam.removeSeat}
              </button>
            </div>
          ))}

          <div className="mt-2 flex flex-wrap gap-2">
            {INSTRUMENTS.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => addSeat(role)}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-mute hover:text-cream"
              >
                + {t.instruments[role]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <label className="text-sm text-mute">
          {t.jam.date}
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-ink px-2 py-2 text-cream"
          />
        </label>
        <label className="text-sm text-mute">
          {t.jam.start}
          <input
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-ink px-2 py-2 text-cream"
          />
        </label>
        <label className="text-sm text-mute">
          {t.jam.end}
          <input
            type="time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-ink px-2 py-2 text-cream"
          />
        </label>
      </div>

      <section className="space-y-2">
        <p className="text-sm text-mute">{t.jam.area}</p>
        <ChipSelect
          multiple={false}
          options={AREA_OPTIONS.map((a) => ({ value: a, label: a }))}
          value={[area]}
          onChange={(v) => setArea(v[0] || jam.area)}
        />
      </section>

      <label className="block text-sm text-mute">
        {t.jam.base}
        <input
          value={baseName}
          onChange={(e) => setBaseName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-cream"
          placeholder="Rehearsal Point / Aza / …"
        />
      </label>

      <label className="block text-sm text-mute">
        {t.jam.ttl}
        <input
          type="number"
          min={1}
          max={48}
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value) || 3)}
          className="mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-cream"
        />
      </label>

      <button
        type="submit"
        disabled={busy || keptCount === 0 || genres.length === 0}
        className="w-full rounded-xl bg-amber px-4 py-3 font-semibold text-ink hover:bg-amber-deep disabled:opacity-60"
      >
        {busy ? t.common.loading : t.jam.save}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  )
}
