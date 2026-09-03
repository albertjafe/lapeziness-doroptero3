(function professorEventGateUi(){
  'use strict';

  const HINT='Solo repertorio enlazado a eventos/proyectos';

  function apply(){
    const view=document.getElementById('view-profesor');
    if(!view) return;
    const list=view.querySelector('.prof-priority-list');
    if(!list) return;

    list.querySelectorAll('.prof-unit').forEach(card=>{
      const score=card.querySelector('.prof-score');
      if(score && score.dataset.band==='sin_evento') card.remove();
    });

    const section=list.closest('.prof-section');
    const hint=section && section.querySelector('.prof-section-head .prof-muted');
    if(hint && hint.textContent!==HINT) hint.textContent=HINT;

    if(!list.querySelector('.prof-unit') && !list.querySelector('[data-prof-no-linked]')){
      const empty=document.createElement('div');
      empty.className='prof-card prof-muted';
      empty.dataset.profNoLinked='1';
      empty.textContent='No hay repertorio enlazado a eventos o proyectos futuros. El Profesor no inventará mantenimiento de obras por enfriamiento.';
      list.appendChild(empty);
    }
  }

  function boot(){
    const view=document.getElementById('view-profesor');
    apply();
    if(!view) return;
    const observer=new MutationObserver(apply);
    observer.observe(view,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
