create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;

revoke all on public.google_calendar_connections from anon, authenticated;
revoke all on public.google_calendar_oauth_states from anon, authenticated;

create index if not exists google_calendar_oauth_states_expiry_idx
  on public.google_calendar_oauth_states (expires_at);

