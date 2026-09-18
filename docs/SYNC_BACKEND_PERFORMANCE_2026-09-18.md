# Large-history cloud synchronization

The owner reported different study totals after updating iPad and phone to v410. Both devices showed pending uploads. A read-only production check confirmed that the cloud still lacked the later iPad study; successful two-device browser tests with a small fake transport had not covered this server-side cost.

The authenticated database role has an 8-second statement timeout. `EXPLAIN ANALYZE` on the existing 3.18 MB document, with one additional diagnostic record supplied only to a SELECT, measured 7,828 ms for `document_merge` alone. No diagnostic record was persisted.

Migration `20260918202404_optimize_document_record_merge.sql` was applied through Supabase MCP as `optimize_document_record_merge`, version `20260918202404`. The initial CLI-generated file was renamed to the version returned by the production migration registry. It replaces the growing JSON record index with grouped aggregation and an ordered fold within each identity. Field clocks, record identity, first-seen order, conservative scalar rules and tombstones remain unchanged. The helper is immutable, uses a fixed search path and is not executable by public/anon/authenticated clients. Existing triggers, policies and role timeouts remain in place.

Verification:

- The same read-only merge benchmark measured 1,726 ms after applying the migration.
- Merge plus study-record protection and recursive tombstone pruning measured 4,187 ms. This is a SELECT benchmark, not an assertion that every complete REST update finishes in that time.
- The production document checksum and `updated_at` were unchanged immediately before/after installation.
- PostgreSQL regression tests cover existing independent edits, CAS, unknown fields and deletions, plus duplicate identities against the previous server function and a synthetic multi-megabyte restored history with all legacy triggers.
- Security advisor findings were unchanged; the new helper introduces no executable public API or privilege escalation.

Runtime remains v410. End-to-end resolution still requires the actual pending iPad copy to upload and a subsequent phone download to show the same total. Do not fabricate missing study or restore an older export over either device to claim resolution.
