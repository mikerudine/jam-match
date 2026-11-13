/**
 * Dev-only fixture screen for screenshots / visual checks of EditJamSection.
 * Route: #/dev/edit-jam-preview
 */
import { useState } from 'react'
import { type UpdateJamInput } from '@/api/jams'
import { EditJamSection } from '@/components/EditJamSection'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import type { JamRequest, JamSeat } from '@/types'

const CREATOR = 'user-creator'
const OTHER = 'user-other'

const initialJam: JamRequest = {
  id: 'jam-edit-preview',
  creator_id: CREATOR,
  format: 'free_jam',
  genres: ['rock', 'indie'],
  area: 'Podil',
  base_name: 'База 12',
  window_start: '2026-11-20T17:00:00.000Z',
  window_end: '2026-11-20T19:00:00.000Z',
  status: 'matching',
  invite_ttl_hours: 3,
  created_at: '2026-11-13T10:00:00.000Z',
}

const initialSeats: JamSeat[] = [
  {
    id: 'seat-creator',
    jam_id: initialJam.id,
    role: 'guitar',
    filled_by: CREATOR,
    is_creator: true,
    status: 'filled',
    sort_order: 0,
  },
  {
    id: 'seat-drums',
    jam_id: initialJam.id,
    role: 'drums',
    filled_by: OTHER,
    is_creator: false,
    status: 'filled',
    sort_order: 1,
  },
  {
    id: 'seat-bass',
    jam_id: initialJam.id,
    role: 'bass',
    filled_by: null,
    is_creator: false,
    status: 'invited',
    sort_order: 2,
  },
  {
    id: 'seat-keys',
    jam_id: initialJam.id,
    role: 'keys',
    filled_by: null,
    is_creator: false,
    status: 'open',
    sort_order: 3,
  },
]

function PreviewInner() {
  const { t, locale, setLocale } = useLocale()
  const [jam, setJam] = useState(initialJam)
  const [seats, setSeats] = useState(initialSeats)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  async function saveFn(input: UpdateJamInput) {
    setJam((prev) => ({
      ...prev,
      format: input.format,
      genres: input.genres,
      area: input.area,
      base_name: input.base_name ?? null,
      window_start: input.window_start,
      window_end: input.window_end,
      invite_ttl_hours: input.invite_ttl_hours,
    }))

    const kept = new Set(input.keep_seat_ids)
    const nextSeats: JamSeat[] = seats
      .filter((s) => kept.has(s.id))
      .map((s) =>
        s.is_creator ? { ...s, role: input.creator_role } : s,
      )

    let order = Math.max(0, ...nextSeats.map((s) => s.sort_order))
    for (const role of input.add_roles) {
      order += 1
      nextSeats.push({
        id: `seat-new-${crypto.randomUUID()}`,
        jam_id: jam.id,
        role,
        filled_by: null,
        is_creator: false,
        status: 'open',
        sort_order: order,
      })
    }
    setSeats(nextSeats)
    setSavedNote('ok')
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-5 pb-10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-amber">
          {t.formats[jam.format]}
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
        <h1 className="font-display text-2xl">{t.formats[jam.format]}</h1>
        <p className="mt-2 text-sm text-mute">
          {t.jam.time}: {new Date(jam.window_start).toLocaleString()} –{' '}
          {new Date(jam.window_end).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        <p className="text-sm text-mute">
          {t.jam.place}: {jam.area}
          {jam.base_name ? ` · ${jam.base_name}` : ''}
        </p>
      </div>

      <EditJamSection
        jam={jam}
        seats={seats}
        saveFn={saveFn}
        onUpdated={async () => {
          /* state already updated in saveFn */
        }}
      />

      <section className="rounded-2xl border border-line bg-panel/90 p-4">
        <h2 className="text-sm text-mute">{t.home.seats}</h2>
        <ul className="mt-3 space-y-2">
          {seats.map((seat) => (
            <li key={seat.id} className="text-sm">
              {t.instruments[seat.role]}
              {seat.is_creator ? (
                <span className="text-mute"> ({t.common.me})</span>
              ) : null}
              {seat.status === 'filled' && !seat.is_creator ? (
                <span className="text-mute"> · {t.jam.seatFilled}</span>
              ) : null}
              {seat.status === 'open' ? (
                <span className="text-amber"> · {t.home.openSeats}</span>
              ) : null}
              {seat.status === 'invited' ? (
                <span className="text-amber"> · {t.home.matching}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {savedNote ? (
        <p className="text-sm text-teal" data-testid="edit-saved">
          {t.profile.saved}
        </p>
      ) : null}
    </div>
  )
}

export function EditJamPreviewPage() {
  return (
    <LocaleProvider>
      <PreviewInner />
    </LocaleProvider>
  )
}
