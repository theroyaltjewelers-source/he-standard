-- =============================================================================
-- THE STANDARD — v2 schema
-- Coach (AI tool executions + audit + undo), structured memory with sources and
-- approval, prayer system, verified Quran library, focus sessions, impulse logs,
-- finances, Google Calendar connection and sync state, notification categories
-- and reminder policies, midday check-ins, skippable questions, goal
-- milestones, weekly reports.
--
-- Naming map to the product brief:
--   device_tokens        → push_subscriptions (Web Push subscriptions)
--   notification_jobs    → reminders          (one row per scheduled send)
--   notification_attempts→ notifications      (one row per device attempt, with
--                                              push-service response)
--   calendar_events      → events
--   ai_memories          → ai_memory
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
create table public.user_preferences (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  theme                 text not null default 'dark' check (theme in ('dark','light','system')),
  reminder_intensity    text not null default 'balanced' check (reminder_intensity in ('gentle','balanced','firm','custom')),
  custom_follow_up_minutes integer[] not null default '{30}',  -- used when intensity = custom
  categories            jsonb not null default '{}'::jsonb,   -- {"prayer": {"enabled": true, "quiet_override": true}, ...}
  voice_replies         boolean not null default false,       -- Coach speaks responses aloud
  haptics               boolean not null default true,
  sounds                boolean not null default false,
  midday_checkin_time   time default '13:00',
  weekly_report_day     smallint not null default 0 check (weekly_report_day between 0 and 6), -- 0 = Sunday
  updated_at            timestamptz not null default now()
);
create trigger user_preferences_updated before update on public.user_preferences
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_profile_prefs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.prayer_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Commitments and accountability: richer morning priorities, midday, skips
-- ---------------------------------------------------------------------------
alter table public.commitments
  add column expected_outcome text,
  add column effort_minutes   smallint check (effort_minutes between 0 and 1440),
  add column first_action     text;

alter table public.accountability_sessions drop constraint accountability_sessions_kind_check;
alter table public.accountability_sessions add constraint accountability_sessions_kind_check
  check (kind in ('morning','midday','evening'));

alter table public.accountability_answers
  add column skipped boolean not null default false;
alter table public.accountability_answers alter column answer set default '';

-- ---------------------------------------------------------------------------
-- Goals: milestones
-- ---------------------------------------------------------------------------
create table public.goal_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  goal_id     uuid not null references public.goals(id) on delete cascade,
  title       text not null check (length(title) between 1 and 200),
  due_date    date,
  completed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index goal_milestones_goal_idx on public.goal_milestones(goal_id);

-- ---------------------------------------------------------------------------
-- Reminders: categories, follow-up policy, snooze, actions
-- ---------------------------------------------------------------------------
alter table public.reminders drop constraint reminders_entity_type_check;
alter table public.reminders add constraint reminders_entity_type_check
  check (entity_type in ('task','event','commitment','checkin','custom','prayer','habit','goal','finance','weekly_report','reflection','focus'));
alter table public.reminders
  add column category        text not null default 'commitments'
             check (category in ('prayer','appointments','commitments','goals','habits','finance','accountability','weekly_review','quran','coaching')),
  add column follow_up_of    uuid references public.reminders(id) on delete cascade,
  add column follow_up_index smallint not null default 0,
  add column snoozed_from    uuid references public.reminders(id) on delete set null,
  add column actions         jsonb not null default '[]'::jsonb;  -- [{"action":"done","title":"Done"}]
create index reminders_followup_idx on public.reminders(follow_up_of);

alter table public.notifications
  add column action          text,          -- button the user pressed, if any
  add column action_at       timestamptz;

-- ---------------------------------------------------------------------------
-- Calendar: Google connection and sync
-- ---------------------------------------------------------------------------
create table public.connected_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  provider         text not null check (provider in ('google')),
  account_email    text,
  scopes           text[] not null default '{}',
  -- Tokens are AES-256-GCM encrypted by the server before storage; the key
  -- never lives in the database.
  access_token_enc text,
  refresh_token_enc text,
  expires_at       timestamptz,
  status           text not null default 'active' check (status in ('active','revoked','error')),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, provider)
);
create trigger connected_accounts_updated before update on public.connected_accounts
  for each row execute function public.set_updated_at();

create table public.calendar_sync_state (
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        text not null default 'google',
  calendar_id     text not null default 'primary',
  sync_token      text,
  last_synced_at  timestamptz,
  last_status     text,
  last_error      text,
  primary key (user_id, provider, calendar_id)
);

