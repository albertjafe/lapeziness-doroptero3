/* Chamber factor migration.
   v430 changes every chamber rehearsal/class from ×1/3 to ×0.5, including
   historical local/cloud records that still store an explicit legacy factor. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.ChamberFactorMigration=api;api.installBrowser(root);}
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const TARGET_FACTOR=.5;

  function migrateEntry(entry){
    if(!entry||entry.activityType!=='chamber')return 0;
    if(Number(entry.activityFactor)===TARGET_FACTOR)return 0;
    const stamp=new Date().toISOString();
    entry.activityFactor=TARGET_FACTOR;
    entry.updatedAt=stamp;
    if(!entry._fieldClock||typeof entry._fieldClock!=='object')entry._fieldClock={};
    entry._fieldClock.activityFactor=stamp;
    entry._fieldClock.updatedAt=stamp;
    return 1;
  }

  function migrateDatabase(database){
    if(!database||typeof database!=='object')return 0;
    let changed=0;
    ['sessionPlants','forestPlants'].forEach(key=>{
      (Array.isArray(database[key])?database[key]:[]).forEach(entry=>{changed+=migrateEntry(entry);});
    });
    const rewardSessions=database.pianoRewards&&Array.isArray(database.pianoRewards.sessions)
      ? database.pianoRewards.sessions:[];
    rewardSessions.forEach(entry=>{changed+=migrateEntry(entry);});
    (Array.isArray(database.sesiones)?database.sesiones:[]).forEach(session=>{
      (Array.isArray(session&&session.items)?session.items:[]).forEach(entry=>{changed+=migrateEntry(entry);});
    });
    return changed;
  }

  function installBrowser(root){
    if(!root||!root.document||root.__chamberFactorMigrationInstalled)return;
    root.__chamberFactorMigrationInstalled=true;
    let saving=false;

    function appDb(){
      try{if(typeof db!=='undefined'&&db)return db;}catch(error){}
      return root.db||null;
    }

    function run(){
      if(saving)return 0;
      const database=appDb();
      if(!database)return 0;
      const changed=migrateDatabase(database);
      if(!changed)return 0;
      saving=true;
      try{
        if(typeof root.saveData==='function')root.saveData();
        if(typeof root.saveLocalNow==='function')root.saveLocalNow();
        if(typeof root.refreshStudyViews==='function')root.refreshStudyViews();
        if(typeof root.enqueueCloudSync==='function')root.enqueueCloudSync();
      }finally{
        saving=false;
      }
      return changed;
    }

    const boot=()=>{
      run();
      [500,2000,8000].forEach(ms=>root.setTimeout&&root.setTimeout(run,ms));
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
    root.addEventListener&&root.addEventListener('focus',run);
    root.document.addEventListener&&root.document.addEventListener('visibilitychange',()=>{
      if(root.document.visibilityState==='visible')run();
    });
  }

  return {TARGET_FACTOR,migrateEntry,migrateDatabase,installBrowser};
});
