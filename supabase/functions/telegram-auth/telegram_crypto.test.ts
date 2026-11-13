/**
 * Hash verification tests for Telegram Login Widget + Mini App algorithms.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDataCheckString,
  checkAuthDateFreshness,
  computeTelegramHash,
  extractUserFromFields,
  fieldsFromWidgetUser,
  parseInitData,
  verifyTelegramHash,
} from './telegram_crypto.ts'

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'

describe('buildDataCheckString', () => {
  it('sorts keys and excludes hash', () => {
    const s = buildDataCheckString({
      hash: 'deadbeef',
      id: '42',
      auth_date: '100',
      first_name: 'Ada',
    })
    assert.equal(s, 'auth_date=100\nfirst_name=Ada\nid=42')
  })
})

describe('widget hash verification', () => {
  it('accepts a self-signed widget payload', async () => {
    const fields = fieldsFromWidgetUser({
      id: 424242,
      first_name: 'Misha',
      username: 'misha_jam',
      auth_date: 1_700_000_000,
      photo_url: 'https://example.com/a.jpg',
    })
    const hash = await computeTelegramHash(fields, BOT_TOKEN, 'widget')
    fields.hash = hash

    assert.equal(await verifyTelegramHash(fields, BOT_TOKEN, 'widget'), true)

    const tampered = { ...fields, first_name: 'Eve' }
    assert.equal(await verifyTelegramHash(tampered, BOT_TOKEN, 'widget'), false)

    const wrongToken = { ...fields }
    assert.equal(
      await verifyTelegramHash(wrongToken, '999:wrong-token', 'widget'),
      false,
    )
  })

  it('rejects when hash algorithm mode mismatches', async () => {
    const fields = fieldsFromWidgetUser({
      id: 1,
      first_name: 'A',
      auth_date: 1_700_000_000,
    })
    fields.hash = await computeTelegramHash(fields, BOT_TOKEN, 'widget')
    assert.equal(await verifyTelegramHash(fields, BOT_TOKEN, 'webapp'), false)
  })
})

describe('mini app (webapp) hash verification', () => {
  it('accepts a self-signed initData payload', async () => {
    const userJson = JSON.stringify({
      id: 777,
      first_name: 'Olya',
      last_name: 'Bass',
      username: 'olya_bass',
      photo_url: 'https://example.com/b.jpg',
    })
    const fields: Record<string, string> = {
      user: userJson,
      auth_date: '1700000000',
      query_id: 'AAEAAAE',
    }
    const hash = await computeTelegramHash(fields, BOT_TOKEN, 'webapp')
    fields.hash = hash

    const initData = new URLSearchParams(fields).toString()
    const parsed = parseInitData(initData)
    assert.equal(await verifyTelegramHash(parsed, BOT_TOKEN, 'webapp'), true)

    const user = extractUserFromFields(parsed, 'webapp')
    assert.ok(user)
    assert.equal(user!.id, 777)
    assert.equal(user!.username, 'olya_bass')
    assert.equal(user!.first_name, 'Olya')
  })

  it('uses WebAppData HMAC key (not SHA256 of token)', async () => {
    const fields: Record<string, string> = {
      auth_date: '1700000000',
      user: '{"id":1,"first_name":"X"}',
    }
    const webappHash = await computeTelegramHash(fields, BOT_TOKEN, 'webapp')
    const widgetHash = await computeTelegramHash(fields, BOT_TOKEN, 'widget')
    assert.notEqual(webappHash, widgetHash)
  })
})

describe('auth_date freshness', () => {
  it('accepts recent and rejects stale / future dates', () => {
    const now = 1_700_000_000
    assert.equal(checkAuthDateFreshness(now - 60, 86_400, now), true)
    assert.equal(checkAuthDateFreshness(now - 86_400, 86_400, now), true)
    assert.equal(checkAuthDateFreshness(now - 86_401, 86_400, now), false)
    assert.equal(checkAuthDateFreshness(now + 120, 86_400, now), false)
    assert.equal(checkAuthDateFreshness(0, 86_400, now), false)
  })
})

describe('extractUserFromFields (widget)', () => {
  it('maps scalar widget fields', () => {
    const user = extractUserFromFields(
      {
        id: '99',
        auth_date: '1700000000',
        hash: 'abc',
        first_name: 'Kit',
        username: 'kitdrums',
      },
      'widget',
    )
    assert.deepEqual(user, {
      id: 99,
      auth_date: 1_700_000_000,
      hash: 'abc',
      first_name: 'Kit',
      last_name: undefined,
      username: 'kitdrums',
      photo_url: undefined,
    })
  })
})
