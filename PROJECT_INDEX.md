# PROJECT_INDEX — Jam Match

Mobile-first SPA (Vite + React 19 + TS) for jam/rehearsal matching. Backend: Supabase schema `jam` + Edge Functions. Static build → GitHub Pages / Telegram Mini App. Alias `@` → `src/`.

**Core entities:** Profile · Event (jam) · Location · Friendship (Telegram `fr_<hex>` = immediate friend).  
**Jam `audience`:** `open` (feed + match) · `friends` (fr_ circle) · `invite` (jam link only, no feed/auto-match).

**Risks / gaps:** [`docs/RISKS_AND_GAPS.md`](docs/RISKS_AND_GAPS.md) — bottlenecks, security/product holes, P0–P2 checklist.

## Entry Points

| Path | Role |
| --- | --- |
| `src/main.tsx` | SPA bootstrap: strip `#tgAuthResult`, capture Mini App `start_param`, mount `App` |
| `src/App.tsx` | `HashRouter` + auth gate; routes `/`, `/inbox`, `/availability`, `/profile`, `/jams/new`, `/jams/:jamId`; DEV `/dev/*-preview` |
| `src/auth/AuthContext.tsx` | `AuthProvider` / `useAuth()` — session + `ensureProfile` after sign-in |
| `src/auth/supabaseAuth.ts` | `createSupabaseAuthAdapter(): AuthAdapter` — Telegram + optional email |
| `supabase/functions/telegram-auth/index.ts` | `Deno.serve` — verify widget/initData → Auth user + `token_hash` |
| `supabase/functions/jam-notify/index.ts` | `Deno.serve` POST `{ request_id }` — Telegram join/decision messages |
| `supabase/functions/telegram-webhook/index.ts` | `Deno.serve` — bot callbacks Accept/Decline join |
| `src/api/*.ts` | Client data layer → Supabase tables/RPCs (`profile`, `jams`, `songs`, `locations`, …) |
| `scripts/seed.mjs` | Seed ~20 musicians for local matching |
| `package.json` | CLI: `dev`, `build`, `test`, `seed`, `db:*`, `screenshots*` |

**Key RPCs (schema `jam`):** `ensure_profile`, `create_jam_request`, `update_jam_request`, `process_jam_matching`, `respond_to_invite`, `request_to_join`, `respond_to_join_request`, `respond_to_join_request_as`, `get_public_jam`, `submit_jam_feedback`, `set_telegram_write_access`.

**Routes → pages:** `HomePage`, `InboxPage`, `AvailabilityPage`, `ProfilePage`, `NewJamPage`, `JamDetailPage`, `SignInPage`.

## Module Map

```
src/
  api/           Client API: profiles, availability, jams, songs, locations, notify.
  auth/          AuthAdapter, Telegram widget parsing, React auth context.
  components/    Shared UI (Layout, join/song/location/edit panels, Telegram button).
  i18n/          LocaleContext + uk/en dictionaries.
  lib/           Config, Supabase client, deep links, song/location helpers, utils.
  pages/         Route screens + DEV preview pages for screenshots.
  types.ts       Domain unions/interfaces shared by UI + API.
  App.tsx        Routing shell.
  main.tsx       Bootstrap.
supabase/
  migrations/    Schema `jam` tables, RLS, matching/join RPCs.
  functions/     Edge: telegram-auth, jam-notify, telegram-webhook + _shared.
  templates/     Auth email HTML (magic link).
scripts/         Seed + Playwright screenshot generators.
public/          Static assets for Pages.
docs/            Screenshots / visual docs.
.github/workflows/  CI (lint/test/build) + deploy-pages.
```

## Key Data Models & Schemas

**TS domain — `src/types.ts`**

- Unions: `Instrument`, `Level`, `JamFormat`, `JamStatus`, `SeatStatus`, `InviteStatus`, `JoinRequestStatus`, `Locale`
- Interfaces: `Profile`, `AvailabilitySlot`, `JamRequest`, `JamSeat`, `JamJoinRequest`, `PublicJam`, `JamInvite`, `JamFeedback`, `InboxInvite`, `ConfirmedMember`
- Helpers (signatures only): `isJamOpenForJoin(...)`, `isJamArchived(...)`, `jamDisplayTitle(...)`

