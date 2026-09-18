/* Rachas y premios: las cantidades se proyectan del historial canónico.
   Abrir esta pantalla nunca genera créditos ni escribe un segundo ledger. */
(function(root){
  'use strict';
  const P=root.PianoRewards,H=root.HabitTrophies,doc=root.document;
  if(!P||!H||!doc)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=seconds=>{const mins=Math.floor(Math.max(0,seconds)/60);return Math.floor(mins/60)+' h '+String(mins%60).padStart(2,'0')+' min';};
  const percent=multiplier=>'+'+((multiplier-1)*100).toLocaleString('es-ES',{maximumFractionDigits:1})+' %';
  const money=amount=>Number(amount).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  function database(){try{return db;}catch(error){return root.db;}}
  function streakCard(label,threshold,info){
    const status=info.fullDay||info.excellentDay?'Hoy confirmado':info.pending?'Hoy en curso':info.frozen?'Racha congelada':'Hoy pendiente';
    const confirmed=info.fullDay||info.excellentDay;
    const boost=confirmed?info.todayMultiplier:(threshold===P.FULL_DAY_SECONDS?P.streakMultiplier(info.current+1):P.excellenceMultiplier(info.current+1));
    const remaining=Math.max(0,threshold-info.todaySeconds);
    return `<article class="study-incentive-card"><span>${label}</span><strong>${info.current} <small>días</small></strong><p>${status} · ${percent(boost)} ${confirmed?'confirmado hoy':'al alcanzar el umbral'}.</p><progress max="${threshold}" value="${Math.min(threshold,info.todaySeconds)}" aria-label="Progreso de ${label}"></progress><small>${remaining?'Faltan '+time(remaining)+' equivalentes hoy.':'Umbral alcanzado hoy.'}</small></article>`;
  }
  function render(){
    const data=database(),content=doc.getElementById('studyIncentivesContent');if(!data||!content)return;
    const state=P.studyState(data),today=P.dayKey(),four=P.streakStats(state.sessions,today),five=P.excellenceStats(state.sessions,today);
    const since=P.effortStartDay(data),achievement=P.studyAchievement(state.sessions.filter(s=>s.date>=since),today),snap=P.walletSnapshot(data),goal=P.activeGoal(data);
    const raw=state.sessions.filter(s=>s.date===today).reduce((sum,s)=>sum+Math.max(0,Number(s.seconds)||0),0);
    const bonus=snap.bonusRows.find(row=>row.id==='bonus:excellence-month');
    const habitats=(typeof root.habitAllChallenges==='function'?root.habitAllChallenges():data.habitChallenges||[]);
    const current=habitats.find(h=>!H.itemFor(h)?.complete&&!h.deleted),reward=current?H.rewardStatus(current):null;
    content.innerHTML=`<p class="study-incentives-intro">Hoy: <strong>${time(raw)} reales</strong> · ${time(four.todaySeconds)} equivalentes. Estudio cuenta al 100 %, clase al 50 % y cámara a un tercio.</p>
      <div class="study-incentives-grid">${streakCard('Constancia · 4 horas',P.FULL_DAY_SECONDS,four)}${streakCard('Excelencia · 5 horas',P.EXCELLENT_DAY_SECONDS,five)}</div>
      <p class="study-incentives-rule">El descanso congela las rachas sin sumar días ni dinero. Entre cuatro y cinco horas mantienes la de excelencia; un día cerrado con estudio inferior a cuatro horas reinicia ambas. Las bonificaciones aumentan solo lo ganado ese día.</p>
      <details class="study-incentives-table"><summary>Ver las bonificaciones por días</summary><table><thead><tr><th>Días</th><th>≥4 h</th><th>≥5 h · combinado</th></tr></thead><tbody>${[1,2,3,5,7,10,14].map(n=>`<tr><td>${n===14?'14 o más':n}</td><td>${percent(P.streakMultiplier(n))}</td><td>${percent(P.streakMultiplier(n)*P.excellenceMultiplier(n))}</td></tr>`).join('')}</tbody></table><p>Seis y siete horas generan más esfuerzo con la curva diaria. El límite de piano sigue en siete horas; no hay un tercer multiplicador de racha.</p></details>
      <article class="study-incentive-achievement ${bonus?'is-earned':''}">${H.artwork('excellence-month',!!bonus,'study')}<div><span>LOGRO DE ESTUDIO · UNA SOLA VEZ</span><h3>${achievement.title}</h3><p>Completa veinte días de al menos cinco horas equivalentes dentro de un mes natural. Puedes descansar entre ellos.</p><strong>${bonus?'Conseguido · '+esc(bonus.date):Math.min(20,achievement.days)+' / 20 días este mes'}</strong><progress max="20" value="${bonus?20:Math.min(20,achievement.days)}" aria-label="Días del mes extraordinario"></progress><p class="study-incentive-reward">${bonus?'5 puntos abonados':'Premio: 5 puntos de esfuerzo'}${goal?' · '+money(5*P.goalScale(goal))+' equivalentes para '+esc(goal.name):''}</p></div></article>
      <section class="study-incentive-habit"><span>HÁBITOS</span><h3>Un premio acordado al empezar</h3><p>Tres puntos por un ciclo de al menos veintiún días con todos los días cumplidos y un criterio fijado antes del inicio. Hacer: marca cada día. Evitar: si no registras una caída, ese día cuenta como cumplido.</p>${current?`<p><strong>${esc(current.title)}</strong> · ${reward.status==='none'?'Solo trofeo en este ciclo':reward.status==='failed'?'Premio no alcanzable en este ciclo; tu progreso se conserva':'3 puntos al completar todos los días'}</p>`:''}<p>Los hábitos anteriores conservan sus trofeos. El plazo por sí solo no concede dinero, y los ciclos simultáneos no duplican premios.</p></section>
      <section class="study-incentive-bonus-history"><h3>Premios de esfuerzo</h3>${snap.bonusRows.length?`<ul>${snap.bonusRows.map(row=>`<li><span>${esc(row.title)}<small>${esc(row.date)}</small></span><strong>+${P.rowEffortPoints(row)} pts</strong></li>`).join('')}</ul>`:'<p>Aquí aparecerán tus premios cuando cumplas sus condiciones.</p>'}<p>Entran en el mismo banco. Canjear un objetivo de compra descuenta puntos de todas sus equivalencias; los premios no se vuelven a cobrar al abrir la app.</p></section>`;
  }
  function open(){
    let modal=doc.getElementById('modalStudyIncentives');
    if(!modal){modal=doc.createElement('div');modal.id='modalStudyIncentives';modal.className='modal-overlay';modal.innerHTML='<div class="modal study-incentives-modal" role="dialog" aria-modal="true" aria-labelledby="studyIncentivesTitle"><div class="study-incentives-head"><div><span>CONSTANCIA Y ESFUERZO</span><h2 id="studyIncentivesTitle">Rachas y logros de estudio</h2></div><button type="button" class="modal-btn secondary" data-close-study-incentives>Cerrar</button></div><div id="studyIncentivesContent"></div></div>';doc.body.appendChild(modal);}
    render();if(typeof root.openModal==='function')root.openModal(modal.id);
  }
  doc.addEventListener('click',event=>{
    if(event.target.closest('[data-open-study-incentives]'))open();
    if(event.target.closest('[data-close-study-incentives]'))root.closeModal?.('modalStudyIncentives');
  });
  const refresh=()=>{if(doc.getElementById('modalStudyIncentives')?.classList.contains('visible'))render();};
  root.StudyIncentives={open,render,refresh};
})(window);
