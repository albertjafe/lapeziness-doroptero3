-- Monitor del Mozarteum Salzburgo (19-11-2026): cuarto origen «mozarteum» en las
-- mismas tablas y la orden «moz_franjas» (lista completa de franjas deseadas).
alter table public.reservation_monitor_tokens drop constraint if exists reservation_monitor_tokens_source_check;
alter table public.reservation_monitor_tokens add constraint reservation_monitor_tokens_source_check
  check (source in ('alberto', 'emma', 'chen', 'mozarteum'));

alter table public.reservation_monitor_state drop constraint if exists reservation_monitor_state_source_check;
alter table public.reservation_monitor_state add constraint reservation_monitor_state_source_check
  check (source in ('alberto', 'emma', 'chen', 'mozarteum'));

alter table public.reservation_monitor_commands drop constraint if exists reservation_monitor_commands_source_check;
alter table public.reservation_monitor_commands add constraint reservation_monitor_commands_source_check
  check (source in ('alberto', 'emma', 'chen', 'mozarteum'));

alter table public.reservation_monitor_commands
  drop constraint reservation_monitor_commands_command_check;

alter table public.reservation_monitor_commands
  add constraint reservation_monitor_commands_command_check
  check (command in (
    'pause', 'resume', 'target_today', 'target_tomorrow', 'set_operating_mode',
    'set_migration', 'set_mirror', 'set_madrugada', 'set_aachen', 'set_wuppertal',
    'set_emergency', 'startup_select', 'start_monitor', 'cancel_start', 'shutdown',
    'run_quota_lab', 'reservation_modify', 'reservation_cancel', 'reservation_lock',
    'set_booking_type', 'franja_add', 'franja_remove', 'franja_skip', 'franja_resume',
    'set_blinds', 'set_priority', 'set_inicio', 'set_absorbe', 'set_pecera',
    'room_grid', 'set_max_reservation', 'allow_rebook', 'moz_franjas'
  ));

-- moz_franjas solo para el Mozarteum y con una lista de como mucho 60 franjas.
alter table public.reservation_monitor_commands
  add constraint reservation_monitor_commands_moz_franjas_check
  check (command <> 'moz_franjas' or (
    source = 'mozarteum'
    and jsonb_typeof(payload->'franjas') = 'array'
    and jsonb_array_length(payload->'franjas') <= 60
  ));
