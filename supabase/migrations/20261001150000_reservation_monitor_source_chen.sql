-- Tercer monitor «chen» (01-10-2026): cuenta prestada mientras la de Alberto
-- está desactivada. Mismas tablas; solo se amplía la lista de orígenes.
alter table public.reservation_monitor_tokens drop constraint if exists reservation_monitor_tokens_source_check;
alter table public.reservation_monitor_tokens add constraint reservation_monitor_tokens_source_check
  check (source in ('alberto', 'emma', 'chen'));

alter table public.reservation_monitor_state drop constraint if exists reservation_monitor_state_source_check;
alter table public.reservation_monitor_state add constraint reservation_monitor_state_source_check
  check (source in ('alberto', 'emma', 'chen'));

alter table public.reservation_monitor_commands drop constraint if exists reservation_monitor_commands_source_check;
alter table public.reservation_monitor_commands add constraint reservation_monitor_commands_source_check
  check (source in ('alberto', 'emma', 'chen'));
