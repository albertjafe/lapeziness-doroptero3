/* Durable timer independent of ticks. An idle snapshot prevents finished runs reviving. */
(function(root){
  'use strict';
  const KEY='pianoCrono_v2',DB_NAME='piano_active_timer_v1',STORE='snapshots';
  let loaded=false,lastStamp=0,writes=Promise.resolve(),databasePromise=null;
  function local(){
    try {return JSON.parse(root.localStorage.getItem(KEY)||'null');}catch(_){return null;}
  }
  const initial=local();
  function newer(a,b){return !a?b:!b?a:Number(b.savedAt||0)>Number(a.savedAt||0)?b:a;}
  function open(){
    if(databasePromise)return databasePromise;
    databasePromise=new Promise((resolve,reject)=>{
      if(!root.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
      const request=root.indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    return databasePromise;
  }
  async function readDisk(){
    try {
      const database=await open();
      return await new Promise((resolve,reject)=>{
        const tx=database.transaction(STORE,'readonly'),request=tx.objectStore(STORE).get('latest');
        request.onsuccess=()=>resolve(request.result?.snapshot||null);
        request.onerror=()=>reject(request.error);
      });
    }catch(_){return null;}
  }
  function bounded(promise,fallback){
    let timeout;
    return Promise.race([promise,new Promise(resolve=>{timeout=setTimeout(()=>resolve(fallback),2500);})]).finally(()=>clearTimeout(timeout));
  }
  const ready=bounded(readDisk(),null).then(disk=>{
    const snapshot=newer(newer(initial,local()),disk);
    loaded=true;lastStamp=Math.max(lastStamp,Number(snapshot?.savedAt)||0);
    return snapshot;
  });
  function save(value){
    // Startup preferences must not erase an unhydrated active run.
    if(!loaded && value.state==='idle')return Promise.resolve(true);
    const snapshot={...value,savedAt:Math.max(Date.now(),lastStamp+1)};
    lastStamp=snapshot.savedAt;
    let localOK=false;
    try {root.localStorage.setItem(KEY,JSON.stringify(snapshot));localOK=true;}catch(_){}
    const write=writes.catch(()=>false).then(async()=>{
      try {
        const database=await open();
        await new Promise((resolve,reject)=>{
          const tx=database.transaction(STORE,'readwrite');
          tx.objectStore(STORE).put({id:'latest',snapshot});
          tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });
        return true;
      }catch(_){return localOK;}
    });
    writes=write;
    return bounded(write,localOK);
  }
  root.CronoStateStore={ready,load:()=>ready,save,flush:()=>bounded(writes,false)};
})(typeof window!=='undefined'?window:globalThis);
