alter table public.google_calendar_connections
  add column if not exists ai_log_spreadsheet_id text,
  add column if not exists ai_log_synced_at timestamptz;

comment on column public.google_calendar_connections.ai_log_spreadsheet_id is 'Google Sheet created for the user-facing AI activity log.';
comment on column public.google_calendar_connections.ai_log_synced_at is 'Last successful export of non-sensitive study/activity data to the AI activity log.';
