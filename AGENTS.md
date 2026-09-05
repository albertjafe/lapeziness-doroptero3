# Codex operating instructions

This repository uses an external planning -> implementation workflow designed to minimize repeated reasoning and expensive model usage. Keep this file compact: use it for permanent guardrails and routing, while `.ai/APP_MAP.md` contains the detailed architecture/feature map.

## Instruction hierarchy

For task intent, use this order:

1. The user's current direct request and constraints.
2. A current bridge task (`.ai/runtime/CURRENT_TASK.md`) when the bridge workflow is actually being used for that request.
3. These permanent repository instructions.
4. Repository maps/documentation.

A stale `CURRENT_TASK.md` must never override a newer direct request. When using the bridge, `CURRENT_TASK.md` is the authoritative implementation plan for that request; do not restart broad architectural planning unless source code proves a concrete assumption wrong.

For implementation facts, current source code is the final authority. If code contradicts `.ai/APP_MAP.md`, trust the code for the immediate implementation and update the map in the same change when the discrepancy is architectural/material.

## Mandatory context

Before changing code:

1. Read `.ai/APP_MAP.md` first. It is the tracked, canonical, remote-friendly architecture/feature map.
2. If `.ai/runtime/REPO_MAP.md` exists, use it only as optional extra local detail. `.ai/REPO_MAP.md` is only a compatibility pointer/seed.
3. If the bridge workflow is in use and `.ai/runtime/CURRENT_TASK.md` exists, read it in full.
4. If `.ai/runtime/WORKPLAN.json` exists for that bridge task, use it as the execution breakdown.

Do not infer that an old runtime task applies merely because the file exists.

## Efficiency rules

- Treat `.ai/APP_MAP.md` as the default answer to “where does this feature live?”. Do not rediscover the whole repository when the map already identifies the relevant modules.
- Inspect only files relevant to the current task. Prefer targeted search (`rg`, symbol/function search) before opening files.
- `app.js` and `styles.css` are extremely large: never reread them wholesale unless genuinely necessary. Search exact symbols/IDs/features and inspect narrow ranges.
- Do not read `CLAUDE.md`, `AUDITORIA_GRAFICA_Y_FRONTEND.md`, or `AUDITORIA_Y_HOJA_DE_RUTA.md` by default. They are large and may contain historical/stale state; consult them only when the task specifically needs that history/audit.
- Do not perform unrelated refactors, cleanup, renaming, formatting, dependency upgrades, or feature work.
- Reuse existing project patterns before inventing new abstractions.

## Change-scope rules

- Preserve existing behavior outside the requested change.
- Prefer the smallest coherent change that satisfies the acceptance criteria.
- Do not install new dependencies unless the task explicitly requires them or there is no reasonable alternative.
- If the request is only to audit, review, inspect, explain, or diagnose, treat it as read-only by default. Do not modify code/data unless the user also asks for a fix or implementation.
- Do not weaken, delete, or rewrite tests merely to make CI green. Update expectations only when the intended product contract genuinely changed.
- Do not switch branches, reset, rebase, or rewrite git history unless the current task explicitly asks for it.

## Real user data and persistence guardrails

This app contains real practice history and production Supabase data. Treat persistence changes as high risk.

- Never delete, rewrite, fabricate, or “correct” production user data merely to make the UI display the expected result. Diagnose and fix the calculation/data-flow cause first.
- Production reads are allowed when needed to diagnose a task. Production writes/deletes must be explicitly required by the current task and must be as targeted as possible.
- Preserve unknown JSON fields and existing conservative merge/tombstone semantics. Absence of a field is not automatically a deletion.
- Do not introduce a second independent full-document writer for `user_data`; use the existing save/sync architecture.
- For Supabase schema changes, prefer a new migration. Do not rewrite an already-applied production migration as a shortcut.
- Never commit credentials, API keys, tokens, local secrets, `.env.push.local`, or private user-data exports.

## Study-time and timer invariants

These are product contracts, not implementation suggestions:

- A real block of practice must count once in daily/weekly totals, never once per mirror/storage representation.
- Timed practice blocks (`sessionPlants`, plus the corresponding historical timed structures where applicable) are the canonical evidence for elapsed practice time. `sesiones` can contain summaries/mirrors and must not blindly be added on top of the same timed block.
- Passage timers are subdivisions/annotations of the master study block. Passage minutes do **not** add extra practice time on top of the master timer.
- It must be valid to finish the master timer while a passage timer is still active: the passage must close/commit coherently; the user should not need to stop timers in a special order.
- When changing timer, session, passage, or daily-total logic, add/adjust a regression test for duplicate counting, close order, or persistence as appropriate.

## PWA/runtime changes

The app is deployed as a versioned PWA. A runtime JavaScript/CSS change is not complete merely because the source file changed.

- Check `index.html`, `piano-rooms.js`, and `sw.js` for the actual load/precache path relevant to the changed module.
- Follow the existing cache/query-version convention; do not hardcode an old version from documentation.
- New runtime assets must be loaded and precached when appropriate.
- Preserve the safe-update lifecycle in `update-safety.js`/`sw.js`; do not bypass persistence safeguards just to force an update.
- `npm run check` is the first required guard for loader/precache/version consistency after runtime changes.

## Commit and bridge behavior

- The repository owner granted standing authorization on 2026-09-05 to commit and push changes that are within the user's requested task. Do not ask again for commit/push permission for such changes.
- This authorization does **not** change the behavior of `ai.ps1`: the bridge script deliberately leaves its working-tree changes uncommitted for review. Do not modify that workflow merely to make it auto-commit unless explicitly requested.

## Verification

Use targeted checks while implementing. Before final completion, run the checks relevant to the changed contract.

The current GitHub Actions quality workflow runs:

- `npm run check`
- `npm run test:unit`
- `node scripts/check-e2e-known-baseline.cjs`
- `npm run test:visual`

`npm run test:e2e` also exists for direct full Playwright E2E runs, but it is not the exact CI command at the time of this audit.

For a narrow work packet, targeted unit/E2E specs are acceptable during implementation. Before declaring a risky persistence, timer, sync, or PWA change complete, run the broadest practical checks for that subsystem and inspect CI when changes are pushed.

## Repository map maintenance

`.ai/APP_MAP.md` is the canonical tracked map. Update it in the same change only when the change materially alters:

- file/module responsibility;
- architecture or data flow;
- an important feature contract/semantic rule;
- important entry points or exported/public functions;
- the recommended “where to look for X” routing.

Do **not** turn it into a changelog or duplicate implementation bodies. Ordinary internal edits that do not change those contracts do not require a map update.

`.ai/runtime/REPO_MAP.md` is optional local reconnaissance generated by the AI workflow and may be more detailed. Files under `.ai/runtime/` are temporary/local coordination artifacts and must not be committed.