-- Journal capacity: entries up to 1,000,000 characters (was 50,000).
-- The full-text search column keeps indexing the whole entry.
alter table public.journal_entries drop constraint if exists journal_entries_body_check;
alter table public.journal_entries
  add constraint journal_entries_body_check check (length(body) between 1 and 1000000);
