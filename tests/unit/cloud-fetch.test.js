import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it,expect} from 'vitest';
const source=readFileSync('app.js','utf8');
function harness(fetch){
  let expire,cleared=0;
  const ctx={AbortController,Request,fetch,setTimeout:fn=>{expire=fn;return 1;},clearTimeout:()=>cleared++};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function cloudFetch('),source.indexOf('function getSB(')),ctx);
  return {run:ctx.cloudFetch,expire:()=>expire(),cleared:()=>cleared};
}
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
