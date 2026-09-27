-- Rescate de copias locales (27-09-2026).
-- Ajustes → Datos → «Recuperar datos de este dispositivo» sube, a petición del
-- dueño, una copia de solo lectura de lo que el dispositivo guarda en local
-- (localStorage e IndexedDB, nunca credenciales ni tokens) para poder compararla
-- con la nube y recuperar lo que no llegó a sincronizarse. Nada en la app lee
-- esta tabla para sincronizar: es solo para revisión.

create table public.device_recovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  capture_id uuid not null,
  created_at timestamptz not null default now(),
  device_label text check (device_label is null or char_length(device_label) <= 120),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  source text not null check (char_length(source) between 1 and 200),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  payload_gzip_b64 text check (payload_gzip_b64 is null or char_length(payload_gzip_b64) <= 20000000),
  payload jsonb,
  payload_bytes integer check (payload_bytes is null or payload_bytes >= 0)
);

create index device_recovery_snapshots_user_capture_idx
  on public.device_recovery_snapshots (user_id, created_at desc, capture_id);

alter table public.device_recovery_snapshots enable row level security;
revoke all on table public.device_recovery_snapshots from anon, authenticated;
grant select, insert on table public.device_recovery_snapshots to authenticated;
grant select, insert, update, delete on table public.device_recovery_snapshots to service_role;

create policy device_recovery_snapshots_select_own
  on public.device_recovery_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy device_recovery_snapshots_insert_own
  on public.device_recovery_snapshots
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

comment on table public.device_recovery_snapshots is
  'Copias de solo lectura del almacenamiento local de un dispositivo, subidas a petición para rescatar datos no sincronizados.';
