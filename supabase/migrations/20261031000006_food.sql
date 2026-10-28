-- =============================================================================
-- THE STANDARD — food log (additive only)
--
-- One row per thing eaten. `eaten_at` is the instant; `local_date` and
-- `timezone` record the calendar day and zone the meal was logged in, so a
-- meal never moves to another day when the device or profile time zone changes.
-- =============================================================================
create table if not exists public.food_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  description       text not null check (length(btrim(description)) between 1 and 500),
  eaten_at          timestamptz not null,
  local_date        date not null,
  timezone          text not null,
  meal              text check (meal in ('breakfast','lunch','dinner','snack')),
  portion           text check (length(portion) <= 100),
  notes             text check (length(notes) <= 1000),
  client_request_id text,                   -- idempotency key from the form (repeated taps / retries)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, client_request_id)
);
-- Day view and Today summary: entries for one user and one local day, in time order.
create index if not exists food_entries_user_day_idx on public.food_entries(user_id, local_date, eaten_at);

drop trigger if exists food_entries_updated on public.food_entries;
create trigger food_entries_updated before update on public.food_entries
  for each row execute function public.set_updated_at();
drop trigger if exists food_entries_revisions on public.food_entries;
create trigger food_entries_revisions after insert or update or delete on public.food_entries
  for each row execute function public.log_revision();

alter table public.food_entries enable row level security;
drop policy if exists "own rows select" on public.food_entries;
drop policy if exists "own rows insert" on public.food_entries;
drop policy if exists "own rows update" on public.food_entries;
drop policy if exists "own rows delete" on public.food_entries;
create policy "own rows select" on public.food_entries for select using (user_id = auth.uid());
create policy "own rows insert" on public.food_entries for insert with check (user_id = auth.uid());
create policy "own rows update" on public.food_entries for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows delete" on public.food_entries for delete using (user_id = auth.uid());
