import {staleDocumentCases} from './stale-document-cases.js';
const t1='2026-09-04T10:00:00.000Z', t2='2026-09-04T11:00:00.000Z';
// The same cases run through JS, PostgreSQL directly and all legacy triggers.
export const remoteDocumentCases=[
  ...staleDocumentCases,
  ...[20,170,10000].map(revision=>({
    name:`unclocked difficulty stays on the server against client revision ${revision}`,
    stored:{_localRevision:100,obras:[{id:'w',dificultad:9,name:'Sonata'}]},
    incoming:{_localRevision:revision,_savedAt:t2,updatedAt:t2,
      obras:[{id:'w',dificultad:5,name:'Sonata',updatedAt:t2}],cronoTasks:[{id:'nueva',text:'Nueva tarea'}]},
    expected:{obras:[{id:'w',dificultad:9,name:'Sonata'}],cronoTasks:[{id:'nueva',text:'Nueva tarea'}]},
  })),
  {
    name:'revision 500 does not regress solidity 80 while adding a session',
    stored:{_localRevision:100,obras:[{id:'w',sol:80,movimientos:[{id:'m',sol:80}]}]},
    incoming:{_localRevision:500,obras:[{id:'w',sol:40,movimientos:[{id:'m',sol:40}]}],sessionPlants:[{id:'nueva',obraId:'w',movId:'m',mins:1}]},
    expected:{obras:[{id:'w',sol:80,movimientos:[{id:'m',sol:80}]}],sessionPlants:[{id:'nueva',mins:1}]},
  },
  ...[undefined,t1].map(clock=>({
    name:`revision 170 with an explicit later edit wins against ${clock?'an earlier clock':'no server clock'}`,
    stored:{_localRevision:100,obras:[{id:'w',dificultad:9,...(clock?{_fieldClock:{dificultad:clock}}:{})}]},
    incoming:{_localRevision:170,obras:[{id:'w',dificultad:7,_fieldClock:{dificultad:t2}}]},
    expected:{obras:[{id:'w',dificultad:7}]},
  })),
  ...[t1,t2].map(clock=>({
    name:`revision 500 with ${clock===t1?'an older':'an equal'} clock cannot regress difficulty`,
    stored:{_localRevision:100,obras:[{id:'w',dificultad:9,_fieldClock:{dificultad:t2}}]},
    incoming:{_localRevision:500,_savedAt:'2026-09-04T23:00:00.000Z',obras:[{id:'w',dificultad:7,_fieldClock:{dificultad:clock}}]},
    expected:{obras:[{id:'w',dificultad:9}]},
  })),
  {
    name:'future nested fields and records survive but parent clocks do not authorize child scalar edits',
    stored:{_localRevision:100,obras:[{id:'w',dificultad:9,movimientos:[{id:'m',sol:80}]}],future:{nested:{value:9,serverOnly:true}}},
    incoming:{_localRevision:10000,_fieldClock:{future:t2,obras:t2},future:{nested:{value:5,clientOnly:{x:1}}},
      obras:[{id:'w',dificultad:5,_fieldClock:{movimientos:t2},futureWorkField:{x:1},movimientos:[{id:'m',sol:40,futureMovementField:2},{id:'m2',sol:70}]},{id:'new',dificultad:4}],
      eventos:[{id:'e',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-10',nuevoCampoFuturo:{x:1}}]},
    expected:{future:{nested:{value:9,serverOnly:true,clientOnly:{x:1}}},
      obras:[{id:'w',dificultad:9,futureWorkField:{x:1},movimientos:[{id:'m',sol:80,futureMovementField:2},{id:'m2',sol:70}]},{id:'new',dificultad:4}],
      eventos:[{id:'e',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-10',nuevoCampoFuturo:{x:1}}]},
  },
];
