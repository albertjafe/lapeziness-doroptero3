# Diario y actualización · v531

Base: main, 7fa26acc0e9b14e837157706ea025e3924ab5ca9 (v530).
Versión: 2026-11-09-diario-y-actualizacion-v531. Caché: estudio-v531.

## Actualización: causas comprobables y límites

La transacción de la copia adicional en piano_pre_update_rescue_v1 no tenía plazo máximo. Una apertura que respondía después del timeout tampoco cerraba su conexión. Con IndexedDB sin respuesta se podía quedar esperando indefinidamente, incluso con la copia principal ya comprobada. Además, cuando localStorage no contenía la versión actual pero IndexedDB sí, se intentaba otro guardado completo; con documentos grandes eso generaba trabajo y revisiones innecesarios.

La interfaz usaba un banner inferior sin considerar la altura del viewport visual al abrir el teclado; su nivel de apilamiento era inferior al diario en pantalla completa. Esto podía ocultar mensajes o dejarlos fuera del área visible. No se ha inspeccionado el móvil físico ni identificado el texto exacto del aviso reportado: estas son rutas concretas del código cubiertas por regresiones, no prueba de cuál se produjo en ese dispositivo.

Cambios:
- Plazos de 1500 ms para abrir/escribir la copia adicional; aborto real de transacciones expiradas y cierre de conexiones tardías.
- La copia principal completa y durable sigue siendo obligatoria. Una copia adicional fallida no invalida una principal ya comprobada.
- Un rescate principal de IndexedDB ya actual evita otro guardado/revisión.
- Después de esperar la verificación durable se compara de nuevo con la memoria. Antes de recargar por controllerchange se repite la protección.
- La nube dispone de 1500 ms; si sigue pendiente, conserva sus metadatos y se reanuda al abrir. No se marca como sincronizada una revisión pendiente.
- Mensaje completo, texto adaptable, scroll si es necesario, espacio seguro y posición según visualViewport. Por encima del diario y la navegación.
- Se mantienen las barreras de cronómetro, píldora Hecho, sesión de Deutsch y copia local. No se fuerza una actualización borrando datos ni desregistrando workers.

El archivo update.html no cambia en esta entrega; no se recomienda usarlo como atajo de las protecciones de la aplicación.

## Diario: estructura y nombres reutilizables

Se conserva la agrupación de tramos consecutivos y la identidad ref del bloque. Una cabecera muestra hora inicial, título compacto y duración; el desplegable Detalle del estudio conserva el nombre completo, movimientos e intervalo. about sigue guardando el contexto completo para exportación/IA.

Las listas conservan su sintaxis y casillas: - para hoy, + para otro día y [x] para hecho. Se distinguen visualmente las entradas libres, el estudio, los encabezados de lista y los de sección. Las variantes de libro, móvil y pantalla completa usan el mismo contenido.

diario-sections.js no tiene efectos al consultar. Combina los pasajes existentes de una obra con db.journalSections. No mueve, renombra ni borra el tracker. Si hay nombres ambiguos en distintos movimientos, hay que elegir la opción concreta.

Dentro de un bloque, el botón Sección o @ al comienzo de línea ofrece nombres de esa obra. Si no existe el nombre, Crear lo registra para esa obra y reutiliza ese ID en días posteriores. El ID deriva de obra y nombre normalizado, para que dos dispositivos que crean el mismo nombre no dupliquen el registro. Fuera de una obra no se abre el autocompletado. Funciona con toque, flechas, Intro y Escape.

El encabezado se almacena como [[Nombre]] en el texto; sectionRefs guarda ID, tipo, nombre histórico y obra. Al renombrar un pasaje no se reescribe el diario antiguo. Borrar el encabezado quita su referencia de esa entrada, sin borrar el catálogo. Si desaparece el bloque, el comentario sigue como entrada general, con su contexto. Todo usa dailyJournalEntries, saveDataSoon y el protocolo existente. No hay migración SQL ni edición de datos de producción.

## Eficiencia y hábitos: conclusión de la revisión, sin nuevas mediciones

El porcentaje neto/bruto de _studyEfficiency no es una medición de concentración: aproxima intervalos a partir de inicios y minutos netos, une huecos de hasta 30 minutos, descarta huecos mayores, exige al menos ocho días y aplica un suelo de 25% para la predicción. No registra qué parte del hueco fue comida, desplazamiento, descanso o redes. No sirve por sí solo para atribuir a un hábito un efecto causal. El texto de la proyección lo presenta como ritmo orientativo con pausas estimadas; el cálculo y los tiempos no cambian.

Propuesta para una iteración posterior: jornada explícita con inicio, fin y ausencias externas; conservar descansos normales en el tiempo de jornada. Mostrar al cierre el tiempo cronometrado real sobre el tiempo disponible registrado. Mantener separados los minutos equivalentes (factores de clases/cámara) que usa el objetivo de 4 h. Los días incompletos o sin límites registrados deben figurar sin estimación fiable. Comparar semanas semejantes y describir asociación, nunca afirmar causalidad por un cambio de porcentaje. La ubicación por sí sola no distingue estudiar de comer o descansar; no se incorpora seguimiento de ubicación.

HabitMaintenance ya usa 3 caídas en 14 días o 4 en 30 y un refuerzo de 14 días compatible con el hábito principal. El reto inicial no reinicia el calendario con cada caída. Son reglas del producto, no criterios clínicos. Esta entrega no cambia umbrales, ciclos, premios ni registros de hábitos.

## Verificación reproducible

- tests/unit/diario-sections.test.js: aislamiento por obra, reutilización, normalización, ambigüedad, referencias estables, preservación de campos desconocidos, escape HTML y casillas.
- tests/unit/update-safety-v2.test.js: copia adicional bloqueada, aborto, apertura tardía y copia principal en IndexedDB sin nuevos guardados; conserva regresiones de datos/timer/nube pendientes.
- tests/e2e/diario-sections.spec.js: crear/reutilizar/reabrir, modo grande y móvil, cabeceras compactas y detalles, aviso largo y viewport reducido.
- tests/e2e/diario.spec.js: la expectativa de cabecera pasa de intervalo completo a hora inicial, comprobando también que el intervalo sigue accesible.
- index.html, piano-rooms.js y sw.js versionan todos los recursos modificados y cargan el catálogo antes del diario.

El entorno de ejecución de esta sesión no estaba disponible. Se compilaron los JavaScript y se comprobaron funciones puras mediante el motor JavaScript de las herramientas; la validación completa se ejecuta en GitHub Actions sobre la rama de revisión antes de publicar en main.

Comandos equivalentes:

    npm run check
    npm run test:unit
    npm run test:e2e
    npm run test:visual

No hay comprobación manual en Safari/iPhone físico. Los datos de prueba son sintéticos; el documento no incluye exportaciones ni contenido privado del diario.
