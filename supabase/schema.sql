-- Port Pulse — Supabase schema
-- Run this in the Supabase SQL editor (Studio → SQL → New Query → Run).

create table if not exists watchlist_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  name text default '',
  created_at timestamptz not null default now(),
  unique (user_id, symbol)
);

create index if not exists watchlist_items_user_id_idx
  on watchlist_items (user_id);

alter table watchlist_items enable row level security;

drop policy if exists "watchlist_select_own" on watchlist_items;
create policy "watchlist_select_own"
  on watchlist_items
  for select
  using (auth.uid() = user_id);

drop policy if exists "watchlist_insert_own" on watchlist_items;
create policy "watchlist_insert_own"
  on watchlist_items
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "watchlist_update_own" on watchlist_items;
create policy "watchlist_update_own"
  on watchlist_items
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "watchlist_delete_own" on watchlist_items;
create policy "watchlist_delete_own"
  on watchlist_items
  for delete
  using (auth.uid() = user_id);
