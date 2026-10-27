-- 26-10-2026: una copia de seguridad del documento como mucho cada hora (antes,
-- una cada 30 s mientras se guardaba). Cada copia es el documento entero
-- (~870 KB): con la app abierta llegaban a ser 120 por hora y agotaron el
-- presupuesto de disco del plan gratuito. Se guardan las 72 últimas (unos 3
-- días con uso continuo; antes 50 copias cubrían a veces menos de una hora).

create or replace function public.backup_user_data_before_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  inserted_backup boolean := false;
begin
  if old.data is distinct from new.data
     and not exists (
       select 1
       from public.user_data_backups b
       where b.user_id = old.id
         and b.backed_up_at >= now() - interval '60 minutes'
     ) then
    insert into public.user_data_backups(user_id, data, source_updated_at, backed_up_at)
    values (old.id, old.data, old.updated_at, now());
    inserted_backup := true;
  end if;

  if inserted_backup then
    delete from public.user_data_backups b
    where b.user_id = old.id
      and b.backup_id in (
        select backup_id
        from public.user_data_backups
        where user_id = old.id
        order by backed_up_at desc, backup_id desc
        offset 72
      );
  end if;

  return new;
end;
$function$;
