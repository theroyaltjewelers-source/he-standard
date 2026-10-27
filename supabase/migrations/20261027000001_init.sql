-- =============================================================================
-- THE STANDARD — initial schema
-- Every user-owned table carries user_id and is protected by row-level security
-- so a signed-in user can only ever read or write their own rows. Server jobs
-- (reminder dispatch, account deletion) use the service-role key, which
-- bypasses RLS and never reaches the browser.
-- =============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+; no extension needed.

-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- PROFILES (one row per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  display_name            text,
  timezone                text not null default 'America/New_York',
  morning_checkin_time    time not null default '07:00',
  evening_checkin_time    time not null default '21:00',
  quiet_hours_start       time default '22:30',
  quiet_hours_end         time default '06:30',
  focus_areas             text[] not null default '{}',
  challenges              text[] not null default '{}',
  hijri_adjustment_days   smallint not null default 0 check (hijri_adjustment_days between -2 and 2),
  -- Prayer-time settings (used in Phase 3)
  location_label          text,
  latitude                double precision,
  longitude               double precision,
  prayer_calc_method      text,
  -- Explicit consent for AI analysis of personal data. Off until the user opts in.
  ai_analysis_consent     boolean not null default false,
  ai_consent_updated_at   timestamptz,
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- GOALS, PROGRESS, HABITS
-- ---------------------------------------------------------------------------
create table public.goals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  parent_goal_id   uuid references public.goals(id) on delete set null,
  horizon          text not null default 'long_term'
                   check (horizon in ('long_term','monthly','weekly')),
  area             text not null default 'general',
  title            text not null check (length(title) between 1 and 200),
  desired_outcome  text not null,
  success_criteria text not null,
  target_date      date,
  obstacles        text,
  recovery_plan    text,
  status           text not null default 'active'
                   check (status in ('active','paused','achieved','abandoned')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index goals_user_idx on public.goals(user_id, status);
create trigger goals_updated before update on public.goals
  for each row execute function public.set_updated_at();

create table public.goal_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  goal_id      uuid not null references public.goals(id) on delete cascade,
  progress_pct smallint check (progress_pct between 0 and 100),
  note         text not null,
  evidence     text,
  created_at   timestamptz not null default now()
);
create index goal_progress_goal_idx on public.goal_progress(goal_id, created_at desc);

create table public.habits (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  goal_id         uuid references public.goals(id) on delete set null,
  title           text not null check (length(title) between 1 and 160),
  area            text not null default 'general',
  target_per_week smallint not null default 7 check (target_per_week between 1 and 7),
  rest_days       smallint[] not null default '{}',   -- 0 = Sunday … 6 = Saturday
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index habits_user_idx on public.habits(user_id, active);
create trigger habits_updated before update on public.habits
  for each row execute function public.set_updated_at();

create table public.habit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  habit_id   uuid not null references public.habits(id) on delete cascade,
  log_date   date not null,
  status     text not null check (status in ('done','skipped','rest')),
  note       text,
  created_at timestamptz not null default now(),
  unique (habit_id, log_date)
);
create index habit_logs_user_date_idx on public.habit_logs(user_id, log_date);

-- ---------------------------------------------------------------------------
-- TASKS (the daily checklist) and COMMITMENTS (promises with a time attached)
-- verification:
--   self_reported — the user marked it done
--   evidence      — the user marked it done AND recorded specific evidence
-- Nothing in Phase 1 is labelled "verified by the system"; that label is
-- reserved for completions the app can observe itself (e.g. a focus session).
-- ---------------------------------------------------------------------------
create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  goal_id         uuid references public.goals(id) on delete set null,
  title           text not null check (length(title) between 1 and 200),
  notes           text,
  scheduled_for   date,            -- the day it belongs on the checklist
  due_at          timestamptz,     -- a hard deadline, if any
  priority        smallint not null default 2 check (priority between 1 and 3),
  is_top_priority boolean not null default false,
  status          text not null default 'pending'
                  check (status in ('pending','done','missed','cancelled')),
  completed_at    timestamptz,
  verification    text not null default 'none'
                  check (verification in ('none','self_reported','evidence','system')),
  evidence        text,
  miss_reason     text,
  postponed_count smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index tasks_user_day_idx on public.tasks(user_id, scheduled_for);
create index tasks_user_status_idx on public.tasks(user_id, status);
create trigger tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.commitments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  task_id          uuid references public.tasks(id) on delete set null,
  commitment_date  date not null,
  title            text not null check (length(title) between 1 and 200),
  made_to          text not null default 'self',      -- 'self' or a person's name
  promised_by      timestamptz,                       -- when it will be done
  obstacles        text,
  contingency      text,
  source           text not null default 'manual'
                   check (source in ('manual','morning_interview')),
  status           text not null default 'open'
                   check (status in ('open','kept','kept_late','broken','released')),
  resolved_at      timestamptz,
  verification     text not null default 'none'
                   check (verification in ('none','self_reported','evidence','system')),
  evidence         text,
  failure_context  text,           -- what happened immediately before
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index commitments_user_day_idx on public.commitments(user_id, commitment_date);
create trigger commitments_updated before update on public.commitments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- CALENDAR EVENTS (appointments)
-- ---------------------------------------------------------------------------
create table public.events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text not null check (length(title) between 1 and 200),
  location          text,
  notes             text,
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  all_day           boolean not null default false,
  importance        text not null default 'normal' check (importance in ('normal','high')),
  prep_minutes      smallint not null default 0 check (prep_minutes between 0 and 600),
  travel_minutes    smallint not null default 0 check (travel_minutes between 0 and 600),
  reminder_offsets  integer[] not null default '{60}',  -- extra minutes-before-start reminders
  recurrence        text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  recurrence_until  date,
  plan_confirmed_at timestamptz,
  external_source   text,          -- e.g. 'google' once calendar sync is added
  external_id       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_user_start_idx on public.events(user_id, starts_at);
create unique index events_external_idx on public.events(user_id, external_source, external_id)
  where external_id is not null;
create trigger events_updated before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- REMINDERS, PUSH SUBSCRIPTIONS, NOTIFICATION DELIVERY LOG
-- A reminder is "sent" only when the push service accepted it (HTTP 201).
-- "displayed"/"clicked" are recorded only when the device's service worker
-- reports back. The UI never shows more than what was recorded.
-- ---------------------------------------------------------------------------
create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  entity_type   text not null check (entity_type in ('task','event','commitment','checkin','custom')),
  entity_id     uuid,
  dedupe_key    text,             -- prevents generating the same reminder twice
  title         text not null,
  body          text,
  url           text not null default '/today',
  send_at       timestamptz not null,
  respect_quiet_hours boolean not null default true,
  status        text not null default 'scheduled'
                check (status in ('scheduled','processing','sent','partial','failed','cancelled','no_device')),
  attempts      smallint not null default 0,
  last_error    text,
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);
-- Plain (non-partial) unique constraint so upserts can target it. NULL keys never collide.
alter table public.reminders add constraint reminders_dedupe_key unique (user_id, dedupe_key);
create index reminders_due_idx on public.reminders(send_at) where status = 'scheduled';
create index reminders_entity_idx on public.reminders(entity_type, entity_id);

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  device_label    text,
  last_success_at timestamptz,
  failure_count   smallint not null default 0,
  created_at      timestamptz not null default now()
);
create index push_subs_user_idx on public.push_subscriptions(user_id);

