#!/usr/bin/env node
/**
 * Screenshot join-request UI via DEV preview route.
 * Expects Vite on APP_URL (default http://127.0.0.1:5173).
 */
import { chromium } from 'playwright'
import { mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.APP_URL || 'http://127.0.0.1:5173'
const OUT = '/opt/cursor/artifacts'
const DOCS = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
mkdirSync(DOCS, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})
const page = await context.newPage()

async function shot(name) {
  const dest = join(OUT, `${name}.png`)
  await page.screenshot({ path: dest, fullPage: true })
  copyFileSync(dest, join(DOCS, `${name}.png`))
  console.log('saved', name)
}

await page.goto(`${BASE}/#/dev/join-request-preview`)
await page.waitForSelector('text=/Запити на участь|Join requests/i', {
  timeout: 15_000,
})
await page.waitForTimeout(400)
await shot('14-join-requests-organizer')

await page.getByRole('button', { name: /Прийняти|Accept/i }).click()
await page.waitForTimeout(500)
await shot('15-join-accepted-seat')

// Fresh load for requester form (same-hash goto won't remount state)
await page.goto(`${BASE}/`)
await page.goto(`${BASE}/#/dev/join-request-preview`)
await page.waitForSelector('[data-testid="view-requester"]', { timeout: 10_000 })
await page.getByTestId('view-requester').click()
await page.waitForSelector('text=/Хочу приєднатися|Request to join/i', {
  timeout: 10_000,
})
await page.waitForTimeout(300)
await shot('16-join-request-form')

await page.getByRole('button', { name: /Своя роль|Custom role/i }).click()
await page.fill('input[placeholder*="maracas"]', 'maracas')
await page.fill('textarea', 'Happy to bring shakers')
await page.getByRole('button', { name: /Надіслати запит|Send request/i }).click()
await page.waitForSelector('text=/очікує відповіді|waiting for the organizer/i', {
  timeout: 5_000,
})
await page.waitForTimeout(300)
await shot('17-join-request-pending')

await page.goto(`${BASE}/`)
await page.goto(`${BASE}/#/dev/join-request-preview`)
await page.waitForSelector('text=/Запити на участь|Join requests/i', {
  timeout: 10_000,
})
const en = page.getByRole('button', { name: /^EN$/i })
if (await en.count()) {
  await en.click()
  await page.waitForTimeout(300)
  await shot('14-join-requests-organizer-en')
}

await browser.close()
console.log('Done join-request preview screenshots')
