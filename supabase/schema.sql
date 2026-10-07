-- Valantis Collab Tracker — database setup.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run more than once.

-- One row per influencer (grouped by phone number; the id is a hash, not the phone itself).
create table if not exists public.influencers (
  id            text primary key,
  name          text not null default '',
  city          text not null default '',
  order_ids     text[] not null default '{}',     -- Shopify order IDs of every seeding we've sent them
  first_seeded  timestamptz,
  code          text not null default '',          -- their discount code, typed in by the team
  pct           numeric(5,2) check (pct is null or (pct >= 0 and pct <= 100)),  -- commission %
  updated_at    timestamptz not null default now(),
  updated_by    text not null default ''
);

-- One row per collab shipment (Shopify order) that someone has tracked.
create table if not exists public.shipments (
  id             text primary key,                 -- "o_" + Shopify order number id
  order_name     text not null default '',         -- e.g. #6854
  influencer_id  text not null default '',
  content        text not null default 'pending' check (content in ('pending', 'posted', 'skip')),
  content_link   text not null default '',
  posted_on      date,
  delivered_on   date,                             -- only when Shopify doesn't know the delivery date
  r1_sent        date,
  r2_sent        date,
  updated_at     timestamptz not null default now(),
  updated_by     text not null default ''
);

-- Reminder settings (days + WhatsApp message wording).
create table if not exists public.settings (
  id          text primary key,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

-- Who changed what, when. Read it in Supabase → Table Editor → edits.
create table if not exists public.edits (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  who      text not null,
  kind     text not null,
  row_id   text not null,
  changes  jsonb not null
);

-- Wrong-password attempts, used to lock out guessing.
create table if not exists public.login_failures (
  id  bigserial primary key,
  ip  text not null,
  at  timestamptz not null default now()
);

create index if not exists influencers_updated_at on public.influencers (updated_at);
create index if not exists shipments_updated_at  on public.shipments (updated_at);
create index if not exists edits_at              on public.edits (at desc);
create index if not exists login_failures_ip_at  on public.login_failures (ip, at);

-- Lock every table. Row Level Security with no policies = nobody can read or write
-- through Supabase's public API. Only our Vercel server (using the service_role key) can.
alter table public.influencers    enable row level security;
alter table public.shipments      enable row level security;
alter table public.settings       enable row level security;
alter table public.edits          enable row level security;
alter table public.login_failures enable row level security;

-- Housekeeping: forget failed logins older than a day (call occasionally, or ignore — the table stays tiny).
create or replace function public.prune_login_failures() returns void language sql as $$
  delete from public.login_failures where at < now() - interval '1 day';
$$;
