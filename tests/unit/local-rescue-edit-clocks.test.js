import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it,expect} from 'vitest';
import {cloudAppHarness} from '../fixtures/cloud-app-harness.js';
const source=readFileSync('local-save-resilience.js','utf8');
const recovery=source.slice(source.indexOf('async function recoverSnapshot('),source.indexOf('function boot('));
function harness(local,rescue,wait=Promise.resolve()){
  const h=cloudAppHarness(local,local),ctx=h.boot();ctx.window=ctx;
  ctx.getRescueSnapshot=async()=>{await wait;return {data:structuredClone(rescue)};};
  ctx.currentDb=()=>ctx.db;ctx.show=()=>{};ctx.enqueueImmediate=()=>{};
  vm.runInContext(recovery,ctx);return {h,ctx};
}
it('restoring IndexedDB does not restamp every old practice block as a fresh edit',async()=>{
  const rescue={_localRevision:100,sessionPlants:[{id:'old',mins:366,updatedAt:'2026-09-18T10:00:00Z',_fieldClock:{mins:'2026-09-18T10:00:00Z'}}]};
  const {ctx}=harness({sessionPlants:[]},rescue);
  expect(await ctx.recoverSnapshot()).toBe(true);
  expect(ctx.db.sessionPlants[0]).toEqual(rescue.sessionPlants[0]);
  expect(ctx.SyncCore.isDirty(ctx._readSyncMeta())).toBe(true);
});
it('an unsaved live edit made while rescue is being read keeps its own newer field clock',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);
  const local={_localRevision:10,obras:[{id:'work',name:'Original',_fieldClock:{name:'2026-01-01T00:00:00Z'}}],sessionPlants:[]};
  const rescue={...structuredClone(local),_localRevision:100,sessionPlants:[{id:'old',mins:366,updatedAt:'2026-09-18T10:00:00Z'}]};
  const {ctx}=harness(local,rescue,wait),pending=ctx.recoverSnapshot();
  ctx.db.obras[0].name='Edited while reading';release();await pending;
  expect(ctx.db.obras[0].name).toBe('Edited while reading');
  expect(ctx.db.obras[0]._fieldClock.name>'2026-01-01T00:00:00Z').toBe(true);
  expect(ctx.db.sessionPlants[0]).toEqual(rescue.sessionPlants[0]);
});
