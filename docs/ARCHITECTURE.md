# The Standard — Architecture, Data Model and UX

This document is for review. It describes what is built in Phase 1, how it works, and how Phases 2–4 attach to it. Where something is not built yet, it says so.

---

## 1. System overview

```
 Phone / desktop (installable web app)
 ┌────────────────────────────────────────────┐
 │ Next.js pages (server-rendered)            │
 │ Service worker  ── receives push, reports  │
 │                    "displayed"/"clicked"   │
 └───────────────┬────────────────────────────┘
                 │ HTTPS, session cookie
 ┌───────────────▼────────────────────────────┐
 │ Next.js server on Vercel                   │
 │  • Server Actions (all writes)             │
 │  • /api/cron/dispatch  send due reminders  │
 │  • /api/cron/plan      generate upcoming   │
 │  • /api/push/*, /api/export                │
 │  • Claude calls (server only)              │
 └───────┬───────────────┬──────────────┬─────┘
         │               │              │
 ┌───────▼──────┐ ┌──────▼──────┐ ┌─────▼──────────────┐
 │ Supabase     │ │ Web Push    │ │ Anthropic API      │
 │ Auth + Postgres│ (Apple/Google│ │ (only when AI      │
 │ RLS on every │ │  /Mozilla)  │ │  consent is on)    │
 │ table        │ └─────────────┘ └────────────────────┘
 │ pg_cron ─────┼──► calls /api/cron/* every minute / 15 min
 └──────────────┘
```

**Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Supabase (Auth + PostgreSQL), Web Push with VAPID keys, Anthropic SDK (server only), Vercel hosting. Mobile-first PWA.

**Why these choices**

- *Server Actions for every write.* Forms post to code on the server, which talks to the database as the signed-in user. No database keys or business logic live in the browser.
- *Row-level security (RLS) on every table.* Even if application code had a bug, the database itself refuses to return or modify another user's rows. This was tested with two accounts (see §8).
- *Supabase pg_cron as the scheduler.* It runs inside the database, so reminders do not depend on any device being open, on Vercel's paid cron tier, or on a separate service. Vercel's free daily cron runs the planner as a backup.
- *Web Push, not in-app messages.* Notifications are sent by the server to Apple/Google/Mozilla push services, which deliver to the device even when the app is closed.

---

## 2. Data model

All tables live in `public`, carry `user_id` (FK to `auth.users`, `on delete cascade`), and have four RLS policies (select/insert/update/delete where `user_id = auth.uid()`). Deleting the auth user deletes everything.

| Table | Purpose | Key fields |
|---|---|---|
| `profiles` | One row per user, created by trigger on sign-up | timezone, check-in times, quiet hours, focus areas, challenges, Hijri adjustment, prayer location (Phase 3), **ai_analysis_consent** (default off) |
| `goals` | Long-term goals, monthly milestones, weekly objectives | horizon, area, desired_outcome, success_criteria, target_date, obstacles, recovery_plan, parent_goal_id |
| `goal_progress` | Progress history | note, evidence, progress_pct |
| `habits` / `habit_logs` | Habits with flexible weekly targets and rest days | target_per_week, rest_days; log status done/skipped/rest |
| `tasks` | Daily checklist and deadlines | scheduled_for, due_at, is_top_priority (max 3/day), status, **verification**, evidence, miss_reason, **postponed_count** |
| `commitments` | Promises with a time (from the morning interview or manual) | promised_by, made_to, status open/kept/kept_late/broken/released, verification, evidence, failure_context |
| `events` | Appointments | starts_at, prep_minutes, travel_minutes, reminder_offsets, importance, recurrence, plan_confirmed_at, external_source/id (for Google Calendar later) |
| `reminders` | Every scheduled notification | send_at, respect_quiet_hours, status, attempts, dedupe_key (unique per user) |
| `push_subscriptions` | One per device | endpoint, keys, last_success_at, failure_count |
| `notifications` | Delivery log, one row per device per send | status pending → accepted / failed → displayed → clicked |
| `journal_entries` | Private journal | body, mood, energy, tags, input_method, per-entry **ai_analysis_allowed**, generated full-text `search` column |
| `daily_plans` | Morning intention and plan | intention, avoid_behavior, character_plan, spiritual_intention |
| `accountability_sessions` / `accountability_answers` | Morning and evening interviews | question, answer, follow_up_question, follow_up_answer, follow_up_source (rule/ai) |
| `ai_memory` | Editable memory (written by Phase 2) | **kind: verified_fact / self_report / hypothesis**, content, source, status |
| `ai_observations` | Pattern observations with evidence (Phase 2) | observation, evidence (json), status pending/accepted/dismissed |
| `weekly_reviews` | Sunday reviews (Phase 2) | **metrics** (measured) kept separate from **interpretation** (AI) |

**Server-owned fields.** Users cannot forge delivery results:

