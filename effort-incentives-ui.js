/* Pantalla Premios: rachas, tarifas, logros y movimientos.
   Las cantidades se proyectan del historial canónico: abrir esta pantalla nunca
   genera créditos ni escribe un segundo ledger. La hucha y los objetivos de
   compra los pinta PianoRewards en #germanSharedGoal, dentro de la misma vista. */
(function(root){
  'use strict';
  const P=root.PianoRewards,H=root.HabitTrophies,A=root.AchievementRewards,G=root.GermanRewards,doc=root.document;
  if(!P||!H||!doc)return;
  const SECRET_SEEN_KEY='study_secret_bonus_seen_v1';
  let secretToastTimer=null,secretSeenMemory=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=seconds=>{const mins=Math.floor(Math.max(0,seconds)/60);return Math.floor(mins/60)+' h '+String(mins%60).padStart(2,'0')+' min';};
  const percent=multiplier=>'+'+((multiplier-1)*100).toLocaleString('es-ES',{maximumFractionDigits:1})+' %';
  const money=amount=>Number(amount).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const pts=value=>Number(value).toLocaleString('es-ES',{maximumFractionDigits:2})+' pts';
  const dateLabel=day=>{const [y,m,d]=String(day||'').split('-').map(Number);if(!y)return '';return new Date(y,m-1,d).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'});};
  function database(){try{return db;}catch(error){return root.db;}}

  // Rows that deserve a celebration when they first appear.
  const celebrated=row=>row&&(row.secretAchievement||row.chest||row.achievement||row.progress);
  function kicker(row){return row.chest?'COFRE SORPRESA':row.achievement?'LOGRO DESBLOQUEADO':row.progress?'PREMIO POR PROGRESO':'PREMIO SECRETO';}
  function secretSeen(){
    if(secretSeenMemory)return secretSeenMemory;
    try{const raw=root.localStorage?.getItem(SECRET_SEEN_KEY);secretSeenMemory=new Set(raw?JSON.parse(raw):[]);}
    catch(error){secretSeenMemory=new Set();}
    return secretSeenMemory;
  }
  function persistSecretSeen(){try{root.localStorage?.setItem(SECRET_SEEN_KEY,JSON.stringify([...secretSeen()]));}catch(error){}}
  function currentCelebratedRows(){
    const data=database();if(!data)return [];
    try{return P.walletSnapshot(data).bonusRows.filter(celebrated);}catch(error){return [];}
  }
  function rowEuro(row,goal){return goal?P.rowEffortPoints(row)*P.goalScale(goal):0;}
  function showSecretReward(row){
    const data=database(),goal=data?P.activeGoal(data):null;
    doc.getElementById('studySecretRewardToast')?.remove();
    const toast=doc.createElement('div');
    toast.id='studySecretRewardToast';toast.className='study-secret-reward-toast';
    toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
    const reward=goal?'<strong>+'+money(rowEuro(row,goal))+'</strong><small>para '+esc(goal.name)+'</small>':'<strong>+'+pts(P.rowEffortPoints(row))+'</strong>';
    const cleanTitle=String(row.title||'').replace(/^\p{Extended_Pictographic}\S*\s/u,'');
    toast.innerHTML='<span>'+kicker(row)+'</span><div class="study-secret-reward-title"><b>'+esc(row.icon||(row.progress?'📈':'✦'))+'</b><h3>'+esc(cleanTitle)+'</h3></div><p>'+esc(row.description||(row.chest?'Un bloque de estudio escondía un premio.':'Has desbloqueado un premio de esfuerzo.'))+'</p><div class="study-secret-reward-amount">'+reward+'</div>';
    doc.body.appendChild(toast);
    requestAnimationFrame(()=>toast.classList.add('is-visible'));
    const close=()=>{toast.classList.remove('is-visible');setTimeout(()=>toast.remove(),260);};
    toast.addEventListener('click',close,{once:true});
    clearTimeout(secretToastTimer);secretToastTimer=setTimeout(close,6500);
  }
  function checkSecretRewards({prime=false}={}){
    const rows=currentCelebratedRows(),seen=secretSeen();
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
    date.setDate(date.getDate()-((date.getDay()+6)%7));
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

  function streakSection(four,unified){
    const done=four.fullDay,remaining=Math.max(0,P.FULL_DAY_SECONDS-four.todaySeconds);
    const next=done?four.today:four.current+1;
    const status=done?'✓ Hoy ya cuenta: '+four.today+' días seguidos.'
      :four.current>0&&unified?'Hoy llevas '+time(four.todaySeconds)+'. Te faltan '+time(remaining)+' para sumar el día '+next+'.'+(four.graceDaysLeft<3?' Margen: '+four.graceDaysLeft+' día'+(four.graceDaysLeft===1?'':'s')+' antes de perderla.':'')
      :'Hoy llevas '+time(four.todaySeconds)+'. Con '+time(remaining)+' más empiezas o sigues tu racha.';
    return `<section class="premios-card premios-streak" aria-labelledby="premiosStreakTitle">
      <span class="premios-kicker">TU RACHA</span>
      <div class="premios-streak-main"><strong id="premiosStreakDays">${four.current}</strong><div><h3 id="premiosStreakTitle">días completos seguidos</h3><p>${esc(status)}</p></div></div>
      <progress max="${P.FULL_DAY_SECONDS}" value="${Math.min(P.FULL_DAY_SECONDS,four.todaySeconds)}" aria-label="Progreso de hoy hacia 4 horas"></progress>
      <div class="premios-boosts"><div><span>Día de 4 h</span><b>${percent(P.streakMultiplier(next))}</b></div><div><span>Día de 5 h o más</span><b>${percent(P.combinedMultiplier(P.streakMultiplier(next),P.excellenceMultiplier(next)))}</b></div></div>
      <ul class="premios-rules">
        <li><b>Suma</b> cada día con 4 h equivalentes. Cuantos más días seguidos, más vale lo que ganas ese día.</li>
        <li><b>Se congela</b> un día con menos de 4 h o sin estudiar: ni suma ni se pierde. Estudiar poco nunca es peor que no estudiar.</li>
        <li><b>Se rompe</b> solo si pasan 3 días seguidos sin un día completo.</li>
        <li>Un día de 5 h o más multiplica más, con un máximo de +50 %.</li>
      </ul>
      <details class="study-incentives-table"><summary>Ver la tabla de bonificaciones</summary><table><thead><tr><th>Días seguidos</th><th>Día de 4 h</th><th>Día de 5 h</th></tr></thead><tbody>${[1,2,3,5,7,10,14].map(n=>`<tr><td>${n===14?'14 o más':n}</td><td>${percent(P.streakMultiplier(n))}</td><td>${percent(P.combinedMultiplier(P.streakMultiplier(n),P.excellenceMultiplier(n)))}</td></tr>`).join('')}</tbody></table></details>
    </section>`;
  }

  function earningSection(data,goal,mental,mentalBonusRemaining,today){
    const german=data.germanStudy?.sessions||[];
    let germanPolicy=null;try{germanPolicy=G?G.policyForDay(german,today):null;}catch(error){germanPolicy=null;}
    const germanRows=germanPolicy?[15,30,45,60].map(m=>`<tr><td>${m} min</td><td>${pts(G.baseReward(m*60,germanPolicy))}</td></tr>`).join(''):'';
    return `<section class="premios-card" aria-labelledby="premiosEarnTitle">
      <span class="premios-kicker">CÓMO SE GANA</span><h3 id="premiosEarnTitle">Puntos de esfuerzo${goal?' · 1 punto = '+money(P.goalScale(goal))+' para '+esc(goal.name):''}</h3>
      <p>Todo va a una misma hucha de puntos. Los euros son la equivalencia de esos puntos en el objetivo de compra que elijas.</p>
      <div class="premios-earn-grid">
        <div><h4>Piano · por día</h4><table><tbody>${[1,2,3,4,5,6,7].map(h=>`<tr><td>${h} h</td><td>${pts(P.baseReward(h*3600))}</td></tr>`).join('')}</tbody></table><small>Cada hora vale más que la anterior. Máximo diario: 7 h. La racha multiplica encima.</small></div>
        ${germanRows?`<div><h4>Alemán · por día</h4><table><tbody>${germanRows}</tbody></table><small>Mínimo 15 min. Hasta 1 h diaria.</small></div>`:''}
      </div>
      <ul class="premios-rules">
        <li>Estudio y estudio mental cuentan al 100 %; clase de piano y cámara, al 50 %.</li>
        <li>Estudio mental: +10 % en los primeros 45 min de cada día. Hoy: ${time(mental.todaySeconds)}${mentalBonusRemaining?' · quedan '+time(mentalBonusRemaining)+' bonificables':' · bonus completado'}.</li>
      </ul>
    </section>`;
  }

  function monthSection(achievement,goal){
    return `<section class="premios-card study-incentive-achievement ${achievement.points?'is-earned':''}">${H.artwork('excellence-month',!!achievement.points,'study')}<div><span class="premios-kicker">ESTE MES</span><h3>Un mes extraordinario</h3><p>20 días del mes con 4, 5 o 6 horas. Puedes descansar entre ellos; cada mes empieza de nuevo.</p>${achievement.levels.map(level=>`<p><strong>${level.hours} h · ${Math.min(20,level.days)} / 20 días</strong> · ${level.points} pts${goal?' · '+money(level.points*P.goalScale(goal)):''}${level.earned?' · ✓':''}</p><progress max="20" value="${Math.min(20,level.days)}" aria-label="Días del mes de ${level.hours} horas"></progress>`).join('')}<p class="study-incentive-reward">${achievement.points?achievement.points+' puntos abonados este mes.':'Solo se cobra el nivel más alto: 10, 25 o 30 puntos.'}</p></div></section>`;
  }

  function achievementsSection(data,snap,today){
    const lifetime=typeof P.lifetimeMinutes==='function'?P.lifetimeMinutes(data,today):{};
    const list=A?A.achievements(data,lifetime,today):[];
    const secrets=Object.values(P.SECRET_BONUSES||{});
    const found=new Set(snap.bonusRows.filter(r=>r.secretAchievement).map(r=>r.secretId));
    const progress=A?[
      ['📈','Obra sólida','Una obra o movimiento sube al 80 % de solidez por primera vez.',A.POINTS.solidWork],
      ['🎯','Pasaje dominado','Un pasaje llega al 85 %.',A.POINTS.masteredPassage],
      ['✨','Cinco destellos','Cinco sesiones destello en el mismo mes.',A.POINTS.flashMonth],
      ['🎭','Evento preparado','Todas las obras de un evento al 80 % el día del evento.',A.POINTS.preparedEvent]
    ]:[];
    return `<section class="premios-card" aria-labelledby="premiosAchievementsTitle">
      <span class="premios-kicker">LOGROS</span><h3 id="premiosAchievementsTitle">Premios por progreso</h3>
      <p>No solo cuentan las horas: también se premia estudiar bien.</p>
      <ul class="premios-list">${progress.map(([icon,title,text,value])=>`<li><b>${icon}</b><span><strong>${title}</strong><small>${text}</small></span><em>+${pts(value)}</em></li>`).join('')}</ul>
      ${A?`<div class="premios-chest"><b>🎁</b><p><strong>Cofres sorpresa.</strong> Cada bloque de estudio de 45 min o más tiene 1 posibilidad entre ${A.CHEST_ODDS} de esconder un cofre de 0,2 a 1 punto. Nunca sabes cuándo.</p></div>`:''}
      <h3 class="premios-subtitle">Premios secretos del día</h3>
      <ul class="premios-list">${secrets.map(s=>found.has(s.id)?`<li><b>${esc(s.icon)}</b><span><strong>${esc(s.title)}</strong><small>${esc(s.description)}</small></span></li>`:`<li class="is-hidden"><b>?</b><span><strong>???</strong><small>Tiene que ver con cómo organizas tu día.</small></span></li>`).join('')}</ul>
      ${list.length?`<h3 class="premios-subtitle">Logros ocultos · ${list.filter(a=>a.earned).length}/${list.length}</h3>
      <div class="premios-trophies">${list.map(a=>a.earned?`<article class="premios-trophy is-earned"><b>${esc(a.icon)}</b><strong>${esc(a.title)}</strong><small>${esc(a.description)}</small><em>${dateLabel(a.date)}${a.paid?' · +'+pts(a.points):''}</em></article>`:`<article class="premios-trophy"><b>?</b><strong>???</strong><small>${esc(a.hint)}</small></article>`).join('')}</div>`:''}
    </section>`;
  }

  function habitSection(current,reward){
    return `<section class="premios-card study-incentive-habit"><span class="premios-kicker">HÁBITOS</span><h3>Premio en juego</h3><p>Un ciclo de 21 días o más con criterio de éxito vale hasta 3 puntos: <strong>0 caídas = 3 · 1 = 1,5 · 2 = 0,75 · 3 o más = 0</strong>. El ciclo no se reinicia al caer; solo baja el premio.</p>${current?`<p><strong>${esc(current.title)}</strong> · ${reward.status==='none'?'Solo trofeo en este ciclo':reward.status==='earned'?reward.points+' puntos conseguidos':reward.status==='failed'?'Premio agotado; el reto continúa':'En juego: '+reward.potentialPoints.toLocaleString('es-ES',{maximumFractionDigits:2})+' pts · '+reward.item.failure+' caída'+(reward.item.failure===1?'':'s')}</p>`:''}</section>`;
  }

  function historySection(snap,goal){
    const rows=snap.bonusRows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,40);
    return `<section class="premios-card study-incentive-bonus-history"><span class="premios-kicker">MOVIMIENTOS</span><h3>Premios de esfuerzo</h3>${rows.length?`<ul>${rows.map(row=>`<li><span>${esc(row.title)}<small>${dateLabel(row.date)}${row.description?' · '+esc(row.description):''}</small></span><strong>${goal?'+'+money(rowEuro(row,goal)):'+'+pts(P.rowEffortPoints(row))}</strong></li>`).join('')}</ul>`:'<p>Aquí aparecerán tus premios cuando cumplas sus condiciones.</p>'}${(snap.wallet?.redemptions||[]).length?`<h3 class="premios-subtitle">Canjeados</h3><ul>${snap.wallet.redemptions.slice().reverse().map(r=>`<li><span>${esc(r.goalName||'Objetivo')}<small>${dateLabel(String(r.createdAt||'').slice(0,10))}</small></span><strong>${money(r.amount||0)}</strong></li>`).join('')}</ul>`:''}</section>`;
  }

  function render(){
    const data=database(),content=doc.getElementById('studyIncentivesContent');if(!data||!content)return;
    const state=P.studyState(data),today=P.dayKey(),four=P.streakStats(state.sessions,today),mental=mentalStudyStats(state.sessions,today);
    const mentalBonusUsed=today>=P.MENTAL_BONUS_START_DAY?Math.min(P.MENTAL_BONUS_CAP_SECONDS,mental.todaySeconds):0;
    const mentalBonusRemaining=today>=P.MENTAL_BONUS_START_DAY?Math.max(0,P.MENTAL_BONUS_CAP_SECONDS-mentalBonusUsed):0;
    const since=P.effortStartDay(data),achievement=P.monthlyAchievements(state.sessions.filter(s=>s.date>=since),today).find(item=>item.month===today.slice(0,7));
    const snap=P.walletSnapshot(data),goal=P.activeGoal(data);
    const habitats=(typeof root.habitAllChallenges==='function'?root.habitAllChallenges():data.habitChallenges||[]);
    const current=habitats.find(h=>!H.itemFor(h)?.complete&&!h.deleted),reward=current?H.rewardStatus(current):null;
    content.innerHTML=`<div class="ajustes-group-label">Rachas y tarifas</div>
      ${streakSection(four,four.unified!==false)}
      ${earningSection(data,goal,mental,mentalBonusRemaining,today)}
      <div class="ajustes-group-label">Logros</div>
      ${monthSection(achievement,goal)}
      ${achievementsSection(data,snap,today)}
      ${habitSection(current,reward)}
      <div class="ajustes-group-label">Historial</div>
      ${historySection(snap,goal)}`;
  }
  const premiosVisible=()=>doc.getElementById('view-premios')?.classList.contains('active');
  // Kept for existing buttons ("Rachas y logros de estudio"): they open Premios.
  function open(){
    if(typeof root.openPremios==='function')root.openPremios();
    else render();
    setTimeout(()=>doc.getElementById('studyIncentivesContent')?.scrollIntoView({behavior:'smooth',block:'start'}),0);
  }
  doc.addEventListener('click',event=>{
    if(event.target.closest('[data-open-study-incentives]'))open();
  });
  const refresh=()=>{if(premiosVisible()){render();root.PianoRewardsWallet?.render?.();}checkSecretRewards();};
  setTimeout(()=>checkSecretRewards({prime:true}),300);
  setInterval(()=>checkSecretRewards(),1800);
  doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')checkSecretRewards();});
  root.StudyIncentives={open,render,refresh,checkSecretRewards};
})(window);
