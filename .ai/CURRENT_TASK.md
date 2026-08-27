# Catálogo local de repertorio + buscador tipo YouTube al añadir obra

STATUS: READY

## Objetivo de producto

Al pulsar **Añadir obra**, transformar la entrada manual actual en una experiencia de búsqueda/autocompletado rápida y musical:

- el usuario escribe libremente `valle de...`, `Beethoven sonata 49`, `Sonata Op. 49`, `Chopin op 10 no 10`, `Bach BWV 893`, etc.;
- debajo aparecen sugerencias relevantes mientras escribe, al estilo YouTube/Spotify;
- al tocar una sugerencia, se rellenan automáticamente los datos fiables de la obra (como mínimo nombre canónico y compositor; también duración si el catálogo la tiene y encaja con el formulario actual);
- siempre existe una salida clara **Crear manualmente “…”** para obras que no estén en catálogo;
- el runtime debe funcionar **local/offline**: no consultar IMSLP mientras el usuario escribe.

Ejemplo obligatorio:

`valle de` debe encontrar **Vallée d'Obermann, S.160/6 — Franz Liszt**, mediante alias español `Valle de Obermann`.

## Fuente de catálogo y licencia

Usar IMSLP únicamente como **fuente de generación/actualización del catálogo**, no como dependencia en tiempo real.

La API oficial documenta listas paginadas de personas y obras:
- people: `http://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=1/start=0/retformat=json`
- works: `http://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/sort=id/type=2/start=0/retformat=json`

IMSLP/MediaWiki declara CC BY-SA 4.0 para este contenido. Añadir documentación/atribución adecuada junto al dataset y, si es razonable, una nota discreta en la UI de Añadir obra (`Catálogo basado en IMSLP · CC BY-SA 4.0`) sin ensuciar la interfaz.

**No descargar ni incluir partituras, PDFs, imágenes ni grabaciones. Solo metadatos textuales.**

## Alcance de la primera versión

No meter las ~260k obras de IMSLP. Crear una base local grande y útil con los principales compositores de repertorio clásico, con especial cuidado por repertorio pianístico/cámara/orquestal habitual.

El generador debe partir de una lista/configuración mantenible de compositores principales, aproximadamente 40–70 inicialmente. Incluir como mínimo, cuando IMSLP tenga obra catalogada, familias como:

Bach, Handel, D. Scarlatti, Haydn, Mozart, Beethoven, Schubert, Mendelssohn, Schumann, Chopin, Liszt, Brahms, Tchaikovsky, Mussorgsky, Balakirev, Rimsky-Korsakov, Borodin, Saint-Saëns, Franck, Fauré, Grieg, Dvořák, Smetana, Sibelius, Debussy, Ravel, Albéniz, Granados, Falla, Rachmaninoff/Rachmaninov, Scriabin, Prokofiev, Bartók, Janáček, Stravinsky y otros grandes que el dataset permita legalmente.

No forzar compositores modernos protegidos que IMSLP no tenga. La creación manual sigue cubriendo esos casos.

## Arquitectura recomendada

Mantener esto fuera del `app.js` gigante en la medida de lo posible.

### 1. Core puro de búsqueda

Crear algo como `work-catalog-core.js`, UMD/CommonJS testeable, responsable de:

- normalización;
- tokenización;
- alias;
- ranking;
- búsqueda;
- formateo básico de resultado si conviene.

API orientativa:

```js
normalizeCatalogText(text)
searchWorks(catalog, query, options?) => [
  { work, score, matchedBy }
]
```

Sin dependencias pesadas si no son necesarias. Para este tamaño, una implementación propia bien probada es preferible a meter una librería grande solo para fuzzy search.

### 2. Dataset local generado

Crear una ubicación clara, por ejemplo:

- `data/classical-works-catalog.json`
- `data/classical-catalog-overrides.json`
- `data/CLASSICAL_CATALOG_LICENSE.md`

El JSON generado debe ser runtime-ready y razonablemente compacto.

Shape orientativo por obra:

```json
{
  "id": "liszt-s160-6",
  "composer": "Franz Liszt",
  "composerAliases": ["Liszt"],
  "title": "Vallée d'Obermann, S.160/6",
  "titleAliases": ["Valle de Obermann", "Vallee d'Obermann"],
  "catalog": "S.160/6",
  "key": null,
  "durationMin": null,
  "source": "IMSLP"
}
```

No almacenar campos vacíos si incrementa mucho el tamaño. Se puede precomputar un `searchText` normalizado si mejora de forma medible la velocidad y el coste de almacenamiento sigue siendo razonable.

