/**
 * Dev-only fixture: public preview + join for a confirmed jam.
 * Route: #/dev/public-jam-preview
 */
import { useState } from 'react'
import { JoinRequestForm } from '@/components/JoinRequestForm'
import { PublicJamView } from '@/components/PublicJamView'
import { LocaleProvider, useLocale } from '@/i18n/LocaleContext'
import type { JamJoinRequest, PublicJam } from '@/types'

const publicJam: PublicJam = {
  id: 'jam-public-preview',
  format: 'cover_practice',
  genres: ['rock', 'indie'],
  area: 'Podil',
  window_start: '2026-11-22T17:00:00.000Z',
  window_end: '2026-11-22T19:00:00.000Z',
  status: 'confirmed',
  initiator_display_name: 'Misha',
  seats: [
    {
      role: 'guitar',
      role_label: null,
      is_creator: true,
      filled: true,
    },
    {
      role: 'drums',
      role_label: null,
      is_creator: false,
      filled: true,
    },
    {
      role: 'bass',
      role_label: null,
      is_creator: false,
      filled: true,
    },
  ],
  filled_count: 3,
  open_count: 0,
}

function PreviewInner() {
  const { t, locale, setLocale } = useLocale()
  const [myJoin, setMyJoin] = useState<JamJoinRequest | null>(null)

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-5 pb-10">
      <div className="flex justify-end gap-1">
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

      <PublicJamView jam={publicJam} />

      <JoinRequestForm
        jam={{
          id: publicJam.id,
          status: publicJam.status,
          window_end: publicJam.window_end,
        }}
        existing={myJoin}
        submitFn={async ({ role, note }) => {
          const id = `jr-${crypto.randomUUID()}`
          setMyJoin({
            id,
            jam_id: publicJam.id,
            requester_id: 'me',
            role,
            note: note ?? null,
            status: 'pending',
            seat_id: null,
            created_at: new Date().toISOString(),
            responded_at: null,
          })
          return id
        }}
        onSubmitted={async () => {}}
      />

      <p className="text-xs text-mute" data-testid="public-hint">
        {t.jam.publicPreviewHint}
      </p>
    </div>
  )
}

export function PublicJamPreviewPage() {
  return (
    <LocaleProvider>
      <PreviewInner />
    </LocaleProvider>
  )
}
