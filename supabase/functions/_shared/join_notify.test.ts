/**
 * Message formatting + callback parsing for join Telegram notify.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildJamMiniAppUrl,
  buildJoinCallbackData,
  buildJoinRequestKeyboard,
  buildStartGreeting,
  buildStartKeyboard,
  encodeJamIdForStartParam,
  formatDecisionMessage,
  formatJamLabelUk,
  formatJamWindowUk,
  formatJoinRequestMessage,
  formatResolvedOrganizerMessage,
  parseJoinCallbackData,
} from './join_notify.ts'

const REQUEST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JAM_ID = '11111111-2222-3333-4444-555555555555'

describe('parseJoinCallbackData / buildJoinCallbackData', () => {
  it('round-trips accept and decline', () => {
    const accept = buildJoinCallbackData('accept', REQUEST_ID)
    const decline = buildJoinCallbackData('decline', REQUEST_ID)
    assert.equal(accept, `jr:a:${REQUEST_ID}`)
    assert.equal(decline, `jr:d:${REQUEST_ID}`)
    assert.deepEqual(parseJoinCallbackData(accept), {
      action: 'accept',
      requestId: REQUEST_ID,
    })
    assert.deepEqual(parseJoinCallbackData(decline), {
      action: 'decline',
      requestId: REQUEST_ID,
    })
  })

  it('normalizes UUID case', () => {
    const data = buildJoinCallbackData(
      'accept',
      'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    )
    assert.equal(data, `jr:a:${REQUEST_ID}`)
  })

  it('rejects malformed callback_data', () => {
    assert.equal(parseJoinCallbackData(null), null)
    assert.equal(parseJoinCallbackData(''), null)
    assert.equal(parseJoinCallbackData('jr:x:' + REQUEST_ID), null)
    assert.equal(parseJoinCallbackData('jr:a:not-a-uuid'), null)
    assert.equal(parseJoinCallbackData('other:' + REQUEST_ID), null)
  })

  it('keeps callback_data under Telegram 64-byte limit', () => {
    const data = buildJoinCallbackData('decline', REQUEST_ID)
    assert.ok(data.length <= 64)
  })
})

describe('jam mini app deep links', () => {
  it('encodes jam id without dashes', () => {
    assert.equal(
      encodeJamIdForStartParam(JAM_ID),
      '11111111222233334444555555555555',
    )
  })

  it('builds t.me startapp URL', () => {
    assert.equal(
      buildJamMiniAppUrl(JAM_ID, 'jammatch_bot'),
      'https://t.me/jammatch_bot?startapp=jam_11111111222233334444555555555555',
    )
  })
})

describe('Ukrainian message formatting', () => {
  it('formats join request for the organizer', () => {
    const text = formatJoinRequestMessage({
      requesterName: 'Оля',
      role: 'bass',
      note: 'Можу з 19:00',
      jamFormat: 'free_jam',
      jamArea: 'Podil',
      jamGenres: ['rock', 'indie'],
      windowStart: '2026-11-20T17:00:00.000Z',
      windowEnd: '2026-11-20T19:00:00.000Z',
      jamId: JAM_ID,
      requestId: REQUEST_ID,
    })
    assert.match(text, /Новий запит на джем/)
    assert.match(text, /Від: Оля/)
    assert.match(text, /Інструмент: bass/)
    assert.match(text, /Нотатка: Можу з 19:00/)
    assert.match(text, /Вільний джем · Podil · rock, indie/)
    assert.match(text, /Час:/)
  })

  it('omits empty note', () => {
    const text = formatJoinRequestMessage({
      requesterName: 'Misha',
      role: 'drums',
      note: '  ',
      jamFormat: 'cover_practice',
      jamArea: 'Center',
      windowStart: '2026-11-20T17:00:00.000Z',
      windowEnd: '2026-11-20T19:00:00.000Z',
      jamId: JAM_ID,
      requestId: REQUEST_ID,
    })
    assert.doesNotMatch(text, /Нотатка/)
    assert.match(text, /Кавери · Center/)
  })

  it('formats accept and decline for the requester', () => {
    const accepted = formatDecisionMessage({
      accepted: true,
      jamFormat: 'permanent_band',
      jamArea: 'Podil',
      windowStart: '2026-11-20T17:00:00.000Z',
      windowEnd: '2026-11-20T19:00:00.000Z',
      role: 'keys',
      jamId: JAM_ID,
    })
    assert.match(accepted, /прийняли/i)
    assert.match(accepted, /Постійний склад/)

    const declined = formatDecisionMessage({
      accepted: false,
      jamFormat: 'free_jam',
      jamArea: 'Podil',
      windowStart: '2026-11-20T17:00:00.000Z',
      windowEnd: '2026-11-20T19:00:00.000Z',
      role: 'vocals',
      jamId: JAM_ID,
    })
    assert.match(declined, /відхилено/i)
  })

  it('formats resolved organizer edit text', () => {
    assert.equal(
      formatResolvedOrganizerMessage({
        accepted: true,
        requesterName: 'Оля',
        role: 'bass',
      }),
      '✅ Прийнято · Оля (bass)',
    )
    assert.equal(
      formatResolvedOrganizerMessage({
        accepted: false,
        requesterName: 'Оля',
        role: 'bass',
      }),
      '❌ Відхилено · Оля (bass)',
    )
  })

  it('formats Kyiv window in uk-UA', () => {
    const s = formatJamWindowUk(
      '2026-11-20T17:00:00.000Z',
      '2026-11-20T19:00:00.000Z',
    )
    // 17:00 UTC = 19:00 Europe/Kyiv (EET, no DST in Nov)
    assert.match(s, /19:00/)
    assert.match(s, /21:00/)
  })

  it('formats jam label without genres', () => {
    assert.equal(
      formatJamLabelUk({ format: 'free_jam', area: 'Podil', genres: [] }),
      'Вільний джем · Podil',
    )
  })
})

describe('inline keyboards', () => {
  it('builds Accept / Decline + jam URL for organizer', () => {
    const kb = buildJoinRequestKeyboard({
      requestId: REQUEST_ID,
      jamId: JAM_ID,
      botUsername: 'jammatch_bot',
    })
    assert.equal(kb.inline_keyboard.length, 2)
    assert.equal(kb.inline_keyboard[0]![0]!.text, 'Прийняти')
    assert.equal(
      (kb.inline_keyboard[0]![0] as { callback_data: string }).callback_data,
      `jr:a:${REQUEST_ID}`,
    )
    assert.equal(kb.inline_keyboard[0]![1]!.text, 'Відхилити')
    assert.match(
      (kb.inline_keyboard[1]![0] as { url: string }).url,
      /t\.me\/jammatch_bot\?startapp=jam_/,
    )
  })

  it('builds /start greeting + Mini App button', () => {
    assert.match(buildStartGreeting(), /Jam Match/)
    const kb = buildStartKeyboard({ botUsername: 'jammatch_bot' })
    assert.equal(
      (kb.inline_keyboard[0]![0] as { url: string }).url,
      'https://t.me/jammatch_bot?startapp',
    )
  })
})
