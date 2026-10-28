# Audit before v4 (2026-10-27)

Branch: `v4` from `main@68a5d39`. Baseline: `npx vitest run` → **67/67 pass**; `tests/e2e/e2e.mjs` → **121/121 pass**; `next build` clean; ESLint 0 problems. Production: v3 live, scheduler answering 200 every minute.

Scope reviewed: 163 source files — 34 pages, 14 API routes, 15 server-action modules, 4 migrations (40 tables, RLS on all), planner/dispatcher jobs, 40 Coach tools, scoring engine, Google sync, prayer, fitness, journal, accountability.

## 1. Functional (verified by tests or production)
Auth, onboarding, RLS isolation, export/erase/delete; morning/midday/evening interviews with follow-ups and skips; tasks, commitments, goals, habits; calendar with prep/travel; activity lifecycle and workouts; server-scheduled Web Push with delivery log; notification actions with idempotency; budget/pause/priorities; prayer times, confirmations, verse library; journal with guided modes; focus timer, impulse flow; money; scoring engine; Personal Evolution dashboard; Command Center timeline with drag rescheduling; memory approval; audit log.

## 2. Partially implemented
| Area | Gap |
|---|---|
| Day rollover | Server-rendered dates are correct on load, but an open Today page does not switch at midnight or after the device sleeps. |
| Recurring tasks | Tasks cannot repeat; only events and habits recur. |
| History | Integrity is recomputed with the current rules every time; no stored daily score or policy version per day. No modification history for tasks, commitments or activity outcomes. |
| Late confirmations | A completion recorded the next day is indistinguishable from one recorded on time. |
| Past-day view | `/today?date=` shows the timeline but not that day's journal, interview answers, workouts or stored score; tasks moved to another day disappear from the original day. |
| Time zones | Recurring events expand in the profile's *current* zone, so travelling shifts a 7 AM routine. Events crossing midnight appear only on their start day. |
| Lifecycle sweep | Only looks back 36 h; a scheduler outage longer than that leaves occurrences without records. |
| Google Calendar | Local edits are pushed inline; a failed push is marked `error` and never retried. |
| Fitness | Workouts have duration/type/intensity only — no exercises, sets, reps, loads, body weight or dedicated dashboard. |
| Coach voice | Mic button only; no state-driven visual. |

## 3. Nonfunctional / placeholder
None found in the UI. Features that need credentials (Coach, AI reflection, Google) say so explicitly. Native mobile and Apple Health / Health Connect: not started (blocked on an Apple Developer account and physical devices).

## 4. Critical bugs
1. **Confirmation race (Coach):** `decide()` checks `status = 'awaiting_confirmation'` then executes — two simultaneous "Confirm" taps can execute the action twice. Same for `undo()`.
2. **Time-zone bug in adaptive evening questions:** impulses and focus sessions are filtered with `YYYY-MM-DDT00:00:00Z` (UTC midnight), so in New York evening records count toward the wrong day.
3. **Coach request retry:** a network retry of the same message can run its tools again (no client idempotency key).

## 5. Performance
- Progress page loads up to ~400 days of records per view; acceptable now (single user), but trend windows recompute scores per point (≤ 60 points × 7 domains). Stored daily snapshots remove most of this for history.
- Timeline builds 8 queries per page; fine. Dispatcher budget counting does one count query per user per run — fine at current scale.

## 6. Data-integrity risks
- No revision history → an edited or reopened record loses its previous state.
- Postponed tasks overwrite `scheduled_for` (original preserved since v3 in `original_scheduled_for`, but the original day's view did not use it).
- Google push failures not retried (state drift between systems).

## 7. Security
- RLS on all 40 tables; service-role use confined to server files; OAuth tokens encrypted and column-restricted; cron endpoints require the bearer secret; no secrets in client bundles (E2E-verified).
- Risk: notification action log and audit log are server-written — correct. No new risks found. Recommend rate limiting on `/api/coach` (added in v4: per-user request id dedupe).

## 8. UI/UX inconsistencies
- Today lacks a live clock and prayer countdown; priorities not called out separately from the timeline.
- Tasks open inline forms rather than a consistent detail panel.
- Coach mic has no state feedback beyond color.

## 9. Missing tests
Rollover boundaries (midnight, week, month, year, DST, multi-day gaps, travel), recurring-task generation, cross-midnight events, revision logging, retrospective confirmations, confirmation race, outbox retries.

## 10. Plan (priority order)
1. Rollover + history: client day watcher; task series with idempotent per-day occurrences and gap reconciliation; event time zones; cross-midnight events; `daily_scores` snapshots with policy version; `record_revisions` triggers; retrospective confirmations; full past-day view; controlled-clock tests.
2. Bugs 1–3.
3. Today: live clock, prayer countdown, top-3 priorities, "plan my day", task detail panel with history and reminders.
4. Fitness: exercises/sets/reps/load, body metrics, `/fitness` dashboard.
5. Reliability: `job_runs` with health view, dead-letter visibility, Google sync outbox with retries.
6. Voice orb driven by real assistant states.