- A database trigger stops a signed-in user from setting a reminder's status to anything except `scheduled` or `cancelled`. Only the server (service role) can mark one `sent`.
- Users have no insert/update permission on `notifications`. A device can move its own row to `displayed`/`clicked` only through the `ack_notification` function.
- `claim_due_reminders` (atomic, `for update skip locked`) and `release_stuck_reminders` can only be executed by the service role.

---

## 3. Reminders and notifications

**Generation.** Every reminder has a stable `dedupe_key`, so the planner can run repeatedly without duplicates. Editing the source item deletes its future reminders and regenerates them.

| Source | Reminders |
|---|---|
| Appointment | "Start preparing" at start − travel − prep; "Leave now" at start − travel; each chosen offset (15 min … 1 day); for important appointments, 7 PM the evening before. Past times are dropped; reminders within 2 minutes of each other are merged. |
| Recurring appointment | Occurrences expanded 8 days ahead, rolled forward by the planner every 15 minutes. Local wall-clock time is kept across daylight-saving changes. |
| Commitment | One hour before the promised time: "You committed to this. Are you still on track?" |
| Task with a deadline | 30 minutes before. |
| Task postponed twice or more | 10 AM on the new day: "What obstacle is preventing you from starting?" |
| Check-ins | Morning and evening at the user's chosen times. |
| Custom | Any text at any time. |

**Dispatch (every minute).** Claim due reminders → skip any that are no longer relevant (task done, commitment resolved, check-in already completed, item deleted) → skip any more than 6 hours late → defer to the end of quiet hours if the reminder respects them → send to every registered device → record the result.

**What "sent" means — honestly.**

| Status shown | Meaning |
|---|---|
| Accepted by push service | Apple/Google/Mozilla returned HTTP 201. This is the strongest guarantee available to a server. |
| Shown on the device | The device's service worker reported that it displayed the notification. |
| Opened | The user tapped it. |
| Failed / Not sent — no device | Exactly that, with the error. Failed sends retry up to 3 times with backoff. Expired subscriptions (404/410) are removed. |

The app never shows "delivered" unless a device confirmed it.

**Quiet hours.** General nudges (postponement questions, the evening-before heads-up, custom reminders that opt in) wait until quiet hours end. Appointment, commitment and check-in reminders are tied to a time you chose, so they arrive on time.

**iPhone.** Web Push works on iOS 16.4+ only when the app is added to the Home Screen and opened from there. The app detects this and says so.

---

## 4. Accountability system

**Morning interview.** Up to three commitments, each with a completion time and who it was promised to, plus: obstacles, the if-then plan, the behavior to avoid, how honesty/patience/discipline will show, spiritual intention, and a one-line intention for the dashboard.

**Evening interview.** Step 1: record each commitment as kept, kept late, not kept (requires what happened immediately before), or released by agreement; resolve tasks. The review cannot be finished while a commitment is unrecorded. Step 2: evidence; what happened before any failure; avoided discomfort; honest communication; emotions; unnecessary spending; time lost to distraction; one change for tomorrow.

**Vague answers.** Every required answer is checked by transparent rules (empty, too short, or a vague phrase such as "I was busy", "something came up", "forgot", "no time"). A vague answer produces a respectful follow-up — for "I was busy": *"What specifically occupied your time? Walk through the main blocks of the day."* The user's answer to the follow-up is stored next to the question. Honest short answers ("Nowhere", "0") are accepted where they make sense. If AI consent is on and an API key is configured, Claude writes the follow-up instead, under a system prompt that forbids shaming, moralising, diagnosing, or implying dishonesty; the stored answer records whether the follow-up came from a rule or from Claude.

### Daily Integrity Score

Measures recorded behaviour, not worth. The rules are shown in the app under "How this is calculated".

| Item | Credit |
|---|---|
| Commitment kept on time, with evidence | 100% |
| Kept on time, self-reported | 80% |
| Kept late | 60% with evidence, 50% self-reported |
| Not kept, reported with what happened before | 30% |
| Not kept, reported without context | 20% |
| Unresolved | 0% |
| Released by agreement / cancelled task | not counted |

- Commitments carry 55%, tasks 30% (if only one kind exists it carries the full 85%).
- Honest reporting is a fixed 15%: half for completing the evening review, half for the share of items resolved. Being honest about a bad day can never outweigh the day — an all-missed day honestly reported scores about 40.
- No commitments or tasks → no score. The app shows a dash, not a number.
- Before the day closes, the score is marked provisional and open items count as zero.

"With evidence" means you recorded specific evidence. It is still your report; the app does not claim to have verified it. The label "system-verified" is reserved for completions the app observes itself (e.g. a completed focus session in Phase 3).

---

## 5. AI design (Phase 2 hooks already in place)

