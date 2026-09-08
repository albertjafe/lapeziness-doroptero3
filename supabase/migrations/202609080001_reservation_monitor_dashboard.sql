-- Estado en vivo y cola de órdenes para el monitor de reservas Asimut.
-- El navegador sólo ve sus propias filas. El token del monitor nunca se
-- expone al cliente: la Edge Function lo valida y escribe con service_role.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.reservation_monitor_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('alberto', 'emma')),
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Monitor Asimut'
    check (char_length(label) between 1 and 80),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index reservation_monitor_tokens_user_source_idx
  on public.reservation_monitor_tokens (user_id, source);

alter table public.reservation_monitor_tokens enable row level security;
revoke all on table public.reservation_monitor_tokens from anon, authenticated;
grant select, insert, update, delete on table public.reservation_monitor_tokens to service_role;

comment on table public.reservation_monitor_tokens is
  'Hashes SHA-256 de tokens locales del monitor. No accesible desde clientes.';

create table public.reservation_monitor_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('alberto', 'emma')),
  schema_version smallint not null default 1 check (schema_version = 1),
  instance_id text check (instance_id is null or char_length(instance_id) <= 100),
  observed_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, source)
);

alter table public.reservation_monitor_state enable row level security;
revoke all on table public.reservation_monitor_state from anon, authenticated;
grant select on table public.reservation_monitor_state to authenticated;
grant select, insert, update, delete on table public.reservation_monitor_state to service_role;

create policy reservation_monitor_state_select_own
  on public.reservation_monitor_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.reservation_monitor_state is
  'Última instantánea compacta del monitor Asimut por usuario y perfil.';

create table public.reservation_monitor_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('alberto', 'emma')),
  command text not null check (command in (
    'pause',
    'resume',
    'target_today',
    'target_tomorrow',
    'set_operating_mode',
    'set_migration',
    'set_mirror',
    'set_madrugada',
    'set_aachen',
    'set_emergency'
  )),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'applied', 'rejected', 'error', 'expired')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  result text check (result is null or char_length(result) <= 500)
);

create index reservation_monitor_commands_pending_idx
  on public.reservation_monitor_commands (user_id, source, created_at)
  where status in ('pending', 'claimed');

alter table public.reservation_monitor_commands enable row level security;
revoke all on table public.reservation_monitor_commands from anon, authenticated;
grant select, insert on table public.reservation_monitor_commands to authenticated;
grant select, insert, update, delete on table public.reservation_monitor_commands to service_role;

create policy reservation_monitor_commands_select_own
  on public.reservation_monitor_commands
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy reservation_monitor_commands_insert_own
  on public.reservation_monitor_commands
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and claimed_at is null
    and completed_at is null
    and result is null
  );

comment on table public.reservation_monitor_commands is
  'Órdenes autenticadas de la app; sólo el monitor puede cambiar su estado.';

-- No permitimos que una respuesta retrasada sustituya una observación más nueva.
create or replace function private.keep_newest_reservation_monitor_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.observed_at < old.observed_at then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.keep_newest_reservation_monitor_state() from public, anon, authenticated;

create trigger reservation_monitor_state_keep_newest
before update on public.reservation_monitor_state
for each row execute function private.keep_newest_reservation_monitor_state();

-- Realtime respeta RLS: cada sesión autenticada sólo recibe sus filas.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservation_monitor_state'
  ) then
    alter publication supabase_realtime add table public.reservation_monitor_state;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservation_monitor_commands'
  ) then
    alter publication supabase_realtime add table public.reservation_monitor_commands;
  end if;
end
$$;
