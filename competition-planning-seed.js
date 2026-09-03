/* One-shot seed: apply the approved 2026–2027 competition dossier to the user's calendar.
 * Existing matching calendar entries are linked instead of duplicated, then left in Standby.
 */
(function competitionPlanningSeed(){
  'use strict';
  const SEED_VERSION = 1;

  function ready(){
    try {
      return window.EventPlanning && typeof window.EventPlanning.importCompetitions === 'function' &&
        typeof db !== 'undefined' && db && Array.isArray(db.eventos);
    } catch(error){ return false; }
  }

  function save(){
    try {
      if(typeof saveData === 'function') saveData();
      else if(typeof saveLocalNow === 'function') saveLocalNow();
    } catch(error){ console.warn('[competition-seed] seed guard could not persist', error); }
  }

  function run(){
    if(!ready()) return false;
    if(Number(db.competitionPlanningSeedVersion || 0) >= SEED_VERSION) return true;

    // Keep the ids of events that existed before the dossier was applied. If the
    // importer recognizes one as the same competition/deadline, that pre-existing
    // entry should also become Standby on this first approved import.
    const existing = new Set(db.eventos
      .filter(event => event && !event.planSourceId && !event.parentSourceId && !(event.planSource && event.planSource.type === 'dossier'))
      .map(event => String(event.id || ''))
      .filter(Boolean));

    const ids = window.EventPlanning.competitions.map(item => item.id);
    window.EventPlanning.importCompetitions(ids, true);

    db.eventos.forEach(event => {
      if(!event || !existing.has(String(event.id || ''))) return;
      const dossierLinked = Boolean(event.planSourceId || event.parentSourceId || (event.planSource && event.planSource.type === 'dossier'));
      if(dossierLinked) event.estado = 'standby';
    });

    db.competitionPlanningSeedVersion = SEED_VERSION;
    db.competitionPlanningSeededAt = new Date().toISOString();
    save();
    try { if(typeof renderEventos === 'function') renderEventos(); } catch(error){}
    try { if(typeof renderMesCalendario === 'function') renderMesCalendario(); } catch(error){}
    try { if(window.EventPlanning && typeof window.EventPlanning.renderWatchlist === 'function') window.EventPlanning.renderWatchlist(); } catch(error){}
    return true;
  }

  function boot(attempt){
    if(run()) return;
    if(attempt < 100) setTimeout(() => boot(attempt + 1), 100);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), { once:true });
  else boot(0);
})();
