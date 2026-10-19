/* Agrupar obras sueltas como movimientos de una obra (19-10-2026).
   Las tres piezas de Debussy, Images I, estaban como tres obras. Pasan a ser
   los tres movimientos de una sola obra, cada una con todo su historial
   (solidez, pases, zonas, dificultad). Las referencias {obraId: pieza} de
   sesiones, bloques y planes pasan a {obraId: obra nueva, movId: pieza}.
   Idempotente: se repite al abrir y al volver a la app por si otro dispositivo
   con una versión anterior guarda algo con la referencia antigua. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.ObraGroupingMigration=api;api.installBrowser(root);}
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const GROUPS=Object.freeze([
    Object.freeze({
      id:'debussy-images-1',
      name:'Images I, L.110',
      composer:'Claude Debussy',
      members:Object.freeze([
        Object.freeze({id:'o1790682725273',name:'I. Reflets dans l\'eau'}),
        Object.freeze({id:'o1788778666960',name:'II. Hommage à Rameau'}),
        Object.freeze({id:'o1790871529608',name:'III. Mouvement'}),
      ]),
    }),
  ]);
  // Secciones que guardan referencias a obras (no se recorre el documento entero).
  const REF_SECTIONS=['sesiones','sessionPlants','forestPlants','registro','eventos','competitionPlans',
    'passageTracker','cronoPasajes','pianoRewards','historicalRepertoire','weeklyPlans','cronoTasks'];
  const OBRA_ONLY=new Set(['movimientos','tipo','composer','_fieldClock','recoveredAt']);

  const clone=value=>JSON.parse(JSON.stringify(value));

  function toMovement(obra,member,stamp){
    const mov={};
    Object.keys(obra).forEach(key=>{if(!OBRA_ONLY.has(key))mov[key]=clone(obra[key]);});
    mov.id=member.id;
    mov.name=member.name;
    mov.updatedAt=stamp;
    return mov;
  }

  // Reescribe {obraId: pieza} → {obraId: grupo, movId: pieza} y listas de ids.
  function rewrite(node,memberToGroup,depth){
    if(!node||typeof node!=='object'||depth>8)return 0;
    let changed=0;
    if(Array.isArray(node)){
      for(let i=0;i<node.length;i++){
        const value=node[i];
        if(typeof value==='string'&&memberToGroup.has(value)){
          const group=memberToGroup.get(value);
          if(node.includes(group)){node.splice(i,1);i--;}else node[i]=group;
          changed++;
        }else changed+=rewrite(value,memberToGroup,depth+1);
      }
      return changed;
    }
    const obraId=node.obraId;
    if(typeof obraId==='string'&&memberToGroup.has(obraId)&&!node.movId&&!node.movimientoId){
      node.obraId=memberToGroup.get(obraId);
      node.movId=obraId;
      changed++;
    }
    Object.keys(node).forEach(key=>{
      if(key==='_fieldClock'||key==='_deletedChildren')return;
      const value=node[key];
      if(value&&typeof value==='object')changed+=rewrite(value,memberToGroup,depth+1);
    });
    return changed;
  }

  // deep=false: solo agrupa si aún hay piezas sueltas (barato). deep=true
  // además repasa las referencias del resto del documento.
  function migrateDatabase(database,now,deep=true){
    if(!database||typeof database!=='object'||!Array.isArray(database.obras))return 0;
    const stamp=(now instanceof Date?now:new Date()).toISOString();
    let changed=0;
    const memberToGroup=new Map();
    GROUPS.forEach(group=>{
      group.members.forEach(member=>memberToGroup.set(member.id,group.id));
      const sources=group.members
        .map(member=>({member,obra:database.obras.find(o=>o&&o.id===member.id&&!o.deletedAt)}))
        .filter(entry=>entry.obra);
      let parent=database.obras.find(o=>o&&o.id===group.id);
      if(!sources.length)return;
      if(!parent){
        const created=sources.map(entry=>entry.obra.createdAt).filter(Boolean).sort()[0]||stamp;
        parent={id:group.id,name:group.name,composer:group.composer,tipo:'obra',movimientos:[],
          notes:'',solHistory:[],paseHistory:[],createdAt:created,updatedAt:stamp};
        const first=database.obras.findIndex(o=>o&&o.id===sources[0].obra.id);
        database.obras.splice(first<0?database.obras.length:first,0,parent);
      }
      if(!Array.isArray(parent.movimientos))parent.movimientos=[];
      group.members.forEach(member=>{
        const source=sources.find(entry=>entry.member.id===member.id);
        if(!source)return;
        if(!parent.movimientos.some(m=>m&&m.id===member.id))parent.movimientos.push(toMovement(source.obra,member,stamp));
        const index=database.obras.indexOf(source.obra);
        if(index>=0)database.obras.splice(index,1);
        changed++;
      });
      // El orden de los movimientos es el del grupo.
      const order=group.members.map(member=>member.id);
      parent.movimientos.sort((a,b)=>{
        const ia=order.indexOf(a&&a.id),ib=order.indexOf(b&&b.id);
        return (ia<0?99:ia)-(ib<0?99:ib);
      });
      const sols=parent.movimientos.map(m=>Number(m&&m.sol)).filter(Number.isFinite);
      if(sols.length&&!Number.isFinite(Number(parent.sol)))parent.sol=Math.round(sols.reduce((s,v)=>s+v,0)/sols.length);
      parent.updatedAt=stamp;
    });
    if(!memberToGroup.size||(!deep&&!changed))return changed;
    // Referencias en el resto del documento y en los propios movimientos.
    REF_SECTIONS.forEach(key=>{if(database[key])changed+=rewrite(database[key],memberToGroup,0);});
    database.obras.forEach(obra=>{
      if(obra&&GROUPS.some(group=>group.id===obra.id))changed+=rewrite(obra.movimientos,memberToGroup,0);
    });
    return changed;
  }

  function installBrowser(root){
    if(!root||!root.document||root.__obraGroupingMigrationInstalled)return;
    root.__obraGroupingMigrationInstalled=true;
    let saving=false;
    function appDb(){
      try{if(typeof db!=='undefined'&&db)return db;}catch(error){}
      return root.db||null;
    }
    function run(deep){
      if(saving)return 0;
      const database=appDb();
      if(!database)return 0;
      const changed=migrateDatabase(database,new Date(),deep!==false);
      if(!changed)return 0;
      saving=true;
      try{
        if(typeof root.saveData==='function')root.saveData();
        if(typeof root.renderObras==='function')root.renderObras();
        if(typeof root.enqueueCloudSync==='function')root.enqueueCloudSync({immediate:true});
      }finally{saving=false;}
      return changed;
    }
    const boot=()=>{
      run(true);
      [1500,6000].forEach(ms=>root.setTimeout&&root.setTimeout(()=>run(true),ms));
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
    root.document.addEventListener&&root.document.addEventListener('visibilitychange',()=>{
      if(root.document.visibilityState==='visible')root.setTimeout(()=>run(false),4000);
    });
  }

  return {GROUPS,migrateDatabase,installBrowser};
});
