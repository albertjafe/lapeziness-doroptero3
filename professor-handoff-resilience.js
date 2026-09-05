(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorHandoffResilience = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /* El handoff anterior construía dos prompts: uno enorme para el portapapeles
     y otro abreviado para la URL. En iPad eso podía bloquear el hilo principal.
     V4 prepara tablas reversibles y un único archivo de instrucciones + contexto
     en un Web Worker; el DOM no recibe ni selecciona el texto grande. */
  const MAX_URL_ENCODED = 12000;
  const FILE_THRESHOLD = 32000;
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
  let preparing = null;

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

  // Named-column tables preserve every row/value while avoiding repeated keys.
  // Escape reserved source keys so unknown future data cannot masquerade as a table.
  function packTables(value) {
    if (Array.isArray(value)) {
      const rows = value.map(packTables);
      if (value.length > 1 && value.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
        const keys = Object.keys(value[0]);
        if (!keys.some(k => ['$columns','$rows','$object'].includes(k)) &&
            value.every(v => JSON.stringify(Object.keys(v)) === JSON.stringify(keys))) {
          const table = { $columns:keys, $rows:rows.map(row => keys.map(k => row[k])) };
          if (JSON.stringify(table).length < JSON.stringify(rows).length) return table;
        }
      }
      return rows;
    }
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value).map(([k,v]) => [k,packTables(v)]);
    if (entries.some(([k]) => ['$columns','$rows','$object'].includes(k))) return {$object:entries};
    return Object.fromEntries(entries);
  }

  function unpackTables(value) {
    if (Array.isArray(value)) return value.map(unpackTables);
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value,'$object')) return Object.fromEntries(value.$object.map(([k,v]) => [k,unpackTables(v)]));
    if (Object.hasOwn(value,'$columns')) return value.$rows.map(row => Object.fromEntries(value.$columns.map((k,i) => [k,unpackTables(row[i])])));
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,unpackTables(v)]));
  }

  function denseContext(report) {
    const t = encodeReport(report);
    const columns = [], schemas = new Map();
    const units = t.units.map(u => {
      const keys = Object.keys(u.data), signature = JSON.stringify(keys);
      if (!schemas.has(signature)) { schemas.set(signature, columns.length); columns.push(keys); }
      return {...u, schema:schemas.get(signature), data:keys.map(k => u.data[k])};
    });
    const json = value => JSON.stringify(packTables(value));
    return [
      'PIANO_PROF_V4',
      'LEYENDA|Texto sin cifrar y sin pérdida. Índices desde 0. R=metadatos; W=campos comunes de obra; E=eventos; C=columnas; U=unidad (work referencia W; schema referencia C; data contiene sus valores en el mismo orden; refs son índices E). P=prioridad (unit índice U, fields copiados de esa unidad, data adicionales). Dentro de cualquier JSON, {$columns:[nombres],$rows:[[valores]]} es una tabla de registros con esas columnas; {$object:[[clave,valor]]} es un objeto literal escapado. null=desconocido, 0=cero; ausencia no equivale a null. TODAS las U y todos los registros originales están presentes.',
      'LECTURA|Empieza por today, recentStudyDays, cobertura y eventos; cruza cada U con su obra, evidencia, ventanas 3/7/14/30/90 días y vínculos. recentStudyDays resume los días recientes, sourceContext conserva TODO el historial original (también el antiguo). No sumes las tablas originales otra vez a recent/HOY ni confundas mirrors con sesiones adicionales. Eventos sin repertorio y obras sin evidencia siguen presentes como contexto/información pendiente, nunca como prioridades inventadas.',
      ...columns.map(c => 'C|' + JSON.stringify(c)),
      'R|' + json({ meta:t.meta, eventOrder:t.eventOrder, hasPriorities:t.hasPriorities }),
      ...t.works.map(w => 'W|' + json(w)),
      ...t.events.map(e => 'E|' + json(e)),
      ...units.map(u => 'U|' + json(u)),
      ...t.priorities.map(p => 'P|' + json(p)),
      'FIN_PIANO_PROF_V4',
    ].join('\n');
  }

  function decodeContext(text) {
    const lines = String(text).split('\n');
    const start = lines.lastIndexOf('PIANO_PROF_V4');
    const v4 = start >= 0;
    const end = v4 ? lines.indexOf('FIN_PIANO_PROF_V4',start) : lines.length;
    if(v4 && end < 0) throw new Error('Contexto incompleto: falta FIN_PIANO_PROF_V4');
    const rows = { R:[], W:[], E:[], U:[], P:[], C:[] };
    (v4 ? lines.slice(start+1,end) : lines).forEach(line => {
      if (line[1] === '|' && rows[line[0]]) {
        const value = JSON.parse(line.slice(2));
        rows[line[0]].push(v4 ? unpackTables(value) : value);
      }
    });
    const head = rows.R[0], report = { ...head.meta };
    report.events = head.eventOrder.map(i => rows.E[i]);
    report.units = rows.U.map(u => {
      const own = v4 ? Object.fromEntries(rows.C[u.schema].map((k,i) => [k,u.data[i]])) : u.data;
      const data = { ...rows.W[u.work], ...own };
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
    const defaults = new Set(master.split(/\n\s*\n/).map(p => p.trim()));
    const extra = custom.split(/\n\s*\n/).filter(p => p.trim() && !defaults.has(p.trim())).join('\n\n');
    const budget = root.ProfessorDurationPolicy?.budgetContext(opts.dailyHours ?? database()?.professorSettings?.dailyHours, report, opts.mode);
    return [master, extra ? 'REGLAS_PERSONALES\n' + extra : '', temporal, budget,
      'TAREA|' + modeInstruction(opts.mode || 'today'), opts.note ? 'CONDICIÓN_USUARIO\n' + opts.note : '',
      denseContext(report), 'Este único mensaje o archivo contiene las instrucciones y el contexto completo. Planifica ahora para la tarea indicada; no esperes un segundo mensaje. Comprueba FIN_PIANO_PROF_V4: si falta, solicita la parte ausente, no inventes contexto. Usa TODAS las unidades, sin convertir las no elegibles en prioridades. No modifiques datos. Distingue evidencia individual de ensayo conjunto real.'
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
    // Do not allocate another multi-megabyte URL string for a file transfer.
    const encoded = prompt.length <= MAX_URL_ENCODED ? encodeURIComponent(prompt) : '';
    const fitsUrl = !!encoded && encoded.length <= MAX_URL_ENCODED;
    return {
      url: withTemporaryChat('https://chatgpt.com/' + (fitsUrl ? '?prompt=' + encoded : '')),
      transport: fitsUrl ? 'url' : prompt.length > FILE_THRESHOLD ? 'file' : 'clipboard',
      promptForUrl: prompt,
      truncated: false,
      compressed: true,
      encodedLength: encoded ? encoded.length : null,
      characterLength: prompt.length,
      overAdvisoryLimit: !fitsUrl,
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
    return { mode: mode || 'today', note, masterPrompt, dailyHours:settings.dailyHours };
  }

  function toast(message) {
    try { if (root && typeof root.showToast === 'function') root.showToast(message); } catch (error) {}
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
      return handoff ? {built:transferArtifact(report,opts,root.ProfessorCore)} : {report};
    };
    if(typeof root.Worker !== 'function')return Promise.resolve().then(fallback);
    try {
      if(!reportWorker){
        reportWorker=new root.Worker('./professor-report-worker.js?v=349');
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
        const timer=setTimeout(()=>{
          const error=new Error('El contexto tardó demasiado; vuelve a prepararlo.');
          for(const pending of pendingReports.values())pending.reject(error);
          pendingReports.clear();reportWorker?.terminate();reportWorker=null;
        },30000);
        const pending={resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
        pendingReports.set(id,pending);
        try{reportWorker.postMessage({id,data,options:opts,enrichment,handoff});}
        catch(error){pendingReports.delete(id);pending.reject(error);}
      });
    }catch(error){return Promise.reject(error);}
  }

  async function buildReportAsync(data, options) { return (await requestReport(data,options,false)).report; }

  function transferArtifact(report, options, core) {
    const {promptForUrl, ...built} = buildSafeChatGptUrl(report, options, core);
    const file = new Blob([promptForUrl], {type:'text/plain;charset=utf-8'});
    return {...built, url:withTemporaryChat('https://chatgpt.com/'), transport:built.transport === 'url' ? 'clipboard' : built.transport,
      file, byteLength:file.size, asOf:report.asOf,
      filename:'profesor-contexto-' + String(report.asOf || '').replace(/[^0-9T]/g,'').slice(0,15) + '.txt'};
  }

  let transferUrl = null;
  function invalidateTransfer() {
    root.document?.getElementById('professorTransfer')?.remove();
    if(transferUrl) URL.revokeObjectURL(transferUrl);
    transferUrl=null;
  }

  function transferIsCurrent(built) {
    const snapshot=built.snapshot;
    if(!snapshot || (database()?._localRevision === snapshot.revision && JSON.stringify(optionsFor(snapshot.mode)) === snapshot.signature)) return true;
    invalidateTransfer();
    toast('El contexto ha cambiado. Vuelve a prepararlo para incluir los datos nuevos.');
    return false;
  }

  async function copyArtifact(built) {
    if(!transferIsCurrent(built)) return false;
    try {
      if (root.ClipboardItem && root.navigator.clipboard?.write) {
        await root.navigator.clipboard.write([new root.ClipboardItem({'text/plain':built.file})]);
      } else {
        await root.navigator.clipboard.writeText(await built.file.text());
      }
      toast('Instrucciones y contexto copiados · un solo mensaje');
      return true;
    } catch (_) {
      // Never select or lay out a huge report in a textarea on iPad.
      if (built.characterLength <= FILE_THRESHOLD) {
        const area = root.document.createElement('textarea');
        area.value = await built.file.text(); area.style.cssText='position:fixed;opacity:0';
        root.document.body.appendChild(area); area.select();
        try { if(root.document.execCommand('copy')) { toast('Contexto completo copiado'); return true; } }
        catch (_) {} finally { area.remove(); }
      }
      toast('No se pudo copiar. Guarda el archivo completo para adjuntarlo.');
      return false;
    }
  }

  function showTransfer(built) {
    const doc = root.document;
    invalidateTransfer();
    transferUrl = URL.createObjectURL(built.file);
    const box = doc.createElement('section'); box.id = 'professorTransfer'; box.className = 'prof-card';
    const label = doc.createElement('p');
    label.textContent = built.unitCount + ' unidades · ' + built.eventCount + ' eventos · ' + Math.ceil(built.byteLength / 1024) + ' KB · instrucciones e historial completo.';
    const help = doc.createElement('p'); help.className='prof-muted';
    help.textContent = built.transport === 'file'
      ? 'Guarda el archivo, abre ChatGPT y adjúntalo en un solo envío. Contiene también tu petición: no necesitas copiar otro mensaje.'
      : 'Copia todo y pégalo en un solo mensaje, o adjunta el archivo. Las instrucciones y tu petición ya van incluidas.';
    const copy = doc.createElement('button'); copy.className = 'prof-action'; copy.textContent = 'Copiar todo · un mensaje';
    copy.onclick = () => copyArtifact(built);
    const download = doc.createElement('a'); download.className='prof-action primary';
    download.textContent='Guardar archivo completo'; download.href=transferUrl; download.download=built.filename;
    download.onclick=event=>{if(!transferIsCurrent(built))event.preventDefault();};
    const link = doc.createElement('a'); link.href=built.url; link.target='_blank'; link.rel='noopener';
    link.textContent='Abrir ChatGPT'; link.className='prof-action';
    link.onclick=event=>{if(!transferIsCurrent(built))event.preventDefault();};
    const actions = doc.createElement('div'); actions.className='prof-actions';
    actions.append(download, copy, link);
    try {
      const file = new File([built.file],built.filename,{type:'text/plain'});
      if(root.navigator.canShare?.({files:[file]})) {
        const share = doc.createElement('button'); share.className='prof-action'; share.textContent='Compartir archivo';
        share.onclick=async()=>{
          if(!transferIsCurrent(built)) return;
          try { await root.navigator.share({files:[file],title:'Contexto completo del Profesor'}); }
          catch(error) { if(error.name !== 'AbortError') toast('No se pudo compartir; usa Guardar archivo completo.'); }
        };
        actions.prepend(share);
      }
    } catch (_) {}
    box.append(label, help, actions);
    (doc.getElementById('view-profesor') || doc.body).prepend(box);
    return box;
  }

  function openSafe(mode) {
    if (!root?.ProfessorCore) return Promise.resolve(null);
    if (preparing) return preparing;
    const buttons = root.document.querySelectorAll('[data-prof-mode], #professorCopyReport');
    buttons.forEach(button => { button.disabled=true; button.setAttribute('aria-busy','true'); });
    toast('Preparando instrucciones y contexto completo…');
    preparing = (async()=>{
      try {
        // A paint opportunity before cloning the snapshot for the worker.
        await new Promise(resolve => root.setTimeout(resolve,0));
        for(let attempt=0;attempt<3;attempt++) {
          const data=database() || {}, revision=data._localRevision, options=optionsFor(mode);
          const {built}=await requestReport(data,options,true);
          if(database()?._localRevision !== revision || JSON.stringify(optionsFor(mode)) !== JSON.stringify(options)) continue;
          built.snapshot={mode,revision,signature:JSON.stringify(options)};
          showTransfer(built);
          toast('Contexto completo preparado · un archivo o un mensaje');
          return built;
        }
        throw new Error('El contexto cambió durante la preparación; vuelve a intentarlo.');
      } catch(error) {
        toast('No se pudo preparar el contexto · vuelve a intentarlo');
        console.error('[professor-handoff]',error);
        return null;
      } finally {
        buttons.forEach(button => { button.disabled=false; button.removeAttribute('aria-busy'); });
        preparing=null;
      }
    })();
    return preparing;
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
    FILE_THRESHOLD,
    transferArtifact,
    copyArtifact,
    invalidateTransfer,
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
