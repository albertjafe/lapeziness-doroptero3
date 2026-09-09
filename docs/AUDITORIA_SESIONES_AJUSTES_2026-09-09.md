# Auditoría de Sesiones y Ajustes — 2026-09-09

## Resultado

La vista inicial de **Sesiones · Hoy** queda reservada a cuatro respuestas inmediatas:

1. cuánto se ha estudiado hoy;
2. cuánto proyecta la app para hoy;
3. a qué hora se prevé terminar;
4. qué aula está reservada ahora o cuál viene después.

Las funciones existentes no se han eliminado por ser poco frecuentes. Se han separado en tres categorías: primer plano, acceso secundario y código retirado pendiente de una limpieza aislada.

## Cambios aplicados

| Elemento | Decisión | Motivo |
|---|---|---|
| Horas estudiadas, proyección y fin previsto | Primer plano en **Hoy** | Son la lectura diaria esencial. |
| Aulas y reservas | Tarjeta compacta inmediatamente bajo la previsión | Permite ver la situación actual y abrir el dashboard completo con un toque. |
| Estadísticas y sesiones registradas | Pestaña **Historial** | Siguen disponibles, pero ya no compiten con la lectura diaria. |
| Actividad digital | Pestaña **Historial** | Conserva métricas, refresco y línea temporal; deja de interrumpir la lectura de Hoy. |
| Plan semanal | Pestaña **Semana** | Mantiene su función y su espacio propio. |
| Registro manual rápido | Desplegable cerrado en **Hoy** | Disponible sin ocupar altura cuando no se usa. |
| Diario | Acción compacta al pie | Mantiene todas sus entradas y controles. |
| Hora de comienzo y disponibilidad/bloqueo del día | **Ajustes → Datos y herramientas → Proyección del día** | La lógica se conserva, pero no está a simple vista. |
| Exportación IA/Codex e importación Forest | Desplegable **Datos y herramientas** | Son herramientas potentes de uso ocasional. |
| Sonido, avisos 10/5/1, Google Calendar, cuenta y actualización | Visibles en Ajustes | Son controles operativos o de diagnóstico que conviene encontrar sin ambigüedad. |

## Ruido retirado

- Gráfica de estado diario: se retiraron su contenedor y sus llamadas de renderizado. No se borraron los datos de estado, sueño, concentración, deporte, siestas, gatillos ni tiempo disponible porque todavía alimentan Profesor, exportaciones y sincronización.
- Tarjeta vacía de ajustes del cronómetro: no contenía controles activos.
- Duplicado del estado de concentración y tarjetas explicativas extensas en Hoy: la información útil se integra ahora en la franja inferior del resumen.
- Interruptores históricos de “información” y “vista limpia”: dejaron de ser necesarios al convertir Hoy en una vista limpia por diseño.
- Markup y botón de navegación de **Casa** que se creaban para ser retirados inmediatamente al arrancar: ya no se entregan en el HTML.
- Renderizado ansioso de estadísticas: las agregaciones pesadas se calculan al entrar en **Historial**, no en cada refresco de Hoy.
- Doble conteo del registro rápido: el bloque temporal manual y su espejo en `db.sesiones` podían sumar dos veces. `daily-study-minutes.js` v5 los empareja uno a uno por obra/movimiento y minutos, sin ocultar registros históricos que no tengan pareja.

## Funciones conservadas deliberadamente

- El modelo de estado diario y su historial. Aunque ya no existe su gráfica, sigue siendo una fuente de datos activa.
- La disponibilidad y el bloqueo horario. Solo cambió su ubicación visual.
- Forest y exportación IA. Son poco frecuentes, no obsoletos.
- Los datos históricos de Pulso y sus marcadores de borrado. La interfaz está retirada, pero eliminarlos podría revivir registros o romper fusiones entre dispositivos.
- La redirección de rutas antiguas (`historial`, `pulse`, `casa`). Evita romper accesos guardados o clientes desactualizados.
- Toda la lógica de cronómetro, metrónomo, avisos, sincronización, obras, calendario, Profesor y reservas.

## Código dormido detectado — no borrar dentro de este rediseño

Estos bloques ya no tienen una superficie visible, pero una eliminación segura requiere una tarea separada con comparación de datos y regresión completa:

1. `renderEstadoSection()` y sus helpers gráficos en `app.js`: el DOM y las llamadas ya no existen. Es candidato claro para borrado físico, pero comparte conceptos y clases con los selectores activos de estado.
2. `renderSessionInsights()` y `_probRichHTML()` en `app.js`: quedaron sin invocaciones tras resumir la previsión en la nueva cabecera. Conviene retirar el conjunto completo en una limpieza atómica, no funciones sueltas.
3. `mystery-house.js` y el bloque `.house-*` de `styles.css`: no se cargan ni se muestran; `piano-rooms.js` conserva una redirección de compatibilidad. Eliminar todo el paquete permitiría reducir bastante CSS, pero debe incluir pruebas de rutas antiguas.
4. Rama histórica de mini-resumen lateral del cronómetro: el markup actual no la activa. Se deja intacta porque tocar el cronómetro no forma parte de este cambio visual.
5. Capas de temas anteriores en `styles.css`: parte de ellas parece inactiva con Mármol como identidad única, pero preferencias guardadas y reglas de fallback hacen arriesgado borrarlas sin una matriz visual específica.

## Verificación exigida para una futura limpieza física

- confirmar cero referencias desde HTML, atributos `onclick`, loaders dinámicos, worker, pruebas y rutas de compatibilidad;
- comparar apertura, cierre y reanudación del cronómetro;
- probar sincronización con datos antiguos y dos dispositivos;
- comprobar Profesor y exportación con estado diario histórico;
- validar actualización PWA desde la versión inmediatamente anterior;
- conservar un backup fechado antes de cada lote.

## Integridad

Este rediseño no cambia el esquema de datos, no migra ni borra sesiones, no altera reservas y no añade llamadas a Asimut. La tarjeta compacta de aulas consume la misma instantánea Supabase que el dashboard completo.