create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  reminder_id         uuid references public.reminders(id) on delete set null,
  subscription_id     uuid references public.push_subscriptions(id) on delete set null,
  title               text not null,
  body                text,
  status              text not null check (status in ('pending','accepted','failed','displayed','clicked')),
  push_service_status integer,
  error               text,
  created_at          timestamptz not null default now(),
  displayed_at        timestamptz,
  clicked_at          timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- JOURNAL
-- Data is encrypted at rest by Supabase (AES-256 disk encryption) and in
-- transit by TLS. Field-level encryption is deliberately not used for the
-- body because it would disable full-text search; see docs/ARCHITECTURE.md.
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  entry_date          date not null default current_date,
  title               text,
  body                text not null check (length(body) between 1 and 50000),
  mood                smallint check (mood between 1 and 5),
  energy              smallint check (energy between 1 and 5),
  tags                text[] not null default '{}',
  input_method        text not null default 'typed' check (input_method in ('typed','voice')),
  ai_analysis_allowed boolean not null default true,  -- per-entry opt-out
  search              tsvector generated always as
                      (to_tsvector('english', coalesce(title,'') || ' ' || body)) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index journal_user_date_idx on public.journal_entries(user_id, entry_date desc);
create index journal_search_idx on public.journal_entries using gin(search);
create index journal_tags_idx on public.journal_entries using gin(tags);
create trigger journal_updated before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- DAILY ACCOUNTABILITY INTERVIEWS
-- ---------------------------------------------------------------------------
create table public.daily_plans (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  plan_date            date not null,
  intention            text,
  avoid_behavior       text,
  character_plan       text,   -- how honesty, patience and discipline will show
  spiritual_intention  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, plan_date)
);
create trigger daily_plans_updated before update on public.daily_plans
  for each row execute function public.set_updated_at();

create table public.accountability_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_date date not null,
  kind         text not null check (kind in ('morning','evening')),
  status       text not null default 'in_progress' check (status in ('in_progress','completed')),
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, session_date, kind)
);

