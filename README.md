# Jam Match

Mobile-first SPA that auto-assembles jam / rehearsal line-ups for a local musicians’ community (~400 people, Kyiv · Podil). Ukrainian UI by default, English available.

Same packaging approach as *One Day in Kyiv / kyiv-slots* and *Intercom*: one static Vite + React + TypeScript build → GitHub Pages, later Telegram Mini App / iOS WKWebView / Android WebView. No SSR. Hash routing + relative `base` so the same bundle runs under any host path.

## Stack

- **Frontend:** Vite, React 19, TypeScript, Tailwind CSS 4, `react-router-dom` (HashRouter)
- **Backend:** Supabase (Postgres + Auth magic-link + RLS)
- **Matching:** Postgres RPCs (`process_jam_matching`, `respond_to_invite`, …) behind RLS

## Features (MVP)

1. Magic-link sign-in + profile (name, instruments, genres, level, areas, demo URL, Telegram handle)
2. Weekly availability grid (day × hour)
3. Create jam request (format, genres, wanted line-up, time window, area/base, invite TTL)
4. Matching + Inbox (Accept / Skip); expired invites cascade to the next candidate; scarce roles prioritized; confirmed jam shows contacts
5. After-jam 2-question feedback → reliability score (matching tiebreaker)

Auth is isolated behind `src/auth/` so Telegram `initData` can be added later without rewriting screens.

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
```

Migrations under `supabase/migrations/` apply automatically on `supabase start` / `supabase db reset`.

### 2. Seed fake musicians

```bash
npm run seed
```

Creates ~20 profiles (`musician01@jam-match.local` …) with password `password123`, evening availability, Podil-centric areas, and mixed instruments so matching has someone to invite.

The sign-in screen supports **password (local)** for these seed users, plus **magic link** (emails land in Mailpit / Inbucket — URL in `supabase status`).

### 3. Run the app

```bash
npm run dev
```

Open http://127.0.0.1:5173 — without env vars you’ll see the setup screen instead of a crash.

```bash
npm run build
npm run preview
```

## Supabase env / secrets

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env` / GitHub Actions secret | Project URL (baked in at **build** time) |
| `VITE_SUPABASE_ANON_KEY` | `.env` / GitHub Actions secret | Public anon key (RLS still applies) |

Never put the **service_role** key in the frontend. The seed script reads it from `supabase status` locally only.

### Apply migrations on a hosted project

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Or paste SQL from `supabase/migrations/` in the Supabase SQL editor. Enable Email auth (magic link) and add your GitHub Pages URL to Auth → Redirect URLs.

## Deploy (GitHub Pages)

1. Repo **Settings → Pages → Build and deployment → GitHub Actions**
2. Add Actions secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
3. Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds on `main` and deploys the `dist/` artifact
4. Add the Pages URL to Supabase Auth redirect allow-list

PR builds can run the same `npm ci && npm run build` without secrets; the setup screen is expected until secrets exist.

## Project layout

```
src/
  auth/           # AuthAdapter + Supabase magic-link implementation
  api/            # profiles, availability, jams / matching clients
  pages/          # screens
  i18n/           # uk (default) + en
supabase/
  migrations/     # schema, RLS, matching RPCs
  config.toml
scripts/seed.mjs  # local fake musicians
```

## Screenshots

See [`docs/screenshots/`](docs/screenshots/) (also attached on the PR): sign-in, home, availability grid, profile, new jam, jam detail (matching), inbox invite.

```bash
npm run seed
npm run dev   # another terminal
node scripts/screenshots.mjs
```

## Matching notes

`process_jam_matching` (callable by any signed-in user) expires stale invites, then for each open seat picks the next candidate who:

- plays the needed role
- has weekly availability covering the jam window (Europe/Kyiv)
- overlaps genres and preferred area
- has not already been invited / skipped for that seat

Ordering: **role scarcity** → genre overlap → **reliability_score**. Invite TTL defaults to a few hours (configurable per jam) because there is no push yet.
