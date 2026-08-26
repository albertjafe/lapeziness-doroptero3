# Codex operating instructions

This repository uses an external planning -> implementation workflow designed to minimize expensive model usage.

## Mandatory context

Before changing code:

1. Read `.ai/REPO_MAP.md`.
2. If `.ai/runtime/CURRENT_TASK.md` exists, read it in full.
3. If `.ai/runtime/WORKPLAN.json` exists, use it as the execution breakdown.

`CURRENT_TASK.md` is planned externally and is authoritative. Do **not** restart broad architectural planning or re-derive the task from scratch. Only deviate when the repository proves a concrete assumption wrong; if so, make the smallest necessary adjustment and explain it in the final result.

## Efficiency rules

- Inspect only files relevant to the current task. Prefer targeted search (`rg`, symbol/function search) before opening large files.
- `app.js` is very large: never reread it wholesale unless genuinely necessary. Search for exact symbols/features first and inspect narrow ranges.
- Do not read the large audit documents unless the task specifically needs them.
- Do not perform unrelated refactors, cleanup, renaming, formatting, dependency upgrades, or feature work.
- Reuse existing project patterns before inventing new abstractions.

## Implementation rules

- Preserve existing behavior outside the requested change.
- Prefer the smallest coherent change that satisfies the acceptance criteria.
- Do not install new dependencies unless the task explicitly requires them or there is no reasonable alternative.
- Do not commit, push, switch branches, reset, rebase, or rewrite git history unless the current task explicitly asks for it.

## Verification

Use targeted checks while implementing. Before final completion, run the relevant project checks. The CI currently uses:

- `npm run check`
- `npm run test:unit`
- `npm run test:e2e`
- `npm run test:visual`

Run only the suites relevant to a work packet; the final integrator should run the broadest practical set relevant to the whole task.

## Repository map maintenance

Keep `.ai/REPO_MAP.md` compact. Update it only when a change materially alters file responsibilities, architecture, important entry points, or important exported/public functions. Do not turn it into a changelog or duplicate source code.

Files under `.ai/runtime/` are temporary coordination artifacts and must not be committed.