alter table public.events
  add column external_etag        text,
  add column external_updated_at  timestamptz,
  add column sync_status          text not null default 'local'
             check (sync_status in ('local','synced','pending_push','conflict','error')),
  add column sync_error           text,
  add column deleted_externally   boolean not null default false;

-- ---------------------------------------------------------------------------
-- Prayer
-- ---------------------------------------------------------------------------
create table public.prayer_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  method               text not null default 'NorthAmerica',
  madhab               text not null default 'shafi' check (madhab in ('shafi','hanafi')),
  high_latitude_rule   text not null default 'recommended'
                       check (high_latitude_rule in ('recommended','MiddleOfTheNight','SeventhOfTheNight','TwilightAngle')),
  offsets              jsonb not null default '{"fajr":0,"dhuhr":0,"asr":0,"maghrib":0,"isha":0}'::jsonb,
  latitude             double precision,
  longitude            double precision,
  location_label       text,
  location_source      text check (location_source in ('device','manual')),
  location_updated_at  timestamptz,
  auto_location        boolean not null default true,
  reminders_enabled    boolean not null default true,
  remind_before_minutes smallint not null default 0 check (remind_before_minutes between 0 and 60),
  follow_up_minutes    smallint not null default 30 check (follow_up_minutes between 0 and 180),  -- 0 = no follow-up
  pre_next_reminder    boolean not null default true,   -- one reminder before the next prayer begins if still unconfirmed
  notify_during_quiet  boolean not null default true,   -- explicit opt-in to prayer alerts during quiet hours
  mosque_note          text,
  updated_at           timestamptz not null default now()
);
create trigger prayer_settings_updated before update on public.prayer_settings
  for each row execute function public.set_updated_at();

create table public.prayer_schedules (
  user_id      uuid not null references auth.users(id) on delete cascade,
  schedule_date date not null,
  times        jsonb not null,        -- {"fajr":"2026-10-28T10:21:00Z", ...}
  latitude     double precision not null,
  longitude    double precision not null,
  method       text not null,
  madhab       text not null,
  timezone     text not null,
  computed_at  timestamptz not null default now(),
  primary key (user_id, schedule_date)
);

-- Only explicit confirmations are stored. Absence of a row means "unconfirmed",
-- never "missed".
create table public.prayer_confirmations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  prayer_date   date not null,
  prayer        text not null check (prayer in ('fajr','dhuhr','asr','maghrib','isha')),
  status        text not null default 'prayed' check (status in ('prayed','prayed_late','qada')),
  confirmed_at  timestamptz not null default now(),
  in_congregation boolean,
  reflection    text,
  source        text not null default 'app' check (source in ('app','notification','coach')),
  unique (user_id, prayer_date, prayer)
);
create index prayer_conf_user_date_idx on public.prayer_confirmations(user_id, prayer_date);

create table public.spiritual_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  log_date    date not null,
  kind        text not null check (kind in ('quran','dhikr','sunnah','witr','fast','dua','other')),
  amount      integer,                -- minutes, pages, or rak'ahs depending on kind
  unit        text,
  note        text,
  created_at  timestamptz not null default now()
);
create index spiritual_logs_user_date_idx on public.spiritual_logs(user_id, log_date);

-- Verified Quran library: text and translation imported verbatim from a
-- published source with attribution. Shared, read-only for users.
create table public.quran_verses (
  id             uuid primary key default gen_random_uuid(),
  surah          smallint not null check (surah between 1 and 114),
  ayah           smallint not null check (ayah between 1 and 286),
  surah_name     text,
  arabic         text not null,
  translation    text not null,
  translator     text not null,
  edition        text not null,
  topics         text[] not null default '{}',
  source_url     text not null,
  fetched_at     timestamptz not null default now(),
  unique (surah, ayah, edition)
);

-- AI commentary is stored separately and always labelled as such.
create table public.verse_reflections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  verse_id    uuid not null references public.quran_verses(id) on delete cascade,
  reflection  text not null,
  model       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rhythm: focus sessions and impulse interruption
-- ---------------------------------------------------------------------------
create table public.focus_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  task_id          uuid references public.tasks(id) on delete set null,
  intention        text,
  planned_minutes  smallint not null check (planned_minutes in (25,45,60,90) or planned_minutes between 5 and 240),
  started_at       timestamptz not null default now(),
  ends_at          timestamptz not null,
  ended_at         timestamptz,
  status           text not null default 'active' check (status in ('active','completed','abandoned')),
  distractions     jsonb not null default '[]'::jsonb,  -- [{"at":"…","note":"…"}]
  note             text
);
create index focus_user_started_idx on public.focus_sessions(user_id, started_at desc);

