# Vitrina de objetivos diarios

La vitrina pertenece al cronómetro y usa los hábitos de `db.habitChallenges`. No forma parte de Deutsch ni de sus objetivos económicos.

**Cronómetro → Vitrina** muestra objetivos conseguidos y en curso. La fecha de inicio es `startDate`; un objetivo sin `completedAt` se considera terminado al cerrar su último día programado y el trofeo usa ese día como fecha final. Los retos de tipo `avoid` cuentan como logrados los días cerrados sin recaída; los de tipo `do` exigen una marca `done`. Los tombstones `deleted` no aparecen.

El modal guarda `description`, `motivation`, `successCriteria`, `reward` y una fecha de inicio elegible para objetivos nuevos. Estos campos son opcionales y conviven con los objetos antiguos. La fecha de un objetivo ya iniciado queda bloqueada para preservar su historial.

`habit-trophies.js` solo calcula la colección y genera las piezas SVG. No persiste una colección paralela. `timer-objectives.js` renderiza la sección y `habit-trophies.css` contiene su presentación y las ampliaciones del modal. Los tres assets están incluidos en la caché PWA v380.
