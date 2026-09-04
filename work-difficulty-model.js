/* Dificultad técnica de preparación · escala 1–10 decimal y no lineal.
 * Mide coste técnico/cognitivo para llevar una obra a un estado estable de concierto.
 * No pretende medir profundidad musical ni "dificultad de interpretarla genial".
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.WorkDifficultyModel=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';

const MODEL_VERSION='technical-preparation-v1';
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(Number(n))?Number(n):lo));
const round1=n=>Math.round(Number(n)*10)/10;
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[’‘´`]/g,"'").replace(/[º°]/g,'o').replace(/[–—−]/g,'-')
  .replace(/\bno\.\s*/g,'no ').replace(/\bn\.\s*/g,'no ').replace(/\s+/g,' ').trim();

function loadFor(score){
  const s=clamp(score,1,10);
  return Math.pow(2,(s-1)/2);
}
function scoreForLoad(load){
  const l=Math.max(1e-6,Number(load)||1);
  return clamp(1+2*(Math.log(l)/Math.log(2)),1,10);
}
function relativeFactor(score,reference=7,exponent=.55){
  const ratio=loadFor(score)/loadFor(reference);
  return clamp(Math.pow(ratio,exponent),.42,2.25);
}
function label(score){
  const s=num(score); if(s==null) return 'Sin estimar';
  if(s<3.5) return 'Intermedia';
  if(s<5.5) return 'Avanzada';
  if(s<6.8) return 'Avanzada alta';
  if(s<8) return 'Superior';
  if(s<9) return 'Profesional difícil';
  if(s<9.5) return 'Virtuosismo extremo';
  return 'Excepcional';
}
function confidenceLabel(value){ return value==='high'?'alta':value==='medium'?'media':'baja'; }
function sourceLabel(value){
  const labels={manual:'Tu valoración',curated:'Catálogo curado','catalog-rule':'Estimación por repertorio','derived-work':'Derivada de la obra',legacy:'Valor antiguo'};
  return labels[value]||'Estimación';
}
function aggregateMovements(items){
  const valid=(items||[]).map(item=>{
    const score=num(item&&item.score); if(score==null) return null;
    const duration=Math.max(.25,num(item.duration)||1);
    return {score:clamp(score,1,10),duration};
  }).filter(Boolean);
  if(!valid.length) return null;
  const total=valid.reduce((s,x)=>s+x.duration,0);
  const avg=valid.reduce((s,x)=>s+loadFor(x.score)*x.duration,0)/total;
  const max=Math.max(...valid.map(x=>loadFor(x.score)));
  return round1(scoreForLoad(.65*avg+.35*max));
}

const EXACT=[];
const add=(composer,title,score,movements=null,confidence='high',profile=null)=>EXACT.push({composer,title,score,movements,confidence,profile});

