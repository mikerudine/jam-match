#!/usr/bin/env node
/**
 * Seed fake Podil musicians into local Supabase for matching tests.
 *
 * Usage (after `supabase start` + migrations):
 *   node scripts/seed.mjs
 *
 * Reads URL/keys from `supabase status -o env` when env vars are missing.
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

function loadLocalEnv() {
  let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  let serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
  let anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (url && serviceKey) {
    return { url, serviceKey, anonKey }
  }

  try {
    const out = execSync('npx supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const map = Object.fromEntries(
      out
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]
        }),
    )
    url ||= map.API_URL || map.SUPABASE_URL
    serviceKey ||= map.SERVICE_ROLE_KEY
    anonKey ||= map.ANON_KEY
  } catch (err) {
    console.error('Could not read supabase status. Is `supabase start` running?')
    console.error(err.message)
    process.exit(1)
  }

  if (!url || !serviceKey) {
    console.error('Missing SUPABASE_URL / SERVICE_ROLE_KEY')
    process.exit(1)
  }
  return { url, serviceKey, anonKey }
}

const INSTRUMENTS = ['drums', 'bass', 'guitar', 'keys', 'vocals', 'other']
const GENRES = [
  'rock',
  'indie',
  'punk',
  'jazz',
  'blues',
  'funk',
  'soul',
  'folk',
  'pop',
  'metal',
]
const AREAS = ['Podil', 'Kontraktova', 'Vokzalna', 'Lukianivka', 'Center']
const LEVELS = ['beginner', 'intermediate', 'advanced']

const NAMES = [
  ['Оля', 'барабани', 'drums'],
  ['Макс', 'бас', 'bass'],
  ['Іра', 'гітара', 'guitar'],
  ['Саша', 'клавіші', 'keys'],
  ['Марта', 'вокал', 'vocals'],
  ['Денис', 'гітара', 'guitar'],
  ['Катя', 'бас', 'bass'],
  ['Taras', 'drums', 'drums'],
  ['Nastia', 'vocals', 'vocals'],
  ['Bohdan', 'keys', 'keys'],
  ['Yulia', 'guitar', 'guitar'],
  ['Andrii', 'bass', 'bass'],
  ['Lera', 'vocals', 'vocals'],
  ['Pavlo', 'drums', 'drums'],
  ['Sofia', 'other', 'other'],
  ['Roma', 'guitar', 'guitar'],
  ['Vika', 'keys', 'keys'],
  ['Dima', 'bass', 'bass'],
  ['Anya', 'vocals', 'vocals'],
  ['Zhenya', 'drums', 'drums'],
]

function pick(arr, n) {
  const copy = [...arr]
  const out = []
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length)
    out.push(copy.splice(i, 1)[0])
  }
  return out
}

function weeklyEveningSlots() {
  // Mon–Thu 19–21, Fri–Sat 18–22 — typical rehearsal windows
  const slots = []
  for (const day of [0, 1, 2, 3]) {
    for (const hour of [19, 20, 21]) slots.push({ day_of_week: day, hour })
  }
  for (const day of [4, 5]) {
    for (const hour of [18, 19, 20, 21, 22]) slots.push({ day_of_week: day, hour })
  }
  // Some also free Sunday afternoon
  if (Math.random() > 0.4) {
    for (const hour of [15, 16, 17, 18]) slots.push({ day_of_week: 6, hour })
  }
  return slots
}

async function main() {
  const { url, serviceKey } = loadLocalEnv()
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('Seeding musicians into', url)

  for (let i = 0; i < NAMES.length; i++) {
    const [name, , primary] = NAMES[i]
    const email = `musician${String(i + 1).padStart(2, '0')}@jam-match.local`
    const password = 'password123'

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    })

    let userId = created?.user?.id
    if (createErr) {
      // Re-run friendly: look up existing
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      const existing = list?.users?.find((u) => u.email === email)
      if (!existing) {
        console.error('Failed', email, createErr.message)
        continue
      }
      userId = existing.id
    }

    const secondary = pick(
      INSTRUMENTS.filter((x) => x !== primary),
      Math.random() > 0.7 ? 1 : 0,
    )
    const instruments = [primary, ...secondary]
    const genres = pick(GENRES, 2 + Math.floor(Math.random() * 3))
    const areas = pick(AREAS, 1 + Math.floor(Math.random() * 2))
    if (!areas.includes('Podil')) areas.push('Podil')

    const handleBase =
      name
        .normalize('NFKD')
        .replace(/[^\w]/g, '')
        .toLowerCase() || `musician${i + 1}`
    const { error: profileErr } = await admin.from('profiles').upsert({
      id: userId,
      display_name: name,
      telegram_handle: `${handleBase}${i + 1}`,
      instruments,
      genres,
      level: LEVELS[Math.floor(Math.random() * LEVELS.length)],
      preferred_areas: areas,
      demo_url: Math.random() > 0.5 ? 'https://soundcloud.com/jam-match-demo' : null,
      reliability_score: 0.75 + Math.random() * 0.25,
      reliability_count: Math.floor(Math.random() * 8),
      locale: Math.random() > 0.3 ? 'uk' : 'en',
      updated_at: new Date().toISOString(),
    })
    if (profileErr) {
      console.error('profile', email, profileErr.message)
      continue
    }

    await admin.from('availability_slots').delete().eq('user_id', userId)
    const slots = weeklyEveningSlots().map((s) => ({ ...s, user_id: userId }))
    const { error: slotErr } = await admin.from('availability_slots').insert(slots)
    if (slotErr) {
      console.error('slots', email, slotErr.message)
      continue
    }

    console.log(`✓ ${name} <${email}> [${instruments.join(', ')}]`)
  }

  console.log('\nDone. Sign in as any musicianN@jam-match.local / password123')
  console.log('Or use magic-link against Inbucket (supabase status → Inbucket URL).')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
