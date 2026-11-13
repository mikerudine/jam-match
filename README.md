# Jam Match

Mobile-first SPA that auto-assembles jam / rehearsal line-ups for a local musicians’ community (~400 people, Kyiv). Ukrainian UI by default, English available.

Same packaging approach as *One Day in Kyiv / kyiv-slots* and *Intercom*: one static Vite + React + TypeScript build → GitHub Pages, later Telegram Mini App / iOS WKWebView / Android WebView. No SSR. Hash routing + relative `base` so the same bundle runs under any host path.

## Stack

- **Frontend:** Vite, React 19, TypeScript, Tailwind CSS 4, `react-router-dom` (HashRouter)
- **Backend:** shared Supabase project **kyiv-air-raid-alerts** (`maqdxmetyzpyupivyecz`), dedicated Postgres schema **`jam`** (same multi-app pattern as schema `rebuild`)
- **Auth:** Telegram Login Widget (website) + Telegram Mini App `initData` (same build), verified in Edge Function `telegram-auth`; email/password only behind a local dev flag
- **Matching:** RPCs in schema `jam` (`process_jam_matching`, `respond_to_invite`, …) behind RLS
- **Client:** `createClient(..., { db: { schema: 'jam' } })` — URL/anon key only via `VITE_SUPABASE_*` env

## Features (MVP)

1. Telegram sign-in + profile (name, instruments, genres, level, areas, demo URL; Telegram @username is the default contact on a confirmed jam)
2. Weekly availability grid (day × hour)
3. Create jam request (format, genres, wanted line-up, time window, area/base, invite TTL)
4. Matching + Inbox (Accept / Skip); expired invites cascade to the next candidate; scarce roles prioritized; confirmed jam shows contacts
5. After-jam 2-question feedback → reliability score (matching tiebreaker)
6. Per-jam song / cover list: participants add up to 10 songs each, +1/−1 votes, sorted by score with veto highlights
7. Open join requests (any role) + Telegram notify to the organizer with inline Accept / Decline (`@jammatch_bot`)

Auth lives behind `src/auth/` (`AuthAdapter`). Production path is Telegram; seed/email login is opt-in via `VITE_ENABLE_EMAIL_LOGIN=true`.

## Quick start (local)

### Prerequisites

- Node 22+
- Docker (for `supabase start`)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase` is fine)

### 1. Install & start Supabase

```bash
npm ci
npx supabase start
```

Copy the **API URL** and **anon key** from the CLI output into `.env`:

```bash
cp .env.example .env
# VITE_SUPABASE_URL=http://127.0.0.1:54321
# VITE_SUPABASE_ANON_KEY=<anon key from supabase status>
# VITE_TELEGRAM_BOT_USERNAME=<bot from @BotFather>
# VITE_ENABLE_EMAIL_LOGIN=true   # show seed email/password on sign-in
```

Migrations under `supabase/migrations/` apply automatically on `supabase start` / `supabase db reset`.

### 2. Seed fake musicians

```bash
npm run seed
```

Creates ~20 profiles (`musician01@jam-match.local` …) with password `password123`, evening availability, Podil-centric areas, and mixed instruments so matching has someone to invite.

With `VITE_ENABLE_EMAIL_LOGIN=true`, the sign-in screen shows **password (local)** for these seed users, plus **magic link** (emails land in Mailpit / Inbucket — URL in `supabase status`). Without the flag, only Telegram is shown.

### 3. Run the app

```bash
npm run dev
```

Open http://127.0.0.1:5173 — without env vars you’ll see the setup screen instead of a crash.

```bash
npm run build
npm run preview
npm test   # Telegram hash verification (widget + Mini App)
```

## Telegram auth setup

Musicians sign in with Telegram (Supabase free-tier email OTP is rate-limited and not usable for ~400 people).

### 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) → `/newbot` → pick a name and username (e.g. `JamMatchBot`).
2. Copy the **bot token** — this is `TELEGRAM_BOT_TOKEN` (Edge Function secret only; never commit it, never put it in `VITE_*`).
3. `/setdomain` → select the bot → set `mikerudine.github.io` (required for the Login Widget on GitHub Pages).
4. Optional for Mini App later: `/newapp` / BotFather Mini App settings pointing at the Pages URL.

### 2. Edge Function secrets + deploy (manual — agents do not deploy)

```bash
# After supabase link --project-ref maqdxmetyzpyupivyecz
npx supabase secrets set TELEGRAM_BOT_TOKEN=123456:AA… --project-ref maqdxmetyzpyupivyecz
# Random secret for Telegram → telegram-webhook (also passed to setWebhook):
npx supabase secrets set TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)" --project-ref maqdxmetyzpyupivyecz
# Optional override (default jammatch_bot):
# npx supabase secrets set TELEGRAM_BOT_USERNAME=jammatch_bot --project-ref maqdxmetyzpyupivyecz

