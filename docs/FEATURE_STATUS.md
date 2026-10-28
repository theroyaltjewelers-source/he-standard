# Feature-status register

Statuses: **Not started · Implemented · Tested · Blocked · Requires credentials · Requires device testing · Production verified**.
"Tested" means covered by the automated suites: 88 unit tests (`npx vitest run`, including controlled-clock rollover/DST tests) and a 150-check end-to-end run (`tests/e2e/e2e.mjs`) against a local Postgres with the same schema and RLS, a real Web Push encryption round-trip, and a headless browser. "Production verified" lists the evidence.

Last updated: 2026-10-27 (v4 — see the v4 section below). Previously (v3): Production: migration `20261029000004_v3.sql` applied (all 3 new tables present, 0 public tables without RLS, 41 verses loaded); v3 build deployed — at 00:30 UTC on 28 Oct the scheduler's planner and dispatcher both answered 200 with the new v3 fields (`occurrences`, `awaiting_confirmation`, `paused`, `held`) and no errors.

## v4 — rollover, history, Today, fitness, reliability

| Feature | Status | Evidence / notes |
|---|---|---|
| Automatic midnight rollover with the app closed (server-side) | Tested | The 15-minute planner reconciles every user: generates recurring occurrences, records unresolved activities, finalizes ended days. E2E §9b simulates 3 days closed. |
| Reconcile after inactivity (back-fill up to 30 days) | Tested | `generationWindow` unit tests; E2E §9b (back-fill, idempotent re-run). |
| Recurring tasks: one record per day, never a checkbox that resets | Tested | `task_series` + unique (series_id, occurrence_date); yesterday's completion leaves today's untouched (E2E). Pause keeps history. |
| Time zones, DST (23/25 h days), month/year boundaries, cross-midnight events, travel | Tested | 16 controlled-clock unit tests; events keep their own zone; device-zone banner offers a switch (never silent). |
| Open app rolls over at local midnight / on wake | Implemented | `DayWatcher` refreshes at local midnight and on focus/visibility/online if the date changed. |
| Stored daily scores with policy version (final vs provisional) | Tested | `daily_scores`; past days show the stored score and policy, never silently recalculated. |
| Modification history for tasks, commitments, activities, events, workouts, prayers, habits | Tested | `record_revisions` trigger; users can read, not forge (E2E). |
| Late confirmations marked "reported later" | Tested | `confirmed_at` + `retrospective` on all confirmable records; E2E completes a past occurrence. |
| Previous-day navigator (exact record of that day) | Tested | Date picker; stored score, insight, check-in answers, workouts, journal, moved tasks. |
| Today: live clock, Hijri date, next prayer countdown, top-3 priorities, "Plan my day with the Coach" | Tested | E2E §9b. |
| Task detail panel: Start / Complete with evidence / Reschedule with conflicts / Not doing it / history / reminders / notes | Tested | E2E §4. |
| Day canvas: overlapping items in side-by-side lanes | Implemented | Found during v4 testing (items hid each other). |
| Fitness: exercises, sets, reps, loads, cardio time/distance, body weight, sleep, PRs (Epley e1RM), weekly consistency, volume | Tested | `/fitness`; unit tests for the math; E2E logs a session and a reading. |
| Apple Health / Health Connect import | **Blocked** | Not readable from a web app; requires the native app. Records carry `source` (manual/imported) for when it exists. |
| Scheduler run log and System health (Settings) | Tested | `job_runs` written by planner and dispatcher; Settings shows heartbeats, failed notifications, stuck syncs. |
| Google Calendar outbox with retries/backoff and dead-letter | Implemented | Failed pushes/deletes are queued (1 min → 6 h backoff, 8 attempts), shown in Settings with Retry. Needs Google credentials to verify live. |
| Atomic Coach confirmations; idempotent Coach requests | Tested | Three concurrent confirms execute once (E2E); `ai_requests` keyed by request id. |
| Voice orb driven by real states (idle, listening, processing, speaking, confirm, error) | Implemented | Reduced-motion fallback. Requires device testing for speech APIs. |

## Core

| Feature | Status | Evidence / notes |
|---|---|---|
| Sign-in, sessions, RLS isolation | Production verified | Live at he-standard.vercel.app; E2E §1, §10 (second account reads nothing, anon key reads nothing). |
| Onboarding, profile, time zone | Tested · Production verified | E2E §2; owner account onboarded in production. |
| Data export / erase / account deletion | Tested | E2E §10 (export includes v3 tables; erase empties every content table; deletion cascades). |
| Activity log (audit) | Tested | E2E §8g, §8h (memory approval, activity actions). |

## Accountability

| Feature | Status | Evidence / notes |
|---|---|---|
| Morning priorities (outcome, time, effort, obstacle, first action, conflicts) | Tested | E2E §3. |
| Midday check-in, skippable questions | Tested | E2E §3, §8b. |
| Evening review with adaptive questions and follow-ups | Tested | E2E §8. |
| Daily integrity score | Tested | E2E §9 checks the published formula (81). |
| **Deterministic scoring engine (policy 2026.10-1)** | Tested | 12 unit tests: unknown ≠ failure, late credit, original deadlines, coverage floor, determinism, no interpolation. `docs/SCORING.md`. |
| **Personal Evolution dashboard (7.1–7.12)** | Tested | E2E §8h asserts every section, policy version, insufficient-data states, period switch. Screenshots reviewed at 1440 px and 390 px (no horizontal overflow). |
| Evidence-based insight with "why" | Tested | Unit test (weekday weakness, silence without evidence). |
| Weekly report (matched / mismatched, sample sizes) | Tested · Production verified | E2E §8f; planner generates reports on the chosen day. |