create table public.impulse_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('procrastination','social_media','spending','eating','romantic_preoccupation','anger','other')),
  feeling      text,
  trigger_note text,
  seeking      text,     -- what am I trying to escape or obtain
  consequence  text,     -- what happens if I act on it
  alternative  text,     -- action aligned with goals
  intervention text check (intervention in ('pause','breathing','alternative_task','reflection','none')),
  outcome      text check (outcome in ('resisted','acted','partly','unsure')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index impulse_user_created_idx on public.impulse_logs(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Money (manual entry only; no bank credentials ever)
-- ---------------------------------------------------------------------------
create table public.financial_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  entry_date    date not null,
  kind          text not null check (kind in ('income','expense','bill','debt_payment','savings')),
  scope         text not null default 'personal' check (scope in ('personal','business')),
  amount        numeric(12,2) not null check (amount >= 0),
  category      text,
  description   text,
  discretionary boolean not null default false,
  due_date      date,             -- for bills
  paid          boolean,          -- for bills
  reflection    text,             -- "was this aligned with my goals?"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index financial_user_date_idx on public.financial_entries(user_id, entry_date desc);
create trigger financial_updated before update on public.financial_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- AI: conversations, tool executions (proposals, confirmations, undo), memory
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         jsonb not null,     -- Anthropic content blocks
  display_text    text,
  input_method    text check (input_method in ('typed','voice')),
  created_at      timestamptz not null default now()
);
create index ai_messages_conv_idx on public.ai_messages(conversation_id, created_at);

create table public.ai_tool_executions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  conversation_id       uuid references public.ai_conversations(id) on delete set null,
  tool                  text not null,
  input                 jsonb not null,
  status                text not null check (status in ('awaiting_confirmation','executed','failed','rejected','undone','expired')),
  requires_confirmation boolean not null default false,
  confirmation_reason   text,
  summary               text,                 -- human-readable description of the action
  result                jsonb,
  error                 text,
  undo                  jsonb,                -- data needed to reverse the change
  created_at            timestamptz not null default now(),
  executed_at           timestamptz,
  undone_at             timestamptz
);
create index ai_tool_exec_user_idx on public.ai_tool_executions(user_id, created_at desc);

alter table public.ai_memory
  add column category text not null default 'context'
    check (category in ('preference','long_term_goal','commitment','routine','observation','difficulty','accomplishment','reflection','hypothesis','context')),
  add column evidence_status text not null default 'unverified'
    check (evidence_status in ('verified','self_reported','unverified')),
  add column sensitive boolean not null default false;
alter table public.ai_memory drop constraint ai_memory_status_check;
alter table public.ai_memory add constraint ai_memory_status_check
  check (status in ('proposed','active','rejected','archived'));

create table public.ai_memory_sources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  memory_id   uuid not null references public.ai_memory(id) on delete cascade,
  source_type text not null,          -- journal_entry, accountability_answer, task, conversation, user
  source_id   uuid,
  excerpt     text,
  created_at  timestamptz not null default now()
);
create index ai_memory_sources_mem_idx on public.ai_memory_sources(memory_id);

