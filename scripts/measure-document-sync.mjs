// Isolated PostgreSQL/WASM benchmark. Never connects to or writes production.
// Optional input: a locally authorized JSON snapshot. Only timings/hashes leave
// this process; the supplied document is never written into the repository.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const migrations=[
  '202609010002_protect_study_structure_sync.sql','202609010003_harden_study_movement_recency_merge.sql',
  '202609020002_preserve_planning_events.sql','202609030003_task_sync_revision_guard.sql',
  '202609040004_reduce_user_data_sync_contention.sql','20260904123621_conservative_document_sync.sql',
  '20260918202404_optimize_document_record_merge.sql','20260918205809_optimize_document_tombstone_pruning.sql',
  '20260919142631_preserve_sync_acknowledgement_fields.sql','20260922175710_optimize_sync_object_assembly.sql',
  '20261002180000_index_study_reference_checks.sql','20261008151000_document_merge_record_identity.sql'
];
const input=process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2],'utf8')) : {
  obras:[{id:'w',name:'Synthetic work',movimientos:[]}],eventos:[],competitionPlans:[],cronoTasks:[],sesiones:[],sessionPlants:[],
  forestPlants:Array.from({length:8260},(_,i)=>({id:'f'+i,obraId:'w',mins:20,startedAt:new Date(Date.UTC(2024,0,1,0,i*20)).toISOString(),extra:'x'.repeat(300)})),
  _deletedChildren:{sessionPlants:{'id:removed':'2026-01-01'}}
};
const delta={cronoTasks:[{id:'__isolated_performance_task__',text:'Synthetic task',createdAt:'2026-10-17T18:00:00Z'}]};
const pg=new PGlite();
try {
  await pg.exec(`create role anon;create role authenticated;
    create table user_data(id text primary key,data jsonb,updated_at timestamptz default now());
    create table user_data_backups(backup_id bigserial primary key,user_id text,data jsonb,source_updated_at timestamptz,backed_up_at timestamptz);`);
  await pg.exec(read('tests/fixtures/legacy-task-merge.sql'));
  for(const name of migrations)await pg.exec(read('supabase/migrations/'+name));
  await pg.exec(`create trigger trg_00_preserve_crono_tasks before update of data on user_data for each row execute function preserve_crono_tasks_on_user_data_update();
    create trigger trg_backup_user_data_before_change before update of data on user_data for each row execute function backup_user_data_before_change();`);
  for(const id of ['before','after'])await pg.query('insert into user_data(id,data) values($1,$2)',[id,JSON.stringify(input)]);
  const measure=async id=>{
    let start=performance.now();
    const merged=await pg.query('select md5(document_merge(data,$2::jsonb)::text) as hash from user_data where id=$1',[id,JSON.stringify(delta)]);
    const mergeMs=performance.now()-start;start=performance.now();
    const write=await pg.query('update user_data set data=$2 where id=$1 returning md5(data::text) as hash',[id,JSON.stringify(delta)]);
    return {mergeMs:Math.round(mergeMs),updateMs:Math.round(performance.now()-start),mergeHash:merged.rows[0].hash,updateHash:write.rows[0].hash};
  };
  const before=await measure('before');
  await pg.exec(read('supabase/migrations/20261017184302_optimize_partial_document_sync.sql'));
  const after=await measure('after');
  const equivalent=before.mergeHash===after.mergeHash&&before.updateHash===after.updateHash;
  console.log(JSON.stringify({engine:'PGlite (local WASM)',bytes:Buffer.byteLength(JSON.stringify(input)),before,after,equivalent},null,2));
  if(!equivalent)process.exitCode=1;
} catch(error) { console.error(error.message);process.exitCode=1; }
finally {await pg.close();}
