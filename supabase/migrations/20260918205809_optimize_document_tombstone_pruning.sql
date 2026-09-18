-- Performance-only replacement. Keep tombstone identity/filter semantics,
-- existing triggers and private function privileges unchanged.
create or replace function public.document_prune(value jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  -- Match the previous function's SQL-null result exactly.
  if value is null then return '{}'::jsonb; end if;
  if jsonb_typeof(value) not in ('array','object') then return value; end if;
  -- An unchanged subtree with no deletion metadata needs no reconstruction.
  if not jsonb_path_exists(value,'$.**."_deletedChildren"') then return value; end if;
  if jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.document_prune(v) order by ord),'[]') into result
      from jsonb_array_elements(value) with ordinality as e(v,ord);
    return result;
  end if;
  -- Compute each child once and aggregate the object once. Repeated jsonb_set
  -- copied the full restored history for every top-level property.
  with children as materialized (
    select key,public.document_prune(v) as child from jsonb_each(value) as e(key,v)
  )
  select coalesce(jsonb_object_agg(key,
    case when jsonb_typeof(child) = 'array' and value#>array['_deletedChildren',key] is not null then
      (select coalesce(jsonb_agg(v order by ord),'[]')
       from jsonb_array_elements(child) with ordinality as e(v,ord)
       where not (value#>array['_deletedChildren',key]) ? public.document_record_key(v))
    else child end),'{}') into result from children;
  return result;
end
$$;
