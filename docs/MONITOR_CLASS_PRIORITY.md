# Clase completa y márgenes opcionales

El horario `ini`–`fin` de una franja es imprescindible. Los campos opcionales
`margen_ini` y `margen_fin` rodean esa franja y expresan el margen deseable;
si faltan, se usa el horario imprescindible. No se deducen márgenes de las
franjas antiguas. El estado publicado muestra el horario imprescindible y
describe el margen en su texto, compatible con la app actual.

La búsqueda intenta primero cubrir la clase completa en una sola aula. Entre
los planes posibles prefiere cubrir más margen, conservar tiempo ya reservado
y evitar cambios equivalentes. Si hace falta, puede sustituir una reserva que
solapa la clase aunque el destino no conserve sus extremos: los minutos de
estudio anteriores no deben obligar a cambiar de aula durante la clase.
Si ninguna aula cubre la clase entera, se conserva la búsqueda de trozos como
solución provisional. «Cobertura parcial; falta …» no significa clase cubierta.

Los márgenes no cancelan reservas ajenas a la clase ni fuerzan recortes de
otras reservas para conseguir cuota. Si la cuota permite solo la clase, se
elige ese plan. Se mantienen las reglas de disponibilidad, blindajes, horizonte,
separación entre reservas, duración máxima y cuota RF/SZ. Una reserva empezada
no se mueve; puede ampliarse en su propia aula manteniendo su inicio.

El planificador puro está en `scripts/monitor/class_reservation_plan.py`.
`monitor-class-priority.patch` integra esa política en el monitor externo:
ampliación mediante PATCH cuando hay una sola reserva en el mismo aula,
reserva normal si no hay solapamientos, y la transacción de migración existente
con comprobación y restauración cuando hay que sustituir reservas. Las
migraciones de clase abortan antes de cancelar si la comprobación previa falla
o los límites recortan el horario imprescindible. Tras el cambio o su fallo se
protegen los IDs que realmente existan. La restauración sigue dependiendo de
que Asimut permita recuperar las reservas; no es una transacción de servidor.

Para desplegar: cerrar limpiamente el monitor mediante su orden `shutdown`,
guardar una copia del código y del estado, aplicar el parche al Python y copiar
el planificador junto a él (también a la copia usada para compilar). Configurar
los márgenes en el estado del perfil conservando los campos desconocidos y los
candados; arrancar con el mismo perfil y comprobar la instantánea publicada.
Editar el Python no actualiza un proceso ya iniciado ni un ejecutable antiguo.
No importar el monitor para probarlo: tiene efectos de inicio de sesión.
El parche usa contexto cero: comprobar primero con
`git apply --check --ignore-space-change --unidiff-zero monitor-class-priority.patch`
y aplicarlo con los mismos parámetros quitando `--check`. La opción de espacios
permite aplicarlo a la copia Windows con finales CRLF; no omitir la comprobación.

Pruebas sin red ni reservas reales:

```powershell
python tests/monitor/test_class_reservation_plan.py
python tests/monitor/test_class_reservation_plan.py ruta/monitor_huecos_alberto.py
python tests/monitor/test_max_reservation.py ruta/monitor_huecos_alberto.py
python tests/monitor/test_allow_rebook.py ruta/monitor_huecos_alberto.py
```

La segunda variante extrae funciones por AST y comprueba además cuotas,
candados, IDs nuevos tras restauración, persistencia de márgenes y campos
desconocidos, límites y fallo de la comprobación previa.
