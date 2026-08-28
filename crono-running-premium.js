/* Presentación de la predicción del cronómetro: separa la confianza del texto principal. */
(function cronoRunningPremium(){
  'use strict';
  let queued=false;

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

  function boot(){
    const button=document.getElementById('cronoRunReadiness');
    if(!button){ setTimeout(boot,120); return; }
    schedule();
    new MutationObserver(schedule).observe(button,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
