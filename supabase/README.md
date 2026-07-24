# Web Push deployment

The PWA client is versioned with the public VAPID key. Private values must only
exist in Supabase and must never be committed.

Deploy in this order:

1. Apply `migrations/202607230001_web_push.sql`.
2. Deploy `functions/study-push-dispatch` with JWT verification disabled.
3. Add Edge Function secrets named `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT`, and `CRON_SECRET`.
4. Store the same cron secret in Vault with the name `push-cron-secret`:

   ```sql
   select vault.create_secret('<CRON_SECRET>', 'push-cron-secret');
   ```

5. Apply `migrations/202607230002_schedule_web_push.sql`.
6. Invoke the function once with a POST request and `x-cron-secret` to verify it
   returns a JSON summary, then inspect the first Cron run.

The function automatically removes expired push subscriptions after a 404 or
410 response from a push service.
