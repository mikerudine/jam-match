import { useEffect, useState, type FormEvent } from 'react'
import { listLocations } from '@/api/locations'
import { useLocale } from '@/i18n/LocaleContext'
import {
  MAX_LOCATIONS_PER_USER,
  type CreateLocationInput,
  type Location,
} from '@/lib/locationList'
import { cn } from '@/lib/utils'

export type LocationDraftItem =
  | { key: string; kind: 'existing'; location: Location }
  | { key: string; kind: 'draft'; draft: CreateLocationInput }

export interface LocationDraftPickerProps {
  value: LocationDraftItem[]
  onChange: (next: LocationDraftItem[]) => void
  disabled?: boolean
}

const emptyForm = {
  name: '',
  address: '',
  url: '',
  price: '',
  comment: '',
}

/** Optional picker for New Jam — up to 2 proposals after create. */
export function LocationDraftPicker({
  value,
  onChange,
  disabled = false,
}: LocationDraftPickerProps) {
  const { t } = useLocale()
  const [mode, setMode] = useState<'catalog' | 'create'>('catalog')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<Location[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)

  const slotsLeft = value.length < MAX_LOCATIONS_PER_USER
  const selectedIds = new Set(
    value.filter((v) => v.kind === 'existing').map((v) => v.location.id),
  )

  useEffect(() => {
    if (!slotsLeft || mode !== 'catalog') return
    let cancelled = false
    setLoading(true)
    const handle = window.setTimeout(() => {
      listLocations(query)
        .then((rows) => {
          if (!cancelled) setCatalog(rows)
        })
        .catch(() => {
          if (!cancelled) setCatalog([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [slotsLeft, mode, query])

  function remove(key: string) {
    onChange(value.filter((v) => v.key !== key))
  }

  function addExisting(loc: Location) {
    if (!slotsLeft || selectedIds.has(loc.id)) return
    onChange([
      ...value,
      { key: `existing-${loc.id}`, kind: 'existing', location: loc },
    ])
  }

  function addDraft(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!slotsLeft) return
    const name = form.name.trim()
    const address = form.address.trim()
    const url = form.url.trim()
    if (!name || !address || !url) {
      setError(t.locations.requiredFields)
      return
    }
    onChange([
      ...value,
      {
        key: `draft-${crypto.randomUUID()}`,
        kind: 'draft',
        draft: {
          name,
          address,
          url,
          price_per_hour: form.price
            ? Number(form.price.replace(',', '.'))
            : null,
          comment: form.comment.trim() || null,
        },
      },
    ])
    setForm(emptyForm)
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-cream">{t.locations.title}</p>
          <p className="mt-1 text-xs text-mute">{t.locations.createHint}</p>
        </div>
        <p className="shrink-0 text-xs tabular-nums text-mute">
          {value.length}/{MAX_LOCATIONS_PER_USER}
        </p>
      </div>

      {value.length > 0 ? (
        <ul className="space-y-2">
          {value.map((item) => {
            const title =
              item.kind === 'existing' ? item.location.name : item.draft.name
            const address =
              item.kind === 'existing'
                ? item.location.address
                : item.draft.address
            return (
              <li
                key={item.key}
                className="flex items-start justify-between gap-3 rounded-xl border border-line/70 bg-panel-2/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-mute">{address}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(item.key)}
                  className="shrink-0 text-xs text-danger"
                >
                  {t.locations.remove}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-mute">{t.locations.optionalEmpty}</p>
      )}

      {slotsLeft ? (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('catalog')}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-semibold',
                mode === 'catalog'
                  ? 'bg-teal text-ink'
                  : 'border border-line text-mute',
              )}
            >
              {t.locations.fromCatalog}
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-semibold',
                mode === 'create'
                  ? 'bg-teal text-ink'
                  : 'border border-line text-mute',
              )}
            >
              {t.locations.createNew}
            </button>
          </div>

          {mode === 'catalog' ? (
            <div className="space-y-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.locations.searchPlaceholder}
                className="w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-cream"
                disabled={disabled}
              />
              {loading ? (
                <p className="text-sm text-mute">{t.common.loading}</p>
              ) : (
                <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                  {catalog
                    .filter((l) => !selectedIds.has(l.id))
                    .map((loc) => (
                      <li key={loc.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => addExisting(loc)}
                          className="w-full rounded-xl border border-line/70 bg-ink/30 px-3 py-2 text-left hover:border-teal/50 disabled:opacity-60"
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
            <form onSubmit={addDraft} className="space-y-2">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={200}
                placeholder={t.locations.namePlaceholder}
                className="w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-cream"
                disabled={disabled}
              />
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                required
                maxLength={500}
                placeholder={t.locations.addressPlaceholder}
                className="w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-cream"
                disabled={disabled}
              />
              <input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                required
                inputMode="url"
                maxLength={1000}
                placeholder={t.locations.urlPlaceholder}
                className="w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-cream"
                disabled={disabled}
              />
              <input
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                inputMode="decimal"
                placeholder={t.locations.pricePlaceholder}
                className="w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-cream"
                disabled={disabled}
              />
              <textarea
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
                maxLength={1000}
                rows={2}
                placeholder={t.locations.commentPlaceholder}
                className="w-full resize-none rounded-xl border border-line bg-ink px-3 py-2 text-sm text-cream"
                disabled={disabled}
              />
              <button
                type="submit"
                disabled={disabled}
                className="w-full rounded-xl border border-amber/60 px-4 py-2.5 text-sm font-semibold text-amber disabled:opacity-60"
              >
                {t.locations.addButton}
              </button>
            </form>
          )}
        </>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  )
}
