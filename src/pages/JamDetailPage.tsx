import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getJamDetail,
  hasSubmittedFeedback,
  runMatching,
  submitFeedback,
} from '@/api/jams'
import { useAuth } from '@/auth/AuthContext'
import { Loading } from '@/components/Loading'
import { useLocale } from '@/i18n/LocaleContext'
import { telegramAppName, telegramBotUsername } from '@/lib/config'
import { buildJamTelegramLink } from '@/lib/telegramDeepLink'
import { copyTextToClipboard, shareJamLink } from '@/lib/telegramShare'

function isNoAccessError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string }
  if (e.code === 'PGRST116') return true
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('0 rows') ||
    msg.includes('not found') ||
    msg.includes('row-level security') ||
    msg.includes('permission denied')
  )
}

export function JamDetailPage() {
  const { jamId } = useParams<{ jamId: string }>()
  const { session } = useAuth()
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noAccess, setNoAccess] = useState(false)
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof getJamDetail>
  > | null>(null)
  const [feedbackDone, setFeedbackDone] = useState(false)
  const [rating, setRating] = useState(4)
  const [showedUp, setShowedUp] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!jamId || !session) return
    let cancelled = false
    ;(async () => {
      try {
        await runMatching(jamId)
        const d = await getJamDetail(jamId)
        const done = await hasSubmittedFeedback(jamId, session.user.id)
        if (!cancelled) {
          setDetail(d)
          setFeedbackDone(done)
          setNoAccess(false)
        }
      } catch (err) {
        if (!cancelled) {
          if (isNoAccessError(err)) {
            setNoAccess(true)
            setError(null)
          } else {
            setError(err instanceof Error ? err.message : t.common.error)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [jamId, session, t.common.error])

  async function onFeedback() {
    if (!jamId) return
    setSubmitting(true)
    setError(null)
    try {
      await submitFeedback({
        jam_id: jamId,
        rating,
        everyone_showed_up: showedUp,
      })
      setFeedbackDone(true)
      const d = await getJamDetail(jamId)
      setDetail(d)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setSubmitting(false)
    }
  }

  function jamShareUrl(): string | null {
    if (!jamId || !telegramBotUsername) return null
    try {
      return buildJamTelegramLink(jamId, {
        botUsername: telegramBotUsername,
        appName: telegramAppName,
      })
    } catch {
      return null
    }
  }

  async function onShare() {
    const url = jamShareUrl()
    if (!url) {
      setError(t.jam.shareUnavailable)
      return
    }
    setShareBusy(true)
    setError(null)
    try {
      await shareJamLink({ url, text: t.jam.shareText })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : t.common.error)
    } finally {
      setShareBusy(false)
    }
  }

  async function onCopyLink() {
    const url = jamShareUrl()
    if (!url) {
      setError(t.jam.shareUnavailable)
      return
    }
    const ok = await copyTextToClipboard(url)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      setError(t.common.error)
    }
  }

  if (loading) return <Loading />
  if (!detail) {
    return (
      <div>
        <Link to="/" className="text-sm text-mute">
          ← {t.common.back}
        </Link>
        {noAccess ? (
          <div className="mt-6 space-y-2">
            <h1 className="font-display text-xl">{t.jam.noAccessTitle}</h1>
            <p className="text-sm text-mute">{t.jam.noAccessBody}</p>
          </div>
        ) : (
          <p className="mt-4 text-danger">{error ?? t.common.error}</p>
        )}
      </div>
    )
  }

  const { jam, seats, members } = detail
  const isMember = members.some((m) => m.profile.id === session?.user.id)
  const canFeedback =
    isMember &&
    (jam.status === 'confirmed' || jam.status === 'completed') &&
    !feedbackDone &&
    new Date(jam.window_end).getTime() < Date.now()
  const canShare = Boolean(telegramBotUsername)

  return (
    <div className="space-y-5 pb-6">
      <Link to="/" className="text-sm text-mute">
        ← {t.common.back}
      </Link>

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
          {t.jam.place}: {jam.area}
          {jam.base_name ? ` · ${jam.base_name}` : ''}
        </p>
      </div>

      {canShare && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={shareBusy}
            onClick={onShare}
            className="rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {t.jam.shareTelegram}
          </button>
          <button
            type="button"
            onClick={onCopyLink}
            className="rounded-xl border border-line px-4 py-2.5 text-sm text-cream"
          >
            {copied ? t.jam.linkCopied : t.jam.copyLink}
          </button>
        </div>
      )}

      <section className="rounded-2xl border border-line bg-panel/90 p-4">
        <h2 className="text-sm text-mute">{t.home.seats}</h2>
        <ul className="mt-3 space-y-3">
          {seats.map((seat) => {
            const member = members.find((m) => m.seat_id === seat.id)
            return (
              <li
                key={seat.id}
                className="flex items-center justify-between gap-2 border-b border-line/60 pb-2 last:border-0"
              >
                <div>
                  <p className="font-medium">
                    {t.instruments[seat.role]}
                    {seat.is_creator ? (
                      <span className="text-mute"> ({t.common.me})</span>
                    ) : null}
                  </p>
                  {member ? (
                    <p className="text-sm text-cream">
                      {member.profile.display_name}
                      {member.profile.telegram_handle
                        ? ` · @${member.profile.telegram_handle}`
                        : ''}
                    </p>
                  ) : (
                    <p className="text-sm text-amber">
                      {seat.status === 'invited'
                        ? t.home.matching
                        : t.home.openSeats}
                    </p>
                  )}
                </div>
                {member?.profile.demo_url && (
                  <a
                    href={member.profile.demo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-teal"
                  >
                    demo
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {jam.status === 'confirmed' && (
        <section className="rounded-2xl border border-ok/30 bg-ok/10 p-4 text-sm">
          <p className="font-medium text-ok">{t.jam.confirmedTitle}</p>
          <p className="mt-2 text-mute">{t.jam.contacts}</p>
          <ul className="mt-2 space-y-1">
            {members.map((m) => (
              <li key={m.seat_id}>
                {m.profile.display_name}
                {m.profile.telegram_handle
                  ? ` — @${m.profile.telegram_handle}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canFeedback && (
        <section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
          <h2 className="font-display text-lg">{t.jam.feedback}</h2>
          <label className="block text-sm text-mute">
            {t.jam.howWasIt} ({rating}/5)
            <input
              type="range"
              min={1}
              max={5}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <div>
            <p className="text-sm text-mute">{t.jam.showedUp}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setShowedUp(true)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  showedUp ? 'bg-teal text-ink' : 'border border-line text-mute'
                }`}
              >
                {t.jam.yes}
              </button>
              <button
                type="button"
                onClick={() => setShowedUp(false)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  !showedUp ? 'bg-danger text-ink' : 'border border-line text-mute'
                }`}
              >
                {t.jam.no}
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onFeedback}
            className="w-full rounded-xl bg-amber px-4 py-3 font-semibold text-ink disabled:opacity-60"
          >
            {t.jam.submitFeedback}
          </button>
        </section>
      )}

      {feedbackDone && (
        <p className="text-sm text-teal">{t.jam.feedbackDone}</p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
