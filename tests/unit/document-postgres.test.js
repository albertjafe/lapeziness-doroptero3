import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { remoteDocumentCases } from '../fixtures/remote-document-cases.js';
import {cloudAppHarness,saveUnrelatedOffline} from '../fixtures/cloud-app-harness.js';
const require=createRequire(import.meta.url), Doc=require('../../document-sync-core.js');
let pg;
const sql = name => readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create table public.user_data(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.user_data_backups(backup_id bigserial primary key,user_id text,data jsonb,source_updated_at timestamptz,backed_up_at timestamptz);`);
  await pg.exec(readFileSync(new URL('../fixtures/legacy-task-merge.sql',import.meta.url),'utf8'));
  for(const name of ['202609010002_protect_study_structure_sync.sql','202609010003_harden_study_movement_recency_merge.sql','202609020002_preserve_planning_events.sql','202609030003_task_sync_revision_guard.sql','202609040004_reduce_user_data_sync_contention.sql','20260904123621_conservative_document_sync.sql']) await pg.exec(sql(name));
  const original=sql('20260904123621_conservative_document_sync.sql');
  await pg.exec(original.slice(original.indexOf('create or replace function public.document_merge('),original.indexOf('create or replace function public.preserve_document_fields_before_update(')).replaceAll('public.document_merge(', 'public.document_merge_before_optimization('));
  await pg.exec(sql('20260918202404_optimize_document_record_merge.sql'));
  await pg.exec(original.slice(original.indexOf('create or replace function public.document_prune('),original.indexOf('create or replace function public.enforce_document_tombstones_after_guards(')).replaceAll('public.document_prune(', 'public.document_prune_before_optimization('));
  await pg.exec(sql('20260918205809_optimize_document_tombstone_pruning.sql'));
  await pg.exec(sql('20260919142631_preserve_sync_acknowledgement_fields.sql'));
  // The helper's original migration predates this checkout; its deployed
  // definition is captured as a fixture, without data or production mutations.
  await pg.exec(`create trigger trg_00_preserve_crono_tasks before update of data on user_data for each row execute function preserve_crono_tasks_on_user_data_update();
    create trigger trg_backup_user_data_before_change before update of data on user_data for each row execute function backup_user_data_before_change();`);
},30000);
afterAll(async()=>{await pg?.close();});
async function write(id,a,b){
  await pg.query('insert into user_data(id,data) values ($1,$2)',[id,JSON.stringify(a)]);
  return (await pg.query('update user_data set data=$2 where id=$1 returning data',[id,JSON.stringify(b)])).rows[0].data;
}
describe('real PostgreSQL migration with existing protection triggers',()=>{
  it('partial uploads retain the full history and preserve edits and tombstones like full uploads',async()=>{
    const old={obras:[{id:'w',name:'Sonata',movimientos:[{id:'m',name:'I'}],unknown:{keep:true}}],
      forestPlants:Array.from({length:7426},(_,i)=>({id:'forest-'+i,mins:30,unknown:'history '.repeat(45)})),
      sessionPlants:[{id:'yesterday',mins:366,startedAt:'2026-09-18T08:00:00Z'}],
      cronoTasks:[{id:'removed',text:'Old task'},{id:'keep',text:'Keep task'}]};
    const next=structuredClone(old);next.obras[0].name='Edited';next.obras[0].movimientos=[];next.cronoTasks.shift();
    next.sessionPlants.push({id:'today',mins:86,startedAt:'2026-09-19T08:00:00Z'});
    const merged=Doc.mergeRemote(old,Doc.track(next,old,'2026-09-20T10:00:00Z'));
    const delta=Doc.uploadDelta(old,merged);expect(JSON.stringify(delta).length).toBeLessThan(2500);
    expect(delta.forestPlants).toBeUndefined();
    const partial=await write('partial-history',old,delta),full=await write('full-history',old,merged);
    expect(Doc.sameContent(partial,full)).toBe(true);
    expect(partial.forestPlants).toHaveLength(7426);expect(partial.sessionPlants).toHaveLength(2);
    expect(partial.cronoTasks.map(t=>t.id)).toEqual(['keep']);expect(partial.obras[0].movimientos).toEqual([]);
    expect(Doc.sameContent(Doc.mergeRemote(partial,merged),partial)).toBe(true);
  },15000);
  it('acknowledges notes and field clocks through all legacy guards on equal record timestamps',async()=>{
    const oldStamp='2026-09-04T10:00:00Z',stamp='2026-09-18T10:00:00Z';
    const history={date:oldStamp,val:40,context:'study',_fieldClock:{val:oldStamp}};
    const stored={sessionPlants:[{id:'block',mins:77,startedAt:oldStamp,updatedAt:oldStamp}],
      obras:[{id:'w',solHistory:[history],movimientos:[{id:'m',updatedAt:oldStamp,solHistory:[history]}]}],
      weeklyPlans:[{weekStart:'2026-09-07',slots:[{position:0,date:'2026-09-07',unknown:{longer:1,a:2}}]}]};
    const incoming=structuredClone(stored);
    incoming.sessionPlants[0].notes=[{id:'note',text:'Keep this observation'}];
    incoming.sessionPlants[0]._fieldClock={notes:stamp};
    incoming.obras[0].solHistory[0]._fieldClock.val=stamp;
    incoming.obras[0].movimientos[0].solHistory[0]._fieldClock.val=stamp;
    incoming.obras[0].movimientos[0]._fieldClock={futureField:stamp};
    incoming.obras[0].movimientos[0].futureField={keep:true};
    incoming.sessionPlants.push({id:'today',mins:86,startedAt:'2026-09-19T08:00:00Z'});
    const outgoing=Doc.mergeRemote(stored,incoming),saved=await write('complete-ack',stored,outgoing);
    expect(saved.sessionPlants.find(p=>p.id==='block').notes).toEqual(incoming.sessionPlants[0].notes);
    expect(saved.obras[0].movimientos[0].solHistory[0]._fieldClock.val).toBe(stamp);
    expect(Doc.sameContent(Doc.mergeRemote(saved,outgoing),saved)).toBe(true);
    expect(saved.weeklyPlans).toHaveLength(1);
    const repeat=await write('repeat-ack',saved,Doc.mergeRemote(saved,incoming));
    expect(Doc.sameContent(saved,repeat)).toBe(true);
  });
  it('recognizes anonymous records after JSONB reorders nested keys and folds duplicate identities conservatively',async()=>{
    const local={weeklyPlans:[{weekStart:'2026-09-07',slots:[{position:0,unknown:{longer:1,a:2}}]}]};
    const returned=(await pg.query('select $1::jsonb as data',[JSON.stringify(local)])).rows[0].data;
    expect(Doc.sameContent(Doc.mergeRemote(returned,local),returned)).toBe(true);
    const duplicates=[{id:'same',first:1},{id:'same',second:2}],extra=[{id:'other',value:3}];
    const sqlResult=(await pg.query('select document_merge($1::jsonb,$2::jsonb) as data',[JSON.stringify(duplicates),JSON.stringify(extra)])).rows[0].data;
    expect(Doc.mergeRemote({items:duplicates},{items:extra}).items).toEqual(sqlResult);
  });
  it('finishes pending iPad and phone sync across midnight and remains clean on reopen',async()=>{
    const id='midnight-devices',yesterday='2026-09-18T08:00:00Z',today='2026-09-19T08:00:00Z';
    const base={obras:[],sessionPlants:[{id:'morning',mins:77,startedAt:yesterday}],
      weeklyPlans:[{weekStart:'2026-09-14',slots:[{position:0,date:'2026-09-19'}]}]};
    await pg.query('insert into user_data(id,data) values ($1,$2)',[id,JSON.stringify(base)]);
    let writes=0;
    const query=async({operation,value,expected})=>{
      if(operation==='read')return {data:(await pg.query('select data,updated_at::text from user_data where id=$1',[id])).rows[0]};
      writes++;
      return {data:(await pg.query('update user_data set data=$2 where id=$1 and updated_at=$3::timestamptz returning data,updated_at::text',[id,JSON.stringify(value.data),expected])).rows[0]||null};
    };
    const ipad=cloudAppHarness(base,base,{meta:null,userId:id,query}),phone=cloudAppHarness(base,base,{meta:null,userId:id,query});
    const ctx=ipad.boot();
    ctx.db.sessionPlants[0].notes=[{id:'note',text:'Practice observation'}];
    ctx.db.sessionPlants.push({id:'afternoon',mins:289,startedAt:'2026-09-18T13:00:00Z'},{id:'today',mins:86,startedAt:today});
    ctx.saveLocalNow();
    expect(await ctx.syncPendingCloudChanges()).toBe(true);
    await phone.open();
    expect(phone.state().local.sessionPlants.filter(p=>p.startedAt.startsWith('2026-09-19')).reduce((sum,p)=>sum+p.mins,0)).toBe(86);
    const next=phone.boot();next.db.sessionPlants.push({id:'phone-study',mins:120,startedAt:'2026-09-19T11:00:00Z'});next.saveLocalNow();
    expect(await next.syncPendingCloudChanges()).toBe(true);
    await ipad.open();
    expect(ipad.state().local.sessionPlants).toHaveLength(4);
    expect(ipad.state().local.sessionPlants.reduce((sum,p)=>sum+p.mins,0)).toBe(572);
    const completedWrites=writes;await phone.open();await ipad.open();expect(writes).toBe(completedWrites);
    for(const h of [ipad,phone])expect(h.state().meta.dirtyRevision).toBe(h.state().meta.lastSyncedRevision);
  });
  it('preserves the previous pruning result for nested, anonymous and scalar records',async()=>{
    const examples=[null,{},[],17,'text',{unknown:{nested:[{keep:1}]}},
      {items:[{id:'removed'},{id:'kept',unknown:{nested:[{id:'inner'}],_deletedChildren:{nested:{inner:'stamp'}}}}],_deletedChildren:{items:{removed:'stamp'}}},
      [[{items:[{id:'a'},{id:'b'}],_deletedChildren:{items:{a:'stamp'}}}]],
      {_deletedChildren:null,items:[null,2,'text',{keep:true}]},
      {items:[],_deletedChildren:{items:{a:'stamp'}},unknown:{_deletedChildren:{items:{}},items:[{anonymous:1},null,2]}},
      {first:{items:[{id:'a'},{id:'b'}],_deletedChildren:{items:{b:'stamp'}}},last:{keep:true}}];
    for(const value of examples){
      const row=(await pg.query('select public.document_prune($1::jsonb) as current,public.document_prune_before_optimization($1::jsonb) as previous',[JSON.stringify(value)])).rows[0];
      expect(row.current).toEqual(row.previous);
    }
    const sqlNull=(await pg.query('select public.document_prune(null) as current,public.document_prune_before_optimization(null) as previous')).rows[0];
    expect(sqlNull.current).toEqual(sqlNull.previous);
  });
  it('folds duplicate identities exactly like the previous server function',async()=>{
    const left=[{id:'a',name:'Primero',extra:'conservar'},{id:'b',name:'Segundo'},{id:'a',name:'Duplicado sin reloj'}];
    const right=[{id:'b',name:'Renombrado',_fieldClock:{name:'2026-09-18T20:00:00Z'}},{id:'c',name:'Nuevo'},{id:'a',hours:6}];
    const {merged:result,previous}=(await pg.query('select public.document_merge($1::jsonb,$2::jsonb) as merged, public.document_merge_before_optimization($1::jsonb,$2::jsonb) as previous',[JSON.stringify(left),JSON.stringify(right)])).rows[0];
    expect(result).toEqual(previous);expect(result.map(r=>r.id)).toEqual(['a','b','c']);
    expect(result[0]).toMatchObject({name:'Primero',extra:'conservar',hours:6});expect(result[1].name).toBe('Renombrado');
  });
  it('uploads a large restored history under the API timeout with the real triggers',async()=>{
    const a={_localRevision:100,forestPlants:Array.from({length:7426},(_,i)=>({id:'forest-'+i,mins:30,startedAt:'2026-08-01T08:00:00Z',unknownHistory:'conservar '.repeat(40)})),
      sessionPlants:Array.from({length:833},(_,i)=>({id:'run-'+i,mins:30,startedAt:'2026-09-01T08:00:00Z'})),obras:[]};
    const b=structuredClone(a);b.sessionPlants.push({id:'new-six-hours',mins:360,startedAt:'2026-09-18T08:00:00Z'});
    const began=performance.now(),result=await write('restored-history',a,b);
    expect(performance.now()-began).toBeLessThan(8000);
    const ordered=rows=>[...rows].sort((x,y)=>x.id.localeCompare(y.id));
    expect(ordered(result.sessionPlants)).toEqual(ordered(b.sessionPlants));expect(result.forestPlants).toEqual(a.forestPlants);
  },15000);
  it('preserves Deutsch records through old-client writes and merges offline sessions with a single daily cap',async()=>{
    const R = require('../../german-rewards.js');
    const a={obras:[{id:'piano',name:'Sonata'}],germanStudy:{version:1,goals:[{id:'goal',amount:150}],materials:[{id:'pack',cards:[{id:'card',front:'Hallo',back:'Hola'}]}],
      sessions:[{id:'a',goalId:'goal',startedAt:'2026-09-12T10:00:00Z',segments:[{id:'2026-09-12',day:'2026-09-12',seconds:1800}]}],reviews:[{id:'review',cardId:'card',grade:'good'}]}};
    const b={germanStudy:{sessions:[{id:'b',goalId:'goal',startedAt:'2026-09-12T12:00:00Z',segments:[{id:'2026-09-12',day:'2026-09-12',seconds:3600}]}]}};
    const merged=await write('deutsch-offline',a,b);
    expect(merged.germanStudy.sessions).toHaveLength(2);
    expect(merged.germanStudy.materials).toEqual(a.germanStudy.materials);
    expect(merged.germanStudy.reviews).toEqual(a.germanStudy.reviews);
    expect(R.ledger(merged.germanStudy.sessions,merged.germanStudy.goals).reduce((n,r)=>n+r.finalReward,0)).toBe(2);
    const legacy=await write('deutsch-legacy',merged,{obras:[{id:'piano',name:'Sonata'}]});
    expect(legacy.germanStudy).toEqual(merged.germanStudy);
  });
  it.each(remoteDocumentCases)('$name',async({name,stored,incoming,expected})=>{
    const direct=(await pg.query('select public.document_merge($1::jsonb,$2::jsonb) as merged',[JSON.stringify(stored),JSON.stringify(incoming)])).rows[0].merged;
    expect(direct).toMatchObject(expected);
    expect(direct).toEqual(Doc.mergeRemote(stored,incoming));
    const saved=await write(name,stored,incoming);
    expect(saved).toMatchObject(expected);
    expect(saved._localRevision).toBeGreaterThanOrEqual(101);
  });

  it.each([true,false])('real offline saves reconnect through app and SQL CAS without stale rollback (download first: %s)',async download=>{
    const id='offline-'+download;
    const server={_localRevision:100,obras:[{id:'w',dificultad:9,name:'Sonata'}],cronoTasks:[]};
    const stale={...structuredClone(server),_localRevision:20};stale.obras[0].dificultad=5;
    await pg.query('insert into user_data(id,data) values ($1,$2)',[id,JSON.stringify(server)]);
    let conflicts=0,attempts=0;
    const h=cloudAppHarness(stale,server,{meta:null,userId:id,query:async({operation,value,expected})=>{
      if(operation==='read')return {data:(await pg.query('select data,updated_at::text as updated_at from user_data where id=$1',[id])).rows[0]};
      attempts++;
      // A second device updates the server after the first CAS read. The app
      // must reread, preserve that scalar too, and reconcile the accepted row.
      if(attempts===1){
        const other=Doc.track({...server,obras:[{...server.obras[0],dificultad:10}]},server,'2026-09-04T12:00:00.000Z');
        await pg.query('update user_data set data=$2 where id=$1',[id,JSON.stringify(other)]);
      }
      // Unchanged remote works must not be resent with an unrelated task edit.
      expect(value.data.obras).toBeUndefined();
      const result=await pg.query('update user_data set data=$2 where id=$1 and updated_at=$3::timestamptz returning data,updated_at::text as updated_at',
        [id,JSON.stringify(value.data),expected]);
      if(!result.rows.length)conflicts++;
      return {data:result.rows[0]||null};
    }});
    const ctx=h.boot();saveUnrelatedOffline(ctx);
    expect(ctx.db._localRevision).toBe(220);expect(ctx.db.obras[0]._fieldClock?.dificultad).toBeUndefined();
    expect(h.state().reads).toBe(0);
    // Direct SQL independently protects the exact offline document (before JS
    // sanitizes the outbound snapshot), including the new clocked task.
    const direct=(await pg.query('select document_merge($1::jsonb,$2::jsonb) as data',[JSON.stringify(server),JSON.stringify(ctx.db)])).rows[0].data;
    expect(direct).toEqual(Doc.mergeRemote(server,ctx.db));expect(direct.obras[0].dificultad).toBe(9);
    const legacy=await write(id+'-legacy',server,ctx.db);
    expect(legacy).toMatchObject({obras:[{dificultad:9}],cronoTasks:[{id:'offline-task',text:'Nueva tarea 199'}]});
    await h.reconnect(download);
    expect(conflicts).toBe(1);expect(attempts).toBe(2);
    expect(h.state()).toMatchObject({local:{obras:[{dificultad:10}],cronoTasks:[{id:'offline-task',text:'Nueva tarea 199'}]},
      row:{data:{obras:[{dificultad:10}],cronoTasks:[{id:'offline-task',text:'Nueva tarea 199'}]}}});
    await h.open();expect(attempts).toBe(2);expect(h.state().local.cronoTasks).toHaveLength(1);
  });

  it('uses the same record identities as the client, including null IDs, context and round',async()=>{
    for(const value of [{id:'m'},{id:null,runId:'r'},{date:'2026-09-04',context:'antes'},{date:'2026-09-04',context:'despues'},
      {obraId:'w',movId:null,movimientoId:'m',uso:'video',ronda:'preseleccion'},{obraId:'w',movimientoId:'m',uso:'directo',ronda:'final'}]){
      const result=await pg.query('select public.document_record_key($1::jsonb) as key',[JSON.stringify(value)]);
      expect(result.rows[0].key).toBe(Doc.identity(value));
    }
    const a={obras:[{id:'w',solHistory:[{date:'2026-09-04T10:00:00Z',context:'antes',val:51}]}]},b=structuredClone(a);
    b.obras[0].solHistory.push({date:'2026-09-04T10:00:00Z',context:'despues',val:70});
    expect((await write('history-context',a,b)).obras[0].solHistory).toHaveLength(2);
  });
  it('preserves an unstudied new work, new movements and unknown nested fields against an old client',async()=>{
    const a={_localRevision:90,obras:[{id:'new',movimientos:[{id:'m',sol:83}]}],eventos:[{id:'e',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-10',nuevoCampoFuturo:{x:1,y:2}}]};
    const b={_localRevision:3,obras:[],eventos:[{id:'e',nombre:'Edited',nuevoCampoFuturo:{x:1}}]};
    const r=await write('legacy',a,b);
    expect(r.obras[0].movimientos[0].sol).toBe(83);
    expect(r.eventos[0]).toMatchObject({nombre:'Edited',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-10',nuevoCampoFuturo:{x:1,y:2}});
    expect(r._localRevision).toBeGreaterThan(90);
    expect((await pg.query('select count(*) from user_data_backups where user_id=$1',['legacy'])).rows[0].count).toBe(1);
  });
  it('preserves two independent edited fields across a stale upload',async()=>{
    const old={obras:[{id:'w',dificultad:5,movimientos:[{id:'m',sol:40}]}]};
    const a=structuredClone(old),b=structuredClone(old); a.obras[0].dificultad=9; b.obras[0].movimientos[0].sol=88;
    const r=await write('parallel',Doc.track(a,old,'2026-09-04T10:00:00Z'),Doc.track(b,old,'2026-09-04T11:00:00Z'));
    expect(r.obras[0]).toMatchObject({dificultad:9,movimientos:[{sol:88}]});
  });
  it('cannot resurrect deleted tasks, works or movements despite legacy guards',async()=>{
    const old={cronoTasks:[{id:'t',text:'Task'}],obras:[{id:'w',movimientos:[{id:'m',sol:30}]}],sessionPlants:[{id:'p',obraId:'w',movId:'m',mins:25}]};
    const next=structuredClone(old);next.cronoTasks=[];next.obras[0].movimientos=[];
    const deleted=Doc.track(next,old,'2026-09-04T10:00:00Z');
    const first=await write('deleted',old,deleted);
    expect(first.cronoTasks).toEqual([]);expect(first.obras[0].movimientos).toEqual([]);
    const r=(await pg.query('update user_data set data=$1 where id=$2 returning data',[JSON.stringify(old),'deleted'])).rows[0].data;
    expect(r.cronoTasks).toEqual([]); expect(r.obras[0].movimientos).toEqual([]);
    expect(r.sessionPlants).toHaveLength(1);
  });
  it('only one compare-and-swap update can accept the same timestamp',async()=>{
    const original=(await pg.query('insert into user_data(id,data) values ($1,$2) returning updated_at::text as stamp',['cas','{}'])).rows[0].stamp;
    const first=await pg.query('update user_data set data=$1 where id=$2 and updated_at=$3::timestamptz returning id',['{"a":1}','cas',original]);
    const stale=await pg.query('update user_data set data=$1 where id=$2 and updated_at=$3::timestamptz returning id',['{"b":2}','cas',original]);
    expect(first.rows).toHaveLength(1);expect(stale.rows).toHaveLength(0);
  });
});