### 3. Generador reproducible

Crear un script de mantenimiento, por ejemplo `scripts/build-classical-catalog.mjs`, que:

1. consulta/pagina la API de IMSLP;
2. filtra por la configuración de compositores principales;
3. limpia y normaliza títulos/compositores;
4. extrae catálogo/opus/número cuando esté claramente presente en los títulos/metadatos;
5. aplica overrides/alias manuales;
6. elimina duplicados obvios;
7. ordena de forma determinista;
8. genera `data/classical-works-catalog.json`;
9. imprime estadísticas (nº compositores, nº obras, tamaño final).

El runtime **no depende de ejecutar este script**. El JSON generado queda versionado en el repo.

Si la API de IMSLP no es accesible desde el entorno de ejecución de Codex, no inventar un catálogo falso. Implementar core/UI/generador y crear un starter catalog suficientemente útil a partir de datos verificables disponibles; dejar un blocker claro con el comando exacto para regenerar cuando haya red. Pero intentar primero obtener y generar el catálogo real.

## Búsqueda: comportamiento musical, no literal

La búsqueda debe ser instantánea y tolerante.

### Normalización obligatoria

Ignorar diferencias de:

- mayúsculas/minúsculas;
- tildes/diacríticos (`Vallée` ~= `vallee`);
- apóstrofes y puntuación;
- espacios repetidos;
- `Op. 49`, `Op 49`, `opus 49`;
- `No.2`, `No 2`, `Nº 2`, `Nr. 2`, `n.2`;
- formas de catálogo razonables (`BWV 893`, `BWV893`; `S.160/6`, `S160 6`; `K. 331`, `K331`; `Hob. XVI:23`, `Hob XVI 23`);
- nombres alternativos frecuentes de compositor (`Rachmaninoff` / `Rachmaninov`, `Tchaikovski` / `Tchaikovsky`, etc.).

No hace falta traducción automática universal, pero sí un sistema de aliases manuales mantenible para títulos famosos. Incluir **`Valle de Obermann`** obligatoriamente.

### Ranking esperado

Priorizar aproximadamente:

1. coincidencia exacta/por prefijo del título o alias;
2. tokens de título + catálogo/número;
3. compositor + título/catálogo;
4. catálogo exacto;
5. coincidencias fuzzy leves / errores tipográficos pequeños;
6. coincidencias genéricas al final.

No dejar que escribir solo `sonata` haga inutilizable la lista: usar compositor, número, opus/catálogo y popularidad/orden razonable para desempatar. Limitar resultados visibles (p.ej. 8–12) y mantener la búsqueda completa en memoria.

Casos de aceptación mínimos:

- `valle de` => Vallée d'Obermann / Liszt entre los primeros resultados.
- `ober` => Vallée d'Obermann.
- `beethoven sonata 49` => Op.49 Nos.1/2 entre los primeros.
- `sonata op 49` => Beethoven Op.49 Nos.1/2 muy arriba.
- `chopin op 10 10` => Étude Op.10 No.10.
- `bach bwv 893` => WTC II B minor BWV 893.
- `haydn xvi 23` => Sonata Hob.XVI:23.
- `liszt s 160 6` => Vallée d'Obermann.
- una errata pequeña como `beethven op 49` debe seguir encontrando Beethoven.

## UX de “Añadir obra”

Primero localizar el flujo/modal/formulario existente mediante `rg`; no rediseñar otras partes.

### Estado inicial

- Mantener el aspecto general de la app.
- El campo principal pasa a comportarse como buscador/autocomplete.
- Placeholder humano: algo como `Busca obra, compositor, opus…`.
- No abrir 500 resultados al entrar: mostrar quizá recientes/sugerencias solo si encaja con el diseño, o esperar a 1–2 caracteres.

### Mientras escribe

Mostrar dropdown/lista inmediatamente debajo del input con filas claras:

**Vallée d'Obermann, S.160/6**
`Franz Liszt`

Opcionalmente metadatos secundarios discretos si existen (`Si menor · ~8 min`), pero no sobrecargar.

- Resaltar de forma sutil la parte coincidente si es fácil y accesible.
- Touch targets cómodos para iPad/iPhone.
- Keyboard: flechas arriba/abajo, Enter selecciona, Escape cierra.
- Cerrar al tocar fuera.
- No romper scroll/modales/safe areas.

### Seleccionar una obra

Al elegir resultado:

