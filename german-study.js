/* Deutsch owns only db.germanStudy; all writes use the app's existing save/sync path. */
(function(root) {
  'use strict';
  const R=root.GermanRewards, S=root.GermanSRS, I=root.GermanImport, T=root.GermanSession;
  const MIN=R.CONFIG.minimumSeconds, CAP=R.CONFIG.curve.at(-1)[0], MIN_LABEL=(MIN/60)+' min';
  const state=()=>T.ensure(db), uid=()=>crypto.randomUUID();
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const euro=(n,digits=2)=>Number(n).toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits})+' €';
  const time=n=>{n=Math.floor(n || 0);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
  const minutes=n=>Math.floor((n || 0)/60)+' min';
  const typeLabels={de_es:'Alemán → español',es_de:'Español → alemán',expression:'Expresión',grammar:'Estructura gramatical',question_answer:'Pregunta y respuesta',cloze:'Completa el hueco',fill_blank:'Completa el hueco',translation:'Traducción',conjugation:'Conjugación',short_answer:'Respuesta breve',free_write:'Escritura libre'};
  let deviceId, activeId=null, panel='dashboard', lastTick=Date.now(), lastInteraction=Date.now(), lastSave=0;
  let releaseLock=null, ownsLock=false, busy=false, qualifiedBefore=false, error='';
  const lockToken=uid();
  try {deviceId=localStorage.getItem('german_device_v1');if (!deviceId) {deviceId=uid();localStorage.setItem('german_device_v1',deviceId);}} catch {deviceId=uid();}
  const current=()=>state().sessions.find(s=>s.id===activeId && !s.endedAt);
  const entries=()=>R.ledger(state().sessions,state().goals);
  function activeGoal() {
    // Concurrent offline creations are queued deterministically, never both active.
    return state().goals.filter(g=>!g.archivedAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))[0];
  }
  function message(text) { error=text;const el=document.getElementById('germanError');if(el) {el.textContent=text;el.hidden=!text;} }
  function persist() {
    state().ledger=entries();
    if (saveData()===false) {const s=current();if(s) s.status='paused';if(panel==='study')render();throw new Error('No se ha podido guardar. La sesión está pausada; libera espacio y pulsa Reintentar guardado.');}
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
    const running=T.tick(s,{now,lastTick,lastInteraction,visible:visible()});lastTick=now;
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
    if (!goal) return `<section class="german-card german-goal"><span class="german-eyebrow">TU PRÓXIMO OBJETIVO</span><h2>Un motivo para volver mañana.</h2><p>Convierte tu alemán en una hucha virtual. Tú eliges la recompensa.</p>${goalForm()}</section>`;
    const progress=R.goalProgress(goal,ledger,state().sessions), percent=Math.min(100,progress.amount/goal.amount*100);
    return `<section class="german-card german-goal"><span class="german-eyebrow">${progress.complete?'OBJETIVO CONSEGUIDO ✨':'TU OBJETIVO'}</span><h2>${esc(goal.name)}</h2><div class="german-balance">${euro(progress.amount)} <small>/ ${euro(goal.amount)}</small></div><progress aria-label="Progreso del objetivo" max="100" value="${percent}"></progress><p>${percent.toFixed(1).replace('.',',')} % · Ahorrado estudiando</p>${progress.complete?`<p>Conseguido el ${esc(progress.completedOn)} · ${minutes(progress.seconds)} de alemán invertidos.</p><button data-action="archive" ${current()?'disabled':''}>Archivar y crear otro objetivo</button>${current()?'<p>Termina la sesión antes de archivar.</p>':''}`:''}</section>`;
  }
  function goalForm() {return `<form id="germanGoalForm" class="german-form"><label>Nombre del objetivo<input name="name" required maxlength="80" placeholder="Kindle" autocomplete="off"></label><label>Importe (€)<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required value="150"></label><button class="german-primary" type="submit">Crear objetivo</button></form>`;}
  function dashboard() {
    const st=state(),today=R.dayKey(), totals=R.summarizeDays(st.sessions), streak=R.streakStats(st.sessions,today), ledger=entries(), goal=activeGoal();
    const earned=ledger.filter(e=>e.date===today).reduce((n,e)=>n+e.finalReward,0);
    const weekStart=R.shiftDay(today,-((new Date().getDay()+6)%7));
    const week=Object.entries(totals).filter(([d])=>d>=weekStart && d<=today).reduce((n,[,s])=>n+s,0);
    const cards=st.materials.flatMap(m=>m.cards), exercises=st.materials.flatMap(m=>m.exercises);
    const states=cards.map(c=>S.cardState(c.id,st.reviews));
    const fresh=states.filter(s=>!s.reviews).length, due=states.filter(s=>s.nextReview && Date.parse(s.nextReview)<=Date.now()).length;
    const daySeconds=totals[today] || 0;
    const pendingBase=daySeconds<MIN?ledger.filter(e=>e.date===today && e.goalId===goal?.id).reduce((n,e)=>n+e.baseReward,0):0;
    const cap=goal ? Math.max(0,(R.baseReward(CAP)-R.baseReward(daySeconds)+pendingBase)*R.goalScale(goal.amount)*R.streakMultiplier(streak.prospective)) : 0;
    const pending=totals[today]>0 && totals[today]<MIN;
    return `${goalCard(goal,ledger)}<section class="german-stats" aria-label="Estadísticas de alemán"><div><span>Hoy</span><strong>${minutes(totals[today])}</strong><small>${euro(earned)} consolidados${pending?' · mínimo pendiente':''}</small></div><div><span>Racha</span><strong>🔥 ${streak.current} días</strong><small>${streak.nextBonusIn?streak.nextBonusIn+' días para +5 % de bonus':'Bonus máximo: +25 %'}</small></div><div><span>Esta semana</span><strong>${minutes(week)}</strong><small>Mejor racha: ${streak.best} días</small></div></section>
      <section class="german-card"><div class="german-row"><div><h2>Un poco de alemán, cada día.</h2><p>${due} tarjetas vencidas · ${fresh} nuevas · ${exercises.length} ejercicios</p></div><span class="german-letter" aria-hidden="true">Ä</span></div><button class="german-primary german-start" data-action="start">${current()?'Volver a la sesión':'Empezar estudio'}</button><button data-action="modes">Elegir modo</button><p class="german-muted">${goal?'Hasta ≈ '+euro(Math.min(cap,Math.max(0,goal.amount-R.goalProgress(goal,ledger,st.sessions).amount)))+' adicionales hoy.':'Puedes estudiar sin objetivo; el tiempo y las revisiones se conservan.'} ${MIN_LABEL} netos para cualificar el día.</p></section>
      <section class="german-card"><h2>Tu constancia</h2><div class="german-activity" aria-label="Actividad de los últimos 14 días">${Array.from({length:14},(_,i)=>{const day=R.shiftDay(today,i-13),seconds=totals[day] || 0;return `<div class="${seconds>=MIN?'done':seconds?'partial':''}" title="${day}: ${minutes(seconds)}" aria-label="${day}: ${minutes(seconds)}"><span>${day.slice(8)}</span></div>`;}).join('')}</div><p class="german-muted">${st.reviews.filter(r=>r.cardId).length} tarjetas revisadas · Color completo: día cualificado.</p></section>
      <details class="german-card"><summary>Historial de objetivos y movimientos</summary>${st.goals.filter(g=>g.archivedAt).map(g=>{const p=R.goalProgress(g,ledger,st.sessions);return `<p><strong>${esc(g.name)}</strong> · ${euro(p.amount)} / ${euro(g.amount)} · ${esc(p.completedOn || 'En progreso')} · ${minutes(p.seconds)}</p>`;}).join('') || '<p>Aquí aparecerán tus objetivos archivados.</p>'}<div class="german-ledger">${ledger.slice(-30).reverse().map(e=>`<p>${esc(e.date)} · ${minutes(e.duration)} · ${euro(e.finalReward,3)} ${e.qualified?'':'(pendiente)'}<small>Base ${euro(e.baseReward,3)} × escala ${e.goalScale.toFixed(3)} × racha ${e.streakMultiplier.toFixed(2)}</small></p>`).join('')}</div><button data-action="export-ledger">Descargar historial completo</button></details>`;
  }
  function materials() {
    return `<section class="german-card"><h2>Materiales de tus clases</h2><p>PDF → IA → JSON → Deutsch. Importa un paquete de estudio o un CSV de vocabulario.</p><label class="german-file">Importar .json o .csv<input id="germanImportFile" type="file" accept=".json,.csv,application/json,text/csv"></label><p class="german-muted">Hasta 2 MB y 2.000 elementos. CSV: front,back; opcionales type,hint,explanation,tags. Separa tags con |.</p><button data-action="example">Descargar JSON de ejemplo</button><details><summary>Crear material con IA</summary><p>Adjunta tu PDF a la IA que prefieras junto con este prompt.</p><textarea id="germanPrompt" aria-label="Prompt para IA" readonly rows="9">${esc(I.AI_PROMPT)}</textarea><button data-action="copy-prompt">Copiar prompt para IA</button></details></section>
      ${state().materials.map(m=>`<article class="german-card"><span class="german-eyebrow">${esc(m.metadata.date || 'MATERIAL IMPORTADO')}</span><h2>${esc(m.metadata.title)}</h2><p>${esc(m.metadata.teacher)} ${m.metadata.source?'· '+esc(m.metadata.source):''}</p><p>${m.cards.length} tarjetas · ${m.exercises.length} ejercicios</p>${m.metadata.notes?`<p>${esc(m.metadata.notes)}</p>`:''}<button data-action="material" data-id="${esc(m.id)}">Estudiar este material</button><details><summary>Ver contenido</summary>${m.cards.map(c=>`<p><strong>${esc(c.front)}</strong> → ${esc(c.back)}</p>`).join('')}${m.exercises.map(e=>`<p>${esc(e.prompt)}</p>`).join('')}</details></article>`).join('') || '<p class="german-empty">Todavía no hay materiales. Descarga el ejemplo para conocer el formato o importa tu primera clase.</p>'}`;
  }
  function modes() {return `<section class="german-card"><h2>¿Qué quieres practicar?</h2><div class="german-actions"><button data-action="mode" data-id="cards">Tarjetas</button><button data-action="mode" data-id="exercises">Ejercicios</button><button data-action="materials">Material concreto</button></div><p>La sesión mixta prioriza tarjetas vencidas, hasta 10 nuevas y ejercicios pendientes. Después puedes repetir para seguir repasando.</p></section>`;}
  function itemMarkup(s) {
    const item=s.queue[s.index], m=item && state().materials.find(m=>m.id===item.materialId);
    const content=item && m?.[item.kind==='card'?'cards':'exercises'].find(c=>c.id===item.contentId);
    if (!content) return `<div class="german-card german-study-content"><h2>¡Repaso terminado!</h2><p>Puedes seguir con otra tanda o terminar la sesión.</p><button data-action="more">Seguir repasando</button></div>`;
    const disabled=s.status!=='running' || !ownsLock?'disabled':'';
    const explanation=content.explanation?`<p class="german-explanation">${esc(content.explanation)}</p>`:'';
    const hint=content.hint?`<details><summary>Pista</summary><p>${esc(content.hint)}</p></details>`:'';
    const heading=`<div class="german-row"><span class="german-eyebrow">${esc(m.metadata.title)}</span><span>${s.index+1} / ${s.queue.length}</span></div>`;
    if (item.kind==='card') return `<article class="german-card german-study-content">${heading}<span class="german-type">${esc(typeLabels[content.type] || content.type)}</span><h2>${esc(content.front)}</h2>${hint}${s.revealed?`<div class="german-answer"><h3>${esc(content.back)}</h3>${explanation}${(content.examples || []).map(e=>`<p>${esc(e)}</p>`).join('')}</div><div class="german-grades">${S.GRADES.map(g=>`<button data-action="grade" data-id="${g}" ${disabled}>${g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div>`:`<button class="german-primary" data-action="reveal" ${disabled}>Mostrar respuesta</button>`}</article>`;
    return `<article class="german-card german-study-content">${heading}<span class="german-type">${esc(typeLabels[content.type] || content.type)}</span><h2>${esc(content.prompt)}</h2>${hint}<label for="germanAnswer">Tu respuesta</label><textarea id="germanAnswer" rows="4" ${s.checked?'readonly':''}>${esc(s.draftAnswer || '')}</textarea>${s.checked?`<div class="german-answer"><h3>${content.type==='free_write'?'Solución modelo':s.correct?'Correcto ✓':'Revisa tu respuesta'}</h3><p>${esc(content.answer || content.acceptedAnswers?.join(' / '))}</p>${explanation}</div>${content.type==='free_write'?`<div class="german-grades">${[['correct','Correcto'],['partial','Parcial'],['incorrect','Incorrecto']].map(([v,l])=>`<button data-action="self-grade" data-id="${v}" ${disabled}>${l}</button>`).join('')}</div>`:`<button data-action="next-exercise" ${disabled}>Siguiente</button>`}`:`<button class="german-primary" data-action="check" ${disabled}>${content.type==='free_write'?'Ver solución modelo':'Comprobar respuesta'}</button>`}</article>`;
  }
  function study() {
    const s=current();if (!s) {panel='dashboard';return dashboard();}
    const running=s.status==='running' && ownsLock;
    const goal=state().goals.find(g=>g.id===s.goalId), progress=goal && R.goalProgress(goal,entries(),state().sessions);
    return `<section class="german-meter" id="germanMeter"><span class="german-eyebrow">${esc(goal?.name || 'ESTUDIO LIBRE')}${progress?' · '+euro(progress.amount)+' / '+euro(goal.amount):''}</span><span id="germanMoneyLabel">Recompensa de hoy</span><div id="germanMoney" class="german-money">0,000 €</div><div id="germanBonus"></div><p><span id="germanTime">00:00</span> estudiados hoy <span class="german-status">${running?'En marcha':'En pausa'}</span></p><p id="germanMinimum"></p><p id="germanMilestone" role="status"></p><div class="german-actions"><button data-action="${running?'pause':'resume'}">${running?'Pausar':'Continuar'}</button><button data-action="finish">Terminar sesión</button></div><small>Tiempo neto de esta sesión: <span id="germanSessionTime"></span>. Pausa automática al salir o tras 5 min sin interactuar.</small></section>${itemMarkup(s)}`;
  }
  function updateMeter() {
    if (panel!=='study' || !current()) return;
    const st=state(), s=current(), today=R.dayKey(), total=R.summarizeDays(st.sessions)[today] || 0, streak=R.streakStats(st.sessions,today);
    const ledger=entries(), rows=ledger.filter(e=>e.date===today && e.goalId===s.goalId), goal=st.goals.find(g=>g.id===s.goalId);
    const qualified=total>=MIN, bonus=R.streakMultiplier(streak.prospective);
    const consolidated=rows.reduce((n,e)=>n+e.finalReward,0);
    const other=ledger.filter(e=>e.goalId===s.goalId && e.date!==today).reduce((n,e)=>n+e.finalReward,0);
    const pending=goal?Math.min(Math.max(0,goal.amount-other),rows.reduce((n,e)=>n+e.baseReward*e.goalScale*bonus,0)):0;
    const set=(id,text)=>{const el=document.getElementById(id);if(el && el.textContent!==text)el.textContent=text;};
    set('germanMoney',euro(qualified?consolidated:pending,3));
    set('germanMoneyLabel',qualified?'Consolidado hoy para este objetivo':'Pendiente hoy · se consolida a los '+MIN_LABEL);
    set('germanTime',time(total));set('germanSessionTime',time(s.segments.reduce((n,e)=>n+e.seconds,0)));
    set('germanBonus','+'+Math.round((bonus-1)*100)+' % por racha de '+streak.prospective+' días'+(qualified?'':' al cualificar hoy'));
    set('germanMinimum',qualified?(total>=CAP?MIN_LABEL+' mínimos ✓ · Límite diario alcanzado; puedes seguir estudiando.':MIN_LABEL+' mínimos ✓'):'Faltan '+time(Math.ceil(MIN-total))+' para consolidar el día');
  }
  function render() {
    const el=document.getElementById('germanContent');if(!el)return;
    el.innerHTML=panel==='materials'?materials():panel==='modes'?modes():panel==='study'?study():dashboard();
    document.getElementById('view-deutsch').dataset.panel=panel;
    document.querySelectorAll('[data-german-panel]').forEach(b=>b.setAttribute('aria-current',b.dataset.germanPanel===panel?'page':'false'));
    message(error);updateMeter();
  }
  async function start(mode='mixed',materialId='') {
    if (!(await lock())) throw new Error('Hay una sesión de Deutsch abierta en otra pestaña. Termínala allí o cierra esa pestaña.');
    let s=current();
    if (!s) {
      s=state().sessions.find(session=>session.deviceId===deviceId && !session.endedAt);
      if(s)activeId=s.id;
    }
    if (!s) {
      const queue=S.queue(state(),{mode,materialId});
      if (!queue.length) {unlock();panel='materials';render();throw new Error('Importa material para este modo antes de empezar.');}
      const goal=activeGoal();
      s=T.create({id:uid(),deviceId,goalId:goal?.id || null,queue});s.mode=mode;s.materialId=materialId;
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
    if (['dashboard','materials','modes'].includes(action)) {pause();panel=action;render();window.scrollTo({top:0,behavior:'instant'});return;}
    if (action==='start') return start();
    if (action==='mode') return start(id);
    if (action==='material') return start('mixed',id);
    if (action==='resume') return start();
    if (action==='pause') {pause();render();return;}
    if (action==='finish') {
      if (!(await lock())) throw new Error('Termina la sesión desde la otra pestaña.');
      if (s) {advance();T.finish(state(),s.id);persist();activeId=null;}unlock();panel='dashboard';render();return;
    }
    if (action==='archive') {
      const goal=activeGoal();if(current())throw new Error('Termina la sesión antes de archivar.');
      if (goal && R.goalProgress(goal,entries(),state().sessions).complete) {goal.archivedAt=new Date().toISOString();persist();render();}return;
    }
    if (action==='example') return download('german-study-pack.v1.json',I.EXAMPLE);
    if (action==='export-ledger') return download('deutsch-historial.json',{goals:state().goals,sessions:state().sessions,ledger:entries()});
    if (action==='copy-prompt') {try {await navigator.clipboard.writeText(I.AI_PROMPT);message('Prompt copiado. Adjunta tu PDF junto con él.');} catch {document.getElementById('germanPrompt')?.select();message('Seleccionado: copia el prompt con el menú de tu dispositivo.');}return;}
    if (action==='retry') {persist();message('Guardado correctamente.');return;}
    if (!s || s.status!=='running' || !ownsLock) throw new Error('Pulsa Continuar antes de responder.');
    if (action==='more') {
      const items=S.queue(state(),{mode:s.mode,materialId:s.materialId});
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
    view.innerHTML=`<header class="german-header"><div><span class="german-eyebrow">DEUTSCH</span><h1>Tu alemán, día a día.</h1></div><button data-action="home" aria-label="Volver a Hoy">← Hoy</button></header><nav class="german-nav" aria-label="Deutsch"><button data-action="dashboard" data-german-panel="dashboard">Resumen</button><button data-action="materials" data-german-panel="materials">Materiales</button></nav><p class="german-note">Hucha virtual · no mueve dinero real</p><div id="germanError" role="status" hidden></div><button class="german-retry" data-action="retry">Reintentar guardado</button><div id="germanContent"></div>`;
    view.addEventListener('click',e=> {
      const button=e.target.closest('[data-action]');if(!button)return;
      if(button.dataset.action==='home'){showView('session');return;}
      guarded(()=>action(button.dataset.action,button.dataset.id));
    });
    view.addEventListener('submit',e=> {
      if(e.target.id!=='germanGoalForm')return;e.preventDefault();
      guarded(()=> {
        if(activeGoal())throw new Error('Ya hay un objetivo activo.');
        const data=new FormData(e.target),amount=Number(data.get('amount')),name=String(data.get('name')).trim();
        if(!name || !Number.isFinite(amount) || amount<.01 || amount>1e8)throw new Error('Introduce un nombre y un importe válido.');
        state().goals.push({id:uid(),name,amount:Math.round(amount*100)/100,createdAt:new Date().toISOString(),rewardPolicy:JSON.parse(JSON.stringify(R.CONFIG))});persist();render();
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
    view.addEventListener('input',e=> {lastInteraction=Date.now();if(e.target.id==='germanAnswer' && current()){current().draftAnswer=e.target.value;}});
    ['pointerdown','keydown'].forEach(type=>view.addEventListener(type,()=>{lastInteraction=Date.now();},{passive:true}));
    window.addEventListener('app:viewchange',e=> {
      if(e.detail.name==='deutsch') {if(current())panel='study';render();}
      else {try {pause();}catch(err){message(err.message);}}
    });
    document.addEventListener('visibilitychange',()=> {if(document.hidden)try {pause();}catch(e){message(e.message);}});
    window.addEventListener('pagehide',()=>{try{pause();}catch{}unlock();});
    window.addEventListener('storage',e=> {if(e.key==='alberto_piano_v2' && document.body.dataset.view==='deutsch' && !ownsLock)render();});
    setInterval(()=> {try {advance();if(visible())updateMeter();}catch(e){message(e.message);}},1000);
    render();
  }
  root.GermanStudy={hasActiveSession:()=>Boolean(current()),open:()=>showView('deutsch')};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
