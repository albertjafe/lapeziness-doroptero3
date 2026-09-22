import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it,expect} from 'vitest';
const source=readFileSync('app.js','utf8');
function harness(fetch){
  let expire,cleared=0,deadline;
  const ctx={AbortController,Request,fetch,setTimeout:(fn,ms)=>{expire=fn;deadline=ms;return 1;},clearTimeout:()=>cleared++};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function cloudFetch('),source.indexOf('function getSB(')),ctx);
  return {run:ctx.cloudFetch,expire:()=>expire(),cleared:()=>cleared,deadline:()=>deadline};
}
it('gives large history responses a bounded minute without lengthening auth requests',async()=>{
  const h=harness(async()=>({ok:true}));
  await h.run('https://piano.test/rest/v1/user_data');expect(h.deadline()).toBe(60000);
  await h.run('https://piano.test/auth/v1/user');expect(h.deadline()).toBe(20000);
});
it('aborts a stalled cloud request and allows a later request to complete',async()=>{
  let calls=0;
  const h=harness((input,options)=>++calls===1?new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')))):Promise.resolve({ok:true,cache:options.cache}));
  const first=h.run('https://piano.test');const rejected=expect(first).rejects.toThrow('aborted');h.expire();await rejected;
  expect(await h.run('https://piano.test')).toMatchObject({ok:true,cache:'no-store'});expect(h.cleared()).toBe(2);
});
it('honors caller cancellation without abandoning the actual fetch',async()=>{
  const controller=new AbortController();let signal;
  const h=harness((input,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))));});
  const request=h.run('https://piano.test',{signal:controller.signal});const rejected=expect(request).rejects.toThrow('cancelled');
  controller.abort();await rejected;expect(signal.aborted).toBe(true);expect(h.cleared()).toBe(1);
});
it('cancels a stalled SDK query and rejects its late result',async()=>{
  let expire,signal,release;
  const ctx={AbortController,Promise,Error,setTimeout:fn=>{expire=fn;return 1;},clearTimeout(){}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function _cloudQuery('),source.indexOf('function _runCloudOperation(')),ctx);
  const query={abortSignal:s=>{signal=s;return query;},maybeSingle:()=>new Promise(resolve=>release=resolve)};
  const call=ctx._cloudQuery(query),failed=expect(call).rejects.toMatchObject({code:'CLOUD_REQUEST_TIMEOUT'});
  expire();await failed;expect(signal.aborted).toBe(true);release({data:{updated_at:'late'}});await Promise.resolve();
});
