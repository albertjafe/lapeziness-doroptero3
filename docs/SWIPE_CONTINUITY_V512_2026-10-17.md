# Continuidad del gesto lateral · v512

Petición: que al deslizar despacio entre pantallas no se perciba una vista provisional, una pausa y una pantalla distinta al llegar. Base revisada: `main`, `55539a5be0c76247989403844b154cb96b5017dd` (v511). Versión nueva: `2026-10-17-transicion-lateral-v512`, caché `estudio-v512`.

## Causas reproducidas

La aplicación ya movía los nodos reales; no había una captura de pantalla sustituyéndolos. La apariencia cambiaba por su geometría y por trabajo adicional al terminar:

1. Se transformaba la propia `.view`, que puede ser más estrecha que el viewport. `transform`, `will-change: transform` y `contain: paint` la convertían en el contenedor de sus descendientes fijos. Al retirar el efecto, esos controles volvían al viewport real. En iPad horizontal, la hoja del cronómetro medía **728 px durante el gesto y 760 px al llegar**, con desplazamiento lateral de 16 px.
2. La cabecera clonada eliminaba IDs para evitar duplicados, perdiendo los estilos que dependían de ellos. Además, el clon del calendario mostraba el mes pero la cabecera real podía conservar una fecha vacía. En una prueba la primera tarjeta del calendario saltaba **8,5 px en vertical** al liberar las capas. La preparación de Calendario también podía limpiar el evento próximo de la cabecera real al ejecutarse todavía bajo `data-view="obras"`.
3. `.crono-stage` reproducía su animación de entrada de 600 ms al hacerse visible; la excepción anterior solo cubría el cronómetro en marcha del iPad. La entrada de un elemento dentro de una página que ya se estaba desplazando daba otra sensación de carga.
4. Al terminar la inercia se activaba la vista y se retenían las capas otros dos `requestAnimationFrame`. El calendario del cronómetro volvía a calcularse en esa activación. El timeout de respaldo empezaba en `touchend`, antes del frame que iniciaba realmente la transición; bajo carga podía cortarla antes de su final.

## Cambios y propietarios

- **`app.js`:** `viewSwipePageFor` crea los cuatro contenedores estables al instalar la navegación, antes de iniciar gestos nativos. `viewSwipeWrapPage` cambia su presentación; `viewSwipeReleasePage` vuelve a reposo. El nodo tocado y las vistas mantienen el mismo padre: no se reinsertan durante el seguimiento táctil.
- **`styles.css`:** la transformación y la contención se aplican a `.view-swipe-page`, que mide el viewport. La vista conserva su ancho natural dentro de él. Los descendientes fijos tienen así las mismas dimensiones antes y después. La excepción de entrada cubre todas las `.crono-stage` del recorrido, también en teléfono y en reposo.
- **Cabecera compartida:** `updateContextHeader` utiliza `viewSwipeHeaderDate` también para la cabecera definitiva. `updateHeaderNextEvent` construye evento/días para el nombre de vista indicado, tanto en la cabecera real como en la clonada. No depende del contenido que haya dejado la pantalla anterior. `updateHeader` reutiliza ese camino.
- **Estilos de cabecera:** `styles.css`, `ipad-app.css`, `event-planning-ui-v2.css` y `desktop-windows-v390.css` usan `:is(ID original, equivalente dentro de .view-swipe-header)` en los selectores afectados. Se mantiene la especificidad y no se introducen IDs duplicados. `habit-trophies.css` actualiza la importación de la capa de escritorio.
- **Finalización:** se conserva el último frame del dedo; la duración responde al recorrido pendiente y la velocidad, entre 60 y 360 ms. Distancia ya terminada o movimiento reducido no esperan una transición sin desplazamiento. El respaldo se programa cuando empieza la animación. En `transitionend`, `showView({swipePrepared:true})` y la limpieza ocurren en el mismo callback, sin retener una vista provisional durante dos pinturas más.
- **Preparación del cronómetro:** el calendario se prepara con la vista previa y no se repite en la activación preparada. El reloj y los recordatorios se inician al entrar. La navegación confirma con scroll instantáneo; cancelar restaura el scroll capturado al comenzar.
- **PWA:** `index.html`, `piano-rooms.js` y `sw.js` referencian la versión de los módulos/hojas cambiados. La actualización conserva el flujo de `UpdateSafety`.

## Comprobación para otra IA

`tests/e2e/view-swipe-continuity.spec.js` añade ocho pruebas con datos sintéticos y peticiones externas bloqueadas:

- Teléfono 390 px, iPad vertical 834 px e iPad horizontal 1194 px: anillo, hoja y botón mantienen geometría durante varios puntos de un gesto lento y al llegar. Se comprueba que los nodos y sus padres sobreviven, y que no queda una capa de espera al finalizar la transición.
- Primera visita a Calendario: posición y dimensiones de su contenido, mes, altura de cabecera y ancho del evento próximo coinciden al llegar; los nodos no se sustituyen. Se permite menos de 1 px de diferencia por redondeo fraccional de geometría.
- Cancelación después de scroll y cambio de dirección dentro del mismo gesto: se recuperan pantalla y posición, y se eliminan las capas temporales.
- Un gesto mediante `Input.dispatchTouchEvent` del navegador, además de los eventos sintéticos de las pruebas de geometría, confirma que el seguimiento táctil nativo continúa.

Las dos pruebas nuevas de geometría horizontal se ejecutaron también contra una copia exacta del commit v511: fallaron por **16 px de desplazamiento de los controles** y **8,5 px de desplazamiento del calendario**, respectivamente. La nueva implementación corrige esas regresiones. Las pruebas existentes de `view-swipe-ipad` comprueban además cronómetro libre/temporizador, sesión en marcha, cancelación y restauración de Historial sin cambiar runId, estado ni minutos.

```sh
npm run check
npm run test:unit
npx playwright test tests/e2e/view-swipe-continuity.spec.js tests/e2e/view-swipe-ipad.spec.js tests/e2e/ipad-v2.spec.js --workers=1
npm run test:visual
```

La validación completa de cada commit publicado está en [Quality](https://github.com/albertjafe/lapeziness-doroptero3/actions/workflows/quality.yml). Los cambios de esta entrega son de navegación, composición y carga PWA; no incluyen migraciones ni modificaciones de documentos de producción.

La reproducción se ha hecho en Chromium con geometría táctil, no en Safari/iPadOS físico. Las actualizaciones legítimas de datos o respuestas de red pueden cambiar contenido: esta entrega elimina el cambio de contenedor, la doble entrada y la espera artificial de la navegación, sin prometer una tasa de fotogramas universal.