- API key read only on the server (`src/lib/ai.ts` imports `server-only`; the build fails if a client component imports it).
- Nothing is sent to Anthropic unless the user has turned on AI analysis. Individual journal entries can be excluded even then.
- `ai_memory` separates **verified facts** (computed from data), **self-reports**, and **hypotheses**. The Memory page lets the user add, edit, archive, reject, or delete each one, or delete all.
- Weekly reviews store `metrics` (measured) and `interpretation` (AI) in separate columns so the UI can always label them differently, and can say "insufficient evidence" when metrics are thin.

---

## 6. Privacy and security

- Row-level security on every table; verified with two accounts and the anonymous key.
- Supabase encrypts data at rest (AES-256) and in transit (TLS). Journal text is not additionally field-encrypted: that would disable full-text search. If you later want journal bodies unreadable even to someone with database access, the option is client-side encryption with a passphrase, at the cost of server-side search and AI analysis.
- Secrets (service-role key, VAPID private key, cron secret, Anthropic key) exist only in server environment variables. Tested: none appear in page HTML.
- Cron endpoints require `Authorization: Bearer CRON_SECRET` (constant-time comparison).
- Export: a complete JSON download of every record (device push keys omitted).
- Erase: removes every record and keeps the account. Delete account: removes the auth user, and every row cascades.
- No banking passwords are ever requested; Phase 3 finance is manual entry, and any later bank link would go through a provider such as Plaid.

---

## 7. UX

**Navigation (mobile):** Today · Plan · Check-in · Journal · More (Tasks, Goals & habits, Reminders, Settings & data). Desktop shows the same in a left rail.

**Today (dashboard), top to bottom**

1. Gregorian date and Hijri date (Umm al-Qura, with ±2 day adjustment).
2. Notification prompt if this device isn't registered.
3. **Daily Integrity Score** — the one loud element: a large serif numeral, the seven-day record beside it, the counts behind it, and the rules on tap.
4. Morning / evening check-in status.
5. Today's intention, behaviour to avoid, spiritual intention (from the morning interview).
6. Needs attention — generated from records, not AI: overdue commitments, overdue tasks, tasks postponed twice, unconfirmed plans for important appointments, an evening review that's due.
7. Today's commitments, with Kept / Not kept / Released actions inline.
8. Schedule with preparation and departure times; "Confirm this plan" for important appointments.
9. Checklist (overdue first) with quick add.
10. Habits with Done / Rest.
11. Goal progress bars.
12. Journal shortcut.

**Visual system.** Charcoal ground (#161719), warm ivory text (#ece5d5), one restrained emerald (#4a9a7c) for kept/done and primary actions. Shortfalls use muted brass (#b8945a), never red — the app records misses, it does not scold. Newsreader (serif) carries reflective text: headings, questions, journal entries, the score. Hanken Grotesk carries the interface. No illustrations, badges, streak flames or confetti.

---

## 8. Testing

- **Unit tests** (`npm test`): time-zone conversion across DST, Hijri dates, every integrity-score rule, appointment preparation and reminder generation, recurrence, quiet hours across midnight, vague-answer detection.
- **End-to-end** (run before delivery): the production build was driven in headless Chromium against real PostgreSQL 16 with this exact migration and RLS, via a local stand-in for Supabase's REST and Auth APIs. 68 checks passed on three consecutive runs, covering: sign-up, onboarding, morning interview with a vague answer and follow-up, tasks with evidence, goals and progress, habits, an 8 PM appointment (prep 7:05 PM, leave 7:35 PM, four reminders), journal write and full-text search, a scheduled reminder sent through a real Web Push encryption round-trip to a test push service and decrypted with the device keys, the device acknowledgement, skipping of already-completed check-in prompts, the evening interview ("I was busy" → follow-up), the integrity score matching the published formula exactly, isolation from a second account and the anonymous key, export, erase, and account deletion with full cascade.
- **Not testable here:** delivery through Apple's and Google's real push services, and Supabase's hosted Auth email. Both are covered by the checklist in SETUP.md, step 9.

---

## 9. Phase plan

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, onboarding, dashboard, goals, habits, checklist, journal, calendar (day/week/month, recurrence), reminders with real push, morning/evening interviews, integrity score, export/erase/delete, memory inspector | **Built** |
| 2 | Claude coach chat with permissioned history; memory extraction (fact/self-report/hypothesis) from interviews and journal; Reflect Deeper; weekly journal summaries; Sunday weekly review | Tables and consent in place |
| 3 | Impulse Interruption; focus timer (25/45/60/90) with distraction log; communication practice (recording, transcription, pace, filler words); daily reasoning exercise; finance dashboard (manual, business vs personal); Quranic and prayer-time notifications | Planned |
| 4 | Adaptive routines, Google Calendar two-way sync, voice interaction, advanced analytics, native app | Planned |

**Quranic content (Phase 3).** Verses will be loaded from an established source with the Arabic text, surah:ayah reference and a named translation (e.g. Sahih International), stored with their attribution, and never generated by AI. Reflections written by Claude will be labelled as reflections and will quote only stored verses.
