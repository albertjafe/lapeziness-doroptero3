// Deliberately unclocked legacy scalars: a whole-document save is not an edit.
export const staleDocumentCases = [
  {
    name: 'A: stale difficulty cannot undo 9 while adding an independent setting',
    stored: {_localRevision:100, obras:[{id:'w', dificultad:9, name:'Sonata'}]},
    incoming: {_localRevision:20, _savedAt:'2026-09-04T12:00:00Z', settings:{theme:'dark'},
      obras:[{id:'w', dificultad:5, name:'Sonata', updatedAt:'2026-09-04T12:00:00Z'}]},
    expected: {obras:[{id:'w', dificultad:9, name:'Sonata'}], settings:{theme:'dark'}},
  },
  {
    name: 'B: stale solidity cannot undo 80 while adding a task and study history',
    stored: {_localRevision:100, obras:[{id:'w',sol:80,movimientos:[{id:'m',sol:80}]}],cronoTasks:[],sessionPlants:[]},
    incoming: {_localRevision:20,_savedAt:'2026-09-04T12:00:00Z',obras:[{id:'w',sol:40,movimientos:[{id:'m',sol:40}]}],
      cronoTasks:[{id:'new-task',text:'Llamar al profesor'}],sessionPlants:[{id:'new-study',obraId:'w',movId:'m',mins:1}]},
    expected: {obras:[{id:'w',sol:80,movimientos:[{id:'m',sol:80}]}],cronoTasks:[{id:'new-task',text:'Llamar al profesor'}],sessionPlants:[{id:'new-study',mins:1}]},
  },
  {
    name: 'C: a later explicit field clock can win despite a smaller document revision',
    stored: {_localRevision:100,obras:[{id:'w',dificultad:9,name:'Sonata',_fieldClock:{dificultad:'2026-09-04T10:00:00Z'}}]},
    incoming: {_localRevision:20,obras:[{id:'w',dificultad:7,name:'Nombre antiguo',_fieldClock:{dificultad:'2026-09-04T11:00:00Z'}}]},
    expected: {obras:[{id:'w',dificultad:7,name:'Sonata'}]},
  },
  {
    name: 'C2: an explicit current edit can replace a previously unclocked server scalar',
    stored: {_localRevision:100,obras:[{id:'w',dificultad:9}]},
    incoming: {_localRevision:20,obras:[{id:'w',dificultad:7,_fieldClock:{dificultad:'2026-09-04T11:00:00Z'}}]},
    expected: {obras:[{id:'w',dificultad:7}]},
  },
  {
    name: 'C3: an equal clock is not proof of a later edit from a stale document',
    stored: {_localRevision:100,obras:[{id:'w',dificultad:9,_fieldClock:{dificultad:'2026-09-04T10:00:00Z'}}]},
    incoming: {_localRevision:20,_savedAt:'2026-09-04T12:00:00Z',obras:[{id:'w',dificultad:5,_fieldClock:{dificultad:'2026-09-04T10:00:00Z'}}]},
    expected: {obras:[{id:'w',dificultad:9}]},
  },
  {
    name: 'D: unknown properties survive in both directions, including nested future fields',
    stored: {_localRevision:100,newRoot:{a:1},eventos:[{id:'e',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-10',nuevoCampoFuturo:{a:9,b:2}}]},
    incoming: {_localRevision:20,newRoot:{c:3},eventos:[{id:'e',nuevoCampoFuturo:{a:1,c:3}}],newFutureArray:[{id:'f',x:1}]},
    expected: {newRoot:{a:1,c:3},eventos:[{id:'e',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-10',nuevoCampoFuturo:{a:9,b:2,c:3}}],newFutureArray:[{id:'f',x:1}]},
  },
];