## Daily Command Center

| Feature | Status | Evidence / notes |
|---|---|---|
| Unified timeline (events, workouts, tasks, commitments, prayers, focus, check-ins, prep/travel buffers) | Tested | E2E §8h. |
| Start / complete / running late / reschedule / skip with reason / excuse / notes / ask the Coach | Tested | E2E §8h (start, complete with workout details, reschedule with conflict). |
| Conflict detection before any move | Tested | E2E §8h: nothing saved until "Keep it anyway". |
| Drag-and-drop rescheduling (Day view) with confirmation; list alternative for touch/keyboard | Tested | E2E §8h drags an item 60 min in 15-min steps; original slot kept as "rescheduled". |
| Asks about prep/travel instead of assuming | Tested | E2E §5. |

## Notifications

| Feature | Status | Evidence / notes |
|---|---|---|
| Server-scheduled Web Push (works with the app closed) | Production verified | pg_cron → /api/cron/dispatch every minute, 200 responses logged in `net._http_response`; E2E §7 decrypts a real push. |
| Accountability lifecycle (prepare → start → did you start → did you finish → awaiting confirmation) | Tested | Unit tests (stages per level, relevance); E2E §8h (reminders generated, cancelled once answered, unanswered → awaiting confirmation via planner). |
| Notification actions (Start now, Completed, Running late, Remind me, Skip…, Reschedule) | Tested · Requires device testing | E2E §8h calls the action endpoint. Buttons render on Android/desktop; **iOS web push does not show action buttons** (tapping opens the right screen). |
| Idempotency keys | Tested | E2E §8h: same key twice → one workout log, second reply flagged duplicate. |
| Priority levels, daily budget, temporary pause, history, delivery troubleshooting | Tested | Unit tests; E2E §8h (budget holds extras + one notice; pause holds with reason; Reminders page shows checks/history/pause). |
| Quiet hours, categories, intensity, escalation | Tested | Unit tests; E2E §8g. |

## AI

| Feature | Status | Evidence / notes |
|---|---|---|
| Coach (tool use with confirmation, undo, audit) | Implemented · **Requires credentials** | Needs `ANTHROPIC_API_KEY` in Vercel. Tool policy unit-tested; new tools `record_activity`, `get_scores` (read-only scores). |
| AI follow-up questions, Reflect Deeper, weekly interpretation | Implemented · **Requires credentials** | Consent-gated; rule-based fallbacks tested. |
| Memory proposals with approval and sources | Tested | E2E §8g. |

## Faith

| Feature | Status | Evidence / notes |
|---|---|---|
| Prayer times, confirmations, follow-ups (never auto-missed) | Tested · Production verified | Unit tests (9); prayer reminders generated by the production planner once a location is set. |
| Verified Quran library | Production verified | Planner imported verses verbatim from api.alquran.cloud (Uthmani + Sahih International) — 15 per run until all 41 are loaded. |

## Integrations

| Feature | Status | Evidence / notes |
|---|---|---|
| Google Calendar two-way sync | Implemented · **Requires credentials** | Needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Imported events default to accountability "off". |
| Native iPhone / Android app (Expo) | **Blocked** | Requires an Apple Developer account and physical-device testing. The PWA covers the product today; native push with action buttons on iOS is the main gain. |

## Design system

| Feature | Status | Evidence / notes |
|---|---|---|
| Black / electric-lime tokens, Geist, bento cards, dark + light themes | Implemented · Tested | Screenshots reviewed; light theme exercised in E2E §8g. |
| Button states (loading, success, error, disabled, pressed, focus-visible) | Implemented | `.btn[data-state]`, `SubmitButton`. |
| Checklist completion only after server confirmation, with undo | Tested | E2E §4 (task completion persisted); toast with Undo. |
| Charts: tooltips (pointer, touch, keyboard), gaps not interpolation, empty/insufficient states, table view, screen-reader summaries | Implemented | Categorical palette validated: adjacent CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.3 on the dark surface. |
| Skeleton loading, page transitions, reduced motion, haptics toggle | Implemented | `loading.tsx` for Today and Progress; `prefers-reduced-motion` honoured globally. |

## Conflicts and resolutions

| Directive asks for | Resolution | Why |
|---|---|---|
| Monorepo (apps/web, apps/mobile, packages/*) | Kept one Next.js app; domain logic lives in framework-free modules (`src/lib/scoring`, `lifecycle`, `reminder-policy`, `insights`). | Native app is blocked; restructuring now would add risk without a second consumer. The modules are ready to move into packages. |
| shadcn/ui primitives | Hand-built components on shared tokens. | Existing components already cover the needs; avoids a parallel styling system. |
| `finance-bento.tsx` and reference screenshots | Not attached; the palette and layout follow the written specification. | Will be matched precisely once supplied. |
| Durable job processing | Postgres-backed queue (reminders table, `claim_due_reminders` with `FOR UPDATE SKIP LOCKED`, retries with backoff, stuck-job release) driven by pg_cron. | Jobs persist across deploys and restarts; no extra service. |
