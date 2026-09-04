(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorHandoffResilience = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /* El handoff anterior construía dos prompts: uno enorme para el portapapeles
     y otro abreviado para la URL. En iPad eso podía bloquear el hilo principal.
     V3 construye UNA representación reversible completa en un Web Worker. */
  const MAX_URL_ENCODED = 12000;
  const RULES = [
    'cada movimiento es unidad independiente',
    'horas históricas de obra=familiaridad, no solidez actual',
    'horas históricas no asignadas nunca se reparten entre movimientos',
    'solidez debe leerse con antigüedad y confianza/evidencia',
    'prioriza riesgo*urgencia*coste restante evitando enfriar otra unidad crítica',
    'usa estudio de hoy; no reinicies el día',
    'evento sin repertorio enlazado no crea prioridad musical',
    'si falta evidencia expresa incertidumbre; no inventes datos',
    'propón bloques concretos con duración y propósito',
  ].join(';');

  let installed = false;
  let installTimer = null;
  let reportWorker = null;
  let requestId = 0;
  const pendingReports = new Map();

  const arr = value => Array.isArray(value) ? value : [];

  function modeInstruction(mode) {
    if (mode === 'remaining') return 'organiza solo lo que queda de HOY desde ahora; no reinicies el día';
    if (mode === 'now') return 'dime qué estudiar AHORA: decisión principal, duración y plan B corto';
    if (mode === 'week') return 'balance de próximos 7 días y distribución estratégica por movimientos';
    return 'organiza HOY de forma realista movimiento por movimiento';
  }

  // Lossless projection: only byte-identical shared fields become references.
  // Unknown properties, nulls, decimal precision and full timestamps survive.
  function encodeReport(report) {
    const r = JSON.parse(JSON.stringify(report || {}));
    const events = [], eventMap = new Map(), works = [], workMap = new Map();
    const eventRef = e => {
      if (e == null) return null;
      const sig = JSON.stringify(e);
      if (!eventMap.has(sig)) { eventMap.set(sig, events.length); events.push(e); }
      return eventMap.get(sig);
    };
    const eventOrder = arr(r.events).map(eventRef);
    const units = arr(r.units).map(u => {
      const common = {};
      for (const key of ['obraId','composer','work','historicalWorkMinutes','historicalWorkHours','workUnallocatedModernMinutes','workState']) {
        if (Object.hasOwn(u, key)) common[key] = u[key];
      }
      const sig = JSON.stringify(common);
      if (!workMap.has(sig)) { workMap.set(sig, works.length); works.push(common); }
      const data = { ...u };
      Object.keys(common).forEach(k => delete data[k]);
      const refs = {};
      if (Object.hasOwn(data, 'linkedEvents')) { refs.linkedEvents = data.linkedEvents.map(eventRef); delete data.linkedEvents; }
      if (Object.hasOwn(data, 'nextEvent')) { refs.nextEvent = eventRef(data.nextEvent); delete data.nextEvent; }
      return { work: workMap.get(sig), data, refs };
    });
    const byKey = new Map(arr(r.units).map((u, i) => [u.key, i]));
    const priorities = arr(r.priorities).map(p => {
      const i = byKey.get(p.key), fields = [], data = {};
      Object.entries(p).forEach(([k,v]) => {
        if (i != null && JSON.stringify(r.units[i][k]) === JSON.stringify(v)) fields.push(k);
        else data[k] = v;
      });
      return { unit: i ?? null, fields, data };
    });
    const meta = { ...r };
    delete meta.units; delete meta.events; delete meta.priorities;
    return { meta, eventOrder, events, works, units, priorities, hasPriorities: Object.hasOwn(r,'priorities') };
  }

  function denseContext(report) {
    const t = encodeReport(report);
    return [
      'PIANO_PROF_V3',
      'LEYENDA|JSON sin pérdida: R=metadatos; W=campos comunes de obra; E=eventos; U=unidad (work referencia W; data campos propios; refs índices E); P=prioridad (unit índice U, fields copiados de esa unidad, data adicionales). null=desconocido, 0=cero. TODAS las U están presentes. sourceContext conserva los registros originales, no sumar esos registros otra vez a recent/HOY.',
      'R|' + JSON.stringify({ meta:t.meta, eventOrder:t.eventOrder, hasPriorities:t.hasPriorities }),
      ...t.works.map(w => 'W|' + JSON.stringify(w)),
      ...t.events.map(e => 'E|' + JSON.stringify(e)),
      ...t.units.map(u => 'U|' + JSON.stringify(u)),
      ...t.priorities.map(p => 'P|' + JSON.stringify(p)),
    ].join('\n');
  }

  function decodeContext(text) {
    const rows = { R:[], W:[], E:[], U:[], P:[] };
    String(text).split('\n').forEach(line => {
      if (line[1] === '|' && rows[line[0]]) rows[line[0]].push(JSON.parse(line.slice(2)));
    });
    const head = rows.R[0], report = { ...head.meta };
    report.events = head.eventOrder.map(i => rows.E[i]);
    report.units = rows.U.map(u => {
      const data = { ...rows.W[u.work], ...u.data };
      if (Object.hasOwn(u.refs,'linkedEvents')) data.linkedEvents = u.refs.linkedEvents.map(i => rows.E[i]);
      if (Object.hasOwn(u.refs,'nextEvent')) data.nextEvent = u.refs.nextEvent == null ? null : rows.E[u.refs.nextEvent];
      return data;
    });
    if (head.hasPriorities) report.priorities = rows.P.map(p => Object.assign({},
      Object.fromEntries(p.fields.map(k => [k, report.units[p.unit][k]])), p.data));
    return report;
  }

  function buildDensePrompt(report, options, core) {
    const opts = options || {};
    const now = opts.now ? new Date(opts.now) : new Date(report.asOf || Date.now());
    const temporal = root.ProfessorDurationPolicy?.temporalContext(now) ||
      'HORA_LOCAL_REAL=' + now.toString() + '\nINSTANTE_ISO=' + now.toISOString();
    const master = String(core?.DEFAULT_MASTER_PROMPT || RULES).trim();
    const custom = String(opts.masterPrompt || '').trim();
    return [master, custom && custom !== master ? 'REGLAS_PERSONALES\n' + custom : '', temporal,
      'TAREA|' + modeInstruction(opts.mode || 'today'), opts.note ? 'CONDICIÓN_USUARIO\n' + opts.note : '',
      denseContext(report), 'Usa TODAS las unidades. No modifiques datos. Distingue evidencia individual de ensayo conjunto real.'
    ].filter(Boolean).join('\n\n');
  }

  function withTemporaryChat(url) {
    try {
      if (root && root.ProfessorTemporaryChat && typeof root.ProfessorTemporaryChat.withTemporaryChat === 'function') {
        return root.ProfessorTemporaryChat.withTemporaryChat(url);
      }
    } catch (error) {}
    return url;
  }

  function buildSafeChatGptUrl(report, options, core) {
    const api = core || (root && root.ProfessorCore) || null;
    const prompt = buildDensePrompt(report, options, api);
    const encoded = encodeURIComponent(prompt);
    return {
      url: withTemporaryChat('https://chatgpt.com/?prompt=' + (encoded.length <= MAX_URL_ENCODED ? encoded : encodeURIComponent('Voy a pegar o adjuntar el informe completo del Profesor. Espera a recibirlo antes de planificar; todavía no tienes mi contexto musical.'))),
      transport: encoded.length <= MAX_URL_ENCODED ? 'url' : 'clipboard',
      promptForUrl: prompt,
      truncated: false,
      compressed: true,
      encodedLength: encoded.length,
      overAdvisoryLimit: encoded.length > MAX_URL_ENCODED,
      unitCount: arr(report && report.units).length,
      eventCount: arr(report && report.events).length,
    };
  }

  function database() {
    try { return typeof db !== 'undefined' ? db : (root && root.db || null); }
    catch (error) { return root && root.db || null; }
  }

  function optionsFor(mode) {
    const data = database() || {};
    const settings = data.professorSettings && typeof data.professorSettings === 'object' ? data.professorSettings : {};
    const note = root && root.document && root.document.getElementById('professorUserNote')?.value || '';
    const masterPrompt = String(settings.masterPrompt || root?.ProfessorCore?.DEFAULT_MASTER_PROMPT || '');
    return { mode: mode || 'today', note, masterPrompt };
  }

  function toast(message) {
    try { if (root && typeof root.showToast === 'function') root.showToast(message); } catch (error) {}
  }

  function navigatePopup(popup, url) {
    if (!popup) return false;
    try { popup.location.replace(url); return true; }
    catch (error) {
      try { popup.location.href = url; return true; }
      catch (secondError) { return false; }
    }
  }

  function requestReport(data, options, handoff) {
    const opts={...options,now:options?.now || new Date().toISOString()};
    if (!Object.hasOwn(opts, 'activeSession')) {
      const running = root.crono;
      opts.activeSession = running && ['running','paused'].includes(running.state) ? {
        ...running, tickInterval: null, pauseInterval: null,
        elapsedMs: typeof root.cronoEffectiveElapsedMs === 'function' ? root.cronoEffectiveElapsedMs() : null,
        capturedAt: opts.now,
      } : null;
    }
    if(!opts.googleCalendarState){try{opts.googleCalendarState=JSON.parse(root.localStorage.getItem('alberto_google_calendar_v1')||'{}');}catch(_){opts.googleCalendarState={};}}
    opts.temporaryChat=root.ProfessorTemporaryChat?.enabled() ?? true;
    const enrichment={
      dailyState:root.ProfessorContextEnrichment?.dailyState(data,new Date(opts.now)) || {available:false},
      digitalActivity:root.ProfessorContextEnrichment?.latestDigital() || {available:false},
    };
    const fallback=()=>{
      const report=root.ProfessorCore.buildReport(data,{asOf:new Date(opts.now),googleCalendarState:opts.googleCalendarState,activeSession:opts.activeSession});
      return {report,built:handoff ? buildSafeChatGptUrl(report,opts,root.ProfessorCore) : null};
    };
    if(typeof root.Worker !== 'function')return Promise.resolve().then(fallback);
    try {
      if(!reportWorker){
        reportWorker=new root.Worker('./professor-report-worker.js?v=342');
        reportWorker.onmessage=({data:result})=>{
          const pending=pendingReports.get(result.id);if(!pending)return;
          pendingReports.delete(result.id);
          if(result.error)pending.reject(new Error(result.error));else pending.resolve(result);
        };
        reportWorker.onerror=error=>{
          for(const pending of pendingReports.values())pending.reject(error);
          pendingReports.clear();reportWorker?.terminate();reportWorker=null;
        };
      }
      const id=++requestId;
      return new Promise((resolve,reject)=>{
        pendingReports.set(id,{resolve,reject});
        try{reportWorker.postMessage({id,data,options:opts,enrichment,handoff});}
        catch(error){pendingReports.delete(id);reject(error);}
      }).catch(fallback);
    }catch(_){return Promise.resolve().then(fallback);}
  }

  async function buildReportAsync(data, options) { return (await requestReport(data,options,false)).report; }

  function showTransfer(built) {
    const doc = root.document;
    doc.getElementById('professorTransfer')?.remove();
    const box = doc.createElement('section'); box.id = 'professorTransfer'; box.className = 'prof-card';
    const label = doc.createElement('p');
    label.textContent = 'Informe completo: ' + built.unitCount + ' unidades. Pégalo o adjunta el archivo en ChatGPT para que pueda planificar.';
    const area = doc.createElement('textarea'); area.value = built.promptForUrl; area.readOnly = true;
    area.setAttribute('aria-label', 'Informe completo para ChatGPT'); area.style.cssText='width:100%;height:120px';
    const copy = doc.createElement('button'); copy.className = 'prof-action'; copy.textContent = 'Copiar informe completo';
    copy.onclick = async () => { area.select(); try { await root.navigator.clipboard.writeText(area.value); toast('Informe completo copiado · pégalo en ChatGPT'); } catch (_) { doc.execCommand('copy'); } };
    const download = doc.createElement('button'); download.className = 'prof-action'; download.textContent = 'Descargar informe';
    download.onclick = () => { const url = URL.createObjectURL(new Blob([area.value], { type:'text/plain;charset=utf-8' }));
      const a = doc.createElement('a'); a.href=url; a.download='profesor-contexto.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    const link = doc.createElement('a'); link.href=built.url; link.target='_blank'; link.rel='noopener'; link.textContent='Abrir ChatGPT'; link.className='prof-action';
    box.append(label, copy, download, link, area);
    (doc.getElementById('view-profesor') || doc.body).prepend(box);
    return box;
  }

  function openSafe(mode) {
    if (!root || !root.ProfessorCore) return;
    let popup = null;
    try {
      popup = root.open('about:blank', '_blank');
      if (popup) popup.opener = null;
    } catch (error) {}

    toast('Abriendo Profesor…');
    root.setTimeout(async () => {
      try {
        const data = database() || {};
        const revision=data._localRevision;
        let result=await requestReport(data,optionsFor(mode),true);
        // Edits committed while the worker was running invalidate that snapshot.
        if(database()?._localRevision !== revision)result=await requestReport(database()||{},optionsFor(mode),true);
        const {built}=result;
        if (built.transport === 'clipboard') {
          showTransfer(built);
          try { await root.navigator.clipboard.writeText(built.promptForUrl); } catch (_) {}
        }
        if (!popup || !navigatePopup(popup, built.url)) {
          if (built.transport !== 'clipboard') showTransfer(built);
          toast('El navegador bloqueó la nueva pestaña');
          return;
        }
        toast(built.transport === 'clipboard' ? 'Pega o adjunta el informe completo en ChatGPT' : 'ChatGPT abierto · contexto completo ' + built.unitCount + ' unidades / ' + built.eventCount + ' eventos');
      } catch (error) {
        try { if (popup && !popup.closed) popup.close(); } catch (closeError) {}
        toast('No se pudo abrir el Profesor · vuelve a intentarlo');
        console.error('[professor-handoff] fallo al preparar ChatGPT', error);
      }
    }, 0);
  }

  function patchCore() {
    const core = root && root.ProfessorCore;
    if (!core || typeof core.buildReport !== 'function') return false;
    if (core.buildChatGptUrl?.__responsiveProfessorHandoff) return true;
    const safe = function responsiveBuildChatGptUrl(report, options) {
      return buildSafeChatGptUrl(report, options, core);
    };
    safe.__responsiveProfessorHandoff = true;
    core.buildChatGptUrl = safe;
    root.openProfessorInChatGPT = openSafe;

    return true;
  }

  function installCapture() {
    if (!root || !root.document || root.document.__responsiveProfessorHandoffV2) return true;
    root.document.addEventListener('click', event => {
      const button = event.target && event.target.closest && event.target.closest('[data-prof-mode]');
      if (!button || !button.closest('#view-profesor')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openSafe(button.dataset.profMode);
    }, true);
    root.document.__responsiveProfessorHandoffV2 = true;
    return true;
  }

  function install() {
    if (!root || !root.document) return false;
    const coreReady = patchCore();
    installCapture();
    installed = installed || coreReady;
    return coreReady;
  }

  function boot() {
    install();
    let attempts = 0;
    clearInterval(installTimer);
    installTimer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 80) clearInterval(installTimer);
    }, 150);
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  return {
    MAX_URL_ENCODED,
    denseContext,
    decodeContext,
    buildDensePrompt,
    buildSafeChatGptUrl,
    buildReportAsync,
    openSafe,
    install,
    isInstalled: () => installed,
  };
});
