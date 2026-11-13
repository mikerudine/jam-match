/**
 * telegram-auth — verify Telegram Login Widget / Mini App initData,
 * create-or-find a Supabase Auth user, upsert jam.profiles Telegram fields,
 * return a hashed_token the SPA can verifyOtp into a real session.
 *
 * Secrets (Dashboard / `supabase secrets set`, never in the repo):
 *   TELEGRAM_BOT_TOKEN
 * Auto-injected by Supabase:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  DEFAULT_MAX_AUTH_AGE_SECONDS,
  checkAuthDateFreshness,
  extractUserFromFields,
  fieldsFromWidgetUser,
  parseInitData,
  verifyTelegramHash,
  type TelegramAuthMode,
  type TelegramUserPayload,
} from './telegram_crypto.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYNTHETIC_EMAIL_DOMAIN = 'telegram.jam-match.local'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function syntheticEmail(telegramId: number): string {
  return `tg${telegramId}@${SYNTHETIC_EMAIL_DOMAIN}`
}

function displayNameFrom(user: TelegramUserPayload): string {
  const fromNames = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  return fromNames || user.username || `tg${user.id}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' })
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!botToken || !supabaseUrl || !serviceRoleKey) {
    console.error('Missing TELEGRAM_BOT_TOKEN or Supabase env')
    return json(500, { error: 'server_misconfigured' })
  }

  let body: {
    mode?: TelegramAuthMode
    initData?: string
    user?: Record<string, unknown>
  }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const mode: TelegramAuthMode =
    body.mode === 'webapp' || body.initData ? 'webapp' : 'widget'

  let fields: Record<string, string>
  if (mode === 'webapp') {
    if (!body.initData || typeof body.initData !== 'string') {
      return json(400, { error: 'missing_init_data' })
    }
    fields = parseInitData(body.initData)
  } else {
    if (!body.user || typeof body.user !== 'object') {
      return json(400, { error: 'missing_user' })
    }
    fields = fieldsFromWidgetUser(body.user)
  }

  const okHash = await verifyTelegramHash(fields, botToken, mode)
  if (!okHash) {
    return json(401, { error: 'invalid_hash' })
  }

  const tgUser = extractUserFromFields(fields, mode)
  if (!tgUser) {
    return json(400, { error: 'invalid_user_payload' })
  }

  if (
    !checkAuthDateFreshness(tgUser.auth_date, DEFAULT_MAX_AUTH_AGE_SECONDS)
  ) {
    return json(401, { error: 'auth_date_expired' })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const jam = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: 'jam' },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const email = syntheticEmail(tgUser.id)
  const metadata = {
    display_name: displayNameFrom(tgUser),
    telegram_id: tgUser.id,
    telegram_username: tgUser.username ?? null,
    telegram_first_name: tgUser.first_name ?? null,
    telegram_last_name: tgUser.last_name ?? null,
    telegram_photo_url: tgUser.photo_url ?? null,
  }

  // Prefer lookup by telegram_id on jam.profiles (stable across email changes).
  const { data: existingProfile } = await jam
    .from('profiles')
    .select('id')
    .eq('telegram_id', tgUser.id)
    .maybeSingle()

  let userId = existingProfile?.id as string | undefined

  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser(
      {
        email,
        email_confirm: true,
        user_metadata: metadata,
      },
    )

    if (createErr) {
      // Email already registered (re-login before telegram_id was on the profile).
      const { data: linkProbe, error: linkErr } =
        await admin.auth.admin.generateLink({
          type: 'magiclink',
          email,
        })
      if (linkErr || !linkProbe?.user) {
        console.error('createUser/generateLink failed', createErr, linkErr)
        return json(500, { error: 'user_upsert_failed' })
      }
      userId = linkProbe.user.id
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: metadata,
      })
    } else {
      userId = created.user!.id
    }
  } else {
    await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
      user_metadata: metadata,
    })
  }

  // Upsert Telegram fields on jam.profiles (trigger may have created a stub).
  const { error: profileErr } = await jam.from('profiles').upsert(
    {
      id: userId,
      display_name: displayNameFrom(tgUser),
      telegram_id: tgUser.id,
      telegram_handle: tgUser.username ?? null,
      telegram_first_name: tgUser.first_name ?? null,
      telegram_last_name: tgUser.last_name ?? null,
      telegram_photo_url: tgUser.photo_url ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (profileErr) {
    console.error('profile upsert failed', profileErr)
    return json(500, { error: 'profile_upsert_failed' })
  }

  // Issue a magic-link hashed_token the client can verifyOtp → real session.
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('generateLink failed', linkError)
    return json(500, { error: 'session_token_failed' })
  }

  return json(200, {
    token_hash: linkData.properties.hashed_token,
    email,
    user_id: userId,
    telegram: {
      id: tgUser.id,
      username: tgUser.username ?? null,
      first_name: tgUser.first_name ?? null,
      last_name: tgUser.last_name ?? null,
      photo_url: tgUser.photo_url ?? null,
    },
  })
})
