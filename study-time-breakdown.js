/* Secondary real-vs-net practice statistics.
   Primary app totals remain equivalent/net minutes from DailyStudyMinutes. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./daily-study-minutes'):root.DailyStudyMinutes);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.StudyTimeBreakdown=api;api.installBrowser?.(root);}
})(typeof window!=='undefined'?window:globalThis,function(DailyStudyMinutes){
  'use strict';

  function summarizeBlocks(blocks){
    const totals=(Array.isArray(blocks)?blocks:[]).reduce((acc,block)=>{
      acc.net+=Math.max(0,Number(block&&block.mins)||0);
      const raw=Number(block&&block.rawMins);
      acc.real+=Number.isFinite(raw)?Math.max(0,raw):Math.max(0,Number(block&&block.mins)||0);
      return acc;
    },{net:0,real:0});
    totals.ratio=totals.real>0?Math.max(0,Math.min(100,totals.net/totals.real*100)):0;
    return totals;
  }

  function rangeStart(days,now=new Date()){
    const start=new Date(now);
    start.setHours(0,0,0,0);
    start.setDate(start.getDate()-(Math.max(1,Number(days)||1)-1));
    return start;
  }

  function rangeEnd(now=new Date()){
    const end=new Date(now);
    end.setHours(0,0,0,0);
    end.setDate(end.getDate()+1);
    return end;
  }

  function summarizeRange(database,days,now=new Date()){
    if(!DailyStudyMinutes?.studyBlocks)return {net:0,real:0,ratio:0};
    return summarizeBlocks(DailyStudyMinutes.studyBlocks(rangeStart(days,now),rangeEnd(now),database));
  }

  function installBrowser(root){
    if(!root?.document||root.__studyTimeBreakdownInstalled)return;
    root.__studyTimeBreakdownInstalled=true;
    const doc=root.document;

    function currentDb(){
      try{if(typeof db!=='undefined'&&db)return db;}catch(error){}
      return root.db||null;
    }

    function fmt(mins){
      const total=Math.max(0,Math.round(Number(mins)||0));
      const h=Math.floor(total/60),m=total%60;
      if(!h)return m+' min';
      if(!m)return h+' h';
      return h+' h '+m+' min';
    }

    function pct(value){
      return Math.round(Math.max(0,Math.min(100,Number(value)||0)))+' %';
    }

    function cardRow(label,data){
      return '<div class="study-time-breakdown-row">'+
        '<strong>'+label+'</strong>'+
        '<span><small>Neto</small><b>'+fmt(data.net)+'</b></span>'+
        '<span><small>Real</small><b>'+fmt(data.real)+'</b></span>'+
        '<span><small>% neto</small><b>'+pct(data.ratio)+'</b></span>'+
      '</div>';
    }

    function ensureHost(){
      const dashboard=doc.getElementById('statsDashboard');
      if(!dashboard?.parentNode)return null;
      let host=doc.getElementById('studyTimeBreakdown');
      if(host)return host;
      host=doc.createElement('section');
      host.id='studyTimeBreakdown';
      host.className='study-time-breakdown';
      dashboard.insertAdjacentElement('afterend',host);
      return host;
    }

    function render(){
      const host=ensureHost(),database=currentDb();
      if(!host||!database||!DailyStudyMinutes?.studyBlocks)return;
      const now=new Date();
      const today=summarizeRange(database,1,now);
      const week=summarizeRange(database,7,now);
      const month=summarizeRange(database,30,now);
      const signature=JSON.stringify([today,week,month]);
      if(host.dataset.signature===signature)return;
      host.dataset.signature=signature;
      host.innerHTML='<div class="study-time-breakdown-head">'+
        '<div><span class="history-section-label">Tiempo de estudio</span>'+
        '<h3>Neto y real</h3></div>'+
        '<p>El <strong>tiempo neto</strong> es la métrica principal para rachas, dinero y logros. El tiempo real conserva la duración física de toda la actividad.</p>'+
      '</div>'+
      '<div class="study-time-breakdown-grid">'+
        cardRow('Hoy',today)+cardRow('7 días',week)+cardRow('30 días',month)+
      '</div>';
    }

    function visible(){
      const section=doc.getElementById('sessionStatsSection');
      return !!section&&!section.hidden;
    }

    function schedule(){root.requestAnimationFrame?root.requestAnimationFrame(render):setTimeout(render,0);}

    function boot(){
      ensureHost();
      schedule();
      const stats=doc.getElementById('sessionStatsSection');
      if(stats)new MutationObserver(()=>{if(visible())schedule();}).observe(stats,{attributes:true,attributeFilter:['hidden','class']});
      const dashboard=doc.getElementById('statsDashboard');
      if(dashboard)new MutationObserver(()=>{if(visible())schedule();}).observe(dashboard,{childList:true,subtree:true});
      doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible'&&visible())schedule();});
      root.addEventListener?.('focus',()=>{if(visible())schedule();});
      setInterval(()=>{if(visible())render();},5000);
    }

    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }

  return {summarizeBlocks,rangeStart,rangeEnd,summarizeRange,installBrowser};
});
