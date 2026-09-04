# Flujo ChatGPT -> Codex

Este repo tiene un puente para que ChatGPT planifique y Codex ejecute sin volver a gastar Sol en pensar lo mismo. Además mantiene un **mapa canónico compacto de la app** para que cualquier IA pueda entrar al repositorio sin reconstruir toda la arquitectura ni leer `app.js` entero.

## Contexto mínimo para cualquier IA

Antes de investigar el código:

1. Leer `.ai/APP_MAP.md` — mapa canónico versionado y accesible desde GitHub.
2. Leer `AGENTS.md` — reglas permanentes y de ahorro de contexto.
3. Solo después abrir los 2–3 módulos que `.ai/APP_MAP.md` indique para la feature concreta.

`.ai/runtime/REPO_MAP.md` puede aportar más detalle cuando se trabaja localmente, pero no es necesario para que una IA remota entienda la app.

## Uso normal del puente

1. En ChatGPT di: **"Planifica este cambio para Codex y súbelo al puente"** y explica lo que quieres.
2. ChatGPT escribirá el plan en la rama `ai-control`, archivo `.ai/CURRENT_TASK.md`.
3. En PowerShell, desde la carpeta del repo, ejecuta:

   ```powershell
   .\ai.ps1
   ```

4. El script hará automáticamente:
   - descargar el último plan sin mezclar la rama `ai-control` con tu rama local;
   - usar el mapa canónico y crear/actualizar un mapa local más detallado con Luna cuando haga falta;
   - pedir a Luna una división mecánica del plan en paquetes pequeños;
   - ejecutar esos paquetes con Luna, secuencialmente y sobre el mismo working tree;
   - lanzar una única pasada final con Sol medium para integrar, revisar, corregir y ejecutar las comprobaciones relevantes.
5. El script no hace `git commit` ni `git push`. Revisa el diff y decide tú cuándo guardar el cambio.

## Otros comandos

```powershell
.\ai.ps1 -Action status
.\ai.ps1 -Action refresh-map
.\ai.ps1 -TaskFile .\mi-plan.md
.\ai.ps1 -AllowDirty
```

`-TaskFile` usa un plan local en vez del puente de GitHub. `-AllowDirty` permite ejecutar sobre un working tree que ya tenga cambios; por seguridad, el comportamiento normal es exigir un árbol limpio.

## Archivos

- `.ai/APP_MAP.md`: **mapa canónico y compacto de la aplicación**. Está versionado y debe ser la primera referencia de arquitectura/features para cualquier IA.
- `AGENTS.md`: reglas permanentes para Codex/agentes; obliga a leer `APP_MAP` primero y evita releer archivos gigantes.
- `.ai/REPO_MAP.md`: shim/seed de compatibilidad para flujos antiguos; apunta al mapa canónico.
- `.ai/runtime/REPO_MAP.md`: mapa detallado generado por Luna en tu ordenador; persiste entre ejecuciones pero está ignorado por git.
- `.ai/workplan.schema.json`: formato de los paquetes que genera Luna.
- `.ai/runtime/`: archivos temporales/locales creados al ejecutar el flujo; está ignorado por git.
- Rama `ai-control` -> `.ai/CURRENT_TASK.md`: buzón donde ChatGPT deja el plan más reciente.

## Mantenimiento del mapa

No hace falta regenerar un mapa caro después de cada edición. La norma es más barata:

- si cambia solo implementación interna, no tocar `APP_MAP`;
- si cambia arquitectura, responsabilidad de archivos, flujo de datos, una regla importante de producto o dónde vive una feature, actualizar `.ai/APP_MAP.md` en ese mismo cambio;
- si una tarea local necesita reconocimiento profundo, `ai.ps1 -Action refresh-map` puede regenerar `.ai/runtime/REPO_MAP.md`.

Esto evita depender únicamente del hash de nombres de archivo de `ai.ps1`: una IA remota siempre dispone de un mapa versionado actual aunque hayan cambiado responsabilidades dentro de archivos existentes.

## Documentos históricos grandes

`CLAUDE.md`, `AUDITORIA_GRAFICA_Y_FRONTEND.md` y `AUDITORIA_Y_HOJA_DE_RUTA.md` no son contexto inicial. Pueden contener historia valiosa, pero también estados antiguos y cuestan mucho contexto. Solo deben abrirse cuando una tarea necesite expresamente esa información.

## Modelos

El flujo está pensado para `gpt-5.6-luna` y `gpt-5.6-sol`:

- Luna low: división mecánica del plan.
- Luna medium: mapa e implementación.
- Sol medium: una sola pasada de integración/revisión final.

Si una versión futura de Codex cambia los nombres de modelo, basta con editar las variables del principio de `ai.ps1`.
