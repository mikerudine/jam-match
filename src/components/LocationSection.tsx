import { useEffect, useState, type FormEvent } from 'react'
import { listLocations } from '@/api/locations'
import { useLocale } from '@/i18n/LocaleContext'
import {
  MAX_LOCATIONS_PER_USER,
  canAddLocation,
  formatLocationScoreLine,
  formatPricePerHour,
  locationHref,
  nextVoteValue,
  type CreateLocationInput,
  type Location,
  type LocationListItem,
  type LocationProposalRow,
  type VoteValue,
} from '@/lib/locationList'
import { cn } from '@/lib/utils'

export interface LocationSectionProps {
  userId: string
  items: LocationListItem[]
  proposals: LocationProposalRow[]
  busy?: boolean
  onProposeExisting: (locationId: string) => Promise<void>
  onProposeNew: (draft: CreateLocationInput) => Promise<void>
  onUpdate: (input: {
    id: string
    name: string
    address: string
    url: string
    price_per_hour: number | null
    comment: string | null
  }) => Promise<void>
  onRemove: (proposalId: string) => Promise<void>
  onVote: (proposalId: string, value: VoteValue | null) => Promise<void>
}

type AddMode = 'catalog' | 'create'

const emptyDraft = {
  name: '',
  address: '',
  url: '',
  price: '',
  comment: '',
}

