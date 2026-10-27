# The Standard

A private, mobile-first accountability system: daily commitments with times, honest evening review, a transparent integrity score, scheduled push reminders, goals, habits, calendar and journal.

> Your standard is not what you say. Your standard is what you consistently do.

- **Setting it up:** [SETUP.md](SETUP.md) — step by step, no programming required.
- **How it works:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, data model, reminder delivery, scoring rules, privacy, UX and phase plan.

## Status

Phase 1 (functional foundation) is built and tested. Phases 2–4 (Claude coaching and weekly reviews; impulse interruption, focus, communication, reasoning, finance and spiritual modules; adaptive routines and calendar sync) are planned in the architecture document.

## For developers

```bash
npm install
cp .env.example .env.local   # fill in values (see SETUP.md)
npm run dev                  # http://localhost:3000
npm test                     # unit tests
npm run lint && npm run typecheck
```

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- Supabase Auth + PostgreSQL with row-level security on every table (`supabase/migrations/`)
- Web Push (VAPID) via `web-push`; scheduler via Supabase `pg_cron` → `/api/cron/dispatch` and `/api/cron/plan` (`supabase/setup/schedule_jobs.sql`)
- Claude via `@anthropic-ai/sdk`, server-only, gated by per-user consent

```
src/
  app/(app)/        signed-in pages: today, plan, checkin, journal, tasks, goals, reminders, settings
  app/actions/      server actions (all writes)
  app/api/          cron, push subscribe/test, notification acks, export
  lib/              integrity score, scheduling, interview rules, reminders, push, time/Hijri, Supabase clients
  components/       UI
public/sw.js        service worker (push display + delivery acknowledgement)
```
