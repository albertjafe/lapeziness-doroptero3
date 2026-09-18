# Server timeout and local-storage deadlines

The owner's v412 screenshot confirms authentication succeeds but a history upload returns PostgreSQL `57014`. A subsequent operation is at “Guardando la descarga en este dispositivo”. The code identifies a cancelled statement; the exact full failing iPad payload is unavailable, so isolated benchmarks are not proof of its total write time.

Read-only `EXPLAIN ANALYZE` on the existing production document measured `document_prune(data)` at 2,661 ms and `protect_study_works(data,data)` at 1,042 ms. Migration `20260918205809_optimize_document_tombstone_pruning.sql`, applied as `optimize_document_tombstone_pruning`, keeps the previous identity/filter rules and avoids rebuilding subtrees without deletion metadata. Changed objects are aggregated once, with each child evaluated once. The function remains immutable/invoker with a fixed search path; its existing private ACL and all triggers/RLS/timeouts are unchanged.

After installation, the same pruning SELECT measured 154 ms. A SELECT containing merge plus pruning with one diagnostic-only session record measured 1,801 ms. This record was never persisted. The production checksum remained `a2ac379c6d94ba8df4cbea81efab58e4` and `updated_at` remained unchanged after installation. The local migration name matches the production registry version, rather than the earlier CLI-generated timestamp.

PostgreSQL tests compare the previous and current pruning results for nested deletion metadata, anonymous/scalar records, unknown fields and SQL null. Existing CAS/clock/tombstone tests continue to exercise all installed legacy triggers; the synthetic restored-history write dropped from approximately 3.5 s to 0.6 s locally.

Client v413 prioritizes an existing pending upload through the sole CAS writer, which already reads/merges the remote row and persists the accepted result. A pending refresh therefore avoids a redundant pre-upload full download/local snapshot. A clean refresh still probes/downloads remote changes. A regression test requires one durable confirmation for a pending refresh.

Client v413 bounds each rescue database opening/read/write at 10 seconds. It closes late connections without writing and aborts timed-out write transactions before allowing later snapshots to run. Failed persistence does not acknowledge synchronization. Settings receives specific IDB failure codes via the existing sync stage, rather than leaving the cloud-operation queue permanently waiting. Tests simulate silent opening and writing, late completion and a subsequent newer successful snapshot. These changes preserve the same rescue database, key and document format; no data reset is involved.

The actual iPad upload and phone download remain the necessary end-to-end verification. Do not fabricate missing study or restore the obsolete morning export to replace either device.
