# Incremental history uploads — v431

Built on origin/main v430 (`4d9c88a`), preserving intervening manual-study,
urgent-task, reward, German and historical Chamber ×0.5 changes. This repair
changes the existing sync writer, local rescue bookkeeping and runtime loading.
No additional cloud writer, schema change or production data restoration.

## Changes

- `uploadDelta(remote, merged)` sends only changed object properties and complete
  changed array records. Parent field clocks and explicit deletion maps remain
  attached. Missing properties are not deletions. Existing SQL
  `document_merge(OLD, NEW)` reconstructs the complete document under the same
  compare-and-swap condition; new rows still use a complete insert. The returned
  **full** document must pass the existing acknowledgement check.
- A read that already confirms the desired content skips UPDATE. A stale phone
  with no actual edits downloads the study, and a lost response after a committed
  upload is acknowledged on retry without repeating the write.
- The upload snapshot combines actual memory/storage documents directly rather
  than adding domain-normalizer defaults that manufacture unrelated changes.
- IndexedDB recovery captures genuine live edits before merging, then remembers
  the recovered document as the edit baseline before saving. Restoration no
  longer stamps all old practice records as newly edited.
- History fetch/query deadlines are 60 seconds to include large response bodies.
  Auth retains 20 seconds. Timeout still aborts the real operation, leaves dirty
  metadata and cannot acknowledge a late response.
- The premium timer's static and dynamic loaders now share the same guarded DOM
  ID and current v430 asset. The old loader was still requesting v408, absent from
  the new precache, and could initialize the module twice. Its feature code and
  all latest reward calculations remain untouched.

## Evidence and limits

The full-app private WebKit iPad/iPhone reproduction uses the real pinned SDK,
PGlite with every relevant production trigger, independent browser storage and
IndexedDB recovery. It connects only to a local test database. The test clock is
fixed; added test blocks never enter Supabase. Before the rescue-baseline fix,
first uploads were approximately 5.8–6 MB. After the fix the iPad sent 408,779 bytes
then 1,480 bytes; both devices reached the expected 86 minutes and clean metadata,
with two writes total and no additional phone write. A simple new-block delta
against the private history measured 384 bytes versus a 3,012,744-byte document.

PostgreSQL tests compare full versus partial writes, including unknown fields,
7,426 retained Forest records, notes, corrected minutes, tombstones and movements.
Other tests cover simultaneous devices, edits during acknowledgement/persistence,
offline recovery, response loss after commit, auth failure and real cancellation.

Runtime consistency passes for 128 assets. The broad unit run has 649 passing
tests and four pre-existing failures in untouched areas: the German rolling-window
expectation, two Chamber-factor expectations, and the old `Llevas` label assertion.
Their feature implementations have not been changed to make this sync repair pass.

Seven WebKit and eight Chromium integration tests passed, covering real-SDK
renewal, independent devices, unavailable auth, localStorage quota, safe PWA
activation and (Chromium) offline reopening. The full private-history WebKit run
described above is additional to those tracked integration tests.

Physical-device recovery remains to be confirmed after both devices install
v431. A successful isolated test is not proof that their pending local history
has reached production. Do not replace production history with the old export
or disable the acknowledgement check to make the status appear synchronized.
