import {describe,expect,it} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../../update.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function harness({withData=true}={}){
  const raw=withData?JSON.stringify({_localRevision:12,sesiones:[{id:'study-40',mins:40}]}):null;
  const storage=new Map(raw?[['alberto_piano_v2',raw]]:[]);
  const statuses=[];const messages=[];const navigations=[];const listeners={};
  const status={set textContent(value){statuses.push(value);},get textContent(){return statuses.at(-1);}};
  const button={disabled:false};
  const waiting={state:'installed',postMessage(message){messages.push(message);queueMicrotask(()=>listeners.controllerchange?.());}};
  const registration={waiting,installing:null,update:async()=>registration};
  const serviceWorker={getRegistration:async()=>registration,addEventListener:(type,listener)=>{listeners[type]=listener;}};
  const window={indexedDB:null};
  const context={
    window,document:{getElementById:id=>id==='status'?status:button},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
    navigator:{serviceWorker},location:{replace:url=>navigations.push(url)},
    console:{warn(){}},Promise,JSON,Date,setTimeout,clearTimeout,queueMicrotask,
  };
  vm.runInNewContext(source,context);
  return {window,statuses,messages,navigations,button};
}

describe('network recovery update page',()=>{
  it('protects an existing local document before promoting the waiting worker',async()=>{
    const h=harness();
    expect(await h.window.forceUpdate()).toBe(true);
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]).toMatchObject({type:'SAFE_SKIP_WAITING',safe:true,recoveryPage:true});
    expect(h.navigations).toHaveLength(1);
    expect(h.navigations[0]).toContain('updated=348');
  });

  it('does not promote a worker when no valid local document exists',async()=>{
    const h=harness({withData:false});
    expect(await h.window.forceUpdate()).toBe(false);
    expect(h.messages).toHaveLength(0);
    expect(h.navigations).toHaveLength(0);
    expect(h.statuses.at(-1)).toContain('copia local válida');
  });
});