export function LocationSection({
  userId,
  items,
  proposals,
  busy = false,
  onProposeExisting,
  onProposeNew,
  onUpdate,
  onRemove,
  onVote,
}: LocationSectionProps) {
  const { t } = useLocale()
  const [addMode, setAddMode] = useState<AddMode>('catalog')
  const [draft, setDraft] = useState(emptyDraft)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalog, setCatalog] = useState<Location[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState(emptyDraft)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const ownCount = proposals.filter((p) => p.added_by === userId).length
  const slotsLeft = canAddLocation(proposals, userId)
  const proposedIds = new Set(proposals.map((p) => p.location_id))

  useEffect(() => {
    if (!slotsLeft || addMode !== 'catalog') return
    let cancelled = false
    setCatalogLoading(true)
    const handle = window.setTimeout(() => {
      listLocations(catalogQuery)
        .then((rows) => {
          if (!cancelled) setCatalog(rows)
        })
        .catch(() => {
          if (!cancelled) setCatalog([])
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [slotsLeft, addMode, catalogQuery])

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

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!slotsLeft) return
    await run(async () => {
      await onProposeNew({
        name: draft.name,
        address: draft.address,
        url: draft.url,
        price_per_hour: draft.price ? Number(draft.price.replace(',', '.')) : null,
        comment: draft.comment,
      })
      setDraft(emptyDraft)
    })
  }

  function startEdit(item: LocationListItem) {
    const loc = item.proposal.location
    setEditingId(loc.id)
    setEdit({
      name: loc.name,
      address: loc.address,
      url: loc.url,
      price: loc.price_per_hour != null ? String(loc.price_per_hour) : '',
      comment: loc.comment ?? '',
    })
    setLocalError(null)
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    await run(async () => {
      await onUpdate({
        id: editingId,
        name: edit.name,
        address: edit.address,
        url: edit.url,
        price_per_hour: edit.price
          ? Number(edit.price.replace(',', '.'))
          : null,
        comment: edit.comment || null,
      })
      setEditingId(null)
    })
  }

  async function handleVote(item: LocationListItem, tapped: VoteValue) {
    const next = nextVoteValue(item.myVote, tapped)
    await run(() => onVote(item.proposal.id, next))
  }

  const disabled = busy || pending

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel/90 p-4 anim-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">{t.locations.title}</h2>
          <p className="mt-1 text-sm text-mute">{t.locations.hint}</p>
        </div>
        <p
          className={cn(
            'shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs tabular-nums',
            ownCount >= MAX_LOCATIONS_PER_USER ? 'text-amber' : 'text-mute',
          )}
        >
          {ownCount}/{MAX_LOCATIONS_PER_USER}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-mute">{t.locations.empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const loc = item.proposal.location
            const mine = item.proposal.added_by === userId
            const canEditCatalog = loc.created_by === userId
            const editing = editingId === loc.id
            const priceLine = formatPricePerHour(
              loc.price_per_hour,
              t.locations.currencyHour,
            )

            return (
              <li
                key={item.proposal.id}
                className={cn(
                  'rounded-xl border px-3 py-2.5 transition-colors',
                  item.hasVeto
                    ? 'border-danger/50 bg-danger/10'
                    : item.isLeading
                      ? 'border-teal/40 bg-teal/10'
                      : 'border-line/70 bg-panel-2/60',
                )}
              >
                {editing ? (
                  <form onSubmit={saveEdit} className="space-y-2">
                    <LocationFields
                      value={edit}
                      onChange={setEdit}
                      disabled={disabled}
                      t={t.locations}
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={disabled}
                        className="rounded-lg bg-amber px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
                      >
                        {t.locations.save}
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-line px-3 py-1.5 text-sm text-mute"
                      >
                        {t.locations.cancel}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium leading-snug">{loc.name}</p>
                        {item.isLeading ? (
                          <span className="rounded-full bg-teal/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal">
                            {t.locations.leading}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-sm text-mute">{loc.address}</p>
                      <a
                        href={locationHref(loc.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block break-all text-sm text-teal underline-offset-2 hover:underline"
                      >
                        {t.locations.openLink}
                      </a>
                      {priceLine ? (
                        <p className="mt-1 text-sm text-cream">{priceLine}</p>
                      ) : null}
                      {loc.comment ? (
                        <p className="mt-1 text-sm text-mute">{loc.comment}</p>
                      ) : null}
                      <p
                        className={cn(
                          'mt-1.5 text-xs tabular-nums',
                          item.hasVeto ? 'font-medium text-danger' : 'text-mute',
                        )}
                      >
                        {formatLocationScoreLine(
                          item.plus,
                          item.minus,
                          item.score,
                        )}
                        {item.hasVeto ? ` · ${t.locations.veto}` : ''}
                      </p>
                      {(mine || canEditCatalog) && (
                        <div className="mt-2 flex gap-2">
                          {canEditCatalog ? (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => startEdit(item)}
                              className="text-xs text-teal"
                            >
                              {t.locations.edit}
                            </button>
                          ) : null}
                          {mine ? (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() =>
                                run(() => onRemove(item.proposal.id))
                              }
                              className="text-xs text-danger"
                            >
                              {t.locations.remove}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={item.myVote === 1}
                        aria-label={t.locations.voteUp}
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
                        aria-label={t.locations.voteDown}
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
        <div className="space-y-3 border-t border-line/60 pt-3">
          <p className="text-sm text-mute">{t.locations.add}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAddMode('catalog')}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-semibold',
                addMode === 'catalog'
                  ? 'bg-teal text-ink'
                  : 'border border-line text-mute',
              )}
            >
              {t.locations.fromCatalog}
            </button>
            <button
              type="button"
              onClick={() => setAddMode('create')}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-semibold',
                addMode === 'create'
                  ? 'bg-teal text-ink'
                  : 'border border-line text-mute',
              )}
            >
              {t.locations.createNew}
            </button>
          </div>

          {addMode === 'catalog' ? (
            <div className="space-y-2">
              <input
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder={t.locations.searchPlaceholder}
                className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2.5 text-sm"
                disabled={disabled}
              />
              {catalogLoading ? (
                <p className="text-sm text-mute">{t.common.loading}</p>
              ) : catalog.filter((l) => !proposedIds.has(l.id)).length === 0 ? (
                <p className="text-sm text-mute">{t.locations.catalogEmpty}</p>
              ) : (
                <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                  {catalog
                    .filter((l) => !proposedIds.has(l.id))
                    .map((loc) => (
                      <li key={loc.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            run(() => onProposeExisting(loc.id))
                          }
                          className="w-full rounded-xl border border-line/70 bg-panel-2/50 px-3 py-2 text-left hover:border-teal/50 disabled:opacity-60"
                        >
                          <p className="text-sm font-medium">{loc.name}</p>
                          <p className="text-xs text-mute">{loc.address}</p>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-2">
              <LocationFields
                value={draft}
                onChange={setDraft}
                disabled={disabled}
                t={t.locations}
                required
              />
              <button
                type="submit"
                disabled={
                  disabled ||
                  !draft.name.trim() ||
                  !draft.address.trim() ||
                  !draft.url.trim()
                }
                className="w-full rounded-xl bg-amber px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
              >
                {t.locations.addButton}
              </button>
            </form>
          )}
        </div>
      ) : (
        <p className="border-t border-line/60 pt-3 text-sm text-amber">
          {t.locations.limitReached}
        </p>
      )}

      {localError ? <p className="text-sm text-danger">{localError}</p> : null}
    </section>
  )
}

type FieldBag = {
  name: string
  address: string
  url: string
  price: string
  comment: string
}

function LocationFields({
  value,
  onChange,
  disabled,
  t,
  required = false,
}: {
  value: FieldBag
  onChange: (next: FieldBag) => void
  disabled: boolean
  t: {
    namePlaceholder: string
    addressPlaceholder: string
    urlPlaceholder: string
    pricePlaceholder: string
    commentPlaceholder: string
  }
  required?: boolean
}) {
  return (
    <>
      <input
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        maxLength={200}
        required={required}
        className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm"
        placeholder={t.namePlaceholder}
        disabled={disabled}
      />
      <input
        value={value.address}
        onChange={(e) => onChange({ ...value, address: e.target.value })}
        maxLength={500}
        required={required}
        className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm"
        placeholder={t.addressPlaceholder}
        disabled={disabled}
      />
      <input
        value={value.url}
        onChange={(e) => onChange({ ...value, url: e.target.value })}
        maxLength={1000}
        required={required}
        inputMode="url"
        className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm"
        placeholder={t.urlPlaceholder}
        disabled={disabled}
      />
      <input
        value={value.price}
        onChange={(e) => onChange({ ...value, price: e.target.value })}
        inputMode="decimal"
        className="w-full rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm"
        placeholder={t.pricePlaceholder}
        disabled={disabled}
      />
      <textarea
        value={value.comment}
        onChange={(e) => onChange({ ...value, comment: e.target.value })}
        maxLength={1000}
        rows={2}
        className="w-full resize-none rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm"
        placeholder={t.commentPlaceholder}
        disabled={disabled}
      />
    </>
  )
}
