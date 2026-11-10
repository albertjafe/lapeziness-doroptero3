# Diario · diseño v532

Petición: reducir la heterogeneidad visual de recuadros, líneas y estilos del diario.
Base: 21d6debeaeec286fc6ddbe8385195693fd34549f (v531).

## Cambios

- Superficie continua sin tarjetas, bordes laterales, rayas de cuaderno ni márgenes decorativos.
- Separación mediante espacio y títulos con peso; las listas y las secciones comparten la tipografía de interfaz al escribir y al leer. La fecha conserva la serif.
- Se eliminan los fondos de color por bloque y por tarea; las casillas funcionales y sus estados se conservan.
- El libro de Windows conserva dos días y la navegación, con el mismo fondo y sin sombras de tapa, lomo ni cantos simulados.
- «Sección» pasa a ser una acción de texto con zona de toque de 44 px; el menú de sugerencias mantiene su superficie para identificarlo como control.
- Pantalla completa usa un fondo opaco incluso frente a las reglas globales de Windows. Se conservan foco visible, contraste del tema y tamaños de texto de al menos 17 px para las notas.

No cambia diario.js, el catálogo de secciones, el guardado, los tiempos, el historial ni los datos de producción. app.js solo cambia APP_VERSION. index.html y sw.js cargan app.js y diario.css con v532 y caché estudio-v532; los demás módulos conservan sus versiones.

## Verificación

- npm run check: 159 recursos, versiones, sintaxis y precaché coherentes.
- Vitest dirigido: 41 pruebas correctas (diario, secciones, auditoría del worker y shell).
- Playwright: diario.spec.js, diario-sections.spec.js y tests/visual (21 casos).
- Inspección de capturas con datos sintéticos a 390, 1024 y 1440 px, modo normal y pantalla completa. Chromium con perfiles de móvil, iPad y Windows; no equivale a una comprobación en Safari físico.
- La expectativa de fuente de la prueba de listas se actualiza al nuevo contrato: la misma fuente calculada en títulos, texto editable y listas; se conservan las comprobaciones de guardado y casillas.