- rellenar el nombre canónico que tenga sentido para el esquema actual;
- rellenar compositor;
- rellenar duración solo si existe un dato fiable y el formulario ya posee ese campo;
- **no autoasignar dificultad, solidez, estado ni otros datos personales**;
- el usuario todavía puede editar antes de guardar;
- no crear automáticamente movimientos salvo que el dato sea realmente fiable y ya exista una UX preparada. V1 puede dejar movimientos manuales.

No introducir una migración de Supabase solo para guardar `key` o IDs externos. Si el esquema actual no tiene esos campos, usarlos solo para búsqueda/display. El opus/catálogo debe formar parte del título canónico cuando corresponda.

### Creación manual

Siempre al final:

`Crear manualmente “<texto escrito>”`

Al pulsarlo, mantener el flujo manual actual y prellenar el nombre con lo escrito. Nunca bloquear al usuario porque el catálogo no tenga una obra.

### Obras ya existentes

Si el resultado seleccionado coincide claramente con una obra ya activa en `db.obras`, mostrar una advertencia amable antes de duplicarla o reutilizar la protección anti-duplicados que ya tenga la app. No inventar nueva lógica destructiva.

## Rendimiento/offline/PWA

- Cargar el catálogo **lazy** al abrir Añadir obra o al enfocar el buscador; cachearlo en memoria después.
- Debe seguir funcionando después de que la PWA haya cacheado assets.
- Actualizar `sw.js`/cache list/version si el proyecto exige enumerar nuevos assets.
- Una búsqueda típica debe sentirse instantánea en iPad/iPhone; objetivo práctico <50 ms para consultas normales una vez cargado el catálogo.
- Evitar bloquear el hilo principal con parseos/reindexados en cada tecla. Preparar índice/normalización una sola vez.
- Si el JSON termina siendo demasiado grande (> varios MB), considerar dividir por letra/compositor o generar un índice compacto, pero no sobrearquitectar si el catálogo inicial ya es pequeño/rápido.

## Privacidad y red

- No enviar lo que el usuario escribe a IMSLP ni a ningún servicio externo.
- La búsqueda ocurre localmente.
- El generador de catálogo es una herramienta de desarrollo/mantenimiento separada.

## Tests

### Unitarios para `work-catalog-core`

Cubrir al menos:

1. normalización de acentos/puntuación;
2. Op./opus;
3. No/Nº/Nr;
4. catálogos BWV/K/S/Hob;
5. alias de compositores;
6. `Valle de Obermann`;
7. ranking Beethoven Op.49;
8. búsqueda por compositor + catálogo;
9. typo pequeño;
10. query vacía/no resultados;
11. determinismo del ranking;
12. no mutar catálogo original.

### UI/E2E

- abrir Añadir obra;
- escribir `valle de` y seleccionar Liszt;
- verificar nombre/compositor autocompletados;
- escribir `beethoven sonata 49` y ver ambos Op.49;
- usar teclado y Enter;
- creación manual de una obra inexistente;
- catálogo no disponible => formulario manual sigue funcionando;
- iPhone y iPad: dropdown no desborda ni queda detrás del teclado/modal.

Ejecutar los checks existentes relevantes del repo (`npm run check`, `npm run test:unit`, E2E/visual focalizados y broad checks prácticos según AGENTS.md). No gastar tiempo infinito en flaky heredados no relacionados; distinguirlos claramente de regresiones nuevas.

## Compatibilidad / no-regresiones

- Partir del **último `origin/main`**, que ya contiene readiness estimator, repertorio histórico y bridge ChatGPT↔Codex.
- No tocar ni recrear `historical-repertoire.js`, readiness estimator o bridge salvo ajustes mínimos de cache/asset si son realmente necesarios.
- No modificar datos de usuario existentes en Supabase.
- No hacer commit/push/reset/rebase destructivo del resultado funcional; dejarlo para revisión/handoff según el bridge.
- `app.js` es enorme: usar `rg` y leer rangos concretos, no recorrerlo entero.

## Criterio de terminado

Se considera terminado cuando:

1. Añadir obra tiene autocomplete local usable y armónico;
2. los ejemplos obligatorios funcionan;
3. seleccionar sugerencia autocompleta sin perder edición manual;
4. creación manual sigue intacta;
5. catálogo funciona offline tras carga/cache;
6. existe proceso reproducible para regenerarlo/ampliarlo;
7. licencia/atribución de la fuente está documentada;
8. tests focalizados pasan y no hay regresiones relevantes;
9. Sol realiza una única revisión final de integración, búsqueda, rendimiento y UX.
