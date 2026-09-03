/* Planning enhancements v4
 * - Chamber/concerto readiness semantics: own part first, ensemble evidence late.
 * - Personal projects get their own event section and month-target language.
 * - Dictated task priority works in inline tasks and tomorrow notes, stripping keywords.
 * - On iPhone/iPad, automatic Web Speech is suppressed: use keyboard dictation without a web microphone prompt.
 */
(function planningEnhancementsV4(){
  'use strict';

  const VERSION = 4;
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

  function suppressWebSpeechOnIOS(){
    if(!isIOS() || window.__planningV4SpeechSuppressed) return;
    window.__planningV4SpeechSuppressed = true;
    document.documentElement.classList.add('planning-ios-keyboard-dictation');
    ['SpeechRecognition','webkitSpeechRecognition'].forEach(name => {
      const Native = window[name];
      if(typeof Native !== 'function' || !Native.prototype || Native.prototype.__planningV4Suppressed) return;
      const proto = Native.prototype;
      const originalStart = proto.start;
      if(typeof originalStart !== 'function') return;
      try {
        proto.start = function(){
          this.__planningV4StartSuppressed = true;
          const instance = this;
          const end = () => { try { if(typeof instance.onend === 'function') instance.onend(); } catch(error){} };
          if(typeof queueMicrotask === 'function') queueMicrotask(end); else setTimeout(end,0);
        };
        proto.__planningV4Suppressed = true;
        proto.__planningV4OriginalStart = originalStart;
      } catch(error){ console.warn('[planning-v4] no se pudo suprimir Web Speech', name, error); }
    });
  }

  function installIosDictationHints(){
    if(!isIOS()) return;
    const tomorrowHint = document.querySelector('#modalCronoNote .crono-note-hint');
    if(tomorrowHint && tomorrowHint.dataset.keyboardDictation !== 'v4'){
      tomorrowHint.textContent = 'En iPhone/iPad, dicta con el micrófono del teclado. Así la web no necesita pedir permiso de micrófono.';
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

  function refineSolidityGuide(){
    document.querySelectorAll('.solidity-guide-v3').forEach(guide => {
      if(guide.dataset.ensembleSemantics === 'v4') return;
      const contexts = guide.querySelector('.solidity-guide-contexts');
      if(!contexts) return;
      contexts.innerHTML = `
        <section><h4>Obra nueva</h4><p>La cobertura cuenta. Una obra con páginas todavía no aprendidas no puede tener una puntuación alta porque los fragmentos conocidos salgan muy bien. El pase completo manda y, si hay movimientos, el más débil limita el conjunto.</p><p><b>Anclas:</b> 25 = se cae · 45 = frágil · 65 = sale con atención · 80 = segura · 95 = lista para exponer.</p></section>
        <section><h4>Cámara · tu parte primero</h4><p><strong>Durante el estudio solo, puntúa tu propia parte.</strong> No bajes la píldora porque los demás músicos no estén presentes. Si se toca con partitura, la memoria tampoco se penaliza: valora continuidad, ritmo, entradas que puedes preparar, cambios, silencios, navegación y recuperación.</p><p>Cuando empiecen los ensayos, la experiencia conjunta añade evidencia sobre escucha, reacción, balance y coordinación. Pesa sobre todo para justificar el tramo final (aprox. 90–100), pero no reescribe artificialmente una preparación individual que aún no ha podido probarse con el grupo.</p></section>
        <section><h4>Concierto con orquesta</h4><p>La base sigue siendo <strong>tu parte de piano</strong>: notas, continuidad, memoria si procede, tempi, cadencias, resistencias y capacidad de seguir tras un error. Eso se puede puntuar estudiando solo.</p><p>En la fase final cuentan además entradas orquestales, esperas, cues, flexibilidad con director y capacidad de encajar después de tuttis. Un ensayo con orquesta aporta evidencia especialmente importante para 90+. Antes de tenerlo, esa capa está <em>sin comprobar</em>, no automáticamente “mal”.</p></section>
        <section><h4>Repertorio recuperado</h4><p>La píldora sigue describiendo <strong>cómo está hoy</strong>. Haberla tocado antes no conserva una nota antigua por decreto. Si hoy el primer pase es 45, registra 45.</p><p>El dominio previo sí sirve para otra cosa: la app espera que recuperes más deprisa y reduce las horas estimadas necesarias. Por eso una recuperación puede saltar de 40 a 75 mucho más rápido que una obra nueva sin falsear la medición actual.</p></section>`;
      const principle = guide.querySelector('.solidity-guide-principle');
      if(principle) principle.innerHTML = '<strong>Regla principal:</strong> la píldora mide lo que <em>tú</em> puedes hacer hoy. En cámara y concierto, el trabajo individual es la base; la coordinación conjunta se incorpora cuando existe evidencia real, sobre todo en el tramo de exposición.';
      guide.dataset.ensembleSemantics = 'v4';
    });
  }

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function projectTarget(event){
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

  function projectSignature(projects){
    return JSON.stringify(projects.map(project => [project.id,project.nombre,project.estado,project.fecha,project.fechaObjetivoMes,project.fechaFlexibleLabel,(project.obras||[]).length]));
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
      section.innerHTML = `<header><div><span>Objetivos sin día rígido</span><strong>Proyectos personales</strong></div><small>${projects.length}</small></header><div class="personal-projects-grid">${projects.map(project => {
        const works = Array.isArray(project.obras) ? project.obras.length : 0;
        const flexible = project.fechaFlexibleTipo === 'mes' || project.fechaObjetivoMes;
        return `<button type="button" class="personal-project-card" data-project-event-id="${esc(project.id)}"><div><b>${esc(project.nombre || 'Proyecto')}</b><span>${flexible?'Objetivo flexible':'Objetivo'} · ${esc(projectTarget(project))}</span></div><em>${works ? works+' obra'+(works===1?'':'s') : 'Proyecto'} · ${esc(project.estado || 'confirmado')}</em></button>`;
      }).join('')}</div>`;
      section.querySelectorAll('[data-project-event-id]').forEach(button => button.addEventListener('click', () => {
        const id = button.dataset.projectEventId;
        const original = Array.from(document.querySelectorAll('#eventosList .evento-card')).find(card => card.dataset.projectOriginalId === id);
        if(original) original.click();
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
    suppressWebSpeechOnIOS();
    installInlinePriorityCapture();
    patchTomorrowPriority();
    refreshUi();
    observeUi();
    window.PlanningEnhancementsV4 = { version:VERSION, priorityFromText, stripPriorityKeyword, parseTaskText, isIOS, refreshUi };
  }

  function boot(attempt){
    install();
    if(typeof window.confirmCronoTomorrowTask === 'function' && window.confirmCronoTomorrowTask.__planningV4Priority) return;
    if(attempt < 120) setTimeout(() => boot(attempt+1), 100);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), {once:true});
  else boot(0);
})();
