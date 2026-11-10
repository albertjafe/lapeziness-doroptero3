# Diario manuscrito · v534

Petición: conservar el cuaderno, las listas automáticas y las secciones, con una estética homogénea y menos letra auxiliar pequeña y gris.

- Kalam en fechas, títulos, escritura, listas y secciones; notas de 21–22 px y pauta compartida en lectura y edición. La fuente se sirve localmente y se precachea, con su licencia OFL.
- Hoja cálida y continua, margen y líneas tenues; mismo diseño en móvil, iPad, doble página de Windows y pantalla completa, con adaptación al tema oscuro.
- Se eliminan el subtítulo del diario, «Notas y listas» en cada nota y el mensaje de día vacío. El campo libre permanece disponible.
- El título y la duración identifican cada bloque; «···» abre los detalles completos, incluidos horarios y contexto de notas del cronómetro. Conserva nombre accesible, foco de teclado y zona de toque de 44 px. «+ Sección» sigue abriendo el selector existente.
- No cambia el modelo de datos, las referencias, las listas automáticas, las casillas, el guardado ni la sincronización. No hay escrituras de datos de producción.

Validación: auditoría de 161 recursos, 50 pruebas unitarias dirigidas, 18 casos de navegador del diario (secciones, listas, escritura, persistencia, navegación y pantalla completa). Inspección de capturas con datos sintéticos a 390, 1024 y 1440 px, temas claro y oscuro. La comprobación es en Chromium con perfiles de dispositivo; no sustituye Safari en un iPad físico.

Runtime: app.js, diario.js y diario.css v534; caché estudio-v534. Los módulos restantes conservan sus versiones. La auditoría de runtime reconoce las fuentes locales y verifica que existen y están precacheadas.
