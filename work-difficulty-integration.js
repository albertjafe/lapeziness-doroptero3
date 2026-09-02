/* Integra la dificultad técnica con ficha, catálogo y estimador de preparación. */
(function(){
'use strict';
let activeWorkId=null;
let observer=null;

function data(){
  try{if(typeof DB!=='undefined'&&DB)return DB;}catch(e){}
  try{if(typeof db!=='undefined'&&db)return db;}catch(e){}
  return null;
}
function workById(id){const d=data();return d&&Array.isArray(d.obras)?d.obras.find(w=>String(w&&w.id)===String(id)):null;}
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
  patched.__difficultyModel=true;patched.__original=original;
  try{window.saveData=patched;}catch(e){} try{saveData=patched;}catch(e){}
  return true;
}
function patchReadiness(){
  const core=window.ReadinessCore,model=window.WorkDifficultyModel;
  if(!core||!model||typeof core.estimateReadiness!=='function')return false;
  if(core.estimateReadiness.__technicalDifficultyModel)return true;
  const previous=core.estimateReadiness.bind(core);
  const patched=function(dbValue,obraId,options){
    const result=previous(dbValue,obraId,options);if(!result)return result;
    const work=(dbValue&&dbValue.obras||[]).find(item=>String(item&&item.id)===String(obraId));
    const difficulty=model.resolve(work);if(!work||!difficulty)return result;
    const own=Number(result.diagnostics&&result.diagnostics.speed&&result.diagnostics.speed.ownIntervals)||0;
    const exponent=own>=2?.22:own===1?.38:.55;
    const factor=model.relativeFactor(difficulty.score,7,exponent);
    const scale=value=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value)*factor)):value;
    const calendar=result.calendarEstimate?{...result.calendarEstimate,lowDays:Math.max(1,Math.ceil(Number(result.calendarEstimate.lowDays||0)*factor)),highDays:Math.max(1,Math.ceil(Number(result.calendarEstimate.highDays||0)*factor))}:result.calendarEstimate;
    const factors=Array.from(new Set([...(Array.isArray(result.factors)?result.factors:[]),`dificultad técnica ${difficulty.score.toFixed(1)}/10`]));
    return{...result,pointEstimateMinutes:scale(result.pointEstimateMinutes),lowMinutes:scale(result.lowMinutes),highMinutes:scale(result.highMinutes),calendarEstimate:calendar,factors,diagnostics:{...(result.diagnostics||{}),technicalDifficulty:{score:difficulty.score,label:model.label(difficulty.score),source:difficulty.source,confidence:difficulty.confidence,rawLoad:model.loadFor(difficulty.score),factor,reference:7,exponent,model:model.MODEL_VERSION}}};
  };
  patched.__technicalDifficultyModel=true;patched.__previous=previous;core.estimateReadiness=patched;return true;
}
function difficultyMetaHtml(result){const model=window.WorkDifficultyModel;if(!model||!result)return'';return `<span class="obra-difficulty-source">${model.sourceLabel(result.source)} · confianza ${model.confidenceLabel(result.confidence)}</span>`;}
function syncDifficultyChip(meta,result,model){
  if(!meta||!result||!model)return;
  const all=Array.from(meta.querySelectorAll('.obra-premium-chip'));
  let chip=all.find(el=>el.classList.contains('obra-difficulty-chip'))||all.find(el=>/^(Dificultad|Técnica)\b/i.test(String(el.textContent||'').trim()));
  if(!chip){chip=document.createElement('span');chip.className='obra-premium-chip obra-difficulty-chip';meta.appendChild(chip);}
  chip.classList.add('obra-difficulty-chip');
  // Limpia tanto duplicados nuevos como los que ya pudieron acumularse antes
  // de este fix. Solo el chip canónico conserva la clase/posición.
  all.forEach(el=>{
    if(el===chip)return;
    const text=String(el.textContent||'').trim();
    if(el.classList.contains('obra-difficulty-chip')||/^Técnica\s*·/i.test(text))el.remove();
  });
  const html=`Técnica · <strong>${result.score.toFixed(1)}/10</strong> · ${model.label(result.score)}${difficultyMetaHtml(result)}`;
  if(chip.innerHTML!==html)chip.innerHTML=html;
}
function syncPremium(){
  const model=window.WorkDifficultyModel,overlay=document.getElementById('obraPremiumOverlay'),work=workById(activeWorkId);
  if(!model||!overlay||!work||!overlay.classList.contains('open'))return;
  const result=model.resolve(work);if(!result)return;
  const input=overlay.querySelector('#obraPremiumDifficulty');
  if(input){
    input.step='0.1';input.min='1';input.max='10';
    const label=input.closest('.obra-premium-field')?.querySelector('label');if(label&&label.textContent!=='Dificultad técnica (1–10)')label.textContent='Dificultad técnica (1–10)';
    if(String(work.dificultadFuente||'')!=='manual'&&input.value!==String(result.score))input.value=String(result.score);
  }
  const sub=overlay.querySelector('.obra-premium-sub');
  if(sub)Array.from(sub.querySelectorAll(':scope > span')).forEach(span=>{
    if(!/^(Dificultad|Técnica)\s/i.test(span.textContent||''))return;
    const next=`Técnica ${result.score.toFixed(1)}/10`;
    if(span.textContent!==next)span.textContent=next;
  });
  syncDifficultyChip(overlay.querySelector('.obra-premium-meta'),result,model);
  const rows=overlay.querySelectorAll('.obra-premium-movement');
  (work.movimientos||[]).forEach((movement,index)=>{
    const row=rows[index];if(!row)return;const mr=model.resolveMovement(work,movement,index);if(!mr)return;
    let pill=row.querySelector('.obra-premium-mov-difficulty');if(!pill){pill=document.createElement('div');pill.className='obra-premium-mov-difficulty';row.appendChild(pill);}
    const text=`${mr.derived?'≈ ':''}${mr.score.toFixed(1)}`;
    if(pill.textContent!==text)pill.textContent=text;
    pill.title=`Dificultad técnica · ${model.sourceLabel(mr.source)} · confianza ${model.confidenceLabel(mr.confidence)}`;
  });
  let detail=overlay.querySelector('.obra-difficulty-detail');const body=overlay.querySelector('.obra-premium-body');
  if(body&&!input){
    if(!detail){detail=document.createElement('section');detail.className='obra-premium-section obra-difficulty-detail';body.appendChild(detail);}
    const profile=result.profile;
    const profileHtml=profile?`<div class="obra-difficulty-profile"><span>Digital <strong>${Number(profile.digital).toFixed(1)}</strong></span><span>Coordinación <strong>${Number(profile.coordination).toFixed(1)}</strong></span><span>Saltos/acordes <strong>${Number(profile.spatial).toFixed(1)}</strong></span><span>Densidad <strong>${Number(profile.density).toFixed(1)}</strong></span><span>Resistencia <strong>${Number(profile.endurance).toFixed(1)}</strong></span></div>`:'';
    const html=`<div class="obra-premium-section-title">Dificultad técnica</div><div class="obra-difficulty-hero"><strong>${result.score.toFixed(1)}</strong><span>${model.label(result.score)}</span></div><p class="obra-difficulty-note">Escala 1–10 no lineal. Mide preparación técnico-motriz y cognitiva; no profundidad musical.</p>${profileHtml}<div class="obra-difficulty-foot">${model.sourceLabel(result.source)} · confianza ${model.confidenceLabel(result.confidence)}</div>`;
    if(detail.innerHTML!==html)detail.innerHTML=html;
  }else if(detail&&input)detail.remove();
}
function observePremium(){const overlay=document.getElementById('obraPremiumOverlay');if(!overlay||observer)return;observer=new MutationObserver(()=>requestAnimationFrame(syncPremium));observer.observe(overlay,{childList:true,subtree:true});}
function patchPremium(){
  if(typeof window.openPremiumWork!=='function'||window.openPremiumWork.__difficultyModel)return false;
  const original=window.openPremiumWork;
  const patched=function(id){activeWorkId=id;const work=workById(id),model=window.WorkDifficultyModel;if(work&&model)model.enrichEntity(work);const result=original.apply(this,arguments);observePremium();setTimeout(syncPremium,0);return result;};
  patched.__difficultyModel=true;patched.__original=original;window.openPremiumWork=patched;return true;
}
function installManualCapture(){
  if(document.documentElement.dataset.difficultyManualCapture)return;document.documentElement.dataset.difficultyManualCapture='1';
  document.addEventListener('click',event=>{
    const save=event.target&&event.target.closest&&event.target.closest('#obraPremiumOverlay [data-action="save"]');if(!save||!activeWorkId)return;
    const input=document.getElementById('obraPremiumDifficulty'),score=Number(input&&input.value),work=workById(activeWorkId);if(!work||!Number.isFinite(score)||score<1||score>10)return;
    work.dificultad=Math.round(score*10)/10;work.dificultadFuente='manual';work.dificultadConfianza='high';work.dificultadModelo=window.WorkDifficultyModel&&window.WorkDifficultyModel.MODEL_VERSION;work.dificultadCarga=window.WorkDifficultyModel?Math.round(window.WorkDifficultyModel.loadFor(work.dificultad)*10)/10:null;
  },true);
}
function boot(attempt=0){
  const model=window.WorkDifficultyModel;if(!model){if(attempt<100)setTimeout(()=>boot(attempt+1),60);return;}
  patchCatalog();enrichAll();patchSave();patchReadiness();patchPremium();installManualCapture();observePremium();
  try{if(typeof window.renderObras==='function')window.renderObras();}catch(e){} try{if(typeof window.updateCronoReadiness==='function')window.updateCronoReadiness();}catch(e){}
  setTimeout(()=>{patchCatalog();patchReadiness();patchPremium();},250);
}
window.addEventListener('work-difficulty-model-ready',()=>boot(0),{once:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot(0),{once:true});else boot(0);
})();
