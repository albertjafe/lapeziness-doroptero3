# Flujo ChatGPT -> Codex

Este repo tiene un puente para que ChatGPT planifique y Codex ejecute sin volver a gastar Sol en pensar lo mismo.

## Uso normal

1. En ChatGPT di: **"Planifica este cambio para Codex y súbelo al puente"** y explica lo que quieres.
2. ChatGPT escribirá el plan en la rama `ai-control`, archivo `.ai/CURRENT_TASK.md`.
3. En PowerShell, desde la carpeta del repo, ejecuta:

   ```powershell
   .\ai.ps1
   ```

4. El script hará automáticamente:
   - descargar el último plan sin mezclar la rama `ai-control` con `main`;
   - crear/actualizar el mapa del repo con Luna cuando haga falta;
   - pedir a Luna una división mecánica del plan en paquetes pequeños;
   - ejecutar esos paquetes con Luna, secuencialmente y sobre el mismo working tree;
   - lanzar una única pasada final con Sol medium para integrar, revisar, corregir y ejecutar las comprobaciones relevantes.
5. El script no hace `git commit` ni `git push`. Revisa el diff y decide tú cuándo guardar el cambio.

## Otros comandos

```powershell
.\ai.ps1 -Action status
.\ai.ps1 -Action refresh-map
.\ai.ps1 -TaskFile .\mi-plan.md
```

`-TaskFile` sirve como alternativa manual: usa un plan local en vez del puente de GitHub.

## Archivos

- `AGENTS.md`: reglas permanentes para Codex.
- `.ai/REPO_MAP.md`: mapa compacto del proyecto para evitar reexplorarlo entero.
- `.ai/workplan.schema.json`: formato de los paquetes que genera Luna.
- `.ai/runtime/`: archivos temporales creados al ejecutar el flujo; está ignorado por git.
- Rama `ai-control` -> `.ai/CURRENT_TASK.md`: buzón donde ChatGPT deja el plan más reciente.

## Modelos

El flujo está pensado para `gpt-5.6-luna` y `gpt-5.6-sol`:

- Luna low: división mecánica del plan.
- Luna medium: mapa e implementación.
- Sol medium: una sola pasada de integración/revisión final.

Si una versión futura de Codex cambia los nombres de modelo, basta con editar las variables del principio de `ai.ps1`.
