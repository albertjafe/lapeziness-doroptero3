/* Planning enhancements v4
 * - Chamber/concerto readiness semantics: own part first, ensemble evidence late.
 * - Personal projects get their own event section, deadline-free mode and progress bar.
 * - Dictated task priority works in inline tasks and tomorrow notes, stripping keywords.
 * - On iPhone/iPad, automatic Web Speech is suppressed: use keyboard dictation without a web microphone prompt.
 */
(function planningEnhancementsV4(){
  'use strict';

  const VERSION = 6;
  const TASK_INPUT_SELECTOR = [
    '#cronoIdleTaskInput', '#cronoTaskInput',
    'input[id*="TaskInput"]', 'textarea[id*="TaskInput"]',
    '.crono-task-input'
  ].join(',');

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
    } catch(error){ console.warn('[planning-v4] no se pudo guardar', error); }
  }

  function normalize(text){
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }

  function priorityFromText(text){
    const value = normalize(text);
    if(/\burgentisim[oa]\b/.test(value)) return 3;
    if(/\burgente\b/.test(value)) return 2;
    if(/\bnormal\b/.test(value)) return 1;
    return 0;
  }

  function stripPriorityKeyword(text){
    return String(text || '')
      .replace(/\burgent[ií]sim[oa]\b/gi, ' ')
      .replace(/\burgente\b/gi, ' ')
      .replace(/\bnormal\b/gi, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/(^|\s)[,;:]\s*/g, '$1')
      .replace(/[,;:]\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function parseTaskText(text){
    return {
      raw: String(text || ''),
      text: stripPriorityKeyword(text),
      priority: priorityFromText(text),
      explicit: /\burgent[ií]sim[oa]\b|\burgente\b|\bnormal\b/i.test(String(text || '')),
    };
  }

  function taskList(){
    try { if(typeof window.cronoTasks === 'function') return window.cronoTasks(); } catch(error){}
    const data = appDb();
    if(!data) return [];
    if(!Array.isArray(data.cronoTasks)) data.cronoTasks = [];
    return data.cronoTasks;
  }

  function snapshotTaskIds(){
    return new Set(taskList().map(item => String(item && item.id || '')).filter(Boolean));
  }

  function newestNewTask(beforeIds, preferredText, source){
    const rows = taskList().filter(item => item && !beforeIds.has(String(item.id || '')) && (!source || item.source === source));
    const exact = rows.filter(item => !preferredText || String(item.text || '') === String(preferredText));
    return (exact.length ? exact : rows).sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
  }

  function applyPriority(task, parsed){
    if(!task || !parsed) return;
    task.priority = parsed.priority;
    task.prioritySource = parsed.explicit ? 'dictation-keyword' : 'default-blank';
    task.priorityDetectedAt = new Date().toISOString();
    if(parsed.text && String(task.text || '') !== parsed.text) task.text = parsed.text;
    persist();
    try { if(typeof window.renderCronoTasks === 'function') window.renderCronoTasks(); } catch(error){}
  }

  function inputNearButton(button){
    const scope = button && (button.closest('.crono-tasks-panel') || button.closest('.crono-run-drawer-panel') || button.parentElement);
    return (scope && scope.querySelector(TASK_INPUT_SELECTOR)) || document.querySelector(TASK_INPUT_SELECTOR);
  }

  function prepareInlineTask(input){
    if(!input || !String(input.value || '').trim()) return null;
    const parsed = parseTaskText(input.value);
    const before = snapshotTaskIds();
    if(parsed.explicit && parsed.text){
      input.value = parsed.text;
      input.dispatchEvent(new Event('input', { bubbles:true }));
    }
    return { parsed, before };
  }

  function finishInlineTask(pending){
    if(!pending) return;
    setTimeout(() => {
      const task = newestNewTask(pending.before, pending.parsed.text);
      if(task) applyPriority(task, pending.parsed);
    }, 0);
  }

  function installInlinePriorityCapture(){
    if(window.__planningV4InlinePriority) return;
    window.__planningV4InlinePriority = true;
    document.addEventListener('click', event => {
      const button = event.target && event.target.closest ? event.target.closest('.crono-task-add-btn') : null;
      if(!button) return;
      finishInlineTask(prepareInlineTask(inputNearButton(button)));
    }, true);
    document.addEventListener('keydown', event => {
      if(event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      const input = event.target && event.target.matches && event.target.matches(TASK_INPUT_SELECTOR) ? event.target : null;
      if(!input) return;
      finishInlineTask(prepareInlineTask(input));
    }, true);
  }

  function patchTomorrowPriority(){
    const fn = window.confirmCronoTomorrowTask;
    if(typeof fn !== 'function' || fn.__planningV4Priority) return false;
    const patched = function(){
      const input = document.getElementById('cronoNoteInput');
      const parsed = parseTaskText(input?.value || '');
      const before = snapshotTaskIds();
      if(input && parsed.explicit && parsed.text){
        input.value = parsed.text;
        input.dispatchEvent(new Event('input', { bubbles:true }));
      }
      const result = fn.apply(this, arguments);
      const finish = () => setTimeout(() => {
        const task = newestNewTask(before, parsed.text, 'tomorrow-note') || newestNewTask(before, parsed.text);
        if(task) applyPriority(task, parsed);
      }, 20);
      if(result && typeof result.then === 'function') result.finally(finish); else finish();
      return result;
    };
    patched.__planningV4Priority = true;
    patched.__original = fn;
    window.confirmCronoTomorrowTask = patched;
    try { confirmCronoTomorrowTask = patched; } catch(error){}
    return true;
  }

  function isIOS(){
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  }

  function installIosDictationHints(){
    if(!isIOS()) return;
    const tomorrowHint = document.querySelector('#modalCronoNote .crono-note-hint');
    if(tomorrowHint && tomorrowHint.dataset.keyboardDictation !== 'v4'){
      tomorrowHint.textContent = 'Puedes dictar automáticamente; acepta el permiso de micrófono si el navegador lo solicita.';
      tomorrowHint.dataset.keyboardDictation = 'v4';
    }
    document.querySelectorAll(TASK_INPUT_SELECTOR).forEach(input => {
      if(input.dataset.keyboardDictationHint === 'v4') return;
      input.dataset.keyboardDictationHint = 'v4';
      const parent = input.closest('.crono-task-add-row') || input.parentElement;
      if(!parent) return;
      const hint = document.createElement('div');
      hint.className = 'ios-keyboard-dictation-hint';
      hint.textContent = 'Dictado: usa el micrófono del teclado del iPad/iPhone.';
      parent.insertAdjacentElement('afterend', hint);
    });
  }

  function formatStudyMinutes(minutes){
    const total=Math.max(0,Math.round(Number(minutes)||0));
    const hours=Math.floor(total/60),rest=total%60;
    if(hours&&rest)return `${hours} h ${rest} min`;
    if(hours)return `${hours} h`;
    return `${rest} min`;
  }

  function currentHechoGuideContext(){
    const data=appDb();
    let obraId=null;
    try{obraId=typeof _hechoObraId!=='undefined'?_hechoObraId:null;}catch(error){}
    const work=(data?.obras||[]).find(item=>item&&String(item.id)===String(obraId))||null;
    let profile='solo';
    try{if(typeof window.paseWorkRatingProfile==='function')profile=window.paseWorkRatingProfile(work);}catch(error){}
    let study={state:'nueva',cutoffYears:3,totalMinutes:0,recentMinutes:0,sessions:0,recentSessions:0,lastAt:null};
    try{if(typeof window.paseWorkStudyContext==='function')study=window.paseWorkStudyContext(obraId);}catch(error){}
    return {work,profile,study};
  }

  function studyEvidenceCopy(study){
    if(study.state==='trabajada')return `La app reconoce ${formatStudyMinutes(study.totalMinutes)} de estudio real en ${study.sessions} sesiones. Ya no la trata como una primera lectura: compara la fiabilidad de hoy con una obra que conoces.`;
    if(study.state==='larga-pausa')return `No hay al menos dos sesiones o una hora de estudio real en los últimos ${study.cutoffYears} años. Se trata como un reinicio: el dominio antiguo puede acelerar la recuperación, pero no sube la nota de hoy.`;
    return `Aún no constan dos sesiones o una hora de estudio real. Se trata como obra nueva; el repertorio histórico por sí solo no cambia esta lectura.`;
  }

  function contextualGuideCopy(context){
    const evidence=studyEvidenceCopy(context.study);
    if(context.profile==='camara')return {
      label:'Cámara',
      principle:'<strong>Regla principal:</strong> puntúa la fiabilidad de <em>tu parte</em> hoy. La partitura es parte normal de la interpretación y no resta puntos.',
      contexts:`<section><h4>Cámara · con partitura</h4><p>Valora continuidad, pulso, entradas preparables, cambios, silencios, navegación de página, recuperación tras un error y libertad para escuchar. “Memorizada” no interviene en esta escala.</p><p>El ensayo conjunto añade evidencia de coordinación, balance y reacción, sobre todo para justificar 90–100; antes del ensayo esa capa está sin comprobar, no suspendida.</p><p class="solidity-guide-evidence">${evidence}</p></section>`,
      foot:'<strong>Tramo final:</strong> 90+ significa que tu parte funciona repetidamente y que, cuando ya hubo ensayo, también responde dentro del conjunto.',
    };
    if(context.profile==='acompanamiento')return {
      label:'Acompañamiento',
      principle:'<strong>Regla principal:</strong> mide si puedes sostener, escuchar y seguir al solista con continuidad; no si puedes tocar la reducción de memoria.',
      contexts:`<section><h4>Acompañamiento · con partitura</h4><p>Valora lectura estable, reducciones practicables, entradas, cortes, respiración, flexibilidad de tempo, balance y capacidad de reencontrarte si el solista cambia algo. La memoria no forma parte de la puntuación.</p><p>Sin solista puedes medir tu parte y la preparación de los puntos de reacción. Para 90–100 conviene evidencia real de ensayo, clase o audición.</p><p class="solidity-guide-evidence">${evidence}</p></section>`,
      foot:'<strong>Tramo final:</strong> una ejecución individual impecable no sustituye la capacidad demostrada de acompañar y reaccionar.',
    };
    const title=context.study.state==='trabajada'?'Obra ya trabajada':context.study.state==='larga-pausa'?'Reinicio tras larga pausa':'Obra nueva';
    return {
      label:title,
      principle:'<strong>Regla principal:</strong> puntúa lo que la obra puede hacer <em>hoy</em>. Las horas acumuladas explican la velocidad de aprendizaje, no conceden fiabilidad automática.',
      contexts:`<section><h4>${title}</h4><p>${context.study.state==='trabajada'?'Mide continuidad, recuperación, estabilidad y libertad musical. Ya no importa demostrar que conoces las notas, sino cuánto puedes confiar en un pase completo hoy.':'La cobertura manda: fragmentos brillantes no compensan páginas que todavía no están disponibles. El pase completo y el movimiento más débil limitan la nota.'}</p><p class="solidity-guide-evidence">${evidence}</p></section>`,
      foot:'<strong>Para escena, grabación o concurso:</strong> reserva 90+ para varios pases completos, en más de un día y bajo condiciones parecidas a la exposición real.',
    };
  }

  function refineSolidityGuide(){
    document.querySelectorAll('.solidity-guide-v3').forEach(guide => {
      const contexts=guide.querySelector('.solidity-guide-contexts');
      if(!contexts)return;
      const hecho=!!guide.closest('#solidityGuideHechoV3');
      if(!hecho){
        if(guide.dataset.ensembleSemantics==='v4')return;
        contexts.innerHTML=`
          <section><h4>Obra nueva</h4><p>La cobertura cuenta. Una obra con páginas todavía no aprendidas no puede tener una puntuación alta porque los fragmentos conocidos salgan muy bien. El pase completo manda y, si hay movimientos, el más débil limita el conjunto.</p><p><b>Anclas:</b> 25 = se cae · 45 = frágil · 65 = sale con atención · 80 = segura · 95 = lista para exponer.</p></section>
          <section><h4>Cámara · tu parte primero</h4><p><strong>Durante el estudio solo, puntúa tu propia parte.</strong> No bajes la píldora porque los demás músicos no estén presentes. Si se toca con partitura, la memoria tampoco se penaliza: valora continuidad, ritmo, entradas que puedes preparar, cambios, silencios, navegación y recuperación.</p><p>Cuando empiecen los ensayos, la experiencia conjunta añade evidencia sobre escucha, reacción, balance y coordinación. Pesa sobre todo para justificar el tramo final (aprox. 90–100), pero no reescribe artificialmente una preparación individual que aún no ha podido probarse con el grupo.</p></section>
          <section><h4>Concierto con orquesta</h4><p>La base sigue siendo <strong>tu parte de piano</strong>: notas, continuidad, memoria si procede, tempi, cadencias, resistencias y capacidad de seguir tras un error. Eso se puede puntuar estudiando solo.</p><p>En la fase final cuentan además entradas orquestales, esperas, cues, flexibilidad con director y capacidad de encajar después de tuttis. Un ensayo con orquesta aporta evidencia especialmente importante para 90+. Antes de tenerlo, esa capa está <em>sin comprobar</em>, no automáticamente “mal”.</p></section>
          <section><h4>Repertorio recuperado</h4><p>La píldora sigue describiendo <strong>cómo está hoy</strong>. Haberla tocado antes no conserva una nota antigua por decreto. Si hoy el primer pase es 45, registra 45.</p><p>El dominio previo sí sirve para otra cosa: la app espera que recuperes más deprisa y reduce las horas estimadas necesarias. Por eso una recuperación puede saltar de 40 a 75 mucho más rápido que una obra nueva sin falsear la medición actual.</p></section>`;
        const principle=guide.querySelector('.solidity-guide-principle');
        if(principle)principle.innerHTML='<strong>Regla principal:</strong> la píldora mide lo que <em>tú</em> puedes hacer hoy. En cámara y concierto, el trabajo individual es la base; la coordinación conjunta se incorpora cuando existe evidencia real, sobre todo en el tramo de exposición.';
        guide.dataset.ensembleSemantics='v4';
        return;
      }
      const context=currentHechoGuideContext();
      const signature=[context.profile,context.study.state,context.study.totalMinutes,context.study.sessions].join('::');
      if(guide.dataset.contextSignature===signature)return;
      const copy=contextualGuideCopy(context);
      guide.dataset.contextSignature=signature;
      guide.dataset.ratingProfile=context.profile;
      const summary=guide.querySelector('summary');
      if(summary)summary.innerHTML=`Guía para puntuar · ${copy.label} <span>0–100</span>`;
      const principle=guide.querySelector('.solidity-guide-principle');
      if(principle)principle.innerHTML=copy.principle;
      contexts.innerHTML=copy.contexts;
      const foot=guide.querySelector('.solidity-guide-foot');
      if(foot)foot.innerHTML=copy.foot;
      guide.dataset.ensembleSemantics='v5-contextual';
    });
  }

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function projectTarget(event){
    if(event.fechaFlexibleTipo === 'sin-fecha' || (!event.fecha && !event.fechaObjetivoMes)) return 'Sin fecha límite';
    if(event.fechaFlexibleTipo === 'mes' && event.fechaFlexibleLabel) return event.fechaFlexibleLabel;
    if(event.fechaObjetivoMes){
      const [year,month] = String(event.fechaObjetivoMes).split('-').map(Number);
      if(year && month){
        const label = new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(new Date(year,month-1,1,12));
        return label.charAt(0).toUpperCase()+label.slice(1);
      }
    }
    if(event.fecha){
      const date = new Date(String(event.fecha).length === 10 ? event.fecha+'T12:00:00' : event.fecha);
      if(Number.isFinite(date.getTime())) return new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(date);
    }
    return 'Sin fecha';
  }

  function projectProgress(event){
    const value = Number(event?.projectProgress ?? event?.progreso ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  }

  function projectTargetPrefix(event){
    if(event.fechaFlexibleTipo === 'sin-fecha' || (!event.fecha && !event.fechaObjetivoMes)) return 'Horizonte abierto';
    if(event.fechaFlexibleTipo === 'mes' || event.fechaObjetivoMes) return 'Objetivo flexible';
    return 'Fecha objetivo';
  }

  function projectStatus(event){
    return ({ confirmado:'Activo', planificado:'Planificado', standby:'En pausa', completado:'Completado' })[event.estado] || event.estado || 'Activo';
  }

  function projectSignature(projects){
    return JSON.stringify(projects.map(project => [project.id,project.nombre,project.estado,project.fecha,project.fechaObjetivoMes,project.fechaFlexibleLabel,projectProgress(project),(project.obras||[]).length]));
  }

  function renderProjectsSection(){
    const data = appDb();
    const panel = document.getElementById('calPanelEventos');
    if(!data || !Array.isArray(data.eventos) || !panel) return;
    const projects = data.eventos.filter(item => item && item.tipo === 'proyecto' && item.estado !== 'descartado')
      .sort((a,b) => String(a.fechaFlexibleHasta || a.fecha || '9999').localeCompare(String(b.fechaFlexibleHasta || b.fecha || '9999')));

    let section = document.getElementById('personalProjectsSection');
    if(!section){
      section = document.createElement('section');
      section.id = 'personalProjectsSection';
      section.className = 'personal-projects-section';
      const past = document.getElementById('eventosPasadosList');
      if(past) past.insertAdjacentElement('beforebegin', section); else panel.appendChild(section);
    }
    if(!projects.length){
      if(!section.hidden || section.innerHTML){ section.hidden = true; section.innerHTML=''; section.dataset.signature=''; }
      return;
    }
    section.hidden = false;
    const signature = projectSignature(projects);
    if(section.dataset.signature !== signature){
      section.dataset.signature = signature;
      section.innerHTML = `<header><div><span>Trabajo a largo plazo</span><strong>Proyectos personales</strong></div><small>${projects.length}</small></header><div class="personal-projects-grid">${projects.map(project => {
        const works = Array.isArray(project.obras) ? project.obras.length : 0;
        const progress = projectProgress(project);
        return `<article class="personal-project-card">
          <button type="button" class="personal-project-open" data-project-event-id="${esc(project.id)}" aria-label="Editar proyecto ${esc(project.nombre || 'Proyecto')}">
            <div class="personal-project-copy"><b>${esc(project.nombre || 'Proyecto')}</b><span>${projectTargetPrefix(project)} · ${esc(projectTarget(project))}</span></div>
            <div class="personal-project-meta"><em>${works ? works+' obra'+(works===1?'':'s') : 'Proyecto general'} · ${esc(projectStatus(project))}</em><strong>${progress}%</strong></div>
            <div class="personal-project-progress" role="progressbar" aria-label="Progreso de ${esc(project.nombre || 'Proyecto')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div>
          </button>
          <button type="button" class="personal-project-delete" data-project-delete-id="${esc(project.id)}" aria-label="Eliminar proyecto ${esc(project.nombre || 'Proyecto')}" title="Eliminar">×</button>
        </article>`;
      }).join('')}</div>`;
      section.querySelectorAll('[data-project-event-id]').forEach(button => button.addEventListener('click', () => {
        const id = button.dataset.projectEventId;
        if(typeof openEditEvento === 'function') openEditEvento(id);
      }));
      section.querySelectorAll('[data-project-delete-id]').forEach(button => button.addEventListener('click', () => {
        const id = button.dataset.projectDeleteId;
        if(typeof deleteEvento === 'function') deleteEvento(id);
      }));
    }

    document.querySelectorAll('#eventosList .evento-card').forEach(card => {
      const text = normalize(card.textContent);
      const event = projects.find(project => normalize(project.nombre) && text.includes(normalize(project.nombre)));
      if(event){
        card.dataset.projectOriginalId = String(event.id);
        card.classList.add('project-original-hidden');
      } else {
        card.classList.remove('project-original-hidden');
        delete card.dataset.projectOriginalId;
      }
    });
  }

  function refreshUi(){
    refineSolidityGuide();
    installIosDictationHints();
    renderProjectsSection();
  }

  function observeUi(){
    if(window.__planningV4Observer) return;
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refreshUi, 30);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true});
    window.__planningV4Observer = observer;
  }

  function install(){
    installInlinePriorityCapture();
    patchTomorrowPriority();
    refreshUi();
    observeUi();
    window.PlanningEnhancementsV4 = { version:VERSION, priorityFromText, stripPriorityKeyword, parseTaskText, projectProgress, isIOS, refreshUi, refreshSolidityGuide:refineSolidityGuide };
  }

  function boot(attempt){
    install();
    if(typeof window.confirmCronoTomorrowTask === 'function' && window.confirmCronoTomorrowTask.__planningV4Priority) return;
    if(attempt < 120) setTimeout(() => boot(attempt+1), 100);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), {once:true});
  else boot(0);
})();
