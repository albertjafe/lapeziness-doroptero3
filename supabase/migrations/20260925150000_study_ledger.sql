-- Historial maestro de estudio: una fila por registro de estudio.
--
-- El documento user_data.data crece con todo el historial y cada guardado lo
-- reescribe entero (límite de 8 s). Esta tabla guarda los registros que
-- determinan el tiempo estudiado (sessionPlants, forestPlants, sesiones) uno a
-- uno: subir un bloque cuesta lo mismo con 800 que con 80.000 registros, y cada
-- dispositivo descarga solo las filas modificadas desde su último cursor.
--
-- Reglas:
-- * Clave (user_id, collection, record_key): reenviar la misma fila no duplica.
-- * Gana la edición más reciente del cliente (edited_at). Una fila más antigua
--   nunca sobrescribe a una más nueva, y un empate nunca resucita un borrado.
-- * Un borrado es una marca (deleted = true), nunca un DELETE.
-- * updated_at lo pone el servidor y es el cursor de descarga (con solape).
-- * seq es único y crece en cada escritura: pagina sin saltarse filas aunque
--   dos filas compartan updated_at o cambien mientras se descarga.

create sequence if not exists public.study_ledger_seq;

create table if not exists public.study_ledger (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection text not null check (collection in ('sessionPlants', 'forestPlants', 'sesiones')),
  record_key text not null check (length(record_key) between 1 and 2000),
  record jsonb,
  deleted boolean not null default false,
  edited_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  seq bigint not null default nextval('public.study_ledger_seq'),
  primary key (user_id, collection, record_key)
);

create index if not exists study_ledger_user_updated_idx
  on public.study_ledger (user_id, updated_at);
create index if not exists study_ledger_user_seq_idx
  on public.study_ledger (user_id, seq);

create or replace function public.study_ledger_keep_newest()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- An older edit, or a tie that would resurrect a deletion, keeps the row.
    if new.edited_at < old.edited_at
       or (new.edited_at = old.edited_at and old.deleted and not new.deleted) then
      return null;
    end if;
    -- Re-sending identical content does not move the download cursor.
    if new.deleted = old.deleted and new.edited_at = old.edited_at
       and new.record is not distinct from old.record then
      return null;
    end if;
    new.user_id := old.user_id;
  end if;
  new.updated_at := clock_timestamp();
  new.seq := nextval('public.study_ledger_seq');
  return new;
end;
$$;

drop trigger if exists study_ledger_keep_newest on public.study_ledger;
create trigger study_ledger_keep_newest
before insert or update on public.study_ledger
for each row execute function public.study_ledger_keep_newest();

alter table public.study_ledger enable row level security;

drop policy if exists "Users read their study ledger" on public.study_ledger;
drop policy if exists "Users create their study ledger" on public.study_ledger;
drop policy if exists "Users update their study ledger" on public.study_ledger;

create policy "Users read their study ledger"
  on public.study_ledger for select
  using (auth.uid() = user_id);
create policy "Users create their study ledger"
  on public.study_ledger for insert
  with check (auth.uid() = user_id);
create policy "Users update their study ledger"
  on public.study_ledger for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Sin política de DELETE: los borrados son marcas, nunca se eliminan filas.

grant select, insert, update on public.study_ledger to authenticated;
grant usage on sequence public.study_ledger_seq to authenticated;
revoke all on public.study_ledger from anon;