npx supabase functions deploy telegram-auth --project-ref maqdxmetyzpyupivyecz
npx supabase functions deploy jam-notify --project-ref maqdxmetyzpyupivyecz
npx supabase functions deploy telegram-webhook --project-ref maqdxmetyzpyupivyecz
```

Locally (optional):

```bash
npx supabase functions serve --env-file supabase/.env.local
# supabase/.env.local should contain TELEGRAM_BOT_TOKEN=… and TELEGRAM_WEBHOOK_SECRET=…
```

`telegram-auth` verifies the Telegram hash server-side:

| Mode | Secret key | When |
| --- | --- | --- |
| Login Widget | `SHA256(bot_token)` then HMAC-SHA256 | Website widget callback |
| Mini App | `HMAC_SHA256(bot_token, key="WebAppData")` | `window.Telegram.WebApp.initData` |

It also checks `auth_date` freshness (24h), creates/finds a Supabase Auth user (`tg<id>@telegram.jam-match.local` + Telegram fields in `user_metadata`), and returns a `token_hash` the client exchanges via `verifyOtp`. The SPA then calls **`jam.ensure_profile()`** (security definer, idempotent, `auth.uid()`) to create/update `jam.profiles` — there is **no trigger on `auth.users`** (auth is shared with other apps in this project).

### Join-request Telegram notify

When someone calls `jam.request_to_join`, the SPA invokes Edge Function **`jam-notify`** (user JWT) with the new request id. That function loads the request with the service role, checks the caller is the requester, and `sendMessage`s the jam initiator (Ukrainian text + inline **Прийняти** / **Відхилити** + Mini App URL). After `jam.respond_to_join_request` (or an inline-button decision), the requester gets a decision DM. Notify failures are soft — the join RPC still succeeds.

Inline buttons are handled by **`telegram-webhook`** (`verify_jwt = false`). Telegram posts updates with header `X-Telegram-Bot-Api-Secret-Token`, which must match secret **`TELEGRAM_WEBHOOK_SECRET`**. The webhook maps `callback_query.from.id` → `jam.profiles.telegram_id`, runs **`jam.respond_to_join_request_as`** (service_role only), edits the message, and notifies the requester.

Bot write access: Login Widget uses `data-request-access="write"`; Mini App calls `Telegram.WebApp.requestWriteAccess()` once after sign-in and stores `jam.profiles.telegram_write_access` via `jam.set_telegram_write_access`.

#### One-time `setWebhook` (manual — agents do not call this)

```bash
# Use the same secret you stored as TELEGRAM_WEBHOOK_SECRET
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://maqdxmetyzpyupivyecz.supabase.co/functions/v1/telegram-webhook",
    "secret_token": "'"${TELEGRAM_WEBHOOK_SECRET}"'",
    "allowed_updates": ["message", "callback_query"]
  }'
```

### 3. Frontend build variable

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_TELEGRAM_BOT_USERNAME` | `.env` / GitHub Actions secret | Bot username **without** `@` for the Login Widget |
| `VITE_TELEGRAM_APP_NAME` | `.env` / optional Actions **variable** (not a secret) | Named `/newapp` short name. **Empty (default)** → Main Mini App `t.me/<bot>?startapp=…`; set only for `t.me/<bot>/<app>?startapp=…` |

