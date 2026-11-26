# Jam Match — узкие места, риски и дополнения

Аудит по состоянию репозитория `jam-match` (SPA + schema `jam` + Edge Functions).  
Опирается на код, миграции и прод-поведение (в т.ч. инцидент с `list_browse_jams` → 500).

Связанный обзор модулей: [`PROJECT_INDEX.md`](../PROJECT_INDEX.md).

---

## 1. Узкие места (performance)

### 1.1. `jam.suggest_window_for_users` / `jam.suggest_jam_window`

Перебор ~28 дней × стартовые часы × продление окна; на каждом шаге — `user_free_at` для всех участников.

- На несколько человек это легко превращается в **сотни тысяч** проверок слотов на один вызов.
- Уже ломало прод: inline-вызов из `list_browse_jams` давал **PostgREST 500** → исправлено заглушками (`20261124153000_list_browse_jams_no_inline_suggest.sql`).
- Клиент снова множит нагрузку: `HomePage` после browse делает `suggest_jam_window` **на каждый** undated jam (`Promise.all`).

### 1.2. `jam.user_free_at` / `jam.user_covers_window`

На каждый `(user, date, hour)` — ветка jam-override vs профиль, overrides + slots.  
`user_covers_window` строит почасовой `generate_series` и для каждого часа зовёт `user_free_at` — линейно по длительности окна.

### 1.3. `jam.list_browse_jams`

На **каждую** строку ленты: два `COUNT` по seats, `user_covers_window` (если есть даты), `are_friends`, `jam_has_friend_participant`, `is_jam_participant`.  
Пагинации нет; потолок PostgREST `max_rows` не спасает от тяжёлого одного запроса.

### 1.4. `jam.process_jam_matching`

- ~~Глобальный `null` с Inbox/Home~~ — закрыто: `jam_id` обязателен, caller = participant (`20261126120100`).
- Остаётся: на каждый заход JamDetail / refresh по своим джемам — скан кандидатов + `user_covers_window` (уже scoped).

### 1.5. Клиентские round-trip’ы

| Место | Проблема |
| --- | --- |
| `HomePage.tsx` | N× `suggest_jam_window` после browse |
| `JamDetailPage.tsx` | `runMatching(jamId)` на каждый заход |
| `api/jams.ts` → `listInbox` | сначала глобальный matching, потом несколько select |
| `listMyJams` | несколько последовательных запросов вместо одного RPC |
| `getJamDetail` | jam + seats + profiles отдельными запросами |

### 1.6. `jam.get_jam_schedule_overlap`

Разумнее brute-force suggest, но при росте состава/слотов JSON-агрегация и lateral-counts тяжелеют; вызывается на карточке джема.

---

## 2. Возможные проблемы и риски

### 2.1. Безопасность и конфиденциальность

| Риск | Где | Почему |
| --- | --- | --- |
| ~~Утечка участников и ID~~ | `jam.suggest_jam_window` | Закрыто: `can_view_jam_suggest` + IDs/names только участникам (`20261126120000`). |
| PII в профилях | `jam.profiles` RLS `USING (true)` | Любой залогиненный читает чужие строки, в т.ч. `telegram_id`, handle, reliability; клиент часто делает `select *`. |
| ~~Глобальный matching~~ | `process_jam_matching` | Закрыто: `null` → exception; нужен participant. |
| Shared Auth | один Supabase-проект с другими схемами | Email `tg{id}@telegram.jam-match.local`; нет trigger на `auth.users` — профиль только через `ensure_profile` из SPA. |
| Webhook без JWT | `telegram-webhook` `verify_jwt = false` | Нужно для Telegram; при утечке `TELEGRAM_WEBHOOK_SECRET` — приём произвольных callback. |
| Anon key в бандле | Pages / Vite | Норма для Supabase, но защита = только RLS + GRANT на RPC. |
| Schema cache | `DROP FUNCTION` без `NOTIFY pgrst` | Часть миграций дропает сигнатуры; после деплоя возможен «function not found» / 500 до reload (как с browse). |

### 2.2. Модель данных и бизнес-логика

| Риск | Детали |
| --- | --- |
| Idea-jam без дат | `offer_next_for_seat` требует `window_start`/`window_end`; кнопка matching для undated почти no-op, хотя UX обещает матчинг «позже». |
| Accept join всегда `INSERT` seat | Не заполняет существующее open seat → дубли ролей / раздувание состава. |
| Unique только на pending join | `jam_join_requests_one_pending`; нет «один accepted на user×jam». |
| Статус `cancelled` | Есть в enum и i18n, **нет** RPC/UI отмены. |
| Feedback → `completed` | Только если `window_end < now()`; undated confirmed может «зависнуть». |
| Reliability | Дельта с feedback уходит на **других** участников, не на автора — легко геймить / выглядит несправедливо. |
| Invites без push | README: TTL короткий *«because there is no push yet»*; inbox без внешнего сигнала. |
| Notify soft-fail | Join Telegram (`jam-notify`) глотает ошибки; пользователь не видит, что организатор не получил сообщение. |

