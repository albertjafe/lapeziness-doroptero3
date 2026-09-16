import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let pg;
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table public.push_timer_runs(user_id uuid,run_id text,mode text,is_rest boolean default false,
      work_name text default 'Piano',started_at timestamptz,ends_at timestamptz,status text default 'active',
      sent_countdown smallint[] default '{}',last_milestone_minutes integer default 0,updated_at timestamptz default now(),
      primary key(user_id,run_id));`);
  await pg.exec(readFileSync('supabase/migrations/20260916093251_timer_notifications_10_5_2_1.sql','utf8'));
},30000);
afterAll(async()=>{await pg?.close();});
const user='00000000-0000-0000-0000-000000000001';
async function run(mode,offset){
  await pg.exec('truncate public.push_timer_runs');
  await pg.query(`insert into public.push_timer_runs(user_id,run_id,mode,started_at,ends_at)
    values($1,'test',$2,now()-($3::integer*interval '1 minute'),now()+($4::integer*interval '1 minute')-interval '1 second')`,
    [user,mode,mode==='stopwatch'?offset:25,mode==='timer'?offset:120-offset]);
}
describe('server background notification schedule',()=>{
  it.each([10,5,2,1])('claims the %i-minute warning only once',async minutes=>{
    await run('timer',minutes);
    const rows=(await pg.query('select * from public.claim_due_push_events()')).rows;
    expect(rows).toHaveLength(1);expect(rows[0].warning_minutes).toBe(minutes);
    expect((await pg.query('select * from public.claim_due_push_events()')).rows).toHaveLength(0);
  });
  it.each([15,30,45,60,75,90,105])('claims the %i-minute stopwatch milestone only once',async minutes=>{
    await run('stopwatch',minutes);
    const rows=(await pg.query('select * from public.claim_due_push_events()')).rows;
    expect(rows[0].milestone_minutes).toBe(minutes);
    expect((await pg.query('select * from public.claim_due_push_events()')).rows).toHaveLength(0);
  });
  it('automatically resumes an expired five-minute pause and sends the due warning',async()=>{
    await run('timer',2);
    await pg.exec("update push_timer_runs set status='paused',pause_until=now()-interval '1 second'");
    expect((await pg.query('select * from public.claim_due_push_events()')).rows[0].warning_minutes).toBe(2);
    expect((await pg.query('select status from push_timer_runs')).rows[0].status).toBe('active');
  });
  it('sends the last 120-minute milestone at the cap and completes it only once',async()=>{
    await run('stopwatch',120);
    expect((await pg.query('select * from public.claim_due_push_events()')).rows[0].milestone_minutes).toBe(120);
    expect((await pg.query('select * from public.claim_due_push_events()')).rows).toHaveLength(0);
    expect((await pg.query('select status from push_timer_runs')).rows[0].status).toBe('completed');
  });
  it('cannot reactivate a completed run through a late upsert',async()=>{
    await run('timer',1);
    await pg.exec("update push_timer_runs set status='completed';update push_timer_runs set status='active'");
    expect((await pg.query('select * from public.claim_due_push_events()')).rows).toHaveLength(0);
    expect((await pg.query('select status from push_timer_runs')).rows[0].status).toBe('completed');
  });
  it('preserves sent checkpoints when a foreground registration arrives late',async()=>{
    await run('timer',2);
    await pg.query('select * from public.claim_due_push_events()');
    await pg.exec("update push_timer_runs set sent_countdown='{}',last_milestone_minutes=0");
    expect((await pg.query('select * from public.claim_due_push_events()')).rows).toHaveLength(0);
  });
  it('does not emit old countdown warnings or milestones during rest',async()=>{
    await run('timer',8);
    expect((await pg.query('select * from public.claim_due_push_events()')).rows).toHaveLength(0);
    await run('stopwatch',30);await pg.exec("update push_timer_runs set is_rest=true");
    expect((await pg.query('select * from public.claim_due_push_events()')).rows).toHaveLength(0);
  });
});
