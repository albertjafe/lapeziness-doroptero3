/* Integra la dificultad técnica con los datos, el catálogo y el estimador de
   preparación. La ficha de obra (obras-v3.js) ya lee WorkDifficultyModel
   directamente, así que aquí solo se enriquecen los datos al guardar. */
(function(){
'use strict';
function data(){
  try{if(typeof DB!=='undefined'&&DB)return DB;}catch(e){}
  try{if(typeof db!=='undefined'&&db)return db;}catch(e){}
  return null;
}
function enrichAll(){
  const model=window.WorkDifficultyModel,d=data();if(!model||!d)return false;let changed=false;
  (d.obras||[]).forEach(work=>{if(work&&work.tipo!=='actividad'&&model.enrichEntity(work).changed)changed=true;});
  (d.historicalRepertoire||[]).forEach(work=>{if(work&&model.enrichEntity(work).changed)changed=true;});
  return changed;
}
function patchCatalog(){const model=window.WorkDifficultyModel;if(model&&typeof model.patchWorkCatalog==='function')model.patchWorkCatalog();}
function patchSave(){
  if(typeof window.saveData!=='function'||window.saveData.__difficultyModel)return false;
  const original=window.saveData;
  const patched=function(){enrichAll();return original.apply(this,arguments);};
  Object.keys(original).forEach(k=>{patched[k]=original[k];});
  patched.__difficultyModel=true;patched.__original=original;
  try{window.saveData=patched;}catch(e){} try{saveData=patched;}catch(e){}
  return true;
}
function boot(attempt=0){
  const model=window.WorkDifficultyModel;if(!model){if(attempt<100)setTimeout(()=>boot(attempt+1),60);return;}
  patchCatalog();enrichAll();patchSave();
  document.documentElement.dataset.difficultyIntegration='1';
  try{if(typeof window.renderObras==='function')window.renderObras();}catch(e){} try{if(typeof window.cronoRenderReadinessEstimate==='function')window.cronoRenderReadinessEstimate();}catch(e){}
  setTimeout(patchCatalog,250);
}
window.addEventListener('work-difficulty-model-ready',()=>boot(0),{once:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot(0),{once:true});else boot(0);
})();
