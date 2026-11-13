import { useLocale } from '@/i18n/LocaleContext'
import { seatRoleLabel } from '@/lib/utils'
import type { PublicJam } from '@/types'

export interface PublicJamViewProps {
  jam: PublicJam
}

/**
 * Non-participant preview: format, time, area, genres, seat roles/counts,
 * initiator name — never base_name, contacts, or member profiles.
 */
export function PublicJamView({ jam }: PublicJamViewProps) {
  const { t } = useLocale()

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-amber">
          {jam.status === 'confirmed'
            ? t.jam.confirmedTitle
            : t.formats[jam.format]}
        </p>
        <h1 className="font-display mt-1 text-2xl">{t.formats[jam.format]}</h1>
        <p className="mt-2 text-sm text-mute">
          {t.jam.time}: {new Date(jam.window_start).toLocaleString()} –{' '}
          {new Date(jam.window_end).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        <p className="text-sm text-mute">
          {t.jam.area}: {jam.area}
        </p>
        {jam.initiator_display_name ? (
          <p className="text-sm text-mute">
            {t.jam.organizedBy}: {jam.initiator_display_name}
          </p>
        ) : null}
        {jam.genres?.length ? (
          <p className="mt-1 text-sm text-mute">
            {t.jam.genres}: {jam.genres.join(' · ')}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-mute">{t.jam.publicPreviewHint}</p>
      </div>

      <section className="rounded-2xl border border-line bg-panel/90 p-4">
        <h2 className="text-sm text-mute">{t.home.seats}</h2>
        <p className="mt-1 text-xs text-mute">
          {t.jam.seatCounts
            .replace('{filled}', String(jam.filled_count))
            .replace('{open}', String(jam.open_count))}
        </p>
        <ul className="mt-3 space-y-2">
          {jam.seats.map((seat, idx) => (
            <li
              key={`${seat.role}-${idx}`}
              className="flex items-center justify-between text-sm"
            >
              <span>
                {seatRoleLabel(seat, t.instruments)}
                {seat.is_creator ? (
                  <span className="text-mute"> ({t.jam.organizer})</span>
                ) : null}
              </span>
              <span className={seat.filled ? 'text-mute' : 'text-amber'}>
                {seat.filled ? t.jam.seatFilled : t.home.openSeats}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
