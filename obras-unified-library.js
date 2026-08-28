/* Obras · biblioteca única: las obras históricas son contexto, no otro repertorio. */
(function obrasUnifiedLibrary(){
  'use strict';

  let scheduled=false;

  function getData(){
    try { if(typeof DB!=='undefined' && DB) return DB; } catch(e) {}
    try { if(typeof db!=='undefined' && db) return db; } catch(e) {}
    return null;
  }

  function redesignState(){
    return window.ObrasRedesign && window.ObrasRedesign.state ? window.ObrasRedesign.state : {scope:'all',sort:'smart'};
  }

  function text(node, value){ if(node && node.textContent!==value) node.textContent=value; }

  function norm(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }

  function rowKey(row, kind){
    if(kind==='composer') return norm(row.querySelector('.obras-rd-composer')?.textContent)+'|'+norm(row.querySelector('.obras-rd-title')?.textContent);
    return norm(row.querySelector('.obras-rd-title')?.textContent)+'|'+norm(row.querySelector('.obras-rd-composer')?.textContent);
  }

  function sortRows(host, mode, historyOnly){
    if(!host) return;
    const current=Array.from(host.children).filter(node=>node.classList && node.classList.contains('obras-rd-row'));
    const rows=current.slice();
    if(mode==='composer' || mode==='title'){
      rows.sort((a,b)=>rowKey(a,mode).localeCompare(rowKey(b,mode),'es'));
    } else if(historyOnly){
      rows.sort((a,b)=>rowKey(a,'composer').localeCompare(rowKey(b,'composer'),'es'));
    } else {
      return; // smart/recent/solidity ya vienen ordenados por el renderer principal.
    }
    if(rows.every((row,index)=>row===current[index])) return;
    rows.forEach(row=>host.appendChild(row));
  }

  function setSectionHeader(section, count, hint){
    if(!section) return;
    section.classList.add('library');
    const label=section.querySelector(':scope > header span');
    const small=section.querySelector(':scope > header small');
    const strong=section.querySelector(':scope > header > strong');
    text(label,'Biblioteca');
    if(small) text(small,hint||'actuales e históricas');
    if(strong) text(strong,String(count));
  }

  function relabelChrome(){
    const head=document.getElementById('obrasRedesignHead');
    if(!head) return;
    const active=head.querySelector('[data-scope="active"]');
    const history=head.querySelector('[data-scope="history"]');
    text(active,'Actuales');
    text(history,'Históricas');
    const archive=head.querySelector('[data-menu="archive"]');
    text(archive,'Gestionar obras históricas');

    const d=getData();
    const works=(d && Array.isArray(d.obras) ? d.obras : []).filter(item=>item && item.tipo!=='actividad');
    const historical=d && Array.isArray(d.historicalRepertoire) ? d.historicalRepertoire : [];
    const count=document.getElementById('obrasRdCount');
    if(count){
      const total=works.length+historical.length;
      count.textContent=historical.length ? `${total} obras · ${historical.length} históricas` : `${total} obras`;
    }
  }

  function relabelHistoricalRows(root){
    if(!root) return;
    root.querySelectorAll('.obras-rd-row.historical').forEach(row=>{
      const mark=row.querySelector('.obras-rd-archive-mark');
      text(mark,'Histórica');
      const title=row.querySelector('.obras-rd-title')?.textContent?.trim() || 'obra histórica';
      row.setAttribute('aria-label',`Abrir ${title} · histórica`);
    });
  }

  function unify(){
    scheduled=false;
    const list=document.getElementById('obrasList');
    if(!list || !window.ObrasRedesign) return;

    relabelChrome();
    relabelHistoricalRows(list);

    const state=redesignState();
    const active=list.querySelector('.obras-rd-section.active');
    const history=list.querySelector('.obras-rd-section.history');

    if(state.scope==='all'){
      if(active && history){
        const activeRows=active.querySelector('.obras-rd-rows');
        const historyRows=history.querySelector('.obras-rd-rows');
        if(activeRows && historyRows){
          Array.from(historyRows.children).forEach(row=>activeRows.appendChild(row));
          history.remove();
          sortRows(activeRows,state.sort,false);
          setSectionHeader(active,activeRows.querySelectorAll('.obras-rd-row').length,
            state.sort==='composer' ? 'por compositor' : state.sort==='title' ? 'por título' : 'actuales e históricas');
        }
      } else if(active){
        const rows=active.querySelector('.obras-rd-rows');
        setSectionHeader(active,rows ? rows.querySelectorAll('.obras-rd-row').length : 0,'actuales e históricas');
      }
    } else if(state.scope==='active'){
      if(active){
        const rows=active.querySelector('.obras-rd-rows');
        setSectionHeader(active,rows ? rows.querySelectorAll('.obras-rd-row').length : 0,'repertorio actual');
      }
    } else if(state.scope==='history'){
      if(history){
        const rows=history.querySelector('.obras-rd-rows');
        sortRows(rows,state.sort,true);
        setSectionHeader(history,rows ? rows.querySelectorAll('.obras-rd-row').length : 0,'obras trabajadas anteriormente');
      }
    }

    relabelHistoricalRows(list);
  }

  function schedule(){
    if(scheduled) return;
    scheduled=true;
    requestAnimationFrame(unify);
  }

  function boot(){
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      const list=document.getElementById('obrasList');
      if(list && window.ObrasRedesign){
        clearInterval(timer);
        schedule();
        new MutationObserver(schedule).observe(list,{childList:true,subtree:true});
        window.addEventListener('resize',schedule);
      } else if(attempts>100){ clearInterval(timer); }
    },100);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
