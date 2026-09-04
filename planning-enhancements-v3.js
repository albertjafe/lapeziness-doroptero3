/* Planning enhancements v3
 * - Dictated task priorities: urgentísima/urgente/normal/default blank.
 * - Project events with exact or month-flexible targets.
 * - Complete 0–100 solidity guide for new, chamber-with-score and recovered repertoire.
 * - Official website links in every imported competition dossier.
 */
(function planningEnhancementsV3(){
  'use strict';

  const VERSION = 3;
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

  const GUIDE_BANDS = [
    ['0–9', 'Apenas empezada', 'Estás descubriendo notas, digitación o estructura. No existe todavía un pase reconocible de principio a fin.'],
    ['10–24', 'En construcción', 'Hay fragmentos que empiezan a responder, pero todavía dependes de parar, aislar y reconstruir. Grandes zonas siguen sin estar disponibles de forma continua.'],
    ['25–39', 'Se cae', 'Reconoces casi todo el camino, pero un pase pierde el hilo, obliga a reiniciar o deja agujeros importantes. El resultado cambia muchísimo de un intento a otro.'],
    ['40–54', 'Frágil', 'Puedes llegar al final en condiciones de estudio, aunque con paradas, vacilaciones, simplificaciones o errores que rompen claramente la continuidad. Todavía hay bastante factor suerte.'],
    ['55–69', 'Estable con atención', 'La obra sale mayoritariamente entera. Hay fallos o zonas tensas, pero normalmente puedes seguir y recuperar. Necesitas vigilancia consciente para que no se desmonte.'],
    ['70–79', 'Estable', 'Los pases completos suelen funcionar. Los errores no destruyen el discurso y el plan musical sobrevive. Ya puedes trabajar más en calidad que en mera supervivencia.'],
    ['80–89', 'Segura', 'Varios pases completos son consistentes. Puedes concentrarte en sonido, fraseo y decisiones musicales sin temer constantemente una caída. Es razonable probar clase, grabación o situación de exposición.'],
    ['90–96', 'Brillante · lista para exponer', 'Funciona repetidamente incluso con presión, cansancio o una sola oportunidad. Los problemas son locales y rara vez comprometen el conjunto.'],
    ['97–99', 'Fiabilidad excepcional', 'Nivel de concurso o grabación muy asentado: múltiples pases y días confirman una consistencia extraordinaria. Aun así, 100 queda reservado para tu máximo estándar.'],
    ['100', 'Referencia', 'La tocarías ahora en público y esperarías que saliera perfecta. Es el techo subjetivo de la app, no una promesa estadística de que jamás pueda ocurrir un error.'],
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
      <div class="event-project-kicker">Fecha objetivo del proyecto</div>
      <div class="event-project-mode" role="radiogroup" aria-label="Precisión de la fecha objetivo">
        <button type="button" data-project-mode="exact" aria-pressed="true">Día concreto</button>
        <button type="button" data-project-mode="month" aria-pressed="false">Mes flexible</button>
      </div>
      <label class="evento-form-field event-project-month-field" hidden>
        <span>Quiero tenerlo para <small>mes aproximado</small></span>
        <input class="modal-input" id="eventoProyectoMes" type="month">
      </label>
      <p class="event-project-help">“Mes flexible” crea una ventana de planificación hasta el final del mes, sin fingir que existe un día exacto. La IA puede repartir el trabajo dentro de esa ventana.</p>`;
    dateRange.insertAdjacentElement('afterend', section);
    section.querySelectorAll('[data-project-mode]').forEach(button => button.addEventListener('click', () => setProjectMode(button.dataset.projectMode)));
    return true;
  }

  function projectMode(){
    return document.querySelector('#eventProjectTiming [data-project-mode][aria-pressed="true"]')?.dataset.projectMode || 'exact';
  }

  function setProjectMode(mode){
    const next = mode === 'month' ? 'month' : 'exact';
    document.querySelectorAll('#eventProjectTiming [data-project-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.projectMode === next)));
    const monthField = document.querySelector('#eventProjectTiming .event-project-month-field');
    const dateRange = document.querySelector('#modalAddEvento .evento-date-range');
    if(monthField) monthField.hidden = next !== 'month';
    if(dateRange) dateRange.classList.toggle('project-date-hidden', activeEventType() === 'proyecto' && next === 'month');
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
      const mode = event.fechaFlexibleTipo === 'mes' || event.fechaObjetivoMes ? 'month' : 'exact';
      setProjectMode(mode);
      const input = document.getElementById('eventoProyectoMes');
      if(input) input.value = event.fechaObjetivoMes || String(event.fechaFlexibleDesde || '').slice(0,7) || String(event.fecha || '').slice(0,7);
    } else {
      setProjectMode('exact');
      const input = document.getElementById('eventoProyectoMes');
      if(input) input.value = '';
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
      if(type === 'proyecto' && mode === 'month' && month){
        const dateInput = document.getElementById('eventoFecha');
        const endInput = document.getElementById('eventoFechaFin');
        if(dateInput) dateInput.value = isoEndOfMonth(month);
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
        if(mode === 'month' && month){
          event.fechaFlexibleTipo = 'mes';
          event.fechaObjetivoMes = month;
          event.fechaFlexibleDesde = isoStartOfMonth(month);
          event.fechaFlexibleHasta = isoEndOfMonth(month);
          event.fechaFlexibleLabel = monthLabel(month);
          event.fecha = event.fechaFlexibleHasta;
          event.fechaFin = '';
        } else {
          event.fechaFlexibleTipo = 'dia';
          event.fechaObjetivoMes = null;
          event.fechaFlexibleDesde = null;
          event.fechaFlexibleHasta = null;
          event.fechaFlexibleLabel = null;
        }
        persist();
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

  function guideHtml(){
    const rows = GUIDE_BANDS.map(([range,label,copy]) => `<div class="solidity-guide-row"><strong>${range}</strong><span><b>${label}</b>${copy}</span></div>`).join('');
    return `<details class="solidity-guide-v3" open>
      <summary>Guía completa para puntuar la píldora <span>0–100</span></summary>
      <div class="solidity-guide-body">
        <p class="solidity-guide-principle"><strong>Regla principal:</strong> puntúa lo que la obra puede hacer <em>hoy</em>, no el número de horas que llevas, lo difícil que sea ni lo bien que la tocaste hace años. La pregunta es: “si hago ahora un pase en las condiciones para las que la preparo, ¿qué fiabilidad tiene?”.</p>
        <div class="solidity-guide-bands">${rows}</div>
        <div class="solidity-guide-contexts">
          <section><h4>Obra nueva</h4><p>La cobertura cuenta. Una obra con páginas todavía no aprendidas no puede recibir una puntuación alta porque los fragmentos conocidos salgan muy bien. Usa como referencia el pase completo y, si hay movimientos, deja que el movimiento más débil limite la nota del conjunto.</p><p><b>Anclas útiles:</b> 25 = “se cae”; 45 = “frágil”; 65 = “sale con atención”; 80 = “sale entera con seguridad”; 95 = “lista para exponer”.</p></section>
          <section><h4>Cámara · con partitura</h4><p><strong>No penalices por tocar con partitura.</strong> La memoria no forma parte de la puntuación si la interpretación prevista es con partitura. Valora continuidad, entradas, cambios de tempo, coordinación, capacidad de escuchar y reaccionar, estabilidad rítmica, navegación de página y recuperación tras un error. Un 90–95 con partitura puede ser plenamente “de escenario”.</p><p>En un ensayo sin compañeros, puntúa lo que realmente puedes saber: tu parte y tus entradas. Cuando haya ensayos conjuntos, deja que la experiencia real del ensemble mande.</p></section>
          <section><h4>Repertorio recuperado</h4><p>No copies automáticamente la antigua puntuación. Si la tocaste en concurso hace cinco años pero hoy el primer pase es frágil, registra el nivel de hoy. El historial previo sirve para que la app estime que recuperar será más rápido; <strong>no infla la píldora actual</strong>.</p><p>Es normal que una recuperación salte de 35 a 70 mucho más deprisa que una obra nueva. Cuando vuelva la fiabilidad de los pases, sube la nota sin miedo.</p></section>
        </div>
        <p class="solidity-guide-foot"><strong>Para grabación o concurso:</strong> exige evidencia más dura antes de usar 90+. Idealmente varios pases completos, en más de un día y con condiciones parecidas a la exposición real. Una toma brillante aislada no convierte automáticamente la obra en 95.</p>
      </div>
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
