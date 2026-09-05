# Profesor v349 · transferencia completa y referencia diaria

La vista Profesor prepara un único archivo TXT que incluye instrucciones, petición, condición del turno, hora local, referencia diaria y contexto completo. Puede adjuntarse en ChatGPT sin un mensaje preliminar. También existe «Copiar todo · un mensaje». Para contextos grandes, la interfaz recomienda el archivo.

## Contexto y rendimiento

- Compresión estructural reversible PIANO_PROF_V4: columnas y referencias evitan repetir nombres de campos. No utiliza cifrado ni Base64.
- Se conservan los campos JSON del informe, todas las unidades y el historial original, incluidos registros antiguos, vacíos y eventos sin repertorio. Estos últimos no generan prioridad musical por sí solos.
- El resumen diario de los últimos 90 días se calcula sobre práctica deduplicada; el historial anterior sigue completo en sourceContext. Los minutos de obra sin movimiento no se reparten.
- Un Web Worker prepara el informe y el Blob. La interfaz no recibe una segunda copia enorme del texto ni lo inserta en un textarea. Si falla el Worker, muestra un error recuperable.
- Una revisión u opción modificada invalida el contexto preparado; no se permite copiar una captura obsoleta.

## Referencia diaria

Selector persistente 4 / 5 / 6+ horas totales, descontando lo ya estudiado. La condición explícita del turno tiene prioridad sobre la preferencia y las cifras antiguas del prompt. Es una referencia flexible, no una cuota ni un techo. La planificación semanal interpreta la referencia por día.

## Validación local

- npm run check: 90 assets coherentes.
- npm run test:unit: 334 pruebas aprobadas.
- npm run test:e2e -- --workers=2: 114 aprobadas.
- npm run test:visual -- --workers=1: 3 aprobadas.
- Revisión final: seis pruebas dirigidas de transferencia, persistencia y chat temporal aprobadas.
- Descarga real del navegador con 80 movimientos y 3.001 registros: todos los registros originales recuperados al decodificar, resumen diario de 90 días, preferencia persistida y rechazo de copia obsoleta.
- Comparación sintética con 75 unidades (scripts/measure-professor.mjs): contexto denso anterior 104.739 bytes; V4 74.795 bytes, aproximadamente 29 % menos. No mide los datos reales del usuario ni garantiza esa reducción para otros historiales.

## Límites

Pruebas en Chromium con superficie de iPad simulada; no se ha verificado físicamente en el iPad del usuario ni accedido a su cuenta o datos. Adjuntar el archivo requiere una acción del usuario. El archivo evita pegar un texto enorme, pero la lectura efectiva y los límites de contexto dependen de la IA que lo reciba.