create table public.accountability_answers (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  session_id         uuid not null references public.accountability_sessions(id) on delete cascade,
  question_key       text not null,
  question           text not null,
  answer             text not null,
  follow_up_question text,
  follow_up_answer   text,
  follow_up_source   text check (follow_up_source in ('rule','ai')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (session_id, question_key)
);
create trigger answers_updated before update on public.accountability_answers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- AI MEMORY & OBSERVATIONS (written by Phase 2, inspectable from Phase 1)
-- kind: verified_fact  — derived from recorded app data (counts, dates)
--       self_report    — something the user said about themselves
--       hypothesis     — an AI interpretation, never presented as fact
-- ---------------------------------------------------------------------------
create table public.ai_memory (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('verified_fact','self_report','hypothesis')),
  content     text not null check (length(content) between 1 and 2000),
  source_type text,          -- 'journal','evening_interview','user', …
  source_id   uuid,
  confidence  text check (confidence in ('low','medium','high')),
  status      text not null default 'active' check (status in ('active','rejected','archived')),
  user_edited boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ai_memory_user_idx on public.ai_memory(user_id, status);
create trigger ai_memory_updated before update on public.ai_memory
  for each row execute function public.set_updated_at();

create table public.ai_observations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  observation  text not null,
  evidence     jsonb not null default '[]',
  period_start date,
  period_end   date,
  status       text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  created_at   timestamptz not null default now()
);
create index ai_obs_user_idx on public.ai_observations(user_id, created_at desc);

create table public.weekly_reviews (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  week_start     date not null,
  metrics        jsonb not null,           -- measured data only
  interpretation text,                     -- AI interpretation, labelled as such
  priorities     jsonb not null default '[]',
  model          text,
  generated_at   timestamptz not null default now(),
  unique (user_id, week_start)
);

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'goals','goal_progress','habits','habit_logs','tasks','commitments','events',
    'reminders','push_subscriptions','notifications','journal_entries','daily_plans',
    'accountability_sessions','accountability_answers','ai_memory','ai_observations','weekly_reviews'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows select" on public.%I for select using (user_id = auth.uid())', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('create policy "own rows update" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "own rows delete" on public.%I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

-- Users must not be able to forge delivery results. Only the server (service
-- role) writes 'accepted'/'failed'; a device can only move its own row to
-- 'displayed' or 'clicked' through the security-definer function below.
drop policy "own rows insert" on public.notifications;
drop policy "own rows update" on public.notifications;

create or replace function public.ack_notification(p_id uuid, p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_event = 'displayed' then
    update notifications set status = case when status = 'clicked' then status else 'displayed' end,
           displayed_at = coalesce(displayed_at, now())
     where id = p_id and user_id = auth.uid() and status in ('pending','accepted','displayed','clicked');
  elsif p_event = 'clicked' then
    update notifications set status = 'clicked', clicked_at = coalesce(clicked_at, now()),
           displayed_at = coalesce(displayed_at, now())
     where id = p_id and user_id = auth.uid() and status in ('pending','accepted','displayed','clicked');
  end if;
end $$;
revoke all on function public.ack_notification(uuid, text) from public, anon;
grant execute on function public.ack_notification(uuid, text) to authenticated;

-- Reminder status is likewise server-owned: users may create, reschedule or
-- cancel a reminder, but cannot mark one as sent.
create or replace function public.guard_reminder_status()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' and new.status not in ('scheduled','cancelled') then
      raise exception 'reminder status is set by the server';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status
       and new.status not in ('scheduled','cancelled') then
      raise exception 'reminder status is set by the server';
    end if;
  end if;
  return new;
end $$;
create trigger reminders_guard before insert or update on public.reminders
  for each row execute function public.guard_reminder_status();

-- ---------------------------------------------------------------------------
-- DISPATCH: atomically claim due reminders (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_reminders(p_limit int default 100)
returns setof public.reminders language sql security definer set search_path = public as $$
  update reminders r
     set status = 'processing', attempts = r.attempts + 1, processed_at = now()
   where r.id in (
     select id from reminders
      where status = 'scheduled' and send_at <= now()
      order by send_at
      limit p_limit
      for update skip locked)
  returning r.*;
$$;
revoke all on function public.claim_due_reminders(int) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(int) to service_role;

-- Reminders stuck in 'processing' (e.g. the function crashed) are retried.
create or replace function public.release_stuck_reminders()
returns integer language sql security definer set search_path = public as $$
  with x as (
    update reminders set status = case when attempts >= 3 then 'failed' else 'scheduled' end,
                         last_error = coalesce(last_error, 'dispatch timed out')
     where status = 'processing' and processed_at < now() - interval '5 minutes'
    returning 1)
  select count(*)::int from x;
$$;
revoke all on function public.release_stuck_reminders() from public, anon, authenticated;
grant execute on function public.release_stuck_reminders() to service_role;
