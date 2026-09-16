/* Presentación premium del cronómetro y taxímetro de piano. */
(function cronoRunningPremium(){
  'use strict';

  const STYLE_ID='cronoRunningPremiumEnhancements';
  const TAXI_POLL_MS=900;
  let queued=false;
  let taximeterQueued=false;
  let lastMultiplier=null;
  let levelTimer=null;

  function formatReadiness(){
    queued=false;
    const button=document.getElementById('cronoRunReadiness');
    if(!button || button.hidden || button.querySelector('.crono-readiness-copy')) return;
    const raw=String(button.textContent||'').replace(/\s+/g,' ').trim();
    if(!raw) return;
    const match=raw.match(/^(.*?)(?:\s*[·•]\s*)?(confianza\s+.+)$/i);
    const main=(match ? match[1] : raw).replace(/[·•]\s*$/,'').trim();
    const confidence=match ? match[2].trim() : '';
    button.setAttribute('aria-label',raw);
    button.innerHTML='<span class="crono-readiness-copy"></span>'+(confidence?'<span class="crono-readiness-confidence-chip"></span>':'');
    button.querySelector('.crono-readiness-copy').textContent=main;
    const conf=button.querySelector('.crono-readiness-confidence-chip');
    if(conf) conf.textContent=confidence;
  }

  function schedule(){
    if(queued) return;
    queued=true;
    requestAnimationFrame(formatReadiness);
  }

  function installTaximeterStyles(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      #view-cronometro #cronoPianoMoneyValue {
        display: inline-flex !important;
        align-items: baseline;
        justify-content: flex-start;
        gap: 0;
        white-space: nowrap;
      }
      #view-cronometro #cronoPianoMoneyValue .crono-money-major {
        color: inherit;
        font: inherit;
        letter-spacing: inherit;
      }
      #view-cronometro #cronoPianoMoneyValue .crono-money-micro {
        margin-left: .08em;
        color: color-mix(in srgb, currentColor 66%, var(--text3));
        font-size: .56em;
        font-weight: 680;
        letter-spacing: .015em;
        opacity: .82;
      }
      #view-cronometro #cronoPianoMoneyValue .crono-money-currency {
        margin-left: .20em;
        color: color-mix(in srgb, currentColor 60%, var(--text3));
        font-size: .50em;
        font-weight: 700;
        letter-spacing: 0;
        opacity: .75;
      }
      #view-cronometro .crono-piano-multiplier-meter {
        display: grid;
        grid-template-columns: minmax(0,1fr) auto;
        align-items: center;
        gap: 10px;
        min-width: 0;
        margin-top: -2px;
      }
      #view-cronometro .crono-piano-multiplier-track {
        position: relative;
        height: 5px;
        overflow: hidden;
        border-radius: 99px;
        background: color-mix(in srgb, var(--accent) 9%, var(--bg3));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border2) 70%, transparent);
      }
      #view-cronometro .crono-piano-multiplier-track i {
        display: block;
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg,
          color-mix(in srgb, var(--green) 72%, white),
          var(--green) 64%,
          color-mix(in srgb, var(--accent) 70%, var(--green)));
        box-shadow: 0 0 13px color-mix(in srgb, var(--green) 56%, transparent);
        transition: width 520ms linear, filter 220ms ease;
      }
      #view-cronometro .crono-piano-multiplier-value {
        min-width: 56px;
        color: var(--green);
        font: 800 13px/1 'JetBrains Mono', monospace;
        letter-spacing: -.04em;
        text-align: right;
        transform-origin: 100% 50%;
        text-shadow: 0 0 12px color-mix(in srgb, var(--green) 24%, transparent);
      }
      #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-track {
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--green) 38%, transparent),
          0 0 20px color-mix(in srgb, var(--green) 30%, transparent);
      }
      #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-track i {
        filter: brightness(1.42) saturate(1.22);
      }
      #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-value {
        animation: cronoMultiplierLevelUp 980ms cubic-bezier(.18,.9,.22,1);
      }
      #view-cronometro .crono-piano-money > footer {
        display: none !important;
      }
      @keyframes cronoMultiplierLevelUp {
        0% { transform: scale(1); color: var(--green); text-shadow: 0 0 12px color-mix(in srgb, var(--green) 24%, transparent); }
        18% { transform: scale(1.46) translateY(-1px); color: #fff; text-shadow: 0 0 5px #fff, 0 0 18px var(--green), 0 0 34px color-mix(in srgb, var(--accent) 80%, var(--green)); }
        42% { transform: scale(1.27); color: color-mix(in srgb, #fff 70%, var(--green)); text-shadow: 0 0 6px #fff, 0 0 22px var(--green); }
        72% { transform: scale(1.08); }
        100% { transform: scale(1); color: var(--green); text-shadow: 0 0 12px color-mix(in srgb, var(--green) 24%, transparent); }
      }
      @media (max-width: 520px) {
        #view-cronometro .crono-piano-multiplier-meter { gap: 8px; }
        #view-cronometro .crono-piano-multiplier-value { min-width: 50px; font-size: 12px; }
      }
      @media (prefers-reduced-motion: reduce) {
        #view-cronometro .crono-piano-multiplier-track i { transition: none; }
        #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-value { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function parseMoney(text){
    const raw=String(text||'').replace(/\s*€\s*$/,'').trim();
    if(!raw) return null;
    const normalized=raw.replace(/\./g,'').replace(',','.');
    const value=Number(normalized);
    return Number.isFinite(value)?value:null;
  }

  function formatMoneyDisplay(){
    const el=document.getElementById('cronoPianoMoneyValue');
    if(!el || el.querySelector('.crono-money-major')) return;
    const value=parseMoney(el.textContent);
    if(value==null) return;
    const fixed=Math.max(0,value).toFixed(6);
    const parts=fixed.split('.');
    const decimals=(parts[1]||'').padEnd(6,'0');
    const major=parts[0]+','+decimals.slice(0,2);
    const micro=decimals.slice(2,6);
    const readable=major+' '+micro+' euros';
    el.innerHTML='<span class="crono-money-major"></span><span class="crono-money-micro"></span><span class="crono-money-currency">€</span>';
    el.querySelector('.crono-money-major').textContent=major;
    el.querySelector('.crono-money-micro').textContent='·'+micro;
    el.setAttribute('aria-label',readable);
  }

  /* El saldo visible nunca redondea hacia arriba. La economía sigue trabajando
     en microeuros; aquí sólo convertimos a céntimos COMPLETAMENTE ganados. */
  function floorToEarnedCents(value){
    const micros=Math.max(0,Math.round((Number(value)||0)*1e6));
    const wholeCents=Math.floor(micros/10000);
    return wholeCents/100;
  }

  function formatEarnedCents(value){
    return new Intl.NumberFormat('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}).format(floorToEarnedCents(value));
  }

  function formatTargetCents(value){
    return new Intl.NumberFormat('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.max(0,Number(value)||0));
  }

  function refreshGoalBalanceDisplay(){
    try{
      if(typeof PianoRewards==='undefined' || typeof GermanRewards==='undefined' || typeof db==='undefined') return;
      const german=db.germanStudy||{};
      const goals=Array.isArray(german.goals)?german.goals:[];
      const germanRows=GermanRewards.ledger(Array.isArray(german.sessions)?german.sessions:[],goals);
      const rewardState=PianoRewards.studyState(db);
      const date=PianoRewards.dayKey();

      const idleGoal=PianoRewards.activeGoal(db);
      const idleBalance=document.getElementById('cronoPianoIdleGoalBalance');
      if(idleGoal && idleBalance){
        const idleLive=PianoRewards.live(rewardState,goals,idleGoal.id,0,date,germanRows);
        const earned=Math.max(0,idleGoal.amount-idleLive.goalRemaining);
        idleBalance.textContent=formatEarnedCents(earned)+' € de '+formatTargetCents(idleGoal.amount)+' €';
      }

      const activeBalance=document.getElementById('cronoPianoGoalBalance');
      if(activeBalance && typeof crono!=='undefined' && crono.rewardGoalId){
        const goal=goals.find(item=>item && item.id===crono.rewardGoalId && !item.deletedAt);
        if(goal){
          const elapsed=typeof cronoEffectiveElapsedMs==='function'?Math.max(0,cronoEffectiveElapsedMs()/1000):0;
          const live=PianoRewards.live(
            rewardState,
            goals,
            crono.rewardGoalId,
            elapsed,
            date,
            germanRows,
            crono.rewardPolicyVersion || PianoRewards.CONFIG.version
          );
          const earned=Math.max(0,goal.amount-live.goalRemaining);
          activeBalance.textContent=formatEarnedCents(earned)+' € / '+formatTargetCents(goal.amount)+' €';
        }
      }
    }catch(error){}
  }

  function installRewardUpdateWrapper(){
    try{
      if(typeof cronoUpdatePianoReward!=='function' || cronoUpdatePianoReward.__earnedCentFloor) return;
      const original=cronoUpdatePianoReward;
      const wrapped=function(){
        const result=original.apply(this,arguments);
        refreshGoalBalanceDisplay();
        return result;
      };
      wrapped.__earnedCentFloor=true;
      cronoUpdatePianoReward=wrapped;
    }catch(error){}
  }

  function ensureMultiplierMeter(){
    const meter=document.getElementById('cronoPianoMoney');
    if(!meter) return null;
    let row=document.getElementById('cronoPianoMultiplierMeter');
    if(row) return row;
    row=document.createElement('div');
    row.className='crono-piano-multiplier-meter';
    row.id='cronoPianoMultiplierMeter';
    row.setAttribute('role','progressbar');
    row.setAttribute('aria-label','Progreso hacia el siguiente multiplicador');
    row.setAttribute('aria-valuemin','0');
    row.setAttribute('aria-valuemax','100');
    row.innerHTML='<div class="crono-piano-multiplier-track" aria-hidden="true"><i id="cronoPianoMultiplierFill"></i></div><strong class="crono-piano-multiplier-value" id="cronoPianoMultiplierValue">×1,00</strong>';
    const goalBar=meter.querySelector('.crono-piano-goal-progress');
    if(goalBar && goalBar.parentNode===meter) goalBar.insertAdjacentElement('afterend',row);
    else meter.appendChild(row);
    return row;
  }

  function currentRewardLive(){
    try{
      if(typeof PianoRewards==='undefined' || typeof db==='undefined') return null;
      const state=PianoRewards.studyState(db);
      const goals=(db && db.germanStudy && Array.isArray(db.germanStudy.goals))?db.germanStudy.goals:[];
      const activeCronoGoal=(typeof crono!=='undefined'&&crono.rewardGoalId)?goals.find(item=>item&&item.id===crono.rewardGoalId):null;
      const goal=activeCronoGoal||PianoRewards.activeGoal(db);
      const elapsed=typeof cronoEffectiveElapsedMs==='function'?Math.max(0,cronoEffectiveElapsedMs()/1000):0;
      const date=typeof PianoRewards.dayKey==='function'?PianoRewards.dayKey():undefined;
      const policyVersion=(typeof crono!=='undefined'&&Number(crono.rewardPolicyVersion))||PianoRewards.CONFIG.version;
      return PianoRewards.live(state,goals,goal?goal.id:null,elapsed,date,[],policyVersion);
    }catch(error){
      return null;
    }
  }

  function multiplierLabel(value){
    const digits=value>=10?1:2;
    return '×'+value.toFixed(digits).replace('.',',');
  }

  /* La barra ya no representa cuánto llevas de la escala total. Representa
     TIEMPO dentro del tramo actual de la curva: se llena de 0→100 % y, al
     cruzar el siguiente punto de media hora, reinicia y sube el multiplicador
     efectivo de velocidad de recompensa. El multiplicador se deriva de la
     pendiente real de la curva, así que no altera ni inventa dinero. */
  function rewardTierState(live){
    const policyVersion=(live&&Number(live.policyVersion))||((typeof crono!=='undefined'&&Number(crono.rewardPolicyVersion))||PianoRewards.CONFIG.version);
    const policy=(PianoRewards.POLICIES&&PianoRewards.POLICIES[policyVersion])||PianoRewards.CONFIG;
    const points=Array.isArray(policy&&policy.curve)?policy.curve:[];
    if(points.length<2) return {progress:0,multiplier:1,atCap:false,startSeconds:0,endSeconds:0};

    const seconds=Math.max(0,Number(live&&live.seconds)||0);
    let endIndex=-1;
    for(let i=1;i<points.length;i++){
      if(seconds<Number(points[i][0])){ endIndex=i; break; }
    }

    const normal=Math.max(1,Number(live&&live.streakMultiplier)||1);
    const excellent=Math.max(1,Number(live&&live.excellenceMultiplier)||1);
    const streakBoost=normal*excellent;
    const firstDx=Math.max(1,Number(points[1][0])-Number(points[0][0]));
    const firstSlope=(Number(points[1][1])-Number(points[0][1]))/firstDx;

    if(endIndex<0){
      const start=points[points.length-2],end=points[points.length-1];
      const dx=Math.max(1,Number(end[0])-Number(start[0]));
      const slope=(Number(end[1])-Number(start[1]))/dx;
      const tierMultiplier=firstSlope>0?slope/firstSlope:1;
      return {progress:100,multiplier:tierMultiplier*streakBoost,atCap:true,startSeconds:Number(start[0]),endSeconds:Number(end[0])};
    }

    const start=points[endIndex-1],end=points[endIndex];
    const startSeconds=Number(start[0])||0,endSeconds=Number(end[0])||startSeconds;
    const span=Math.max(1,endSeconds-startSeconds);
    const progress=Math.max(0,Math.min(100,(seconds-startSeconds)/span*100));
    const slope=(Number(end[1])-Number(start[1]))/span;
    const tierMultiplier=firstSlope>0?slope/firstSlope:1;
    return {progress,multiplier:tierMultiplier*streakBoost,atCap:false,startSeconds,endSeconds};
  }

  function refreshMultiplier(){
    const row=ensureMultiplierMeter();
    if(!row) return;
    const live=currentRewardLive();
    const state=rewardTierState(live);
    const fill=document.getElementById('cronoPianoMultiplierFill');
    const value=document.getElementById('cronoPianoMultiplierValue');
    if(fill) fill.style.width=state.progress.toFixed(2)+'%';
    if(value) value.textContent=multiplierLabel(state.multiplier);
    row.setAttribute('aria-valuenow',state.progress.toFixed(1));
    row.setAttribute('aria-valuetext',state.atCap
      ? 'Nivel máximo, multiplicador '+state.multiplier.toFixed(2)
      : 'Progreso '+Math.round(state.progress)+' por ciento, multiplicador '+state.multiplier.toFixed(2));
    row.title=state.atCap?'Nivel máximo':'Progreso al siguiente nivel';

    if(lastMultiplier!=null && state.multiplier>lastMultiplier+0.0005){
      row.classList.remove('is-level-up');
      void row.offsetWidth;
      row.classList.add('is-level-up');
      clearTimeout(levelTimer);
      levelTimer=setTimeout(()=>row.classList.remove('is-level-up'),1050);
    }
    lastMultiplier=state.multiplier;
  }

  function refreshTaximeter(){
    taximeterQueued=false;
    installTaximeterStyles();
    formatMoneyDisplay();
    refreshGoalBalanceDisplay();
    refreshMultiplier();
  }

  function scheduleTaximeter(){
    if(taximeterQueued) return;
    taximeterQueued=true;
    requestAnimationFrame(refreshTaximeter);
  }

  function bootTaximeter(){
    const meter=document.getElementById('cronoPianoMoney');
    const value=document.getElementById('cronoPianoMoneyValue');
    if(!meter || !value){ setTimeout(bootTaximeter,140); return; }
    installTaximeterStyles();
    installRewardUpdateWrapper();
    ensureMultiplierMeter();
    scheduleTaximeter();
    new MutationObserver(scheduleTaximeter).observe(value,{childList:true,subtree:true,characterData:true});
    setInterval(scheduleTaximeter,TAXI_POLL_MS);
  }

  function boot(){
    const button=document.getElementById('cronoRunReadiness');
    if(button){
      schedule();
      new MutationObserver(schedule).observe(button,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
    }else{
      setTimeout(()=>{
        const late=document.getElementById('cronoRunReadiness');
        if(late){
          schedule();
          new MutationObserver(schedule).observe(late,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
        }
      },150);
    }
    bootTaximeter();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
