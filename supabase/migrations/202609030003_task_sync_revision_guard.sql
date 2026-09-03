-- Never let an older device overwrite a newer user_data snapshot by publishing
-- a lower _localRevision. Returning OLD makes the stale write a no-op while
-- still allowing the client to pull the newer revision on its next sync.
create or replace function public.guard_user_data_revision_regression()
returns trigger
language plpgsql
as $$
declare
  old_rev bigint := case
    when coalesce(old.data->>'_localRevision','') ~ '^[0-9]+$'
      then (old.data->>'_localRevision')::bigint
    else 0
  end;
  new_rev bigint := case
    when coalesce(new.data->>'_localRevision','') ~ '^[0-9]+$'
      then (new.data->>'_localRevision')::bigint
    else 0
  end;
begin
  if new_rev < old_rev then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists user_data_revision_regression_guard on public.user_data;
create trigger user_data_revision_regression_guard
before update on public.user_data
for each row execute function public.guard_user_data_revision_regression();
