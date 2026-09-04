import vm from 'node:vm';
import fs from 'node:fs';
import {describe,it,expect} from 'vitest';
const source=fs.readFileSync('sw.js','utf8');
function harness(){
  const events={},stores=new Map(),calls=[];
  const key=x=>new URL(typeof x==='string'?x:x.url,'https://piano.test/').href;
  const client={id:'client-1',url:'https://piano.test/',navigate:async url=>{calls.push('navigate:'+url);return client;},postMessage:msg=>calls.push('client-message:'+msg.type)};
  const caches={keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k),open:async name=>{
    if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);
    return {addAll:async urls=>{urls.forEach(u=>store.set(key(u),new Response('A:'+key(u))));},match:async u=>store.get(key(u))?.clone(),put:async(u,r)=>store.set(key(u),r.clone?r.clone():r),delete:async u=>store.delete(key(u))};
  },match:async u=>{for(const s of stores.values())if(s.has(key(u)))return s.get(key(u)).clone();}};
  const self={addEventListener:(k,v)=>events[k]=v,location:{origin:'https://piano.test'},registration:{scope:'https://piano.test/'},clients:{claim:async()=>calls.push('claim'),matchAll:async()=>[client]},skipWaiting:async()=>calls.push('skip')};
  const ctx={self,caches,URL,Response,Request:class extends Request{constructor(url,opts){super(key(url),opts);}},fetch:async()=>{calls.push('network');return new Response('B-network');},console,Promise,Date,JSON};
  vm.runInNewContext(source,ctx);
  const lifecycle=async kind=>{let p;events[kind]({waitUntil:x=>{p=x;}});await p;};
  const message=async(data,sourceClient=client)=>{let p;events.message({data,source:sourceClient,waitUntil:x=>{p=x;}});if(p)await p;};
  const fetch=async(url,mode='cors')=>{let p;events.fetch({request:{url:key(url),method:'GET',mode},respondWith:x=>{p=x;}});return p;};
  return {stores,calls,events,ctx,lifecycle,message,fetch,client};
}
describe('PWA version boundary',()=>{
  it('installs a complete version and keeps its shell when B is deployed',async()=>{
    const h=harness();await h.lifecycle('install');
    expect(h.calls).not.toContain('skip');
    expect(await (await h.fetch('/?view=cronometro','navigate')).text()).toContain('A:');
    expect(await (await h.fetch('/app.js?v=344')).text()).toContain('A:');
    expect(h.calls).not.toContain('network');
  });
  it('offline navigation and scripts come from the same precache',async()=>{
    const h=harness();await h.lifecycle('install');h.ctx.fetch=async()=>{throw Error('offline');};
    expect((await h.fetch('/index.html','navigate')).status).toBe(200);
    expect((await h.fetch('/document-sync-core.js?v=344')).status).toBe(200);
  });
  it('ignores unsafe promotion and forces a real navigation after explicit promotion',async()=>{
    const h=harness();
    await h.message({type:'SKIP_WAITING'});await h.message({type:'SAFE_SKIP_WAITING'});
    expect(h.calls).toEqual([]);
    await h.message({type:'SAFE_SKIP_WAITING',safe:true,requestedAt:'2026-09-04T18:00:00Z'});
    expect(h.calls).toContain('skip');
    await h.lifecycle('activate');
    expect(h.calls.filter(x=>x.startsWith('navigate:'))).toEqual(['navigate:https://piano.test/?__pwa=346']);
    expect(h.calls).toContain('client-message:SAFE_UPDATE_ACTIVATED');
  });
  it('falls back to all scoped clients when iOS does not expose the message source id',async()=>{
    const h=harness();await h.message({type:'SAFE_SKIP_WAITING',safe:true},null);await h.lifecycle('activate');
    expect(h.calls.filter(x=>x.startsWith('navigate:'))).toEqual(['navigate:https://piano.test/?__pwa=346']);
  });
  it('activation preserves unrelated caches and the previous shell for old tabs',async()=>{
    const h=harness();['estudio-v340','estudio-v341','user-content'].forEach(k=>h.stores.set(k,new Map()));
    await h.lifecycle('install');await h.lifecycle('activate');
    expect([...h.stores.keys()].sort()).toEqual(['estudio-v341','estudio-v346','user-content']);
    expect(h.calls.some(x=>x.startsWith('navigate:'))).toBe(false);
  });
  it('never serves a new script under an uncached old version URL',async()=>{
    const h=harness();await h.lifecycle('install');
    expect((await h.fetch('/app.js?v=' + '340')).status).toBe(503);expect(h.calls).not.toContain('network');
  });
});
