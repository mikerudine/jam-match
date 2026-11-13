#!/usr/bin/env node
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

const BASE = process.env.APP_URL || 'http://127.0.0.1:5173'
const OUT = '/opt/cursor/artifacts'
mkdirSync(OUT, { recursive: true })
mkdirSync('docs/screenshots', { recursive: true })

function statusEnv() {
  const out = execSync('npx supabase status -o env', { encoding: 'utf8' })
  return Object.fromEntries(
    out
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]
      }),
  )
}

const env = statusEnv()
const url = env.API_URL
const anon = env.ANON_KEY

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true })
  console.log('saved', name)
}

async function login(page, email) {
  await page.goto(BASE)
  await page.waitForTimeout(600)
  // Email login is behind VITE_ENABLE_EMAIL_LOGIN — prefer that for seed screenshots.
  const passwordTab = page.getByRole('button', {
    name: /Пароль \(локально\)|Password \(local\)/i,
  })
  if (await passwordTab.count()) {
    await passwordTab.click()
  }
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', 'password123')
  await page.getByRole('button', { name: /Увійти|Sign in/i }).click()
  await page.waitForTimeout(1200)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})
const page = await context.newPage()

await page.goto(BASE)
await page.waitForTimeout(700)
await shot(page, '01-sign-in')

await login(page, 'musician03@jam-match.local')
await shot(page, '02-home')

await page.getByRole('link', { name: /Коли можу|Availability/i }).click()
await page.waitForTimeout(700)
await shot(page, '03-availability')

await page.getByRole('link', { name: /Профіль|Profile/i }).click()
await page.waitForTimeout(700)
await shot(page, '04-profile')

await page.getByRole('link', { name: /Джеми|Jams/i }).click()
await page.waitForTimeout(400)
await page.getByRole('link', { name: /Новий джем|New jam/i }).click()
await page.waitForTimeout(700)
await shot(page, '05-new-jam')

await page.getByRole('button', { name: /Створити й шукати|Create & match/i }).click()
await page.waitForTimeout(2000)
await shot(page, '06-jam-detail')

// Seed a few songs on the jam detail song list (participants only).
const songTitle = page.getByPlaceholder(/Назва|Title/i)
if (await songTitle.count()) {
  await songTitle.fill('Seven Nation Army')
  await page.getByPlaceholder(/Виконавець|Artist/i).fill('The White Stripes')
  await page.getByRole('button', { name: /^Додати$|^Add$/i }).click()
  await page.waitForTimeout(700)
  await songTitle.fill('Wonderwall')
  await page.getByPlaceholder(/Виконавець|Artist/i).fill('Oasis')
  await page.getByRole('button', { name: /^Додати$|^Add$/i }).click()
  await page.waitForTimeout(700)
  const veto = page.getByRole('button', { name: /Проти|Downvote/i }).last()
  if (await veto.count()) await veto.click()
  await page.waitForTimeout(500)
  await shot(page, '10-jam-song-list')
}

await page.getByRole('link', { name: /Джеми|Jams/i }).click()
await page.waitForTimeout(800)
await shot(page, '07-home-with-jam')

// Find invitee via service role
const admin = createClient(url, env.SERVICE_ROLE_KEY, {
  db: { schema: 'jam' },
})
const { data: invite } = await admin
  .from('jam_invites')
  .select('invitee_id, profiles:invitee_id(display_name)')
  .eq('status', 'pending')
  .limit(1)
  .maybeSingle()

let inviteEmail = 'musician08@jam-match.local'
if (invite?.invitee_id) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const u = users.users.find((x) => x.id === invite.invitee_id)
  if (u?.email) inviteEmail = u.email
  console.log('invitee', invite.profiles?.display_name, inviteEmail)
}

await page.getByRole('button', { name: /Вийти|Sign out/i }).click().catch(() => {})
// Profile has sign out
await page.getByRole('link', { name: /Профіль|Profile/i }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Вийти|Sign out/i }).click()
await page.waitForTimeout(800)

await login(page, inviteEmail)
await page.getByRole('link', { name: /Інбокс|Inbox/i }).click()
await page.waitForTimeout(1500)
await shot(page, '08-inbox-invite')

// Accept invite
const accept = page.getByRole('button', { name: /Прийняти|Accept/i })
if (await accept.count()) {
  await accept.first().click()
  await page.waitForTimeout(1200)
  await shot(page, '09-inbox-after-accept')
}

await browser.close()
console.log('Done screenshots')
