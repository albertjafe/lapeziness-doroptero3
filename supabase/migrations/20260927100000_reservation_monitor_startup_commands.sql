-- Arranque y cierre del monitor Asimut desde la app (27-09-2026).
-- startup_select / start_monitor / cancel_start sólo se aceptan mientras el
-- monitor espera en su menú de arranque; shutdown es el mismo cierre limpio
-- que el botón «Cerrar monitor» de Telegram. Las tres capas deben coincidir:
-- este CHECK, allowedCommands de reservation-monitor-ingest y el dispatcher
-- Python del monitor.

alter table public.reservation_monitor_commands
  drop constraint reservation_monitor_commands_command_check;

alter table public.reservation_monitor_commands
  add constraint reservation_monitor_commands_command_check
  check (command in (
    'pause',
    'resume',
    'target_today',
    'target_tomorrow',
    'set_operating_mode',
    'set_migration',
    'set_mirror',
    'set_madrugada',
    'set_aachen',
    'set_emergency',
    'startup_select',
    'start_monitor',
    'cancel_start',
    'shutdown'
  ));
