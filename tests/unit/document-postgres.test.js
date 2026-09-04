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
      expect(value.data.obras[0].dificultad).toBe(attempts===1?9:10);
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