-- ---------------------------------------------------------------------------
-- Audit log: every AI-initiated or system-initiated change
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  actor        text not null check (actor in ('user','ai','system')),
  action       text not null,
  entity_type  text,
  entity_id    uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_user_created_idx on public.audit_logs(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Weekly reports (renamed from weekly_reviews)
-- ---------------------------------------------------------------------------
alter table public.weekly_reviews rename to weekly_reports;
alter table public.weekly_reports
  add column period_start date,
  add column period_end   date,
  add column sample       jsonb not null default '{}'::jsonb,    -- counts of records the report is based on
  add column matched      jsonb not null default '[]'::jsonb,    -- "Where your actions matched your values"
  add column mismatched   jsonb not null default '[]'::jsonb;    -- "Where your actions did not match your intentions"

-- ---------------------------------------------------------------------------
-- RLS for every new user-owned table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'goal_milestones','connected_accounts','calendar_sync_state','prayer_schedules','prayer_confirmations',
    'spiritual_logs','verse_reflections','focus_sessions','impulse_logs','financial_entries',
    'ai_conversations','ai_messages','ai_memory_sources'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows select" on public.%I for select using (user_id = auth.uid())', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('create policy "own rows update" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "own rows delete" on public.%I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.user_preferences enable row level security;
create policy "own prefs select" on public.user_preferences for select using (user_id = auth.uid());
create policy "own prefs insert" on public.user_preferences for insert with check (user_id = auth.uid());
create policy "own prefs update" on public.user_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.prayer_settings enable row level security;
create policy "own prayer settings select" on public.prayer_settings for select using (user_id = auth.uid());
create policy "own prayer settings insert" on public.prayer_settings for insert with check (user_id = auth.uid());
create policy "own prayer settings update" on public.prayer_settings for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- OAuth tokens: users may see that a connection exists and remove it, but
-- cannot read or write the (encrypted) token columns. Column grants only take
-- effect once the table-level grant is removed.
drop policy "own rows insert" on public.connected_accounts;
drop policy "own rows update" on public.connected_accounts;
revoke all on public.connected_accounts from anon, authenticated;
grant select (id, user_id, provider, account_email, scopes, expires_at, status, last_error, created_at, updated_at)
  on public.connected_accounts to authenticated;
grant delete on public.connected_accounts to authenticated;

-- Tool executions and audit logs are server-written. Users can read them and
-- delete them (privacy), but not forge them.
alter table public.ai_tool_executions enable row level security;
create policy "own exec select" on public.ai_tool_executions for select using (user_id = auth.uid());
create policy "own exec delete" on public.ai_tool_executions for delete using (user_id = auth.uid());
alter table public.audit_logs enable row level security;
create policy "own audit select" on public.audit_logs for select using (user_id = auth.uid());
create policy "own audit delete" on public.audit_logs for delete using (user_id = auth.uid());

-- Quran library: readable by any signed-in user; written only by the server.
alter table public.quran_verses enable row level security;
create policy "verses readable" on public.quran_verses for select to authenticated using (true);
revoke insert, update, delete on public.quran_verses from anon, authenticated;

-- Preferences rows for existing users, and automatic creation for new ones.
insert into public.user_preferences (user_id) select id from public.profiles on conflict do nothing;
insert into public.prayer_settings (user_id) select id from public.profiles on conflict do nothing;
create trigger on_profile_created_prefs after insert on public.profiles
  for each row execute function public.handle_new_profile_prefs();

-- ---------------------------------------------------------------------------
-- Reflection: guided journal modes and consent-gated AI reflections
-- ---------------------------------------------------------------------------
alter table public.journal_entries
  add column guided_mode text not null default 'free'
    check (guided_mode in ('free','evening_examination','gratitude','decision','after_slip','conflict','spiritual'));

create table public.journal_reflections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entry_id    uuid not null references public.journal_entries(id) on delete cascade,
  reflection  text not null,
  questions   jsonb not null default '[]'::jsonb,
  model       text,
  created_at  timestamptz not null default now()
);
create index journal_reflections_entry_idx on public.journal_reflections(entry_id);
alter table public.journal_reflections enable row level security;
create policy "own jr select" on public.journal_reflections for select using (user_id = auth.uid());
create policy "own jr insert" on public.journal_reflections for insert with check (user_id = auth.uid());
create policy "own jr delete" on public.journal_reflections for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Retention (enforced by the planner job, documented in docs/ARCHITECTURE.md)
--   notifications (delivery attempts)   90 days
--   reminders that finished             90 days after send time
--   ai_tool_executions                  365 days
--   audit_logs                          365 days
--   ai_messages                         kept until the user deletes the conversation
-- ---------------------------------------------------------------------------
create or replace function public.apply_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n1 int; n2 int; n3 int; n4 int;
begin
  delete from notifications where created_at < now() - interval '90 days'; get diagnostics n1 = row_count;
  delete from reminders where status in ('sent','partial','failed','cancelled','no_device')
     and send_at < now() - interval '90 days'; get diagnostics n2 = row_count;
  delete from ai_tool_executions where created_at < now() - interval '365 days'; get diagnostics n3 = row_count;
  delete from audit_logs where created_at < now() - interval '365 days'; get diagnostics n4 = row_count;
  update ai_tool_executions set status = 'expired'
   where status = 'awaiting_confirmation' and created_at < now() - interval '24 hours';
  return jsonb_build_object('notifications', n1, 'reminders', n2, 'tool_executions', n3, 'audit_logs', n4);
end $$;
revoke all on function public.apply_retention() from public, anon, authenticated;
grant execute on function public.apply_retention() to service_role;
