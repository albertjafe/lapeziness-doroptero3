/* Presentación enriquecida para eventos históricos importados con rondas/resultados. */
(function historicalEventDetails(){
  'use strict';

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function getEvents(){
    try { return Array.isArray(db && db.historicalEvents) ? db.historicalEvents : []; }
    catch (e) { return []; }
  }

  function injectStyles(){
    if(document.getElementById('historicalEventDetailsStyles')) return;
    const style=document.createElement('style');
    style.id='historicalEventDetailsStyles';
    style.textContent=`
      .hist-event-extra{margin-top:11px;border-top:1px solid var(--border2);padding-top:10px;display:grid;gap:8px}
      .hist-event-result{display:inline-flex;width:max-content;max-width:100%;align-items:center;border:1px solid color-mix(in srgb,var(--accent) 42%,var(--border2));background:color-mix(in srgb,var(--accent) 8%,var(--bg));color:var(--accent);border-radius:999px;padding:5px 8px;font-size:9px;font-weight:700}
      .hist-event-period,.hist-event-note-detail{font-size:9px;line-height:1.45;color:var(--text3)}
      .hist-event-rounds{display:grid;gap:7px}
      .hist-event-round{border:1px solid var(--border2);background:var(--bg2);border-radius:9px;padding:8px 9px}
      .hist-event-round-label{font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:5px}
      .hist-event-round-items{display:flex;flex-wrap:wrap;gap:5px}
      .hist-event-round-item{font-size:9px;color:var(--text2);background:var(--bg3);border-radius:7px;padding:4px 6px;line-height:1.25}
      .hist-event-round-selection{color:var(--accent);font-weight:700}
    `;
    document.head.appendChild(style);
  }

  function renderExtra(event){
    const chunks=[];
    if(event.result) chunks.push(`<div class="hist-event-result">${esc(event.result)}</div>`);
    if(event.academicPeriod) chunks.push(`<div class="hist-event-period">${esc(event.academicPeriod)}</div>`);
    if(Array.isArray(event.rounds) && event.rounds.length){
      const rounds=event.rounds.map(round=>{
        const items=Array.isArray(round.items)?round.items:[];
        return `<div class="hist-event-round"><div class="hist-event-round-label">${esc(round.label||'Ronda')}</div><div class="hist-event-round-items">${items.map(item=>`<span class="hist-event-round-item">${esc(item.name||'Obra')}${item.selection?` <span class="hist-event-round-selection">· ${esc(item.selection)}</span>`:''}</span>`).join('')}</div></div>`;
      }).join('');
      chunks.push(`<div class="hist-event-rounds">${rounds}</div>`);
    }
    if(event.notes) chunks.push(`<div class="hist-event-note-detail">${esc(event.notes)}</div>`);
    return chunks.join('');
  }

  function enhance(){
    injectStyles();
    const host=document.getElementById('historicalEventsList');
    if(!host) return;
    const byId=new Map(getEvents().map(event=>[String(event.id),event]));
    host.querySelectorAll('.hist-event-card').forEach(card=>{
      const edit=card.querySelector('[data-edit]');
      const event=edit ? byId.get(String(edit.dataset.edit)) : null;
      if(!event) return;
      card.querySelector('.hist-event-extra')?.remove();
      const html=renderExtra(event);
      if(!html) return;
      const extra=document.createElement('div');
      extra.className='hist-event-extra';
      extra.innerHTML=html;
      const actions=card.querySelector('.hist-event-actions');
      card.insertBefore(extra,actions||null);
    });
  }

  function boot(){
    injectStyles();
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      const host=document.getElementById('historicalEventsList');
      if(host){
        clearInterval(timer);
        enhance();
        new MutationObserver(()=>enhance()).observe(host,{childList:true});
      } else if(attempts>80){ clearInterval(timer); }
    },100);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
