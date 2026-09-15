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
        transition: width 520ms cubic-bezier(.2,.8,.2,1), filter 220ms ease;
      }
      #view-cronometro .crono-piano-multiplier-value {
        min-width: 49px;
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
        filter: brightness(1.38) saturate(1.2);
      }
      #view-cronometro .crono-piano-multiplier-meter.is-level-up .crono-piano-multiplier-value {
        animation: cronoMultiplierLevelUp 980ms cubic-bezier(.18,.9,.22,1);
      }
      #view-cronometro .crono-piano-money > footer {
        display: none !important;
      }
      @keyframes cronoMultiplierLevelUp {
        0% { transform: scale(1); color: var(--green); text-shadow: 0 0 12px color-mix(in srgb, var(--green) 24%, transparent); }
        18% { transform: scale(1.42) translateY(-1px); color: #fff; text-shadow: 0 0 5px #fff, 0 0 18px var(--green), 0 0 34px color-mix(in srgb, var(--accent) 80%, var(--green)); }
        42% { transform: scale(1.25); color: color-mix(in srgb, #fff 70%, var(--green)); text-shadow: 0 0 6px #fff, 0 0 22px var(--green); }
        72% { transform: scale(1.08); }
        100% { transform: scale(1); color: var(--green); text-shadow: 0 0 12px color-mix(in srgb, var(--green) 24%, transparent); }
      }
      @media (max-width: 520px) {
        #view-cronometro .crono-piano-multiplier-meter { gap: 8px; }
        #view-cronometro .crono-piano-multiplier-value { min-width: 45px; font-size: 12px; }
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

  function ensureMultiplierMeter(){
    const meter=document.getElementById('cronoPianoMoney');
    if(!meter) return null;
    let row=document.getElementById('cronoPianoMultiplierMeter');
    if(row) return row;
    row=document.createElement('div');
    row.className='crono-piano-multiplier-meter';
    row.id='cronoPianoMultiplierMeter';
    row.setAttribute('role','progressbar');
    row.setAttribute('aria-label','Multiplicador de recompensa');
    row.setAttribute('aria-valuemin','1');
    row.setAttribute('aria-valuemax','1.875');
    row.innerHTML='<div class="crono-piano-multiplier-track" aria-hidden="true"><i id="cronoPianoMultiplierFill"></i></div><strong class="crono-piano-multiplier-value" id="cronoPianoMultiplierValue">×1,00</strong>';
    const goalBar=meter.querySelector('.crono-piano-goal-progress');
    if(goalBar && goalBar.parentNode===meter) goalBar.insertAdjacentElement('afterend',row);
    else meter.appendChild(row);
    return row;
  }

  function currentRewardLive(){
    try{
      if(typeof PianoRewards==='undefined' || typeof db==='undefined') return null;
      const state=PianoRewards.ensure(db);
      const goals=(db && db.germanStudy && Array.isArray(db.germanStudy.goals))?db.germanStudy.goals:[];
      const goal=PianoRewards.activeGoal(db);
      const elapsed=typeof cronoEffectiveElapsedMs==='function'?Math.max(0,cronoEffectiveElapsedMs()/1000):0;
      const date=typeof PianoRewards.dayKey==='function'?PianoRewards.dayKey():undefined;
      return PianoRewards.live(state,goals,goal?goal.id:null,elapsed,date,[],PianoRewards.CONFIG&&PianoRewards.CONFIG.version);
    }catch(error){
      return null;
    }
  }

  function multiplierLabel(value){
    return '×'+value.toFixed(2).replace('.',',');
  }

  function refreshMultiplier(){
    const row=ensureMultiplierMeter();
    if(!row) return;
    const live=currentRewardLive();
    const normal=Math.max(1,Number(live&&live.streakMultiplier)||1);
    const excellent=Math.max(1,Number(live&&live.excellentMultiplier)||1);
    const combined=normal*excellent;
    const maxNormal=(typeof PianoRewards!=='undefined'&&typeof PianoRewards.streakMultiplier==='function')?PianoRewards.streakMultiplier(999):1.25;
    const maxExcellent=(typeof PianoRewards!=='undefined'&&typeof PianoRewards.excellentMultiplier==='function')?PianoRewards.excellentMultiplier(999):1.50;
    const max=Math.max(1.000001,maxNormal*maxExcellent);
    const progress=Math.max(0,Math.min(100,(combined-1)/(max-1)*100));
    const fill=document.getElementById('cronoPianoMultiplierFill');
    const value=document.getElementById('cronoPianoMultiplierValue');
    if(fill) fill.style.width=progress.toFixed(2)+'%';
    if(value) value.textContent=multiplierLabel(combined);
    row.setAttribute('aria-valuenow',combined.toFixed(3));
    row.setAttribute('aria-valuetext','Multiplicador '+combined.toFixed(3));
    row.title='Multiplicador actual: '+combined.toFixed(3)+'×';

    if(lastMultiplier!=null && combined>lastMultiplier+0.0005){
      row.classList.remove('is-level-up');
      void row.offsetWidth;
      row.classList.add('is-level-up');
      clearTimeout(levelTimer);
      levelTimer=setTimeout(()=>row.classList.remove('is-level-up'),1050);
    }
    lastMultiplier=combined;
  }

  function refreshTaximeter(){
    taximeterQueued=false;
    installTaximeterStyles();
    formatMoneyDisplay();
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
