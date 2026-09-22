# Recovery of repeated 57014 uploads — v432

The physical iPad still reported PostgreSQL 57014 after v431. Production retained
833 study blocks, last block on 18 September; its last document update was
21 September. Authenticated SQL statements have an 8-second limit. Extending the
browser deadline alone cannot change that limit. The exact pending iPad request
is unavailable, so measured reproductions are not presented as its captured SQL.

## Server change

Migration `20260922175710_optimize_sync_object_assembly.sql` replaces only
`document_merge`: extract children/clocks once and aggregate the result object
once, avoiding repeated detoasting and full-root copies per field. Array identity,
order, duplicate folding, clocks, unknown fields and tombstones are unchanged.
No user-data UPDATE, role timeout change, new API or trigger removal is involved.
The document hash and updated_at were identical before/after migration; all seven
triggers and the existing private function ACL remain. Security advisors before
and after contain the same existing findings, none introduced by this migration.

Read-only production profiles on the 3.2 MB document measured a small merge at
1360 ms before and 184 ms with the optimized function. A temporary copy with
large history and 128 changed Forest records completed an UPDATE in 1605 ms,
including the document, study and tombstone triggers. The backup trigger was not
attached to that temporary production-side copy, to avoid touching real backups.
All seven triggers, including backups, are exercised in local PostgreSQL tests.

## Client change

- The existing CAS writer uses `uploadBatch`, approximately 192 kB/128 records
  per request. Whole records retain anonymous and composite identities. One
  oversized indivisible record is allowed rather than silently stranded.
- Root practice blocks have priority over historical Forest updates. Nested
  object collections such as Deutsch cards can also be batched.
- Clocks for postponed scalar changes are withheld until their values are sent.
  Advancing them early would cause a later same-clock scalar to lose its edit.
- Each batch must be acknowledged under the existing conservative merge rule.
  Full pending local data is durably persisted and remains dirty until every
  batch is acknowledged. Timeout after a committed batch cannot duplicate study.
- A shared retry deadline covers saves, focus, periodic refresh and retries.
  57014 waits 30 s, then progressively up to 5 min. Explicit Re-sincronizar can
  bypass the waiting interval. Coalesced requests cannot rerun after a failure.
  Settings retain the real error and show the waiting phase when queried.

## Verification

- Runtime guard: 128 assets; existing safe-update protection retained.
- SQL integration: 32 tests, including all legacy triggers, full/delta/batch
  equivalence, field clocks, tombstones, 7426 Forest records and duplicate IDs.
- Batch tests: nested/scalar edits, deferred clocks, explicit clears, oversized
  anonymous records, partial success then 57014, durable pending data, retry
  throttling and resumption without duplicates.
- WebKit: seven integration tests passed (two independent devices, real SDK
  renewal, stalled auth, storage quota and safe updates).
- Chromium: the same seven integration tests passed. The reconnect test now
  advances its simulated clock through the intentional retry delay.
- Private WebKit reproduction with full history, actual SDK, IndexedDB and local
  PostgreSQL passed: four writes, zero errors, both devices 86 simulated minutes.
  It never sends fabricated test sessions to production.
- Broad unit run: four pre-existing failures remain outside sync (German window,
  two Chamber-factor expectations, old Llevas label). One obsolete cache assertion
  found during the run was updated and all affected runtime tests then passed.

Real device recovery still requires the pending iPad data to reach Supabase.
A passing simulation or installed server migration is not proof of that upload.
