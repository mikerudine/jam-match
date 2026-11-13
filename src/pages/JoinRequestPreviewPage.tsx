/**
 * Dev-only fixture for join-request UI screenshots.
 * Route: #/dev/join-request-preview
 */
import { useState } from 'react'
import { JoinRequestForm } from '@/components/JoinRequestForm'
import { JoinRequestsPanel } from '@/components/JoinRequestsPanel'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import { seatRoleLabel } from '@/lib/utils'
import type { JamJoinRequest, JamRequest, JamSeat, Profile } from '@/types'

const CREATOR = 'user-creator'
const REQUESTER = 'user-req'

const jam: JamRequest = {
  id: 'jam-join-preview',
  creator_id: CREATOR,
  format: 'free_jam',
  genres: ['rock'],
  area: 'Podil',
  base_name: 'База 12',
  window_start: '2026-11-20T17:00:00.000Z',
  window_end: '2026-11-20T19:00:00.000Z',
  status: 'matching',
  invite_ttl_hours: 3,
  created_at: '2026-11-13T10:00:00.000Z',
}

const baseSeats: JamSeat[] = [
  {
    id: 'seat-creator',
    jam_id: jam.id,
    role: 'guitar',
    role_label: null,
    filled_by: CREATOR,
    is_creator: true,
    status: 'filled',
    sort_order: 0,
  },
  {
    id: 'seat-drums',
    jam_id: jam.id,
    role: 'drums',
    role_label: null,
    filled_by: null,
    is_creator: false,
    status: 'open',
    sort_order: 1,
  },
]

type JoinRow = JamJoinRequest & {
  requester: Pick<
    Profile,
    'id' | 'display_name' | 'telegram_handle' | 'instruments'
  > | null
}

const pendingRow: JoinRow = {
  id: 'jr-1',
  jam_id: jam.id,
  requester_id: REQUESTER,
  role: 'maracas',
  note: 'I can bring shakers too',
  status: 'pending',
  seat_id: null,
  created_at: '2026-11-13T12:00:00.000Z',
  responded_at: null,
  requester: {
    id: REQUESTER,
    display_name: 'Olena',
    telegram_handle: 'olena_jam',
    instruments: ['other'],
  },
}

function PreviewInner() {
  const { t, locale, setLocale } = useLocale()
  const [view, setView] = useState<'organizer' | 'requester'>('organizer')
  const [seats, setSeats] = useState(baseSeats)
  const [rows, setRows] = useState<JoinRow[]>([pendingRow])
  const [myJoin, setMyJoin] = useState<JamJoinRequest | null>(null)

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

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="view-organizer"
          onClick={() => setView('organizer')}
          className={`rounded-full px-3 py-1.5 text-xs ${
            view === 'organizer'
              ? 'bg-teal text-ink'
              : 'border border-line text-mute'
          }`}
        >
          organizer
        </button>
        <button
          type="button"
          data-testid="view-requester"
          onClick={() => setView('requester')}
          className={`rounded-full px-3 py-1.5 text-xs ${
            view === 'requester'
              ? 'bg-teal text-ink'
              : 'border border-line text-mute'
          }`}
        >
          requester
        </button>
      </div>

      <div>
        <h1 className="font-display text-2xl">{t.formats[jam.format]}</h1>
        <p className="mt-2 text-sm text-mute">
          {t.jam.place}: {jam.area}
          {jam.base_name ? ` · ${jam.base_name}` : ''}
        </p>
      </div>

      {view === 'organizer' ? (
        <JoinRequestsPanel
          jam={jam}
          initialRows={rows}
          respondFn={async (id, accept) => {
            if (!accept) {
              setRows((prev) =>
                prev.map((r) =>
                  r.id === id
                    ? {
                        ...r,
                        status: 'declined',
                        responded_at: new Date().toISOString(),
                      }
                    : r,
                ),
              )
              return
            }
            const req = rows.find((r) => r.id === id)
            if (!req) return
            const seatId = `seat-${crypto.randomUUID()}`
            setSeats((prev) => [
              ...prev,
              {
                id: seatId,
                jam_id: jam.id,
                role: 'other',
                role_label: req.role,
                filled_by: req.requester_id,
                is_creator: false,
                status: 'filled',
                sort_order: prev.length,
              },
            ])
            setRows((prev) =>
              prev.map((r) =>
                r.id === id
                  ? {
                      ...r,
                      status: 'accepted',
                      seat_id: seatId,
                      responded_at: new Date().toISOString(),
                    }
                  : r,
              ),
            )
            setMyJoin({
              ...req,
              status: 'accepted',
              seat_id: seatId,
              responded_at: new Date().toISOString(),
            })
          }}
        />
      ) : (
        <JoinRequestForm
          jam={jam}
          existing={myJoin}
          submitFn={async ({ role, note }) => {
            const id = `jr-${crypto.randomUUID()}`
            const row: JoinRow = {
              id,
              jam_id: jam.id,
              requester_id: REQUESTER,
              role,
              note: note ?? null,
              status: 'pending',
              seat_id: null,
              created_at: new Date().toISOString(),
              responded_at: null,
              requester: {
                id: REQUESTER,
                display_name: 'You',
                telegram_handle: null,
                instruments: ['other'],
              },
            }
            setRows((prev) => [row, ...prev.filter((r) => r.status !== 'pending')])
            setMyJoin(row)
            return id
          }}
          onSubmitted={async () => {}}
        />
      )}

      <section className="rounded-2xl border border-line bg-panel/90 p-4">
        <h2 className="text-sm text-mute">{t.home.seats}</h2>
        <ul className="mt-3 space-y-2">
          {seats.map((seat) => (
            <li key={seat.id} className="text-sm">
              {seatRoleLabel(seat, t.instruments)}
              {seat.is_creator ? (
                <span className="text-mute"> ({t.common.me})</span>
              ) : null}
              {seat.status === 'filled' && !seat.is_creator ? (
                <span className="text-mute"> · {t.jam.seatFilled}</span>
              ) : null}
              {seat.status === 'open' ? (
                <span className="text-amber"> · {t.home.openSeats}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function JoinRequestPreviewPage() {
  return (
    <LocaleProvider>
      <PreviewInner />
    </LocaleProvider>
  )
}
