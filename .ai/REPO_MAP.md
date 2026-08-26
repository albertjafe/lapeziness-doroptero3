# Repository map

STATUS: SEED_ONLY

This is a seed map. `ai.ps1` will replace it with a compact Luna-generated map on the first run (or when `-Action refresh-map` is used).

## Project shape

- Browser/PWA application with a very large legacy-style `app.js` core.
- `index.html`: main page / DOM shell.
- `app.js`: main application logic; very large, so search exact symbols before reading ranges.
- `data-core.js`: shared/core data helpers.
- `google-calendar.js`: Google Calendar integration.
- `metronome.js`: metronome functionality.
- `mystery-house.js`: isolated feature/module.
- `manifest.json`, icons and service-worker-related files: PWA packaging/offline behavior.
- `native-ipad/`: native/iPad bridge/package work.
- `docs/`: project/audit screenshots and documentation.
- `AUDITORIA_GRAFICA_Y_FRONTEND.md`: large frontend/visual audit; read only when relevant.
- `AUDITORIA_Y_HOJA_DE_RUTA.md`: large audit/roadmap; read only when relevant.
- `CLAUDE.md`: prior detailed agent/project notes; consult only when a current task needs missing historical context.
- `.github/workflows/quality.yml`: CI quality pipeline.

## Verification baseline

CI uses Node 20 and runs:

- `npm run check`
- `npm run test:unit`
- `npm run test:e2e`
- `npm run test:visual`

## Map rules

The refreshed map should remain short and navigational. For each important source file/module, record purpose, important entry points/functions, important dependencies/consumers, and relevant tests. Do not copy implementation bodies.
