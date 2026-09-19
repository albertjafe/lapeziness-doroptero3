# Complete cloud acknowledgements (v416)

The reported `CLOUD_CONFIRMATION_MISSING` was reproduced offline using the
previous iPad export and a read-only copy of the current cloud document. No
production practice was synthesized or restored from that outdated export.

Two independent causes prevented convergence:

- After `aa_preserve_document_fields` merged the upload conservatively, legacy
  study helpers chose whole records by timestamps. Equal timestamps selected an
  older record, removing newly supplied session notes, unknown properties and
  nested `_fieldClock` entries. A subsequent upload repeated the same loss.
- Anonymous array records used `JSON.stringify` as their client identity. JSONB
  reorders object keys, including nested keys. A weekly plan returned by the
  database could therefore look like a new record when compared with the upload.

Migration `20260919142631_preserve_sync_acknowledgement_fields.sql` makes the
three incompatible study helpers use `document_merge`, preserving field clocks
and unknown properties consistently with the main trigger. All triggers remain
enabled, including backups, revision protection, explicit deletions and derived
Forest-minute protection. Helpers remain private, immutable and invoker functions
with a fixed search path. RLS, auth and API timeouts are unchanged.

The client canonicalizes keys recursively only for anonymous record identities.
Remote duplicate IDs fold conservatively, matching PostgreSQL instead of dropping
fields from the earlier duplicate. The existing acknowledgement check still
rejects an incomplete response; it was not relaxed or bypassed.

## Validation

- Runtime consistency: 123 assets checked; 612 unit tests passed (75 files).
- Seven WebKit integration tests passed: bidirectional sync, auth recovery,
  storage quota, real SDK refresh, and both PWA safe-update lifecycle variants.
- Eight Chromium integration tests passed, including the same scenarios and
  offline reopening with the SDK and complete document available.

- Regression reproduced before the fix with `confirmed: false`, differences in
  `obras`, `weeklyPlans` and `sessionPlants`; the same private fixture finishes
  with `confirmed: true`, no differences, after both fixes.
- PostgreSQL integration exercises all existing triggers, equal-date notes,
  nested clocks, anonymous records, duplicates, repeated acknowledgements,
  independent devices, offline edits, CAS races and study across midnight.
- An isolated full-app WebKit iPad/iPhone run used the real pinned SDK, local
  PostgreSQL/PGlite behind the HTTP boundary, the large private history and
  IndexedDB recovery. Both contexts reached 86 minutes for the new day and clean
  sync metadata. Added test blocks existed only in this isolated database.
- Production migration changed definitions only. The user document hash,
  `updated_at` and 833 block count were identical immediately before/after it.
  A read-only EXPLAIN of a new block through document merge, study-record guard
  and tombstone pruning took 2.009 seconds. This is a SELECT benchmark, not a
  claim that the complete mobile network round trip takes that time.
- Supabase advisors reported no findings for the changed functions; existing
  unrelated findings remain outside this repair.

The actual iPad's new sessions still need to upload after it adopts the fixed
client. Passing isolated tests does not establish that the user's physical
devices have synchronized. Verify cloud evidence and the receiving phone before
claiming recovery. An up-to-date iPad export is useful if any difference remains.

The current v415 taximeter changes from origin/main were fast-forwarded before
publishing v416; their runtime behavior was preserved. Static assertions were
aligned with the already-existing three-decimal display and current PWA boundary.
