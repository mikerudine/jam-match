#!/usr/bin/env node
/**
 * Screenshot public jam preview + join for confirmed jam.
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

await page.goto(`${BASE}/#/dev/public-jam-preview`)
await page.waitForSelector('text=/Хочу приєднатися|Request to join/i', {
  timeout: 15_000,
})
await page.waitForTimeout(400)
await shot('18-public-confirmed-jam')

await page.getByRole('button', { name: /Своя роль|Custom role/i }).click()
await page.fill('input[placeholder*="maracas"]', 'maracas')
await page.fill('textarea', 'Can sit in on percussion')
await page.getByRole('button', { name: /Надіслати запит|Send request/i }).click()
await page.waitForSelector('text=/очікує відповіді|waiting for the organizer/i', {
  timeout: 5_000,
})
await page.waitForTimeout(300)
await shot('19-public-confirmed-join-pending')

const en = page.getByRole('button', { name: /^EN$/i })
if (await en.count()) {
  await page.goto(`${BASE}/`)
  await page.goto(`${BASE}/#/dev/public-jam-preview`)
  await page.waitForSelector('text=/Хочу приєднатися|Request to join/i', {
    timeout: 10_000,
  })
  await en.click()
  await page.waitForTimeout(300)
  await shot('18-public-confirmed-jam-en')
}

await browser.close()
console.log('Done public-jam preview screenshots')
