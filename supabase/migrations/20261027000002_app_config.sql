-- =============================================================================
-- Server-managed configuration: notification (VAPID) keys and the scheduler
-- secret are generated and stored here, so nobody has to copy secrets between
-- dashboards. RLS is on with NO policies and all privileges revoked from the
-- browser-facing roles: only the service role (server code, pg_cron) can read it.
-- Environment variables (VAPID_PRIVATE_KEY, CRON_SECRET, …) still take
-- precedence if set.
-- =============================================================================

create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant all on public.app_config to service_role;

-- Scheduler secret: 2 × UUIDv4 ≈ 244 random bits.
insert into public.app_config(key, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;
