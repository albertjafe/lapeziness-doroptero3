/* Planning enhancements v3
 * - Dictated task priorities: urgentísima/urgente/normal/default blank.
 * - Projects with no deadline, month-flexible or exact targets and visible progress.
 * - Complete 0–100 solidity guide for new, chamber-with-score and recovered repertoire.
 * - Official website links in every imported competition dossier.
 */
(function planningEnhancementsV3(){
  'use strict';

  const VERSION = 5;
  const MONTH_FMT = new Intl.DateTimeFormat('es-ES', { month:'long', year:'numeric' });

  const COMPETITION_LINKS = [
    { key:/brescia/i, url:'https://www.francomargolacompetition.it/' },
    { key:/compositores de españa|cipce/i, url:'https://cipce.org/' },
    { key:/orchestra.?sion|istanbul/i, url:'https://www.nds.k12.tr/-International-Piano-Competition' },
    { key:/german piano award|deutscher pianistenpreis/i, url:'https://ipf-frankfurt.com/' },
    { key:/campillos/i, url:'https://www.concursointernacionalpiano.es/' },
    { key:/maria canals/i, url:'https://mariacanals.org/' },
    { key:/epinal|épinal/i, url:'https://www.concours-international-piano-epinal.org/' },
    { key:/london classic/i, url:'https://london.classicpiano.eu/' },
    { key:/montr[eé]al|cmim/i, url:'https://www.concoursmontreal.ca/en/piano-2027/' },
    { key:/g[eé]za anda/i, url:'https://www.geza-anda.ch/' },
    { key:/iturbi/i, url:'https://pianoiturbi.dival.es/' },
    { key:/sydney/i, url:'https://www.thesydney.com.au/' },
    { key:/cleveland/i, url:'https://pianocleveland.org/2027-cipc/' },
    { key:/clara haskil/i, url:'https://clara-haskil.ch/' },
    { key:/leeds/i, url:'https://www.leedspiano.com/2027-competition/' },
    { key:/hummel/i, url:'https://www.filharmonia.sk/en/hummel' },
    { key:/pozzoli/i, url:'https://www.concorsopozzoli.it/' },
    { key:/ciurlionis|čiurlionis/i, url:'https://ciurlionis.link/en/' },
    { key:/maj lind/i, url:'https://majlindcompetition.fi/en/' },
    { key:/xiamen/i, url:'https://zhuanti.ccom.edu.cn/xipceng/index.htm' },
    { key:/mottram|rncm/i, url:'https://www.rncm.ac.uk/jmipc/' },
    { key:/hamamatsu/i, url:'https://www.hipic.jp/' },
    { key:/telekom.*beethoven|beethoven competition/i, url:'https://www.telekom-beethoven-competition.de/tbc' },
    { key:/tchaikovsky/i, url:'https://www.tchaikovskycompetition.com/en/' },
  ];


  function appDb(){
    try { if(typeof db !== 'undefined' && db) return db; } catch(error){}
    try { if(typeof DB !== 'undefined' && DB) return DB; } catch(error){}
    return null;
  }

  function persist(){
    try {
      if(typeof window.saveData === 'function') window.saveData();
      else if(typeof window.saveLocalNow === 'function') window.saveLocalNow();
      else if(typeof window.save === 'function') window.save();
    } catch(error){ console.warn('[planning-v3] no se pudo guardar', error); }
  }

  function normalize(text){
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }

  function priorityFromText(text){
    const value = normalize(text);
    if(/\burgentisima\b/.test(value)) return 3;
    if(/\burgente\b/.test(value)) return 2;
    if(/\bnormal\b/.test(value)) return 1;
    return 0;
  }

  function patchDictatedTaskPriority(){
    if(typeof window.confirmCronoTomorrowTask !== 'function' || window.confirmCronoTomorrowTask.__priorityDictationV3) return false;
    const original = window.confirmCronoTomorrowTask;
    const patched = function(){
      const text = document.getElementById('cronoNoteInput')?.value || '';
      const priority = priorityFromText(text);
      let beforeIds = new Set();
      try { if(typeof cronoTasks === 'function') beforeIds = new Set(cronoTasks().map(item => String(item && item.id || ''))); } catch(error){}
      const result = original.apply(this, arguments);
      const apply = () => {
        try {
          if(typeof cronoTasks !== 'function') return;
          const tasks = cronoTasks();
          let task = tasks.find(item => item && !beforeIds.has(String(item.id || '')) && item.source === 'tomorrow-note');
          if(!task){
            const candidates = tasks.filter(item => item && item.source === 'tomorrow-note' && String(item.text || '') === String(text || ''));
            task = candidates.sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
          }
          if(!task) return;
          task.priority = priority;
          task.prioritySource = priority ? 'dictation-keyword' : 'default-blank';
          task.priorityDetectedAt = new Date().toISOString();
          persist();
          if(typeof renderCronoTasks === 'function') renderCronoTasks();
        } catch(error){ console.warn('[planning-v3] prioridad de tarea', error); }
      };
      Promise.resolve(result).finally(() => setTimeout(apply, 0));
      return result;
    };
    patched.__priorityDictationV3 = true;
    patched.__original = original;
    window.confirmCronoTomorrowTask = patched;
    try { confirmCronoTomorrowTask = patched; } catch(error){}
    return true;
  }

  function activeEventType(){
    const active = document.querySelector('#eventoTipoSelector .evento-tipo-btn.active');
    if(!active) return '';
    if(active.dataset && active.dataset.eventoTipo) return active.dataset.eventoTipo;
    const cls = Array.from(active.classList).find(name => !['evento-tipo-btn','active'].includes(name));
    return cls || '';
  }

  function ensureProjectButton(){
    const selector = document.getElementById('eventoTipoSelector');
    if(!selector) return false;
    if(selector.querySelector('[data-evento-tipo="proyecto"]')){
      if(!selector.dataset.projectV3Bound){
        selector.dataset.projectV3Bound = '1';
        selector.addEventListener('click', event => {
          if(event.target && event.target.closest && event.target.closest('.evento-tipo-btn')) setTimeout(updateProjectVisibility, 0);
        });
      }
      return false;
    }
    Array.from(selector.querySelectorAll('.evento-tipo-btn')).forEach(btn => {
      if(!btn.dataset.eventoTipo){
        const type = Array.from(btn.classList).find(name => !['evento-tipo-btn','active'].includes(name));
        if(type) btn.dataset.eventoTipo = type;
      }
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'evento-tipo-btn proyecto';
    button.dataset.eventoTipo = 'proyecto';
    button.textContent = 'Proyecto';
    button.addEventListener('click', () => {
      if(typeof selectEventoTipo === 'function') selectEventoTipo('proyecto', button);
      if(!document.getElementById('eventoEditId')?.value) setProjectMode('none');
      setTimeout(updateProjectVisibility, 0);
    });
    selector.appendChild(button);
    if(!selector.dataset.projectV3Bound){
      selector.dataset.projectV3Bound = '1';
      selector.addEventListener('click', event => {
        if(event.target && event.target.closest && event.target.closest('.evento-tipo-btn')) setTimeout(updateProjectVisibility, 0);
      });
    }
    return true;
  }

  function ensureProjectTimingFields(){
    const modal = document.getElementById('modalAddEvento');
    if(!modal || document.getElementById('eventProjectTiming')) return false;
    const dateRange = modal.querySelector('.evento-date-range');
    if(!dateRange) return false;
    const section = document.createElement('section');
    section.id = 'eventProjectTiming';
    section.className = 'event-project-timing';
    section.hidden = true;
    section.innerHTML = `
      <div class="event-project-kicker">Horizonte y avance del proyecto</div>
      <div class="event-project-mode" role="radiogroup" aria-label="Precisión de la fecha objetivo">
        <button type="button" data-project-mode="none" aria-pressed="true">Sin fecha</button>
        <button type="button" data-project-mode="month" aria-pressed="false">Mes flexible</button>
        <button type="button" data-project-mode="exact" aria-pressed="false">Día concreto</button>
      </div>
      <label class="evento-form-field event-project-month-field" hidden>
        <span>Quiero tenerlo para <small>mes aproximado</small></span>
        <input class="modal-input" id="eventoProyectoMes" type="month">
      </label>
      <label class="evento-form-field event-project-progress-field">
        <span>Progreso actual <output id="eventoProyectoProgresoValue">0%</output></span>
        <input id="eventoProyectoProgreso" type="range" min="0" max="100" step="1" value="0" aria-label="Progreso actual del proyecto">
      </label>
      <p class="event-project-help">Sin fecha mantiene el proyecto activo sin fabricar urgencia. Si eliges un mes o un día, el Profesor podrá repartir el trabajo hacia ese objetivo.</p>`;
    dateRange.insertAdjacentElement('afterend', section);
    section.querySelectorAll('[data-project-mode]').forEach(button => button.addEventListener('click', () => setProjectMode(button.dataset.projectMode)));
    const progress = section.querySelector('#eventoProyectoProgreso');
    progress?.addEventListener('input', () => setProjectProgressVisual(progress.value));
    setProjectProgressVisual(0);
    return true;
  }

  function projectMode(){
    return document.querySelector('#eventProjectTiming [data-project-mode][aria-pressed="true"]')?.dataset.projectMode || 'none';
  }

  function setProjectMode(mode){
    const next = ['none','month','exact'].includes(mode) ? mode : 'none';
    document.querySelectorAll('#eventProjectTiming [data-project-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.projectMode === next)));
    const monthField = document.querySelector('#eventProjectTiming .event-project-month-field');
    const dateRange = document.querySelector('#modalAddEvento .evento-date-range');
    if(monthField) monthField.hidden = next !== 'month';
    if(dateRange) dateRange.classList.toggle('project-date-hidden', activeEventType() === 'proyecto' && next !== 'exact');
  }

  function clampProjectProgress(value){
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
  }

  function setProjectProgressVisual(value){
    const progress = clampProjectProgress(value);
    const input = document.getElementById('eventoProyectoProgreso');
    const output = document.getElementById('eventoProyectoProgresoValue');
    if(input){
      input.value = String(progress);
      input.style.setProperty('--project-progress', progress + '%');
      input.setAttribute('aria-valuetext', progress + ' por ciento completado');
    }
    if(output) output.textContent = progress + '%';
    return progress;
  }

  function isoEndOfMonth(month){
    const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if(!match) return '';
    const y = Number(match[1]), m = Number(match[2]);
    const date = new Date(y, m, 0, 12);
    return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  }

  function isoStartOfMonth(month){
    return /^\d{4}-\d{2}$/.test(String(month || '')) ? `${month}-01` : '';
  }

  function monthLabel(month){
    const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if(!match) return '';
    const label = MONTH_FMT.format(new Date(Number(match[1]), Number(match[2])-1, 1, 12));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function currentEditingEvent(){
    const data = appDb();
    if(!data || !Array.isArray(data.eventos)) return null;
    const id = document.getElementById('eventoEditId')?.value || '';
    return id ? data.eventos.find(item => String(item.id) === String(id)) || null : null;
  }

  function updateProjectVisibility(){
    ensureProjectButton();
    ensureProjectTimingFields();
    const isProject = activeEventType() === 'proyecto';
    const section = document.getElementById('eventProjectTiming');
    const dateRange = document.querySelector('#modalAddEvento .evento-date-range');
    if(section) section.hidden = !isProject;
    if(!isProject && dateRange) dateRange.classList.remove('project-date-hidden');
    if(isProject) setProjectMode(projectMode());
  }

  function populateProjectFields(){
    ensureProjectButton();
    ensureProjectTimingFields();
    const event = currentEditingEvent();
    if(event && event.tipo === 'proyecto'){
      const button = document.querySelector('#eventoTipoSelector [data-evento-tipo="proyecto"]');
      if(button && !button.classList.contains('active')){
        if(typeof selectEventoTipo === 'function') selectEventoTipo('proyecto', button);
        else {
          document.querySelectorAll('#eventoTipoSelector .evento-tipo-btn').forEach(item => item.classList.remove('active'));
          button.classList.add('active');
        }
      }
      const mode = event.fechaFlexibleTipo === 'sin-fecha' || (!event.fecha && !event.fechaObjetivoMes)
        ? 'none'
        : (event.fechaFlexibleTipo === 'mes' || event.fechaObjetivoMes ? 'month' : 'exact');
      setProjectMode(mode);
      const input = document.getElementById('eventoProyectoMes');
      if(input) input.value = event.fechaObjetivoMes || String(event.fechaFlexibleDesde || '').slice(0,7) || String(event.fecha || '').slice(0,7);
      setProjectProgressVisual(event.projectProgress ?? event.progreso ?? 0);
    } else {
      setProjectMode('none');
      const input = document.getElementById('eventoProyectoMes');
      if(input) input.value = '';
      setProjectProgressVisual(0);
    }
    updateProjectVisibility();
  }

  function patchSaveEventoForProjects(){
    if(typeof window.saveEvento !== 'function') return false;
    for(let fn = window.saveEvento; fn; fn = fn.__original) if(fn.__projectFlexibleV3) return true;
    if(!window.EventPlanning) return false;
    const original = window.saveEvento;
    const patched = function(){
      const data = appDb();
      const editId = document.getElementById('eventoEditId')?.value || '';
      const before = new Set((data && data.eventos || []).map(item => String(item.id || '')));
      const type = activeEventType();
      const mode = projectMode();
      const month = document.getElementById('eventoProyectoMes')?.value || '';
      const progress = setProjectProgressVisual(document.getElementById('eventoProyectoProgreso')?.value || 0);
      const dateInput = document.getElementById('eventoFecha');
      const endInput = document.getElementById('eventoFechaFin');
      if(type === 'proyecto' && mode === 'month' && !month){
        if(typeof showToast === 'function') showToast('Elige el mes objetivo del proyecto');
        return false;
      }
      if(type === 'proyecto' && mode === 'exact' && !dateInput?.value){
        if(typeof showToast === 'function') showToast('Elige la fecha objetivo del proyecto');
        return false;
      }
      if(type === 'proyecto' && mode === 'month' && month){
        if(dateInput) dateInput.value = isoEndOfMonth(month);
        if(endInput) endInput.value = '';
      } else if(type === 'proyecto' && mode === 'none'){
        if(dateInput) dateInput.value = '';
        if(endInput) endInput.value = '';
      }
      const result = original.apply(this, arguments);
      if(result === false) return false;
      const apply = () => {
        const current = appDb();
        if(!current || !Array.isArray(current.eventos)) return;
        let event = editId ? current.eventos.find(item => String(item.id) === String(editId)) : null;
        if(!event) event = current.eventos.find(item => item && !before.has(String(item.id || '')));
        if(!event || type !== 'proyecto') return;
        event.tipo = 'proyecto';
        event.projectProgress = progress;
        event.projectProgressUpdatedAt = new Date().toISOString();
        if(mode === 'month' && month){
          event.fechaFlexibleTipo = 'mes';
          event.fechaObjetivoMes = month;
          event.fechaFlexibleDesde = isoStartOfMonth(month);
          event.fechaFlexibleHasta = isoEndOfMonth(month);
          event.fechaFlexibleLabel = monthLabel(month);
          event.fecha = event.fechaFlexibleHasta;
          event.fechaFin = '';
        } else if(mode === 'none') {
          event.fechaFlexibleTipo = 'sin-fecha';
          event.fechaObjetivoMes = null;
          event.fechaFlexibleDesde = null;
          event.fechaFlexibleHasta = null;
          event.fechaFlexibleLabel = null;
          event.fecha = '';
          event.fechaFin = '';
        } else {
          event.fechaFlexibleTipo = 'dia';
          event.fechaObjetivoMes = null;
          event.fechaFlexibleDesde = null;
          event.fechaFlexibleHasta = null;
          event.fechaFlexibleLabel = null;
        }
        persist();
        try { if(typeof renderCalendario === 'function') renderCalendario(); } catch(error){}
        try { if(typeof renderCronoCalendar === 'function') renderCronoCalendar(); } catch(error){}
        try { if(typeof renderEventos === 'function') renderEventos(); } catch(error){}
        try { if(typeof renderMesCalendario === 'function') renderMesCalendario(); } catch(error){}
      };
      if(result && typeof result.then === 'function') return result.then(value => { if(value !== false) apply(); return value; });
      apply();
      return result;
    };
    patched.__projectFlexibleV3 = true;
    patched.__original = original;
    window.saveEvento = patched;
    try { saveEvento = patched; } catch(error){}
    return true;
  }

  function competitionUrlFor(name, source){
    const value = `${source || ''} ${name || ''}`;
    const match = COMPETITION_LINKS.find(item => item.key.test(value));
    return match ? match.url : '';
  }

  function applyCompetitionUrls(){
    const data = appDb();
    if(!data) return false;
    let changed = false;
    if(Array.isArray(data.competitionPlans)){
      data.competitionPlans.forEach(plan => {
        const url = plan && (plan.officialUrl || competitionUrlFor(plan.name, plan.id));
        if(plan && url && plan.officialUrl !== url){ plan.officialUrl = url; changed = true; }
      });
    }
    if(Array.isArray(data.eventos)){
      data.eventos.forEach(event => {
        if(!event) return;
        const source = event.planSourceId || event.parentSourceId || '';
        const name = event.competition?.name || event.nombre || '';
        const url = event.competition?.officialUrl || competitionUrlFor(name, source);
        if(!url) return;
        if(!event.competition) event.competition = {};
        if(event.competition.officialUrl !== url){ event.competition.officialUrl = url; changed = true; }
        if(event.officialUrl !== url){ event.officialUrl = url; changed = true; }
      });
    }
    if(changed) persist();
    return changed;
  }

  function renderCompetitionOfficialLink(){
    const hero = document.getElementById('competitionDossierHero');
    if(!hero || hero.hidden || !hero.offsetParent) return;
    const event = currentEditingEvent();
    if(!event) return;
    const source = event.planSourceId || event.parentSourceId || '';
    const name = event.competition?.name || event.nombre || '';
    const url = event.competition?.officialUrl || event.officialUrl || competitionUrlFor(name, source);
    let host = hero.querySelector('.competition-official-actions');
    if(!url){ if(host) host.remove(); return; }
    if(host?.querySelector('.competition-official-link')?.getAttribute('href') === url) return;
    if(!host){
      host = document.createElement('div');
      host.className = 'competition-official-actions';
      hero.appendChild(host);
    }
    host.innerHTML = '';
    const link = document.createElement('a');
    link.className = 'competition-official-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Abrir web oficial ↗';
    link.setAttribute('aria-label', `Abrir página web oficial de ${name || 'este concurso'}`);
    host.appendChild(link);
  }

  function guideBandLimits(range){
    const values=String(range||'').split(/[–-]/).map(value=>Number(value.trim())).filter(Number.isFinite);
    return {min:values[0]||0,max:values.length>1?values[1]:(values[0]||0)};
  }

  function guideRatingValue(slider){
    const semantic=Number(slider?.dataset?.paseValue);
    if(Number.isFinite(semantic))return semantic;
    try{
      if(typeof window.pasePositionToPct==='function')return Number(window.pasePositionToPct(slider?.value))||50;
    }catch(error){}
    return Number(slider?.value)||50;
  }

  function refreshGuideCurrentBand(guide,slider){
    if(!guide||!slider)return;
    const value=guideRatingValue(slider);
    guide.querySelectorAll('[data-rating-min]').forEach(row=>{
      const current=value>=Number(row.dataset.ratingMin)&&value<=Number(row.dataset.ratingMax);
      row.classList.toggle('is-current',current);
      if(current)row.setAttribute('aria-current','true');
      else row.removeAttribute('aria-current');
    });
  }

  function bindHechoGuideCurrentBand(guide){
    const slider=document.getElementById('hechoSolidezSlider');
    if(!guide||!slider||guide.dataset.currentBandBound==='1')return;
    guide.dataset.currentBandBound='1';
    const refresh=()=>refreshGuideCurrentBand(guide,slider);
    slider.addEventListener('input',refresh);
    slider.addEventListener('change',refresh);
    try{new MutationObserver(refresh).observe(slider,{attributes:true,attributeFilter:['data-pase-value','value']});}catch(error){}
    refresh();
  }

  // La escala (nombres, tramos y descripciones) vive en app.js; aquí solo se
  // monta el contenedor. planning-enhancements-v4 la adapta a la obra.
  function guideHtml(){
    let body='';
    try{if(typeof window.paseScaleGuideBodyHtml==='function')body=window.paseScaleGuideBodyHtml('solo');}catch(error){}
    return `<details class="solidity-guide-v3" open>
      <summary>Guía para puntuar <span>0–100</span></summary>
      <div class="solidity-guide-body">${body}</div>
    </details>`;
  }

  function ensureSolidityGuide(){
    const quick = document.getElementById('quickSolRubric');
    if(quick && !document.getElementById('solidityGuideQuickV3')){
      const wrap = document.createElement('div');
      wrap.id = 'solidityGuideQuickV3';
      wrap.innerHTML = guideHtml();
      quick.insertAdjacentElement('afterend', wrap);
    }
    const section = document.getElementById('hechoSolidezSection');
    if(section && !document.getElementById('solidityGuideHechoV3')){
      const wrap = document.createElement('div');
      wrap.id = 'solidityGuideHechoV3';
      wrap.className = 'solidity-guide-hecho-wrap';
      wrap.innerHTML = guideHtml();
      section.appendChild(wrap);
    }
    const hechoGuide=document.querySelector('#solidityGuideHechoV3 .solidity-guide-v3');
    const legacyGuide=document.getElementById('hechoRatingGuide');
    if(hechoGuide){
      bindHechoGuideCurrentBand(hechoGuide);
      if(legacyGuide){
        legacyGuide.hidden=true;
        legacyGuide.setAttribute('aria-hidden','true');
        legacyGuide.dataset.supersededBy='solidityGuideHechoV3';
      }
    }
  }

  function observeUi(){
    if(window.__planningV3Observer) return;
    const observer = new MutationObserver(() => {
      ensureProjectButton();
      ensureProjectTimingFields();
      updateProjectVisibility();
      ensureSolidityGuide();
      renderCompetitionOfficialLink();
    });
    observer.observe(document.documentElement, { subtree:true, childList:true });
    window.__planningV3Observer = observer;

    const modal = document.getElementById('modalAddEvento');
    if(modal){
      new MutationObserver(() => {
        if(modal.classList.contains('open') || modal.classList.contains('visible')) setTimeout(populateProjectFields, 0);
      }).observe(modal, { attributes:true, attributeFilter:['class'] });
    }
  }

  function install(){
    ensureProjectButton();
    ensureProjectTimingFields();
    ensureSolidityGuide();
    patchDictatedTaskPriority();
    patchSaveEventoForProjects();
    applyCompetitionUrls();
    renderCompetitionOfficialLink();
    observeUi();
    window.PlanningEnhancementsV3 = {
      version: VERSION,
      priorityFromText,
      competitionUrlFor,
      clampProjectProgress,
      projectWindow(event){
        if(!event) return null;
        if(event.fechaFlexibleTipo === 'mes' && event.fechaFlexibleDesde && event.fechaFlexibleHasta) return { start:event.fechaFlexibleDesde, end:event.fechaFlexibleHasta, flexible:true };
        return event.fecha ? { start:event.fecha, end:event.fechaFin || event.fecha, flexible:false } : null;
      },
    };
  }

  function boot(attempt){
    install();
    const taskReady = typeof window.confirmCronoTomorrowTask === 'function' && window.confirmCronoTomorrowTask.__priorityDictationV3;
    const eventReady = patchSaveEventoForProjects();
    if(taskReady && eventReady) return;
    if(attempt < 120) setTimeout(() => boot(attempt + 1), 100);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), { once:true });
  else boot(0);
})();
