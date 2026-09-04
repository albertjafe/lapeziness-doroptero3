# Revisión limitada de los cuatro puntos de persistencia

Esta entrega es incremental respecto a `AUDIT_DIFF.patch`, generado antes de esta revisión sobre `main` c2c7fd4. No se ha hecho commit, push ni aplicado ninguna migración a producción.

## 1. Escalares antiguos sin prueba de edición

Se confirmó el fallo en JavaScript y PostgreSQL: una revisión 20 con `dificultad:5` podía sustituir la revisión 100 con `dificultad:9`, especialmente si la copia antigua tenía un `_savedAt` reciente por haber guardado otra cosa.

`document-sync-core.js` y `document_merge` propagan ahora la relación entre revisiones de la raíz hasta los registros anidados. En un conflicto sin reloj de campo explícito posterior, la revisión menor no hace retroceder el escalar de la mayor. Un timestamp general de documento/registro no demuestra que ese campo haya sido editado. Un reloj de campo posterior sí puede ganar aunque la revisión del documento sea menor. La revisión no reemplaza a los relojes como evidencia de edición.

Se mantienen los campos ausentes, las propiedades desconocidas, la unión de registros y el historial. SQL y cliente coinciden en el resultado del merge; la revisión SQL final sigue aumentando mediante el trigger existente de esta migración.

Regresiones compartidas cliente/PGlite: dificultad 9 frente a 5 con un ajuste independiente; solidez 80 frente a 40 con tarea e historial nuevos; reloj posterior; edición explícita de un campo previamente sin reloj; reloj igual que no demuestra edición posterior; propiedades futuras anidadas. Se ejecutan también contra la tabla con las guardas históricas y backups instalados. Los ocho casos iniciales A–D fallaban antes de la corrección y después pasaron.

Un escalar conflictivo de un cliente antiguo sin reloj no permite distinguir automáticamente una edición intencional de un valor heredado. En ese caso se conserva el valor protegido; sí se admiten nuevos campos/registros y cambios con evidencia explícita.

## 2. Leer la nube no genera un upload idéntico

`loadFromCloud` fusiona nube, disco y memoria usando el documento canónico. No utiliza los valores vacíos que los normalizadores de dominio añaden como defaults para decidir si hay algo nuevo que subir.

`sameContent()` compara todos los campos y fechas anidados, incluidos datos futuros y relojes, ignorando únicamente `_localRevision` y `_savedAt` de transporte en la raíz y el orden de claves de objetos. No ignora evidencia musical, listas ni su contenido.

Si el resultado ya está en remoto, guarda/reconoce la copia local como sincronizada sin incrementar la revisión ni encolar una escritura. Si faltan datos reales, conserva los pendientes y utiliza el escritor común. Las referencias de los editores se conservan.

Regresión: diez arranques del protocolo en contextos VM nuevos, con almacenamiento persistente y las funciones reales de lectura, cola y upload extraídas de `app.js`, producen **cero writes y cero encolados** a `user_data` cuando local y remoto coinciden. El único doble es el transporte asíncrono de Supabase. También se comprueban orden de claves, metadatos distintos, descarga de cambios remotos, datos locales con metadata clean y edición local durante una lectura pendiente.

## 3. Fila de nube inexistente

La consulta utiliza [`maybeSingle`](https://supabase.com/docs/reference/javascript/using-modifiers-maybesingle), que admite cero o una fila. Un error se conserva como error; no se interpreta como cuenta vacía.

Si no existe la fila y hay documento local válido, se fuerza una revisión pendiente, se escribe primero la copia local y se encola el upload. Funciona con `alberto_sync_v1` ausente y con revisiones clean/0. Ambas regresiones comprueban una sola escritura inicial, conservación de la obra y ausencia de duplicados al abrir otra vez. Un error de lectura no crea una fila ni modifica la copia durable.

## 4. Una sola carga de persistencia

`crono-resume-layout.js` es el único punto que carga `local-save-resilience.js`, con el ID `localSaveResilienceScript`. Se retiró la carga redundante de `piano-rooms.js` y el ID alternativo V2.

`check-runtime` conserva el inventario de cargas antes de deduplicar assets: revisa helpers con parámetros `id,src` e inyecciones DOM literales y rechaza un mismo asset con IDs distintos. Un ID compartido sirve de guarda; los imports de Worker pertenecen a otro contexto. Cualquier excepción adicional requiere una razón explícita. El checker cubre las convenciones actuales del repositorio, no pretende ejecutar JavaScript arbitrario ni resolver URLs calculadas.

Cinco pruebas validan el detector, incluidos URLs con versiones diferentes y mezcla de helper/inyección directa. La regresión Playwright carga la cadena real de addons e instrumenta la ejecución del módulo: **antes ejecutaba dos veces, ahora una**, y solo hay un elemento script.

## Alcance y versión

Los archivos `professor-*.js` se han comprobado contra la captura anterior y permanecen idénticos byte por byte. Se mantienen codec V3, todas las unidades, Worker, hora actual, sesión activa, alternativas 5/6 h, event gate y precisión mensual.

La caché pasa a `estudio-v343`. Solo `app.js`, `document-sync-core.js`, `crono-resume-layout.js` y `piano-rooms.js` cambian su URL a `?v=343`; los assets sin cambios conservan su URL. Loaders y precache contienen una sola URL por asset. No se modifica el protocolo de actualización segura ni el handoff grande del Profesor.

La migración `20260904123621_conservative_document_sync.sql` sigue **sin aplicar**. Cuando se autorice el despliegue, el orden sigue siendo SQL → frontend.

## Validación final

- `npm run check`: correcto; 90 assets, sintaxis, versiones, IDs de carga y precache.
- `npm run test:unit`: 46 archivos, 280 pruebas correctas, 0 fallidas (7,29 s).
- `npm run test:e2e -- --workers=3`: 112 pruebas correctas, 0 fallidas (3,6 min).
- `npm run test:visual -- --workers=2`: 3 pruebas correctas, 0 fallidas (8,0 s).

Pruebas nuevas: 25 unitarias y 1 E2E respecto a la auditoría anterior. No se ha retirado ninguna prueba existente. La validación en iPhone/iPad físicos y la decisión de UX del handoff grande siguen fuera del alcance de estas cuatro correcciones.
