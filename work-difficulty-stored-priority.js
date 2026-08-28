/* Los valores curados ya guardados por el modelo vigente ganan a una nueva coincidencia textual. */
(function(){
'use strict';
const m=window.WorkDifficultyModel;if(!m||m.__storedPriority)return;
const originalResolve=m.resolve.bind(m),originalMovement=m.resolveMovement.bind(m),originalEnrich=m.enrichEntity.bind(m);
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const currentSource=e=>String(e&&(e.dificultadFuente||e.difficultySource)||'').toLowerCase();
const stored=e=>{
  const source=currentSource(e),score=num(e&&(e.dificultad??e.difficulty));
  return score!=null&&e&&e.dificultadModelo===m.MODEL_VERSION&&['curated','catalog-rule','derived-work'].includes(source)
    ?{score:Math.round(score*10)/10,source,confidence:e.dificultadConfianza||'low',model:m.MODEL_VERSION,profile:e.dificultadPerfil||null}:null;
};
m.resolve=function(work){
  const source=currentSource(work);
  if(source==='manual')return originalResolve(work);
  const saved=stored(work);if(!saved)return originalResolve(work);
  const textual=originalResolve(work);
  return{...(textual||{}),...saved,movementScores:textual&&textual.source==='curated'?textual.movementScores:null,profile:saved.profile||(textual&&textual.profile)||null};
};
m.resolveMovement=function(work,movement,index){
  if(currentSource(movement)==='manual')return originalMovement(work,movement,index);
  const saved=stored(movement);if(saved)return{...saved,derived:saved.source==='derived-work'};
  const wr=m.resolve(work);if(!wr)return originalMovement(work,movement,index);
  const textual=originalResolve(work);
  const score=textual&&textual.source==='curated'&&textual.movementScores?num(textual.movementScores[index]):null;
  return score!=null?{score:Math.round(score*10)/10,source:'curated',confidence:textual.confidence||'high',model:m.MODEL_VERSION,derived:false}:{score:wr.score,source:'derived-work',confidence:'low',model:m.MODEL_VERSION,derived:true};
};
m.enrichEntity=function(work){
  if(!stored(work))return originalEnrich(work);
  let changed=false;
  (work.movimientos||[]).forEach((movement,index)=>{
    if(currentSource(movement)==='manual'||stored(movement))return;
    const mr=m.resolveMovement(work,movement,index);if(!mr)return;
    const set=(key,value)=>{if(JSON.stringify(movement[key])!==JSON.stringify(value)){movement[key]=value;changed=true;}};
    set('dificultad',mr.score);set('dificultadFuente',mr.source);set('dificultadConfianza',mr.confidence);set('dificultadModelo',m.MODEL_VERSION);set('dificultadCarga',Math.round(m.loadFor(mr.score)*10)/10);
  });
  return{changed,result:m.resolve(work)};
};
m.__storedPriority=true;
})();
