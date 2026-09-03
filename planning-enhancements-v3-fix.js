/* Idempotence patch for planning v3 dynamic dossier links. */
(function planningEnhancementsV3Fix(){
  'use strict';

  function eventForModal(){
    try {
      const id = document.getElementById('eventoEditId')?.value || '';
      return id && Array.isArray(db.eventos) ? db.eventos.find(item => String(item.id) === String(id)) || null : null;
    } catch(error){ return null; }
  }

  function renderOfficialLink(){
    const hero = document.getElementById('competitionDossierHero');
    if(!hero || hero.hidden || !hero.offsetParent || !window.PlanningEnhancementsV3) return;
    const event = eventForModal();
    if(!event) return;
    const source = event.planSourceId || event.parentSourceId || '';
    const name = event.competition?.name || event.nombre || '';
    const url = event.competition?.officialUrl || event.officialUrl || window.PlanningEnhancementsV3.competitionUrlFor(name, source);
    let host = hero.querySelector('.competition-official-actions');
    if(!url){ if(host) host.remove(); return; }
    const existing = host && host.querySelector('.competition-official-link');
    if(existing && existing.getAttribute('href') === url) return;
    if(!host){
      host = document.createElement('div');
      host.className = 'competition-official-actions';
      hero.appendChild(host);
    }
    host.replaceChildren();
    const link = document.createElement('a');
    link.className = 'competition-official-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Abrir web oficial ↗';
    host.appendChild(link);
  }

  function install(){
    if(window.__planningV3Observer){
      try { window.__planningV3Observer.disconnect(); } catch(error){}
      window.__planningV3Observer = null;
    }
    if(window.__planningV3SafeObserver) return;
    const observer = new MutationObserver(renderOfficialLink);
    observer.observe(document.documentElement, { subtree:true, childList:true });
    window.__planningV3SafeObserver = observer;
    const modal = document.getElementById('modalAddEvento');
    if(modal){
      new MutationObserver(() => {
        if(modal.classList.contains('open') || modal.classList.contains('visible')) setTimeout(renderOfficialLink, 0);
      }).observe(modal, { attributes:true, attributeFilter:['class'] });
    }
    renderOfficialLink();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install,0), { once:true });
  else setTimeout(install,0);
})();
