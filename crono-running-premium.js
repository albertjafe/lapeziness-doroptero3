/* Presentación premium del cronómetro, taxímetro y tipo de práctica de piano. */
(function cronoRunningPremium(){
  'use strict';

  const STYLE_ID='cronoRunningPremiumEnhancements';
  const TAXI_POLL_MS=900;
  const ACTIVITY_STORAGE_KEY='piano_activity_type_v1';
  const ACTIVITY_TYPES={
    study:{label:'Estudio',factor:1,short:'×1'},
    mental:{label:'Mental',factor:1,short:'×1'},
    piano_class:{label:'Clase piano',factor:.5,short:'×0,5'},
    chamber:{label:'Cámara',factor:1/3,short:'×0,33'}
  };
  let queued=false;
  let taximeterQueued=false;
  let lastMultiplier=null;
  let levelTimer=null;
  let selectedActivityType='study';
  let lastCronoState=null;

  function normalizeActivityType(value){
    const key=String(value||'study');
    return ACTIVITY_TYPES[key]?key:'study';
  }

  function currentCrono(){
    try{return typeof crono!=='undefined'?crono:null;}catch(error){return null;}
  }

  function setRuntimeActivity(type){
    const state=currentCrono();
    if(state && state.state!=='idle')type=state.activityType || 'study';
    selectedActivityType=normalizeActivityType(type);
    try{globalThis.__PIANO_ACTIVITY_TYPE__=selectedActivityType;}catch(error){}
    document.querySelectorAll('#cronoActivitySelector .crono-activity-tab').forEach(button=>{
      const active=button.dataset.activityType===selectedActivityType;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
    });
    const select=document.getElementById('cronoActivityType');
    if(select && select.value!==selectedActivityType)select.value=selectedActivityType;
    if(state && state.state==='idle' && typeof cronoUpdatePianoReward==='function')cronoUpdatePianoReward();
    scheduleTaximeter();
  }

  function readStoredActivity(){
    try{
      const parsed=JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY)||'null');
      return parsed&&typeof parsed==='object'?parsed:null;
    }catch(error){return null;}
  }

  function chooseActivity(type){
    // A new idle selection wins over the previous run's delayed UI refresh.
    if(currentCrono()?.state==='idle')lastCronoState='idle';
    setRuntimeActivity(type);
  }

  function persistActiveActivity(){
    const state=currentCrono();
    if(!state || state.state==='idle')return;
    try{
      localStorage.setItem(ACTIVITY_STORAGE_KEY,JSON.stringify({type:selectedActivityType,runId:state.runId||null,savedAt:Date.now()}));
    }catch(error){}
  }

  function clearStoredActivity(){
    try{localStorage.removeItem(ACTIVITY_STORAGE_KEY);}catch(error){}
  }

  function syncActivityWithCrono(){
    const state=currentCrono();
    if(!state)return;
    const nowState=String(state.state||'idle');
    if(lastCronoState===null){
      if(nowState!=='idle'){
        const stored=readStoredActivity();
        setRuntimeActivity(state.activityType || (stored?.runId===state.runId ? stored.type : 'study'));
        persistActiveActivity();
      }else setRuntimeActivity('study');
      lastCronoState=nowState;
      return;
    }
    if(lastCronoState==='idle' && nowState!=='idle'){
      setRuntimeActivity(state.activityType);
      persistActiveActivity();
    }
    if(lastCronoState!=='idle' && nowState==='idle'){
      clearStoredActivity();
      setRuntimeActivity('study');
    }
    lastCronoState=nowState;
  }

  function installStartWrapper(){
    try{
      if(typeof cronoStart!=='function' || cronoStart.__activityTypeAware)return;
      const original=cronoStart;
      const wrapped=function(){
        setRuntimeActivity(selectedActivityType);
        const result=original.apply(this,arguments);
        const persist=()=>{syncActivityWithCrono();persistActiveActivity();};
        if(result&&typeof result.then==='function')result.finally(persist);
        else queueMicrotask(persist);
        return result;
      };
      wrapped.__activityTypeAware=true;
      cronoStart=wrapped;
    }catch(error){}
  }

  function ensureActivitySelector(){
    const idle=document.getElementById('cronoStageIdle');
    if(!idle)return null;
    let selector=document.getElementById('cronoActivitySelector');
    if(selector)return selector;
    const controls=idle.querySelector('.crono-idle-controls');
    const ipad=document.documentElement.classList.contains('platform-ipad');
    selector=document.createElement('div');
    selector.id='cronoActivitySelector';
    selector.className='crono-start-control crono-activity-control';
    selector.innerHTML=ipad ?
      '<label class="crono-start-control-label" for="cronoActivityType">Tipo de sesión</label>'+
      '<select id="cronoActivityType" aria-label="Tipo de sesión de piano">'+
        Object.entries(ACTIVITY_TYPES).map(([type,item])=>
          '<option value="'+type+'">'+item.label+' · '+item.short+'</option>'
        ).join('')+
      '</select>' :
      '<div class="crono-start-control-label">Tipo de sesión</div><div class="crono-activity-tabs" role="group" aria-label="Tipo de sesión de piano">'+
      Object.entries(ACTIVITY_TYPES).map(([type,item])=>'<button type="button" class="crono-activity-tab" data-activity-type="'+type+'" aria-pressed="false" title="'+item.label+': cada hora cuenta como '+item.short+' horas equivalentes"><span>'+item.label+'</span><small>'+item.short+'</small></button>').join('')+'</div>';
    selector.querySelector('select')?.addEventListener('change',event=>chooseActivity(event.target.value));
    selector.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>chooseActivity(button.dataset.activityType)));
    if(controls && ipad){
      controls.prepend(selector);
    }else if(controls){
      controls.insertAdjacentElement('beforebegin',selector);
    }else{
      const consoleBox=idle.querySelector('.crono-idle-console, .crono-idle-main')||idle;
      consoleBox.appendChild(selector);
    }
    setRuntimeActivity(selectedActivityType);
    return selector;
  }

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
      #view-cronometro .crono-activity-control {
        display: grid;
        gap: 5px;
        min-width: 0;
      }
      #view-cronometro .crono-activity-tabs {
        display: grid;
        grid-template-columns: repeat(4,minmax(0,1fr));
        gap: 4px;
        min-width: 0;
        padding: 3px;
        border: 1px solid var(--border2);
        border-radius: 12px;
        background: color-mix(in srgb,var(--bg3) 72%,transparent);
      }
      #view-cronometro .crono-activity-tab {
        display: grid;
        grid-template-columns: minmax(0,1fr) auto;
        align-items: center;
        gap: 5px;
        min-width: 0;
        min-height: 36px;
        padding: 7px 8px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: var(--text2);
        cursor: pointer;
      }
      #view-cronometro .crono-activity-tab span {
        overflow: hidden;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.05;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #view-cronometro .crono-activity-tab small {
        color: var(--text3);
        font: 750 8px/1 'JetBrains Mono',monospace;
      }
      #view-cronometro .crono-activity-tab.active {
        background: var(--bg);
        color: var(--accent);
        box-shadow: 0 1px 5px rgba(0,0,0,.10),inset 0 0 0 1px color-mix(in srgb,var(--accent) 24%,var(--border2));
      }
      #view-cronometro .crono-activity-tab.active small { color: var(--accent); }
      #view-cronometro #cronoPianoMoneyValue {
        display: inline-flex !important;
        align-items: baseline;
        justify-content: flex-start;
        gap: 0;
        white-space: nowrap;
      }
      #view-cronometro #cronoPianoMultiplierMeter { display: none !important; }
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
        background: linear-gradient(90deg,color-mix(in srgb,var(--green) 72%,white),var(--green) 64%,color-mix(in srgb,var(--accent) 70%,var(--green)));
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
        box-shadow: 0 0 0 1px color-mix(in srgb,var(--green) 38%,transparent),0 0 20px color-mix(in srgb,var(--green) 30%,transparent);
      }
      #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-track i { filter: brightness(1.42) saturate(1.22); }
      #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-value { animation: cronoMultiplierLevelUp 980ms cubic-bezier(.18,.9,.22,1); }
      #view-cronometro .crono-piano-money > footer { display: none !important; }
      @keyframes cronoMultiplierLevelUp {
        0% { transform: scale(1); color: var(--green); text-shadow: 0 0 12px color-mix(in srgb,var(--green) 24%,transparent); }
        18% { transform: scale(1.46) translateY(-1px); color: #fff; text-shadow: 0 0 5px #fff,0 0 18px var(--green),0 0 34px color-mix(in srgb,var(--accent) 80%,var(--green)); }
        42% { transform: scale(1.27); color: color-mix(in srgb,#fff 70%,var(--green)); text-shadow: 0 0 6px #fff,0 0 22px var(--green); }
        72% { transform: scale(1.08); }
        100% { transform: scale(1); color: var(--green); text-shadow: 0 0 12px color-mix(in srgb,var(--green) 24%,transparent); }
      }
      @media (max-width:520px) {
        #view-cronometro .crono-activity-tab { grid-template-columns:1fr; gap:2px; min-height:39px; padding:5px 3px; text-align:center; }
        #view-cronometro .crono-activity-tab span { font-size:8px; text-align:center; white-space:normal; }
        #view-cronometro .crono-activity-tab small { font-size:7px; }
        #view-cronometro .crono-piano-multiplier-meter { gap:8px; }
        #view-cronometro .crono-piano-multiplier-value { min-width:50px; font-size:12px; }
      }
      @media (min-width:1200px) {
        html.platform-windows #view-cronometro .crono-activity-tab { min-height:42px; padding:8px 10px; }
        html.platform-windows #view-cronometro .crono-activity-tab span { font-size:13px; }
        html.platform-windows #view-cronometro .crono-activity-tab small { font-size:10px; }
      }
      @media (prefers-reduced-motion:reduce) {
        #view-cronometro .crono-piano-multiplier-track i { transition:none; }
        #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-value { animation:none; }
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

  function formatEarnedCents(value){
    return new Intl.NumberFormat('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Math.max(0,Number(value)||0));
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
        const idleLive=PianoRewards.live(rewardState,goals,idleGoal.id,0,date,germanRows,PianoRewards.policyForDate().version,'study');
        const earned=Math.max(0,idleGoal.amount-idleLive.goalRemaining);
        idleBalance.textContent=formatEarnedCents(earned)+' € de '+formatTargetCents(idleGoal.amount)+' €';
      }
      const activeBalance=document.getElementById('cronoPianoGoalBalance');
      if(activeBalance && typeof crono!=='undefined' && crono.rewardGoalId){
        const goal=goals.find(item=>item && item.id===crono.rewardGoalId && !item.deletedAt);
        if(goal){
          const elapsed=typeof cronoEffectiveElapsedMs==='function'?Math.max(0,cronoEffectiveElapsedMs()/1000):0;
          const live=PianoRewards.live(rewardState,goals,crono.rewardGoalId,elapsed,date,germanRows,crono.rewardPolicyVersion||PianoRewards.policyForDate().version,selectedActivityType);
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
      const policyVersion=(typeof crono!=='undefined'&&Number(crono.rewardPolicyVersion))||PianoRewards.policyForDate().version;
      return PianoRewards.live(state,goals,goal?goal.id:null,elapsed,date,[],policyVersion,selectedActivityType);
    }catch(error){return null;}
  }

  function multiplierLabel(value){
    const digits=value>=10?1:2;
    return '×'+value.toFixed(digits).replace('.',',');
  }

  function rewardTierState(live){
    const policyVersion=(live&&Number(live.policyVersion))||((typeof crono!=='undefined'&&Number(crono.rewardPolicyVersion))||PianoRewards.policyForDate().version);
    const policy=(PianoRewards.POLICIES&&PianoRewards.POLICIES[policyVersion])||PianoRewards.CONFIG;
    const points=Array.isArray(policy&&policy.curve)?policy.curve:[];
    if(points.length<2)return {progress:0,multiplier:1,atCap:false,startSeconds:0,endSeconds:0};
    const seconds=Math.max(0,Number(live&&live.seconds)||0);
    let endIndex=-1;
    for(let i=1;i<points.length;i++)if(seconds<Number(points[i][0])){endIndex=i;break;}
    const normal=Math.max(1,Number(live&&live.streakMultiplier)||1);
    const excellent=Math.max(1,Number(live&&live.excellenceMultiplier)||1);
    const activity=Math.max(0.01,Number(live&&live.currentActivityFactor)||ACTIVITY_TYPES[selectedActivityType].factor);
    const streakBoost=PianoRewards.combinedMultiplier(normal,excellent,policyVersion);
    const firstDx=Math.max(1,Number(points[1][0])-Number(points[0][0]));
    const firstSlope=(Number(points[1][1])-Number(points[0][1]))/firstDx;
    if(endIndex<0){
      const start=points[points.length-2],end=points[points.length-1];
      const dx=Math.max(1,Number(end[0])-Number(start[0]));
      const slope=(Number(end[1])-Number(start[1]))/dx;
      const tierMultiplier=firstSlope>0?slope/firstSlope:1;
      return {progress:100,multiplier:tierMultiplier*streakBoost*activity,atCap:true,startSeconds:Number(start[0]),endSeconds:Number(end[0])};
    }
    const start=points[endIndex-1],end=points[endIndex];
    const startSeconds=Number(start[0])||0,endSeconds=Number(end[0])||startSeconds;
    const span=Math.max(1,endSeconds-startSeconds);
    const progress=Math.max(0,Math.min(100,(seconds-startSeconds)/span*100));
    const slope=(Number(end[1])-Number(start[1]))/span;
    const tierMultiplier=firstSlope>0?slope/firstSlope:1;
    return {progress,multiplier:tierMultiplier*streakBoost*activity,atCap:false,startSeconds,endSeconds};
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
    row.setAttribute('aria-valuetext',state.atCap?'Nivel máximo, multiplicador '+state.multiplier.toFixed(2):'Progreso '+Math.round(state.progress)+' por ciento, multiplicador '+state.multiplier.toFixed(2));
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
    ensureActivitySelector();
    syncActivityWithCrono();
    refreshGoalBalanceDisplay();
  }

  function scheduleTaximeter(){
    if(taximeterQueued) return;
    taximeterQueued=true;
    requestAnimationFrame(refreshTaximeter);
  }

  function bootTaximeter(){
    const meter=document.getElementById('cronoPianoMoney');
    const value=document.getElementById('cronoPianoMoneyValue');
    if(!meter || !value){setTimeout(bootTaximeter,140);return;}
    document.getElementById('cronoPianoMultiplierMeter')?.remove();
    installTaximeterStyles();
    ensureActivitySelector();
    installStartWrapper();
    installRewardUpdateWrapper();
    syncActivityWithCrono();
    scheduleTaximeter();
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
        if(late){schedule();new MutationObserver(schedule).observe(late,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});}
      },150);
    }
    try{globalThis.PianoActivityTypes={types:ACTIVITY_TYPES,current:()=>selectedActivityType,set:chooseActivity};}catch(error){}
    bootTaximeter();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
