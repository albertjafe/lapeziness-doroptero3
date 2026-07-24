create schema if not exists extensions;
create schema if not exists vault;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'study-push-dispatch'
  limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end;
$$;

select cron.schedule(
  'study-push-dispatch',
  '30 seconds',
  $job$
    select net.http_post(
      url := 'https://fexfeekifzgszluemihs.supabase.co/functions/v1/study-push-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'push-cron-secret'
          limit 1
        )
      ),
      body := '{"source":"supabase-cron"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
