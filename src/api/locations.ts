import { getSupabase } from '@/lib/supabase'
import {
  buildLocationList,
  canAddLocation,
  countOwnLocations,
  normalizeLocationAddress,
  normalizeLocationComment,
  normalizeLocationName,
  normalizeLocationUrl,
  normalizePricePerHour,
  type CreateLocationInput,
  type Location,
  type LocationListItem,
  type LocationProposalRow,
  type LocationVoteRow,
  type VoteValue,
} from '@/lib/locationList'

export interface JamLocationList {
  items: LocationListItem[]
  proposals: LocationProposalRow[]
  votes: LocationVoteRow[]
  ownCount: number
}

type ProposalEmbed = Omit<LocationProposalRow, 'location'> & {
  location: Location | Location[] | null
}

function unwrapLocation(row: ProposalEmbed): LocationProposalRow | null {
  const loc = Array.isArray(row.location) ? row.location[0] : row.location
  if (!loc) return null
  return { ...row, location: loc }
}

export async function listLocations(query?: string): Promise<Location[]> {
  let q = getSupabase()
    .from('locations')
    .select('*')
    .order('name', { ascending: true })
    .limit(50)

  const trimmed = query?.trim()
  if (trimmed) {
    q = q.or(
      `name.ilike.%${trimmed}%,address.ilike.%${trimmed}%`,
    )
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Location[]
}

export async function createLocation(
  input: CreateLocationInput,
): Promise<Location> {
  const name = normalizeLocationName(input.name)
  const address = normalizeLocationAddress(input.address)
  const url = normalizeLocationUrl(input.url)
  if (!name) throw new Error('name required')
  if (!address) throw new Error('address required')
  if (!url) throw new Error('url required')

  const { data: userData, error: userErr } = await getSupabase().auth.getUser()
  if (userErr) throw userErr
  const uid = userData.user?.id
  if (!uid) throw new Error('not authenticated')

  const { data, error } = await getSupabase()
    .from('locations')
    .insert({
      created_by: uid,
      name,
      address,
      url,
      price_per_hour: normalizePricePerHour(input.price_per_hour),
      comment: normalizeLocationComment(input.comment ?? ''),
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Location
}

export async function updateLocation(input: {
  id: string
  name: string
  address: string
  url: string
  price_per_hour?: number | null
  comment?: string | null
}): Promise<Location> {
  const name = normalizeLocationName(input.name)
  const address = normalizeLocationAddress(input.address)
  const url = normalizeLocationUrl(input.url)
  if (!name) throw new Error('name required')
  if (!address) throw new Error('address required')
  if (!url) throw new Error('url required')

  const { data, error } = await getSupabase()
    .from('locations')
    .update({
      name,
      address,
      url,
      price_per_hour: normalizePricePerHour(input.price_per_hour),
      comment: normalizeLocationComment(input.comment ?? ''),
    })
    .eq('id', input.id)
    .select('*')
    .single()
  if (error) throw error
  return data as Location
}

export async function listJamLocations(
  jamId: string,
  userId: string,
): Promise<JamLocationList> {
  const supabase = getSupabase()

  const { data: rows, error: propErr } = await supabase
    .from('jam_location_proposals')
    .select('*, location:locations(*)')
    .eq('jam_id', jamId)
  if (propErr) throw propErr

  const proposals = ((rows ?? []) as ProposalEmbed[])
    .map(unwrapLocation)
    .filter((p): p is LocationProposalRow => p !== null)

  const proposalIds = proposals.map((p) => p.id)
  let voteRows: LocationVoteRow[] = []
  if (proposalIds.length > 0) {
    const { data: votes, error: voteErr } = await supabase
      .from('jam_location_votes')
      .select('*')
      .in('proposal_id', proposalIds)
    if (voteErr) throw voteErr
    voteRows = (votes ?? []) as LocationVoteRow[]
  }

  return {
    proposals,
    votes: voteRows,
    items: buildLocationList(proposals, voteRows, userId),
    ownCount: countOwnLocations(proposals, userId),
  }
}

export async function proposeJamLocation(input: {
  jam_id: string
  location_id: string
}): Promise<LocationProposalRow> {
  const { data: userData, error: userErr } = await getSupabase().auth.getUser()
  if (userErr) throw userErr
  const uid = userData.user?.id
  if (!uid) throw new Error('not authenticated')

  const existing = await listJamLocations(input.jam_id, uid)
  if (!canAddLocation(existing.proposals, uid)) {
    throw new Error('location limit reached (max 2 per jam)')
  }
  if (existing.proposals.some((p) => p.location_id === input.location_id)) {
    throw new Error('location already proposed')
  }

  const { data, error } = await getSupabase()
    .from('jam_location_proposals')
    .insert({
      jam_id: input.jam_id,
      location_id: input.location_id,
      added_by: uid,
    })
    .select('*, location:locations(*)')
    .single()
  if (error) throw error

  const unwrapped = unwrapLocation(data as ProposalEmbed)
  if (!unwrapped) throw new Error('location missing')
  return unwrapped
}

/** Create catalog row (if draft) and propose into jam — used after jam create too. */
export async function addJamLocation(input: {
  jam_id: string
  location_id?: string
  draft?: CreateLocationInput
}): Promise<LocationProposalRow> {
  let locationId = input.location_id
  if (!locationId) {
    if (!input.draft) throw new Error('location required')
    const created = await createLocation(input.draft)
    locationId = created.id
  }
  return proposeJamLocation({ jam_id: input.jam_id, location_id: locationId })
}

export async function removeJamLocationProposal(
  proposalId: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('jam_location_proposals')
    .delete()
    .eq('id', proposalId)
  if (error) throw error
}

export async function setLocationVote(input: {
  proposal_id: string
  value: VoteValue | null
}): Promise<void> {
  const supabase = getSupabase()
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) throw userErr
  const uid = userData.user?.id
  if (!uid) throw new Error('not authenticated')

  if (input.value === null) {
    const { error } = await supabase
      .from('jam_location_votes')
      .delete()
      .eq('proposal_id', input.proposal_id)
      .eq('user_id', uid)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('jam_location_votes').upsert(
    {
      proposal_id: input.proposal_id,
      user_id: uid,
      value: input.value,
    },
    { onConflict: 'proposal_id,user_id' },
  )
  if (error) throw error
}
