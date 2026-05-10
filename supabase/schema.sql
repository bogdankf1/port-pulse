-- Port Pulse — Supabase schema
-- Run this in the Supabase SQL editor (Studio → SQL → New Query → Run).

-- Portfolios: a logged-in user can own multiple named portfolios.
create table if not exists portfolios (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolios_user_id_idx on portfolios(user_id);

alter table portfolios enable row level security;

drop policy if exists "portfolios_select_own" on portfolios;
create policy "portfolios_select_own"
  on portfolios for select using (auth.uid() = user_id);

drop policy if exists "portfolios_insert_own" on portfolios;
create policy "portfolios_insert_own"
  on portfolios for insert with check (auth.uid() = user_id);

drop policy if exists "portfolios_update_own" on portfolios;
create policy "portfolios_update_own"
  on portfolios for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "portfolios_delete_own" on portfolios;
create policy "portfolios_delete_own"
  on portfolios for delete using (auth.uid() = user_id);

-- Watchlist items: each row belongs to a single portfolio.
create table if not exists watchlist_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  symbol text not null,
  name text default '',
  quantity numeric,
  entry_price numeric,
  created_at timestamptz not null default now(),
  unique (portfolio_id, symbol)
);

create index if not exists watchlist_items_user_id_idx on watchlist_items(user_id);
create index if not exists watchlist_items_portfolio_id_idx on watchlist_items(portfolio_id);

alter table watchlist_items enable row level security;

drop policy if exists "watchlist_select_own" on watchlist_items;
create policy "watchlist_select_own"
  on watchlist_items for select using (auth.uid() = user_id);

drop policy if exists "watchlist_insert_own" on watchlist_items;
create policy "watchlist_insert_own"
  on watchlist_items for insert with check (auth.uid() = user_id);

drop policy if exists "watchlist_update_own" on watchlist_items;
create policy "watchlist_update_own"
  on watchlist_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "watchlist_delete_own" on watchlist_items;
create policy "watchlist_delete_own"
  on watchlist_items for delete using (auth.uid() = user_id);
