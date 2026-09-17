/* Deutsch owns db.germanStudy and rebuilds the shared ledger from piano reward evidence. */
(function(root) {
  'use strict';
  const R=root.GermanRewards, P=root.PianoRewards, S=root.GermanSRS, I=root.GermanImport, T=root.GermanSession;
  const MIN=R.CONFIG.minimumSeconds, CAP=R.CONFIG.curve.at(-1)[0], MIN_LABEL=(MIN/60)+' min';
  const state=()=>T.ensure(db), uid=()=>crypto.randomUUID();
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const euro=(n,digits=2)=>Number(n).toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits})+' €';
  const time=n=>{n=Math.floor(n || 0);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
  const minutes=n=>Math.floor((n || 0)/60)+' min';
  const interval=n=>n<1?(Math.max(1,Math.round(n*1440))+' min'):n<2?'1 día':Math.round(n)+' días';
  const typeLabels={de_es:'Alemán → español',es_de:'Español → alemán',expression:'Expresión',grammar:'Estructura gramatical',question_answer:'Pregunta y respuesta',cloze:'Completa el hueco',fill_blank:'Completa el hueco',translation:'Traducción',conjugation:'Conjugación',short_answer:'Respuesta breve',free_write:'Escritura libre'};
  let deviceId, activeId=null, panel='dashboard', editingGoalId=null, deletingGoalId=null, lastTick=Date.now(), lastInteraction=Date.now(), lastSave=0;
  let releaseLock=null, ownsLock=false, busy=false, qualifiedBefore=false, error='';
  const lockToken=uid();
  try {deviceId=localStorage.getItem('german_device_v1');if (!deviceId) {deviceId=uid();localStorage.setItem('german_device_v1',deviceId);}} catch {deviceId=uid();}
  const current=()=>state().sessions.find(s=>s.id===activeId && !s.endedAt);
  const entries=(goals=state().goals)=>{
    const german=R.ledger(state().sessions,goals);
    return P?P.combinedLedger(german,P.ledger(P.studyState(db).sessions,goals),goals):german;
  };
  function activeGoal() {
    // Concurrent offline creations are queued deterministically, never both active.
    return state().goals.filter(g=>!g.archivedAt&&!g.deletedAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))[0];
  }
  function sharedGoalSessionActive(goalId) {
    const germanActive=state().sessions.some(s=>s.goalId===goalId&&!s.endedAt);
    const pianoActive=root.crono && root.crono.state!=='idle' && !root.crono.isRest && root.crono.rewardGoalId===goalId;
    return Boolean(germanActive || pianoActive);
  }
  function message(text) { error=text;const el=document.getElementById('germanError');if(el) {el.textContent=text;el.hidden=!text;} }
  function persist() {
    state().ledger=entries();
    if (saveData()===false) {const s=current();if(s) s.status='paused';if(panel==='study')render();throw new Error('No se ha podido guardar. La sesión está pausada; libera espacio y pulsa Reintentar guardado.');}
    if(typeof root.cronoUpdatePianoReward==='function')root.cronoUpdatePianoReward();
    lastSave=Date.now();
  }
  async function lock() {
    if (ownsLock) return true;
    if (navigator.locks) return new Promise((resolve,reject)=> {
      navigator.locks.request('german-study-session-v1',{ifAvailable:true},async acquired=> {
        if (!acquired) {resolve(false);return;}
        ownsLock=true;resolve(true);
        await new Promise(done=>{releaseLock=done;});
        ownsLock=false;
      }).catch(reject);
    });
    // Older browsers: short renewable lease. Suspended tabs cannot add unobserved time.
    const lease=JSON.parse(localStorage.getItem('german_lease_v1') || 'null');
    if (lease && lease.until>Date.now() && lease.token!==lockToken) return false;
    localStorage.setItem('german_lease_v1',JSON.stringify({token:lockToken,until:Date.now()+15000}));
    ownsLock=JSON.parse(localStorage.getItem('german_lease_v1')).token===lockToken;
    return ownsLock;
  }
  function unlock() {
    releaseLock?.();releaseLock=null;ownsLock=false;
    if (!navigator.locks) try {const lease=JSON.parse(localStorage.getItem('german_lease_v1') || 'null');if(lease?.token===lockToken)localStorage.removeItem('german_lease_v1');} catch {}
  }
  function visible() {return !document.hidden && document.body.dataset.view==='deutsch' && panel==='study';}
  function advance(now=Date.now()) {
    const s=current();if (!s || !ownsLock || s.status!=='running') {lastTick=now;return;}
    if (!navigator.locks) {
      const lease=JSON.parse(localStorage.getItem('german_lease_v1') || 'null');
      if (lease?.token!==lockToken) {s.status='paused';ownsLock=false;render();return;}
      localStorage.setItem('german_lease_v1',JSON.stringify({token:lockToken,until:now+15000}));
    }
    const running=T.tick(s,{now,lastTick,lastInteraction,visible:visible(),allowBackground:s.mode==='free'});lastTick=now;
    const qualified=(R.summarizeDays(state().sessions)[R.dayKey()] || 0)>=R.CONFIG.minimumSeconds;
    if (!running || now-lastSave>=10000 || qualified!==qualifiedBefore) persist();
    if (qualified && !qualifiedBefore) {
      document.getElementById('germanMeter')?.classList.add('qualified');
      const el=document.getElementById('germanMilestone');if(el)el.textContent='¡'+MIN_LABEL+'! Día conseguido y recompensa consolidada.';
    }
    qualifiedBefore=qualified;
    if (!running) render();
  }
  function pause() {const s=current();if(s && ownsLock) {advance();s.status='paused';persist();} }
  function goalCard(goal,ledger) {
    if (!goal) return `<section class="german-card german-goal" id="germanSharedGoal"><span class="german-eyebrow">TU PRÓXIMO OBJETIVO</span><h2>Un motivo para volver mañana.</h2><p>Convierte tu alemán y tu piano en una hucha virtual. Tú eliges la recompensa.</p>${goalForm()}</section>`;
    if (editingGoalId===goal.id) return `<section class="german-card german-goal is-editing" id="germanSharedGoal"><span class="german-eyebrow">EDITAR OBJETIVO COMPARTIDO</span><h2>Ajusta el nombre o el precio.</h2><p>Recalculamos las mismas horas con el nuevo precio. Al bajar el precio, los euros acumulados también bajan, pero cubren una mayor parte de la compra.</p>${goalForm(goal)}</section>`;
    if (deletingGoalId===goal.id) {
      const blocked=sharedGoalSessionActive(goal.id);
      return `<section class="german-card german-goal is-deleting" id="germanSharedGoal"><span class="german-eyebrow">ELIMINAR OBJETIVO</span><h2>¿Eliminar ${esc(goal.name)}?</h2><p>El objetivo y su saldo dejarán de aparecer. Las sesiones de alemán y piano se conservan en el historial interno.</p>${blocked?'<p class="german-goal-warning">Termina primero la sesión que está aportando a este objetivo.</p>':''}<div class="german-goal-confirm"><button data-action="cancel-delete-goal">Cancelar</button><button class="german-danger" data-action="confirm-delete-goal" data-id="${esc(goal.id)}" ${blocked?'disabled':''}>Eliminar definitivamente</button></div></section>`;
    }
    const progress=R.goalProgress(goal,ledger,state().sessions), percent=Math.min(100,progress.amount/goal.amount*100);
    return `<section class="german-card german-goal" id="germanSharedGoal"><span class="german-eyebrow">${progress.complete?'OBJETIVO CONSEGUIDO ✨':'TU OBJETIVO COMPARTIDO'}</span><h2>${esc(goal.name)}</h2><div class="german-balance">${euro(progress.amount)} <small>/ ${euro(goal.amount)}</small></div><progress aria-label="Progreso del objetivo" max="100" value="${percent}"></progress><p>${percent.toFixed(1).replace('.',',')} % · Alemán y piano aportan a este objetivo</p><p class="german-goal-reserved">Saldo reservado exclusivamente para ${esc(goal.name)}. No se reparte entre compras ni se traslada a otro objetivo.</p><div class="german-goal-actions"><button data-action="edit-goal" data-id="${esc(goal.id)}">Editar objetivo</button><button class="german-danger-link" data-action="delete-goal" data-id="${esc(goal.id)}">Eliminar objetivo</button>${progress.complete?`<button data-action="archive" ${sharedGoalSessionActive(goal.id)?'disabled':''}>Archivar y crear otro objetivo</button>`:''}</div>${progress.complete?`<p>Conseguido el ${esc(progress.completedOn)} · ${minutes(progress.seconds)} de estudio invertidos.</p>${sharedGoalSessionActive(goal.id)?'<p>Termina la sesión antes de archivar.</p>':''}`:''}</section>`;
  }
  function goalForm(goal=null) {return `<form id="germanGoalForm" class="german-form"${goal?` data-goal-id="${esc(goal.id)}"`:''}><label>Nombre del objetivo<input name="name" required maxlength="80" placeholder="Kindle" autocomplete="off" value="${esc(goal?.name || '')}"></label><label>Importe (€)<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required value="${esc(goal?.amount ?? 150)}"></label>${goal?`<output id="germanGoalEquivalence" class="german-goal-equivalence" aria-live="polite">${goalEquivalence(goal,goal.amount,goal.name)}</output>`:''}<div class="german-goal-form-actions">${goal?'<button type="button" data-action="cancel-goal-edit">Cancelar</button>':''}<button class="german-primary" type="submit">${goal?'Guardar cambios':'Crear objetivo'}</button></div></form>`;}
  function goalEquivalence(goal,amount,name) {
    if(!Number.isFinite(amount) || amount<.01 || amount>1e8)return 'Introduce un precio válido para ver la equivalencia.';
    const updated={...goal,amount:Math.round(amount*100)/100};
    const goals=state().goals.map(g=>g.id===goal.id?updated:g);
    const before=R.goalProgress(goal,entries(),state().sessions);
    const after=R.goalProgress(updated,entries(goals),state().sessions);
    const percent=Math.min(100,after.amount/updated.amount*100);
    return `<span>Mismas sesiones · nuevo precio</span><strong>${euro(before.amount)} → ${euro(after.amount)} de ${euro(updated.amount)}</strong><small>${percent.toFixed(1).replace('.',',')} %${after.complete?' · Objetivo conseguido':''} · Solo para ${esc(name || goal.name)}. El saldo se limita al precio; no hay sobrante transferible.</small>`;
  }
  function deckStats(material) {
    const states=material.cards.map(c=>S.cardState(c.id,state().reviews)),now=Date.now();
    return {newCount:states.filter(s=>!s.reviews).length,dueCount:states.filter(s=>s.nextReview && Date.parse(s.nextReview)<=now).length};
  }
  function importer() {
    return `<section class="german-card german-import"><div><span class="german-eyebrow">AÑADIR CONTENIDO</span><h2>Importar una clase</h2><p>Admite vocabulario, expresiones, estructuras, preguntas y tarjetas con huecos.</p></div><label class="german-file"><span>Elegir archivo .json o .csv</span><input id="germanImportFile" type="file" accept=".json,.csv,application/json,text/csv"></label><details><summary>Formato y prompt para la IA</summary><p>Hasta 2 MB y 2.000 elementos. El CSV usa front,back y puede añadir type, hint, explanation y tags.</p><div class="german-import-actions"><button data-action="example">Descargar ejemplo</button><button data-action="copy-prompt">Copiar prompt para IA</button></div><textarea id="germanPrompt" aria-label="Prompt para IA" readonly rows="8">${esc(I.AI_PROMPT)}</textarea></details></section>`;
  }
  function decks() {
    const materials=state().materials;
    return `<section class="german-decks"><div class="german-section-heading"><div><span class="german-eyebrow">POR CLASE O TEMA</span><h2>Tus tarjetas</h2></div><span>${materials.reduce((n,m)=>n+m.cards.length,0)} en total</span></div><div class="german-deck-grid">${materials.map((m,index)=>{const stats=deckStats(m),label=m.metadata.title || 'Clase '+(index+1);return `<article class="german-deck"><div class="german-deck-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</div><div class="german-deck-copy"><span class="german-eyebrow">${esc(m.metadata.date || 'CLASE '+(index+1))}</span><h3>${esc(label)}</h3><p>${m.cards.length} tarjetas · ${stats.dueCount} pendientes · ${stats.newCount} nuevas</p>${m.metadata.notes?`<small>${esc(m.metadata.notes)}</small>`:''}</div><button class="german-deck-study" data-action="material" data-id="${esc(m.id)}" ${m.cards.length?'':'disabled'}>Estudiar esta clase</button></article>`;}).join('') || '<div class="german-empty"><strong>Tu primera clase aparecerá aquí.</strong><p>Importa el archivo creado a partir de tus materiales y podrás empezar a repasarlo.</p></div>'}</div></section>`;
  }
  function dashboard() {
    const st=state(),today=R.dayKey(), totals=R.summarizeDays(st.sessions), streak=R.streakStats(st.sessions,today), ledger=entries(), goal=activeGoal();
    const visibleGoalIds=new Set(st.goals.filter(g=>!g.deletedAt).map(g=>g.id));
    const earned=ledger.filter(e=>e.date===today&&visibleGoalIds.has(e.goalId)).reduce((n,e)=>n+e.finalReward,0);
    const weekStart=R.shiftDay(today,-((new Date().getDay()+6)%7));
    const week=Object.entries(totals).filter(([d])=>d>=weekStart && d<=today).reduce((n,[,s])=>n+s,0);
    const cards=st.materials.flatMap(m=>m.cards);
    const states=cards.map(c=>S.cardState(c.id,st.reviews));
    const fresh=states.filter(s=>!s.reviews).length, due=states.filter(s=>s.nextReview && Date.parse(s.nextReview)<=Date.now()).length;
    const daySeconds=totals[today] || 0;
    const pending=totals[today]>0 && totals[today]<MIN;
    const session=current();
    return `<section class="german-launch"><div><span class="german-eyebrow">REPASO ESPACIADO</span><h1>Una app sencilla para recordar tu alemán.</h1><p>${due} tarjetas para repasar · ${fresh} nuevas. Elige todas o entra en una clase concreta.</p></div><div class="german-launch-actions"><button class="german-primary" data-action="${session?'resume':'start'}">${session?'Continuar sesión':'Estudiar tarjetas'}</button><button data-action="free" ${session?'disabled':''}>Estudio libre</button></div><p class="german-muted">En estudio libre puedes hacer fichas, escuchar alemán o trabajar fuera de la app. El mismo taxímetro seguirá contando.</p></section>
      <section class="german-dashboard-meter" aria-label="Resumen del taxímetro"><div><span>Hoy</span><strong>${time(totals[today])}</strong></div><div><span>Hucha de hoy</span><strong>${euro(earned,3)}${pending?' pendiente':''}</strong></div><div><span>Racha</span><strong>${streak.current} días</strong></div></section>
      ${decks()}${importer()}${goalCard(goal,ledger)}
      <details class="german-card german-history"><summary>Actividad e historial</summary><div class="german-activity" aria-label="Actividad de los últimos 14 días">${Array.from({length:14},(_,i)=>{const day=R.shiftDay(today,i-13),seconds=totals[day] || 0;return `<div class="${seconds>=MIN?'done':seconds?'partial':''}" title="${day}: ${minutes(seconds)}" aria-label="${day}: ${minutes(seconds)}"><span>${day.slice(8)}</span></div>`;}).join('')}</div><p class="german-muted">${st.reviews.filter(r=>r.cardId).length} tarjetas revisadas · ${minutes(week)} esta semana · mejor racha: ${streak.best} días.</p>${st.goals.filter(g=>g.archivedAt&&!g.deletedAt).map(g=>{const p=R.goalProgress(g,ledger,st.sessions);return `<p><strong>${esc(g.name)}</strong> · ${euro(p.amount)} / ${euro(g.amount)} · ${esc(p.completedOn || 'En progreso')}</p>`;}).join('')}<div class="german-ledger">${ledger.filter(e=>visibleGoalIds.has(e.goalId)).slice(-30).reverse().map(e=>`<p>${esc(e.date)} · ${e.source==='piano'?'Piano':'Alemán'} · ${minutes(e.duration)} · ${euro(e.finalReward,3)} ${e.qualified?'':'(pendiente)'}</p>`).join('')}</div><button data-action="export-ledger">Descargar historial completo</button></details>`;
  }
  function itemMarkup(s) {
    const item=s.queue[s.index], m=item && state().materials.find(m=>m.id===item.materialId);
    const content=item && m?.[item.kind==='card'?'cards':'exercises'].find(c=>c.id===item.contentId);
    if (!content) return `<div class="german-card german-study-content german-study-complete"><span aria-hidden="true">✓</span><h2>Repaso terminado</h2><p>Ya has visto las tarjetas de esta tanda. Puedes repetir o dejar que el algoritmo programe el siguiente repaso.</p><button data-action="more">Repasar otra tanda</button></div>`;
    const disabled=s.status!=='running' || !ownsLock?'disabled':'';
    const explanation=content.explanation?`<p class="german-explanation">${esc(content.explanation)}</p>`:'';
    const hint=content.hint?`<details><summary>Pista</summary><p>${esc(content.hint)}</p></details>`:'';
    const heading=`<div class="german-card-meta"><span class="german-eyebrow">${esc(m.metadata.title)}</span><span>${s.index+1} / ${s.queue.length}</span></div>`;
    if (item.kind==='card') {
      const previous=S.cardState(content.id,state().reviews),labels={again:'Otra vez',hard:'Difícil',good:'Bien',easy:'Fácil'};
      return `<article class="german-flashcard german-study-content ${s.revealed?'is-revealed':''}" ${s.revealed?'':'data-action="reveal" role="button" tabindex="0"'}>${heading}<div class="german-card-face"><span class="german-type">${esc(typeLabels[content.type] || content.type)}</span><h2>${esc(content.front)}</h2>${hint}${s.revealed?`<div class="german-answer"><h3>${esc(content.back)}</h3>${explanation}${(content.examples || []).map(e=>`<p>${esc(e)}</p>`).join('')}</div>`:'<p class="german-flip-hint">Pulsa la tarjeta o la barra espaciadora para darle la vuelta</p>'}</div>${s.revealed?`<div class="german-grades" aria-label="Califica tu recuerdo">${S.GRADES.map((g,i)=>{const next=S.schedule(previous,g);return `<button data-action="grade" data-id="${g}" ${disabled}><small>${i+1}</small><strong>${labels[g]}</strong><span>${interval(next.interval)}</span></button>`;}).join('')}</div>`:`<button class="german-primary german-reveal" data-action="reveal" ${disabled}>Mostrar respuesta</button>`}</article>`;
    }
    return `<article class="german-card german-study-content">${heading}<span class="german-type">${esc(typeLabels[content.type] || content.type)}</span><h2>${esc(content.prompt)}</h2>${hint}<label for="germanAnswer">Tu respuesta</label><textarea id="germanAnswer" rows="4" ${s.checked?'readonly':''}>${esc(s.draftAnswer || '')}</textarea>${s.checked?`<div class="german-answer"><h3>${content.type==='free_write'?'Solución modelo':s.correct?'Correcto ✓':'Revisa tu respuesta'}</h3><p>${esc(content.answer || content.acceptedAnswers?.join(' / '))}</p>${explanation}</div>${content.type==='free_write'?`<div class="german-grades">${[['correct','Correcto'],['partial','Parcial'],['incorrect','Incorrecto']].map(([v,l])=>`<button data-action="self-grade" data-id="${v}" ${disabled}>${l}</button>`).join('')}</div>`:`<button data-action="next-exercise" ${disabled}>Siguiente</button>`}`:`<button class="german-primary" data-action="check" ${disabled}>${content.type==='free_write'?'Ver solución modelo':'Comprobar respuesta'}</button>`}</article>`;
  }
  function study() {
    const s=current();if (!s) {panel='dashboard';return dashboard();}
    const running=s.status==='running' && ownsLock;
    const goal=state().goals.find(g=>g.id===s.goalId);
    const free=s.mode==='free';
    return `<section class="german-meter" id="germanMeter"><div class="german-meter-top"><div><span class="german-eyebrow">${free?'ESTUDIO LIBRE':'TARJETAS'} · ${esc(goal?.name || 'SIN OBJETIVO')}</span><span id="germanMoneyLabel">Recompensa de hoy</span></div><div><span id="germanTime">00:00</span><span class="german-status">${running?'En marcha':'En pausa'}</span></div></div><div class="german-meter-value"><div id="germanMoney" class="german-money">0,000 €</div><span>taxímetro</span></div><div id="germanBonus"></div><p id="germanMinimum"></p><p id="germanMilestone" role="status"></p><div class="german-session-controls"><button data-action="${running?'pause':'resume'}">${running?'Pausar':'Continuar'}</button><button data-action="finish" aria-label="Terminar sesión">Terminar</button></div><small>Esta sesión: <span id="germanSessionTime"></span>. ${free?'Continúa en segundo plano; recuerda pausarla o terminarla.':'Se pausa al salir o tras 5 min sin interactuar.'}</small></section>${free?`<section class="german-free-study"><div class="german-free-icon" aria-hidden="true">Ä</div><span class="german-eyebrow">EL TIEMPO TAMBIÉN CUENTA FUERA DE LAS TARJETAS</span><h2>Estudio libre</h2><p>Haz una ficha, escucha alemán activamente, practica conversación o trabaja con cualquier otro material.</p><strong>${running?'El taxímetro está contando':'La sesión está en pausa'}</strong></section>`:itemMarkup(s)}`;
  }
  function updateMeter() {
    if (panel!=='study' || !current()) return;
    const st=state(), s=current(), today=R.dayKey(), total=R.summarizeDays(st.sessions)[today] || 0, streak=R.streakStats(st.sessions,today);
    const ledger=entries(), rows=ledger.filter(e=>e.date===today && e.goalId===s.goalId), goal=st.goals.find(g=>g.id===s.goalId);
    const qualified=total>=MIN, bonus=R.streakMultiplier(streak.prospective);
    const consolidated=rows.reduce((n,e)=>n+e.finalReward,0);
    const other=ledger.filter(e=>e.goalId===s.goalId && e.date!==today).reduce((n,e)=>n+e.finalReward,0);
    const germanPending=rows.filter(e=>e.source==='german'&&!e.qualified).reduce((n,e)=>n+(e.potentialMicroEuros || 0)/1e6,0);
    const pending=goal?Math.min(Math.max(0,goal.amount-other),consolidated+germanPending):0;
    const set=(id,text)=>{const el=document.getElementById(id);if(el && el.textContent!==text)el.textContent=text;};
    set('germanMoney',euro(goal?(qualified?consolidated:pending):0,3));
    set('germanMoneyLabel',goal?(qualified?'Consolidado hoy para este objetivo':(consolidated?'Piano consolidado + alemán pendiente hasta '+MIN_LABEL:'Pendiente hoy · se consolida a los '+MIN_LABEL)):'Crea un objetivo para activar la hucha');
    set('germanTime',time(total));set('germanSessionTime',time(s.segments.reduce((n,e)=>n+e.seconds,0)));
    set('germanBonus','+'+Math.round((bonus-1)*100)+' % por racha de '+streak.prospective+' días'+(qualified?'':' al cualificar hoy'));
    set('germanMinimum',qualified?(total>=CAP?MIN_LABEL+' mínimos ✓ · Límite diario alcanzado; puedes seguir estudiando.':MIN_LABEL+' mínimos ✓'):'Faltan '+time(Math.ceil(MIN-total))+' para consolidar el día');
  }
  function render() {
    const el=document.getElementById('germanContent');if(!el)return;
    el.innerHTML=panel==='study'?study():dashboard();
    document.getElementById('view-deutsch').dataset.panel=panel;
    document.querySelectorAll('[data-german-panel]').forEach(b=>b.setAttribute('aria-current',b.dataset.germanPanel===panel?'page':'false'));
    message(error);updateMeter();
  }
  async function start(mode='cards',materialId='') {
    if (!(await lock())) throw new Error('Hay una sesión de Deutsch abierta en otra pestaña. Termínala allí o cierra esa pestaña.');
    let s=current();
    if (!s) {
      s=state().sessions.find(session=>session.deviceId===deviceId && !session.endedAt);
      if(s)activeId=s.id;
    }
    if (!s) {
      const queue=mode==='free'?[]:S.queue(state(),{mode:'cards',materialId});
      if (mode!=='free' && !queue.length) {unlock();panel='dashboard';render();throw new Error('Importa una clase con tarjetas antes de empezar.');}
      const goal=activeGoal();
      s=T.create({id:uid(),deviceId,goalId:goal?.id || null,queue});s.mode=mode;s.materialId=materialId;s.activity=mode==='free'?'free-study':'cards';
      state().sessions.push(s);activeId=s.id;
    }
    s.status='running';lastTick=lastInteraction=Date.now();qualifiedBefore=(R.summarizeDays(state().sessions)[R.dayKey()] || 0)>=MIN;
    panel='study';persist();render();window.scrollTo({top:0,behavior:'instant'});
  }
  function next(s) {s.index++;s.revealed=false;s.checked=false;s.draftAnswer='';s.correct=null;persist();render();}
  function reviewExercise(result,advanceItem=true) {
    const s=current(),item=s.queue[s.index];
    const id=item.id+':review';
    if(!state().reviews.some(r=>r.id===id))state().reviews.push({id,sessionId:s.id,exerciseId:item.contentId,at:new Date().toISOString(),answer:s.draftAnswer || '',result});
    if(advanceItem)next(s);
  }
  function download(name,value) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function action(action,id) {
    const s=current();lastInteraction=Date.now();message('');
    if (['dashboard','materials','modes'].includes(action)) {pause();panel='dashboard';render();window.scrollTo({top:0,behavior:'instant'});return;}
    if (action==='start') return start('cards');
    if (action==='free') return start('free');
    if (action==='mode') return start(id==='free'?'free':'cards');
    if (action==='material') return start('cards',id);
    if (action==='resume') return start();
    if (action==='pause') {pause();render();return;}
    if (action==='finish') {
      if (!(await lock())) throw new Error('Termina la sesión desde la otra pestaña.');
      if (s) {advance();T.finish(state(),s.id);persist();activeId=null;}unlock();panel='dashboard';render();return;
    }
    if (action==='edit-goal') {editingGoalId=id;deletingGoalId=null;render();return;}
    if (action==='cancel-goal-edit') {editingGoalId=null;render();return;}
    if (action==='delete-goal') {deletingGoalId=id;editingGoalId=null;render();return;}
    if (action==='cancel-delete-goal') {deletingGoalId=null;render();return;}
    if (action==='confirm-delete-goal') {
      const goal=state().goals.find(item=>item.id===id&&!item.deletedAt);
      if (!goal)return;
      if(sharedGoalSessionActive(goal.id))throw new Error('Termina primero la sesión que está aportando a este objetivo.');
      const now=new Date().toISOString();goal.deletedAt=now;goal.archivedAt=goal.archivedAt||now;goal.updatedAt=now;
      editingGoalId=deletingGoalId=null;persist();render();return;
    }
    if (action==='archive') {
      const goal=activeGoal();if(goal&&sharedGoalSessionActive(goal.id))throw new Error('Termina la sesión antes de archivar.');
      if (goal && R.goalProgress(goal,entries(),state().sessions).complete) {goal.archivedAt=new Date().toISOString();persist();render();}return;
    }
    if (action==='example') return download('german-study-pack.v1.json',I.EXAMPLE);
    if (action==='export-ledger') return download('deutsch-historial.json',{goals:state().goals,sessions:state().sessions,ledger:entries()});
    if (action==='copy-prompt') {try {await navigator.clipboard.writeText(I.AI_PROMPT);message('Prompt copiado. Adjunta tu PDF junto con él.');} catch {document.getElementById('germanPrompt')?.select();message('Seleccionado: copia el prompt con el menú de tu dispositivo.');}return;}
    if (action==='retry') {persist();message('Guardado correctamente.');return;}
    if (!s || s.status!=='running' || !ownsLock) throw new Error('Pulsa Continuar antes de responder.');
    if (action==='more') {
      const items=S.queue(state(),{mode:s.mode==='mixed'?'mixed':'cards',materialId:s.materialId});
      const offset=s.queue.length;s.queue.push(...items.map((item,i)=>({...item,contentId:item.id,id:s.id+':item:'+(offset+i)})));
      s.index=offset;s.revealed=false;s.checked=false;s.draftAnswer='';persist();render();return;
    }
    if (action==='reveal') {s.revealed=true;persist();render();return;}
    if (action==='grade' && s.revealed) {
      state().reviews.push({id:uid(),sessionId:s.id,cardId:s.queue[s.index].contentId,at:new Date().toISOString(),grade:id});next(s);return;
    }
    if (action==='check') {
      s.draftAnswer=document.getElementById('germanAnswer').value;
      if (!s.draftAnswer.trim()) throw new Error('Escribe tu respuesta antes de comprobar.');
      const item=s.queue[s.index], exercise=state().materials.find(m=>m.id===item.materialId).exercises.find(e=>e.id===item.contentId);
      s.checked=true;s.correct=S.correct(exercise,s.draftAnswer);
      if(exercise.type!=='free_write')reviewExercise(s.correct?'correct':'incorrect',false);
      persist();render();return;
    }
    if (action==='next-exercise' && s.checked) return reviewExercise(s.correct?'correct':'incorrect');
    if (action==='self-grade' && s.checked) return reviewExercise(id);
  }
  async function guarded(fn) {if(busy)return;busy=true;try {await fn();}catch(e){message(e.message);}finally{busy=false;}}
  function init() {
    const view=document.getElementById('view-deutsch');if(!view)return;
    const pending=state().sessions.filter(s=>s.deviceId===deviceId && !s.endedAt).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
    activeId=pending[0]?.id || null;
    // Recovery never restarts elapsed time; only the checkpoint is counted.
    // Do not mutate a persisted run until this tab owns the lock; another tab may own it.
    view.innerHTML=`<header class="german-header"><div><span class="german-eyebrow">DEUTSCH</span><h1>Alemán</h1></div><button data-action="home" aria-label="Volver a Hoy">← Hoy</button></header><p class="german-note">Tarjetas, repaso espaciado y estudio libre · hucha virtual</p><div id="germanError" role="status" hidden></div><button class="german-retry" data-action="retry">Reintentar guardado</button><div id="germanContent"></div>`;
    view.addEventListener('click',e=> {
      const button=e.target.closest('[data-action]');if(!button)return;
      if(button.dataset.action==='home'){showView('session');return;}
      guarded(()=>action(button.dataset.action,button.dataset.id));
    });
    view.addEventListener('submit',e=> {
      if(e.target.id!=='germanGoalForm')return;e.preventDefault();
      guarded(()=> {
        const data=new FormData(e.target),amount=Number(data.get('amount')),name=String(data.get('name')).trim();
        if(!name || !Number.isFinite(amount) || amount<.01 || amount>1e8)throw new Error('Introduce un nombre y un importe válido.');
        const goalId=e.target.dataset.goalId,rounded=Math.round(amount*100)/100,now=new Date().toISOString();
        if(goalId) {
          const goal=state().goals.find(item=>item.id===goalId&&!item.deletedAt);
          if(!goal)throw new Error('Ese objetivo ya no está disponible.');
          goal.name=name;goal.amount=rounded;goal.updatedAt=now;editingGoalId=null;
        } else {
          if(activeGoal())throw new Error('Ya hay un objetivo activo.');
          state().goals.push({id:uid(),name,amount:rounded,createdAt:now,rewardPolicy:JSON.parse(JSON.stringify(R.CONFIG))});
        }
        persist();render();
      });
    });
    view.addEventListener('change',e=> {
      if(e.target.id!=='germanImportFile' || !e.target.files[0])return;
      const file=e.target.files[0];guarded(async()=> {
        if(file.size>I.MAX_BYTES)throw new Error('El archivo supera 2 MB.');
        const pack=await I.parse(await file.text(),file.name);
        const added=I.insert(state(),pack);if(added)persist();render();message(added?'Material importado: '+pack.metadata.title:'Este paquete ya estaba importado.');
      });
    });
    view.addEventListener('input',e=> {
      lastInteraction=Date.now();
      if(e.target.id==='germanAnswer' && current())current().draftAnswer=e.target.value;
      const form=e.target.closest('#germanGoalForm');
      if(form?.dataset.goalId){
        const goal=state().goals.find(g=>g.id===form.dataset.goalId),preview=form.querySelector('#germanGoalEquivalence');
        if(goal && preview)preview.innerHTML=goalEquivalence(goal,Number(form.elements.amount.value),form.elements.name.value.trim());
      }
    });
    view.addEventListener('keydown',e=> {
      const s=current();if(!s || panel!=='study' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
      if((e.key===' ' || e.key==='Enter') && !s.revealed && s.mode!=='free'){e.preventDefault();guarded(()=>action('reveal'));return;}
      if(s.revealed && /^[1-4]$/.test(e.key)){e.preventDefault();guarded(()=>action('grade',S.GRADES[Number(e.key)-1]));return;}
      if(e.key.toLowerCase()==='p'){e.preventDefault();guarded(()=>action(s.status==='running'?'pause':'resume'));}
    });
    ['pointerdown','keydown'].forEach(type=>view.addEventListener(type,()=>{lastInteraction=Date.now();},{passive:true}));
    window.addEventListener('app:viewchange',e=> {
      if(e.detail.name==='deutsch') {if(current())panel='study';render();}
      else {try {pause();}catch(err){message(err.message);}}
    });
    document.addEventListener('visibilitychange',()=> {if(document.hidden && current()?.mode!=='free')try {pause();}catch(e){message(e.message);}});
    window.addEventListener('pagehide',()=>{try{pause();}catch{}unlock();});
    window.addEventListener('storage',e=> {if(e.key==='alberto_piano_v2' && document.body.dataset.view==='deutsch' && !ownsLock)render();});
    setInterval(()=> {try {advance();if(visible())updateMeter();}catch(e){message(e.message);}},1000);
    render();
  }
  function openGoalManager() {
    showView('deutsch');panel='dashboard';editingGoalId=deletingGoalId=null;render();
    setTimeout(()=>document.getElementById('germanSharedGoal')?.scrollIntoView({behavior:'smooth',block:'center'}),0);
  }
  root.GermanStudy={hasActiveSession:()=>Boolean(current()),open:()=>showView('deutsch'),openGoalManager,refreshMoney:()=>{if(panel==='dashboard'&&!editingGoalId&&!deletingGoalId)render();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
