#!/usr/bin/env node
/**
 * Screenshot EditJamSection via the DEV preview route.
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

await page.goto(`${BASE}/#/dev/edit-jam-preview`)
await page.waitForSelector('text=/Редагувати|Edit/i', { timeout: 15_000 })
await page.waitForTimeout(400)
await shot('10-jam-detail-edit-button')

await page.getByRole('button', { name: /Редагувати|Edit/i }).click()
await page.waitForSelector('text=/Редагувати джем|Edit jam/i', {
  timeout: 10_000,
})
await page.waitForTimeout(400)
await shot('11-jam-edit-form')

// Attempt to remove filled seat → blocked message
const removeButtons = page.getByRole('button', { name: /Прибрати|Remove/i })
await removeButtons.first().click()
await page.waitForSelector(
  'text=/Не можна прибрати місце|Cannot remove a seat/i',
  { timeout: 5_000 },
)
await page.waitForTimeout(300)
await shot('12-jam-edit-block-filled')

// Add vocals seat and save
await page.getByRole('button', { name: /\+ Вокал|\+ Vocals/i }).click()
await page.getByRole('button', { name: /Зберегти й оновити матчинг|Save & rematch/i }).click()
await page.waitForSelector('[data-testid="edit-saved"]', { timeout: 5_000 })
await page.waitForTimeout(400)
await shot('13-jam-edit-after-save')

const en = page.getByRole('button', { name: /^EN$/i })
if (await en.count()) {
  await en.click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^Edit$/i }).click()
  await page.waitForTimeout(400)
  await shot('11-jam-edit-form-en')
}

await browser.close()
console.log('Done edit-jam preview screenshots')
