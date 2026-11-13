/**
 * Telegram Login Widget message + tgAuthResult parsing.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  consumeTgAuthResultFromLocation,
  decodeTgAuthResult,
  extractTgAuthResult,
  isKnownTelegramOauthEvent,
  isTelegramWidgetUser,
  parseTelegramOauthMessage,
} from './telegramWidgetAuth.ts'

function toBase64Url(json: string): string {
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const sampleUser = {
  id: 42_424_242,
  first_name: 'Misha',
  username: 'misha_jam',
  auth_date: 1_700_000_000,
  hash: 'abcdef0123456789',
  photo_url: 'https://example.com/a.jpg',
}

describe('parseTelegramOauthMessage', () => {
  it('accepts auth_user / auth_data as a JSON string (official iframe)', () => {
    const raw = JSON.stringify({
      event: 'auth_user',
      auth_data: sampleUser,
    })
    assert.deepEqual(parseTelegramOauthMessage(raw), sampleUser)
  })

  it('accepts auth_user / auth_data as an object', () => {
    assert.deepEqual(
      parseTelegramOauthMessage({
        event: 'auth_user',
        auth_data: sampleUser,
      }),
      sampleUser,
    )
  })

  it('accepts legacy { result: user } payloads', () => {
    assert.deepEqual(
      parseTelegramOauthMessage({ result: sampleUser }),
      sampleUser,
    )
  })

  it('accepts a bare widget user object', () => {
    assert.deepEqual(parseTelegramOauthMessage(sampleUser), sampleUser)
  })

  it('returns null for resize / ready and other non-auth events', () => {
    assert.equal(
      parseTelegramOauthMessage(JSON.stringify({ event: 'resize', height: 40 })),
      null,
    )
    assert.equal(parseTelegramOauthMessage({ event: 'ready' }), null)
  })

  it('returns null for invalid JSON strings', () => {
    assert.equal(parseTelegramOauthMessage('not-json'), null)
  })

  it('returns null when auth_data is incomplete', () => {
    assert.equal(
      parseTelegramOauthMessage({
        event: 'auth_user',
        auth_data: { id: 1, first_name: 'x' },
      }),
      null,
    )
  })
})

describe('isKnownTelegramOauthEvent', () => {
  it('recognises official widget event names', () => {
    assert.equal(isKnownTelegramOauthEvent({ event: 'auth_user' }), true)
    assert.equal(isKnownTelegramOauthEvent({ event: 'resize' }), true)
    assert.equal(
      isKnownTelegramOauthEvent(JSON.stringify({ event: 'ready' })),
      true,
    )
  })

  it('rejects unknown events', () => {
    assert.equal(isKnownTelegramOauthEvent({ event: 'nope' }), false)
    assert.equal(isKnownTelegramOauthEvent({ foo: 1 }), false)
  })
})

describe('decodeTgAuthResult', () => {
  it('decodes base64url JSON into a widget user', () => {
    const b64 = toBase64Url(JSON.stringify(sampleUser))
    assert.deepEqual(decodeTgAuthResult(b64), sampleUser)
  })

  it('returns null for garbage', () => {
    assert.equal(decodeTgAuthResult('!!!'), null)
    assert.equal(decodeTgAuthResult(''), null)
  })
})

describe('extractTgAuthResult', () => {
  it('extracts from location.hash and cleans it', () => {
    const b64 = toBase64Url(JSON.stringify(sampleUser))
    const extracted = extractTgAuthResult(`#tgAuthResult=${b64}`, '')
    assert.ok(extracted)
    assert.deepEqual(extracted!.user, sampleUser)
    assert.equal(extracted!.cleanedHash, '')
  })

  it('extracts from location.search', () => {
    const b64 = toBase64Url(JSON.stringify(sampleUser))
    const extracted = extractTgAuthResult('', `?tgAuthResult=${b64}`)
    assert.ok(extracted)
    assert.deepEqual(extracted!.user, sampleUser)
    assert.equal(extracted!.cleanedSearch, '')
  })

  it('preserves a HashRouter path prefix when tgAuthResult is appended', () => {
    const b64 = toBase64Url(JSON.stringify(sampleUser))
    const extracted = extractTgAuthResult(`#/profile&tgAuthResult=${b64}`, '')
    assert.ok(extracted)
    assert.equal(extracted!.cleanedHash, '#/profile')
  })
})

describe('consumeTgAuthResultFromLocation', () => {
  it('strips the hash via replaceState and returns the user', () => {
    const b64 = toBase64Url(JSON.stringify(sampleUser))
    const replaced: string[] = []
    const user = consumeTgAuthResultFromLocation(
      {
        hash: `#tgAuthResult=${b64}`,
        search: '',
        pathname: '/jam-match/',
        href: `https://mikerudine.github.io/jam-match/#tgAuthResult=${b64}`,
      },
      {
        replaceState(_state, _title, url) {
          replaced.push(String(url))
        },
      },
    )
    assert.deepEqual(user, sampleUser)
    assert.deepEqual(replaced, ['/jam-match/'])
  })
})

describe('isTelegramWidgetUser', () => {
  it('requires id, hash, auth_date', () => {
    assert.equal(isTelegramWidgetUser(sampleUser), true)
    assert.equal(isTelegramWidgetUser({ id: 1 }), false)
  })
})