### 2.3. Клиент / UX

| Риск | Где |
| --- | --- |
| Нет `ErrorBoundary` | Непойманный throw роняет всё Mini App |
| `Promise.all` на Home | Падение `fetchProfile` / `listMyJams` валит весь reload (browse уже soft-fail) |
| Тихие `catch` на JamDetail | songs / locations / schedule / suggest → пустые блоки без объяснения |
| Deep link + HashRouter | `start_param` / `sessionStorage` починены частично; при уже открытом Mini App Telegram может не обновить `start_param` |
| CI lint `oxlint \|\| true` | Lint не блокирует merge |
| CI build без `VITE_*` | Собирает SetupScreen, не прод-конфиг |

### 2.4. Ops / деплой

- Pages деплоит только SPA; **Edge Functions не в CI** — ручной `supabase functions deploy`.
- Секреты размазаны: GitHub (`VITE_*`), Supabase Edge (`TELEGRAM_*`, service role).
- Realtime в `config.toml` выключен — live-обновления inbox/join только через ручной refresh.
- Нет e2e / pgTAP на критичные RPC; unit-тесты покрывают helpers, не RLS.

---

## 3. Необходимые дополнения

### 3.1. Продукт (уже намечено кодом / README)

1. **Telegram/push для matching-invites** — иначе TTL и Inbox слабо работают.
2. **Отмена джема** — RPC + UI для `cancelled`, уведомление участникам.
3. **Завершение idea-jam** — явный «завершить» / completed после feedback без `window_end`.
4. **Правило accept join** — заполнять open seat **или** явно «добавить роль»; unique accepted per user×jam.
5. **Статус доставки notify** — показать организатору/заявителю soft-fail; retry / очередь.
6. **Фоновый matching** (cron / queue), а не с каждого открытия Inbox/Home.

### 3.2. Engineering

1. **Gate на `suggest_jam_window`** — как у `get_jam_schedule_overlap` (participant + audience).
2. **Запретить/ограничить** `process_jam_matching(null)` для обычных пользователей; rate limit.
3. **Batch suggest** — `suggest_jam_windows(uuid[])` или материализация при смене availability; убрать N+1 с Home.
4. **Profiles:** view/RPC «публичный профиль» без `telegram_id`; сузить RLS.
5. **`list_browse_jams`:** пагинация, денормализованные counts или один join вместо correlated COUNT.
6. **ErrorBoundary** + явные ошибки секций на JamDetail.
7. **CI:** жёсткий lint/typecheck; smoke с секретами; `NOTIFY pgrst` чеклист в миграциях; деплой Edge в workflow.
8. **Интеграционные тесты RLS** (suggest, public jam, friends-only).
9. Индексы под seats `(jam_id, status)`, invites `(invitee_id, status)`, availability `(user_id, day_of_week, hour)`.

---

## 4. Приоритеты

### P0 — безопасность и стабильность

| # | Действие | Статус |
| --- | --- | --- |
| 1 | Authz в `suggest_jam_window` (browse-visibility; UUID только участникам). | done `20261126120000` |
| 2 | Запрет `process_jam_matching(null)`; только `jam_id` + participant. | done `20261126120100` |
| 3 | Снять N+1 `suggest` с Home browse (только свои undated). | done client |

### P1 — продукт и данные

| # | Действие |
| --- | --- |
| 4 | Скрыть `telegram_id` от чужих (`profiles` RLS / view). |
| 5 | Push/Telegram на invites. |
| 6 | Matching для idea-jam: либо даты обязательны в UI, либо suggest-based offer. |
| 7 | Accept join → fill open seat + unique accepted. |
| 8 | Видимый результат `jam-notify` (успех / skipped). |
| 9 | Алерт / retry на `ensure_profile` после Telegram auth. |

### P2 — качество и ops

| # | Действие |
| --- | --- |
| 10 | Отмена джема, completed для undated, доработка reliability. |
| 11 | ErrorBoundary, явные ошибки секций. |
| 12 | CI без `\|\| true`, тесты RPC, автодеплой Edge. |
| 13 | Revoke лишних `GRANT … TO anon`; defense in depth. |
| 14 | Рефактор `suggest_window_for_users` (precompute сетки / лимит горизонта). |

---

## 5. Быстрый чеклист «что смотреть первым»

```
[x] suggest_jam_window — gate + strip IDs for non-participants (20261126120000)
[x] listInbox / Home — нет process_jam_matching(null); только jam_id + participant (20261126120100)
[x] Home — suggest только для *моих* undated (не весь browse feed)
[ ] profiles select * — утекает ли telegram_id (P1)
[ ] jam-notify — видит ли юзер skipped (P1)
[ ] cancelled / completed undated — есть ли путь в UI (P2)
[ ] CI lint реально failит? (P2)
[ ] После DROP FUNCTION — есть NOTIFY pgrst? (P2)
```

---

*Документ можно обновлять по мере закрытия пунктов; при крупных миграциях дополнять секцию 1 фактическими замерами (`explain analyze`, latency PostgREST).*
