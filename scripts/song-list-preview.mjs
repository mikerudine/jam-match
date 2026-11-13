#!/usr/bin/env node
/**
 * Screenshot the real SongListSection via the DEV preview route.
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

await page.goto(`${BASE}/#/dev/song-list-preview`)
await page.waitForSelector('text=/Список пісень|Song list/i', { timeout: 15_000 })
await page.waitForTimeout(500)
await shot('10-jam-song-list')

// Switch to English
const en = page.getByRole('button', { name: /^EN$/i })
if (await en.count()) {
  await en.click()
  await page.waitForTimeout(400)
  await shot('10-jam-song-list-en')
}

await browser.close()
console.log('Done song-list preview screenshots')
