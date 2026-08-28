(function historicalRealStudyPolish(){
  'use strict';

  let scheduled=false;
  let observer=null;

  function data(){
    try { if(typeof DB!=='undefined' && DB) return DB; } catch(error) {}
    try { if(typeof db!=='undefined' && db) return db; } catch(error) {}
    return null;
  }

  function fmtMinutes(value){
    const total=Math.max(0,Math.round(Number(value)||0));
    const h=Math.floor(total/60),m=total%60;
    if(!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function entryById(id){
    const d=data();
    return d && Array.isArray(d.historicalRepertoire)
      ? d.historicalRepertoire.find(item=>String(item&&item.id)===String(id))
      : null;
  }

  function decorateRows(){
    document.querySelectorAll('#obrasList .obras-rd-row.historical[data-history-id]').forEach(row=>{
      const entry=entryById(row.dataset.historyId);
      const minutes=Number(entry&&entry.realStudyMinutes);
      if(!Number.isFinite(minutes)||minutes<=0) return;
      const meta=row.querySelector('.obras-rd-meta');
      if(!meta) return;
      let chip=meta.querySelector('.obras-rd-real-study');
      if(!chip){
        chip=document.createElement('span');
        chip.className='obras-rd-real-study';
        meta.appendChild(chip);
      }
      chip.textContent=`${fmtMinutes(minutes)} reales`;
      chip.title='Tiempo real medido e importado de Forest';
    });
  }

  function decorateDetail(){
    const selected=document.querySelector('#obrasList .obras-rd-row.historical.selected[data-history-id]');
    if(!selected) return;
    const entry=entryById(selected.dataset.historyId);
    const minutes=Number(entry&&entry.realStudyMinutes);
    if(!Number.isFinite(minutes)||minutes<=0) return;
    const detail=document.querySelector('.obras-rd-detail-card.historical-detail');
    if(!detail) return;
    const firstStat=detail.querySelector('.obras-rd-stats.historical > div');
    if(firstStat){
      const label=firstStat.querySelector('span');
      const value=firstStat.querySelector('strong');
      if(label) label.textContent='Estudio medido';
      if(value) value.textContent=fmtMinutes(minutes);
      firstStat.title='Tiempo real medido e importado de Forest';
    }
  }

  function decorate(){
    scheduled=false;
    decorateRows();
    decorateDetail();
  }

  function schedule(){
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(decorate);
  }

  function boot(){
    schedule();
    const root=document.getElementById('view-obras')||document.body;
    observer=new MutationObserver(schedule);
    observer.observe(root,{childList:true,subtree:true});
    window.addEventListener('solidity-model-ready',schedule);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
