-- The first trigger already merges by field clocks. Legacy whole-record winners
-- subsequently discarded notes/unknown fields/clocks on equal timestamps, so a
-- successful UPDATE never acknowledged the complete outgoing document.
-- Keep every trigger, backup, tombstone and derived-minute protection in place;
-- use the same conservative merge contract in the three incompatible helpers.
create or replace function public.merge_study_record_arrays(old_items jsonb, new_items jsonb)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select public.document_merge(public.study_jsonb_array(old_items), public.study_jsonb_array(new_items));
$$;

create or replace function public.merge_study_history_arrays(old_items jsonb, new_items jsonb)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select public.document_merge(public.study_jsonb_array(old_items), public.study_jsonb_array(new_items));
$$;

create or replace function public.merge_study_movement(old_movement jsonb, new_movement jsonb)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select public.document_merge(old_movement,new_movement);
$$;

revoke all on function public.merge_study_record_arrays(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.merge_study_history_arrays(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.merge_study_movement(jsonb,jsonb) from public, anon, authenticated;