Add the bot username secret in repo **Settings → Secrets and variables → Actions**, and wire it into [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

Jam detail **Share in Telegram** builds `https://t.me/<bot>?startapp=jam_<uuid-without-dashes>` (Main Mini App). Opening that link launches the Mini App with `start_param`; after initData auto-login the app navigates to `/jams/:id`.

## Supabase env / secrets

Target project: **kyiv-air-raid-alerts** (`maqdxmetyzpyupivyecz`). All app tables/RPCs are in schema **`jam`** — migrations never create objects in `public` / `rebuild`.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env` / GitHub Actions secret | Project URL (baked in at **build** time), e.g. `https://maqdxmetyzpyupivyecz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `.env` / GitHub Actions secret | Public anon key (RLS still applies) |
| `VITE_TELEGRAM_BOT_USERNAME` | `.env` / GitHub Actions secret | Telegram bot username for the Login Widget |
| `VITE_ENABLE_EMAIL_LOGIN` | `.env` only (dev) | `true` → show email/password UI for seed accounts |
| `TELEGRAM_BOT_TOKEN` | Edge Function secret | Bot token for hash verification + outbound messages — **never** in the frontend or git |
| `TELEGRAM_WEBHOOK_SECRET` | Edge Function secret | Shared with Telegram `setWebhook` `secret_token`; checked on `telegram-webhook` |
| `TELEGRAM_BOT_USERNAME` | Edge Function secret (optional) | Bot username without `@` for Mini App deep links (default `jammatch_bot`) |

Never put the **service_role** key or bot token in the frontend. The seed script reads the service role from `supabase status` locally only.

### Hosted project checklist (do this manually — agents do not apply live)

1. **Expose schema `jam`:** Dashboard → Project Settings → API → **Exposed schemas** → add `jam` (required for PostgREST / supabase-js).
2. Apply SQL from `supabase/migrations/` (SQL editor or `supabase db push` after `supabase link --project-ref maqdxmetyzpyupivyecz`), including `20261113230000_join_telegram_notify.sql`.
3. Set secrets `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`, deploy `telegram-auth`, `jam-notify`, `telegram-webhook` (see above).
4. Call Telegram `setWebhook` once (URL + `secret_token` + `allowed_updates` — see above).
5. BotFather `/setdomain` → `mikerudine.github.io`.
6. Email auth can stay enabled for local/seed; community users use Telegram.

## Deploy (GitHub Pages)

1. Repo **Settings → Pages → Build and deployment → GitHub Actions**
2. Add Actions secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT_USERNAME`
3. Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds on `main` and deploys the `dist/` artifact
4. Ensure BotFather domain matches the Pages host

PR builds can run the same `npm ci && npm run build` without secrets; the setup screen is expected until secrets exist.

## Project layout

```
src/
  auth/           # AuthAdapter — Telegram + optional email
  api/            # profiles, availability, jams / matching clients
  pages/          # screens
  i18n/           # uk (default) + en
supabase/
  migrations/     # schema jam only, RLS, matching RPCs
  functions/
    telegram-auth/     # hash verify → session token_hash
    jam-notify/        # client JWT → Telegram DM (join / decision)
    telegram-webhook/  # Bot updates (callbacks + /start)
    _shared/           # message formatting / callback parsing
  config.toml
scripts/seed.mjs  # local fake musicians
```

## Screenshots

See [`docs/screenshots/`](docs/screenshots/) (also attached on the PR): sign-in (Telegram), home, availability grid, profile, new jam, jam detail (matching), inbox invite.

```bash
npm run seed
VITE_ENABLE_EMAIL_LOGIN=true npm run dev   # another terminal
node scripts/screenshots.mjs
```

## Matching notes

`process_jam_matching` (callable by any signed-in user) expires stale invites, then for each open seat picks the next candidate who:

- plays the needed role
- has weekly availability covering the jam window (Europe/Kyiv)
- overlaps genres and preferred area
- has not already been invited / skipped for that seat

Ordering: **role scarcity** → genre overlap → **reliability_score**. Invite TTL defaults to a few hours (configurable per jam) because there is no push yet.
