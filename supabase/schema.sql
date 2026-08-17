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

-- Assistant conversations (Spec A). Text-only transcripts: tool results are
-- point-in-time market data, so replaying them into a resumed conversation
-- would make the assistant confidently wrong about a live portfolio.
create table if not exists assistant_conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists assistant_messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references assistant_conversations(id) on delete cascade not null,
  -- Denormalised so RLS is a single-table predicate rather than a join,
  -- matching how watchlist_items above already does it.
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists assistant_messages_conversation_idx
  on assistant_messages(conversation_id, created_at);
create index if not exists assistant_conversations_user_idx
  on assistant_conversations(user_id, updated_at desc);

alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;

-- `with check` is spelled out rather than left to Postgres' fallback (which
-- reuses `using` when the check is omitted), matching the explicitness of the
-- watchlist policies above.
drop policy if exists "Users manage own conversations" on assistant_conversations;
create policy "Users manage own conversations"
  on assistant_conversations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own assistant messages" on assistant_messages;
create policy "Users manage own assistant messages"
  on assistant_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
