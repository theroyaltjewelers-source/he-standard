-- =============================================================================
-- THE STANDARD — v3 schema (additive only: no table, column or row is removed)
--
-- * Activities: events gain a kind (workout, call, deadline, routine, …) and an
--   accountability level. Every occurrence of an accountable activity gets a
--   lifecycle record (activity_occurrences): started, completed, completed
--   late, skipped with reason, rescheduled (original time preserved), excused,
--   or awaiting confirmation. Unknown is never recorded as failure.
-- * Workouts: workout_logs (duration, type, intensity, recovery).
-- * Commitments and tasks keep their original deadline when rescheduled.
-- * Notifications: priority levels, daily budget, temporary pause, and an
--   idempotency log so a notification action is processed exactly once.
-- * Habits: a "learning" area for the Learning & reasoning domain.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists kind text not null default 'appointment'
    check (kind in ('appointment','workout','call','deadline','routine','obligation','focus_block')),
  add column if not exists accountability text not null default 'light'
    check (accountability in ('off','light','standard','strict')),
  add column if not exists rescheduled_from uuid references public.events(id) on delete set null;

create table if not exists public.activity_occurrences (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  occurrence_start  timestamptz not null,      -- the ORIGINAL scheduled start; never rewritten
  occurrence_end    timestamptz,
  title             text not null,
  kind              text not null,
  status            text not null default 'scheduled'
                    check (status in ('scheduled','started','completed','completed_late','skipped','rescheduled','excused','awaiting_confirmation','missed')),
  started_at        timestamptz,
  completed_at      timestamptz,
  duration_minutes  integer check (duration_minutes between 0 and 1440),
  delay_minutes     integer check (delay_minutes between 0 and 1440),
  skip_reason       text,
  notes             text,
  rescheduled_to    timestamptz,
  evidence          text not null default 'unverified'
                    check (evidence in ('confirmed','self_reported','imported','unverified')),
  source            text not null default 'app' check (source in ('app','notification','coach','timeline','system')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, occurrence_start)
);
create index if not exists activity_occ_user_start_idx on public.activity_occurrences(user_id, occurrence_start);
create trigger activity_occurrences_updated before update on public.activity_occurrences
  for each row execute function public.set_updated_at();

create table if not exists public.workout_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  occurrence_id    uuid references public.activity_occurrences(id) on delete set null,
  performed_on     date not null,
  started_at       timestamptz,
  duration_minutes integer check (duration_minutes between 0 and 600),
  workout_type     text not null default 'other' check (workout_type in ('strength','cardio','mobility','sport','recovery','other')),
  intensity        smallint check (intensity between 1 and 5),
  notes            text,
  source           text not null default 'app' check (source in ('app','notification','coach','timeline')),
  created_at       timestamptz not null default now()
);
create index if not exists workout_logs_user_date_idx on public.workout_logs(user_id, performed_on);

-- ---------------------------------------------------------------------------
-- Preserve original deadlines
-- ---------------------------------------------------------------------------
alter table public.commitments
  add column if not exists original_promised_by timestamptz,
  add column if not exists reschedule_count smallint not null default 0;
alter table public.tasks
  add column if not exists original_due_at timestamptz,
  add column if not exists original_scheduled_for date;

-- ---------------------------------------------------------------------------
-- Notification controls
-- ---------------------------------------------------------------------------
alter table public.reminders
  add column if not exists priority smallint not null default 2 check (priority between 1 and 3);  -- 1 critical … 3 low
alter table public.user_preferences
  add column if not exists daily_notification_budget smallint check (daily_notification_budget between 1 and 200),
  add column if not exists paused_until timestamptz,
  add column if not exists pause_keeps_prayer boolean not null default true,
  add column if not exists workout_target_per_week smallint check (workout_target_per_week between 0 and 14);

create table if not exists public.notification_action_log (
  idempotency_key text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  reminder_id     uuid,
  action          text not null,
  result          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists notification_action_log_user_idx on public.notification_action_log(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Habits: learning area
-- ---------------------------------------------------------------------------
-- (habits.area is free text in the base schema; no constraint change needed.)

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.activity_occurrences enable row level security;
create policy "own occ select" on public.activity_occurrences for select using (user_id = auth.uid());
create policy "own occ insert" on public.activity_occurrences for insert with check (user_id = auth.uid());
create policy "own occ update" on public.activity_occurrences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own occ delete" on public.activity_occurrences for delete using (user_id = auth.uid());

alter table public.workout_logs enable row level security;
create policy "own workout select" on public.workout_logs for select using (user_id = auth.uid());
create policy "own workout insert" on public.workout_logs for insert with check (user_id = auth.uid());
create policy "own workout update" on public.workout_logs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own workout delete" on public.workout_logs for delete using (user_id = auth.uid());

-- Server-written; users may read their own history.
alter table public.notification_action_log enable row level security;
create policy "own nal select" on public.notification_action_log for select using (user_id = auth.uid());
create policy "own nal delete" on public.notification_action_log for delete using (user_id = auth.uid());

-- Retention for the idempotency log (30 days is far beyond any retry window).
create or replace function public.apply_retention_v3()
returns integer language sql security definer set search_path = public as $$
  with x as (delete from notification_action_log where created_at < now() - interval '30 days' returning 1)
  select count(*)::int from x;
$$;
revoke all on function public.apply_retention_v3() from public, anon, authenticated;
grant execute on function public.apply_retention_v3() to service_role;

-- Widen (never narrow) the allowed notification categories with "fitness".
alter table public.reminders drop constraint if exists reminders_category_check;
alter table public.reminders add constraint reminders_category_check
  check (category in ('prayer','appointments','commitments','goals','habits','finance','accountability','weekly_review','quran','coaching','fitness','system'));