add(/albeniz/i,/triana|iberia.*triana/i,8.9,null,'high',{digital:8.8,coordination:8.5,spatial:8.7,density:8.4,endurance:8.5});
add(/albeniz/i,/el puerto/i,8.2);
add(/bach/i,/bwv\s*874|re mayor.*clave.*ii/i,7.2);
add(/bach/i,/bwv\s*893|si menor.*clave.*ii/i,6.9);
add(/bach/i,/bwv\s*885|sol menor.*clave.*ii/i,7.2);
add(/bach/i,/suite inglesa.*2|bwv\s*807/i,7.1,[7.5,5.9,6.1,5.4,6.0,7.3]);
add(/bach/i,/partita.*2|bwv\s*826/i,7.3,[6.8,5.9,6.1,5.5,7.2,7.4]);
add(/beethoven/i,/concierto.*3|op\.?\s*37/i,7.9,[8.2,6.4,8.1]);
add(/beethoven/i,/op\.?\s*129|penique|rondo a capriccio/i,7.3);
add(/beethoven/i,/sonata.*11|op\.?\s*22/i,7.5,[7.7,6.0,6.9,7.8]);
add(/beethoven/i,/waldstein|sonata.*21|op\.?\s*53/i,8.6,[8.8,5.0,8.9],'high',{digital:8.7,coordination:8.4,spatial:8.5,density:7.8,endurance:8.3});
add(/beethoven/i,/sonata.*32|op\.?\s*111/i,8.8,[8.4,8.9]);
add(/beethoven/i,/violonchelo.*3|cello.*3|op\.?\s*69/i,7.0,[7.2,6.7,7.1],'medium');
add(/beethoven/i,/sonata.*14|op\.?\s*27.*2|claro de luna/i,7.7,[5.2,4.8,8.5]);
add(/beethoven/i,/sonata.*8|op\.?\s*13|patet/i,7.6,[7.7,5.4,7.4]);
add(/brahms/i,/sonata.*1|op\.?\s*1\b/i,8.3,[8.4,7.0,7.7,8.7]);
add(/brahms/i,/violonchelo.*2|cello.*2|op\.?\s*99/i,7.8,[8.0,7.4,7.7,7.2],'medium');
add(/brahms/i,/trio.*1|op\.?\s*8\b/i,8.0,[8.2,7.6,6.6,8.0],'medium');
add(/chopin/i,/op\.?\s*10.*no\.?\s*1\b|estudio.*do mayor.*10.*1/i,9.1);
add(/chopin/i,/op\.?\s*10.*no\.?\s*3\b|estudio.*mi mayor.*10.*3/i,7.6);
add(/chopin/i,/op\.?\s*10.*no\.?\s*10\b/i,8.6);
add(/chopin/i,/op\.?\s*10.*no\.?\s*12\b|revolucion/i,8.2);
add(/chopin/i,/op\.?\s*25.*no\.?\s*1\b/i,7.7);
add(/chopin/i,/op\.?\s*25.*no\.?\s*9\b/i,7.6);
add(/chopin/i,/op\.?\s*25.*no\.?\s*11\b|viento de invierno/i,9.2);
add(/chopin/i,/balada.*4|op\.?\s*52/i,9.2);
add(/chopin/i,/scherzo.*1|op\.?\s*20/i,8.4);
add(/chopin/i,/polonesa.*44|op\.?\s*44/i,8.4);
add(/chopin/i,/preludio.*23|op\.?\s*28.*23/i,5.9,null,'medium');
add(/chopin/i,/preludio.*24|op\.?\s*28.*24/i,8.2);
add(/debussy/i,/reflets|reflejos.*agua/i,8.2);
add(/debussy/i,/cathedrale|catedral sumergida/i,6.8);
add(/debussy/i,/general lavine/i,7.0);
add(/debussy/i,/bruyeres/i,5.8);
add(/gershwin/i,/rhapsody in blue/i,8.3);
add(/haydn/i,/xvi[:.\s-]*23/i,6.0,[6.1,5.7,5.9],'medium');
add(/haydn/i,/xvi[:.\s-]*33/i,6.2,[6.3,5.8,6.2],'medium');
add(/haydn/i,/xvi[:.\s-]*50/i,7.3,[7.5,6.4,7.1]);
add(/haydn/i,/xviii[:.\s-]*11|concierto.*11/i,6.5,[6.5,5.5,6.3],'medium');
add(/kapral|kaprál/i,/preludios.*abril|april preludes|op\.?\s*13/i,6.6,[6.2,6.9],'medium');
add(/ligeti/i,/galamb borong|etude.*7/i,9.4,null,'high',{digital:8.7,coordination:9.8,spatial:8.1,density:9.2,endurance:8.5});
add(/liszt/i,/mazeppa|transcendental.*4/i,9.2);
add(/liszt/i,/harmonies du soir|transcendental.*11/i,8.7);
add(/liszt/i,/rapsodia.*12|hungarian rhapsody.*12|s\.?244\/12/i,9.0);
add(/liszt/i,/vallee d.?obermann|valle de obermann|s\.?160\/6/i,8.3);
add(/mozart/i,/k\.?\s*576|sonata.*18/i,7.8,[7.9,6.8,7.8]);
add(/mozart/i,/k\.?\s*331|sonata.*11/i,6.4,[5.8,5.6,7.1]);
add(/mozart/i,/k\.?\s*310|sonata.*8/i,7.5,[7.6,6.2,7.4]);
add(/mozart/i,/k\.?\s*450|concierto.*15/i,7.8,[7.9,6.3,7.7]);
add(/mussorg/i,/cuadros|pictures at an exhibition/i,8.3);
add(/prokofiev/i,/sonata.*7|op\.?\s*83/i,8.9,[8.8,7.8,9.4],'high',{digital:9.1,coordination:8.7,spatial:8.8,density:8.8,endurance:9.0});
add(/rachmaninov|rachmaninoff/i,/concierto.*3|op\.?\s*30\b/i,9.7,[9.7,9.1,9.8],'high',{digital:9.8,coordination:9.5,spatial:9.6,density:9.7,endurance:9.9});
add(/rachmaninov|rachmaninoff/i,/concierto.*2|op\.?\s*18\b/i,8.8,[8.8,7.4,8.8]);
add(/rachmaninov|rachmaninoff/i,/op\.?\s*39.*no\.?\s*3\b/i,8.9);
add(/rachmaninov|rachmaninoff/i,/op\.?\s*33.*no\.?\s*3\b/i,7.8,null,'medium');
add(/rachmaninov|rachmaninoff/i,/op\.?\s*33.*no\.?\s*5\b/i,8.0,null,'low');
add(/rachmaninov|rachmaninoff/i,/op\.?\s*33.*no\.?\s*6\b/i,8.3,null,'medium');
add(/rachmaninov|rachmaninoff/i,/momentos.*op\.?\s*16|moments musicaux.*16/i,8.1,[7.6,7.8,6.8,8.8,6.8,8.3]);
add(/rachmaninov|rachmaninoff/i,/preludio.*23.*4/i,6.8);
add(/rachmaninov|rachmaninoff/i,/preludio.*23.*5/i,8.1);
add(/rachmaninov|rachmaninoff/i,/preludio.*32.*5/i,6.5);
add(/rachmaninov|rachmaninoff/i,/corelli|op\.?\s*42/i,8.2);
add(/ravel/i,/jeux d.?eau|juegos de agua/i,8.3);
add(/scarlatti/i,/k\.?\s*502\b/i,7.2,null,'medium');
add(/scarlatti/i,/k\.?\s*1\b/i,5.5,null,'medium');
add(/schumann/i,/concierto.*op\.?\s*54|piano concerto.*54/i,8.1,[8.3,6.6,8.2]);
add(/schumann/i,/estudios sinfonicos|symphonic etudes|op\.?\s*13/i,8.9);
add(/scriabin/i,/op\.?\s*8.*12|patet/i,8.6);
add(/scriabin/i,/op\.?\s*42.*5/i,9.0);
add(/scriabin/i,/poeme.*nocturne|poema.*nocturno|op\.?\s*61/i,8.2);
add(/tchaikov/i,/concierto.*1|op\.?\s*23/i,9.0,[9.2,7.2,8.9],'high',{digital:9.0,coordination:8.6,spatial:9.2,density:8.7,endurance:9.2});

