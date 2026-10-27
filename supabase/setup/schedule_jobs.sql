-- =============================================================================
-- THE STANDARD — reminder scheduler (run once in the Supabase SQL Editor,
-- AFTER the app is deployed and both migrations have run).
--
-- Supabase's own cron (pg_cron) calls the app every minute to send due
-- reminders and every 15 minutes to plan upcoming ones. The shared secret is
-- read from public.app_config (created by migration 0002), so no secret needs
-- to be pasted anywhere. Replace only the app address below.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into public.app_config(key, value)
values ('app_url', 'https://YOUR-APP.vercel.app')   -- CHANGE ME (no trailing slash)
on conflict (key) do update set value = excluded.value;

create or replace function public.standard_call(path text)
returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select value from public.app_config where key = 'app_url') || path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select value from public.app_config where key = 'cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000);
$$;
revoke all on function public.standard_call(text) from public, anon, authenticated;

select cron.schedule('standard-dispatch', '* * * * *',    $$ select public.standard_call('/api/cron/dispatch') $$);
select cron.schedule('standard-plan',     '*/15 * * * *', $$ select public.standard_call('/api/cron/plan') $$);

-- Check it's working (after a couple of minutes):
--   select status_code, left(content, 120), created from net._http_response order by created desc limit 5;
-- Stop:
--   select cron.unschedule('standard-dispatch'); select cron.unschedule('standard-plan');
