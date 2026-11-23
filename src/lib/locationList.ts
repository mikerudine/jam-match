/** Max location proposals each participant may add to one jam (DB-enforced). */
export const MAX_LOCATIONS_PER_USER = 2

export type VoteValue = -1 | 1

export interface Location {
  id: string
  created_by: string
  name: string
  address: string
  url: string
  price_per_hour: number | null
  comment: string | null
  created_at: string
  updated_at: string
}

export interface LocationProposalRow {
  id: string
  jam_id: string
  location_id: string
  added_by: string
  created_at: string
  updated_at: string
  location: Location
}

export interface LocationVoteRow {
  id: string
  proposal_id: string
  user_id: string
  value: VoteValue
  created_at: string
  updated_at: string
}

export interface LocationListItem {
  proposal: LocationProposalRow
  plus: number
  minus: number
  score: number
  hasVeto: boolean
  myVote: VoteValue | null
  isLeading: boolean
}

export interface CreateLocationInput {
  name: string
  address: string
  url: string
  price_per_hour?: number | null
  comment?: string | null
}

/** Aggregate votes; sort by score desc, then name, then id. Mark top score as leading. */
export function buildLocationList(
  proposals: LocationProposalRow[],
  votes: LocationVoteRow[],
  currentUserId: string,
): LocationListItem[] {
  const byProposal = new Map<string, LocationVoteRow[]>()
  for (const v of votes) {
    const list = byProposal.get(v.proposal_id)
    if (list) list.push(v)
    else byProposal.set(v.proposal_id, [v])
  }

  const items: LocationListItem[] = proposals.map((proposal) => {
    const proposalVotes = byProposal.get(proposal.id) ?? []
    let plus = 0
    let minus = 0
    let myVote: VoteValue | null = null
    for (const v of proposalVotes) {
      if (v.value === 1) plus += 1
      else if (v.value === -1) minus += 1
      if (v.user_id === currentUserId) myVote = v.value
    }
    return {
      proposal,
      plus,
      minus,
      score: plus - minus,
      hasVeto: minus > 0,
      myVote,
      isLeading: false,
    }
  })

  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const nameCmp = a.proposal.location.name.localeCompare(
      b.proposal.location.name,
      undefined,
      { sensitivity: 'base' },
    )
    if (nameCmp !== 0) return nameCmp
    return a.proposal.id.localeCompare(b.proposal.id)
  })

  if (items.length > 0) {
    const top = items[0].score
    for (const item of items) {
      if (item.score === top) item.isLeading = true
      else break
    }
  }

  return items
}

export function countOwnLocations(
  proposals: Array<Pick<LocationProposalRow, 'added_by'>>,
  userId: string,
): number {
  return proposals.filter((p) => p.added_by === userId).length
}

export function canAddLocation(
  proposals: Array<Pick<LocationProposalRow, 'added_by'>>,
  userId: string,
): boolean {
  return countOwnLocations(proposals, userId) < MAX_LOCATIONS_PER_USER
}

export function normalizeLocationName(name: string): string {
  return name.trim()
}

export function normalizeLocationAddress(address: string): string {
  return address.trim()
}

export function normalizeLocationUrl(url: string): string {
  return url.trim()
}

export function normalizeLocationComment(comment: string): string | null {
  const t = comment.trim()
  return t.length > 0 ? t : null
}

export function normalizePricePerHour(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

/** Next vote after tapping +1 / −1 (toggle off if same value). */
export function nextVoteValue(
  current: VoteValue | null,
  tapped: VoteValue,
): VoteValue | null {
  return current === tapped ? null : tapped
}

export function formatLocationScoreLine(
  plus: number,
  minus: number,
  score: number,
): string {
  const total = score < 0 ? `−${Math.abs(score)}` : String(score)
  return `+${plus} / −${minus} · ${total}`
}

export function formatPricePerHour(
  price: number | null | undefined,
  currencyLabel: string,
): string | null {
  if (price === null || price === undefined) return null
  return `${price} ${currencyLabel}`
}

/** Ensure external links work when users omit https://. */
export function locationHref(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}
