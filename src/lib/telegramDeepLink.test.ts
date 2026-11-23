/**
 * Telegram jam start_param encode/decode + link building.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFriendTelegramLink,
  buildJamTelegramLink,
  decodeFriendStartParam,
  decodeJamStartParam,
  encodeFriendStartParam,
  encodeJamIdForStartParam,
  encodeJamStartParam,
  readTelegramStartParam,
} from './telegramDeepLink.ts'

const SAMPLE_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const SAMPLE_HEX = 'a1b2c3d4e5f67890abcdef1234567890'

describe('encodeJamIdForStartParam', () => {
  it('strips dashes from a UUID', () => {
    assert.equal(encodeJamIdForStartParam(SAMPLE_UUID), SAMPLE_HEX)
  })

  it('accepts already-stripped hex', () => {
    assert.equal(encodeJamIdForStartParam(SAMPLE_HEX), SAMPLE_HEX)
  })

  it('normalizes to lowercase', () => {
    assert.equal(
      encodeJamIdForStartParam('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'),
      SAMPLE_HEX,
    )
  })

  it('rejects invalid ids', () => {
    assert.throws(() => encodeJamIdForStartParam('not-a-uuid'))
  })
})

describe('encodeJamStartParam / decodeJamStartParam', () => {
  it('round-trips jam_<hex>', () => {
    const param = encodeJamStartParam(SAMPLE_UUID)
    assert.equal(param, `jam_${SAMPLE_HEX}`)
    assert.equal(param.length, 36)
    assert.ok(param.length <= 64)
    assert.match(param, /^[A-Za-z0-9_-]+$/)
    assert.equal(decodeJamStartParam(param), SAMPLE_UUID)
  })

  it('decodes dashed body after jam_ prefix', () => {
    assert.equal(decodeJamStartParam(`jam_${SAMPLE_UUID}`), SAMPLE_UUID)
  })

  it('returns null for unrelated start_param', () => {
    assert.equal(decodeJamStartParam('invite_abc'), null)
    assert.equal(decodeJamStartParam(''), null)
    assert.equal(decodeJamStartParam(null), null)
    assert.equal(decodeJamStartParam('jam_nothex'), null)
  })
})

describe('encodeFriendStartParam / decodeFriendStartParam', () => {
  it('round-trips fr_<hex>', () => {
    const param = encodeFriendStartParam(SAMPLE_UUID)
    assert.equal(param, `fr_${SAMPLE_HEX}`)
    assert.ok(param.length <= 64)
    assert.equal(decodeFriendStartParam(param), SAMPLE_UUID)
  })

  it('does not confuse jam_ with fr_', () => {
    assert.equal(decodeFriendStartParam(`jam_${SAMPLE_HEX}`), null)
    assert.equal(decodeJamStartParam(`fr_${SAMPLE_HEX}`), null)
  })
})

describe('buildFriendTelegramLink', () => {
  it('builds Main Mini App friend invite link', () => {
    assert.equal(
      buildFriendTelegramLink(SAMPLE_UUID, { botUsername: 'jammatch_bot' }),
      `https://t.me/jammatch_bot?startapp=fr_${SAMPLE_HEX}`,
    )
  })
})

describe('buildJamTelegramLink', () => {
  it('builds Main Mini App link when appName is empty', () => {
    assert.equal(
      buildJamTelegramLink(SAMPLE_UUID, {
        botUsername: 'jammatch_bot',
      }),
      `https://t.me/jammatch_bot?startapp=jam_${SAMPLE_HEX}`,
    )
    assert.equal(
      buildJamTelegramLink(SAMPLE_UUID, {
        botUsername: 'jammatch_bot',
        appName: '',
      }),
      `https://t.me/jammatch_bot?startapp=jam_${SAMPLE_HEX}`,
    )
  })

  it('strips @ from bot username', () => {
    assert.equal(
      buildJamTelegramLink(SAMPLE_UUID, { botUsername: '@jammatch_bot' }),
      `https://t.me/jammatch_bot?startapp=jam_${SAMPLE_HEX}`,
    )
  })

  it('uses named /newapp path when appName is set', () => {
    assert.equal(
      buildJamTelegramLink(SAMPLE_UUID, {
        botUsername: 'jammatch_bot',
        appName: 'jam',
      }),
      `https://t.me/jammatch_bot/jam?startapp=jam_${SAMPLE_HEX}`,
    )
    assert.equal(
      buildJamTelegramLink(SAMPLE_UUID, {
        botUsername: 'jammatch_bot',
        appName: 'play',
      }),
      `https://t.me/jammatch_bot/play?startapp=jam_${SAMPLE_HEX}`,
    )
  })

  it('requires bot username', () => {
    assert.throws(() =>
      buildJamTelegramLink(SAMPLE_UUID, { botUsername: '' }),
    )
  })
})

describe('readTelegramStartParam', () => {
  it('prefers initDataUnsafe.start_param', () => {
    const win = {
      Telegram: {
        WebApp: {
          initData: '',
          initDataUnsafe: { start_param: `jam_${SAMPLE_HEX}` },
          ready: () => {},
          expand: () => {},
        },
      },
      location: {
        search: '?tgWebAppStartParam=other',
        hash: '',
      },
    } as unknown as Window
    assert.equal(readTelegramStartParam(win), `jam_${SAMPLE_HEX}`)
  })

  it('falls back to tgWebAppStartParam query', () => {
    const win = {
      Telegram: undefined,
      location: {
        search: `?tgWebAppStartParam=jam_${SAMPLE_HEX}`,
        hash: '',
      },
    } as unknown as Window
    assert.equal(readTelegramStartParam(win), `jam_${SAMPLE_HEX}`)
  })
})