const BEETHOVEN_SONATAS=[6.7,6.8,7.7,7.7,6.5,6.2,7.4,7.6,5.9,5.8,7.5,7.0,6.6,7.7,6.8,7.3,7.8,7.5,4.7,4.9,8.6,7.3,8.7,6.8,5.5,7.6,7.3,8.2,9.8,8.4,8.5,8.8];
const MOZART_SONATAS=[5.6,5.7,5.9,5.3,5.5,6.5,6.2,7.5,6.3,5.7,6.4,6.3,6.7,7.4,7.1,5.0,6.3,7.8];
const CHOPIN_OP10=[9.1,8.1,7.6,8.8,8.7,8.9,8.5,8.4,8.6,8.6,8.0,8.2];
const CHOPIN_OP25=[7.7,8.8,7.8,8.3,8.0,9.0,8.9,8.2,7.6,8.7,9.2,8.9];
const LISZT_TRANSC=[7.8,8.6,6.4,9.2,9.5,8.3,8.5,9.1,8.0,8.7,8.7,9.3];
const SCHUBERT_SONATA_BY_D={'664':6.4,'784':6.8,'840':7.2,'845':7.3,'850':7.8,'894':7.1,'958':8.0,'959':8.1,'960':7.8};
function numberMatch(text,patterns){ for(const pattern of patterns){const m=text.match(pattern);if(m)return Number(m[1]);} return null; }
function familyEstimate(work){
  const composer=norm(work&&work.composer);
  const title=norm([work&&work.name,work&&work.title,work&&work.catalog,work&&work.catalogue].filter(Boolean).join(' '));
  if(!title) return null;
  if(/beethoven/.test(composer)&&/sonata/.test(title)){const n=numberMatch(title,[/sonata(?: para piano)?(?: no)?\s*(\d+)/,/piano sonata(?: no)?\s*(\d+)/]);if(n&&BEETHOVEN_SONATAS[n-1])return{score:BEETHOVEN_SONATAS[n-1],confidence:'medium'};}
  if(/mozart/.test(composer)&&/sonata/.test(title)){const n=numberMatch(title,[/sonata(?: para piano)?(?: no)?\s*(\d+)/,/piano sonata(?: no)?\s*(\d+)/]);if(n&&MOZART_SONATAS[n-1])return{score:MOZART_SONATAS[n-1],confidence:'medium'};}
  if(/chopin/.test(composer)&&/(?:etude|estudio)/.test(title)){const op=numberMatch(title,[/op\s*(10|25)/]);const no=numberMatch(title,[/no\s*(\d+)/]);const list=op===10?CHOPIN_OP10:op===25?CHOPIN_OP25:null;if(list&&no&&list[no-1])return{score:list[no-1],confidence:'high'};}
  if(/liszt/.test(composer)&&/transcend|execution transcendante/.test(title)){const no=numberMatch(title,[/no\s*(\d+)/,/transcendental etude\s*(\d+)/]);if(no&&LISZT_TRANSC[no-1])return{score:LISZT_TRANSC[no-1],confidence:'high'};}
  if(/schubert/.test(composer)&&/sonata/.test(title)){const d=title.match(/\bd\s*([0-9]{3})\b/);if(d&&SCHUBERT_SONATA_BY_D[d[1]])return{score:SCHUBERT_SONATA_BY_D[d[1]],confidence:'medium'};}
  let score=null,confidence='low';
  if(/bach/.test(composer)){if(/well-tempered|clave bien temperado|prelude and fugue|preludio y fuga/.test(title))score=6.7;else if(/partita|english suite|suite inglesa/.test(title))score=6.9;else if(/french suite|suite francesa/.test(title))score=5.9;else if(/goldberg/.test(title))score=8.2;else score=6.4;}
  else if(/haydn/.test(composer))score=/sonata/.test(title)?6.0:6.3;
  else if(/chopin/.test(composer)){if(/ballade|balada/.test(title))score=8.8;else if(/scherzo/.test(title))score=8.5;else if(/polonaise|polonesa/.test(title))score=8.1;else if(/sonata/.test(title))score=8.6;else if(/nocturne|nocturno/.test(title))score=6.3;else score=7.2;}
  else if(/liszt/.test(composer)){if(/sonata/.test(title))score=9.3;else if(/mephisto/.test(title))score=9.0;else if(/funerailles/.test(title))score=8.4;else if(/liebestraum/.test(title))score=6.4;else score=8.2;}
  else if(/schumann/.test(composer)){if(/toccata/.test(title))score=9.1;else if(/fantaisie|fantasia/.test(title))score=8.8;else if(/kreisleriana|carnaval|davids/.test(title))score=8.4;else if(/kinderszenen|arabeske/.test(title))score=5.4;else score=7.5;}
  else if(/brahms/.test(composer)){if(/paganini/.test(title))score=9.4;else if(/handel/.test(title))score=8.8;else if(/sonata/.test(title))score=8.4;else score=7.4;}
  else if(/schubert/.test(composer)){if(/wanderer/.test(title))score=9.0;else if(/impromptu/.test(title))score=6.7;else score=6.5;}
  else if(/debussy/.test(composer)){if(/isle joyeuse/.test(title))score=8.5;else if(/jardins sous la pluie/.test(title))score=8.2;else if(/prelude|preludes/.test(title))score=6.7;else score=7.0;}
  else if(/ravel/.test(composer)){if(/gaspard/.test(title))score=9.4;else if(/miroirs/.test(title))score=8.4;else if(/sonatine/.test(title))score=6.8;else score=7.8;}
  else if(/rachmaninov|rachmaninoff/.test(composer)){if(/concerto|concierto/.test(title))score=9.0;else if(/etude|estudio/.test(title))score=8.4;else if(/prelude|preludio/.test(title))score=7.4;else score=8.0;}
  else if(/prokofiev/.test(composer)){if(/sonata/.test(title))score=8.7;else if(/etude|estudio/.test(title))score=8.5;else if(/sarcasm/.test(title))score=8.4;else score=7.8;}
  else if(/scriabin/.test(composer)){if(/etude|estudio/.test(title))score=8.3;else if(/sonata/.test(title))score=8.5;else score=7.7;}
  else if(/scarlatti/.test(composer))score=6.4;
  else if(/tchaikov/.test(composer))score=/concerto|concierto/.test(title)?8.9:7.8;
  else if(/mendelssohn/.test(composer))score=6.6;
  else if(/faure|fauré/.test(composer))score=6.5;
  else if(/bartok|bartók/.test(composer))score=7.3;
  else if(/granados/.test(composer))score=8.0;
  else if(/albeniz|albéniz/.test(composer))score=8.2;
  else if(/ligeti/.test(composer))score=/etude|estudio/.test(title)?9.0:8.2;
  return score==null?null:{score:round1(score),confidence};
}
function exactMatch(work){
  const composer=norm(work&&work.composer);
  const title=norm([work&&work.name,work&&work.title,work&&work.catalog,work&&work.catalogue].filter(Boolean).join(' '));
  for(const item of EXACT){
    item.composer.lastIndex=0; item.title.lastIndex=0;
    if(item.composer.test(composer)&&item.title.test(title)){
      const movementScores=(item.movements||[]).map(Number).filter(Number.isFinite);
      const derived=movementScores.length&&Array.isArray(work&&work.movimientos)&&work.movimientos.length?aggregateMovements(work.movimientos.map((mov,index)=>({score:movementScores[index]??item.score,duration:num(mov.duracion)||1}))):null;
      return{score:round1(derived??item.score),source:'curated',confidence:item.confidence||'high',model:MODEL_VERSION,movementScores:item.movements?item.movements.slice():null,profile:item.profile||null};
    }
  }
  return null;
}
function manualValue(entity){
  if(!entity)return null;
  const source=String(entity.dificultadFuente||entity.difficultySource||'').toLowerCase();
  const score=num(entity.dificultad??entity.difficulty);
  if(score!=null&&source==='manual')return{score:round1(clamp(score,1,10)),source:'manual',confidence:'high',model:MODEL_VERSION,movementScores:null,profile:entity.dificultadPerfil||null};
  return null;
}
function resolve(work){
  if(!work||String(work.tipo||'obra')==='actividad')return null;
  const manual=manualValue(work);if(manual)return manual;
  const exact=exactMatch(work);if(exact)return exact;
  const family=familyEstimate(work);if(family)return{score:round1(family.score),source:'catalog-rule',confidence:family.confidence||'low',model:MODEL_VERSION,movementScores:null,profile:null};
  const legacy=num(work.dificultad??work.difficulty);if(legacy!=null)return{score:round1(clamp(legacy,1,10)),source:'legacy',confidence:'low',model:MODEL_VERSION,movementScores:null,profile:null};
  return null;
}
function resolveMovement(work,movement,index){
  const manual=manualValue(movement);if(manual)return manual;
  const wr=resolve(work);if(!wr)return null;
  const explicit=wr.movementScores&&num(wr.movementScores[index]);
  if(explicit!=null)return{score:round1(explicit),source:'curated',confidence:wr.confidence,model:MODEL_VERSION,derived:false};
  const own=num(movement&&(movement.dificultad??movement.difficulty));const source=String(movement&&(movement.dificultadFuente||movement.difficultySource)||'').toLowerCase();
  if(own!=null&&source&&source!=='manual')return{score:round1(clamp(own,1,10)),source,confidence:movement.dificultadConfianza||'low',model:MODEL_VERSION,derived:source==='derived-work'};
  return{score:wr.score,source:'derived-work',confidence:'low',model:MODEL_VERSION,derived:true};
}
function enrichEntity(work){
  const result=resolve(work);if(!result)return{changed:false,result:null};let changed=false;
  if(result.source!=='manual'){
    const assign=(key,value)=>{if(JSON.stringify(work[key])!==JSON.stringify(value)){work[key]=value;changed=true;}};
    assign('dificultad',result.score);assign('dificultadFuente',result.source);assign('dificultadConfianza',result.confidence);assign('dificultadModelo',MODEL_VERSION);assign('dificultadCarga',round1(loadFor(result.score)));if(result.profile)assign('dificultadPerfil',result.profile);
  }
  if(Array.isArray(work.movimientos))work.movimientos.forEach((movement,index)=>{const mr=resolveMovement(work,movement,index);if(!mr||mr.source==='manual')return;const set=(key,value)=>{if(JSON.stringify(movement[key])!==JSON.stringify(value)){movement[key]=value;changed=true;}};set('dificultad',mr.score);set('dificultadFuente',mr.source);set('dificultadConfianza',mr.confidence);set('dificultadModelo',MODEL_VERSION);set('dificultadCarga',round1(loadFor(mr.score)));});
  return{changed,result};
}
function decorateCatalogResult(item){
  if(!item)return item;const result=resolve({composer:item.composer,name:item.title||item.name,catalog:item.catalog});
  return result?Object.assign({},item,{difficulty:result.score,difficultySource:result.source,difficultyConfidence:result.confidence,difficultyModel:MODEL_VERSION}):item;
}
function patchWorkCatalog(){
  const catalog=root.WorkCatalog;if(!catalog||catalog.__difficultyPatched)return false;
  ['search','all','getAll'].forEach(method=>{if(typeof catalog[method]!=='function'||catalog[method].__difficultyPatched)return;const original=catalog[method].bind(catalog);const patched=function(){const result=original.apply(catalog,arguments);return Array.isArray(result)?result.map(decorateCatalogResult):decorateCatalogResult(result);};patched.__difficultyPatched=true;patched.__original=original;catalog[method]=patched;});
  catalog.__difficultyPatched=true;return true;
}
// Shared by the browser and report Worker, after the pill/recovery models.
// Installing twice must not multiply recovery cost twice.
function installReadiness(core){
  if(!core||typeof core.estimateReadiness!=='function')return false;
  if(core.estimateReadiness.__technicalDifficultyModel)return true;
  const previous=core.estimateReadiness.bind(core);
  const patched=function(dbValue,obraId,options){
    const result=previous(dbValue,obraId,options);if(!result)return result;
    const work=(dbValue&&dbValue.obras||[]).find(item=>String(item&&item.id)===String(obraId));
    const difficulty=api.resolve(work);if(!work||!difficulty)return result;
    const own=Number(result.diagnostics&&result.diagnostics.speed&&result.diagnostics.speed.ownIntervals)||0;
    const exponent=own>=2?.22:own===1?.38:.55;
    const factor=relativeFactor(difficulty.score,7,exponent);
    const scale=value=>value!=null&&Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value)*factor)):value;
    const calendar=result.calendarEstimate?{...result.calendarEstimate,lowDays:Math.max(1,Math.ceil(Number(result.calendarEstimate.lowDays||0)*factor)),highDays:Math.max(1,Math.ceil(Number(result.calendarEstimate.highDays||0)*factor))}:result.calendarEstimate;
    const factors=Array.from(new Set([...(Array.isArray(result.factors)?result.factors:[]),`dificultad técnica ${difficulty.score.toFixed(1)}/10`]));
    return{...result,pointEstimateMinutes:scale(result.pointEstimateMinutes),lowMinutes:scale(result.lowMinutes),highMinutes:scale(result.highMinutes),calendarEstimate:calendar,factors,diagnostics:{...(result.diagnostics||{}),technicalDifficulty:{score:difficulty.score,label:label(difficulty.score),source:difficulty.source,confidence:difficulty.confidence,rawLoad:loadFor(difficulty.score),factor,reference:7,exponent,model:MODEL_VERSION}}};
  };
  patched.__technicalDifficultyModel=true;patched.__previous=previous;core.estimateReadiness=patched;return true;
}
const api={MODEL_VERSION,loadFor,scoreForLoad,relativeFactor,label,confidenceLabel,sourceLabel,aggregateMovements,resolve,resolveMovement,enrichEntity,decorateCatalogResult,patchWorkCatalog,installReadiness};
if(root&&root.dispatchEvent&&typeof CustomEvent==='function')setTimeout(()=>root.dispatchEvent(new CustomEvent('work-difficulty-model-ready')),0);
return api;
});
