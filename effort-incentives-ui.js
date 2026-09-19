/* Rachas y premios: las cantidades se proyectan del historial canónico.
   Abrir esta pantalla nunca genera créditos ni escribe un segundo ledger. */
(function(root){
  'use strict';
  const P=root.PianoRewards,H=root.HabitTrophies,doc=root.document;
  if(!P||!H||!doc)return;
  const SECRET_SEEN_KEY='study_secret_bonus_seen_v1';
  let secretToastTimer=null,secretSeenMemory=null;
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
    return `<article class="study-incentive-card"><span>${label}</span><strong>${info.current} <small>días</small></strong><p>${status} · ${percent(boost)} ${confirmed?'confirmado hoy':'al alcanzar el umbral'}, antes del límite conjunto.</p><progress max="${threshold}" value="${Math.min(threshold,info.todaySeconds)}" aria-label="Progreso de ${label}"></progress><small>${remaining?'Faltan '+time(remaining)+' equivalentes hoy.':'Umbral alcanzado hoy.'}</small></article>`;
  }
  function secretSeen(){
    if(secretSeenMemory)return secretSeenMemory;
    try{
      const raw=root.localStorage?.getItem(SECRET_SEEN_KEY);
      secretSeenMemory=new Set(raw?JSON.parse(raw):[]);
    }catch(error){secretSeenMemory=new Set();}
    return secretSeenMemory;
  }
  function persistSecretSeen(){
    try{root.localStorage?.setItem(SECRET_SEEN_KEY,JSON.stringify([...secretSeen()]));}catch(error){}
  }
  function currentSecretRows(){
    const data=database();if(!data)return [];
    try{return P.walletSnapshot(data).bonusRows.filter(row=>row?.secretAchievement);}
    catch(error){return [];}
  }
  function secretEuro(row,goal){
    return goal?P.rowEffortPoints(row)*P.goalScale(goal):0;
  }
  function showSecretReward(row){
    const data=database(),goal=data?P.activeGoal(data):null;
    doc.getElementById('studySecretRewardToast')?.remove();
    const toast=doc.createElement('div');
    toast.id='studySecretRewardToast';
    toast.className='study-secret-reward-toast';
    toast.setAttribute('role','status');
    toast.setAttribute('aria-live','polite');
    const reward=goal?'<strong>+'+money(secretEuro(row,goal))+'</strong><small>para '+esc(goal.name)+'</small>':'<strong>+'+P.rowEffortPoints(row).toLocaleString('es-ES',{maximumFractionDigits:2})+' pts</strong>';
    const cleanTitle=String(row.title||'').replace(/^\S+\s/,'');
    toast.innerHTML='<span>PREMIO SECRETO</span><div class="study-secret-reward-title"><b>'+esc(row.icon||'✦')+'</b><h3>'+esc(cleanTitle)+'</h3></div><p>'+esc(row.description||'Has desbloqueado un premio de esfuerzo.')+'</p><div class="study-secret-reward-amount">'+reward+'</div>';
    doc.body.appendChild(toast);
    requestAnimationFrame(()=>toast.classList.add('is-visible'));
    const close=()=>{toast.classList.remove('is-visible');setTimeout(()=>toast.remove(),260);};
    toast.addEventListener('click',close,{once:true});
    clearTimeout(secretToastTimer);secretToastTimer=setTimeout(close,6500);
  }
  function checkSecretRewards({prime=false}={}){
    const rows=currentSecretRows(),seen=secretSeen();
    if(prime&&!seen.size){rows.forEach(row=>seen.add(row.id));persistSecretSeen();return;}
    const fresh=rows.filter(row=>row?.id&&!seen.has(row.id));
    if(!fresh.length)return;
    fresh.forEach(row=>seen.add(row.id));persistSecretSeen();
    showSecretReward(fresh.at(-1));
  }

  function weekStart(day){
    const [y,m,d]=String(day||'').split('-').map(Number);
    const date=new Date(y,m-1,d,12,0,0,0);
    if(Number.isNaN(date.getTime()))return day;
    const mondayOffset=(date.getDay()+6)%7;
    date.setDate(date.getDate()-mondayOffset);
    return P.dayKey(date);
  }
  function mentalStudyStats(sessions,today){
    const start=weekStart(today);let todaySeconds=0,weekSeconds=0;
    (sessions||[]).forEach(session=>{
      if(!session||session.deleted||session.deletedAt||P.normalizeActivityType(session.activityType)!=='mental')return;
      const seconds=Math.max(0,Number(session.seconds)||0);
      if(session.date===today)todaySeconds+=seconds;
      if(session.date>=start&&session.date<=today)weekSeconds+=seconds;
    });
    return {todaySeconds,weekSeconds};
  }

  function render(){
    const data=database(),content=doc.getElementById('studyIncentivesContent');if(!data||!content)return;
    const state=P.studyState(data),today=P.dayKey(),four=P.streakStats(state.sessions,today),five=P.excellenceStats(state.sessions,today),mental=mentalStudyStats(state.sessions,today);
    const since=P.effortStartDay(data),achievement=P.monthlyAchievements(state.sessions.filter(s=>s.date>=since),today).find(item=>item.month===today.slice(0,7)),snap=P.walletSnapshot(data),goal=P.activeGoal(data);
    const raw=state.sessions.filter(s=>s.date===today).reduce((sum,s)=>sum+Math.max(0,Number(s.seconds)||0),0);
    const habitats=(typeof root.habitAllChallenges==='function'?root.habitAllChallenges():data.habitChallenges||[]);
    const current=habitats.find(h=>!H.itemFor(h)?.complete&&!h.deleted),reward=current?H.rewardStatus(current):null;
    content.innerHTML=`<p class="study-incentives-intro">Hoy: <strong>${time(raw)} reales</strong> · ${time(four.todaySeconds)} equivalentes. Estudio normal y estudio mental cuentan al 100 %, clase de piano al 50 %, y cámara a un tercio.</p><p class="study-incentives-intro"><strong>Estudio mental:</strong> ${time(mental.todaySeconds)} hoy · ${time(mental.weekSeconds)} esta semana.</p>
      <div class="study-incentives-grid">${streakCard('Constancia · 4 horas',P.FULL_DAY_SECONDS,four)}${streakCard('Excelencia · 5 horas',P.EXCELLENT_DAY_SECONDS,five)}</div>
      <p class="study-incentives-rule">El descanso congela las rachas sin sumar días ni dinero. Entre cuatro y cinco horas mantienes la de excelencia; un día cerrado con estudio inferior a cuatro horas reinicia ambas. Las bonificaciones aumentan solo lo ganado ese día. Desde el 19 de septiembre, ambas rachas juntas tienen un límite de +50 %; el saldo anterior se conserva con sus reglas originales.</p>
      <details class="study-incentives-table"><summary>Ver las bonificaciones por días</summary><table><thead><tr><th>Días</th><th>≥4 h</th><th>≥5 h · combinado</th></tr></thead><tbody>${[1,2,3,5,7,10,14].map(n=>`<tr><td>${n===14?'14 o más':n}</td><td>${percent(P.streakMultiplier(n))}</td><td>${percent(P.combinedMultiplier(P.streakMultiplier(n),P.excellenceMultiplier(n)))}</td></tr>`).join('')}</tbody></table><p>Seis y siete horas generan más esfuerzo con la curva diaria. El límite de piano sigue en siete horas; no hay un tercer multiplicador de racha.</p></details>
      <details class="study-incentives-table"><summary>Curva diaria · puntos antes de rachas</summary><table><thead><tr><th>Horas equivalentes</th><th>Puntos acumulados</th></tr></thead><tbody>${[1,2,3,4,5,6,7].map(hours=>`<tr><td>${hours} h</td><td>${P.baseReward(hours*3600).toLocaleString('es-ES',{minimumFractionDigits:2})}</td></tr>`).join('')}</tbody></table><p>Desde el 19 de septiembre de 2026. El contador avanza cada segundo; cada hora ofrece una tarifa mayor, con hitos cada media hora. Máximo: 3,60 puntos diarios antes de rachas y 5,40 con el multiplicador máximo. Estudio mental cuenta al 100 %, clase de piano al 50 %, y cámara a un tercio. Una sesión ya iniciada conserva su política.</p></details>
      <article class="study-incentive-achievement ${achievement.points?'is-earned':''}">${H.artwork('excellence-month',!!achievement.points,'study')}<div><span>LOGRO DE ESTUDIO · CADA MES</span><h3>Un mes extraordinario</h3><p>Veinte días dentro del mismo mes natural. Puedes descansar entre ellos. El progreso muestra todo el mes; en septiembre de 2026 los días anteriores al 19 se conservan en el contador, aunque la nueva bonificación económica empieza el día 19.</p>${achievement.levels.map(level=>`<p><strong>${level.hours} h · ${Math.min(20,level.days)} / 20 días</strong> · ${level.points} puntos en total${goal?' · '+money(level.points*P.goalScale(goal))+' para '+esc(goal.name):''}${level.earned?' · Conseguido':''}</p><progress max="20" value="${Math.min(20,level.days)}" aria-label="Días del mes de ${level.hours} horas"></progress>`).join('')}<p class="study-incentive-reward">${achievement.points?achievement.points+' puntos abonados este mes.':'Premios: 10, 25 o 30 puntos.'} Solo se cobra el nivel mayor: subir de 10 a 25 añade 15; de 25 a 30 añade 5. El siguiente mes puedes conseguirlo otra vez.</p></div></article>
      <section class="study-incentive-habit"><span>HÁBITOS</span><h3>Un premio acordado al empezar</h3><p>Tres puntos por un ciclo de al menos veintiún días con todos los días cumplidos y un criterio fijado antes del inicio. Hacer: marca cada día. Evitar: si no registras una caída, ese día cuenta como cumplido.</p>${current?`<p><strong>${esc(current.title)}</strong> · ${reward.status==='none'?'Solo trofeo en este ciclo':reward.status==='failed'?'Premio no alcanzable en este ciclo; tu progreso se conserva':'3 puntos al completar todos los días'}</p>`:''}<p>Los hábitos anteriores conservan sus trofeos. El plazo por sí solo no concede dinero, y los ciclos simultáneos no duplican premios.</p></section>
      <section class="study-incentive-bonus-history"><h3>Premios de esfuerzo</h3>${snap.bonusRows.length?`<ul>${snap.bonusRows.map(row=>`<li><span>${esc(row.title)}<small>${esc(row.description||row.date)}${row.description?' · '+esc(row.date):''}</small></span><strong>${row.secretAchievement&&goal?'+'+money(secretEuro(row,goal)):'+'+P.rowEffortPoints(row)+' pts'}</strong></li>`).join('')}</ul>`:'<p>Aquí aparecerán tus premios cuando cumplas sus condiciones.</p>'}<p>Los premios secretos se descubren al conseguirlos. Entran en el mismo banco y su equivalencia en euros se adapta al objetivo activo.</p></section>`;
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
  const refresh=()=>{if(doc.getElementById('modalStudyIncentives')?.classList.contains('visible'))render();checkSecretRewards();};
  setTimeout(()=>checkSecretRewards({prime:true}),300);
  setInterval(()=>checkSecretRewards(),1800);
  doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')checkSecretRewards();});
  root.StudyIncentives={open,render,refresh,checkSecretRewards};
})(window);
