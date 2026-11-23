/**
 * Location proposal scoring / slot helpers.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_LOCATIONS_PER_USER,
  buildLocationList,
  canAddLocation,
  countOwnLocations,
  formatLocationScoreLine,
  formatPricePerHour,
  nextVoteValue,
  normalizePricePerHour,
  type Location,
  type LocationProposalRow,
  type LocationVoteRow,
} from './locationList.ts'

function location(
  partial: Partial<Location> & Pick<Location, 'id' | 'name'>,
): Location {
  return {
    created_by: 'u1',
    address: 'Address',
    url: 'https://maps.example',
    price_per_hour: null,
    comment: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function proposal(
  partial: Partial<LocationProposalRow> &
    Pick<LocationProposalRow, 'id' | 'added_by' | 'location'>,
): LocationProposalRow {
  return {
    jam_id: 'jam-1',
    location_id: partial.location.id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function vote(
  partial: Partial<LocationVoteRow> &
    Pick<LocationVoteRow, 'id' | 'proposal_id' | 'user_id' | 'value'>,
): LocationVoteRow {
  return {
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('buildLocationList', () => {
  it('sorts by score and marks leading ties', () => {
    const proposals = [
      proposal({
        id: 'p1',
        added_by: 'u1',
        location: location({ id: 'l1', name: 'Zed' }),
      }),
      proposal({
        id: 'p2',
        added_by: 'u2',
        location: location({ id: 'l2', name: 'Alpha' }),
      }),
    ]
    const votes = [
      vote({ id: 'v1', proposal_id: 'p1', user_id: 'a', value: 1 }),
      vote({ id: 'v2', proposal_id: 'p2', user_id: 'a', value: 1 }),
      vote({ id: 'v3', proposal_id: 'p2', user_id: 'b', value: 1 }),
      vote({ id: 'v4', proposal_id: 'p1', user_id: 'me', value: -1 }),
    ]
    const items = buildLocationList(proposals, votes, 'me')
    assert.equal(items[0].proposal.id, 'p2')
    assert.equal(items[0].score, 2)
    assert.equal(items[0].isLeading, true)
    assert.equal(items[1].proposal.id, 'p1')
    assert.equal(items[1].hasVeto, true)
    assert.equal(items[1].myVote, -1)
    assert.equal(items[1].isLeading, false)
  })
})

describe('slots', () => {
  it('caps at MAX_LOCATIONS_PER_USER', () => {
    const proposals = [
      proposal({
        id: 'p1',
        added_by: 'me',
        location: location({ id: 'l1', name: 'A' }),
      }),
      proposal({
        id: 'p2',
        added_by: 'me',
        location: location({ id: 'l2', name: 'B' }),
      }),
    ]
    assert.equal(countOwnLocations(proposals, 'me'), 2)
    assert.equal(canAddLocation(proposals, 'me'), false)
    assert.equal(MAX_LOCATIONS_PER_USER, 2)
  })
})

describe('helpers', () => {
  it('formats score and price; toggles vote', () => {
    assert.equal(formatLocationScoreLine(3, 1, 2), '+3 / −1 · 2')
    assert.equal(formatPricePerHour(400, '₴/год'), '400 ₴/год')
    assert.equal(normalizePricePerHour('350,5'), 350.5)
    assert.equal(nextVoteValue(1, 1), null)
    assert.equal(nextVoteValue(null, -1), -1)
  })
})
