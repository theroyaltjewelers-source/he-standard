-- =============================================================================
-- THE STANDARD — reminder scheduler (run once in the Supabase SQL Editor,
-- AFTER the app is deployed). See SETUP.md, step 6.
--
-- Supabase's own cron (pg_cron) calls your app every minute to send due
-- reminders, and every 15 minutes to plan upcoming ones. This keeps working
-- whether or not the app is open on any device.
--
-- Replace the two values marked CHANGE ME before running.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the address and secret in Supabase Vault (encrypted), not in the job text.
select vault.create_secret('https://YOUR-APP.vercel.app', 'standard_app_url');   -- CHANGE ME (no trailing slash)
select vault.create_secret('YOUR-CRON-SECRET', 'standard_cron_secret');          -- CHANGE ME (same value as CRON_SECRET in Vercel)

create or replace function public.standard_call(path text)
returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'standard_app_url') || path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'standard_cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000);
$$;
revoke all on function public.standard_call(text) from public, anon, authenticated;

select cron.schedule('standard-dispatch', '* * * * *',     $$ select public.standard_call('/api/cron/dispatch') $$);
select cron.schedule('standard-plan',     '*/15 * * * *',  $$ select public.standard_call('/api/cron/plan') $$);

-- To check it's working (after a couple of minutes):
--   select status_code, content::json->>'claimed' as claimed, created
--     from net._http_response order by created desc limit 5;
-- To change the URL or secret later:
--   update vault.secrets set secret = 'NEW' where name = 'standard_app_url';
-- To stop:
--   select cron.unschedule('standard-dispatch'); select cron.unschedule('standard-plan');