**Auth — `src/auth/types.ts`:** `AuthUser`, `AuthSession`, `TelegramWidgetUser`, `AuthAdapter`

**Songs — `src/lib/songList.ts`:** `SongRow`, `SongVoteRow`, `SongListItem`, `VoteValue`; `buildSongList(...)`

**Locations — `src/lib/locationList.ts`:** `Location`, `LocationProposalRow`, `LocationVoteRow`, `LocationListItem`, `CreateLocationInput`; `buildLocationList(...)` (max 2 / user)

**API inputs — `src/api/`:** `CreateJamInput`, `UpdateJamInput` (`jams.ts`); `EnsureProfileInput` (`profile.ts`); `JamSongList` (`songs.ts`); `JamLocationList` (`locations.ts`)

**DB — schema `jam` (`supabase/migrations/`)**

| Table | Purpose |
| --- | --- |
| `profiles` | Musician profile + Telegram fields + reliability |
| `availability_slots` | Weekly day×hour grid (Mon=0…Sun=6) |
| `jam_requests` | Jam request (theme, format, window, status) |
| `jam_seats` | Needed roles / filled seats |
| `jam_invites` | Matching invites + TTL |
| `jam_join_requests` | Open join requests |
| `jam_feedback` | Post-jam ratings |
| `jam_songs` / `jam_song_votes` | Per-jam song list + ±1 votes |
| `locations` | Catalog: name, address, url, price_per_hour?, comment? |
| `jam_location_proposals` / `jam_location_votes` | Per-jam location options + ±1 votes |

Enums mirror TS unions (`jam.instrument`, `jam.jam_status`, …). Timestamps: `timestamptz` (UTC storage).

**Edge shared — `supabase/functions/_shared/`:** `JoinRequestNotifyInput`, `ParsedJoinCallback`, Telegram API helpers.

## Conventions & Helpers

- **Schema:** all app tables/RPCs in `jam`; client via `getSupabase()` with `db: { schema: 'jam' }` (`src/lib/supabase.ts`). No triggers on `auth.users` — call `ensure_profile` after sign-in.
- **Errors:** API modules `if (error) throw error` (Supabase `PostgrestError`); `notifyJoinRequest` is best-effort (warn, never throw).
- **Logging:** no shared logger — `console.warn` / `console.error` in Edge + soft client paths.
- **Time:** DB `timestamptz` / client `toISOString()` (UTC); Telegram copy formatted in `Europe/Kyiv` (`formatJamWindowUk`).
- **i18n:** default `uk`, switch via `LocaleProvider`; strings in `src/i18n/translations.ts`.
- **Config:** `VITE_SUPABASE_*`, `VITE_TELEGRAM_BOT_USERNAME`, optional `VITE_ENABLE_EMAIL_LOGIN` (`src/lib/config.ts`); bot token only as Edge secret.
- **Path alias:** `@/...` → `src/...` (`vite.config.ts`).
- **Routing:** `HashRouter` + `base: './'` for Pages / WebView.
- **Utils:** `cn(...)`, `slotKey` / `parseSlotKey`, seat labels (`src/lib/utils.ts`).
- **Caching:** none beyond Supabase Auth session persistence.
- **Tests:** Node native test runner (`npm test`) — crypto, deep links, song list, join_notify.

## Quick Workflows

1. **New jam feature (create → match → inbox)**  
   UI page/component → `src/api/jams.ts` (`createJam` / `runMatching` / `respondToInvite`) → RPC in `supabase/migrations/` → types in `src/types.ts` → cover path in page + `npm test` if pure helper.

2. **New join / Telegram notify path**  
   Client: `requestToJoin` / `respondToJoinRequest` + `notifyJoinRequest` → Edge `jam-notify` / `telegram-webhook` → shared copy/keyboard in `_shared/join_notify.ts` → secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`.

3. **New API-facing data call**  
   Add/extend function in `src/api/<domain>.ts` → table or RPC under schema `jam` → mirror fields in `src/types.ts` (or `songList.ts` / `locationList.ts`) → wire page/component → optional unit test next to helper.

4. **Jam locations**  
   Catalog `locations` → propose via `jam_location_proposals` (`addJamLocation`) → vote like songs (`LocationSection` / `LocationDraftPicker` on create).
