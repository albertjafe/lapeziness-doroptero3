// ─── DATA ───────────────────────────────────────────────────────────────────

const DB_KEY = 'alberto_piano_v2';
const APP_VERSION = '2026-07-13-grafico-lote3-v38';
// Auth & sync globals — declared with var to avoid TDZ errors
var _authMode = 'login';
var _sbClient = null;
var _saveTimeout = null;
const SYNC_META_KEY = 'alberto_sync_v1';
let _syncTimer = null;
let _syncInFlight = false;
let _syncPromise = null;
const SUPABASE_URL = 'https://fexfeekifzgszluemihs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Elra9S5SZVWELp6MvKSyoA_iBW5KqD2';

function getSB() {
  if (_sbClient) return _sbClient;
  // Check supabase global is available
  if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
    throw new Error('La librería de Supabase no cargó. Comprueba tu conexión a internet.');
  }
  _sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      storageKey: 'piano_auth_v1',
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage
    }
  });
  return _sbClient;
}

function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.packs && !parsed.obras) {
        const obras = [];
        Object.values(parsed.packs).forEach(pack => {
          (pack.obras || []).forEach(o => obras.push(o));
        });
        return { obras, eventos: parsed.eventos || [], sesiones: parsed.sesiones || [], registro: parsed.registro || [] };
      }
      return parsed;
    }
  } catch(e) {}
  return getDefaultData();
}

function _readSyncMeta() {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    return typeof SyncCore !== 'undefined' ? SyncCore.normalizeMeta(raw ? JSON.parse(raw) : null) : {
      localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0
    };
  } catch(e) {
    return { localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 };
  }
}

function _writeSyncMeta(meta) {
  const normalized = typeof SyncCore !== 'undefined' ? SyncCore.normalizeMeta(meta) : meta;
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(normalized));
  return normalized;
}

function _writeLocalSnapshot(markDirty) {
  const currentMeta = _readSyncMeta();
  const nextMeta = markDirty && typeof SyncCore !== 'undefined'
    ? SyncCore.markDirty(currentMeta)
    : currentMeta;
  db._savedAt = new Date().toISOString();
  if (nextMeta.localRevision) db._localRevision = nextMeta.localRevision;
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  _writeSyncMeta(nextMeta);
  return nextMeta;
}

// Persistencia local síncrona: ninguna operación lógica debe depender de la red.
function saveLocalNow() {
  try {
    return _writeLocalSnapshot(true);
  } catch(e) {
    showSyncIndicator('⚠ error al guardar en este dispositivo');
    console.error('[sync] no se pudo guardar localmente', e);
    throw e;
  }
}

function saveData() {
  try {
    saveLocalNow();
  } catch(e) {
    // Los datos siguen en memoria para que el usuario pueda reintentar.
    return false;
  }
  refreshStudyViews();
  enqueueCloudSync();
  return true;
}

// Una mutación de estudio debe actualizar todas las superficies que muestran
// ese dato, aunque la vista activa no sea la que originó el guardado. Se
// agrupa en un frame para evitar renders repetidos cuando una operación llama
// a varias funciones de persistencia consecutivas.
let _studyViewsRefreshFrame = null;
function refreshStudyViews() {
  if (_studyViewsRefreshFrame != null) return;
  const render = () => {
    _studyViewsRefreshFrame = null;
    if (typeof renderRacha === 'function') renderRacha();
    if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
    if (typeof renderStatsDashboard === 'function') renderStatsDashboard();
    if (typeof renderMantenimientoSection === 'function') renderMantenimientoSection();
    if (typeof renderSolidezSection === 'function') renderSolidezSection();
    if (typeof renderEficienciaSection === 'function') renderEficienciaSection();
    if (typeof renderEstadoSection === 'function') renderEstadoSection();
    if (typeof renderSesionesHistorial === 'function') renderSesionesHistorial();
  };
  if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
    _studyViewsRefreshFrame = requestAnimationFrame(render);
  } else {
    _studyViewsRefreshFrame = setTimeout(render, 0);
  }
}

// ── FUSIÓN SEGURA DE HISTORIAL DE ESTUDIO ─────────────────────────────────────
// Une el tiempo de estudio de dos copias de la BD (local y nube) para que la
// sincronización NUNCA borre sesiones: las plantas (cronómetro/Forest) se unen
// por su timestamp y, por cada día, la sesión que se conserva es la que más
// minutos reales tiene. El resto de datos (obras, eventos…) viene de `base`.
function _plantKey(p) { return (p.obraId || p.tag || '') + '|' + (p.startedAt || '') + '|' + (p.endedAt || ''); }
function _mergePlants(a, b) {
  const out = [], seen = new Set();
  (a || []).concat(b || []).forEach(p => {
    if (!p || !p.startedAt) return;
    const k = _plantKey(p);
    if (seen.has(k)) return;
    seen.add(k); out.push(p);
  });
  out.sort((x, y) => (x.startedAt < y.startedAt ? -1 : 1));
  return out;
}
function _estadoEventKey(e) { return (e && (e.id || ((e.at || '') + '|' + (e.value || '') + '|' + (e.label || '')))) || ''; }
function _mergeEstadoEventos(a, b) {
  const out = [], seen = new Set();
  (a || []).concat(b || []).forEach(e => {
    const k = _estadoEventKey(e);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  });
  out.sort((x, y) => (x.at || '').localeCompare(y.at || ''));
  return out.slice(-2000);
}
function _deporteEventKey(e) { return (e && (e.id || ((e.at || '') + '|' + (e.kind || '') + '|' + (e.value || '') + '|' + (e.label || '')))) || ''; }
function _mergeDeporteEventos(a, b) {
  const out = [], seen = new Set();
  (a || []).concat(b || []).forEach(e => {
    const k = _deporteEventKey(e);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  });
  out.sort((x, y) => (x.at || '').localeCompare(y.at || ''));
  return out.slice(-2000);
}
function _suenoEventKey(e) { return (e && (e.id || ((e.at || '') + '|' + (e.kind || 'siesta')))) || ''; }
function _mergeSuenoEventos(a, b) {
  const out = [], seen = new Set();
  (a || []).concat(b || []).forEach(e => {
    const k = _suenoEventKey(e);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  });
  out.sort((x, y) => (x.at || '').localeCompare(y.at || ''));
  return out.slice(-2000);
}
function _triggerEventKey(e) { return (e && (e.id || ((e.at || '') + '|' + (e.value || '') + '|' + (e.label || '')))) || ''; }
function _mergeTriggerEventos(a, b) {
  const out = [], seen = new Set();
  (a || []).concat(b || []).forEach(e => {
    const k = _triggerEventKey(e);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  });
  out.sort((x, y) => (x.at || '').localeCompare(y.at || ''));
  return out.slice(-2000);
}
function _tiempoDisponibleKey(e) { return (e && (e.date || e.day || (e.at ? new Date(e.at).toDateString() : ''))) || ''; }
function _mergeTiempoDisponibleEventos(a, b) {
  const map = {};
  (a || []).concat(b || []).forEach(e => {
    const k = _tiempoDisponibleKey(e);
    if (!k) return;
    const cur = map[k];
    if (!cur || String(e.at || '').localeCompare(String(cur.at || '')) >= 0) map[k] = e;
  });
  return Object.values(map).sort((x, y) => (x.at || x.date || '').localeCompare(y.at || y.date || '')).slice(-2000);
}
function _dailyJournalKey(e) { return (e && (e.id || ((e.at || '') + '|' + (e.text || '').slice(0, 80)))) || ''; }
function _mergeDailyJournalEntries(a, b) {
  const out = [], seen = new Set();
  (a || []).concat(b || []).forEach(e => {
    const k = _dailyJournalKey(e);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  });
  out.sort((x, y) => (x.at || '').localeCompare(y.at || ''));
  return out.slice(-3000);
}
function _sesionRealMin(s) {
  return (s.items || []).reduce((acc, it) =>
    acc + (typeof _itemMinReal === 'function' ? _itemMinReal(it) : (it.minutosReales || 0)), 0);
}
function _mergeSesiones(a, b) {
  const map = {};
  const add = s => {
    if (!s || !s.date) return;
    const k = new Date(s.date).toDateString();
    const cur = map[k];
    if (!cur) { map[k] = s; return; }
    const ms = _sesionRealMin(s), mc = _sesionRealMin(cur);
    if (ms > mc || (ms === mc && (s.items || []).length > (cur.items || []).length)) map[k] = s;
  };
  (a || []).forEach(add); (b || []).forEach(add);
  return Object.values(map).sort((x, y) => new Date(y.date) - new Date(x.date)).slice(0, 365);
}
function _mergeStudyHistory(base, other) {
  if (typeof DataCore !== 'undefined' && typeof DataCore.mergeStudyHistory === 'function') {
    return DataCore.mergeStudyHistory(base, other);
  }
  if (!base) return other;
  if (!other) return base;
  const merged = Object.assign({}, base);
  merged.sessionPlants = _mergePlants(base.sessionPlants, other.sessionPlants);
  merged.forestPlants  = _mergePlants(base.forestPlants, other.forestPlants);
  merged.sesiones      = _mergeSesiones(base.sesiones, other.sesiones);
  merged.estadoEventos = _mergeEstadoEventos(base.estadoEventos, other.estadoEventos);
  merged.deporteEventos = _mergeDeporteEventos(base.deporteEventos, other.deporteEventos);
  merged.suenoEventos = _mergeSuenoEventos(base.suenoEventos, other.suenoEventos);
  merged.triggerEventos = _mergeTriggerEventos(base.triggerEventos, other.triggerEventos);
  merged.tiempoDisponibleEventos = _mergeTiempoDisponibleEventos(base.tiempoDisponibleEventos, other.tiempoDisponibleEventos);
  merged.dailyJournalEntries = _mergeDailyJournalEntries(base.dailyJournalEntries, other.dailyJournalEntries);
  return merged;
}

async function syncToCloud(snapshotDb, revision) {
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      showSyncIndicator('Guardado en este dispositivo');
      return false;
    }
    showSyncIndicator('Sincronizando…');
    const { error } = await sb.from('user_data').upsert({
      id: user.id,
      data: snapshotDb || db,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    const meta = _readSyncMeta();
    _writeSyncMeta(typeof SyncCore !== 'undefined' ? SyncCore.markSynced(meta, revision || meta.dirtyRevision) : meta);
    const after = _readSyncMeta();
    showSyncIndicator(typeof SyncCore !== 'undefined' && SyncCore.isDirty(after) ? 'Sincronizando…' : '✓ sincronizado');
    return true;
  } catch(e) {
    showSyncIndicator('⚠ Sin conexión · pendiente');
    return false;
  }
}

function enqueueCloudSync(options) {
  const immediate = !!(options && options.immediate);
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncPendingCloudChanges();
  }, immediate ? 0 : 300);
  return _syncPromise || Promise.resolve();
}

async function syncPendingCloudChanges() {
  if (_syncInFlight) return _syncPromise;
  _syncInFlight = true;
  _syncPromise = (async () => {
    try {
      while (true) {
        const meta = _readSyncMeta();
        if (typeof SyncCore === 'undefined' || !SyncCore.isDirty(meta)) break;
        const revision = meta.dirtyRevision;
        let snapshot = db;
        try {
          const raw = localStorage.getItem(DB_KEY);
          if (raw) snapshot = JSON.parse(raw);
        } catch(e) {}
        const ok = await syncToCloud(snapshot, revision);
        if (!ok) break;
        const after = _readSyncMeta();
        if (!SyncCore.isDirty(after)) break;
      }
    } finally {
      _syncInFlight = false;
      _syncPromise = null;
    }
  })();
  return _syncPromise;
}

async function loadFromCloud() {
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;

    showSyncIndicator('↓ cargando…');
    const { data, error } = await sb.from('user_data')
      .select('data,updated_at').eq('id', user.id).single();

    const hasCloudData = !error && data && data.data &&
      (data.data.obras?.length > 0 || data.data.sesiones?.length > 0);

    if (!hasCloudData) {
      // Cloud is empty — upload whatever we have locally
      const localRaw = localStorage.getItem(DB_KEY);
      if (localRaw) {
        try {
          const localDb = JSON.parse(localRaw);
          const hasLocalData = (localDb.obras?.length > 0 || localDb.sesiones?.length > 0);
          if (hasLocalData) {
            showSyncIndicator('↑ subiendo datos locales…');
            await syncToCloud(localDb, _readSyncMeta().dirtyRevision);
            showSyncIndicator('✓ datos subidos a la nube');
            return false; // local is already loaded
          }
        } catch(e) {}
      }
      showSyncIndicator('✓ cuenta nueva');
      return false;
    }

    // Cloud has data — compare timestamps
    const cloudDate = new Date(data.updated_at).getTime();
    const localRaw = localStorage.getItem(DB_KEY);
    let localDb = null;
    let useCloud = true;
    if (localRaw) {
      try {
        localDb = JSON.parse(localRaw);
        const localDate = localDb._savedAt ? new Date(localDb._savedAt).getTime() : 0;
        // Only use cloud if it isn't OLDER than local (60s de tolerancia).
        useCloud = cloudDate >= (localDate - 60000);
      } catch(e) {}
    }

    if (useCloud) {
      // Aunque la nube "gane", FUSIONAMOS el historial de estudio local para no
      // perder sesiones que la nube no tuviera (p. ej. subida nocturna fallida).
      const beforeMeta = _readSyncMeta();
      db = _mergeStudyHistory(data.data, localDb);
      _writeLocalSnapshot(false);
      // Si la fusión añadió estudio que la nube no tenía, devolvérselo.
      try {
        const localMin = localDb ? (localDb.sessionPlants || []).length + (localDb.forestPlants || []).length : 0;
        const cloudMin = (data.data.sessionPlants || []).length + (data.data.forestPlants || []).length;
        const localEstadoN = localDb ? (localDb.estadoEventos || []).length : 0;
        const cloudEstadoN = (data.data.estadoEventos || []).length;
        const localDeporteN = localDb ? (localDb.deporteEventos || []).length : 0;
        const cloudDeporteN = (data.data.deporteEventos || []).length;
        const localSuenoN = localDb ? (localDb.suenoEventos || []).length : 0;
        const cloudSuenoN = (data.data.suenoEventos || []).length;
        const localTriggerN = localDb ? (localDb.triggerEventos || []).length : 0;
        const cloudTriggerN = (data.data.triggerEventos || []).length;
        const localTiempoN = localDb ? (localDb.tiempoDisponibleEventos || []).length : 0;
        const cloudTiempoN = (data.data.tiempoDisponibleEventos || []).length;
        const localHasMore = localMin > cloudMin || localEstadoN > cloudEstadoN || localDeporteN > cloudDeporteN || localSuenoN > cloudSuenoN || localTriggerN > cloudTriggerN || localTiempoN > cloudTiempoN;
        if (localHasMore || (typeof SyncCore !== 'undefined' && SyncCore.isDirty(beforeMeta))) {
          if (typeof SyncCore !== 'undefined' && !SyncCore.isDirty(_readSyncMeta())) _writeLocalSnapshot(true);
          await syncPendingCloudChanges();
        }
      } catch(e) {}
      showSyncIndicator('✓ sincronizado');
      return true;
    }

    // Local is newer — fusiona el estudio de la nube por si tuviera algo y sube.
    db = _mergeStudyHistory(db, data.data);
    _writeLocalSnapshot(true);
    showSyncIndicator('↑ local más reciente, subiendo…');
    await syncPendingCloudChanges();
    showSyncIndicator('✓ sincronizado');
    return false;

  } catch(e) {
    showSyncIndicator('offline');
    return false;
  }
}

function showSyncIndicator(msg) {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2500);
}

function getDefaultData() {
  return {
    obras: [],
    eventos: [],
    sesiones: [],
    registro: [],
    estadoEventos: [],
    deporteEventos: [],
    suenoEventos: [],
    triggerEventos: [],
    tiempoDisponibleEventos: [],
    dailyJournalEntries: []
  };
}

let db = loadData();
if (!db.sesiones) db.sesiones = [];
if (!db.eventos) db.eventos = [];
if (!db.obras) db.obras = [];
if (!db.forestPlants) db.forestPlants = [];
if (!db.estadoEventos) db.estadoEventos = [];
if (!db.deporteEventos) db.deporteEventos = [];
if (!db.suenoEventos) db.suenoEventos = [];
if (!db.triggerEventos) db.triggerEventos = [];
if (!db.tiempoDisponibleEventos) db.tiempoDisponibleEventos = [];
if (!db.dailyJournalEntries) db.dailyJournalEntries = [];
// db.sessionPlants[]: array paralelo a forestPlants con UN registro por sub-sesión
// del cronómetro. Persiste los timestamps detallados aunque la sesión en
// db.sesiones[] sea descartada por el cap. Estructura por entrada:
//   { obraId, movId, startedAt: ISO, endedAt: ISO, mins, source: 'app' }
if (!db.sessionPlants) db.sessionPlants = [];

// Migración one-shot: si sessionPlants está vacío pero hay sesiones existentes
// con _aggregate que contiene timestamps de sub-sesiones, los rescatamos al
// array nuevo. Sólo se ejecuta una vez (cuando sessionPlants no tiene nada).
(function migrateSessionsToPlants() {
  if (db.sessionPlants.length > 0) return;
  if (!Array.isArray(db.sesiones) || db.sesiones.length === 0) return;
  db.sesiones.forEach(sesion => {
    if (!sesion._aggregate || typeof sesion._aggregate !== 'object') return;
    Object.entries(sesion._aggregate).forEach(([planId, agg]) => {
      if (!agg || !Array.isArray(agg.subsessions)) return;
      // Buscar el item correspondiente para sacar obraId/movId
      const item = (sesion.items || []).find(it => it._planId === planId);
      if (!item) return;
      agg.subsessions.forEach(sub => {
        if (!sub.startedAt || !sub.endedAt) return;
        db.sessionPlants.push({
          obraId: item.obraId,
          movId: item.movId || null,
          startedAt: sub.startedAt,
          endedAt: sub.endedAt,
          mins: sub.min || 0,
          source: 'app',
        });
      });
    });
  });
  if (db.sessionPlants.length > 0) {
    db.sessionPlants.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  }
})();

// Migration: ensure all obras have apr/sol/esc
(db.obras || []).forEach(o => {
  if (o.apr === undefined) o.apr = o.con || 1;
  if (o.sol === undefined) o.sol = o.con || 1;
  if (o.esc === undefined) o.esc = o.per || 1;
});

// ─── UI HELPERS ─────────────────────────────────────────────────────────────

const VIEW_CONTEXT = {
  session: { eyebrow: 'Estudio', title: 'Hoy' },
  cronometro: { eyebrow: 'Práctica', title: 'Cronómetro' },
  obras: { eyebrow: 'Repertorio', title: 'Obras' },
  calendario: { eyebrow: 'Planificación', title: 'Calendario' },
  historial: { eyebrow: 'Resumen', title: 'Estadísticas' },
  ajustes: { eyebrow: 'Planificador de estudio', title: 'Ajustes' }
};

function updateContextHeader(name) {
  const context = VIEW_CONTEXT[name] || VIEW_CONTEXT.session;
  const eyebrow = document.getElementById('headerEyebrow');
  const title = document.getElementById('headerTitle');
  const date = document.getElementById('headerDate');
  if (eyebrow) eyebrow.textContent = context.eyebrow;
  if (title) title.textContent = context.title;
  if (date) {
    const showsDate = name === 'session' || name === 'calendario';
    date.hidden = !showsDate;
    if (!showsDate) date.textContent = '';
  }
  document.title = `${context.title} · Planificador de estudio`;
}

function showView(name) {
  document.body.setAttribute('data-view', name);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  document.getElementById('view-' + name).classList.add('active');
  const activeButton = document.querySelector(`.nav-btn[data-view="${name}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
    activeButton.setAttribute('aria-current', 'page');
  }
  updateContextHeader(name);
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  // Modo concentración: activar/desactivar al entrar/salir de cronometro
  if (name !== 'cronometro' && typeof cronoOnLeaveView === 'function') cronoOnLeaveView();
  if (name === 'session')    { renderRacha(); if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI(); if (typeof renderSessionInsights === 'function') renderSessionInsights(); if (typeof renderSessionJournal === 'function') renderSessionJournal(); }
  if (name === 'cronometro') { cronoOnEnterView(); if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(true); }
  if (name === 'obras')      renderObras();
  if (name === 'calendario') renderCalendario();
  if (name === 'historial')  {
    // Esqueleto inmediato; el cálculo pesado (todo el historial) corre en el
    // siguiente frame para que la vista aparezca al instante.
    const sd = document.getElementById('statsDashboard');
    if (sd) sd.innerHTML = _statsSkeleton();
    requestAnimationFrame(() => {
      renderStatsDashboard(); renderMantenimientoSection(); renderSolidezSection(); renderEficienciaSection(); renderEstadoSection();
    });
    renderSesionesHistorial(); _histListApplyPref();
  }
}

// Modo limpio de la pantalla Sesión: oculta los textos pequeños de apoyo
// (subtítulos de insights, contexto/ánimo de la proyección) para quitar ruido.
// El botón ℹ alterna entre limpio y detallado; la preferencia se persiste.
function _applySessionClean() {
  const clean = localStorage.getItem('alberto_session_clean') !== '0';
  document.body.classList.toggle('session-clean', clean);
  const btn = document.getElementById('sessionInfoBtn');
  if (btn) btn.classList.toggle('active', !clean);
}
function toggleSessionInfo() {
  const clean = localStorage.getItem('alberto_session_clean') !== '0';
  localStorage.setItem('alberto_session_clean', clean ? '0' : '1');
  _applySessionClean();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2000);
}

// Confirmación visual de guardado: un check que se dibuja solo y se desvanece.
// Para los momentos "¿se ha guardado?" (sesión, solidez, obra) — refuerza la
// sensación de fiabilidad.
function showSavedCheck() {
  const el = document.getElementById('savedCheck');
  if (!el) return;
  el.classList.remove('show');
  void el.offsetWidth; // reinicia la animación si se llama seguido
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1150);
}

// ── TOAST DE DESHACER ─────────────────────────────────────────────────────────
// Muestra un aviso con botón "Deshacer" durante unos segundos. Si se pulsa,
// ejecuta la función de restauración. Útil tras borrados para evitar perder
// cosas por un toque accidental.
let _undoTimer = null;
let _undoFn = null;
function showUndoToast(msg, undoFn, ms) {
  _undoFn = typeof undoFn === 'function' ? undoFn : null;
  const t = document.getElementById('undoToast');
  const m = document.getElementById('undoToastMsg');
  if (!t || !m) { showToast(msg); return; }
  m.textContent = msg;
  t.classList.add('visible');
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(_hideUndoToast, ms || 6000);
}
function _hideUndoToast() {
  const t = document.getElementById('undoToast');
  if (t) t.classList.remove('visible');
  clearTimeout(_undoTimer);
  _undoFn = null;
}
function _doUndo() {
  const fn = _undoFn;
  _hideUndoToast();
  if (typeof fn === 'function') fn();
}

function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  // ★ Mover el overlay como hijo directo de body. Esto garantiza que
  // position:fixed se referencie al viewport, no a algún ancestro con
  // transform/filter/will-change que cree un contexto de stacking.
  // (Era la causa de que el modal de colores apareciera "en el centro del
  // contenido" en lugar del centro de la pantalla.)
  const justMoved = overlay.parentNode !== document.body;
  if (justMoved) {
    overlay._originalParent = overlay.parentNode;
    overlay._originalNext = overlay.nextSibling;
    document.body.appendChild(overlay);
    // Forzar reflow tras el move. Sin esto, en algunos navegadores móviles
    // (iOS Safari sobre todo), la transición de opacity del .modal interno
    // no arranca al mismo tiempo que se añade `.visible` y el modal queda
    // invisible (opacity 0) aunque el backdrop sí se vea — síntoma
    // "se desenfoca la pantalla pero no aparece nada".
    void overlay.offsetWidth;
  }
  overlay.scrollTop = 0;
  const modalBox = overlay.querySelector('.modal');
  if (modalBox) modalBox.scrollTop = 0;
  overlay.classList.add('visible');
  // Bloquear scroll del body para que el fondo no se desplace y el modal
  // quede correctamente centrado en el viewport
  document.body.classList.add('modal-open');
  // Salvavidas: si por cualquier motivo la transición no completa (move +
  // visible + rAF en un mismo frame puede comerse el arranque del fade),
  // forzamos opacity 1 al instante siguiente para que nunca quede invisible.
  // Usamos doble rAF + setTimeout como triple red de seguridad: rAF puede
  // pausarse si la pestaña pierde foco al instante de abrir; setTimeout sí
  // se dispara igualmente.
  const forceVisible = () => {
    const m = overlay.querySelector('.modal');
    if (m && overlay.classList.contains('visible')) {
      m.style.opacity = '1';
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(forceVisible));
  setTimeout(forceVisible, 60);
  // Close on tap outside the modal box
  overlay._outsideHandler = function(e) {
    if (e.target === overlay) closeModal(id);
  };
  overlay.addEventListener('click', overlay._outsideHandler);
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('visible');
  // Limpiar el opacity inline que pusimos como salvavidas, así la próxima
  // apertura empieza desde la transición CSS y no salta visualmente.
  const m = overlay.querySelector('.modal');
  if (m) m.style.opacity = '';
  if (overlay._outsideHandler) {
    overlay.removeEventListener('click', overlay._outsideHandler);
    overlay._outsideHandler = null;
  }
  // NB: NO movemos el overlay de vuelta a su posición original en el DOM.
  // Si lo hiciéramos, la siguiente apertura volvería a moverlo al body, lo
  // cual es trabajo extra. Mantenerlo en body es seguro y no afecta nada.
  // Desbloquear scroll del body sólo si no quedan otros modales abiertos
  const anyOpen = document.querySelector('.modal-overlay.visible');
  if (!anyOpen) document.body.classList.remove('modal-open');
}

function updateHeader() {
  const d = new Date();
  const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const currentView = document.body.getAttribute('data-view') || 'session';
  updateContextHeader(currentView);
  const h = d.getHours();
  const saludo = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const dateEl = document.getElementById('headerDate');
  if (dateEl) {
    dateEl.textContent = currentView === 'calendario'
      ? `${meses[d.getMonth()]} ${d.getFullYear()}`
      : `${saludo} · ${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`;
  }
  // Show nearest upcoming event
  const now = Date.now();
  const proxEvento = (db.eventos || [])
    .filter(ev => new Date(ev.fecha) > now)
    .sort((a,b) => new Date(a.fecha) - new Date(b.fecha))[0];
  const headerSub = document.getElementById('packNameHeader');
  if (proxEvento && (currentView === 'session' || currentView === 'calendario')) {
    const dias2 = Math.ceil((new Date(proxEvento.fecha) - now) / 86400000);
    headerSub.textContent = proxEvento.nombre + ' · ' + dias2 + 'd';
  } else {
    headerSub.textContent = '';
  }
}

// ─── SESSION ─────────────────────────────────────────────────────────────────

let selectedEnergy = 'normal';
let selectedTime = 2;
// Estado diario: `estado`/`bienestar` es el ánimo actual; `sueno` es una métrica
// diaria independiente. energia/claridad quedan como alias para código antiguo.
let estadoDiario = { estado: 70, bienestar: 70, sueno: 70, energia: 70, claridad: 70, deporte: null, triggers: null, tiempoDisponible: null };
// ¿Ha introducido Alberto su estado HOY (de forma explícita)? Solo entonces la
// predicción se condiciona a cómo está. El reset de día y los guardados de fondo
// lo dejan en false; pickEstado/updateEstado lo ponen en true.
let _estadoUserSet = false;
let _suenoUserSet = false;
const ESTADO_COLORS = { bienestar: '#c8a030', sueno: '#a090e0', energia: '#c8a030', claridad: '#e08898' };

// Las 5 caras del selector de estado. value = 0-100 que se guarda internamente.
const ESTADO_FACES = [
  { v: 12, emoji: '😣', label: 'Muy mal', icon: 'face-very-bad' },
  { v: 34, emoji: '😕', label: 'Mal', icon: 'face-bad' },
  { v: 56, emoji: '😐', label: 'Regular', icon: 'face-neutral' },
  { v: 78, emoji: '🙂', label: 'Bien', icon: 'face-good' },
  { v: 96, emoji: '😄', label: 'Muy bien', icon: 'face-great' },
];

const SUENO_FACES = [
  { v: 12, label: 'Muy poco', icon: 'moon-lowest' },
  { v: 34, label: 'Poco', icon: 'moon-low' },
  { v: 56, label: 'Normal', icon: 'moon-mid' },
  { v: 78, label: 'Bien', icon: 'moon-good' },
  { v: 96, label: 'Muy bien', icon: 'moon-best' },
];

const DEPORTE_LEVELS = [
  { v: 20, level: 1, label: 'Suave', icon: 'sport-1' },
  { v: 40, level: 2, label: 'Ligero', icon: 'sport-2' },
  { v: 60, level: 3, label: 'Medio', icon: 'sport-3' },
  { v: 80, level: 4, label: 'Fuerte', icon: 'sport-4' },
  { v: 100, level: 5, label: 'Muy fuerte', icon: 'sport-5' },
];

const TRIGGER_LEVELS = [
  { v: 20, level: 1, label: 'Leve', icon: 'trigger-1' },
  { v: 40, level: 2, label: 'Notable', icon: 'trigger-2' },
  { v: 60, level: 3, label: 'Intenso', icon: 'trigger-3' },
  { v: 80, level: 4, label: 'Fuerte', icon: 'trigger-4' },
  { v: 100, level: 5, label: 'Crítico', icon: 'trigger-5' },
];

const TIEMPO_DISPONIBLE_LEVELS = [
  { v: 20, level: 1, label: 'Poquísimo', range: '0-1 h brutas', icon: 'tiempo-1' },
  { v: 40, level: 2, label: 'Poco', range: '1-2 h brutas', icon: 'tiempo-2' },
  { v: 60, level: 3, label: 'Medio', range: '2-3.5 h brutas', icon: 'tiempo-3' },
  { v: 80, level: 4, label: 'Mucho', range: '3.5-4.5 h brutas', icon: 'tiempo-4' },
  { v: 100, level: 5, label: 'Muchísimo', range: '5 h+ brutas', icon: 'tiempo-5' },
];

// Valor canónico actual del estado (con migración perezosa desde el modelo viejo).
function estadoActualVal() {
  if (typeof estadoDiario.estado === 'number') return estadoDiario.estado;
  if (typeof estadoDiario.bienestar === 'number') return estadoDiario.bienestar;
  if (typeof estadoDiario.energia === 'number' && typeof estadoDiario.claridad === 'number') {
    return Math.round((estadoDiario.energia + estadoDiario.claridad) / 2);
  }
  if (typeof estadoDiario.energia === 'number') return estadoDiario.energia;
  return 70;
}

function suenoActualVal() {
  if (typeof estadoDiario.sueno === 'number') return estadoDiario.sueno;
  return 70;
}

function deporteLevelIndex(val) {
  if (typeof val !== 'number') return -1;
  let best = 0, bestD = Infinity;
  DEPORTE_LEVELS.forEach((f, i) => {
    const d = Math.abs(f.v - val);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function triggerLevelIndex(val) {
  if (typeof val !== 'number') return -1;
  let best = 0, bestD = Infinity;
  TRIGGER_LEVELS.forEach((f, i) => {
    const d = Math.abs(f.v - val);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function tiempoDisponibleLevelIndex(val) {
  if (typeof val !== 'number') return -1;
  let best = 0, bestD = Infinity;
  TIEMPO_DISPONIBLE_LEVELS.forEach((f, i) => {
    const d = Math.abs(f.v - val);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function estadoToFaceIndex(val) {
  let best = 0, bestD = Infinity;
  ESTADO_FACES.forEach((f, i) => {
    const d = Math.abs(f.v - val);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function suenoToFaceIndex(val) {
  let best = 0, bestD = Infinity;
  SUENO_FACES.forEach((f, i) => {
    const d = Math.abs(f.v - val);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Fija los alias de ánimo sin tocar sueño.
function _setEstadoAll(n) {
  estadoDiario.estado = n;
  estadoDiario.bienestar = n;
  estadoDiario.energia = n;
  estadoDiario.claridad = n;
}

// El usuario toca una cara: fija el estado, persiste y da feedback.
function pickEstado(idx) {
  const f = ESTADO_FACES[idx];
  if (!f) return;
  _estadoUserSet = true;
  _setEstadoAll(f.v);
  recordEstadoEvent(f);
  selectedEnergy = f.v >= 65 ? 'alta' : f.v >= 35 ? 'normal' : 'baja';
  refreshEstadoFacesUI();
  try { Haptics.medium(); } catch(e) {}
  try { if (typeof SFX !== 'undefined' && SFX.toggle) SFX.toggle(); } catch(e) {}
  clearTimeout(pickEstado._t);
  pickEstado._t = setTimeout(() => {
    saveEstadoDiario();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
    // La predicción de hoy se ajusta a cómo estás → recalcular ya.
    if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(true);
  }, 150);
}

function pickSueno(idx) {
  const f = SUENO_FACES[idx];
  if (!f) return;
  _suenoUserSet = true;
  estadoDiario.sueno = f.v;
  refreshSuenoFacesUI();
  try { Haptics.light(); } catch(e) {}
  try { if (typeof SFX !== 'undefined' && SFX.toggle) SFX.toggle(); } catch(e) {}
  clearTimeout(pickSueno._t);
  pickSueno._t = setTimeout(() => {
    saveEstadoDiario();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
  }, 150);
}

function _estadoEventosLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem('alberto_estado_eventos_v1') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch(e) {
    return [];
  }
}

function _saveEstadoEventosLocal(items) {
  try {
    localStorage.setItem('alberto_estado_eventos_v1', JSON.stringify((items || []).slice(-2000)));
  } catch(e) {}
}

function ensureEstadoEventos() {
  if (typeof db !== 'object' || !db) return _estadoEventosLocal();
  if (!Array.isArray(db.estadoEventos)) db.estadoEventos = _estadoEventosLocal();
  return db.estadoEventos;
}

function _deporteEventosLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem('alberto_deporte_eventos_v1') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch(e) {
    return [];
  }
}

function _saveDeporteEventosLocal(items) {
  try {
    localStorage.setItem('alberto_deporte_eventos_v1', JSON.stringify((items || []).slice(-2000)));
  } catch(e) {}
}

function ensureDeporteEventos() {
  if (typeof db !== 'object' || !db) return _deporteEventosLocal();
  if (!Array.isArray(db.deporteEventos)) db.deporteEventos = _deporteEventosLocal();
  return db.deporteEventos;
}

function _suenoEventosLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem('alberto_sueno_eventos_v1') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch(e) {
    return [];
  }
}

function _saveSuenoEventosLocal(items) {
  try {
    localStorage.setItem('alberto_sueno_eventos_v1', JSON.stringify((items || []).slice(-2000)));
  } catch(e) {}
}

function ensureSuenoEventos() {
  if (typeof db !== 'object' || !db) return _suenoEventosLocal();
  if (!Array.isArray(db.suenoEventos)) db.suenoEventos = _suenoEventosLocal();
  return db.suenoEventos;
}

function _triggerEventosLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem('alberto_trigger_eventos_v1') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch(e) {
    return [];
  }
}

function _saveTriggerEventosLocal(items) {
  try {
    localStorage.setItem('alberto_trigger_eventos_v1', JSON.stringify((items || []).slice(-2000)));
  } catch(e) {}
}

function ensureTriggerEventos() {
  if (typeof db !== 'object' || !db) return _triggerEventosLocal();
  if (!Array.isArray(db.triggerEventos)) db.triggerEventos = _triggerEventosLocal();
  return db.triggerEventos;
}

function _tiempoDisponibleEventosLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem('alberto_tiempo_disponible_v1') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch(e) {
    return [];
  }
}

function _saveTiempoDisponibleEventosLocal(items) {
  try {
    localStorage.setItem('alberto_tiempo_disponible_v1', JSON.stringify((items || []).slice(-2000)));
  } catch(e) {}
}

function ensureTiempoDisponibleEventos() {
  if (typeof db !== 'object' || !db) return _tiempoDisponibleEventosLocal();
  if (!Array.isArray(db.tiempoDisponibleEventos)) db.tiempoDisponibleEventos = _tiempoDisponibleEventosLocal();
  return db.tiempoDisponibleEventos;
}

function ensureDailyJournalEntries() {
  if (typeof db !== 'object' || !db) return [];
  if (!Array.isArray(db.dailyJournalEntries)) db.dailyJournalEntries = [];
  return db.dailyJournalEntries;
}

function sessionJournalDayKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function sessionJournalTodayEntries() {
  const today = sessionJournalDayKey(new Date());
  return ensureDailyJournalEntries()
    .filter(e => e && ((e.day || sessionJournalDayKey(e.at)) === today))
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function clearSessionJournalInput() {
  const input = document.getElementById('sessionJournalInput');
  if (input) input.value = '';
}

function saveSessionJournalEntry() {
  const input = document.getElementById('sessionJournalInput');
  const text = (input?.value || '').trim();
  if (!text) {
    showToast('Escribe una entrada primero');
    return;
  }
  const arr = ensureDailyJournalEntries();
  const now = new Date();
  arr.push({
    id: 'journal_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 7),
    at: now.toISOString(),
    day: sessionJournalDayKey(now),
    date: now.toDateString(),
    text: text.slice(0, 2400),
  });
  if (arr.length > 3000) arr.splice(0, arr.length - 3000);
  if (input) input.value = '';
  saveData();
  renderSessionJournal();
  try { Haptics.light(); } catch(e) {}
  showToast('Entrada guardada');
}

function deleteSessionJournalEntry(id) {
  const arr = ensureDailyJournalEntries();
  const idx = arr.findIndex(e => e && e.id === id);
  if (idx < 0) return;
  arr.splice(idx, 1);
  saveData();
  renderSessionJournal();
  showToast('Entrada eliminada');
}

function renderSessionJournal() {
  const meta = document.getElementById('sessionJournalMeta');
  const list = document.getElementById('sessionJournalList');
  const input = document.getElementById('sessionJournalInput');
  if (input) input.placeholder = 'Dicta o escribe una entrada general del dia: plan, sensaciones, prioridades, algo que quieras recordar...';
  if (!meta && !list) return;
  const entries = sessionJournalTodayEntries();
  if (meta) meta.textContent = entries.length ? ('Hoy · ' + entries.length + (entries.length === 1 ? ' entrada' : ' entradas')) : 'Hoy';
  if (!list) return;
  if (!entries.length) {
    list.innerHTML = '<div class="session-journal-empty">Aun no hay entradas hoy.</div>';
    return;
  }
  list.innerHTML = entries.slice().reverse().slice(0, 8).map(entry => {
    const at = entry.at || '';
    return '<article class="session-journal-entry">' +
      '<div class="session-journal-entry-head">' +
        '<span>' + escapeHtmlSafe(aiTimeLabel(at) || '--:--') + '</span>' +
        '<button type="button" onclick="deleteSessionJournalEntry(\'' + escapeHtmlSafe(entry.id || '') + '\')" aria-label="Eliminar entrada">×</button>' +
      '</div>' +
      '<p>' + escapeHtmlSafe(entry.text || '') + '</p>' +
    '</article>';
  }).join('');
}

function siestaEventsToday() {
  const today = new Date().toDateString();
  return ensureSuenoEventos().filter(e => e && e.date === today && (e.kind || 'siesta') === 'siesta');
}

function siestaTodaySummary() {
  const arr = siestaEventsToday();
  const last = arr.length ? arr[arr.length - 1] : null;
  return {
    count: arr.length,
    lastAt: last ? last.at : null,
  };
}

function deporteEventsToday(kind) {
  const today = new Date().toDateString();
  return ensureDeporteEventos().filter(e => e && e.date === today && (!kind || e.kind === kind));
}

function deporteLastToday(kind) {
  const arr = deporteEventsToday(kind);
  return arr.length ? arr[arr.length - 1] : null;
}

function deporteTodaySummary() {
  const summary = { cardio: null, fuerza: null, total: 0 };
  ['cardio', 'fuerza'].forEach(kind => {
    const arr = deporteEventsToday(kind);
    summary.total += arr.length;
    if (arr.length) {
      const last = arr[arr.length - 1];
      summary[kind] = {
        value: last.value,
        level: last.level,
        label: last.label,
        at: last.at,
        count: arr.length,
      };
    }
  });
  return summary;
}

function triggerEventsToday() {
  const today = new Date().toDateString();
  return ensureTriggerEventos().filter(e => e && e.date === today);
}

function triggerLastToday() {
  const arr = triggerEventsToday();
  return arr.length ? arr[arr.length - 1] : null;
}

function triggerTodaySummary() {
  const arr = triggerEventsToday();
  const last = arr.length ? arr[arr.length - 1] : null;
  return {
    count: arr.length,
    lastAt: last ? last.at : null,
    lastLevel: last ? last.level : null,
    lastLabel: last ? last.label : null,
    lastValue: last ? last.value : null,
  };
}

function tiempoDisponibleToday() {
  const today = new Date().toDateString();
  const arr = ensureTiempoDisponibleEventos().filter(e => e && e.date === today);
  return arr.length ? arr[arr.length - 1] : null;
}

function tiempoDisponibleTodaySummary() {
  const current = tiempoDisponibleToday();
  return current ? {
    value: current.value,
    level: current.level,
    label: current.label,
    range: current.range,
    at: current.at,
  } : null;
}

function estadoSnapshot() {
  const n = estadoActualVal();
  const deporte = deporteTodaySummary();
  const siestas = siestaTodaySummary();
  const triggers = triggerTodaySummary();
  const tiempoDisponible = tiempoDisponibleTodaySummary();
  estadoDiario.deporte = deporte;
  estadoDiario.siestas = siestas;
  estadoDiario.triggers = triggers;
  estadoDiario.tiempoDisponible = tiempoDisponible;
  return { estado: n, bienestar: n, sueno: suenoActualVal(), energia: n, claridad: n, deporte, siestas, triggers, tiempoDisponible };
}

function recordEstadoEvent(face) {
  const arr = ensureEstadoEventos();
  const now = new Date();
  const entry = {
    id: 'estado_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 7),
    at: now.toISOString(),
    date: now.toDateString(),
    value: face.v,
    label: face.label,
  };
  arr.push(entry);
  if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  _saveEstadoEventosLocal(arr);
  refreshEstadoEventSummary();
  clearTimeout(recordEstadoEvent._t);
  recordEstadoEvent._t = setTimeout(() => {
    if (typeof saveData === 'function') saveData();
  }, 600);
}

function recordDeporteEvent(kind, level) {
  const arr = ensureDeporteEventos();
  const now = new Date();
  const entry = {
    id: 'deporte_' + kind + '_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 7),
    at: now.toISOString(),
    date: now.toDateString(),
    kind,
    value: level.v,
    level: level.level,
    label: level.label,
  };
  arr.push(entry);
  if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  _saveDeporteEventosLocal(arr);
  estadoDiario.deporte = deporteTodaySummary();
  refreshDeporteFacesUI();
  refreshDeporteEventSummary();
  clearTimeout(recordDeporteEvent._t);
  recordDeporteEvent._t = setTimeout(() => {
    if (typeof saveData === 'function') saveData();
  }, 600);
}

function recordTriggerEvent(level) {
  const arr = ensureTriggerEventos();
  const now = new Date();
  const entry = {
    id: 'trigger_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 7),
    at: now.toISOString(),
    date: now.toDateString(),
    value: level.v,
    level: level.level,
    label: level.label,
  };
  arr.push(entry);
  if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  _saveTriggerEventosLocal(arr);
  estadoDiario.triggers = triggerTodaySummary();
  refreshTriggerFacesUI();
  refreshTriggerEventSummary();
  clearTimeout(recordTriggerEvent._t);
  recordTriggerEvent._t = setTimeout(() => {
    if (typeof saveData === 'function') saveData();
  }, 600);
}

function recordTiempoDisponible(level) {
  const arr = ensureTiempoDisponibleEventos();
  const now = new Date();
  const today = now.toDateString();
  const existingIdx = arr.findIndex(e => e && e.date === today);
  const previous = existingIdx >= 0 ? arr[existingIdx] : null;
  const entry = {
    id: previous?.id || ('tiempo_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 7)),
    at: now.toISOString(),
    date: today,
    value: level.v,
    level: level.level,
    label: level.label,
    range: level.range,
  };
  if (existingIdx >= 0) arr[existingIdx] = entry;
  else arr.push(entry);
  if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  _saveTiempoDisponibleEventosLocal(arr);
  estadoDiario.tiempoDisponible = tiempoDisponibleTodaySummary();
  refreshTiempoDisponibleFacesUI();
  refreshTiempoDisponibleSummary();
  clearTimeout(recordTiempoDisponible._t);
  recordTiempoDisponible._t = setTimeout(() => {
    if (typeof saveData === 'function') saveData();
  }, 600);
}

function recordSiesta() {
  const arr = ensureSuenoEventos();
  const now = new Date();
  const entry = {
    id: 'siesta_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 7),
    at: now.toISOString(),
    date: now.toDateString(),
    kind: 'siesta',
  };
  arr.push(entry);
  if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  _saveSuenoEventosLocal(arr);
  estadoDiario.siestas = siestaTodaySummary();
  refreshSiestaSummary();
  try { Haptics.light(); } catch(e) {}
  try { if (typeof SFX !== 'undefined' && SFX.toggle) SFX.toggle(); } catch(e) {}
  let hour = '';
  try { hour = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch(e) {}
  showToast('Siesta registrada' + (hour ? ' · ' + hour : ''));
  clearTimeout(recordSiesta._t);
  recordSiesta._t = setTimeout(() => {
    saveEstadoDiario();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
    if (typeof saveData === 'function') saveData();
  }, 180);
}

function refreshEstadoFacesUI() {
  const idx = _estadoUserSet ? estadoToFaceIndex(estadoActualVal()) : -1;
  document.querySelectorAll('#estadoFaces .estado-face').forEach((b, i) => {
    const on = i === idx;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const status = document.getElementById('estadoStatus');
  if (status) {
    status.textContent = _estadoUserSet ? 'Registrado hoy' : 'Sin registrar hoy · toca una opción';
    status.classList.toggle('is-unset', !_estadoUserSet);
  }
}

function refreshSuenoFacesUI() {
  const idx = _suenoUserSet ? suenoToFaceIndex(suenoActualVal()) : -1;
  document.querySelectorAll('#suenoFaces .estado-face').forEach((b, i) => {
    const on = i === idx;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const status = document.getElementById('suenoStatus');
  if (status) {
    status.textContent = _suenoUserSet ? 'Registrado hoy' : 'Sin registrar hoy · toca una opción';
    status.classList.toggle('is-unset', !_suenoUserSet);
  }
}

function refreshSiestaSummary() {
  const el = document.getElementById('siestaSummary');
  if (!el) return;
  const arr = siestaEventsToday();
  if (!arr.length) {
    el.textContent = 'sin siesta hoy';
    return;
  }
  const last = arr[arr.length - 1];
  let hour = '';
  try { hour = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch(e) {}
  el.textContent = arr.length === 1
    ? ('siesta' + (hour ? ' · ' + hour : ''))
    : (arr.length + ' siestas' + (hour ? ' · última ' + hour : ''));
}

function refreshDeporteFacesUI() {
  [
    { kind: 'cardio', host: '#cardioFaces', meta: 'deporteCardioMeta' },
    { kind: 'fuerza', host: '#fuerzaFaces', meta: 'deporteFuerzaMeta' },
  ].forEach(cfg => {
    const last = deporteLastToday(cfg.kind);
    const idx = last ? deporteLevelIndex(last.value) : -1;
    document.querySelectorAll(cfg.host + ' .estado-face').forEach((b, i) => {
      const on = i === idx;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const meta = document.getElementById(cfg.meta);
    if (meta) {
      if (!last) {
        meta.textContent = 'sin registro hoy';
      } else {
        let hour = '';
        try { hour = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch(e) {}
        meta.textContent = last.label + (hour ? ' · ' + hour : '');
      }
    }
  });
}

function refreshTriggerFacesUI() {
  const last = triggerLastToday();
  const idx = last ? triggerLevelIndex(last.value) : -1;
  document.querySelectorAll('#triggerFaces .estado-face').forEach((b, i) => {
    const on = i === idx;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const status = document.getElementById('triggerStatus');
  if (status) {
    const registered = !!last;
    status.textContent = registered ? 'Registrado hoy' : 'Sin registrar hoy · toca un nivel';
    status.classList.toggle('is-unset', !registered);
  }
}

function refreshTiempoDisponibleFacesUI() {
  const current = tiempoDisponibleToday();
  const idx = current ? tiempoDisponibleLevelIndex(current.value) : -1;
  document.querySelectorAll('#tiempoDisponibleFaces .estado-face').forEach((b, i) => {
    const on = i === idx;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const status = document.getElementById('tiempoDisponibleStatus');
  if (status) {
    const registered = !!current;
    status.textContent = registered ? 'Registrado hoy' : 'Sin registrar hoy';
    status.classList.toggle('is-unset', !registered);
  }
}

function refreshEstadoEventSummary() {
  const el = document.getElementById('estadoEventSummary');
  if (!el) return;
  const today = new Date().toDateString();
  const todayEvents = ensureEstadoEventos().filter(e => e && e.date === today);
  if (!todayEvents.length) {
    el.textContent = 'Sin registrar hoy · elige una cara cuando quieras guardar tu estado.';
    return;
  }
  const last = todayEvents[todayEvents.length - 1];
  let hour = '';
  try {
    hour = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch(e) {}
  el.textContent = 'Último ánimo: ' + last.label + (hour ? ' · ' + hour : '') + ' · ' + todayEvents.length + ' registros hoy';
}

function refreshDeporteEventSummary() {
  const el = document.getElementById('deporteEventSummary');
  if (!el) return;
  const cardio = deporteEventsToday('cardio');
  const fuerza = deporteEventsToday('fuerza');
  const total = cardio.length + fuerza.length;
  if (!total) {
    el.textContent = 'Sin registrar hoy · toca una intensidad cuando hagas cardio o fuerza.';
    return;
  }
  const parts = [];
  if (cardio.length) parts.push('cardio ' + cardio[cardio.length - 1].label.toLowerCase());
  if (fuerza.length) parts.push('fuerza ' + fuerza[fuerza.length - 1].label.toLowerCase());
  el.textContent = 'Deporte hoy: ' + parts.join(' · ') + ' · ' + total + ' registros';
}

function refreshTriggerEventSummary() {
  const el = document.getElementById('triggerEventSummary');
  if (!el) return;
  const arr = triggerEventsToday();
  if (!arr.length) {
    el.textContent = 'Sin registrar hoy · toca un nivel cuando aparezca un gatillo.';
    return;
  }
  const last = arr[arr.length - 1];
  let hour = '';
  try { hour = new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch(e) {}
  el.textContent = 'Gatillos hoy: ' + arr.length + ' · último ' + (last.label || last.level || '') + (hour ? ' · ' + hour : '');
}

function refreshTiempoDisponibleSummary() {
  const el = document.getElementById('tiempoDisponibleSummary');
  if (!el) return;
  const current = tiempoDisponibleToday();
  if (!current) {
    el.textContent = 'Tiempo bruto disponible para tocar hoy. Se guarda una vez por día.';
    return;
  }
  let hour = '';
  try { hour = new Date(current.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch(e) {}
  el.textContent = (current.label || '') + (current.range ? ' · ' + current.range : '') + (hour ? ' · ' + hour : '');
}

function pickDeporte(kind, idx) {
  const level = DEPORTE_LEVELS[idx];
  if (!level || (kind !== 'cardio' && kind !== 'fuerza')) return;
  recordDeporteEvent(kind, level);
  try { Haptics.light(); } catch(e) {}
  try { if (typeof SFX !== 'undefined' && SFX.toggle) SFX.toggle(); } catch(e) {}
  clearTimeout(pickDeporte._t);
  pickDeporte._t = setTimeout(() => {
    saveEstadoDiario();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
  }, 150);
}

function pickDeporteCardio(idx) { pickDeporte('cardio', idx); }
function pickDeporteFuerza(idx) { pickDeporte('fuerza', idx); }

function pickTrigger(idx) {
  const level = TRIGGER_LEVELS[idx];
  if (!level) return;
  recordTriggerEvent(level);
  try { Haptics.light(); } catch(e) {}
  try { if (typeof SFX !== 'undefined' && SFX.toggle) SFX.toggle(); } catch(e) {}
  clearTimeout(pickTrigger._t);
  pickTrigger._t = setTimeout(() => {
    saveEstadoDiario();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
  }, 150);
}

function pickTiempoDisponible(idx) {
  const level = TIEMPO_DISPONIBLE_LEVELS[idx];
  if (!level) return;
  recordTiempoDisponible(level);
  try { Haptics.light(); } catch(e) {}
  try { if (typeof SFX !== 'undefined' && SFX.toggle) SFX.toggle(); } catch(e) {}
  clearTimeout(pickTiempoDisponible._t);
  pickTiempoDisponible._t = setTimeout(() => {
    saveEstadoDiario();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
  }, 150);
}

// Persiste estadoDiario en localStorage con marca de fecha.
// La fecha permite que al cambiar de día el estado se reinicie a defaults
// (70/70) en lugar de heredar el del día anterior.
function saveEstadoDiario() {
  try {
    const todayStr = new Date().toDateString();
    const snap = estadoSnapshot();
    const payload = {
      date: todayStr,
      estado: snap.estado,
      userSet: _estadoUserSet, // true solo si Alberto lo introdujo hoy
      suenoUserSet: _suenoUserSet,
      // Alias retrocompatibles de ánimo + sueño independiente
      bienestar: snap.bienestar,
      sueno: snap.sueno,
      energia: snap.energia,
      claridad: snap.claridad,
      deporte: snap.deporte,
      siestas: snap.siestas,
      triggers: snap.triggers,
      tiempoDisponible: snap.tiempoDisponible,
    };
    // 1) localStorage (carga rápida sin esperar a nube en el arranque)
    localStorage.setItem('alberto_estado_v1', JSON.stringify(payload));
    // 2) db.estadoDiario (se sincroniza con Supabase, persiste entre dispositivos)
    if (typeof db === 'object' && db) {
      db.estadoDiario = payload;
      // 3) Persistir también en db.sesiones[hoy].estado para que la gráfica
      // de historial tenga datos aunque la sesión esté vacía aún.
      persistEstadoToSession();
      // saveData ya hace debounce a la nube; aquí lo llamamos con debounce
      // adicional para no martillear cuando arrastras el slider.
      clearTimeout(saveEstadoDiario._t);
      saveEstadoDiario._t = setTimeout(() => {
        if (typeof saveData === 'function') saveData();
      }, 600);
    }
  } catch(e) {}
}

// Escribe el estado diario actual en la sesión de HOY de db.sesiones[].
// Si no existe sesión de hoy, no la crea (sería una sesión vacía que
// rompería la lógica de "no hay sesiones aún"). Solo actualiza si ya existe.
// El autoSave del cronómetro creará la sesión cuando hagas algo, y entonces
// también incluirá el estado vía el campo `estado` que añadimos arriba.
function persistEstadoToSession() {
  if (!db || !Array.isArray(db.sesiones)) return;
  const todayStr = new Date().toDateString();
  const idx = db.sesiones.findIndex(s => new Date(s.date).toDateString() === todayStr);
  if (idx < 0) return; // No hay sesión de hoy todavía
  const sesion = db.sesiones[idx];
  sesion.estado = estadoSnapshot();
}

// Carga el estado diario priorizando la fuente más fresca:
// 1) db.estadoDiario (de nube — Supabase ya cargó db cuando llegamos aquí)
// 2) localStorage (caché local)
// 3) defaults (70/70)
// Solo se considera válido si el campo `date` es hoy. En otro caso, defaults.
function loadEstadoDiarioFromSources() {
  const todayStr = new Date().toDateString();
  // Deriva el valor único `estado` de cualquier formato guardado (nuevo o viejo).
  const deriveEstado = src => {
    if (!src) return null;
    if (typeof src.estado === 'number') return src.estado;
    if (typeof src.bienestar === 'number') return src.bienestar;
    if (typeof src.energia === 'number' && typeof src.claridad === 'number') {
      return Math.round((src.energia + src.claridad) / 2);
    }
    if (typeof src.energia === 'number') return src.energia;
    return null;
  };
  const deriveSueno = src => {
    if (!src) return null;
    if (typeof src.sueno === 'number') return src.sueno;
    return null;
  };
  // 1) db (la nube, si ya está cargada)
  if (db && db.estadoDiario && db.estadoDiario.date === todayStr) {
    const v = deriveEstado(db.estadoDiario);
    const sleep = deriveSueno(db.estadoDiario);
    if (v != null) {
      _estadoUserSet = !!db.estadoDiario.userSet;
      _suenoUserSet = !!db.estadoDiario.suenoUserSet;
      _setEstadoAll(v);
      if (sleep != null) estadoDiario.sueno = sleep;
      estadoDiario.deporte = db.estadoDiario.deporte || null;
      estadoDiario.siestas = db.estadoDiario.siestas || null;
      estadoDiario.triggers = db.estadoDiario.triggers || null;
      estadoDiario.tiempoDisponible = db.estadoDiario.tiempoDisponible || null;
      return true;
    }
  }
  // 2) localStorage
  try {
    const saved = JSON.parse(localStorage.getItem('alberto_estado_v1') || 'null');
    if (saved && (saved.date === todayStr || !saved.date)) {
      const v = deriveEstado(saved);
      const sleep = deriveSueno(saved);
      if (v != null) {
        _estadoUserSet = !!(saved.date === todayStr && saved.userSet);
        _suenoUserSet = !!(saved.date === todayStr && saved.suenoUserSet);
        _setEstadoAll(v);
        if (sleep != null) estadoDiario.sueno = sleep;
        estadoDiario.deporte = saved.deporte || null;
        estadoDiario.siestas = saved.siestas || null;
        estadoDiario.triggers = saved.triggers || null;
        estadoDiario.tiempoDisponible = saved.tiempoDisponible || null;
        return true;
      }
    }
  } catch(e) {}
  // 3) Defaults — ya están en estadoDiario al declararlo (70/70)
  return false;
}

function resolveThemeBg2() {
  // Resolve --bg2 CSS variable to actual color by measuring a temp element
  try {
    var parent = document.body || document.documentElement;
    var tmp = document.createElement('span');
    tmp.setAttribute('style', 'display:block;position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;background:var(--bg2)');
    parent.appendChild(tmp);
    var bg = window.getComputedStyle(tmp).backgroundColor;
    parent.removeChild(tmp);
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
  } catch(e) {}
  // Fallback based on current theme.
  var t = document.documentElement.getAttribute('data-theme') || '';
  return t === 'marmol-night' ? '#1b1f27' : '#e8ddd0';
}

function fillEstadoSlider(slider, color) {
  if (!slider) return;
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const val = parseFloat(slider.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--fp', pct + '%');
  slider.style.setProperty('--fc', color);
  slider.style.color = color;
}

function updateEstado(dim, val) {
  const n = parseInt(val);
  if (dim === 'sueno') {
    _suenoUserSet = true;
    estadoDiario.sueno = n;
  } else {
    _estadoUserSet = true;
    estadoDiario[dim] = n;
  }
  // Mantener alias retrocompat: bienestar refleja energia y claridad a la vez
  if (dim === 'bienestar') {
    estadoDiario.estado = n;
    estadoDiario.energia = n;
    estadoDiario.claridad = n;
  }
  const valEl = document.getElementById('estval-' + dim);
  if (valEl) { valEl.textContent = val; }
  const slider = document.getElementById('est-' + dim);
  fillEstadoSlider(slider, ESTADO_COLORS[dim]);
  // alias para algoritmo de sesión
  if (dim !== 'sueno') {
    const ref = estadoActualVal();
    selectedEnergy = ref >= 65 ? 'alta' : ref >= 35 ? 'normal' : 'baja';
  }
  // Persistir cada cambio (debounce ligero para no martillear al arrastrar)
  clearTimeout(updateEstado._t);
  updateEstado._t = setTimeout(() => {
    saveEstadoDiario();
    // También actualizar la sesión de hoy en db.sesiones para que la gráfica
    // de historial muestre los datos correctos.
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
  }, 250);
}

function ritmoIconSvg(icon) {
  const faceParts = {
    'face-very-bad': {
      eyes: '<path d="M20 28 Q24 25 28 28"/><path d="M36 28 Q40 25 44 28"/>',
      brows: '<path d="M18 22 L28 24"/><path d="M36 24 L46 22"/>',
      mouth: '<path d="M23 47 Q32 36 41 47"/>'
    },
    'face-bad': {
      eyes: '<circle cx="24" cy="28" r="1.7"/><circle cx="40" cy="28" r="1.7"/>',
      brows: '<path d="M20 23 L28 24"/><path d="M36 24 L44 23"/>',
      mouth: '<path d="M24 45 Q32 39 40 45"/>'
    },
    'face-neutral': {
      eyes: '<circle cx="24" cy="28" r="1.7"/><circle cx="40" cy="28" r="1.7"/>',
      brows: '',
      mouth: '<path d="M24 43 H40"/>'
    },
    'face-good': {
      eyes: '<circle cx="24" cy="28" r="1.7"/><circle cx="40" cy="28" r="1.7"/>',
      brows: '',
      mouth: '<path d="M24 40 Q32 48 40 40"/>'
    },
    'face-great': {
      eyes: '<path d="M20 27 Q24 24 28 27"/><path d="M36 27 Q40 24 44 27"/>',
      brows: '<path d="M18 21 Q24 18 30 21"/><path d="M34 21 Q40 18 46 21"/>',
      mouth: '<path d="M22 39 Q32 52 42 39"/>'
    },
  };
  if (faceParts[icon]) {
    const f = faceParts[icon];
    return '<svg class="ritmo-icon-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="24"/>' + f.brows + f.eyes + f.mouth + '</svg>';
  }
  if (icon && icon.startsWith('cardio-')) {
    const level = parseInt(icon.replace('cardio-', ''), 10) || 1;
    const pulse = level >= 3
      ? '<path d="M14 35 H22 L26 27 L32 44 L38 29 L42 35 H50"/>'
      : '<path d="M17 35 H24 L28 31 L33 39 L38 35 H47"/>';
    const rays = [
      level >= 4 ? '<path d="M32 8 V13"/>' : '',
      level >= 4 ? '<path d="M51 22 L47 25"/><path d="M13 22 L17 25"/>' : '',
      level >= 5 ? '<path d="M54 37 L49 36"/><path d="M10 37 L15 36"/>' : ''
    ].join('');
    return '<svg class="ritmo-icon-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<path d="M32 52 C20 42 13 34 13 25 C13 18 18 14 24 14 C28 14 31 17 32 21 C33 17 36 14 40 14 C46 14 51 18 51 25 C51 34 44 42 32 52 Z"/>' +
      pulse + rays + '</svg>';
  }
  if (icon && icon.startsWith('fuerza-')) {
    const level = parseInt(icon.replace('fuerza-', ''), 10) || 1;
    const inner = level >= 1 ? '<path d="M23 28 V36"/><path d="M41 28 V36"/>' : '';
    const mid = level >= 2 ? '<path d="M18 25 V39"/><path d="M46 25 V39"/>' : '<path d="M19 28 V36"/><path d="M45 28 V36"/>';
    const outer = level >= 4 ? '<path d="M13 23 V41"/><path d="M51 23 V41"/>' : '';
    const end = level >= 5 ? '<path d="M9 27 V37"/><path d="M55 27 V37"/>' : '';
    const lift = level >= 3 ? '<path d="M28 39 Q32 42 36 39"/>' : '';
    return '<svg class="ritmo-icon-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<path d="M16 32 H48"/>' + inner + mid + outer + end + lift +
      '</svg>';
  }
  if (icon && icon.startsWith('trigger-')) {
    const level = parseInt(icon.replace('trigger-', ''), 10) || 1;
    const ring2 = level >= 2 ? '<circle cx="32" cy="32" r="13"/>' : '';
    const ring3 = level >= 4 ? '<circle cx="32" cy="32" r="20"/>' : '';
    const rays = [
      level >= 3 ? '<path d="M32 7 V13"/><path d="M32 51 V57"/>' : '',
      level >= 4 ? '<path d="M7 32 H13"/><path d="M51 32 H57"/>' : '',
      level >= 5 ? '<path d="M14 14 L18 18"/><path d="M50 14 L46 18"/><path d="M14 50 L18 46"/><path d="M50 50 L46 46"/>' : ''
    ].join('');
    return '<svg class="ritmo-icon-svg ritmo-trigger-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="5"/>' + ring2 + ring3 + rays +
      '</svg>';
  }
  if (icon && icon.startsWith('tiempo-')) {
    const level = parseInt(icon.replace('tiempo-', ''), 10) || 1;
    const marks = [
      '<path d="M32 13 V18"/>',
      level >= 2 ? '<path d="M51 32 H46"/>' : '',
      level >= 3 ? '<path d="M32 51 V46"/>' : '',
      level >= 4 ? '<path d="M13 32 H18"/>' : '',
      level >= 5 ? '<path d="M45 19 L41.5 22.5"/><path d="M45 45 L41.5 41.5"/><path d="M19 45 L22.5 41.5"/><path d="M19 19 L22.5 22.5"/>' : ''
    ].join('');
    const hand = level <= 2 ? '<path d="M32 32 V23"/><path d="M32 32 H39"/>'
      : level <= 4 ? '<path d="M32 32 V21"/><path d="M32 32 H43"/>'
        : '<path d="M32 32 V18"/><path d="M32 32 H46"/>';
    return '<svg class="ritmo-icon-svg ritmo-tiempo-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="22"/>' + marks + hand + '<circle cx="32" cy="32" r="2.2"/>' +
      '</svg>';
  }
  const moon = {
    'moon-lowest': {
      tilt: -14,
      face: '<path d="M24 34 Q27 37 30 34"/><path d="M37 34 Q40 37 43 34"/><path d="M28 45 Q34 39 40 45"/>',
      extra: '<path d="M18 16 Q20 14 22 16"/>'
    },
    'moon-low': {
      tilt: -7,
      face: '<path d="M24 34 Q27 36 30 34"/><path d="M37 34 Q40 36 43 34"/><path d="M28 44 H40"/>',
      extra: ''
    },
    'moon-mid': {
      tilt: 0,
      face: '<circle cx="28" cy="34" r="1.6"/><circle cx="40" cy="34" r="1.6"/><path d="M29 43 H39"/>',
      extra: ''
    },
    'moon-good': {
      tilt: 7,
      face: '<path d="M24 33 Q27 31 30 33"/><path d="M37 33 Q40 31 43 33"/><path d="M29 42 Q34 46 39 42"/>',
      extra: ''
    },
    'moon-best': {
      tilt: 14,
      face: '<path d="M24 33 Q27 30 30 33"/><path d="M37 33 Q40 30 43 33"/><path d="M28 41 Q34 48 41 41"/>',
      extra: '<path d="M51 14 V19"/><path d="M48.5 16.5 H53.5"/>'
    },
  }[icon] || { tilt: 0, face: '', extra: '' };
  return '<svg class="ritmo-icon-svg ritmo-moon-svg" viewBox="0 0 64 64" aria-hidden="true">' +
    '<g transform="rotate(' + moon.tilt + ' 32 32)">' +
      '<path d="M42 11 C33 14 26 23 26 34 C26 45 35 54 47 54 C42 59 35 61 28 59 C16 56 8 45 9 32 C10 18 21 9 35 9 C38 9 40 10 42 11 Z"/>' +
      moon.face + moon.extra +
    '</g></svg>';
}

function ritmoChoiceHTML(item, idx, fnName, groupName) {
  return '<button type="button" class="estado-face ritmo-choice" role="radio" aria-checked="false"' +
    ' aria-label="' + item.label + '" title="' + item.label + '" onclick="' + fnName + '(' + idx + ')">' +
    '<span class="estado-face-emoji ritmo-icon">' + ritmoIconSvg(item.icon) + '</span>' +
    '<span class="estado-face-label">' + item.label + '</span>' +
    '<span class="ritmo-dot" aria-hidden="true"></span>' +
    '</button>';
}

// (Conserva el nombre por compatibilidad con sus call sites: ahora monta las
// tarjetas de bienestar/sueño en vez de sliders.)
function initEstadoSliders() {
  // Migración perezosa al modelo de una sola variable.
  _setEstadoAll(estadoActualVal());
  const host = document.getElementById('estadoFaces');
  if (host && !host.dataset.built) {
    host.innerHTML = ESTADO_FACES.map((f, i) => ritmoChoiceHTML(f, i, 'pickEstado', 'bienestar')).join('');
    host.classList.add('ritmo-scale');
    host.dataset.built = '1';
  }
  const sleepHost = document.getElementById('suenoFaces');
  if (sleepHost && !sleepHost.dataset.built) {
    sleepHost.innerHTML = SUENO_FACES.map((f, i) => ritmoChoiceHTML(f, i, 'pickSueno', 'sueno')).join('');
    sleepHost.classList.add('ritmo-scale');
    sleepHost.dataset.built = '1';
  }
  const tiempoHost = document.getElementById('tiempoDisponibleFaces');
  if (tiempoHost && !tiempoHost.dataset.built) {
    tiempoHost.innerHTML = TIEMPO_DISPONIBLE_LEVELS.map((f, i) => ritmoChoiceHTML(f, i, 'pickTiempoDisponible', 'tiempo')).join('');
    tiempoHost.classList.add('ritmo-scale', 'tiempo-scale');
    tiempoHost.dataset.built = '1';
  }
  const cardioHost = document.getElementById('cardioFaces');
  if (cardioHost && !cardioHost.dataset.built) {
    cardioHost.innerHTML = DEPORTE_LEVELS.map((f, i) =>
      ritmoChoiceHTML(Object.assign({}, f, { icon: 'cardio-' + f.level }), i, 'pickDeporteCardio', 'cardio')
    ).join('');
    cardioHost.classList.add('ritmo-scale', 'deporte-scale');
    cardioHost.dataset.built = '1';
  }
  const fuerzaHost = document.getElementById('fuerzaFaces');
  if (fuerzaHost && !fuerzaHost.dataset.built) {
    fuerzaHost.innerHTML = DEPORTE_LEVELS.map((f, i) =>
      ritmoChoiceHTML(Object.assign({}, f, { icon: 'fuerza-' + f.level }), i, 'pickDeporteFuerza', 'fuerza')
    ).join('');
    fuerzaHost.classList.add('ritmo-scale', 'deporte-scale');
    fuerzaHost.dataset.built = '1';
  }
  const triggerHost = document.getElementById('triggerFaces');
  if (triggerHost && !triggerHost.dataset.built) {
    triggerHost.innerHTML = TRIGGER_LEVELS.map((f, i) => ritmoChoiceHTML(f, i, 'pickTrigger', 'trigger')).join('');
    triggerHost.classList.add('ritmo-scale', 'trigger-scale');
    triggerHost.dataset.built = '1';
  }
  refreshEstadoFacesUI();
  refreshSuenoFacesUI();
  refreshSiestaSummary();
  refreshTiempoDisponibleFacesUI();
  refreshTiempoDisponibleSummary();
  refreshDeporteFacesUI();
  refreshTriggerFacesUI();
  refreshEstadoEventSummary();
  refreshDeporteEventSummary();
  refreshTriggerEventSummary();
}

function selectEnergy(btn) {
  document.querySelectorAll('.energy-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedEnergy = btn.dataset.energy;
}

// Slider de tiempo disponible (en minutos, paso de 15). selectedTime en horas.
function _fmtTimeLabel(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return m + ' min';
  if (m === 0) return h + ' h';
  return h + 'h ' + m + 'm';
}

function _updateTimeSliderLabel(min) {
  const el = document.getElementById('timeSliderVal');
  if (el) el.textContent = _fmtTimeLabel(min);
}

function setTimeFromSlider(minVal) {
  const min = parseInt(minVal) || 60;
  selectedTime = min / 60;
  _updateTimeSliderLabel(min);
  const slider = document.getElementById('timeSlider');
  if (slider) fillSlider(slider, 'var(--accent)');
}

function initTimeSlider() {
  const slider = document.getElementById('timeSlider');
  if (!slider) return;
  const min = Math.round((selectedTime || 2) * 60);
  slider.value = min;
  _updateTimeSliderLabel(min);
  fillSlider(slider, 'var(--accent)');
}

// ─── RACHA ───────────────────────────────────────────────────────────────────

function computeRacha() {
  // A day counts if at least one item was marked 'hecho'
  const diasConSesion = new Set(
    (db.sesiones || [])
      .filter(s => (s.items || []).some(it => it.tick === 'hecho'))
      .map(s => new Date(s.date).toDateString())
  );

  let racha = 0;
  const hoy = new Date();
  // Start from today; if today has no session yet, start from yesterday
  // (don't break the streak just because today's session hasn't happened yet)
  const todayStr = hoy.toDateString();
  const startFromYesterday = !diasConSesion.has(todayStr);
  const cursor = new Date(hoy);
  if (startFromYesterday) cursor.setDate(cursor.getDate() - 1);

  while (true) {
    if (diasConSesion.has(cursor.toDateString())) {
      racha++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return { racha, hayHoy: diasConSesion.has(todayStr) };
}

function renderRacha() {
  const el = document.getElementById('rachaDisplay');
  if (!el) return;
  const { racha, hayHoy } = computeRacha();

  if (racha === 0) { el.style.display = 'none'; return; }

  const emoji = racha >= 30 ? '🏆' : racha >= 14 ? '🔥' : racha >= 7 ? '⚡' : '✦';
  const msg   = racha >= 30 ? 'racha increíble'
              : racha >= 14 ? 'dos semanas seguidas'
              : racha >= 7  ? 'una semana seguida'
              : racha >= 3  ? 'días seguidos'
              : racha === 2 ? 'días seguidos'
              : 'día de racha';
  const sub   = hayHoy ? 'Ya has estudiado hoy ✓'
              : racha === 1 ? 'Estudia hoy para mantenerla'
              : 'No la rompas hoy';
  const col   = racha >= 14 ? 'var(--green)' : racha >= 7 ? '#c8a030' : 'var(--accent)';

  el.style.display = 'block';
  el.innerHTML = '<div style="display:inline-flex;align-items:center;gap:8px;background:' + col + '18;border:1px solid ' + col + '44;border-radius:20px;padding:5px 14px;margin-bottom:2px">'
    + '<span style="font-size:18px">' + emoji + '</span>'
    + '<div>'
    + '<span style="font-family:\'Cormorant Garamond\',serif;font-size:22px;color:' + col + ';font-weight:400">' + racha + '</span>'
    + '<span style="font-size:10px;color:' + col + ';opacity:0.8;margin-left:5px">' + msg + '</span>'
    + '</div>'
    + '</div>'
    + '<div style="font-size:8px;color:var(--text3);letter-spacing:0.05em;margin-bottom:2px">' + sub + '</div>';
}

function renderBreakCard(tipo, energia, idx) {
  // tipo puede ser 'larga', 'corta', o un número (minutos)
  const durMin = typeof tipo === 'number' ? tipo : (tipo === 'larga' ? 15 : 10);
  const esLarga = durMin >= 15;

  const actividadesCortas = [
    '🚶 caminar 5 min',
    '💧 beber agua',
    '🧘 estirar cuello y hombros',
    '👁️ ojos cerrados 3 min',
    '🪟 mirar por la ventana',
    '🌬️ respiración profunda x5',
  ];

  const actividadesLargas = [
    '🚶 paseo de 10 min fuera',
    '🍎 comer algo ligero',
    '💧 agua y estirar completo',
    '😴 ojos cerrados tumbado 10 min',
    '🧘 estirar brazos, muñecas, espalda',
    '🪟 aire fresco, no pantalla',
  ];

  let recomendadas;
  if (esLarga) {
    recomendadas = energia === 'baja'
      ? ['😴 ojos cerrados tumbado 10 min', '💧 agua y estirar completo', '🍎 comer algo ligero']
      : ['🚶 paseo de 10 min fuera', '💧 agua y estirar completo', '🍎 comer algo ligero'];
  } else {
    recomendadas = energia === 'baja'
      ? ['👁️ ojos cerrados 3 min', '💧 beber agua', '🌬️ respiración profunda x5']
      : ['🚶 caminar 5 min', '💧 beber agua', '🧘 estirar cuello y hombros'];
  }

  const titulo = `PAUSA · ${durMin} min`;
  const nota = '';

  const actividadesHtml = recomendadas.map(a =>
    `<span class="break-activity">${a}</span>`
  ).join('');

  const timerId = 'timer_' + idx;
  const timerSecs = durMin * 60;

  return `
    <div class="break-card">
      <div class="break-card-title">${titulo}</div>
      <div class="break-activities">${actividadesHtml}</div>
      <div class="break-timer-display" id="${timerId}-display" style="display:none"></div>
      <button class="break-timer-btn" id="${timerId}-btn" onclick="startBreakTimer('${timerId}',${timerSecs})">⏱ Iniciar pausa</button>
    </div>`;
}

// Historial de ticks por obra (sesiones guardadas)
let currentPlan = [];
// Marca el día (toDateString) al que pertenece el currentPlan en memoria.
// Se usa para detectar si la app cruzó medianoche con la sesión abierta y
// evitar que se guarden datos viejos como si fueran de hoy.
let _currentPlanDay = new Date().toDateString();
const sessionTicks = {};
const sessionMinPlan = {};
const sessionSolRatings = {};
const sessionProductivityRatings = {}; // per-item productivity rating (0-100)
// Destellos: sesiones de excelencia marcadas por el usuario (slider ≥ DESTELLO_UMBRAL).
// sessionDestello[planId] = { on: true, nota: 'lo que la hizo especial' }
const sessionDestello = {};
const DESTELLO_UMBRAL = 80; // a partir de aquí el modal ofrece marcar la sesión como destello
const CRONO_DESTELLO_ROTATE_MS = 7 * 60 * 1000;
const CRONO_DESTELLO_MAX_CHARS = 180;
const CRONO_LONG_SESSION_BREAK_MIN = 90;
const CRONO_BREATH_DEFAULT_MIN = 3;
const CRONO_BREATH_PATTERN = [
  { key: 'inhale', label: 'Inhala', secs: 4 },
  { key: 'hold', label: 'Mantén', secs: 7 },
  { key: 'exhale', label: 'Exhala', secs: 8 },
];
let _destellosModalEntries = [];
let _destellosEditIndex = null;
let _cronoLastRunDestelloKey = '';
let _cronoCurrentDestelloEntry = null;
let _pendingDestelloBoostEntry = null;
let _pendingDestelloBoostSource = null;
let _cronoBreathInterval = null;
let _cronoBreathStartedAt = 0;
let _cronoBreathEndsAt = 0;
let _cronoBreathPhaseKey = '';
// Para tarjetas fusionadas (varias sub-sesiones de la misma obra/movimiento).
// Cada planId puede acumular sub-sesiones: para productividad media ponderada
// por minutos, y para listar pasajes trabajados acumulados.
// sessionAggregate[planId] = { subsessions: [{min, prod, pasajes: [{id,nombre,intensidad}], timestamp}], pasajesAcum: Set }
const sessionAggregate = {};

function aggregateGetPasajes(planId) {
  // Devuelve un array de {id, nombre, intensidad} de los pasajes ya trabajados
  // en sub-sesiones anteriores de este planId.
  const ag = sessionAggregate[planId];
  if (!ag) return [];
  const map = {};
  (ag.subsessions || []).forEach(s => {
    (s.pasajes || []).forEach(p => {
      // Si se trabaja el mismo pasaje varias veces, nos quedamos con la última
      // intensidad para mostrar (pero los conservamos todos en historial real)
      map[p.id] = { id: p.id, nombre: p.nombre, intensidad: p.intensidad };
    });
  });
  return Object.values(map);
}

function aggregateWeightedProd(planId) {
  // Productividad media ponderada por minutos a partir de las sub-sesiones
  const ag = sessionAggregate[planId];
  if (!ag || !ag.subsessions || !ag.subsessions.length) return null;
  let totalMin = 0, sumProdMin = 0;
  ag.subsessions.forEach(s => {
    if (s.min > 0 && typeof s.prod === 'number') {
      totalMin += s.min;
      sumProdMin += s.min * s.prod;
    }
  });
  return totalMin > 0 ? Math.round(sumProdMin / totalMin) : null;
}

const DRAFT_KEY = 'alberto_session_draft';

function saveDraft() {
  const notes = {}, mins = {}, sols = {}, prods = {};
  currentPlan.forEach(o => {
    const pid = o._planId || o.id;
    const n = document.getElementById('tnote-' + pid);
    const m = document.getElementById('tmin-' + pid);
    if (n) notes[pid] = n.value;
    if (m) mins[pid] = m.value;
    if (sessionSolRatings[pid]) sols[pid] = sessionSolRatings[pid];
    if (sessionProductivityRatings[pid] != null) prods[pid] = sessionProductivityRatings[pid];
  });
  const draft = {
    date: new Date().toDateString(),
    energia: selectedEnergy,
    time: selectedTime,
    // Store full entity descriptors so we can restore movement plan items
    plan: currentPlan.map(o => ({
      planId: o._planId || o.id,
      obraId: o._obraId || o.id,
      movId: o._movId || null,
      isExtra: !!o._isExtra,
    })),
    ticks: { ...sessionTicks },
    minPlan: { ...sessionMinPlan },
    mins, notes, sols, prods,
    dests: JSON.parse(JSON.stringify(sessionDestello || {})),
    aggregate: JSON.parse(JSON.stringify(sessionAggregate || {})),
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

// Reconstruye currentPlan desde db.sesiones del día de hoy, en formato de
// tarjetas extras (fusionadas si hay múltiples items con misma obra/movimiento).
// Se llama tras loadDraft() cuando el draft está vacío — caso típico de app
// recién instalada / sincronización desde nube.
function restoreSessionFromDbToday(opts) {
  opts = opts || {};
  const force = !!opts.force;
  const today = new Date().toDateString();
  _currentPlanDay = today;
  const sesionHoy = (db.sesiones || []).find(s => new Date(s.date).toDateString() === today);
  if (!sesionHoy || !Array.isArray(sesionHoy.items) || !sesionHoy.items.length) {
    return false;
  }
  // Solo reconstruir si currentPlan está vacío, o si se fuerza.
  // (force=true lo usamos en onAuthSuccess para garantizar que el plan
  //  refleje siempre la nube tras una descarga, incluso si había draft local
  //  con datos antiguos.)
  if (!force && currentPlan && currentPlan.length > 0) return false;
  if (force) {
    // Reset completo del estado en memoria para no mezclar con cualquier
    // draft local antiguo que pudiera quedar.
    currentPlan = [];
    Object.keys(sessionTicks).forEach(k => delete sessionTicks[k]);
    Object.keys(sessionMinPlan).forEach(k => delete sessionMinPlan[k]);
    Object.keys(sessionSolRatings).forEach(k => delete sessionSolRatings[k]);
    Object.keys(sessionProductivityRatings).forEach(k => delete sessionProductivityRatings[k]);
    Object.keys(sessionDestello).forEach(k => delete sessionDestello[k]);
    Object.keys(sessionAggregate).forEach(k => delete sessionAggregate[k]);
  }

  // Si la sesión trae el aggregate auto-guardado, restaurarlo intacto y
  // reconstruir el plan a partir de sus claves planId.
  const hasAggregate = sesionHoy._aggregate && typeof sesionHoy._aggregate === 'object';

  // Agrupar por obra+mov para fusionar
  const groups = {};
  sesionHoy.items.forEach(it => {
    if (!it || !it.obraId) return;
    // Usamos el _planId original si existe para preservar agregados
    const planIdKey = it._planId || (it.obraId + '::' + (it.movId || ''));
    if (!groups[planIdKey]) {
      groups[planIdKey] = {
        planId: it._planId || null,
        obraId: it.obraId,
        movId: it.movId || null,
        studiedMin: 0,   // minutos realmente estudiados
        planMin: 0,      // estimación planificada (para mostrar la tarjeta sin contar)
        anyStudied: false,
        tick: it.tick || null,
        rating: it.rating || null,
        solRating: it.solRating || null,
        note: it.note || '',
        destello: !!it.destello,
        destelloNota: it.destelloNota || null,
        destelloBoosts: destelloBoosts(it),
        destelloHelpLog: destelloHelpLog(it),
        destelloHelpedAt: it.destelloHelpedAt || null,
      };
    }
    groups[planIdKey].planMin += parseInt(it.minutosPlan || it.minutosReales || 0) || 0;
    if (_itemEstudiado(it)) {
      groups[planIdKey].studiedMin += _itemMinReal(it);
      groups[planIdKey].anyStudied = true;
    }
    if (it.tick === 'hecho') groups[planIdKey].tick = 'hecho';
    if (it.rating != null) groups[planIdKey].rating = it.rating;
    if (it.solRating != null) groups[planIdKey].solRating = it.solRating;
    if (it.destello) {
      groups[planIdKey].destello = true;
      groups[planIdKey].destelloNota = it.destelloNota || groups[planIdKey].destelloNota || null;
      groups[planIdKey].destelloBoosts = Math.max(groups[planIdKey].destelloBoosts || 0, destelloBoosts(it));
      const log = destelloHelpLog(it);
      if (log.length) groups[planIdKey].destelloHelpLog = log;
      groups[planIdKey].destelloHelpedAt = it.destelloHelpedAt || groups[planIdKey].destelloHelpedAt || null;
    }
  });

  Object.values(groups).forEach(g => {
    const obra = findObra(g.obraId);
    if (!obra) return;
    // Conservar el planId original cuando exista para mantener el aggregate
    const planId = g.planId || ('restored_' + g.obraId + (g.movId ? '_' + g.movId : '') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    let entity;
    // _isExtra solo si de verdad se estudió: así una tarjeta planificada
    // restaurada de la nube no infla el "concentrado hoy".
    const esExtra = g.anyStudied;
    if (g.movId) {
      const mov = (obra.movimientos || []).find(m => m.id === g.movId);
      if (!mov) return;
      entity = Object.assign({}, mov, {
        _parentName: obra.name, composer: obra.composer,
        _planId: planId, _obraId: g.obraId, _movId: g.movId,
        _isMovimiento: true, _isExtra: esExtra, _displayName: mov.name,
      });
    } else {
      entity = Object.assign({}, obra, {
        _planId: planId, _obraId: g.obraId, _movId: null,
        _isMovimiento: false, _isExtra: esExtra, _displayName: obra.name,
      });
    }
    currentPlan.push(entity);
    sessionMinPlan[planId] = g.anyStudied ? g.studiedMin : g.planMin;
    if (g.tick) sessionTicks[planId] = g.tick;
    if (g.rating != null) sessionProductivityRatings[planId] = g.rating;
    if (g.solRating != null) sessionSolRatings[planId] = g.solRating;
    if (g.destello) sessionDestello[planId] = {
      on: true,
      nota: g.destelloNota || '',
      boosts: g.destelloBoosts || 0,
      level: destelloLevelFromBoosts(g.destelloBoosts || 0),
      helpLog: Array.isArray(g.destelloHelpLog) ? g.destelloHelpLog : [],
      helpedAt: g.destelloHelpedAt || null,
    };
  });

  // Restaurar aggregate completo si está disponible
  if (hasAggregate) {
    Object.keys(sesionHoy._aggregate).forEach(k => {
      sessionAggregate[k] = sesionHoy._aggregate[k];
    });
  }

  // Renderizar
  if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
  const planDiv = document.getElementById('sessionPlan');
  if (planDiv) {
    let html = '';
    currentPlan.forEach(e => {
      const pid = e._planId || e.id;
      html += renderExtraItem(e, sessionMinPlan[pid] || 0);
    });
    planDiv.innerHTML = html;
    planDiv.classList.add('visible');
    requestAnimationFrame(() => {
      currentPlan.forEach(e => {
        const pid = e._planId || e.id;
        if (sessionTicks[pid] === 'hecho') {
          const planEl = document.getElementById('plan-' + pid);
          const btn = planEl?.querySelector('.tick-btn');
          if (btn) btn.classList.add('hecho');
        }
        if (sessionProductivityRatings[pid] != null) {
          updateProductivityBadge(pid);
        }
        // Restaurar nota
        const noteEl = document.getElementById('tnote-' + pid);
        const item = (sesionHoy.items || []).find(it =>
          (it._planId === pid) ||
          ((it.obraId === (e._obraId || e.id)) && ((it.movId || null) === (e._movId || null)))
        );
        if (noteEl && item && item.note) noteEl.value = item.note;
      });
      if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
    });
  }
  // Persistir al draft local
  saveDraft();
  return true;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (draft.date !== new Date().toDateString()) {
      localStorage.removeItem(DRAFT_KEY);
      return false;
    }
    _currentPlanDay = draft.date;
    // Restore energy + time selection
    selectedEnergy = draft.energia || 'normal';
    selectedTime   = draft.time    || 2;
    document.querySelectorAll('.energy-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.energy === selectedEnergy);
    });
    if (typeof initTimeSlider === 'function') initTimeSlider();
    // Rebuild plan from stored descriptors (new format) or IDs (legacy)
    let planObras = [];
    if (draft.plan && draft.plan.length > 0 && typeof draft.plan[0] === 'object') {
      planObras = draft.plan.map(desc => {
        // ── Tarjetas del cronómetro (extras): reconstruir como extraEntity ──
        if (desc.isExtra) {
          const obra = findObra(desc.obraId);
          if (!obra) return null;
          if (desc.movId) {
            const mov = (obra.movimientos || []).find(m => m.id === desc.movId);
            if (!mov) return null;
            return Object.assign({}, mov, {
              _parentName: obra.name,
              composer: obra.composer,
              _planId: desc.planId,
              _obraId: desc.obraId,
              _movId: desc.movId,
              _isMovimiento: true,
              _isExtra: true,
              _displayName: mov.name,
            });
          } else {
            return Object.assign({}, obra, {
              _planId: desc.planId,
              _obraId: desc.obraId,
              _movId: null,
              _isMovimiento: false,
              _isExtra: true,
              _displayName: obra.name,
            });
          }
        }
        // ── Plan generado (no-extra) ──
        if (desc.movId) {
          const obra = findObra(desc.obraId);
          const mov = obra ? (obra.movimientos || []).find(m => m.id === desc.movId) : null;
          if (!obra || !mov) return null;
          const pid = desc.obraId + '__' + desc.movId;
          const syntheticSolHistory = (mov.solHistory && mov.solHistory.length)
            ? mov.solHistory
            : (mov.sol ? [{ date: new Date().toISOString(), val: mov.sol * 10, context: 'initial' }] : []);
          return {
            ...mov,
            _planId: pid, _obraId: desc.obraId, _movId: desc.movId,
            _isMovimiento: true, _parentName: obra.name,
            id: pid, composer: obra.composer,
            sol: mov.sol || 1, esc: mov.esc || 1,
            dificultad: mov.dificultad || obra.dificultad || 3,
            paseHistory: mov.paseHistory || [],
            solHistory: syntheticSolHistory,
            pasajes: [], origen: obra.origen,
          };
        } else {
          return findObra(desc.obraId);
        }
      }).filter(Boolean);
    } else {
      planObras = draft.plan.map(id => findObra(id)).filter(Boolean);
    }
    if (!planObras.length) return false;
    currentPlan = planObras;
    Object.assign(sessionTicks, draft.ticks || {});
    // Restaurar sessionAggregate (datos de sub-sesiones fusionadas)
    if (draft.aggregate) {
      Object.keys(draft.aggregate).forEach(k => {
        sessionAggregate[k] = draft.aggregate[k];
      });
    }
    _restoreDraftUI(draft);
    return true;
  } catch(e) { return false; }
}

function _restoreDraftUI(draft) {
  Object.assign(sessionMinPlan, draft.minPlan || {});
  Object.assign(sessionSolRatings, draft.sols || {});
  if (draft.dests) Object.assign(sessionDestello, draft.dests);
  // El estado diario (bienestar/sueño) se persiste de forma independiente vía
  // alberto_estado_v1 + db.estadoDiario con marca de fecha, y se carga en
  // loadEstadoDiarioFromSources() ANTES de loadDraft(). No restaurar aquí desde
  // draft.estado: el draft puede tener un estado más viejo (saveDraft no se
  // dispara al mover los sliders) y machacaría los valores correctos.
  const sesionHoy = db.sesiones.find(s => new Date(s.date).toDateString() === new Date().toDateString());
  const cargaHoy = sesionHoy ? 50 : 0;
  let html = '';
  currentPlan.forEach((entity, i) => {
    const pid = entity._planId || entity.id;
    if (entity._isExtra) {
      // Tarjeta del cronómetro (fusionada o no)
      html += renderExtraItem(entity, sessionMinPlan[pid] || 0);
    } else if (entity._isMovimiento) {
      html += renderMovimientoPlanItem(entity, i, sessionMinPlan[pid] || (entity.duracion || 20), selectedEnergy, cargaHoy);
    } else {
      html += renderTrabajoItem(entity, i, sessionMinPlan[pid] || 30, selectedEnergy, cargaHoy, analizarPases(entity._obraId || entity.id));
    }
  });
  html += _planActionsHTML();
  const planDiv = document.getElementById('sessionPlan');
  planDiv.innerHTML = html;
  planDiv.classList.add('visible');
  requestAnimationFrame(() => {
    currentPlan.forEach(entity => {
      const pid = entity._planId || entity.id;
      const tick = draft.ticks?.[pid];
      if (tick) {
        document.querySelectorAll('#sessionPlan .tick-row').forEach(r => {
          const btn = r.querySelector('.tick-btn[onclick*="' + pid + '"]');
          if (btn) {
            r.querySelectorAll('.tick-btn').forEach(b => b.classList.remove('hecho','parcial','saltado'));
            const target = r.querySelector('.tick-btn[onclick*="' + tick + '"]');
            if (target) target.classList.add(tick);
          }
        });
        if (tick === 'hecho') {
          const minRow = document.getElementById('tickmin-' + pid);
          if (minRow) minRow.style.display = 'flex';
          const minInp = document.getElementById('tmin-' + pid);
          if (minInp && draft.mins?.[pid]) minInp.value = draft.mins[pid];
        }
      }
      const noteEl = document.getElementById('tnote-' + pid);
      if (noteEl && draft.notes?.[pid]) noteEl.value = draft.notes[pid];
      // Restore productivity rating if present, and rebuild badge
      if (draft.prods?.[pid] != null) {
        sessionProductivityRatings[pid] = draft.prods[pid];
        if (typeof updateProductivityBadge === 'function') updateProductivityBadge(pid);
      }
    });
    if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
  });
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

function getLastTickForObra(obraId) {
  // Busca en sesiones guardadas el último tick para esta obra (no hoy)
  const hoy = new Date().toDateString();
  for (const s of db.sesiones) {
    if (new Date(s.date).toDateString() === hoy) continue;
    const item = (s.items || []).find(i => i.obraId === obraId);
    if (item) return item;
  }
  return null;
}

function getRecentTicksForObra(obraId, n) {
  const hoy = new Date().toDateString();
  return db.sesiones
    .filter(s => new Date(s.date).toDateString() !== hoy)
    .flatMap(s => (s.items||[]).filter(i => i.obraId === obraId))
    .slice(-n);
}

function setTick(planId, tick, btn, minPlan) {
  if (tick === 'hecho') {
    // Si ya estaba marcado hecho, reabrir el modal para EDITAR la sub-sesión.
    // Esto permite modificar pases (inicial/final), pasajes trabajados, fallo
    // de memoria, productividad — útil para tarjetas fusionadas donde quieres
    // añadir info tras varias sub-sesiones acumuladas.
    openHechoDatos(planId, minPlan, { editMode: sessionTicks[planId] === 'hecho' });
    return;
  }
  const row = btn.closest('.tick-row');
  row.querySelectorAll('.tick-btn').forEach(b => b.classList.remove('hecho','parcial','saltado'));
  btn.classList.add(tick);
  sessionTicks[planId] = tick;
  const minRow = document.getElementById('tickmin-' + planId);
  if (minRow) minRow.style.display = 'none';
  saveDraft();
}

 function saveSession() {
  if (!currentPlan.length) {
    showToast('No hay sesiones que guardar');
    return;
  }
  // Abrir el selector de fecha. Por defecto: hoy. Permite elegir otra fecha pasada.
  const dateInput = document.getElementById('saveDateInput');
  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.value = yyyy + '-' + mm + '-' + dd;
    dateInput.max = yyyy + '-' + mm + '-' + dd; // no permitir fechas futuras
  }
  // Resetear visibilidad del bloque "Otro día"
  const past = document.getElementById('saveDatePast');
  const other = document.getElementById('saveDateOtherBtn');
  if (past) past.style.display = 'none';
  if (other) other.style.display = '';
  openModal('modalSaveDate');
}

// Variante del flujo anterior, accesible desde el botón discreto del banner.
// Abre directamente la elección de fecha pasada (no "hoy" — para eso está
// el autoguardado).
function openSavePastDate() {
  openStudyRegister('history');
  return;
  if (!currentPlan.length) {
    showToast('No hay sesiones en el plan actual para registrar en otra fecha');
    return;
  }
  const dateInput = document.getElementById('saveDateInput');
  if (dateInput) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    // Por defecto ayer
    const yest = new Date(today.getTime() - 86400000);
    const yy2 = yest.getFullYear();
    const mm2 = String(yest.getMonth() + 1).padStart(2, '0');
    const dd2 = String(yest.getDate()).padStart(2, '0');
    dateInput.value = yy2 + '-' + mm2 + '-' + dd2;
    dateInput.max = yyyy + '-' + mm + '-' + dd;
  }
  // Mostrar directamente la sección de fecha pasada
  const past = document.getElementById('saveDatePast');
  const other = document.getElementById('saveDateOtherBtn');
  if (past) past.style.display = '';
  if (other) other.style.display = 'none';
  openModal('modalSaveDate');
}

// Llamado desde el modal de selección de fecha. mode = 'today' | 'past'
function confirmSaveDate(mode) {
  let targetDate;
  if (mode === 'past') {
    const v = document.getElementById('saveDateInput')?.value;
    if (!v) { showToast('Elige una fecha'); return; }
    // Construir Date local a las 12:00 del día elegido (evita problemas de zona horaria)
    const [y, m, d] = v.split('-').map(Number);
    targetDate = new Date(y, m - 1, d, 12, 0, 0);
    if (targetDate > new Date()) { showToast('No puedes usar una fecha futura'); return; }
  } else {
    targetDate = new Date();
  }
  closeModal('modalSaveDate');
  commitSession(targetDate);
}

// Lógica real de guardado. targetDate = Date object para registrar la sesión.
function commitSession(targetDate) {
  const items = currentPlan.map(entity => {
    const planId = entity._planId || entity.id;
    const obraId = entity._obraId || entity.id;
    const movId = entity._movId || null;
    const tickVal = sessionTicks[planId] || null;
    // Estudiado de verdad = vino del cronómetro (_isExtra) o se marcó hecho/parcial.
    // Las tarjetas planificadas que no se tocaron NO graban minutosReales.
    const estudiado = !!entity._isExtra || tickVal === 'hecho' || tickVal === 'parcial';
    const minRealInput = parseInt(document.getElementById('tmin-' + planId)?.value) || sessionMinPlan[planId] || null;
    const latestZone = latestZoneForPlan(planId, obraId, movId, entity);
    return {
      _planId: planId,
      obraId, movId,
      obraName: entity._isMovimiento
        ? entity._parentName + ' · ' + entity.name
        : entity.name,
      tick: tickVal,
      minutosPlan: sessionMinPlan[planId] || null,
      minutosReales: estudiado ? minRealInput : null,
      estudiado,
      solRating: null,
      rating: sessionProductivityRatings[planId] != null ? sessionProductivityRatings[planId] : null,
      note: document.getElementById('tnote-' + planId)?.value || '',
      destello: sessionDestello[planId]?.on ? true : false,
      destelloNota: sessionDestello[planId]?.nota || null,
      destelloBoosts: destelloBoosts(sessionDestello[planId]),
      destelloLevel: destelloLevelFromBoosts(destelloBoosts(sessionDestello[planId])),
      destelloHelpLog: destelloHelpLog(sessionDestello[planId]),
      destelloHelpedAt: sessionDestello[planId]?.helpedAt || null,
      zone: latestZone,
      zona: zoneSummaryText(latestZone),
      objetivo: ''
    };
  });
  // La solidez ya no se registra como dato suelto de sesión: entra por pases.

  const targetStr = targetDate.toDateString();
  const existingIdx = db.sesiones.findIndex(s => new Date(s.date).toDateString() === targetStr);

  if (existingIdx >= 0) {
    // FUSIONAR con la sesión que ya existe en esa fecha — mantenemos su
    // estado/energia (los sliders de la mañana, o los del día original)
    const existing = db.sesiones[existingIdx];
    if (!existing.items) existing.items = [];
    const merged = [...existing.items];
    items.forEach(newIt => {
      const idx = newIt._planId
        ? merged.findIndex(e => e._planId === newIt._planId)
        : -1;
      if (idx >= 0) merged[idx] = newIt;
      else merged.push(newIt);
    });
    existing.items = merged;
    const allRatings = merged.filter(i => i.rating != null).map(i => i.rating);
    existing.rating = allRatings.length
      ? Math.round(allRatings.reduce((s,v)=>s+v,0) / allRatings.length)
      : null;
    existing._aggregate = JSON.parse(JSON.stringify(sessionAggregate || {}));
  } else {
    // Primer guardado en esa fecha — capturamos snapshot de los sliders actuales
    const allRatings = items.filter(i => i.rating != null).map(i => i.rating);
    const avgRating = allRatings.length
      ? Math.round(allRatings.reduce((s,v)=>s+v,0) / allRatings.length)
      : null;
    const sesionObj = {
      date: targetDate.toISOString(),
      energia: selectedEnergy,
      estado: estadoSnapshot(),
      rating: avgRating,
      items,
      _aggregate: JSON.parse(JSON.stringify(sessionAggregate || {}))
    };
    // Insertar respetando orden cronológico (más reciente primero)
    const insertIdx = db.sesiones.findIndex(s => new Date(s.date) < targetDate);
    if (insertIdx === -1) db.sesiones.push(sesionObj);
    else db.sesiones.splice(insertIdx, 0, sesionObj);
    if (db.sesiones.length > 365) db.sesiones = db.sesiones.slice(0, 365);
  }

  saveData();
  saveDraft();
  renderRacha();
  if (typeof SFX !== 'undefined' && SFX.saveSession) SFX.saveSession();
  // Limpiar el draft solo si guardamos como hoy — si era de otro día, mantenemos
  // el draft activo por si Alberto sigue añadiendo sesiones de hoy.
  if (isToday) {
    // No limpiamos el plan visible: Alberto pidió que pueda seguir añadiendo
    // sesiones después de pulsar Guardar (ej. tarde tras guardar mañana).
    showToast('Sesión guardada ✓');
  } else {
    const niceDate = targetDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
    showToast('Guardado en ' + niceDate);
  }
  showSavedCheck();
  // Refrescar historial si está visible
  if (document.getElementById('view-historial')?.classList.contains('active')) {
    renderSesionesHistorial();
  }
}

let _sesionPendienteRating = null;

function ratingLabel(pct) {
  if (pct >= 90) return 'Sesión excepcional 🔥';
  if (pct >= 75) return 'Muy buena sesión';
  if (pct >= 55) return 'Sesión productiva';
  if (pct >= 40) return 'Regular, sin más';
  if (pct >= 20) return 'Sesión difícil';
  return 'No fue el día';
}

function updateRatingSlider(val) {
  const pct = parseInt(val);
  const col = solPctColor(pct);
  const d = document.getElementById('ratingDisplay');
  const l = document.getElementById('ratingLabel');
  const s = document.getElementById('ratingSlider');
  if (d) { d.textContent = pct; d.style.color = col; }
  if (l) l.textContent = ratingLabel(pct);
  fillSlider(s, col);
}

// Productivity rating slider inside hecho modal (per-session)
function updateHechoProd(val) {
  const pct = parseInt(val);
  const col = solPctColor(pct);
  const d = document.getElementById('hechoProdDisplay');
  const l = document.getElementById('hechoProdLabel');
  const s = document.getElementById('hechoProdSlider');
  if (d) { d.textContent = pct; d.style.color = col; }
  if (l) l.textContent = ratingLabel(pct);
  fillSlider(s, col);

  // Caja de destello: aparece al cruzar el umbral de excelencia. Al revelarla
  // por primera vez se autoselecciona la casilla; bajar del umbral la oculta.
  const box = document.getElementById('hechoDestelloBox');
  if (box) {
    const wasVisible = box.style.display !== 'none';
    const shouldShow = pct >= DESTELLO_UMBRAL;
    if (shouldShow && !wasVisible) {
      box.style.display = 'block';
      const chk = document.getElementById('hechoDestelloChk');
      if (chk) chk.checked = true;
      toggleHechoDestello(true);
      requestAnimationFrame(() => box.classList.add('on'));
    } else if (!shouldShow && wasVisible) {
      box.classList.remove('on');
      box.style.display = 'none';
    }
  }
}

// Muestra/oculta el campo de nota del destello según la casilla.
function toggleHechoDestello(on) {
  const box = document.getElementById('hechoDestelloBox');
  if (!box) return;
  if (on) {
    box.style.display = 'block';
    requestAnimationFrame(() => box.classList.add('on'));
  } else {
    box.classList.remove('on');
    box.style.display = 'none';
  }
}

// ── AUTO-SAVE DEL PLAN DE HOY ───────────────────────────────────────────────
// Tras cada sesión del cronómetro o cada cierre del modal Hecho, sincronizamos
// el currentPlan completo a db.sesiones[hoy] (creando o actualizando esa
// entrada) y disparamos saveData() → Supabase. Así las tarjetas viven en la
// nube en tiempo real, sin esperar a que el usuario pulse "Guardar sesión".
let _autoSaveTimeout = null;
function autoSaveTodayPlan() {
  // Debounce a 800ms para no martillear la red en cambios rápidos
  clearTimeout(_autoSaveTimeout);
  _autoSaveTimeout = setTimeout(_autoSaveTodayPlanNow, 800);
}

// ── RESET DIARIO ─────────────────────────────────────────────────────────────
// Cuando el día cambia (la app estaba abierta cruzando medianoche), limpiamos
// el plan en memoria, las estructuras de sesión, el draft local y refrescamos
// la UI. Las sesiones del día anterior YA están en db.sesiones[] con su
// fecha real, así que no se pierden — sólo se ocultan del "hoy".
function handleDayChange() {
  try {
    currentPlan = [];
    Object.keys(sessionTicks).forEach(k => delete sessionTicks[k]);
    Object.keys(sessionMinPlan).forEach(k => delete sessionMinPlan[k]);
    Object.keys(sessionSolRatings).forEach(k => delete sessionSolRatings[k]);
    Object.keys(sessionProductivityRatings).forEach(k => delete sessionProductivityRatings[k]);
    Object.keys(sessionDestello).forEach(k => delete sessionDestello[k]);
    Object.keys(sessionAggregate).forEach(k => delete sessionAggregate[k]);
    _currentPlanDay = new Date().toDateString();
    // Borrar el draft local (saveDraft pone date=hoy, así que loadDraft del día
    // siguiente lo descartaría — pero por limpieza lo borramos ahora)
    try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
    // ★ Resetear estado/sueño del día a default (70). Sólo persiste DURANTE el día.
    _estadoUserSet = false; // nuevo día: aún no lo ha introducido
    _suenoUserSet = false;
    _setEstadoAll(70);
    estadoDiario.sueno = 70;
    estadoDiario.deporte = null;
    estadoDiario.siestas = null;
    estadoDiario.triggers = null;
    estadoDiario.tiempoDisponible = null;
    saveEstadoDiario(); // guarda con la nueva fecha
    if (typeof initEstadoSliders === 'function') initEstadoSliders();
    // Limpiar el DOM del plan
    const planDiv = document.getElementById('sessionPlan');
    if (planDiv) {
      planDiv.innerHTML = '';
      planDiv.classList.remove('visible');
    }
    if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
    if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
    if (typeof renderRacha === 'function') renderRacha();
    // Programar siguiente comprobación de medianoche
    scheduleNextMidnightCheck();
  } catch(e) {
    console.warn('handleDayChange error:', e.message);
  }
}

// Programa una llamada a checkDayChange a la próxima medianoche local.
// Se reprograma sola tras disparar. También se ejecuta al volver a primer
// plano la app (visibilitychange) por si el setTimeout falló durmiéndose.
let _midnightTimer = null;
function scheduleNextMidnightCheck() {
  if (_midnightTimer) clearTimeout(_midnightTimer);
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 30, 0); // 00:00:30 para tener margen sobre la medianoche exacta
  const delay = next.getTime() - now.getTime();
  _midnightTimer = setTimeout(checkDayChange, delay);
}

// Comprueba si el día actual difiere del registrado en _currentPlanDay.
// Si difiere, dispara handleDayChange. Siempre reprograma el siguiente check.
function checkDayChange() {
  const todayStr = new Date().toDateString();
  if (_currentPlanDay !== todayStr) {
    handleDayChange();
  } else {
    scheduleNextMidnightCheck();
  }
}

// Registra una sub-sesión del cronómetro como entrada permanente en
// db.sessionPlants[], independiente del cap de db.sesiones[]. Esto permite
// hacer estadísticas históricas (horas por mes, picos diarios, etc.) sin
// perder timestamps cuando una sesión antigua sale de db.sesiones por edad.
function recordSessionPlant(obraId, movId, startedAt, endedAt, mins, opts) {
  if (!obraId || !startedAt || !endedAt) return null;
  if (!Array.isArray(db.sessionPlants)) db.sessionPlants = [];
  const options = opts || {};
  const entryId = options.id || (options.runId ? 'run_' + options.runId : 'plant_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
  // Dedup por ID/runId y, para datos antiguos, por obra + inicio.
  const byId = db.sessionPlants.find(p => p && (p.id === entryId || (options.runId && p.runId === options.runId)));
  if (byId) return byId;
  const exists = db.sessionPlants.some(p =>
    p.obraId === obraId && p.startedAt === startedAt
  );
  if (exists) return db.sessionPlants.find(p => p.obraId === obraId && p.startedAt === startedAt) || null;
  const entry = {
    id: entryId,
    obraId,
    movId: movId || null,
    startedAt,
    endedAt,
    mins: Math.max(0, Math.floor(mins || 0)),
    source: options.source || 'app',
  };
  if (options.runId) entry.runId = options.runId;
  if (options.tipo) entry.tipo = options.tipo;
  // Si la sesión es fallida, marcarla como tal. Esto
  // permite distinguir en estadísticas las sesiones exitosas de las fallidas.
  if (options.failed) entry.failed = true;
  const rawNotes = options.notes || options.sessionNotes;
  if (Array.isArray(rawNotes) && rawNotes.length) {
    const notes = rawNotes.map(cronoNormalizeSessionNote).filter(Boolean);
    if (notes.length) entry.notes = notes;
  }
  db.sessionPlants.push(entry);
  // Mantener orden cronológico
  db.sessionPlants.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  return entry;
}

// Transacción de finalización: crea el bloque, lo persiste localmente y sólo
// después permite abrir el modal de detalles. La red se encola aparte.
function finishStudyBlock(details) {
  const entry = recordSessionPlant(
    details.obraId,
    details.movId,
    details.startedAt,
    details.endedAt,
    details.mins,
    Object.assign({}, details.opts || {}, { runId: details.runId })
  );
  if (!entry) return { entry: null, persisted: false };
  try {
    saveLocalNow();
    refreshStudyViews();
    enqueueCloudSync();
    return { entry, persisted: true };
  } catch(e) {
    showToast('No se pudo guardar el tiempo en este dispositivo. Puedes reintentarlo.');
    return { entry, persisted: false, error: e };
  }
}
function _autoSaveTodayPlanNow() {
  try {
    if (!Array.isArray(currentPlan) || currentPlan.length === 0) {
      // Si no hay nada en el plan, no auto-guardamos (la sesión vacía no
      // tiene sentido). Si el usuario hizo todo y luego eliminó todas las
      // tarjetas, eso es algo que querría persistir? Por ahora no, lo
      // dejamos como está.
      return;
    }
    // ★ GUARDIAN DE FECHA: si el plan en memoria corresponde a un día anterior
    // (la app cruzó medianoche con sesión abierta), NO autoguardamos. En su
    // lugar disparamos un reset diario que limpia el plan y deja la pestaña
    // sesiones en cero. Las sesiones del día anterior ya están guardadas en
    // db.sesiones[] con su fecha real.
    const todayStr = new Date().toDateString();
    if (_currentPlanDay !== todayStr) {
      console.log('[crono] día cambió de', _currentPlanDay, 'a', todayStr, '— reset diario');
      handleDayChange();
      return;
    }
    const items = currentPlan.map(entity => {
      const planId = entity._planId || entity.id;
      const obraId = entity._obraId || entity.id;
      const movId = entity._movId || null;
      // Extraer hora de la primera y última sub-sesión, si existen
      const subs = (sessionAggregate[planId] && sessionAggregate[planId].subsessions) || [];
      const firstStartedAt = subs.length ? (subs[0].startedAt || subs[0].timestamp || null) : null;
      const lastEndedAt = subs.length ? (subs[subs.length - 1].endedAt || subs[subs.length - 1].timestamp || null) : null;
      const tickVal = sessionTicks[planId] || null;
      // Solo cuenta como tiempo estudiado si vino del cronómetro o se marcó
      // hecho/parcial. Las tarjetas planificadas no estudiadas no inflan horas.
      const estudiado = !!entity._isExtra || tickVal === 'hecho' || tickVal === 'parcial';
      const latestZone = latestZoneForPlan(planId, obraId, movId, entity);
      return {
        _planId: planId,
        obraId, movId,
        obraName: entity._isMovimiento
          ? (entity._parentName || '') + ' · ' + entity.name
          : (entity._displayName || entity.name),
        tick: tickVal,
        minutosPlan: sessionMinPlan[planId] || null,
        minutosReales: estudiado ? (sessionMinPlan[planId] || null) : null,
        estudiado,
        solRating: sessionSolRatings[planId] || null,
        rating: sessionProductivityRatings[planId] != null ? sessionProductivityRatings[planId] : null,
        note: document.getElementById('tnote-' + planId)?.value || '',
        destello: sessionDestello[planId]?.on ? true : false,
        destelloNota: sessionDestello[planId]?.nota || null,
        destelloBoosts: destelloBoosts(sessionDestello[planId]),
        destelloLevel: destelloLevelFromBoosts(destelloBoosts(sessionDestello[planId])),
        destelloHelpLog: destelloHelpLog(sessionDestello[planId]),
        destelloHelpedAt: sessionDestello[planId]?.helpedAt || null,
        startedAt: firstStartedAt,
        endedAt: lastEndedAt,
        zone: latestZone,
        zona: zoneSummaryText(latestZone),
        objetivo: ''
      };
    });
    const today = new Date();
    // (todayStr ya declarado en el guardian anterior)
    // Buscar sesión existente de hoy
    const existingIdx = db.sesiones.findIndex(s => new Date(s.date).toDateString() === todayStr);
    const existing = existingIdx >= 0 ? db.sesiones[existingIdx] : null;
    // ★ GUARDIAN DEFENSIVO: si la sesión existente tiene MÁS items de los que
    // tenemos en memoria, NO sobrescribir (sería pérdida de datos). Esto
    // protege contra timing en que currentPlan no se hubo restaurado del todo
    // antes del primer autoSave.
    if (existing && Array.isArray(existing.items) && existing.items.length > items.length) {
      console.warn('[autoSave] abortado: memoria (' + items.length + ') tiene menos items que db (' + existing.items.length + ')');
      return;
    }
    const sesion = {
      // ★ FIX: preservar la fecha original de la sesión cuando ya existía.
      // Si la pisamos con `today.toISOString()`, una sesión vieja podría
      // "viajar" a hoy en un autoguardado tardío.
      date: existing && existing.date ? existing.date : today.toISOString(),
      items,
      // ★ Estado diario: SIEMPRE incluir el estado actual del usuario.
      // Antes esto faltaba en autoSave y el `estado` se perdía con cada
      // autoguardado (porque el objeto nuevo machacaba al viejo). Resultado:
      // la gráfica de Bienestar/Sueño no tenía datos para mostrar.
      // Tomamos el valor más reciente conocido entre db.estadoDiario (nube)
      // y estadoDiario (memoria), pero priorizando la memoria por ser
      // posiblemente más fresca.
      estado: estadoSnapshot(),
      // Persistir el aggregate (sub-sesiones, pasajes) para reconstrucción
      _aggregate: JSON.parse(JSON.stringify(sessionAggregate || {})),
      _autoSaved: true,
      // Conservar rating si ya había uno guardado (formal)
      rating: existing && existing.rating != null ? existing.rating : null,
      ratingNota: existing && existing.ratingNota ? existing.ratingNota : null,
    };
    if (existingIdx >= 0) db.sesiones[existingIdx] = sesion;
    else db.sesiones.unshift(sesion);
    if (db.sesiones.length > 365) db.sesiones = db.sesiones.slice(0, 365);
    saveData(); // saveData ya hace debounce a Supabase
  } catch(e) {
    console.warn('autoSaveTodayPlan failed:', e.message);
  }
}

function openRatingSesion(sesionObj) {
  _sesionPendienteRating = sesionObj;
  const slider = document.getElementById('ratingSlider');
  if (slider) { slider.value = 70; updateRatingSlider(70); }
  const nota = document.getElementById('ratingNota');
  if (nota) nota.value = '';
  openModal('modalRatingSesion');
}

function closeRatingSesion(save) {
  closeModal('modalRatingSesion');
  if (!_sesionPendienteRating) return;
  if (save) {
    const pct = parseInt(document.getElementById('ratingSlider')?.value || 70);
    const nota = document.getElementById('ratingNota')?.value.trim() || '';
    _sesionPendienteRating.rating = pct;
    if (nota) _sesionPendienteRating.ratingNota = nota;
  }
  const today = new Date().toDateString();
  const isToday = _sesionPendienteRating.date
    && new Date(_sesionPendienteRating.date).toDateString() === today;
  db.sesiones = db.sesiones.filter(s => new Date(s.date).toDateString() !== today);
  db.sesiones.unshift(_sesionPendienteRating);
  if (db.sesiones.length > 365) db.sesiones = db.sesiones.slice(0, 365);
  _sesionPendienteRating = null;
  saveData();
  // Si la sesión es para HOY, conservamos el draft: las tarjetas siguen en
  // la pestaña de Sesión hasta que cambie el día. Si era para fecha pasada,
  // limpiamos el plan en curso.
  if (isToday) {
    saveDraft();
  } else {
    clearDraft();
    // Reset también las estructuras en memoria
    currentPlan = [];
    Object.keys(sessionTicks).forEach(k => delete sessionTicks[k]);
    Object.keys(sessionMinPlan).forEach(k => delete sessionMinPlan[k]);
    Object.keys(sessionSolRatings).forEach(k => delete sessionSolRatings[k]);
    Object.keys(sessionProductivityRatings).forEach(k => delete sessionProductivityRatings[k]);
    Object.keys(sessionDestello).forEach(k => delete sessionDestello[k]);
    Object.keys(sessionAggregate).forEach(k => delete sessionAggregate[k]);
    const planDiv = document.getElementById('sessionPlan');
    if (planDiv) { planDiv.innerHTML = ''; planDiv.classList.remove('visible'); }
  }
  renderRacha();
  refreshConcentradoUI();
  showToast('Sesión guardada ✓');
  showSavedCheck();
}


// ── EXTRA OBRAS ───────────────────────────────────────────────────────────────

function openAddExtra() {
  openStudyRegister('plan');
  return;
  const select = document.getElementById('extraObraSelect');
  const planIds = new Set(currentPlan.map(e => e._planId || e.id));

  const obras = (db.obras || []).sort((a, b) => a.name.localeCompare(b.name));
  let opts = '<option value="">— selecciona —</option>';

  obras.forEach(o => {
    const movs = (o.movimientos || []).filter(m => m.name);
    if (!movs.length) {
      // Obra sin movimientos — entrada directa
      const inPlan = currentPlan.some(e => (e._obraId || e.id) === o.id && !e._movId && !e._isExtra);
      opts += '<option value="obra::' + o.id + '"' + (inPlan ? ' style="color:var(--text3)"' : '') + '>'
        + o.name + (o.composer ? ' · ' + o.composer : '')
        + (inPlan ? ' (ya en plan)' : '') + '</option>';
    } else {
      // Obra con movimientos — mostrar como grupo con cada movimiento
      opts += '<option value="" disabled style="color:var(--text3);font-style:italic">── ' + o.name
        + (o.composer ? ' · ' + o.composer : '') + ' ──</option>';
      movs.forEach(m => {
        const inPlan = currentPlan.some(e => (e._obraId || e.id) === o.id && e._movId === m.id && !e._isExtra);
        opts += '<option value="mov::' + o.id + '::' + m.id + '"' + (inPlan ? ' style="color:var(--text3)"' : '') + '>'
          + '  ' + m.name + (m.duracion ? ' (' + m.duracion + ' min)' : '')
          + (inPlan ? ' (ya en plan)' : '') + '</option>';
      });
    }
  });

  select.innerHTML = opts;
  const minEl = document.getElementById('extraMinutos');
  if (minEl) minEl.value = '';
  openModal('modalExtraObra');
}

// HTML for the persistent action buttons that live inside #sessionPlan
function _planActionsHTML() {
  // El botón "Guardar sesión de hoy" se ha quitado: el autoguardado ya
  // persiste cada cambio automáticamente. La opción de registrar para un día
  // pasado sigue disponible desde el botón discreto junto al banner.
  return '<button class="add-extra-btn" id="btnAddExtra" onclick="openAddExtra()">＋ Añadir sesión</button>';
}

// Quita una tarjeta de la sesión actual. No afecta a sesiones ya guardadas en
// el historial (para eso se usa el editor de sesiones). Sólo modifica el plan
// vivo en pantalla y su draft.
function removeFromPlan(planId) {
  const idx = currentPlan.findIndex(e => (e._planId || e.id) === planId);
  if (idx < 0) return;
  const entity = currentPlan[idx];
  const name = entity._displayName || entity.name || 'la tarjeta';

  // Snapshot para deshacer (estado + DOM de la tarjeta)
  const el = document.getElementById('plan-' + planId);
  const snap = {
    entity, idx,
    html: el ? el.outerHTML : null,
    nextId: el && el.nextElementSibling ? el.nextElementSibling.id : null,
    note: document.getElementById('tnote-' + planId)?.value || '',
    tick: sessionTicks[planId],
    minPlan: sessionMinPlan[planId],
    sol: sessionSolRatings[planId],
    prod: sessionProductivityRatings[planId],
    agg: sessionAggregate[planId],
    dest: sessionDestello[planId],
  };

  // Eliminar del estado en memoria
  currentPlan = currentPlan.filter(e => (e._planId || e.id) !== planId);
  delete sessionTicks[planId];
  delete sessionMinPlan[planId];
  delete sessionSolRatings[planId];
  delete sessionProductivityRatings[planId];
  delete sessionAggregate[planId];
  delete sessionDestello[planId];

  // Quitar el DOM
  if (el) el.remove();

  saveDraft();
  ensureSessionPlanScaffold();
  refreshConcentradoUI();
  autoSaveTodayPlan();
  if (typeof SFX !== 'undefined' && SFX.del) SFX.del();
  showUndoToast('Quitado: ' + name, () => _undoRemoveFromPlan(planId, snap));
}

function _undoRemoveFromPlan(planId, snap) {
  if (currentPlan.some(e => (e._planId || e.id) === planId)) return;
  const at = Math.min(snap.idx, currentPlan.length);
  currentPlan.splice(at, 0, snap.entity);
  if (snap.tick !== undefined) sessionTicks[planId] = snap.tick;
  if (snap.minPlan !== undefined) sessionMinPlan[planId] = snap.minPlan;
  if (snap.sol !== undefined) sessionSolRatings[planId] = snap.sol;
  if (snap.prod !== undefined) sessionProductivityRatings[planId] = snap.prod;
  if (snap.agg !== undefined) sessionAggregate[planId] = snap.agg;
  if (snap.dest !== undefined) sessionDestello[planId] = snap.dest;

  const planDiv = document.getElementById('sessionPlan');
  if (planDiv && snap.html) {
    ensureSessionPlanScaffold();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = snap.html;
    const node = wrapper.firstElementChild;
    if (node) {
      const nextEl = snap.nextId ? document.getElementById(snap.nextId) : null;
      const addBtn = planDiv.querySelector('.add-extra-btn') || planDiv.querySelector('.save-session-btn');
      planDiv.insertBefore(node, nextEl || addBtn || null);
      const noteEl = document.getElementById('tnote-' + planId);
      if (noteEl) noteEl.value = snap.note || '';
      if (snap.tick === 'hecho') {
        const btn = node.querySelector('.tick-btn');
        if (btn) btn.classList.add('hecho');
      }
      if (sessionProductivityRatings[planId] != null && typeof updateProductivityBadge === 'function') {
        updateProductivityBadge(planId);
      }
    }
  }
  saveDraft();
  refreshConcentradoUI();
  autoSaveTodayPlan();
  showToast('Restaurado ✓');
}

// Ensures the action buttons are always present in #sessionPlan, even with no items
function ensureSessionPlanScaffold() {
  const planDiv = document.getElementById('sessionPlan');
  if (!planDiv) return;
  if (!planDiv.querySelector('.add-extra-btn')) {
    planDiv.insertAdjacentHTML('beforeend', _planActionsHTML());
  }
  // Hide save button when there are no plan items
  const saveBtn = planDiv.querySelector('.save-session-btn');
  if (saveBtn) {
    const hasItems = planDiv.querySelectorAll('.plan-item').length > 0;
    saveBtn.style.display = hasItems ? '' : 'none';
  }
}

function promotePlanEntityToExtra(entity, obra, mov, obraId, movId, displayName, planId) {
  const idx = currentPlan.indexOf(entity);
  const extra = Object.assign({}, entity, {
    _planId: planId,
    _obraId: obraId,
    _movId: movId || null,
    _isMovimiento: !!movId,
    _isExtra: true,
    _displayName: displayName || (mov ? mov.name : (obra?.name || entity.name || 'Obra')),
  });
  if (mov && !extra._parentName) extra._parentName = obra?.name || '';
  if (obra?.composer && !extra.composer) extra.composer = obra.composer;
  if (idx >= 0) currentPlan[idx] = extra;
  return extra;
}

function confirmAddExtra() {
  const val = document.getElementById('extraObraSelect')?.value;
  const minutos = parseInt(document.getElementById('extraMinutos')?.value) || 0;
  if (!val) { showToast('Selecciona una obra o movimiento'); return; }

  let obra, mov, displayName, obraId, movId;

  if (val.startsWith('mov::')) {
    const parts = val.split('::');
    obraId = parts[1]; movId = parts[2];
    obra = findObra(obraId);
    mov  = obra?.movimientos?.find(m => m.id === movId);
    if (!obra || !mov) return;
    displayName = obra.name + ' · ' + mov.name;
  } else {
    obraId = val.replace('obra::', '');
    obra = findObra(obraId);
    if (!obra) return;
    movId = null;
    displayName = obra.name;
  }

  closeModal('modalExtraObra');

  // ── FUSIÓN: buscar tarjeta existente de la misma obra/movimiento ─────
  // Si ya hay una tarjeta de esta misma obra y movimiento en el plan,
  // sumamos los minutos a la existente en lugar de crear otra. Misma
  // lógica que en cronoFinish.
  const existing = currentPlan.find(e =>
    (e._obraId || e.id) === obraId &&
    (e._movId || null) === (movId || null)
  );

  if (existing) {
    const targetPlanId = existing._planId || existing.id;
    const addMin = minutos || (mov?.duracion || obra?.duracion || 20);
    const wasExtra = !!existing._isExtra;
    const promoted = promotePlanEntityToExtra(existing, obra, mov, obraId, movId, displayName, targetPlanId);
    if (!wasExtra) {
      // Tarjeta planificada: reemplazar la estimación por el tiempo real.
      sessionMinPlan[targetPlanId] = addMin;
    } else {
      sessionMinPlan[targetPlanId] = (sessionMinPlan[targetPlanId] || 0) + addMin;
    }
    // Re-render la tarjeta con el total actualizado
    const planEl = document.getElementById('plan-' + targetPlanId);
    if (planEl) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderExtraItem(promoted, sessionMinPlan[targetPlanId]);
      if (wrapper.firstChild) planEl.replaceWith(wrapper.firstChild);
      // Conservar marca de "hecho" si la tenía
      if (sessionTicks[targetPlanId] === 'hecho') {
        const newBtn = document.querySelector('#plan-' + targetPlanId + ' .tick-btn');
        if (newBtn) newBtn.classList.add('hecho');
        if (typeof updateProductivityBadge === 'function') updateProductivityBadge(targetPlanId);
      }
    }
    SFX.add();
    saveDraft();
    refreshConcentradoUI();
    autoSaveTodayPlan();
    showToast('Sumado a la tarjeta existente');
    return;
  }

  // ── No existe: crear nueva tarjeta ──
  const extraId = 'extra_' + obraId + (movId ? '_' + movId : '') + '_' + Date.now();
  const baseEntity = movId ? { ...mov, _parentName: obra.name, composer: obra.composer } : { ...obra };

  const extraEntity = {
    ...baseEntity,
    _planId: extraId,
    _obraId: obraId,
    _movId: movId || null,
    _isMovimiento: !!movId,
    _isExtra: true,
    _displayName: displayName,
  };

  currentPlan.push(extraEntity);
  sessionMinPlan[extraId] = minutos || (mov?.duracion || obra?.duracion || 20);

  ensureSessionPlanScaffold();

  const planDiv = document.getElementById('sessionPlan');
  const addBtn  = planDiv.querySelector('.add-extra-btn');
  const saveBtn = planDiv.querySelector('.save-session-btn');

  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderExtraItem(extraEntity, sessionMinPlan[extraId]);
  planDiv.insertBefore(wrapper.firstChild, addBtn || saveBtn);

  ensureSessionPlanScaffold();

  SFX.add();
  saveDraft();
  refreshConcentradoUI();
  autoSaveTodayPlan();
}

function renderExtraItem(entity, minutos) {
  const planId  = entity._planId;
  const obraId  = entity._obraId || entity.id;
  const minPlan = minutos || 20;
  sessionMinPlan[planId] = minPlan;

  const displayName = entity._displayName || entity.name;
  const subName = entity._isMovimiento
    ? (entity._parentName || '') + ' · ' + entity.name
    : (entity.composer || '');

  // Si hay sub-sesiones acumuladas (tarjeta fusionada), mostrar lista pequeña
  // de pasajes trabajados acumulados al final.
  const subsessions = sessionAggregate[planId]?.subsessions || [];
  let fusionFooter = '';
  if (subsessions.length > 1) {
    const accPasajes = aggregateGetPasajes(planId);
    const intensidadIcon = { intenso: '🔥', normal: '●', superficial: '○' };
    const pasajesLine = accPasajes.length
      ? accPasajes.map(p => intensidadIcon[p.intensidad] + ' ' + p.nombre).join(' · ')
      : '';
    fusionFooter =
      '<div class="fusion-footer">' +
        '<span class="fusion-badge">' + subsessions.length + ' sesiones</span>' +
        (pasajesLine ? '<span class="fusion-pasajes">' + pasajesLine + '</span>' : '') +
      '</div>';
  }

  return '<div class="plan-item" id="plan-' + planId + '" style="border-left:2px solid var(--accent);opacity:0.95;position:relative">' +
    '<button class="plan-item-change" onclick="openChangePlanObra(\'' + planId + '\')" title="Cambiar la obra de esta tarjeta" aria-label="Cambiar obra">' +
      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 5 L11 5"/><path d="M8 2 L11 5 L8 8"/>' +
        '<path d="M12 9 L3 9"/><path d="M6 12 L3 9 L6 6"/>' +
      '</svg>' +
    '</button>' +
    '<button class="plan-item-remove" onclick="removeFromPlan(\'' + planId + '\')" title="Quitar de la sesión" aria-label="Quitar">×</button>' +
    '<div class="plan-item-top">' +
      '<div class="plan-item-num" style="color:var(--accent);font-size:10px">＋</div>' +
      '<div class="plan-item-content">' +
        '<div class="plan-item-name" onclick="openObraDetalleSession(\'' + obraId + '\')" style="cursor:pointer;text-decoration:underline dotted var(--border)">' +
          (entity._isMovimiento ? entity.name : displayName) +
          ' <span style="font-size:11px;color:var(--text3);font-style:italic">' + subName + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="plan-item-time editable" id="plan-time-' + planId + '" onclick="editPlanItemMin(\'' + planId + '\')" title="Tocar para editar los minutos">' + minPlan + ' min</div>' +
    '</div>' +
    '<div class="tick-row">' +
      '<button class="tick-btn" onclick="setTick(\'' + planId + '\',\'hecho\',this,' + minPlan + ')">✓ Hecho</button>' +
      (entity.tipo !== 'actividad' ? '<button class="tick-btn tick-pase-btn" onclick="registerPase(\'' + obraId + '\'' + (entity._movId ? ',\'' + entity._movId + '\'' : '') + ')">Pase</button>' : '') +
      '<input class="tick-note" id="tnote-' + planId + '" type="text" placeholder="nota...">' +
    '</div>' +
    fusionFooter +
  '</div>';
}

// Edición rápida de los minutos de una tarjeta de sesión, tocando el tiempo.
// Evita tener que ir al historial → Editar sesión para corregir un valor.
function editPlanItemMin(planId) {
  const el = document.getElementById('plan-time-' + planId);
  if (!el || el.querySelector('input')) return;
  const actual = sessionMinPlan[planId] || parseInt(el.textContent) || 0;
  el.classList.remove('editable');
  el.innerHTML = '<input class="plan-item-time-input" type="number" min="1" max="480" step="5" value="' + actual + '">';
  const input = el.querySelector('input');
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return; done = true;
    let v = parseInt(input.value);
    if (isNaN(v) || v < 1) v = actual;
    v = Math.min(480, v);
    sessionMinPlan[planId] = v;
    const entity = currentPlan.find(e => (e._planId || e.id) === planId);
    if (entity) entity._isExtra = true; // editar minutos reales = cuenta como estudiado
    const tminInp = document.getElementById('tmin-' + planId);
    if (tminInp) { tminInp.value = v; tminInp._touched = true; }
    el.textContent = v + ' min';
    el.classList.add('editable');
    refreshConcentradoUI();
    if (typeof saveDraft === 'function') saveDraft();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
    if (typeof SFX !== 'undefined' && SFX.tick) SFX.tick();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { done = true; el.textContent = actual + ' min'; el.classList.add('editable'); }
  });
}

// ── SISTEMA DE EVALUACIÓN: 3 ESCALAS ─────────────────────────────────────────
// apr = Aprendido (memoria + digitación)  1-10
// con = Consolidado (de arriba abajo sin parar mucho)  1-10
// per = Perfeccionado (bajo presión, con libertad)  1-10

// Derive apr (1-10) from compas percentage, or return stored value
function aprFromCompas(entity) {
  const total = entity.compasesTotal;
  const actual = entity.compasActual;
  if (total && total > 0 && actual !== undefined && actual !== null) {
    return Math.max(1, Math.min(10, Math.round((actual / total) * 10)));
  }
  return entity.apr || 1;
}

function compasPercent(entity) {
  const total = entity.compasesTotal;
  const actual = entity.compasActual;
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round(((actual || 0) / total) * 100));
}

function compasBarColor(pct) {
  return 'var(--orange)';
}

const _saveCompasTimers = {};
function debouncedSaveCompas(obraId, movId, field, val) {
  const key = (movId || '') + ':' + field;
  clearTimeout(_saveCompasTimers[key]);
  _saveCompasTimers[key] = setTimeout(() => saveCompas(obraId, movId, field, val), 700);
}

function saveCompas(obraId, movId, field, val) {
  const entity = movId ? findMovimiento(obraId, movId) : findObra(obraId);
  if (!entity) return;
  entity[field] = val ? parseInt(val) : null;
  entity.apr = aprFromCompas(entity);
  if (field === 'compasActual' && entity.compasActual != null && entity.compasesTotal) {
    if (!entity.compasHistory) entity.compasHistory = [];
    const minAcum = movId ? getMinutosMovimiento(obraId, movId) : getMinutosObra(obraId);
    const today = new Date().toDateString();
    const last = entity.compasHistory[0];
    if (last && new Date(last.date).toDateString() === today) {
      entity.compasHistory[0] = { date: new Date().toISOString(), compas: entity.compasActual, minAcum };
    } else {
      entity.compasHistory.unshift({ date: new Date().toISOString(), compas: entity.compasActual, minAcum });
      if (entity.compasHistory.length > 60) entity.compasHistory = entity.compasHistory.slice(0, 60);
    }
  }
  saveData();
  // Actualización quirúrgica de la barra (sin re-render del card completo,
  // para no destruir el input en el que el usuario puede seguir escribiendo).
  const elBase = movId ? 'mov-compas-' + obraId + '-' + movId : 'obra-compas-' + obraId;
  const pct = compasPercent(entity);
  const barColor = compasBarColor(pct);
  const pctStr = pct !== null ? pct + '%' : '—';
  const barW = pct !== null ? pct : 0;
  const barFillEl = document.getElementById(elBase + '-bar-fill');
  const pctEl     = document.getElementById(elBase + '-pct');
  if (barFillEl) { barFillEl.style.width = barW + '%'; barFillEl.style.background = barColor; }
  if (pctEl)     { pctEl.textContent = pctStr; pctEl.style.color = barColor; }
  if (typeof refreshObraMap === 'function') refreshObraMap(obraId);
}

// Marca una obra o movimiento como APRENDIDA al instante, saltando la fase de
// digitando sin tener que contar compases. Pone apr=10. Si ya hay compases
// totales, lleva el actual al total (100%) para que el % cuadre. Los compases
// se pueden ajustar después. Si la obra tiene movimientos, marca todos.
function marcarAprendida(obraId, movId) {
  const obra = findObra(obraId);
  if (!obra) return;
  const marcarEntidad = (e) => {
    if (!e) return;
    if (e.compasesTotal) e.compasActual = e.compasesTotal;
    e.apr = 10;
    if (e.estado === 'aprendiendo-inicial' || e.estado === 'aprendiendo') e.estado = 'consolidando';
  };
  if (!movId && Array.isArray(obra.movimientos) && obra.movimientos.length) {
    obra.movimientos.forEach(marcarEntidad);
  } else {
    marcarEntidad(movId ? findMovimiento(obraId, movId) : obra);
  }
  saveData();
  if (typeof rerenderObraCard === 'function') rerenderObraCard(obraId);
  showToast('Marcada como aprendida ✓');
  if (typeof SFX !== 'undefined' && SFX.tick) SFX.tick();
}

// ── MINUTOS ───────────────────────────────────────────────────────────────────

function fmtMinutos(min) {
  if (!min) return '0 min';
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
}

// ── TIEMPO REALMENTE ESTUDIADO ────────────────────────────────────────────────
// Un item de sesión cuenta como tiempo estudiado SOLO si de verdad se estudió:
//  - registro manual (registro directo), o
//  - vino del cronómetro / se marcó como estudiado (flag `estudiado`), o
//  - (datos antiguos sin flag) tiene tick 'hecho' o 'parcial'.
// Una tarjeta planificada que nunca se tocó (tick null/saltado) NO cuenta,
// aunque el generador le pusiera una estimación de minutos.
function _itemEstudiado(it) {
  if (!it) return false;
  if (it.manual) return true;
  if (it.estudiado === true) return true;
  if (it.estudiado === false) return false;
  return it.tick === 'hecho' || it.tick === 'parcial';
}

// Minutos realmente estudiados de un item (0 si no se estudió).
function _itemMinReal(it) {
  if (!_itemEstudiado(it)) return 0;
  return it.minutosEstudiados || it.minutosReales || it.minutosPlan || it.min || 0;
}

function getMinutosObra(obraId) {
  const obra = findObra(obraId);
  let total = obra ? (obra.minutosExtra || 0) : 0;
  (db.sesiones || []).forEach(s => {
    (s.items || []).forEach(it => {
      if (it.obraId !== obraId) return;
      if (it.manual && it.minutosEstudiados) total += it.minutosEstudiados;
      else if (it.tick === 'hecho' && it.minutosReales) total += it.minutosReales;
      else if (it.tick === 'hecho' && it.minutosPlan) total += it.minutosPlan;
    });
  });
  return total;
}

function getMinutosMovimiento(obraId, movId) {
  const obra = findObra(obraId);
  if (!obra) return 0;
  const mov = findMovimiento(obraId, movId);
  if (!mov || !mov.duracion) return getMinutosObra(obraId);
  const totalDur = (obra.movimientos || []).reduce((s, m) => s + (m.duracion || 0), 0) || obra.duracion || 1;
  return Math.round(getMinutosObra(obraId) * ((mov.duracion || 0) / totalDur));
}

function saveMinutosExtra(obraId, val) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra.minutosExtra = parseInt(val) || 0;
  saveData();
  const el = document.getElementById('minacum-display-' + obraId);
  if (el) el.textContent = fmtMinutos(getMinutosObra(obraId));
}

function saveMinutosExtraFlexible(obraId, val, unit) {
  const obra = findObra(obraId);
  if (!obra) return;
  const num = parseFloat(val) || 0;
  obra.minutosExtra = unit === 'h' ? Math.round(num * 60) : Math.round(num);
  saveData();
  const el = document.getElementById('minacum-display-' + obraId);
  if (el) el.textContent = fmtMinutos(getMinutosObra(obraId));
}

function renderMinutosWidget(obraId) {
  const obra = findObra(obraId);
  if (!obra) return '';
  let sesMin = 0;
  (db.sesiones || []).forEach(s => {
    (s.items || []).forEach(it => {
      if (it.obraId !== obraId) return;
      if (it.manual && it.minutosEstudiados) sesMin += it.minutosEstudiados;
      else if (it.tick === 'hecho' && it.minutosReales) sesMin += it.minutosReales;
      else if (it.tick === 'hecho' && it.minutosPlan) sesMin += it.minutosPlan;
    });
  });
  const extra = obra.minutosExtra || 0;
  const total = sesMin + extra;

  // Input: show hours as default unit if > 60 min stored
  const extraEnHoras = extra > 0 && extra % 60 === 0;
  const extraDisplay = extraEnHoras ? extra / 60 : extra;
  const extraUnit = extraEnHoras ? 'h' : 'min';

  return '<div class="minutos-widget">' +
    '<div class="minutos-widget-header"><span>⏱ Tiempo registrado</span>' +
    '<span id="minacum-display-' + obraId + '" style="color:var(--accent);font-family:\'Cormorant Garamond\',serif;font-size:18px">' + fmtMinutos(total) + '</span></div>' +
    '<details class="minutos-adjust-details">' +
    '<summary>Ajustar tiempo previo (Forest u otros)</summary>' +
    '<div style="font-size:9px;color:var(--text3);line-height:1.5;margin:6px 0 8px">Tiempo ya estudiado antes de usar la app. Se suma al total para que las estadísticas sean fieles a la realidad.</div>' +
    '<div style="display:flex;align-items:center;gap:6px">' +
    '<input type="number" min="0" max="99999" step="0.5" value="' + (extra > 0 ? extraDisplay : '') + '" placeholder="0"' +
    ' onblur="saveMinutosExtraFlexible(\'' + obraId + '\',this.value,this.dataset.unit)" data-unit="' + extraUnit + '"' +
    ' class="minutos-extra-input">' +
    '<select onchange="this.previousElementSibling.dataset.unit=this.value;saveMinutosExtraFlexible(\'' + obraId + '\',this.previousElementSibling.value,this.value)" style="background:var(--bg3);border:1px solid var(--border2);border-radius:4px;color:var(--text3);font-size:9px;padding:3px 4px">' +
    '<option value="min" ' + (extraUnit === 'min' ? 'selected' : '') + '>min</option>' +
    '<option value="h" ' + (extraUnit === 'h' ? 'selected' : '') + '>horas</option>' +
    '</select>' +
    '</div>' +
    '</details>' +
    '</div>';
}

// ── SOL / ESC HISTORY ─────────────────────────────────────────────────────────

function recordSolHistory(obraId, val, context, dateIso) {
  const obra = findObra(obraId);
  if (!obra || !val) return;
  const stamp = dateIso || new Date().toISOString();
  if (!obra.solHistory) obra.solHistory = [];
  const today = new Date(stamp).toDateString();
  const last = obra.solHistory[0];
  if (last && new Date(last.date).toDateString() === today && last.context === context) {
    obra.solHistory[0] = { date: stamp, val: parseInt(val), context };
  } else {
    obra.solHistory.unshift({ date: stamp, val: parseInt(val), context });
    if (obra.solHistory.length > 80) obra.solHistory = obra.solHistory.slice(0, 80);
  }
  obra.sol = parseInt(val);
  saveData();
}

function recordEscHistory(obraId, val, context, dateIso) {
  const obra = findObra(obraId);
  if (!obra || !val) return;
  const stamp = dateIso || new Date().toISOString();
  if (!obra.escHistory) obra.escHistory = [];
  const today = new Date(stamp).toDateString();
  const last = obra.escHistory[0];
  if (last && new Date(last.date).toDateString() === today && last.context === context) {
    obra.escHistory[0] = { date: stamp, val: parseInt(val), context };
  } else {
    obra.escHistory.unshift({ date: stamp, val: parseInt(val), context });
    if (obra.escHistory.length > 80) obra.escHistory = obra.escHistory.slice(0, 80);
  }
  obra.esc = parseInt(val);
  saveData();
}

function normalizePaseTipo(tipo) {
  if (tipo === 'evento' || tipo === 'escena' || tipo === 'concierto' || tipo === 'concurso' || tipo === 'audicion') return 'evento';
  if (tipo === 'informal') return 'informal';
  return 'solo';
}

function paseTipoShort(tipo) {
  const t = normalizePaseTipo(tipo);
  if (t === 'evento') return 'evento';
  if (t === 'informal') return 'amigos';
  return 'solo';
}

function paseScoreToPct(score) {
  const s = Math.max(1, Math.min(10, parseInt(score || 0, 10) || 1));
  return Math.round((s - 1) / 9 * 100);
}

function linkPaseToTargetHistory(obraId, movId, score, tipo, dateIso) {
  const t = normalizePaseTipo(tipo);
  const pct = paseScoreToPct(score);
  const context = 'pase-' + t;
  if (movId) recordMovSolHistory(obraId, movId, pct, context, dateIso);
  else recordSolHistory(obraId, pct, context, dateIso);
  if (t === 'evento') recordEscHistory(obraId, pct, 'pase-evento', dateIso);
}

function linkPaseToHistory(obraId, score, tipo, dateIso) {
  linkPaseToTargetHistory(obraId, null, score, tipo, dateIso);
}

// ── DECAY MODEL ───────────────────────────────────────────────────────────────
//
// Values in solHistory are 0-100. Legacy values (1-10) are normalized on read.
function normalizeSolVal(v) {
  if (v == null) return 0;
  return v > 10 ? v : Math.round(v * 10);
}

// El modelo estima cuánto se "olvida" la solidez de una obra entre días sin
// tocarla. Combina cuatro fuentes de información:
//
//   1) Si la obra tiene historial propio suficiente → su propia velocidad
//      de olvido medida en gaps reales.
//   2) Si no la tiene → un "prior personal": la media de las velocidades
//      de olvido del resto de obras del usuario, en lugar de un valor fijo.
//      Esto hace que la app empiece adaptada a Alberto desde el primer día.
//   3) Un coeficiente de "robustez" propio de cada obra que combina:
//        · dificultad declarada
//        · horas totales invertidas (más horas → memoria más profunda)
//        · ciclos de recuperación detectados (efecto savings: cada
//          re-aprendizaje deja la obra más resistente al olvido)
//        · pases en contexto de escena/concierto (efecto testing real)
//   4) Un factor de estabilidad sobre el último valor: las solideces muy
//      altas caen más rápido en su primer tramo (zona alta es menos
//      estable que la media).
//
// Resultado final: rate adaptativa por obra, que se afina sola con el uso.

const DECAY_DEFAULT_PER_DAY = 1.7; // ~12%/sem en escala 0-100. Sólo se usa si
                                    // el usuario no tiene NINGUNA obra con
                                    // datos suficientes (estado inicial).

// Pura: tasa medida del propio historial, o null si no hay datos suficientes
function _computeRawDecayFromHistory(obra) {
  const hist = (obra.solHistory || []).slice().reverse().map(h => ({ ...h, val: normalizeSolVal(h.val) }));
  if (hist.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < hist.length; i++) {
    const dayGap = (new Date(hist[i].date) - new Date(hist[i-1].date)) / 86400000;
    const drop = hist[i-1].val - hist[i].val;
    if (dayGap >= 4 && drop > 0) gaps.push(drop / dayGap);
  }
  if (!gaps.length) return null;
  const rate = gaps.reduce((s, r) => s + r, 0) / gaps.length;
  return { rate: Math.max(0.5, Math.min(8, rate)), puntos: gaps.length };
}

// Prior personal: media de tasas de olvido sobre todas las obras del usuario
// que tienen datos suficientes. Si no hay ninguna, cae al default global.
// Trimmed mean (descarta extremos) cuando hay >=5 obras, para robustez.
function computePersonalDecayPrior() {
  const rates = (db.obras || [])
    .map(o => _computeRawDecayFromHistory(o))
    .filter(r => r != null)
    .map(r => r.rate);
  if (!rates.length) return DECAY_DEFAULT_PER_DAY;
  if (rates.length >= 5) {
    rates.sort((a, b) => a - b);
    const trimmed = rates.slice(1, -1);
    return trimmed.reduce((s, r) => s + r, 0) / trimmed.length;
  }
  return rates.reduce((s, r) => s + r, 0) / rates.length;
}

// Detecta ciclos bajada-recuperación en el historial de solidez. Una caída
// significativa seguida del retorno cerca del pico previo cuenta como un
// ciclo de re-aprendizaje. Capturar esto importa porque la memoria motora
// se vuelve más resistente al olvido tras cada recuperación (efecto savings).
function _countRecoveryCycles(obra) {
  const hist = (obra.solHistory || []).slice().reverse(); // chronological
  if (hist.length < 4) return 0;
  let cycles = 0;
  let inDip = false;
  let peakBeforeDip = normalizeSolVal(hist[0].val);
  for (let i = 1; i < hist.length; i++) {
    const v = normalizeSolVal(hist[i].val);
    if (!inDip) {
      if (v < peakBeforeDip - 15) {
        inDip = true;
      } else {
        peakBeforeDip = Math.max(peakBeforeDip, v);
      }
    } else {
      if (v >= peakBeforeDip - 5) {
        cycles++;
        inDip = false;
        peakBeforeDip = v;
      }
    }
  }
  return cycles;
}

// Robustez de la obra. Multiplicador que se aplica al ritmo base de olvido.
// 1.0 = neutro · <1 = más resistente · >1 = más frágil. Limitado a [0.5, 1.5].
function computeRobustness(obra) {
  let m = 1.0;

  // Dificultad declarada (1 fácil → 5 difícil)
  const dif = obra.dificultad || 3;
  m *= 0.85 + (dif - 1) * (0.35 / 4); // dif=1 → 0.85, dif=5 → 1.20

  // Horas totales invertidas. Escala log: la diferencia entre 0 y 5 horas
  // importa más que entre 50 y 100 horas. Saturación natural.
  const horas = (typeof getMinutosObra === 'function' ? getMinutosObra(obra.id) : 0) / 60;
  m *= Math.max(0.7, 1.2 - 0.3 * Math.log10(1 + horas));

  // Ciclos de recuperación detectados (cada uno reduce el decaimiento ~10%)
  const recoveries = _countRecoveryCycles(obra);
  m *= Math.pow(0.9, Math.min(recoveries, 3));

  // Pases en escena/concierto (cada uno reduce el decaimiento ~5%, máx 5)
  const pasesEscena = (obra.solHistory || []).filter(h =>
    h.context === 'pase-escena' || h.context === 'pase-concierto' || h.context === 'pase-evento'
  ).length;
  m *= Math.pow(0.95, Math.min(pasesEscena, 5));

  return Math.max(0.5, Math.min(1.5, m));
}

function computeDecayRate(obra) {
  const own = _computeRawDecayFromHistory(obra);
  let baseRate, confianza, puntos, fuente;
  if (own) {
    baseRate = own.rate;
    confianza = Math.min(1, own.puntos / 5);
    puntos = own.puntos;
    fuente = 'propio';
  } else {
    baseRate = computePersonalDecayPrior();
    // Si el prior viene de obras del propio usuario, sube algo la confianza
    const personalDataExists = (db.obras || []).some(o => _computeRawDecayFromHistory(o) != null);
    confianza = personalDataExists ? 0.15 : 0.05;
    puntos = 0;
    fuente = personalDataExists ? 'prior-personal' : 'default';
  }
  const robustness = computeRobustness(obra);
  const finalRate = Math.max(0.3, Math.min(8, baseRate * robustness));
  return { rate: finalRate, confianza, puntos, robustness, baseRate, fuente };
}

function estimateSolActual(obra) {
  const hist = (obra.solHistory || []).map(h => ({ ...h, val: normalizeSolVal(h.val) }));
  const last = hist[0];
  if (!last) return { val: normalizeSolVal(obra.sol), diasGap: 0, decaying: false };
  const diasGap = (Date.now() - new Date(last.date)) / 86400000;
  if (diasGap < 2) return { val: last.val, diasGap: 0, decaying: false };
  const { rate } = computeDecayRate(obra);
  const stabilityFactor = 0.5 + (last.val / 100) * 0.5;
  const drop = diasGap * rate * stabilityFactor;
  return {
    val: Math.max(0, Math.round(last.val - drop)),
    lastKnown: last.val, diasGap: Math.round(diasGap),
    decaying: diasGap >= 4, drop: Math.round(drop),
    rate, lastDate: last.date,
  };
}

// ── PROYECCIÓN PARA OBRAS NUEVAS ──────────────────────────────────────────────
//
// Estima el rango de horas (mínimo, máximo) que le puede llevar al usuario:
//   1) Aprender todos los compases de una obra nueva.
//   2) Llevarla desde "aprendida" hasta "sólida" (sol >= 75).
//
// El método: mira las obras ya completadas del historial del propio usuario,
// identifica las que tienen perfil similar (dificultad y duración) y extrae
// minutos/compás reales de cada fase. Devuelve un rango con percentiles
// 25-75 ajustados por similitud.
//
// Clave: solo aparece cuando el usuario tiene >=4 obras con datos en una fase
// para que el rango tenga base estadística mínima.

// Resumen de cuánto tardó UNA obra concreta en cada fase, leyendo su historial.
// Devuelve { minAprender, minConsolidar } o null si la obra no llegó.
function _resumenObraFases(obra) {
  if (!obra) return null;
  if (!obra.compasesTotal || obra.compasesTotal <= 0) return null;

  const out = { minAprender: null, minConsolidar: null };

  // Fase 1: aprender. Buscar el primer punto del compasHistory donde
  // compas alcanza el total (en orden cronológico). minAcum en ese punto
  // es la respuesta directa.
  const histAsc = (obra.compasHistory || []).slice().reverse(); // chronological
  const punto = histAsc.find(p => p.compas >= obra.compasesTotal);
  let minAcumAprendido = null;
  let dateAprendido = null;
  if (punto && punto.minAcum) {
    minAcumAprendido = punto.minAcum;
    dateAprendido = punto.date;
    out.minAprender = punto.minAcum;
  }

  // Fase 2: consolidar. La obra se considera "sólida" cuando alcanza sol≥75.
  // Buscamos el primer punto del solHistory cronológico con val>=75 que
  // venga DESPUÉS de la fecha de aprendizaje. Los minutos invertidos en
  // consolidar = minTotal hasta esa fecha menos minAcumAprendido.
  if (dateAprendido && obra.solHistory?.length) {
    const solAsc = obra.solHistory.slice().reverse();
    const tAprendido = new Date(dateAprendido).getTime();
    const puntoSol = solAsc.find(s =>
      normalizeSolVal(s.val) >= 75 && new Date(s.date).getTime() > tAprendido
    );
    if (puntoSol) {
      // Sumar minutos en sesiones de la obra hasta esa fecha
      const tSol = new Date(puntoSol.date).getTime();
      let minTotalHastaSol = 0;
      (db.sesiones || []).forEach(s => {
        if (new Date(s.date).getTime() > tSol) return;
        (s.items || []).forEach(it => {
          if (it.obraId !== obra.id) return;
          if (it.manual && it.minutosEstudiados) minTotalHastaSol += it.minutosEstudiados;
          else if (it.tick === 'hecho' && it.minutosReales) minTotalHastaSol += it.minutosReales;
          else if (it.tick === 'hecho' && it.minutosPlan) minTotalHastaSol += it.minutosPlan;
        });
      });
      // Sumar minutosExtra que estuvieran ya antes (proxy)
      minTotalHastaSol += (obra.minutosExtra || 0);
      const minConsolidar = minTotalHastaSol - minAcumAprendido;
      if (minConsolidar > 0) out.minConsolidar = minConsolidar;
    }
  }

  return out;
}

// Calcula percentiles (p25, p50, p75) sobre un array de números
function _percentilesSimple(arr) {
  if (!arr.length) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const at = (p) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return { p25: at(0.25), p50: at(0.50), p75: at(0.75), n: sorted.length };
}

// Peso de similitud entre dos obras (1 = idéntica, 0 = muy distinta)
// Combina dificultad y duración (proxy de duración: compasesTotal o duracion).
function _similitud(obraTarget, obraRef) {
  const difT = obraTarget.dificultad || 3;
  const difR = obraRef.dificultad || 3;
  const wDif = Math.max(0, 1 - Math.abs(difT - difR) / 4);

  const compTarget = obraTarget.compasesTotal || 0;
  const compRef = obraRef.compasesTotal || 0;
  let wComp;
  if (compTarget > 0 && compRef > 0) {
    const ratio = Math.min(compTarget, compRef) / Math.max(compTarget, compRef);
    wComp = ratio; // 1 = igual, 0.5 = mitad/doble
  } else {
    wComp = 0.7; // sin datos → similitud neutra
  }

  // Pesado: dificultad importa más que duración exacta
  return 0.65 * wDif + 0.35 * wComp;
}

// Función principal: rango estimado para una obra nueva (típicamente sin
// historial) o para reconfirmar a una obra en marcha.
// Devuelve { aprender: {minH, maxH, minH_per, maxH_per, n, conf}, consolidar: {...} }
// o null si no hay datos suficientes.
function computeRangoEstimado(obra) {
  if (!obra) return null;
  const compasesTarget = obra.compasesTotal || 0;
  const out = { aprender: null, consolidar: null };

  // Recolectar datos de TODAS las obras del usuario que completaron cada fase
  const datosAprender = [];   // [{ minPorCompas, peso, obra }]
  const datosConsolidar = []; // [{ minTotal, peso, obra }]

  (db.obras || []).forEach(ref => {
    if (ref.id === obra.id) return; // no usar la propia obra como referencia
    const fases = _resumenObraFases(ref);
    if (!fases) return;
    if (fases.minAprender && ref.compasesTotal > 0) {
      const peso = _similitud(obra, ref);
      datosAprender.push({
        minPorCompas: fases.minAprender / ref.compasesTotal,
        peso, ref
      });
    }
    if (fases.minConsolidar) {
      const peso = _similitud(obra, ref);
      datosConsolidar.push({
        minTotal: fases.minConsolidar,
        peso, ref
      });
    }
  });

  // FASE APRENDER — escala por compases de la obra target
  if (datosAprender.length >= 4 && compasesTarget > 0) {
    // Usar percentiles ponderados por similitud: replicar cada dato según su peso
    const expandido = [];
    datosAprender.forEach(d => {
      const replicas = Math.max(1, Math.round(d.peso * 4)); // peso 1 → 4 réplicas, peso 0.25 → 1
      for (let i = 0; i < replicas; i++) expandido.push(d.minPorCompas);
    });
    const p = _percentilesSimple(expandido);
    if (p) {
      const minH = (p.p25 * compasesTarget) / 60;
      const maxH = (p.p75 * compasesTarget) / 60;
      out.aprender = {
        minH: Math.round(minH * 2) / 2,        // redondeo a 0.5h
        maxH: Math.round(maxH * 2) / 2,
        medianaH: Math.round((p.p50 * compasesTarget) / 60 * 2) / 2,
        minHPerCompas: p.p25,
        maxHPerCompas: p.p75,
        n: datosAprender.length,
        conf: Math.min(1, datosAprender.length / 8),
      };
    }
  }

  // FASE CONSOLIDAR — escala por minutos absolutos (no por compás, porque
  // consolidar depende más del número de pases que del tamaño)
  if (datosConsolidar.length >= 4) {
    const expandido = [];
    datosConsolidar.forEach(d => {
      const replicas = Math.max(1, Math.round(d.peso * 4));
      for (let i = 0; i < replicas; i++) expandido.push(d.minTotal);
    });
    const p = _percentilesSimple(expandido);
    if (p) {
      // Consolidar es muy variable según calidad de pase, escala dificultad ligeramente
      const difFactor = 0.85 + ((obra.dificultad || 3) - 1) * 0.075;
      out.consolidar = {
        minH: Math.round((p.p25 * difFactor) / 60 * 2) / 2,
        maxH: Math.round((p.p75 * difFactor) / 60 * 2) / 2,
        medianaH: Math.round((p.p50 * difFactor) / 60 * 2) / 2,
        n: datosConsolidar.length,
        conf: Math.min(1, datosConsolidar.length / 8),
      };
    }
  }

  return (out.aprender || out.consolidar) ? out : null;
}

function computeRecovery(obraId) {
  const obra = findObra(obraId);
  if (!obra) return null;
  const minTotal = getMinutosObra(obraId);
  const solEst = estimateSolActual(obra);
  const peakSol = obra.solHistory?.length ? Math.max(...obra.solHistory.map(h => normalizeSolVal(h.val))) : normalizeSolVal(obra.sol);
  if (minTotal < 30 || peakSol < 20) return null;
  const now = Date.now();
  const lastSesion = db.sesiones
    .filter(s => (s.items || []).some(it => it.obraId === obraId && it.tick !== 'saltado'))
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const diasSinPractica = lastSesion ? Math.round((now - new Date(lastSesion.date)) / 86400000) : null;
  if (!diasSinPractica || diasSinPractica < 14) return null;
  const horasBase = Math.min(minTotal / 60, 200);
  const savings = Math.min(0.85, 0.3 + (horasBase / 200) * 0.45 + (peakSol / 100) * 0.15);
  const degradacion = solEst.decaying ? Math.max(0.1, 1 - (solEst.val / Math.max(peakSol, 1))) : 0.1;
  return {
    diasSinPractica, peakSol, solActual: solEst.val,
    savings: Math.round(savings * 100),
    minRecuperacion: Math.round(minTotal * degradacion * (1 - savings)),
    degradacion: Math.round(degradacion * 100),
  };
}

// ─── SOL HISTORY CHART ───────────────────────────────────────────────────────

function renderSolChart(solHistRaw, escHistRaw, decayRate, solEst, sesiones, obraId, isPasaje) {
  // solHistRaw: [{date, val, context}] desc order
  // Builds a rich SVG showing the sawtooth pattern
  const hist = (solHistRaw || []).map(h => ({ ...h, val: normalizeSolVal(h.val) })).slice().reverse(); // asc
  if (hist.length < 1) return '';

  const W = 320, H = 140;
  const pad = { l: 28, r: 10, t: 10, b: 24 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;

  const now = Date.now();
  const minT = new Date(hist[0].date).getTime();
  const maxT = Math.max(now, new Date(hist[hist.length-1].date).getTime() + 86400000);
  const rangeT = maxT - minT || 1;

  const xOf = t => pad.l + ((t - minT) / rangeT) * cW;
  const yOf = v => pad.t + cH - Math.max(0, Math.min(cH, (Math.max(0, Math.min(100, v)) / 100) * cH));

  // ── Grid Y ──────────────────────────────────────────────────────────────────
  const gridY = [0, 25, 50, 75, 100].map(v => {
    const y = yOf(v);
    const isMain = v === 0 || v === 100 || v === 50;
    return '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W-pad.r) + '" y2="' + y + '" stroke="var(--border2)" stroke-width="' + (isMain ? 1 : 0.5) + '" stroke-dasharray="' + (isMain ? 'none' : '2,3') + '"/>'
      + '<text x="' + (pad.l-3) + '" y="' + (y+3) + '" text-anchor="end" font-size="7" fill="var(--text3)" font-family="monospace">' + v + '</text>';
  }).join('');

  // ── Session vertical lines from sesiones that included this obraId ──────────
  let sessionLines = '';
  if (!isPasaje && obraId && sesiones) {
    const sessionTs = (sesiones || [])
      .filter(s => (s.items||[]).some(it => it.obraId === obraId && it.tick === 'hecho'))
      .map(s => new Date(s.date).getTime())
      .filter(t => t >= minT && t <= maxT);
    sessionLines = sessionTs.map(t => {
      const x = xOf(t);
      return '<line x1="' + x + '" y1="' + pad.t + '" x2="' + x + '" y2="' + (pad.t+cH) + '" stroke="var(--accent)" stroke-width="1" opacity="0.18"/>';
    }).join('');
  }

  // ── Build enriched path: rise at session + decay between ─────────────────────
  // Between two consecutive sol points we draw:
  //  1. Vertical-ish rise from prev to current (same day = steep, multi-day = calculate)
  //  2. Then a decay curve from current to next known point
  const rate = decayRate || 1.7; // pts/day default

  let pathD = '';
  let decaySegs = ''; // dashed decay projections

  hist.forEach((pt, i) => {
    const x = xOf(new Date(pt.date).getTime());
    const y = yOf(pt.val);

    if (i === 0) {
      pathD += 'M' + x + ',' + y;
      return;
    }

    const prev = hist[i-1];
    const dayGap = (new Date(pt.date) - new Date(prev.date)) / 86400000;
    const xPrev = xOf(new Date(prev.date).getTime());

    if (dayGap < 0.5) {
      // Same session or same day → straight rise/fall
      pathD += ' L' + x + ',' + y;
    } else {
      // Multi-day gap: draw decay from prev, then jump to new session value
      const stabilityFactor = 0.5 + (prev.val / 100) * 0.5;
      const decayDrop = Math.min(prev.val - 1, dayGap * rate * stabilityFactor);
      const decayedY = yOf(Math.max(0, prev.val - decayDrop));
      const xMid = xOf(new Date(prev.date).getTime() + dayGap * 0.85 * 86400000);
      // Decay segment (dashed)
      decaySegs += '<path d="M' + xPrev + ',' + yOf(prev.val) + ' Q' + xMid + ',' + decayedY + ' ' + xOf(new Date(pt.date).getTime()) + ',' + decayedY + '" fill="none" stroke="var(--orange)" stroke-width="1.2" stroke-dasharray="3,2" opacity="0.5"/>';
      // Jump up to new value (session effect)
      pathD += ' M' + x + ',' + decayedY + ' L' + x + ',' + y;
    }
  });

  // Decay projection to now (if last point is old)
  if (solEst && solEst.decaying && hist.length) {
    const last = hist[hist.length-1];
    const xLast = xOf(new Date(last.date).getTime());
    const yLast = yOf(last.val);
    const yNow  = yOf(Math.max(0, solEst.val));
    decaySegs += '<path d="M' + xLast + ',' + yLast + ' L' + (W-pad.r) + ',' + yNow + '" fill="none" stroke="var(--orange)" stroke-width="1.2" stroke-dasharray="3,2" opacity="0.6"/>';
    // "Now" dot
    decaySegs += '<circle cx="' + (W-pad.r) + '" cy="' + yNow + '" r="3.5" fill="var(--orange)" opacity="0.7"><title>Estimado hoy: ' + Math.round(solEst.val) + '%</title></circle>';
    decaySegs += '<text x="' + (W-pad.r-2) + '" y="' + (yNow-6) + '" text-anchor="end" font-size="7" fill="var(--orange)" opacity="0.8">hoy~' + Math.round(solEst.val) + '%</text>';
  }

  // ── Esc overlay ──────────────────────────────────────────────────────────────
  const escHist = (escHistRaw || []).map(h => ({ ...h, val: normalizeSolVal(h.val) })).slice().reverse();
  let escLine = '';
  if (escHist.length >= 2) {
    const escD = escHist.map((p,i) => (i===0?'M':'L') + xOf(new Date(p.date).getTime()) + ',' + yOf(p.val)).join(' ');
    escLine = '<path d="' + escD + '" fill="none" stroke="var(--green)" stroke-width="1.5" opacity="0.6" stroke-linejoin="round"/>';
  }

  // ── Data dots ────────────────────────────────────────────────────────────────
  const dots = hist.map(p => {
    const x = xOf(new Date(p.date).getTime()), y = yOf(p.val);
    const col = SOL_COLOR;
    const d = new Date(p.date).toLocaleDateString('es-ES', { day:'numeric', month:'short' });
    return '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + col + '" stroke="var(--bg2)" stroke-width="1.5"><title>' + p.val + '% · ' + d + (p.context ? ' · ' + p.context : '') + '</title></circle>';
  }).join('');

  // ── X axis labels ────────────────────────────────────────────────────────────
  // Show date labels at each data point but only if not too crowded
  const showEvery = hist.length > 8 ? Math.ceil(hist.length / 6) : 1;
  const xLabels = hist
    .filter((_, i) => i === 0 || i === hist.length-1 || i % showEvery === 0)
    .map(p => {
      const x = xOf(new Date(p.date).getTime());
      const d = new Date(p.date);
      return '<text x="' + x + '" y="' + (H-4) + '" text-anchor="middle" font-size="6.5" fill="var(--text3)">' + d.getDate() + '/' + (d.getMonth()+1) + '</text>';
    }).join('');

  // Y axis label
  const yAxisLabel = '<text x="8" y="' + (pad.t + cH/2) + '" text-anchor="middle" font-size="6" fill="var(--text3)" transform="rotate(-90,8,' + (pad.t+cH/2) + ')">solidez %</text>';

  const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">'
    + gridY + sessionLines + yAxisLabel
    + decaySegs
    + '<path d="' + pathD + '" fill="none" stroke="' + SOL_COLOR + '" stroke-width="2" stroke-linejoin="round"/>'
    + escLine + dots + xLabels
    + '</svg>';

  const legend = '<div style="font-size:7px;color:var(--text3);display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;padding-left:' + pad.l + 'px">'
    + '<span style="color:' + SOL_COLOR + '">—— solidez</span>'
    + (escHist.length >= 2 ? '<span style="color:var(--green)">—— escena</span>' : '')
    + '<span style="color:var(--orange)">- - - decaimiento</span>'
    + (sessionLines ? '<span style="color:var(--accent)">│ sesiones</span>' : '')
    + '</div>';

  return svg + legend;
}

function renderPasajeSolChart(pasaje) {
  // Combines workHistory (solAntes/solDespues pairs) with any standalone solHistory
  const points = [];

  // From workHistory: add antes and despues as consecutive same-day points
  const workH = (pasaje.workHistory || []).slice().reverse(); // asc
  workH.forEach(w => {
    if (w.solAntes != null)   points.push({ date: w.date, val: w.solAntes,   type: 'antes',   intensidad: w.intensidad });
    if (w.solDespues != null) points.push({ date: w.date, val: w.solDespues, type: 'despues',  intensidad: w.intensidad });
  });
  // From solHistory (standalone measurements)
  (pasaje.solHistory || []).slice().reverse().forEach(h => {
    if (!points.some(p => Math.abs(new Date(p.date) - new Date(h.date)) < 3600000)) {
      points.push({ date: h.date, val: normalizeSolVal(h.val), type: 'standalone' });
    }
  });

  if (points.length < 2) return '';
  points.sort((a, b) => new Date(a.date) - new Date(b.date));

  const W = 300, H = 110;
  const pad = { l: 26, r: 8, t: 8, b: 22 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;

  const minT = new Date(points[0].date).getTime();
  const maxT = Math.max(Date.now(), new Date(points[points.length-1].date).getTime() + 86400000);
  const rangeT = maxT - minT || 1;

  const xOf = t => pad.l + ((t - minT) / rangeT) * cW;
  const yOf = v => pad.t + cH - (Math.max(0, Math.min(100, v)) / 100) * cH;

  const gridY = [0, 50, 100].map(v =>
    '<line x1="' + pad.l + '" y1="' + yOf(v) + '" x2="' + (W-pad.r) + '" y2="' + yOf(v) + '" stroke="var(--border2)" stroke-width="0.8" stroke-dasharray="2,2"/>'
    + '<text x="' + (pad.l-2) + '" y="' + (yOf(v)+3) + '" text-anchor="end" font-size="6" fill="var(--text3)">' + v + '</text>'
  ).join('');

  let pathD = '';
  const INTENSIDAD_COL = { intenso: 'var(--red)', normal: SOL_COLOR, superficial: 'var(--text3)', standalone: SOL_COLOR };

  points.forEach((pt, i) => {
    const x = xOf(new Date(pt.date).getTime()), y = yOf(pt.val);
    if (i === 0) { pathD += 'M' + x + ',' + y; return; }
    const prev = points[i-1];
    const sameDay = Math.abs(new Date(pt.date) - new Date(prev.date)) < 86400000;
    if (sameDay) {
      pathD += ' L' + x + ',' + y;
    } else {
      // small decay gap
      pathD += ' M' + x + ',' + y;
    }
  });

  // Session boxes (antes→despues pairs)
  let sessionBoxes = '';
  workH.forEach(w => {
    if (w.solAntes == null || w.solDespues == null) return;
    const x = xOf(new Date(w.date).getTime());
    const y1 = yOf(Math.max(w.solAntes, w.solDespues));
    const y2 = yOf(Math.min(w.solAntes, w.solDespues));
    const col = w.solDespues >= w.solAntes ? 'var(--green)' : 'var(--orange)';
    sessionBoxes += '<line x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + y2 + '" stroke="' + col + '" stroke-width="3" opacity="0.4"/>';
  });

  const dots = points.map(pt => {
    const x = xOf(new Date(pt.date).getTime()), y = yOf(pt.val);
    const col = pt.type === 'antes' ? 'var(--orange)' : pt.type === 'despues' ? 'var(--green)' : SOL_COLOR;
    const title = pt.val + '% · ' + new Date(pt.date).toLocaleDateString('es-ES', {day:'numeric',month:'short'}) + (pt.type !== 'standalone' ? ' · ' + pt.type : '');
    return '<circle cx="' + x + '" cy="' + y + '" r="3.5" fill="' + col + '" stroke="var(--bg2)" stroke-width="1"><title>' + title + '</title></circle>';
  }).join('');

  const showEvery = points.length > 6 ? Math.ceil(points.length / 5) : 1;
  const xLabels = points
    .filter((_, i) => i === 0 || i === points.length-1 || i % showEvery === 0)
    .map(p => {
      const d = new Date(p.date);
      return '<text x="' + xOf(d.getTime()) + '" y="' + (H-4) + '" text-anchor="middle" font-size="6" fill="var(--text3)">' + d.getDate() + '/' + (d.getMonth()+1) + '</text>';
    }).join('');

  const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">'
    + gridY + sessionBoxes
    + '<path d="' + pathD + '" fill="none" stroke="' + SOL_COLOR + '" stroke-width="1.5" stroke-linejoin="round"/>'
    + dots + xLabels
    + '</svg>'
    + '<div style="font-size:7px;color:var(--text3);display:flex;gap:8px;margin-top:3px;padding-left:' + pad.l + 'px">'
    + '<span style="color:var(--orange)">● antes</span><span style="color:var(--green)">● después</span><span>barra = cambio en sesión</span></div>';
  return svg;
}

function renderDecayWidget(obraId) {
  const obra = findObra(obraId);
  if (!obra) return '';
  const hist = obra.solHistory || [];
  const escHist = obra.escHistory || [];
  if (!hist.length && !escHist.length) return '';
  const solEst = estimateSolActual(obra);
  const decay = computeDecayRate(obra);
  const recovery = computeRecovery(obraId);
  const fmtSol = v => Math.round(v) + '%';
  const fmtM = m => m >= 60 ? Math.round(m / 6) / 10 + 'h' : m + 'min';

  let kpisHtml = '';
  if (hist.length) {
    const peakSol = Math.max(...hist.map(h => normalizeSolVal(h.val)));
    const lastEsc = escHist[0]?.val != null ? normalizeSolVal(escHist[0].val) : null;
    kpisHtml += '<div class="decay-kpi"><div class="decay-kpi-val" style="color:' + solPctColor(solEst.val) + '">' + fmtSol(solEst.val) + '</div><div class="decay-kpi-label">sol ' + (solEst.decaying ? 'estimada' : 'actual') + '</div></div>';
    kpisHtml += '<div class="decay-kpi"><div class="decay-kpi-val" style="color:var(--accent2)">' + peakSol + '%</div><div class="decay-kpi-label">sol max</div></div>';
    if (lastEsc !== null) kpisHtml += '<div class="decay-kpi"><div class="decay-kpi-val" style="color:var(--green)">' + lastEsc + '%</div><div class="decay-kpi-label">escena</div></div>';
    if (solEst.diasGap > 3) kpisHtml += '<div class="decay-kpi"><div class="decay-kpi-val" style="color:var(--orange)">' + solEst.diasGap + 'd</div><div class="decay-kpi-label">sin tocar</div></div>';
  }

  let alertHtml = '';
  if (recovery) {
    alertHtml = '<div class="decay-alert recover">💤 Sin práctica <strong>' + recovery.diasSinPractica + 'd</strong> · Sol estimada: <strong>' + fmtSol(recovery.solActual) + '</strong> (era ' + recovery.peakSol + ') · Recuperación: <strong>~' + fmtM(recovery.minRecuperacion) + '</strong> <span style="opacity:0.7">· ' + recovery.savings + '% ahorro vs cero</span></div>';
  } else if (solEst.decaying && solEst.drop >= 0.5) {
    const cls = solEst.drop >= 2 ? 'danger' : solEst.drop >= 1 ? 'warn' : 'ok';
    alertHtml = '<div class="decay-alert ' + cls + '">' + (cls === 'danger' ? '⚡' : '⚠') + ' ' + solEst.diasGap + 'd sin registrar · sol estimada: <strong>' + fmtSol(solEst.val) + '</strong> <span style="opacity:0.7">(−' + solEst.drop + 'pts)</span></div>';
  } else if (hist.length) {
    alertHtml = '<div class="decay-alert ok">✓ Sol estable · último registro hace ' + (solEst.diasGap || 0) + 'd</div>';
  }

  // Full chart (replaces small spark)
  const chartHtml = hist.length >= 2
    ? '<div class="decay-spark" style="margin-top:10px">' + renderSolChart(hist, escHist, decay.rate, solEst, db.sesiones, obraId, false) + '</div>'
    : '';

  // Etiqueta del modelo: indica si el ritmo de olvido viene de datos
  // propios de esta obra, de una media personal del usuario, o del default.
  let confLabel, confColor;
  if (decay.fuente === 'propio') {
    if (decay.confianza > 0.6) { confLabel = 'personalizado'; confColor = 'var(--green)'; }
    else { confLabel = 'aprendiendo'; confColor = 'var(--accent)'; }
  } else if (decay.fuente === 'prior-personal') {
    confLabel = 'media personal'; confColor = 'var(--accent)';
  } else {
    confLabel = 'estimado'; confColor = 'var(--orange)';
  }
  // Indicador de robustez: <1 obra resistente · >1 obra frágil
  const robTxt = decay.robustness < 0.85 ? ' · obra robusta'
                : decay.robustness > 1.15 ? ' · obra frágil'
                : '';
  const confHtml = (hist.length >= 1 || decay.fuente !== 'default')
    ? '<div class="decay-conf"><span>Modelo</span><div class="decay-conf-bar"><div class="decay-conf-fill" style="width:'
      + Math.round(Math.max(decay.confianza, 0.05) * 100) + '%;background:' + confColor
      + '"></div></div><span>' + confLabel + ' · ' + Math.round(decay.rate * 7) + 'pts/sem' + robTxt + '</span></div>'
    : '';

  return '<div class="decay-widget"><div class="decay-header"><span>🎯 Solidez &amp; escena</span></div><div class="decay-kpis">' + kpisHtml + '</div>' + alertHtml + chartHtml + confHtml + '</div>';
}

// ── PROYECCION ────────────────────────────────────────────────────────────────

function computeVelocidad(entity) {
  const hist = (entity.compasHistory || []).slice().reverse();
  if (hist.length < 2) return null;
  const pares = [];
  for (let i = 1; i < hist.length; i++) {
    const dC = hist[i].compas - hist[i-1].compas;
    const dM = (hist[i].minAcum || 0) - (hist[i-1].minAcum || 0);
    const dD = (new Date(hist[i].date) - new Date(hist[i-1].date)) / 86400000;
    if (dC > 0 && dM > 0) pares.push({ dC, dM, dD });
  }
  if (!pares.length) return null;
  const recent = pares.slice(-8);
  const totalC = recent.reduce((s, p) => s + p.dC, 0);
  const totalM = recent.reduce((s, p) => s + p.dM, 0);
  const totalD = recent.reduce((s, p) => s + p.dD, 0);
  return {
    minPorCompas: totalM / totalC,
    compasPerDia: totalD > 0 ? totalC / totalD : null,
    confianza: Math.min(1, recent.length / 6),
    puntos: recent.length,
  };
}

function getMediaMinutosDiariosObra(obraId, ventanaDias) {
  ventanaDias = ventanaDias || 14;
  const ahora = Date.now(), corte = ahora - ventanaDias * 86400000;
  let totalMin = 0;
  const diasSet = new Set();
  (db.sesiones || []).forEach(s => {
    if (new Date(s.date).getTime() < corte) return;
    (s.items || []).forEach(it => {
      if (it.obraId !== obraId) return;
      const m = it.manual ? (it.minutosEstudiados || 0) : (it.tick === 'hecho' ? (it.minutosReales || it.minutosPlan || 0) : 0);
      if (m > 0) { totalMin += m; diasSet.add(new Date(s.date).toDateString()); }
    });
  });
  return { minTotales: totalMin, diasActivos: diasSet.size, minPorDiaCalendario: totalMin / ventanaDias };
}

function computeProyeccion(obraId, movId) {
  const entity = movId ? findMovimiento(obraId, movId) : findObra(obraId);
  if (!entity || !entity.compasesTotal) return null;
  const restantes = entity.compasesTotal - (entity.compasActual || 0);
  if (restantes <= 0) return null;
  const vel = computeVelocidad(entity);
  const ritmo = movId ? null : getMediaMinutosDiariosObra(obraId);
  const urgObra = computeUrgencia(obraId);
  const deadline = urgObra && urgObra.nivel !== 'sin-evento' ? urgObra : null;
  const now = Date.now();
  let minRestantes = null, etaDias = null, etaFecha = null, minDiaNecesario = null, estadoDeadline = null, minDiaActual = null;
  if (vel) {
    minRestantes = Math.round(restantes * vel.minPorCompas);
    if (vel.compasPerDia && vel.compasPerDia > 0) {
      etaDias = Math.ceil(restantes / vel.compasPerDia);
      if (ritmo && ritmo.minPorDiaCalendario > 0) {
        const etaDiasMin = Math.ceil(restantes / (ritmo.minPorDiaCalendario / vel.minPorCompas));
        etaDias = Math.round((etaDias + etaDiasMin) / 2);
        minDiaActual = Math.round(ritmo.minPorDiaCalendario);
      }
      etaFecha = new Date(now + etaDias * 86400000);
    }
    if (deadline && deadline.dias > 0) {
      minDiaNecesario = Math.round(minRestantes / deadline.dias);
      const margen = deadline.dias - (etaDias || Infinity);
      estadoDeadline = margen >= 14 ? 'ok' : margen >= 0 ? 'warn' : 'danger';
    }
  }
  return { restantes, vel, minRestantes, etaDias, etaFecha, deadline, minDiaNecesario, minDiaActual, estadoDeadline, pct: compasPercent(entity) };
}

function renderProyeccionWidget(obraId, movId, entity) {
  if (!entity.compasesTotal || !entity.compasActual || entity.compasActual >= entity.compasesTotal) return '';
  const proj = computeProyeccion(obraId, movId);
  if (!proj) return '';
  const { vel, restantes, minRestantes, etaDias, etaFecha, deadline, minDiaNecesario, minDiaActual, estadoDeadline } = proj;
  const fmtF = d => d ? d.toLocaleDateString('es-ES', { day:'numeric', month:'short', year:'2-digit' }) : '—';
  const fmtM = m => m >= 60 ? Math.round(m/6)/10 + 'h' : m + 'min';

  let kpisHtml = '';
  if (vel) {
    kpisHtml += '<div class="proyeccion-kpi"><div class="proyeccion-kpi-val" style="color:var(--accent)">' + (vel.minPorCompas < 1 ? '<1' : Math.round(vel.minPorCompas)) + '</div><div class="proyeccion-kpi-label">min/compas</div></div>';
    kpisHtml += '<div class="proyeccion-kpi"><div class="proyeccion-kpi-val" style="color:var(--text2)">' + fmtM(minRestantes || 0) + '</div><div class="proyeccion-kpi-label">min restantes</div></div>';
    if (etaFecha) {
      const hoy = new Date(); hoy.setHours(0,0,0,0);
      kpisHtml += '<div class="proyeccion-kpi"><div class="proyeccion-kpi-val" style="color:var(--accent2)">' + Math.ceil((etaFecha-hoy)/86400000) + 'd</div><div class="proyeccion-kpi-label">ETA · ' + fmtF(etaFecha) + '</div></div>';
    }
    if (minDiaActual !== null) kpisHtml += '<div class="proyeccion-kpi"><div class="proyeccion-kpi-val" style="color:var(--text2)">' + minDiaActual + 'm</div><div class="proyeccion-kpi-label">ritmo/día</div></div>';
  } else {
    kpisHtml = '<div style="font-size:9px;color:var(--text3);padding:4px 0">Actualiza compases en más sesiones para ver la proyección.</div>';
  }

  let deadlineHtml = '';
  if (deadline && vel && minDiaNecesario !== null && minDiaActual !== null) {
    const cls = estadoDeadline || 'nodata';
    const icon = cls === 'ok' ? '✓' : cls === 'warn' ? '⚠' : '⚡';
    const diff = minDiaNecesario - minDiaActual;
    const diffTxt = diff > 0 ? 'necesitas <strong>+' + diff + 'min/día</strong>' : diff < 0 ? 'vas <strong>' + Math.abs(diff) + 'min/día</strong> adelantado' : 'ritmo exacto';
    deadlineHtml = '<div class="proyeccion-deadline ' + cls + '">' + icon + ' <strong>' + (deadline.evento?.nombre || 'Evento') + '</strong> · ' + deadline.dias + 'd · ' + minDiaNecesario + 'min/día — ' + diffTxt + '</div>';
  }

  let sparkHtml = '';
  const histAsc = (entity.compasHistory || []).slice().reverse();
  if (histAsc.length >= 2) {
    const W = 280, H = 44, pad = { l: 22, r: 8, t: 6, b: 14 };
    const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
    const maxC = entity.compasesTotal;
    const minT = new Date(histAsc[0].date).getTime(), maxT = Date.now(), rangeT = maxT - minT || 1;
    const xOf = d => pad.l + ((new Date(d).getTime() - minT) / rangeT) * cW;
    const yOf = c => pad.t + cH - (c / maxC) * cH;
    const lineD = histAsc.map((p, i) => (i===0?'M':'L') + xOf(p.date) + ',' + yOf(p.compas)).join(' ');
    let projLine = '';
    if (etaFecha && histAsc.length) {
      const lp = histAsc[histAsc.length-1];
      projLine = '<line x1="' + xOf(lp.date) + '" y1="' + yOf(lp.compas) + '" x2="' + Math.min(pad.l + ((etaFecha.getTime()-minT)/rangeT)*cW, W-pad.r) + '" y2="' + pad.t + '" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3,2" opacity="0.5"/>';
    }
    let dlLine = '';
    if (deadline?.evento) {
      const dT = new Date(deadline.evento.fecha).getTime();
      const xD = pad.l + ((dT - minT) / rangeT) * cW;
      if (xD >= pad.l && xD <= W - pad.r) dlLine = '<line x1="' + xD + '" y1="' + pad.t + '" x2="' + xD + '" y2="' + (pad.t+cH) + '" stroke="var(--red)" stroke-width="1" stroke-dasharray="2,2" opacity="0.5"/>';
    }
    const y100 = yOf(maxC);
    const grid100 = '<line x1="' + pad.l + '" y1="' + y100 + '" x2="' + (W-pad.r) + '" y2="' + y100 + '" stroke="var(--green)" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.4"/>';
    const dots = histAsc.map(p => '<circle cx="' + xOf(p.date) + '" cy="' + yOf(p.compas) + '" r="2.5" fill="var(--accent)" opacity="0.8"><title>cc.' + p.compas + '</title></circle>').join('');
    sparkHtml = '<div class="proyeccion-spark"><svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">' + grid100 + dlLine + '<path d="' + lineD + '" fill="none" stroke="var(--orange)" stroke-width="1.5" stroke-linejoin="round"/>' + projLine + dots + '</svg>' +
      '<div style="font-size:7px;color:var(--text3);margin-top:2px;display:flex;gap:10px;flex-wrap:wrap"><span><span style="color:var(--orange)">——</span> real</span>' + (projLine ? '<span><span style="color:var(--accent)">- - -</span> proyección</span>' : '') + (dlLine ? '<span><span style="color:var(--red)">|</span> deadline</span>' : '') + '</div></div>';
  }

  const confHtml = vel ? '<div class="proyeccion-conf"><span>Confianza</span><div class="proyeccion-conf-bar"><div class="proyeccion-conf-fill" style="width:' + Math.round(vel.confianza*100) + '%;background:' + (vel.confianza > 0.6 ? 'var(--green)' : vel.confianza > 0.3 ? 'var(--accent)' : 'var(--orange)') + '"></div></div><span>' + Math.round(vel.confianza*100) + '% · ' + vel.puntos + ' pts</span></div>' : '';

  return '<div class="proyeccion-widget"><div class="proyeccion-header">📈 Proyección · ' + restantes + ' cc. restantes</div><div class="proyeccion-kpis">' + kpisHtml + '</div>' + deadlineHtml + sparkHtml + confHtml + '</div>';
}

// Widget de rango estimado para obras NUEVAS (sin historial propio aún).
// Se basa en obras pasadas de dificultad y duración similar del propio
// usuario. Se oculta automáticamente cuando la obra ya tiene historial
// propio suficiente (entonces toma el relevo el widget de proyección).
function renderRangoWidget(obraId, entity) {
  if (!entity || !entity.compasesTotal) return '';

  // Si la obra ya tiene historial propio significativo, NO mostramos el
  // rango estimado: para entonces el widget de proyección personalizada
  // (renderProyeccionWidget) ya da una estimación más fiable.
  const histProp = (entity.compasHistory || []).length;
  if (histProp >= 3) return '';

  const rango = computeRangoEstimado(entity);
  if (!rango) return '';

  const fmtH = h => {
    if (h == null) return '—';
    if (h >= 10) return Math.round(h) + 'h';
    return (Math.round(h * 2) / 2) + 'h';
  };

  let rowsHtml = '';

  if (rango.aprender) {
    const a = rango.aprender;
    rowsHtml +=
      '<div class="rango-row">' +
        '<div class="rango-row-label">' +
          '<div class="rango-row-label-title">Aprender los compases</div>' +
          '<span style="color:var(--text3)">según ' + a.n + ' obras tuyas similares</span>' +
        '</div>' +
        '<div class="rango-row-val">' + fmtH(a.minH) + '<span class="rango-unit"> – ' + fmtH(a.maxH) + '</span></div>' +
      '</div>';
  }

  if (rango.consolidar) {
    const c = rango.consolidar;
    rowsHtml +=
      '<div class="rango-row">' +
        '<div class="rango-row-label">' +
          '<div class="rango-row-label-title">Hasta solidez de concierto</div>' +
          '<span style="color:var(--text3)">tras aprender · más variable</span>' +
        '</div>' +
        '<div class="rango-row-val">' + fmtH(c.minH) + '<span class="rango-unit"> – ' + fmtH(c.maxH) + '</span></div>' +
      '</div>';
  }

  if (!rowsHtml) return '';

  const footnote = (rango.consolidar && !rango.aprender)
    ? 'Estimación basada en tus obras pasadas. La fase de consolidar depende mucho de la calidad de los pases, no solo del tiempo.'
    : (rango.consolidar
        ? 'Estimación basada en tus obras pasadas. La fase de consolidar depende mucho de la calidad de los pases, no solo del tiempo.'
        : 'Estimación basada en tus obras pasadas con dificultad y duración similares.'
      );

  return '<div class="rango-widget">' +
    '<div class="rango-header"><span class="rango-header-icon">⌛</span>Estimación inicial</div>' +
    rowsHtml +
    '<div class="rango-footnote">' + footnote + '</div>' +
  '</div>';
}

// ── EFICIENCIA ────────────────────────────────────────────────────────────────

const DIF_FACTOR = d => Math.pow(1.25, (d || 3) - 1);

function computeEficienciaObras() {
  return (db.obras || []).map(obra => {
    const hist = obra.compasHistory || [];
    if (!hist.length || !obra.compasesTotal) return null;
    const histAsc = hist.slice().reverse();
    const comp = histAsc.find(h => h.compas >= obra.compasesTotal);
    if (!comp) return null;
    const minutos = comp.minAcum || getMinutosObra(obra.id);
    if (!minutos || minutos < 5) return null;
    const ef = minutos / (obra.compasesTotal * DIF_FACTOR(obra.dificultad || 3));
    return { id: obra.id, nombre: obra.name, composer: obra.composer, fechaCompletado: comp.date, minutos, dif: obra.dificultad || 3, cc: obra.compasesTotal, eficiencia: ef };
  }).filter(Boolean).sort((a, b) => new Date(a.fechaCompletado) - new Date(b.fechaCompletado));
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xM = xs.reduce((s,x)=>s+x,0)/n, yM = ys.reduce((s,y)=>s+y,0)/n;
  const sxx = xs.reduce((s,x)=>s+(x-xM)**2,0), sxy = xs.reduce((s,x,i)=>s+(x-xM)*(ys[i]-yM),0);
  if (!sxx) return null;
  const slope = sxy/sxx, intercept = yM - slope*xM;
  const sse = ys.reduce((s,y,i)=>s+(y-(slope*xs[i]+intercept))**2,0);
  const sst = ys.reduce((s,y)=>s+(y-yM)**2,0);
  return { slope, intercept, r2: sst > 0 ? 1 - sse/sst : 0, xMean: xM, yMean: yM };
}

function renderEficienciaSection() {
  const el = document.getElementById('eficienciaSection');
  if (!el) return;
  const datos = computeEficienciaObras();
  const N_MIN = 3;
  if (datos.length < N_MIN) {
    const faltan = N_MIN - datos.length;
    el.innerHTML = '<div class="efic-widget compact-empty"><div class="efic-header"><div><div class="efic-title">Aprendizaje</div><div class="efic-subtitle">Eficiencia por obra</div></div><span class="quiet-pill">' + datos.length + '/' + N_MIN + '</span></div>' +
      '<div class="efic-trend nodatos">Faltan <strong>' + faltan + '</strong> obra' + (faltan!==1?'s':'') + ' completada' + (faltan!==1?'s':'') + ' con compases.</div></div>';
    return;
  }
  const puntos = datos.map(d => ({ x: new Date(d.fechaCompletado).getTime(), y: d.eficiencia, label: d.nombre }));
  const reg = linearRegression(puntos);
  const slopePorMes = reg ? reg.slope * 30.44 * 86400000 : 0;
  const pctMes = reg ? (slopePorMes / reg.yMean) * 100 : 0;
  let tendencia = 'nodatos', icon = '📊', tLabel = 'Sin datos';
  if (reg) {
    if (pctMes < -3) { tendencia = 'mejora'; icon = '↗'; tLabel = 'Mejora ' + Math.abs(pctMes).toFixed(1) + '%/mes'; }
    else if (pctMes > 3) { tendencia = 'retroceso'; icon = '↘'; tLabel = '+' + pctMes.toFixed(1) + '%/mes'; }
    else { tendencia = 'estable'; icon = '→'; tLabel = 'Ritmo estable'; }
  }
  const efM = datos.reduce((s,d)=>s+d.eficiencia,0)/datos.length;
  const efU = datos.slice(-2).reduce((s,d)=>s+d.eficiencia,0)/Math.min(2,datos.length);
  const efP = datos.slice(0,2).reduce((s,d)=>s+d.eficiencia,0)/Math.min(2,datos.length);
  const mejP = efP > 0 ? ((efP-efU)/efP*100) : 0;
  const fmtE = v => Math.round(v*10)/10;
  const kpisHtml = '<div class="efic-kpi"><div class="efic-kpi-val" style="color:var(--accent)">' + fmtE(efM) + '</div><div class="efic-kpi-label">min/cc·dif</div></div>' +
    '<div class="efic-kpi"><div class="efic-kpi-val" style="color:' + (tendencia==='mejora'?'var(--green)':tendencia==='retroceso'?'var(--orange)':'var(--text2)') + '">' + icon + '</div><div class="efic-kpi-label">' + tLabel + '</div></div>' +
    '<div class="efic-kpi"><div class="efic-kpi-val" style="color:var(--text2)">' + datos.length + '</div><div class="efic-kpi-label">obras</div></div>' +
    (datos.length >= 4 ? '<div class="efic-kpi"><div class="efic-kpi-val" style="color:' + (mejP>0?'var(--green)':'var(--orange)') + '">' + (mejP>0?'+':'') + Math.round(mejP) + '%</div><div class="efic-kpi-label">vs primeras</div></div>' : '');

  let interpHtml = '';
  if (tendencia === 'mejora') interpHtml = '<div class="efic-trend mejora">↗ ' + icon + ' Cada mes tardas <strong>' + Math.abs(pctMes).toFixed(1) + '%</strong> menos por obra de la misma dificultad.' + (reg ? ' <span style="opacity:0.5">(R²=' + Math.round(reg.r2*100) + '%)</span>' : '') + '</div>';
  else if (tendencia === 'retroceso') interpHtml = '<div class="efic-trend retroceso">↘ Tiempo por compás normalizado aumentando. Obras más difíciles, fatiga, o cambio de método.' + (reg ? ' <span style="opacity:0.5">(R²=' + Math.round(reg.r2*100) + '%)</span>' : '') + '</div>';
  else if (tendencia === 'estable') interpHtml = '<div class="efic-trend estable">→ Eficiencia consistente entre obras.' + (reg ? ' <span style="opacity:0.5">(R²=' + Math.round(reg.r2*100) + '%)</span>' : '') + '</div>';

  let svgHtml = '';
  if (puntos.length >= 2) {
    const W = 320, H = 140, pad = { l:34, r:12, t:10, b:28 };
    const cW = W-pad.l-pad.r, cH = H-pad.t-pad.b;
    const ys2 = puntos.map(p=>p.y);
    const minY = Math.max(0, Math.min(...ys2)*0.8), maxY = Math.max(...ys2)*1.15;
    const minX = Math.min(...puntos.map(p=>p.x)), maxX = Math.max(Date.now(), Math.max(...puntos.map(p=>p.x)));
    const rX = maxX-minX||1, rY = maxY-minY||1;
    const xOf2 = x => pad.l+((x-minX)/rX)*cW, yOf2 = y => pad.t+cH-((y-minY)/rY)*cH;
    const grid2 = [0,1,2].map(i => { const v=minY+(rY/2)*i; const y=yOf2(v); return '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W-pad.r) + '" y2="' + y + '" stroke="var(--border2)" stroke-dasharray="2,3"/><text x="' + (pad.l-3) + '" y="' + (y+3) + '" text-anchor="end" font-size="7" fill="var(--text3)">' + fmtE(v) + '</text>'; }).join('');
    let trendLine2 = '';
    if (reg) {
      const col = tendencia==='mejora'?'var(--green)':tendencia==='retroceso'?'var(--orange)':'var(--text3)';
      const y0 = yOf2(Math.max(minY,Math.min(maxY,reg.slope*minX+reg.intercept)));
      const y1 = yOf2(Math.max(minY,Math.min(maxY,reg.slope*maxX+reg.intercept)));
      trendLine2 = '<line x1="' + xOf2(minX) + '" y1="' + y0 + '" x2="' + xOf2(maxX) + '" y2="' + y1 + '" stroke="' + col + '" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.6"/>';
    }
    const PALETTE = ['#c9a96e','#7ec89a','#e07060','#6090d8','#d08040','#a06ad8','#40b8a0'];
    const dots2 = puntos.map((p,i) => '<circle cx="' + xOf2(p.x) + '" cy="' + yOf2(p.y) + '" r="5" fill="' + PALETTE[i%PALETTE.length] + '" opacity="0.85" stroke="var(--bg2)" stroke-width="1.5"><title>' + p.label + ' · ' + fmtE(p.y) + '</title></circle>').join('');
    const xLbls = puntos.map((p,i) => { if(puntos.length>4&&i>0&&i<puntos.length-1&&i%2!==0)return''; const d=new Date(p.x); return '<text x="' + xOf2(p.x) + '" y="' + (H-4) + '" text-anchor="middle" font-size="7" fill="var(--text3)">' + d.getDate() + '/' + (d.getMonth()+1) + '</text>'; }).join('');
    svgHtml = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;margin-top:8px">' + grid2 + trendLine2 + dots2 + xLbls + '</svg>' +
      '<div style="font-size:7px;color:var(--text3);margin-top:3px">Cada punto = obra completada. Y = min/(compases × dificultad)</div>';
  }

  const maxEf = Math.max(...datos.map(d=>d.eficiencia));
  const obrasHtml = '<div class="efic-obras-list">' + datos.slice().sort((a,b)=>a.eficiencia-b.eficiencia).map((d,i) => {
    const pct = Math.round((d.eficiencia/maxEf)*100);
    const col = i===0?'var(--green)':i===datos.length-1?'var(--orange)':'var(--accent)';
    const fecha = new Date(d.fechaCompletado).toLocaleDateString('es-ES',{month:'short',year:'2-digit'});
    return '<div class="efic-obra-row"><span class="efic-obra-name">' + d.nombre + '</span><span style="font-size:7px;color:var(--text3);min-width:30px">' + fecha + '</span><span style="font-size:7px;color:var(--text3);min-width:20px">D' + d.dif + '</span><div class="efic-obra-bar-wrap"><div class="efic-obra-bar" style="width:' + pct + '%;background:' + col + '"></div></div><span class="efic-obra-val">' + fmtE(d.eficiencia) + '</span></div>';
  }).join('') + '</div>';

  el.innerHTML = '<div class="efic-widget"><div class="efic-header"><div><div class="efic-title">Aprendizaje</div><div class="efic-subtitle">Eficiencia por obra</div></div><span class="quiet-pill">' + datos.length + ' obras</span></div><div class="efic-kpis">' + kpisHtml + '</div>' + interpHtml + svgHtml + '<div class="quiet-section-label">Menor = más eficiente</div>' + obrasHtml + '</div>';
}

// ── FOREST IMPORT ─────────────────────────────────────────────────────────────

// -- SOLIDEZ DASHBOARD ------------------------------------------------------

function _solidezCurrentValue(hist, fallback) {
  if (hist && hist[0] && hist[0].val != null) return normalizeSolVal(hist[0].val);
  if (fallback != null && fallback > 1) return normalizeSolVal(fallback);
  return null;
}

function _solidezDaysSince(date) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function _solidezAgeLabel(days) {
  if (days == null) return 'sin historial';
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return 'hace ' + days + ' d';
}

function _solidezState(value) {
  if (value == null) return { key: 'none', label: 'Sin medir', color: 'var(--text3)' };
  if (value >= 80) return { key: 'solid', label: 'Solida', color: 'var(--green)' };
  if (value >= 60) return { key: 'stable', label: 'Estable', color: '#8aaa30' };
  if (value >= 40) return { key: 'fragile', label: 'Fragil', color: 'var(--accent)' };
  return { key: 'risk', label: 'Urgente', color: 'var(--orange)' };
}

function _solidezMakeItem(data) {
  const hist = data.hist || [];
  const value = _solidezCurrentValue(hist, data.fallback);
  const prev = hist[1] && hist[1].val != null ? normalizeSolVal(hist[1].val) : null;
  const days = _solidezDaysSince(hist[0]?.date);
  const delta = value != null && prev != null ? value - prev : null;
  return {
    ...data,
    value,
    prev,
    delta,
    days,
    lastDate: hist[0]?.date || null,
    state: _solidezState(value),
  };
}

function _solidezCollectTargets() {
  const items = [];
  (db.obras || []).forEach(obra => {
    if (!obra || obra.tipo === 'actividad') return;
    const obraColor = obraColorHex(obra) || 'var(--accent)';
    const obraHist = obra.solHistory || [];
    items.push(_solidezMakeItem({
      type: 'obra',
      obraId: obra.id,
      name: obra.name || 'Obra sin nombre',
      sub: obra.composer || 'Obra completa',
      color: obraColor,
      hist: obraHist,
      fallback: obra.sol,
    }));

    (obra.movimientos || []).forEach(mov => {
      items.push(_solidezMakeItem({
        type: 'mov',
        obraId: obra.id,
        movId: mov.id,
        name: mov.name || 'Movimiento',
        sub: obra.name || '',
        color: obraColor,
        hist: mov.solHistory || [],
        fallback: mov.sol,
      }));
    });

    (obra.pasajes || [])
      .filter(p => (p.status || 'activo') !== 'resuelto' || (p.solHistory && p.solHistory.length))
      .forEach(p => {
        items.push(_solidezMakeItem({
          type: 'pasaje',
          obraId: obra.id,
          pasajeId: p.id,
          name: p.text || 'Pasaje',
          sub: obra.name || '',
          color: obraColor,
          hist: p.solHistory || [],
          fallback: p.sol,
        }));
      });
  });
  return items.filter(Boolean);
}

function _solidezPriority(item) {
  const valueRisk = item.value == null ? 72 : Math.max(0, 100 - item.value);
  const staleRisk = item.days == null ? 18 : Math.min(30, item.days) * 0.8;
  const pasajeBoost = item.type === 'pasaje' ? 8 : 0;
  return valueRisk + staleRisk + pasajeBoost;
}

function _solidezOpenArgs(item) {
  const obraId = _quickSolJs(item.obraId || '');
  const movId = _quickSolJs(item.movId || '');
  const pasajeId = _quickSolJs(item.pasajeId || '');
  return "'" + obraId + "','" + movId + "','" + pasajeId + "'";
}

function _solidezRenderRow(item, compact) {
  const valueHtml = item.value == null ? '--' : item.value + '%';
  const valueColor = item.value == null ? 'var(--text3)' : solPctColor(item.value);
  const deltaHtml = item.delta == null
    ? ''
    : '<span class="sol-dash-delta ' + (item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : 'flat') + '">' +
      (item.delta > 0 ? '+' : '') + item.delta + '</span>';
  const typeLabel = item.type === 'pasaje' ? 'Pasaje' : item.type === 'mov' ? 'Movimiento' : 'Obra';
  return '<div class="sol-dash-row' + (compact ? ' compact' : '') + '">' +
    '<div class="sol-dash-main">' +
      '<span class="sol-dash-dot" style="background:' + (item.color || valueColor) + '"></span>' +
      '<div class="sol-dash-name-wrap">' +
        '<div class="sol-dash-name">' + escapeHtmlSafe(item.name) + '</div>' +
        '<div class="sol-dash-sub">' + escapeHtmlSafe(typeLabel + (item.sub ? ' - ' + item.sub : '')) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="sol-dash-meta">' +
      '<span class="sol-dash-state" style="color:' + item.state.color + ';border-color:' + item.state.color + '55">' + item.state.label + '</span>' +
      '<span class="sol-dash-age">' + _solidezAgeLabel(item.days) + '</span>' +
      '<span class="sol-dash-pct" style="color:' + valueColor + '">' + valueHtml + '</span>' +
      deltaHtml +
      '<button class="sol-dash-measure" onclick="registerPase(\'' + _quickSolJs(item.obraId || '') + '\'' + (item.movId ? ',\'' + _quickSolJs(item.movId) + '\'' : '') + ')">pase</button>' +
    '</div>' +
  '</div>';
}

function _solidezDistribution(measured) {
  const buckets = [
    { label: '0-39', count: measured.filter(i => i.value < 40).length, color: 'var(--orange)' },
    { label: '40-59', count: measured.filter(i => i.value >= 40 && i.value < 60).length, color: 'var(--accent)' },
    { label: '60-79', count: measured.filter(i => i.value >= 60 && i.value < 80).length, color: '#8aaa30' },
    { label: '80-100', count: measured.filter(i => i.value >= 80).length, color: 'var(--green)' },
  ];
  if (!measured.length) {
    return '<div class="sol-dash-distribution empty"><span>Registra un primer pase para activar el mapa.</span></div>';
  }
  const total = measured.length;
  const bar = buckets.map(b => {
    const pct = Math.max(3, Math.round((b.count / total) * 100));
    return '<div class="sol-dash-segment" style="width:' + pct + '%;background:' + b.color + '" title="' + b.label + ': ' + b.count + '"></div>';
  }).join('');
  const legend = buckets.map(b =>
    '<span><i style="background:' + b.color + '"></i>' + b.label + ' <strong>' + b.count + '</strong></span>'
  ).join('');
  return '<div class="sol-dash-distribution"><div class="sol-dash-bar">' + bar + '</div><div class="sol-dash-legend">' + legend + '</div></div>';
}

function renderSolidezSection() {
  const el = document.getElementById('solidezSection');
  if (!el) return;
  const items = _solidezCollectTargets();
  if (!items.length) {
    el.innerHTML = '<div class="sol-dash-widget empty"><div class="sol-dash-title">Solidez</div><div class="sol-dash-empty">Añade una obra para empezar a medir.</div></div>';
    return;
  }

  const measured = items.filter(i => i.value != null);
  const avg = measured.length ? Math.round(measured.reduce((s, i) => s + i.value, 0) / measured.length) : null;
  const fragiles = measured.filter(i => i.value < 60).length + items.filter(i => i.value == null).length;
  const recientes = measured.filter(i => i.days != null && i.days <= 7).length;
  const stale = measured.filter(i => i.days != null && i.days > 14).length;
  const recentRows = measured
    .filter(i => i.lastDate)
    .slice()
    .sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate))
    .slice(0, 4);
  let watchRows = items
    .filter(i => i.value == null || i.value < 65 || (i.days != null && i.days > 14))
    .slice()
    .sort((a, b) => _solidezPriority(b) - _solidezPriority(a))
    .slice(0, 4);
  if (!watchRows.length) {
    watchRows = items.slice().sort((a, b) => (a.value ?? 999) - (b.value ?? 999)).slice(0, 3);
  }
  const mainTarget = watchRows[0] || items[0];

  const kpis = '<div class="sol-dash-kpi"><strong>' + (avg == null ? '--' : avg + '%') + '</strong><span>media medida</span></div>' +
    '<div class="sol-dash-kpi"><strong>' + fragiles + '</strong><span>frágiles</span></div>' +
    '<div class="sol-dash-kpi"><strong>' + recientes + '</strong><span>7 días</span></div>' +
    '<div class="sol-dash-kpi"><strong>' + stale + '</strong><span>pendientes</span></div>';

  const watchHtml = watchRows.length
    ? watchRows.map(i => _solidezRenderRow(i, false)).join('')
    : '<div class="sol-dash-empty">Nada urgente ahora.</div>';
  const recentHtml = recentRows.length
    ? recentRows.map(i => _solidezRenderRow(i, true)).join('')
    : '<div class="sol-dash-empty">Aún no hay mediciones recientes.</div>';

  el.innerHTML = '<div class="sol-dash-widget">' +
    '<div class="sol-dash-header">' +
      '<div><div class="sol-dash-title">Solidez</div><div class="sol-dash-subtitle">Qué revisar ahora</div></div>' +
      '<button class="sol-dash-primary" onclick="registerPase(\'' + _quickSolJs(mainTarget.obraId || '') + '\'' + (mainTarget.movId ? ',\'' + _quickSolJs(mainTarget.movId) + '\'' : '') + ')">Registrar pase</button>' +
    '</div>' +
    '<div class="sol-dash-kpis">' + kpis + '</div>' +
    _solidezDistribution(measured) +
    '<div class="sol-dash-columns">' +
      '<div><div class="sol-dash-section-title">Prioridad</div>' + watchHtml + '</div>' +
      '<div><div class="sol-dash-section-title">Reciente</div>' + recentHtml + '</div>' +
    '</div>' +
  '</div>';
}

// ── RADAR DE MANTENIMIENTO ────────────────────────────────────────────────────
// Repertorio que ya alcanzaste sólido (≥70%) y que, si no lo tocas, irá cayendo.
// El decaimiento es lineal (drop/día = rate·stabilityFactor), así que podemos
// estimar en cuántos días caería por debajo del 70% y antes de qué fecha repasar.
const MAINT_FLOOR = 70;   // umbral "listo para tocar"
const MAINT_LEARNED = 70; // solo cuenta como repertorio si llegó a este nivel

function _mantenimientoItems() {
  const out = [];
  (db.obras || []).forEach(o => {
    if (!o || o.tipo === 'actividad') return;
    const hist = o.solHistory || [];
    if (!hist.length) return;
    const est = estimateSolActual(o);
    const lastKnown = (est.lastKnown != null) ? est.lastKnown : normalizeSolVal(hist[0].val);
    if (lastKnown < MAINT_LEARNED) return; // aún en construcción, no es mantenimiento
    const rate = (est.rate != null) ? est.rate : computeDecayRate(o).rate;
    const sf = 0.5 + (lastKnown / 100) * 0.5;
    const daily = Math.max(0.05, rate * sf); // puntos de solidez que pierde al día
    const cur = (est.val != null) ? est.val : lastKnown;
    const daysUntil = (cur - MAINT_FLOOR) / daily; // negativo = ya por debajo
    out.push({
      obraId: o.id, name: o.name || 'Obra', composer: o.composer || '',
      color: obraColorHex(o) || 'var(--accent)',
      cur, lastKnown, daysUntil, diasGap: est.diasGap || 0,
    });
  });
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}

function _maintFecha(daysFromNow) {
  const dt = new Date(Date.now() + Math.max(0, daysFromNow) * 86400000);
  return 'antes del ' + dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function _maintRow(it) {
  const cur = Math.max(0, Math.min(100, Math.round(it.cur)));
  const col = solPctColor(cur);
  const d = it.daysUntil;
  let lvl, txt;
  if (cur <= MAINT_FLOOR || d <= 0) { lvl = 'urgent'; txt = 'Por debajo de 70% · repásala ya'; }
  else if (d <= 5) { lvl = 'urgent'; txt = 'Cae de 70% en ~' + Math.round(d) + 'd · ' + _maintFecha(d); }
  else if (d <= 14) { lvl = 'warn'; txt = 'Cae de 70% en ~' + Math.round(d) + 'd · ' + _maintFecha(d); }
  else { lvl = 'ok'; txt = d >= 60 ? 'Estable · +2 meses de margen' : 'Estable · ~' + Math.round(d) + 'd de margen'; }
  return '<div class="maint-row ' + lvl + '">'
    + '<span class="maint-dot" style="background:' + it.color + '"></span>'
    + '<div class="maint-id"><div class="maint-name">' + escapeHtmlSafe(it.name) + '</div>'
    + '<div class="maint-sub">' + (it.composer ? escapeHtmlSafe(it.composer) + ' · ' : '') + txt + '</div></div>'
    + '<strong class="maint-pct" style="color:' + col + '">' + cur + '</strong>'
    + '<button class="maint-go" onclick="nudgeStudyNow(\'' + it.obraId + '\')" title="Repasar ahora">▶</button>'
    + '</div>';
}

function renderMantenimientoSection() {
  const el = document.getElementById('mantenimientoSection');
  if (!el) return;
  const items = _mantenimientoItems();
  if (!items.length) {
    el.innerHTML = '<div class="stats-card maint-card"><div class="stats-card-title">Mantenimiento del repertorio</div>'
      + '<div class="maint-empty">Cuando tengas obras consolidadas (medidas ≥ 70%), aquí te aviso antes de que se oxiden y la fecha límite para repasarlas.</div></div>';
    return;
  }
  const urgent = items.filter(i => i.cur <= MAINT_FLOOR || i.daysUntil <= 5).length;
  const head = urgent
    ? '<span class="maint-badge urgent">' + urgent + ' por repasar</span>'
    : '<span class="maint-badge ok">Todo al día</span>';
  const rows = items.slice(0, 8).map(_maintRow).join('');
  el.innerHTML = '<div class="stats-card maint-card">'
    + '<div class="maint-head"><div class="stats-card-title">Mantenimiento del repertorio</div>' + head + '</div>'
    + '<div class="maint-help">Antes de qué fecha repasar cada obra para que no baje del 70%.</div>'
    + rows + '</div>';
}

let forestTagData = [];
const FOREST_IGNORE_WORDS = ['general','otros','practica','solfeo','descanso'];
const FOREST_DRAFT_KEY = 'alberto_forest_draft';

function parseForestCSV(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/^"|"$/g,'').trim());
  const iS = header.indexOf('Start Time'), iE = header.indexOf('End Time');
  const iT = header.indexOf('Tag'), iO = header.indexOf('Is Success');
  const tagMap = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const cl = f => (f||'').replace(/^"|"$/g,'').trim();
    // Ahora aceptamos tanto plantas exitosas (True) como marchitadas (False).
    // Las marchitadas (sesiones fallidas <10min) se marcan con failed: true.
    const isSuccess = cl(parts[iO]) === 'True';
    const tag = cl(parts[iT]);
    if (!tag) continue;
    try {
      const startRaw = cl(parts[iS]);
      const endRaw = cl(parts[iE]);
      const start = new Date(startRaw), end = new Date(endRaw);
      const mins = (end - start) / 60000;
      if (mins <= 0 || mins > 480) continue;
      if (!tagMap[tag]) {
        tagMap[tag] = {
          minutos: 0, sessions: 0,
          first: start, last: start,
          plants: [],
        };
      }
      // El total de minutos y sesiones suma solo las exitosas (las marchitadas
      // no cuentan para el total "plantado"). Pero las guardamos todas como
      // plantas individuales para el histórico completo.
      if (isSuccess) {
        tagMap[tag].minutos += mins;
        tagMap[tag].sessions++;
      }
      if (start < tagMap[tag].first) tagMap[tag].first = start;
      if (start > tagMap[tag].last) tagMap[tag].last = start;
      const plant = {
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        mins: Math.round(mins),
      };
      if (!isSuccess) plant.failed = true;
      tagMap[tag].plants.push(plant);
    } catch(e) {}
  }
  return Object.entries(tagMap)
    .map(([tag, d]) => ({
      tag,
      minutos: Math.round(d.minutos),
      sessions: d.sessions,
      first: d.first,
      last: d.last,
      plants: d.plants,
    }))
    .sort((a, b) => b.minutos - a.minutos);
}

function fuzzyMatchForest(tag, obraName) {
  const norm = s => s.toLowerCase().replace(/[^\w ]/g,' ');
  const tagW = new Set(norm(tag).split(/\s+/).filter(w=>w.length>2));
  const obraW = new Set(norm(obraName).split(/\s+/).filter(w=>w.length>2));
  const shared = [...tagW].filter(w=>obraW.has(w)).length;
  return shared / Math.max(tagW.size, obraW.size, 1);
}

function suggestObraIdForest(tag) {
  let best = null, bestScore = 0;
  (db.obras||[]).forEach(o => {
    const s = Math.max(fuzzyMatchForest(tag, o.name), fuzzyMatchForest(tag, o.composer||''));
    if (s > bestScore) { bestScore = s; best = o.id; }
  });
  return bestScore >= 0.25 ? best : null;
}

function saveForestDraft() {
  // Save current selections so they survive closing the modal
  const sels = document.querySelectorAll('#forestMapList .forest-obra-select');
  const mapping = {};
  sels.forEach(sel => { mapping[sel.dataset.tag] = sel.value; });
  localStorage.setItem(FOREST_DRAFT_KEY, JSON.stringify({ tags: forestTagData, mapping }));
}

function loadForestCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      forestTagData = parseForestCSV(e.target.result);
      // Clear previous draft since we have a fresh CSV
      localStorage.removeItem(FOREST_DRAFT_KEY);
      const totalH = Math.round(forestTagData.reduce((s,t)=>s+t.minutos,0)/60);
      const fb = document.getElementById('forestFeedback');
      fb.textContent = '✓ ' + forestTagData.length + ' etiquetas · ' + totalH + 'h totales';
      fb.style.color = 'var(--green)'; fb.style.display = 'block';
      closeModal('modalSettings');
      openForestMapper();
    } catch(err) {
      const fb = document.getElementById('forestFeedback');
      fb.textContent = 'Error: ' + err.message;
      fb.style.color = 'var(--red)'; fb.style.display = 'block';
    }
    input.value = '';
  };
  reader.readAsText(file);
}

function openForestMapper() {
  // Try to restore from draft if no data in memory
  if (!forestTagData.length) {
    try {
      const saved = JSON.parse(localStorage.getItem(FOREST_DRAFT_KEY) || 'null');
      if (saved && saved.tags) forestTagData = saved.tags;
    } catch(e) {}
  }
  if (!forestTagData.length) { showToast('Carga primero un CSV de Forest'); return; }

  const obras = db.obras || [];
  const obraOptions = obras.map(o =>
    '<option value="' + o.id + '">' + o.name + (o.composer ? ' · ' + o.composer : '') + '</option>'
  ).join('');

  // Load saved mapping if any
  let savedMapping = {};
  try {
    const saved = JSON.parse(localStorage.getItem(FOREST_DRAFT_KEY) || 'null');
    if (saved && saved.mapping) savedMapping = saved.mapping;
  } catch(e) {}

  const rows = forestTagData.map(t => {
    const isIgnore = FOREST_IGNORE_WORDS.some(w => t.tag.toLowerCase().includes(w)) || t.minutos < 30;
    // Use saved mapping if available, otherwise auto-suggest
    const suggested = savedMapping[t.tag] !== undefined
      ? savedMapping[t.tag]
      : (isIgnore ? '__ignore__' : (suggestObraIdForest(t.tag) || '__ignore__'));
    return { ...t, suggested };
  });

  const renderRow = (r, note) => {
    const h = Math.floor(r.minutos/60), m = r.minutos%60;
    const timeStr = h>0 ? h+'h'+(m>0?m+'m':'') : r.minutos+'m';
    const fFirst = r.first ? new Date(r.first).getFullYear() : '';
    const fLast = r.last ? new Date(r.last).getFullYear() : '';
    const period = (fFirst && fLast && fFirst!==fLast) ? fFirst+'-'+fLast : (fFirst||'');
    const safeTag = r.tag.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const display = r.tag.length > 32 ? r.tag.slice(0,32)+'...' : r.tag;
    const noteHtml = note ? '<span style="font-size:8px;color:var(--orange);margin-left:6px">⚠ ' + note + '</span>' : '';
    return '<div class="forest-tag-row">' +
      '<div class="forest-tag-name" title="' + safeTag + '">' + display + noteHtml +
        (period ? '<span style="font-size:8px;color:var(--text3);margin-left:5px">' + period + '</span>' : '') +
      '</div>' +
      '<div class="forest-tag-hours">' + timeStr + '</div>' +
      '<select class="forest-obra-select" data-tag="' + safeTag + '" data-min="' + r.minutos + '">' +
        '<option value="__ignore__">— guardar para asignar después —</option>' +
        '<option value="__new__">+ nueva obra</option>' +
        obraOptions +
      '</select></div>';
  };

  const conSug = rows.filter(r => r.suggested !== '__ignore__');
  const sinSug = rows.filter(r => r.suggested === '__ignore__' && r.minutos >= 30);
  const tiny   = rows.filter(r => r.minutos < 30);

  let html = '';
  if (conSug.length) html += '<div class="forest-section-label">Con sugerencia — revisa cada una</div>' + conSug.map(r => renderRow(r, null)).join('');
  if (sinSug.length) html += '<div class="forest-section-label">Sin coincidencia — asigna o ignora (se guardan para retomar)</div>' + sinSug.map(r => renderRow(r, null)).join('');
  if (tiny.length) html += '<div class="forest-section-label" style="opacity:0.5">Menos de 30 min — ignoradas automáticamente (' + tiny.length + ')</div>';

  const container = document.getElementById('forestMapList');
  container.innerHTML = html;

  // Apply saved/suggested selections
  rows.forEach(r => {
    container.querySelectorAll('.forest-obra-select').forEach(sel => {
      if (sel.dataset.tag === r.tag || sel.dataset.tag === r.tag.replace(/&/g,'&amp;').replace(/"/g,'&quot;')) {
        if (r.suggested) sel.value = r.suggested;
      }
    });
  });

  const updateSummary = () => {
    let mapped = 0, totalMin = 0, ignored = 0;
    // Check for duplicates (multiple tags → same obra)
    const obraCount = {};
    container.querySelectorAll('.forest-obra-select').forEach(s => {
      if (s.value === '__ignore__') { ignored++; return; }
      if (s.value !== '__new__') obraCount[s.value] = (obraCount[s.value] || 0) + 1;
      mapped++;
      totalMin += parseInt(s.dataset.min)||0;
    });
    // Warn about duplicates inline
    container.querySelectorAll('.forest-obra-select').forEach(s => {
      const row = s.closest('.forest-tag-row');
      const existing = row.querySelector('.dup-warn');
      if (existing) existing.remove();
      if (s.value !== '__ignore__' && s.value !== '__new__' && obraCount[s.value] > 1) {
        const warn = document.createElement('span');
        warn.className = 'dup-warn';
        warn.style.cssText = 'font-size:8px;color:var(--orange);margin-left:6px';
        warn.textContent = '⚠ se sumarán (misma obra)';
        s.after(warn);
      }
    });
    document.getElementById('forestImportSummary').textContent =
      mapped + ' obras · ' + Math.round(totalMin/60) + 'h' + (ignored > 0 ? ' · ' + ignored + ' pendientes' : '');
    // Save draft on every change
    saveForestDraft();
  };

  container.querySelectorAll('.forest-obra-select').forEach(s => s.addEventListener('change', updateSummary));
  updateSummary();
  openModal('modalForestImport');
}

function confirmForestImport() {
  let imported = 0, totalMin = 0, totalPlants = 0;
  let pendientesCount = 0, pendientesMin = 0;
  if (!db.forestPlants) db.forestPlants = [];
  if (!db.forestPendientes) db.forestPendientes = [];
  document.querySelectorAll('#forestMapList .forest-obra-select').forEach(sel => {
    const obraId = sel.value, minutos = parseInt(sel.dataset.min)||0, tag = sel.dataset.tag;
    if (!minutos) return;
    // Recuperar la entrada original (con sus plants) del forestTagData
    const tagEntry = (forestTagData || []).find(t => t.tag === tag);
    const plants = (tagEntry && tagEntry.plants) ? tagEntry.plants : [];

    // ── PENDIENTE: la etiqueta queda en el armario (db.forestPendientes)
    // con todas sus plantas. Se podrá asignar después desde Ajustes.
    if (obraId === '__ignore__') {
      // Dedupe por tag+startedAt para no duplicar si se re-importa
      const existingStarts = new Set(
        db.forestPendientes
          .filter(p => p.tag === tag)
          .map(p => p.startedAt)
      );
      plants.forEach(pl => {
        if (existingStarts.has(pl.startedAt)) return;
        const entry = {
          tag,
          startedAt: pl.startedAt,
          endedAt: pl.endedAt,
          mins: pl.mins,
          source: 'forest',
          pending: true,
        };
        if (pl.failed) entry.failed = true;
        db.forestPendientes.push(entry);
      });
      pendientesCount++;
      pendientesMin += minutos;
      return;
    }

    let finalObraId;
    if (obraId === '__new__') {
      if (!db.obras) db.obras = [];
      finalObraId = 'f' + Date.now() + Math.random().toString(36).slice(2, 5);
      db.obras.push({
        id: finalObraId,
        name: tag, composer: '',
        origen: 'recuperacion', dificultad: 5, duracion: 10,
        apr: 1, sol: 1, esc: 1, lastPase: null,
        pasajes: [], notes: '', minutosExtra: minutos,
      });
    } else {
      finalObraId = obraId;
      const obra = findObra(obraId);
      if (obra) obra.minutosExtra = (obra.minutosExtra || 0) + minutos;
    }
    // Guardar plantas individuales con timestamps. Deduplicamos por startedAt:
    // si ya existe una planta importada con el mismo start, no la duplicamos
    // (permite re-importar el mismo CSV sin contar doble).
    const existingStarts = new Set(
      db.forestPlants
        .filter(p => p.obraId === finalObraId)
        .map(p => p.startedAt)
    );
    plants.forEach(pl => {
      if (existingStarts.has(pl.startedAt)) return;
      const entry = {
        obraId: finalObraId,
        startedAt: pl.startedAt,
        endedAt: pl.endedAt,
        mins: pl.mins,
        tag,
        source: 'forest',
      };
      if (pl.failed) entry.failed = true;
      db.forestPlants.push(entry);
      totalPlants++;
    });
    imported++; totalMin += minutos;
  });
  // Sort para tener todo cronológico (útil para queries futuras)
  db.forestPlants.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  saveForestDraft();
  saveData();
  closeModal('modalForestImport');
  const btn = document.getElementById('forestReopenBtn');
  if (btn) btn.style.display = 'block';
  showToast('Forest: ' + imported + ' obras · ' + Math.round(totalMin/60) + 'h · ' + totalPlants + ' sesiones' +
    (pendientesCount > 0 ? ' · ' + pendientesCount + ' pendientes' : '') + ' ✓');
  if (document.getElementById('view-obras').classList.contains('active')) renderObras();
  // Actualizar el botón de "etiquetas pendientes" en Ajustes
  if (typeof updateForestPendientesBtn === 'function') updateForestPendientesBtn();
}

// ── FOREST: GESTIÓN DE ETIQUETAS PENDIENTES (armario) ─────────────────────
// Etiquetas de Forest cuyo usuario NO asignó a una obra durante la importación.
// Sus plantas viven en db.forestPendientes[] con flag {pending: true} y un
// campo `tag` original. Desde aquí se pueden vincular o crear obras nuevas.

function getForestPendientesGrouped() {
  // Devuelve [{tag, totalMins, plantsCount, plants[]}], agrupado por etiqueta.
  if (!Array.isArray(db.forestPendientes)) return [];
  const map = {};
  db.forestPendientes.forEach(p => {
    if (!p.tag) return;
    if (!map[p.tag]) map[p.tag] = { tag: p.tag, totalMins: 0, plantsCount: 0, plants: [] };
    if (!p.failed) map[p.tag].totalMins += (p.mins || 0);
    map[p.tag].plantsCount++;
    map[p.tag].plants.push(p);
  });
  // Ordenar por minutos descendente (las más sustanciales arriba)
  return Object.values(map).sort((a, b) => b.totalMins - a.totalMins);
}

// Actualiza el contador del botón en Ajustes (visibilidad + N)
function updateForestPendientesBtn() {
  const btn = document.getElementById('forestPendientesBtn');
  const label = document.getElementById('forestPendientesBtnLabel');
  if (!btn || !label) return;
  const grupos = getForestPendientesGrouped();
  if (grupos.length === 0) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'flex';
  label.textContent = 'Etiquetas pendientes (' + grupos.length + ')';
}

function openForestPendientes() {
  renderForestPendientes();
  openModal('modalForestPendientes');
}

function renderForestPendientes() {
  const list = document.getElementById('forestPendientesList');
  if (!list) return;
  const grupos = getForestPendientesGrouped();
  if (!grupos.length) {
    list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-style:italic">No hay etiquetas pendientes.</div>';
    return;
  }
  // Construir <option>s con todas las obras existentes para los selectores
  const obras = (db.obras || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const obrasOptions = obras.map(o =>
    '<option value="' + o.id + '">' + (o.name || '?') + (o.composer && o.composer !== '—' ? ' · ' + o.composer : '') + '</option>'
  ).join('');

  list.innerHTML = grupos.map((g, idx) => {
    const horas = Math.floor(g.totalMins / 60);
    const mins = g.totalMins % 60;
    const horasTxt = horas > 0 ? horas + 'h' + (mins ? ' ' + mins + 'm' : '') : g.totalMins + ' min';
    const safeTag = String(g.tag).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    return '<div class="forest-pendiente-row" data-tag="' + safeTag + '" style="border:1px solid var(--border2);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--bg3)">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">' +
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:16px;color:var(--text)">' + safeTag + '</div>' +
        '<div style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--text3)">' + horasTxt + ' · ' + g.plantsCount + ' sesiones</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
        '<button class="modal-btn secondary" style="font-size:10px;padding:6px 10px;flex:1" onclick="forestPendienteCrearObra(' + idx + ')">+ Crear obra con este nombre</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<select class="forest-pendiente-select" data-idx="' + idx + '" style="flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:5px;color:var(--text2);font-family:\'JetBrains Mono\',monospace;font-size:10px;padding:6px 8px">' +
          '<option value="">— Asignar a obra existente —</option>' +
          obrasOptions +
        '</select>' +
        '<button class="modal-btn secondary" style="font-size:10px;padding:6px 10px" onclick="forestPendienteAsignar(' + idx + ')">Vincular</button>' +
      '</div>' +
      '<div style="margin-top:8px;text-align:right">' +
        '<button class="modal-btn secondary" style="font-size:9px;padding:4px 8px;border-color:rgba(200,80,80,0.35);color:rgba(200,100,100,0.85)" onclick="forestPendienteDescartar(' + idx + ')">Descartar etiqueta</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Crea una obra nueva con el nombre de la etiqueta y mueve sus plantas a forestPlants.
function forestPendienteCrearObra(idx) {
  const grupos = getForestPendientesGrouped();
  const g = grupos[idx];
  if (!g) return;
  if (!db.obras) db.obras = [];
  if (!db.forestPlants) db.forestPlants = [];

  const nuevaId = 'f' + Date.now() + Math.random().toString(36).slice(2, 5);
  const nuevaObra = {
    id: nuevaId,
    name: g.tag,
    composer: '',
    estado: 'aprendiendo-inicial',
    origen: 'recuperacion',
    dificultad: 5,
    duracion: null,
    apr: 1, sol: 1, esc: 1,
    lastPase: null,
    pasajes: [],
    notes: '',
    minutosExtra: g.totalMins,
    tipo: 'obra',
  };
  db.obras.push(nuevaObra);

  // Mover plantas de pendientes → forestPlants con el obraId nuevo
  moveForestPendientesToObra(g.tag, nuevaId);

  saveData();
  showToast('Obra creada: "' + g.tag + '" (' + Math.round(g.totalMins/60*10)/10 + 'h asignadas)');
  renderForestPendientes();
  updateForestPendientesBtn();
  if (document.getElementById('view-obras')?.classList.contains('active')) renderObras();
}

// Asigna las plantas pendientes a una obra existente seleccionada en el dropdown.
function forestPendienteAsignar(idx) {
  const grupos = getForestPendientesGrouped();
  const g = grupos[idx];
  if (!g) return;
  const sel = document.querySelector('.forest-pendiente-select[data-idx="' + idx + '"]');
  const obraId = sel?.value;
  if (!obraId) { showToast('Elige una obra del desplegable'); return; }
  const obra = findObra(obraId);
  if (!obra) return;
  if (!db.forestPlants) db.forestPlants = [];

  obra.minutosExtra = (obra.minutosExtra || 0) + g.totalMins;
  moveForestPendientesToObra(g.tag, obraId);

  saveData();
  showToast('Vinculado: "' + g.tag + '" → ' + obra.name + ' (+' + Math.round(g.totalMins/60*10)/10 + 'h)');
  renderForestPendientes();
  updateForestPendientesBtn();
  if (document.getElementById('view-obras')?.classList.contains('active')) renderObras();
}

// Descarta una etiqueta pendiente: borra sus plantas DEFINITIVAMENTE.
// Pide confirmación porque es irreversible.
function forestPendienteDescartar(idx) {
  const grupos = getForestPendientesGrouped();
  const g = grupos[idx];
  if (!g) return;
  const confirmar = confirm('¿Descartar la etiqueta "' + g.tag + '" y sus ' +
    g.plantsCount + ' sesiones (' + Math.round(g.totalMins/60*10)/10 + 'h)?\n\nEsta acción no se puede deshacer.');
  if (!confirmar) return;
  db.forestPendientes = (db.forestPendientes || []).filter(p => p.tag !== g.tag);
  saveData();
  showToast('Etiqueta descartada');
  renderForestPendientes();
  updateForestPendientesBtn();
}

// Helper: mueve todas las plantas con tag=X de forestPendientes a forestPlants
// con el obraId dado. Deduplica por startedAt para no duplicar si ya estaba.
function moveForestPendientesToObra(tag, obraId) {
  if (!db.forestPendientes) return;
  const aMover = db.forestPendientes.filter(p => p.tag === tag);
  const existingStarts = new Set(
    (db.forestPlants || []).filter(p => p.obraId === obraId).map(p => p.startedAt)
  );
  aMover.forEach(pl => {
    if (existingStarts.has(pl.startedAt)) return;
    const entry = {
      obraId,
      startedAt: pl.startedAt,
      endedAt: pl.endedAt,
      mins: pl.mins,
      tag,
      source: 'forest',
    };
    if (pl.failed) entry.failed = true;
    db.forestPlants.push(entry);
  });
  // Quitar todas las plantas con ese tag de pendientes
  db.forestPendientes = db.forestPendientes.filter(p => p.tag !== tag);
  // Mantener forestPlants ordenado cronológicamente
  if (db.forestPlants) db.forestPlants.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
}

// ── SOL RATING ROW ────────────────────────────────────────────────────────────

function renderSolRatingRow(obraId) { return ''; } // replaced by modal

function selectSolRating(obraId, val, btn) {} // replaced by modal

// ── HECHO DATOS MODAL ─────────────────────────────────────────────────────────

let _hechoObraId = null;
let _hechoMovId = null;
let _hechoPlanId = null;
let _hechoMinPlan = 0;
let _hechoEditMode = false;
let _hechoSubSession = false;
let _hechoShowSol = false;
let _hechoShowCompas = false;
let _hechoShowMem = false;
let _hechoCompasAntes = 0;
let _hechoCompasStep = 0;
let _memLapseYes = false;
let _memPasajeSelected = null;
let _paseAntesActive = false;
let _paseDespuesActive = false;
let _pasajeWork = {};
let _hechoZoneOptions = [];
let _hechoZoneKey = null;
let _hechoZoneStage = 'digitando';
let _hechoZoneStart = null;
let _hechoZoneEnd = null;
let _hechoQuickSolidezVal = null;

function solPctColor(pct) {
  if (pct >= 85) return 'var(--green)';
  if (pct >= 60) return 'var(--sol-mid, #8aaa30)';
  if (pct >= 40) return 'var(--accent)';
  if (pct >= 20) return 'var(--orange)';
  return 'var(--red)';
}

function solPctLabel(pct) {
  if (pct >= 90) return 'Lista para escenario';
  if (pct >= 72) return 'Sólida';
  if (pct >= 50) return 'Construyendo';
  if (pct >= 28) return 'Frágil';
  if (pct >= 10) return 'Empezando';
  return 'Sin solidez aún';
}

function hechoJs(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function hechoCurrentSolidezValue(entity, isMovement) {
  if (!entity) return null;
  const historyValue = entity.solHistory?.[0]?.val;
  if (historyValue != null) return normalizeSolVal(historyValue);
  if (entity.sol == null) return null;
  const raw = Number(entity.sol);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return normalizeSolVal(isMovement && raw <= 10 ? raw * 10 : raw);
}

function hechoSelectSolidez(value, button) {
  const val = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
  if (!val) return;
  _hechoQuickSolidezVal = val;
  document.querySelectorAll('#hechoSolidezSection .hecho-solidez-options button').forEach(btn => {
    const selected = btn === button || parseInt(btn.dataset.value || '0', 10) === val;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
  });
  const selection = document.getElementById('hechoSolidezSelection');
  if (selection) selection.textContent = solPctLabel(val) + ' · ' + val + '%';
  try { Haptics.light(); } catch(e) {}
}

function hechoToggleAdvanced() {
  const modal = document.querySelector('#modalHechoDatos .hecho-modal');
  const button = document.getElementById('hechoAdvancedToggle');
  if (!modal || !button) return;
  const open = !modal.classList.contains('show-details');
  modal.classList.toggle('show-details', open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  button.textContent = open ? 'Ocultar detalles' : 'Añadir detalles';
}

function aprendizajeStageMeta(stage) {
  const map = {
    pendiente: {
      label: 'Pendiente',
      short: 'pendiente',
      color: 'var(--text3)',
      hint: 'Guarda tiempo y zona; la solidez global puede esperar.'
    },
    lectura: {
      label: 'Lectura',
      short: 'lectura',
      color: 'var(--orange)',
      hint: 'Zona util para ubicarte. Aun no hace falta medir la obra entera.'
    },
    digitando: {
      label: 'Digitando',
      short: 'digitando',
      color: 'var(--orange)',
      hint: 'Registra el tramo aprendido hoy. La solidez es opcional y mejor por pasaje.'
    },
    manos: {
      label: 'Manos juntas',
      short: 'manos',
      color: 'var(--accent)',
      hint: 'Ya hay forma. Conviene registrar tramo y algun pasaje inestable.'
    },
    consolidando: {
      label: 'Consolidando',
      short: 'consolida',
      color: '#8aaa30',
      hint: 'Tiene sentido medir pase en frio y solidez de la zona.'
    },
    mantenimiento: {
      label: 'Mantenimiento',
      short: 'mantener',
      color: 'var(--green)',
      hint: 'Prioriza pase completo, memoria y pequenos puntos fragiles.'
    }
  };
  return map[stage] || map.digitando;
}

function aprendizajeStageFromEntity(entity) {
  if (!entity) return 'pendiente';
  const pct = compasPercent(entity);
  const solPct = entity.solHistory && entity.solHistory[0]
    ? normalizeSolVal(entity.solHistory[0].val)
    : normalizeSolVal(entity.sol || 0);
  if (pct != null) {
    if (pct <= 0) return 'lectura';
    if (pct < 50) return 'digitando';
    if (pct < 100) return 'manos';
    if (solPct >= 85) return 'mantenimiento';
    return 'consolidando';
  }
  const fase = obraFase(entity);
  if (fase === 'mantenimiento') return 'mantenimiento';
  if (fase === 'consolidando') return 'consolidando';
  return (entity.apr || 1) <= 1 ? 'lectura' : 'digitando';
}

function hechoRangeText(start, end) {
  if (start == null && end == null) return '';
  if (start != null && end != null && start !== end) return 'cc. ' + start + '-' + end;
  const val = start != null ? start : end;
  return val != null ? 'cc. ' + val : '';
}

function hechoDefaultAdvanceRange(entity) {
  const total = parseInt(entity?.compasesTotal || 0);
  if (!total) return { start: null, end: null };
  const actual = Math.max(0, Math.min(total, parseInt(entity.compasActual || 0)));
  if (actual < total) {
    const start = actual + 1;
    return { start, end: Math.min(total, Math.max(start, actual + 8)) };
  }
  return { start: Math.max(1, total - 7), end: total };
}

function hechoDefaultReviewRange(entity) {
  const total = parseInt(entity?.compasesTotal || 0);
  if (!total) return { start: null, end: null };
  const actual = Math.max(1, Math.min(total, parseInt(entity.compasActual || total)));
  return { start: Math.max(1, actual - 7), end: actual };
}

function hechoGetZoneOption(key) {
  return (_hechoZoneOptions || []).find(o => o.key === key) || null;
}

function hechoRenderZoneSection(obra, entity, pasajesActivos, isActividad) {
  const section = document.getElementById('hechoZoneSection');
  if (!section) return;
  _hechoZoneOptions = [];
  _hechoZoneKey = null;
  _hechoZoneStart = null;
  _hechoZoneEnd = null;

  if (isActividad || !obra || !entity) {
    section.style.display = 'none';
    return;
  }

  const hasCompases = !!(entity.compasesTotal && entity.compasesTotal > 0);
  const advance = hechoDefaultAdvanceRange(entity);
  const review = hechoDefaultReviewRange(entity);
  const isMov = !!_hechoMovId;
  _hechoZoneOptions.push({
    key: 'obra',
    type: 'obra',
    label: isMov ? 'Movimiento completo' : 'Obra completa',
    short: isMov ? 'movimiento' : 'obra',
  });
  if (hasCompases) {
    _hechoZoneOptions.push({
      key: 'avance',
      type: 'avance',
      label: 'Avance',
      short: hechoRangeText(advance.start, advance.end) || 'avance',
      start: advance.start,
      end: advance.end,
    });
    _hechoZoneOptions.push({
      key: 'repaso',
      type: 'repaso',
      label: 'Repaso tramo',
      short: hechoRangeText(review.start, review.end) || 'repaso',
      start: review.start,
      end: review.end,
    });
  }
  (pasajesActivos || []).slice(0, 8).forEach(p => {
    _hechoZoneOptions.push({
      key: 'pasaje:' + p.id,
      type: 'pasaje',
      label: p.text || 'Pasaje',
      short: 'pasaje',
      pasajeId: p.id,
      pasajeName: p.text || 'Pasaje',
    });
  });

  _hechoZoneStage = aprendizajeStageFromEntity(entity);
  const pct = compasPercent(entity);
  const defaultKey = hasCompases && pct !== 100 ? 'avance'
    : ((pasajesActivos || []).length ? 'pasaje:' + pasajesActivos[0].id : 'obra');
  _hechoZoneKey = hechoGetZoneOption(defaultKey) ? defaultKey : (_hechoZoneOptions[0]?.key || null);
  const opt = hechoGetZoneOption(_hechoZoneKey);
  if (opt && opt.start != null) {
    _hechoZoneStart = opt.start;
    _hechoZoneEnd = opt.end;
  }

  const head = document.getElementById('hechoZoneHead');
  if (head) {
    const title = isMov ? entity.name : obra.name;
    head.textContent = title ? ('Qué parte de "' + title + '" has tocado') : 'Qué parte has trabajado hoy';
  }
  section.style.display = '';
  hechoRefreshZoneUi();
}

function hechoRefreshZoneUi() {
  const chips = document.getElementById('hechoZoneChips');
  const range = document.getElementById('hechoZoneRange');
  const startInp = document.getElementById('hechoZoneStart');
  const endInp = document.getElementById('hechoZoneEnd');
  const stageRow = document.getElementById('hechoZoneStageRow');
  const hint = document.getElementById('hechoZoneHint');
  const step = document.getElementById('hechoZoneStep');
  const selected = hechoGetZoneOption(_hechoZoneKey);
  if (chips) {
    chips.innerHTML = (_hechoZoneOptions || []).map(opt => {
      const active = opt.key === _hechoZoneKey ? ' active' : '';
      const detail = opt.short && opt.short !== opt.label ? '<span>' + escapeHtmlSafe(opt.short) + '</span>' : '';
      return '<button class="hecho-zone-chip' + active + '" onclick="hechoSelectZone(\'' + hechoJs(opt.key) + '\')">' +
        '<strong>' + escapeHtmlSafe(opt.label) + '</strong>' + detail +
      '</button>';
    }).join('');
  }
  const showRange = selected && (selected.type === 'avance' || selected.type === 'repaso');
  if (range) range.style.display = showRange ? 'flex' : 'none';
  if (startInp) startInp.value = _hechoZoneStart != null ? _hechoZoneStart : '';
  if (endInp) endInp.value = _hechoZoneEnd != null ? _hechoZoneEnd : '';
  if (stageRow) {
    const stages = ['lectura', 'digitando', 'manos', 'consolidando', 'mantenimiento'];
    stageRow.innerHTML = stages.map(st => {
      const meta = aprendizajeStageMeta(st);
      const active = st === _hechoZoneStage ? ' active' : '';
      return '<button class="hecho-zone-stage' + active + '" style="--stage-color:' + meta.color + '" onclick="hechoSelectZoneStage(\'' + st + '\')">' +
        escapeHtmlSafe(meta.label) +
      '</button>';
    }).join('');
  }
  const meta = aprendizajeStageMeta(_hechoZoneStage);
  if (hint) {
    const zoneText = zoneSummaryText(hechoCurrentZoneSnapshot(false));
    hint.innerHTML = '<strong>' + escapeHtmlSafe(zoneText || 'Zona sin definir') + '</strong><span>' + escapeHtmlSafe(meta.hint) + '</span>';
  }
  if (step) {
    step.textContent = meta.short;
    step.style.color = meta.color;
    step.style.borderColor = meta.color;
    step.style.background = 'color-mix(in oklab, ' + meta.color + ' 12%, transparent)';
  }
  if (typeof hechoUpdateFastSolidityAction === 'function') hechoUpdateFastSolidityAction();
}

function hechoSelectZone(key) {
  const opt = hechoGetZoneOption(key);
  if (!opt) return;
  _hechoZoneKey = key;
  if (opt.start != null) {
    _hechoZoneStart = opt.start;
    _hechoZoneEnd = opt.end;
  }
  hechoRefreshZoneUi();
}

function hechoUpdateZoneRange(which, value) {
  const entity = _hechoMovId ? findMovimiento(_hechoObraId, _hechoMovId) : findObra(_hechoObraId);
  const total = parseInt(entity?.compasesTotal || 0);
  let v = parseInt(value);
  if (isNaN(v)) v = null;
  if (v != null && total) v = Math.max(1, Math.min(total, v));
  if (which === 'start') _hechoZoneStart = v;
  else _hechoZoneEnd = v;
  if (_hechoZoneStart != null && _hechoZoneEnd != null && _hechoZoneEnd < _hechoZoneStart) {
    if (which === 'start') _hechoZoneEnd = _hechoZoneStart;
    else _hechoZoneStart = _hechoZoneEnd;
  }
  hechoRefreshZoneUi();
}

function hechoSelectZoneStage(stage) {
  _hechoZoneStage = aprendizajeStageMeta(stage) ? stage : 'digitando';
  hechoRefreshZoneUi();
}

function hechoSyncZoneToCompas() {
  if (_hechoZoneKey !== 'avance' || _hechoZoneStart == null) return;
  const entity = _hechoMovId ? findMovimiento(_hechoObraId, _hechoMovId) : findObra(_hechoObraId);
  const total = parseInt(entity?.compasesTotal || 0);
  if (!total) return;
  const nextEnd = Math.max(_hechoZoneStart, Math.min(total, _hechoCompasStep || _hechoZoneEnd || _hechoZoneStart));
  _hechoZoneEnd = nextEnd;
  const opt = hechoGetZoneOption('avance');
  if (opt) {
    opt.end = nextEnd;
    opt.short = hechoRangeText(_hechoZoneStart, _hechoZoneEnd);
  }
  hechoRefreshZoneUi();
}

function hechoCurrentZoneSnapshot(includeMeta = true) {
  const opt = hechoGetZoneOption(_hechoZoneKey);
  if (!opt) return null;
  const snap = {
    key: opt.key,
    type: opt.type,
    label: opt.label,
    stage: _hechoZoneStage,
    stageLabel: aprendizajeStageMeta(_hechoZoneStage).label,
  };
  if (includeMeta) {
    snap.obraId = _hechoObraId || null;
    snap.movId = _hechoMovId || null;
  }
  if (opt.type === 'avance' || opt.type === 'repaso') {
    snap.start = _hechoZoneStart;
    snap.end = _hechoZoneEnd;
  }
  if (opt.type === 'pasaje') {
    snap.pasajeId = opt.pasajeId;
    snap.pasajeName = opt.pasajeName || opt.label;
  }
  snap.summary = zoneSummaryText(snap);
  return snap;
}

function hechoRestoreZone(zone) {
  if (!zone) return;
  let key = zone.key || null;
  if (!key && zone.type === 'pasaje' && zone.pasajeId) key = 'pasaje:' + zone.pasajeId;
  if (key && hechoGetZoneOption(key)) _hechoZoneKey = key;
  if (zone.start != null) _hechoZoneStart = zone.start;
  if (zone.end != null) _hechoZoneEnd = zone.end;
  if (zone.stage) _hechoZoneStage = zone.stage;
  hechoRefreshZoneUi();
}

function hechoStoreZoneSnapshot(entity, zoneSnapshot) {
  if (!entity || !zoneSnapshot) return;
  const entry = { date: new Date().toISOString(), ...zoneSnapshot };
  entity.currentZone = entry;
  entity.learningStage = zoneSnapshot.stage;
  if (!entity.zoneHistory) entity.zoneHistory = [];
  if (_hechoEditMode && entity.zoneHistory.length) entity.zoneHistory[0] = entry;
  else entity.zoneHistory.unshift(entry);
  if (entity.zoneHistory.length > 40) entity.zoneHistory = entity.zoneHistory.slice(0, 40);
}

function zoneSummaryText(zone) {
  if (!zone) return '';
  if (typeof zone === 'string') return zone;
  if (zone.type === 'pasaje') return 'Pasaje: ' + (zone.pasajeName || zone.label || 'pasaje');
  if (zone.start != null || zone.end != null) {
    const range = hechoRangeText(zone.start, zone.end);
    if (zone.type === 'repaso') return 'Repaso ' + range;
    if (zone.type === 'avance') return 'Avance ' + range;
    return range;
  }
  return zone.label || zone.summary || '';
}

function latestZoneForPlan(planId, obraId, movId, entity) {
  const subs = (sessionAggregate[planId] && sessionAggregate[planId].subsessions) || [];
  for (let i = subs.length - 1; i >= 0; i--) {
    if (subs[i] && subs[i].zone) return subs[i].zone;
  }
  const target = movId ? findMovimiento(obraId, movId) : findObra(obraId);
  return target?.currentZone || entity?.currentZone || null;
}

// Colors matching obra scale sliders: amber=sol, green=esc
const SOL_COLOR = '#c8a030';
const ESC_COLOR = 'var(--green)';

function fillSlider(slider, color) {
  if (!slider) return;
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const val = parseFloat(slider.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--fp', pct + '%');
  slider.style.setProperty('--fc', color);
  slider.style.color = color;
}

function updateSolSlider(val) {
  const pct = parseInt(val);
  const display = document.getElementById('solPctDisplay');
  const label = document.getElementById('solPctLabel');
  const slider = document.getElementById('solSlider');
  if (display) { display.textContent = pct + '%'; display.style.color = SOL_COLOR; }
  if (label) label.textContent = solPctLabel(pct);
  fillSlider(slider, SOL_COLOR);
}

function stepCompas(delta) {
  const entity = _hechoMovId ? findMovimiento(_hechoObraId, _hechoMovId) : findObra(_hechoObraId);
  const total = entity?.compasesTotal || 9999;
  _hechoCompasStep = Math.max(0, Math.min(total, _hechoCompasStep + delta));
  const el = document.getElementById('compasStepVal');
  if (el) el.textContent = _hechoCompasStep;
  updateCompasMeta();
  hechoSyncZoneToCompas();
}

function updateCompasMeta() {
  const meta = document.getElementById('compasStepMeta');
  const posMeta = document.getElementById('compasPosMeta');
  const entity = _hechoMovId
    ? findMovimiento(_hechoObraId, _hechoMovId)
    : findObra(_hechoObraId);

  if (!entity || !entity.compasesTotal) {
    if (meta) meta.textContent = '';
    if (posMeta) posMeta.style.display = 'none';
    return;
  }

  // _hechoCompasStep is now absolute current position
  const actual = Math.max(0, Math.min(entity.compasesTotal, _hechoCompasStep));
  const total = entity.compasesTotal;
  const pct = Math.round((actual / total) * 100);
  const avanzados = actual - _hechoCompasAntes;

  if (posMeta) {
    posMeta.style.display = 'block';
    posMeta.innerHTML =
      '<div style="display:flex;align-items:baseline;justify-content:center;gap:6px;margin-bottom:5px">'
      + '<span style="font-size:28px;font-weight:700;color:var(--accent)">' + actual + '</span>'
      + '<span style="font-size:11px;color:var(--text3)">de</span>'
      + '<span style="font-size:18px;color:var(--text2)">' + total + '</span>'
      + '<span style="font-size:9px;color:var(--text3);margin-left:4px">compases (' + pct + '%)</span>'
      + '</div>'
      + '<div style="height:6px;background:var(--bg2);border-radius:3px;overflow:hidden;margin-bottom:4px">'
      + '<div style="height:100%;width:' + pct + '%;background:var(--accent);border-radius:3px;transition:width 0.2s"></div>'
      + '</div>'
      + (avanzados !== 0 ? '<div style="font-size:9px;color:' + (avanzados > 0 ? 'var(--green)' : 'var(--orange)') + '">'
        + (avanzados > 0 ? '+' : '') + avanzados + ' cc. hoy</div>' : '');
  }

  const stepEl = document.getElementById('compasStepVal');
  if (stepEl) stepEl.textContent = actual;
}



function selectMemLapse(yes, btn) {
  _memLapseYes = yes;
  document.querySelectorAll('.memlapse-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const detail = document.getElementById('memLapseDetail');
  if (detail) detail.style.display = yes ? 'block' : 'none';
}

function selectMemPasaje(pasajeId, btn) {
  _memPasajeSelected = pasajeId;
  document.querySelectorAll('.pasaje-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const nuevoForm = document.getElementById('memNuevoPasajeForm');
  if (nuevoForm) nuevoForm.style.display = pasajeId === '__nuevo__' ? 'block' : 'none';
}

function togglePaseBlock(cual) {
  const isAntes = cual === 'antes';
  const active = isAntes ? _paseAntesActive : _paseDespuesActive;
  const newState = !active;
  if (isAntes) _paseAntesActive = newState; else _paseDespuesActive = newState;
  const content = document.getElementById('pase' + (isAntes ? 'Antes' : 'Despues') + 'Content');
  const btn     = document.getElementById('pase' + (isAntes ? 'Antes' : 'Despues') + 'Toggle');
  if (content) content.style.display = newState ? 'block' : 'none';
  if (btn) btn.textContent = newState ? '− quitar' : '+ añadir';
  if (newState) {
    const slider = document.getElementById('pase' + (isAntes ? 'Antes' : 'Despues') + 'Slider');
    fillSlider(slider, SOL_COLOR);
  }
  // Mostrar/ocultar la sección de fallo de memoria según haya algún pase activo
  const memSection = document.getElementById('hechoMemSection');
  if (memSection) {
    const anyPase = _paseAntesActive || _paseDespuesActive;
    memSection.style.display = (_hechoShowMem && anyPase) ? 'block' : 'none';
    // Si se desactivan todos los pases, resetear el estado de fallo de memoria
    if (!anyPase && _memLapseYes) {
      _memLapseYes = false;
      document.querySelectorAll('.memlapse-btn').forEach(b => b.classList.remove('active'));
      const noBtn = document.querySelector('.memlapse-btn.no');
      if (noBtn) noBtn.classList.add('active');
      const detail = document.getElementById('memLapseDetail');
      if (detail) detail.style.display = 'none';
    }
  }
}

function updatePaseSlider(cual, val) {
  const pct = parseInt(val);
  const suffix = cual === 'antes' ? 'Antes' : 'Despues';
  const valEl  = document.getElementById('pase' + suffix + 'Val');
  const slider = document.getElementById('pase' + suffix + 'Slider');
  if (valEl) { valEl.textContent = pct + '%'; }
  fillSlider(slider, SOL_COLOR);
}

function selectPasajeIntensidad(pasajeId, nivel, btn) {
  if (!_pasajeWork[pasajeId]) _pasajeWork[pasajeId] = {};
  _pasajeWork[pasajeId].intensidad = nivel;
  const block = document.getElementById('pw-' + pasajeId);
  if (block) block.querySelectorAll('.intensidad-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const solPair = document.getElementById('pwsol-' + pasajeId);
  if (solPair) solPair.style.display = 'flex';
}

function updatePasajeSolSlider(pasajeId, momento, val) {
  const pct = parseInt(val);
  if (!_pasajeWork[pasajeId]) _pasajeWork[pasajeId] = {};
  _pasajeWork[pasajeId][momento] = pct;
  const valEl  = document.getElementById('pwsolval-' + pasajeId + '-' + momento);
  const slider = document.getElementById('pwslider-' + pasajeId + '-' + momento);
  if (valEl) valEl.textContent = pct + '%';
  fillSlider(slider, SOL_COLOR);
}

function hechoCronoNotesForPlan(planId, isEditMode) {
  const agg = sessionAggregate[planId] || null;
  const pending = agg && agg._pendingTimes ? agg._pendingTimes : null;
  if (pending && Array.isArray(pending.notes)) {
    return pending.notes.map(cronoNormalizeSessionNote).filter(Boolean);
  }
  if (isEditMode && agg && Array.isArray(agg.subsessions) && agg.subsessions.length) {
    const lastSub = agg.subsessions[agg.subsessions.length - 1];
    const raw = lastSub.sessionNotes || lastSub.notes || [];
    return Array.isArray(raw) ? raw.map(cronoNormalizeSessionNote).filter(Boolean) : [];
  }
  return [];
}

function hechoRenderCronoNotes(planId, isEditMode) {
  const section = document.getElementById('hechoCronoNotesSection');
  const list = document.getElementById('hechoCronoNotesList');
  const finalInput = document.getElementById('hechoCronoFinalNote');
  if (!section || !list) return;
  const notes = hechoCronoNotesForPlan(planId, isEditMode)
    .filter(note => note && note.source !== 'observation');
  const shouldShow = notes.length > 0;
  section.style.display = shouldShow ? 'block' : 'none';
  if (finalInput) { finalInput.value = ''; finalInput.style.display = 'none'; }
  if (!shouldShow) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = notes.map(note => {
    const label = note.phaseLabel || cronoNotePhaseLabel(note.phase, note.elapsedMs, note.minute);
    const time = note.at ? aiTimeLabel(note.at) : '';
    return '<div class="hecho-crono-note-row">' +
      '<span>' + escapeHtmlSafe([label, time].filter(Boolean).join(' · ')) + '</span>' +
      '<p>' + escapeHtmlSafe(note.text) + '</p>' +
    '</div>';
  }).join('');
}

function openHechoDatos(planId, minPlan, opts) {
  opts = opts || {};
  const isSubSession = !!opts.subSession;
  const isEditMode = !!opts.editMode;
  const { obraId: parsedObraId, movId: parsedMovId } = parsePlanId(planId);

  // For extra obras, look up the entity in currentPlan to get correct obraId/movId
  const planEntity = currentPlan.find(e => (e._planId || e.id) === planId);
  const obraId = planEntity ? (planEntity._obraId || planEntity.id) : parsedObraId;
  const movId  = planEntity ? (planEntity._movId || null) : parsedMovId;

  _hechoPlanId = planId;
  _hechoObraId = obraId;
  _hechoMovId = movId;
  _hechoMinPlan = minPlan || 0;
  _hechoEditMode = isEditMode;
  _hechoSubSession = isSubSession;
  _hechoCompasStep = 0;
  _memLapseYes = false;
  _memPasajeSelected = null;
  _paseAntesActive = false;
  _paseDespuesActive = false;
  _pasajeWork = {};
  _hechoZoneOptions = [];
  _hechoZoneKey = null;
  _hechoZoneStage = 'digitando';
  _hechoZoneStart = null;
  _hechoZoneEnd = null;
  _hechoQuickSolidezVal = null;

  const obra = findObra(obraId);
  const entity = movId ? findMovimiento(obraId, movId) : obra;
  const fase = entity ? obraFase(entity) : 'digitando';
  const pct = entity ? compasPercent(entity) : null;

  // Si la entidad es una ACTIVIDAD (lectura a primera vista, técnica, etc.),
  // no tiene estructura de aprendizaje: no preguntamos por compases, pases,
  // memoria ni pasajes. Sólo productividad y tiempo.
  const isActividad = obra && obra.tipo === 'actividad';

  _hechoShowCompas = !isActividad && !!(entity && entity.compasesTotal) && fase === 'digitando';
  // Los pases iniciales/finales y el fallo de memoria deben preguntarse tanto
  // para obras completas como para movimientos individuales, siempre que la
  // entidad esté en fase consolidando o mantenimiento (ya aprendida lo bastante
  // para hacer pases). En fase digitando no tiene sentido aún.
  // En actividades, nunca.
  _hechoShowMem = !isActividad && (fase === 'consolidando' || fase === 'mantenimiento');
  _hechoShowSol = !isActividad;
  const showPases = false; // La solidez oficial se registra desde "Añadir pase".
  const showPasajes = !isActividad;

  // Title
  const obraTitle = obra ? obra.name + (obra.composer ? ' · ' + obra.composer : '') : '';
  const nameEl = document.getElementById('hechoObraName');
  if (movId && entity) {
    nameEl.innerHTML = '<span style="font-size:12px;color:var(--text3)">' + obraTitle + '</span><br><span>' + entity.name + '</span>';
  } else {
    nameEl.textContent = obraTitle;
  }

  const savedMinutes = document.getElementById('hechoSavedMinutes');
  if (savedMinutes) savedMinutes.textContent = (minPlan || 0) + ' min guardados';
  const quickSection = document.getElementById('hechoSolidezSection');
  if (quickSection) quickSection.style.display = _hechoShowSol ? '' : 'none';
  const previous = hechoCurrentSolidezValue(entity, !!movId);
  const previousEl = document.getElementById('hechoSolidezPrevious');
  if (previousEl) previousEl.textContent = previous == null ? 'Sin medir' : 'Anterior · ' + previous + '%';
  const selectionEl = document.getElementById('hechoSolidezSelection');
  if (selectionEl) selectionEl.textContent = 'Toca una opción para registrarla al guardar';
  document.querySelectorAll('#hechoSolidezSection .hecho-solidez-options button').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-checked', 'false');
  });
  const hechoModal = document.querySelector('#modalHechoDatos .hecho-modal');
  if (hechoModal) hechoModal.classList.remove('show-details');
  const advancedToggle = document.getElementById('hechoAdvancedToggle');
  if (advancedToggle) {
    advancedToggle.setAttribute('aria-expanded', 'false');
    advancedToggle.textContent = 'Añadir detalles';
  }
  hechoUpdateFastSolidityAction();

  // Minutes
  document.getElementById('hechoMinutos').value = minPlan || '';
  document.getElementById('hechoMinPlan').textContent = minPlan ? minPlan + ' min' : '—';
  document.getElementById('hechoMinDiff').textContent = '';
  const minInp = document.getElementById('hechoMinutos');
  if (minInp) {
    minInp.oninput = function() {
      const diff = parseInt(this.value) - _hechoMinPlan;
      const el = document.getElementById('hechoMinDiff');
      if (!el || !this.value) { if (el) el.textContent = ''; return; }
      el.textContent = diff > 0 ? '+' + diff + 'min' : diff < 0 ? diff + 'min' : '= exacto';
      el.style.color = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--orange)' : 'var(--text3)';
    };
  }

  // Compas — show current position + total
  const compasSection = document.getElementById('hechoCompasSection');
  if (compasSection) {
    compasSection.style.display = _hechoShowCompas ? 'block' : 'none';
    if (_hechoShowCompas && entity) {
      _hechoCompasAntes = entity.compasActual || 0;
      _hechoCompasStep = _hechoCompasAntes; // absolute: start at current position
      const stepEl = document.getElementById('compasStepVal');
      if (stepEl) stepEl.textContent = _hechoCompasStep;
      updateCompasMeta();
    }
  }

  // Pases section
  const pasesSection = document.getElementById('hechoPasesSection');
  if (pasesSection) pasesSection.style.display = showPases ? 'block' : 'none';
  if (showPases) {
    ['Antes','Despues'].forEach(s => {
      const c = document.getElementById('pase' + s + 'Content');
      const t = document.getElementById('pase' + s + 'Toggle');
      if (c) c.style.display = 'none';
      if (t) t.textContent = '+ añadir';
    });
    const lastSol = obra?.solHistory?.[0]?.val != null ? normalizeSolVal(obra.solHistory[0].val) : 50;
    const slA = document.getElementById('paseAntesSlider');
    const slD = document.getElementById('paseDespuesSlider');
    const vA  = document.getElementById('paseAntesVal');
    const vD  = document.getElementById('paseDespuesVal');
    if (slA) { slA.value = lastSol; }
    if (slD) { slD.value = Math.min(100, lastSol + 5); }
    if (vA) vA.textContent = lastSol + '%';
    if (vD) vD.textContent = Math.min(100, lastSol + 5) + '%';

    // Pre-rellenar desde el drawer de pases si el usuario los anotó durante la sesión
    if (_cronoDraftPases.antesActive) {
      _paseAntesActive = true;
      requestAnimationFrame(() => {
        const c = document.getElementById('paseAntesContent');
        const t = document.getElementById('paseAntesToggle');
        const sl = document.getElementById('paseAntesSlider');
        const v = document.getElementById('paseAntesVal');
        if (c) c.style.display = 'block';
        if (t) t.textContent = '− quitar';
        if (sl) { sl.value = _cronoDraftPases.antesVal; fillSlider(sl, SOL_COLOR); }
        if (v) v.textContent = _cronoDraftPases.antesVal + '%';
        const mem = document.getElementById('hechoMemSection');
        if (mem && _hechoShowMem) mem.style.display = 'block';
      });
    }
    if (_cronoDraftPases.despuesActive) {
      _paseDespuesActive = true;
      requestAnimationFrame(() => {
        const c = document.getElementById('paseDespuesContent');
        const t = document.getElementById('paseDespuesToggle');
        const sl = document.getElementById('paseDespuesSlider');
        const v = document.getElementById('paseDespuesVal');
        if (c) c.style.display = 'block';
        if (t) t.textContent = '− quitar';
        if (sl) { sl.value = _cronoDraftPases.despuesVal; fillSlider(sl, SOL_COLOR); }
        if (v) v.textContent = _cronoDraftPases.despuesVal + '%';
        const mem = document.getElementById('hechoMemSection');
        if (mem && _hechoShowMem) mem.style.display = 'block';
      });
    }
  }

  // Pasajes section
  const pasajosActivos = !movId ? (obra?.pasajes || []).filter(p => p.status !== 'resuelto') : [];
  hechoRenderZoneSection(obra, entity, pasajosActivos, isActividad);
  const pasajesSection = document.getElementById('hechoPasajesSection');
  const pasajesList    = document.getElementById('hechoPasajesList');
  if (pasajesSection) pasajesSection.style.display = (showPasajes && pasajosActivos.length) ? 'block' : 'none';
  if (showPasajes && pasajesList && pasajosActivos.length) {
    // Pasajes ya trabajados en sub-sesiones anteriores de este mismo planId
    const prevWorked = aggregateGetPasajes(planId);
    const prevMap = {};
    prevWorked.forEach(p => { prevMap[p.id] = p; });

    pasajesList.innerHTML = pasajosActivos.map(p => {
      const lastSolP = p.solHistory?.[0]?.val != null ? normalizeSolVal(p.solHistory[0].val) : 50;
      const solD = Math.min(100, lastSolP + 10);
      const prevList = (sessionAggregate[planId]?.subsessions || [])
        .filter(s => (s.pasajes || []).some(pp => pp.id === p.id));
      const prevCount = prevList.length;
      const prevTicks = prevCount > 0
        ? '<span class="pasaje-prev-tick" title="Ya trabajado en sub-sesiones anteriores" style="display:inline-flex;align-items:center;gap:2px;margin-left:6px;font-size:9px;color:var(--green);font-family:\'JetBrains Mono\',monospace">' +
          '✓'.repeat(Math.min(prevCount, 4)) +
          (prevCount > 4 ? '+' + (prevCount - 4) : '') +
          '</span>'
        : '';
      return '<div class="pasaje-work-block" id="pw-' + p.id + '">' +
        '<div class="pasaje-work-name"><span>' + p.text.slice(0,40) + (p.text.length>40?'…':'') + prevTicks + '</span>' +
        '<div class="intensidad-btns">' +
          '<button class="intensidad-btn intenso"    onclick="selectPasajeIntensidad(\'' + p.id + '\',\'intenso\',this)"    title="Trabajo intenso">🔥</button>' +
          '<button class="intensidad-btn normal"     onclick="selectPasajeIntensidad(\'' + p.id + '\',\'normal\',this)"     title="Normal">●</button>' +
          '<button class="intensidad-btn superficial" onclick="selectPasajeIntensidad(\'' + p.id + '\',\'superficial\',this)" title="Superficial">○</button>' +
        '</div></div>' +
        '<div class="pasaje-sol-pair" id="pwsol-' + p.id + '" style="display:none">' +
          '<div class="pasaje-sol-mini"><div class="pasaje-sol-mini-label"><span>Antes</span>' +
          '<span class="pasaje-sol-mini-val" id="pwsolval-' + p.id + '-solAntes" style="color:#c8a030">' + lastSolP + '%</span></div>' +
          '<input type="range" min="0" max="100" step="1" value="' + lastSolP + '" class="sol-slider" id="pwslider-' + p.id + '-solAntes" style="color:#c8a030" oninput="updatePasajeSolSlider(\'' + p.id + '\',\'solAntes\',this.value)"></div>' +
          '<span class="pasaje-arrow">→</span>' +
          '<div class="pasaje-sol-mini"><div class="pasaje-sol-mini-label"><span>Después</span>' +
          '<span class="pasaje-sol-mini-val" id="pwsolval-' + p.id + '-solDespues" style="color:#c8a030">' + solD + '%</span></div>' +
          '<input type="range" min="0" max="100" step="1" value="' + solD + '" class="sol-slider" id="pwslider-' + p.id + '-solDespues" style="color:#c8a030" oninput="updatePasajeSolSlider(\'' + p.id + '\',\'solDespues\',this.value)"></div>' +
        '</div></div>';
    }).join('');
    requestAnimationFrame(() => {
      pasajosActivos.forEach(p => {
        fillSlider(document.getElementById('pwslider-' + p.id + '-solAntes'), SOL_COLOR);
        fillSlider(document.getElementById('pwslider-' + p.id + '-solDespues'), SOL_COLOR);
      });
    });
  }

  // Memory lapse — empieza siempre oculta. Se mostrará si el usuario añade
  // un pase inicial o final (ver togglePaseBlock).
  const memSection = document.getElementById('hechoMemSection');
  if (memSection) {
    memSection.style.display = 'none';
    if (_hechoShowMem) {
      document.querySelectorAll('.memlapse-btn').forEach(b => b.classList.remove('active'));
      const noBtn = document.querySelector('.memlapse-btn.no');
      if (noBtn) noBtn.classList.add('active');
      const detail = document.getElementById('memLapseDetail');
      if (detail) detail.style.display = 'none';
      const pasajes = (obra?.pasajes || []).filter(p => p.status !== 'resuelto');
      const row = document.getElementById('memPasajeRow');
      if (row) {
        row.innerHTML = pasajes.map(p =>
          '<button class="pasaje-chip" onclick="selectMemPasaje(\'' + p.id + '\',this)">' + p.text.slice(0,28) + '</button>'
        ).join('') + '<button class="pasaje-chip nuevo" onclick="selectMemPasaje(\'__nuevo__\',this)">+ nuevo pasaje</button>';
      }
      const nf = document.getElementById('memNuevoPasajeForm');
      if (nf) {
        nf.style.display = 'none';
        ['memPasajeNombre','memPasajeCcInicio','memPasajeCcFin'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = '';
        });
      }
    }
  }

  const hechoNotaEl = document.getElementById('hechoNota');
  const savedPlanNote = document.getElementById('tnote-' + planId)?.value || '';
  const cronoObservation = cronoObservationTextForPlan(planId, isEditMode);
  if (hechoNotaEl) hechoNotaEl.value = savedPlanNote || cronoObservation || '';
  hechoRenderCronoNotes(planId, isEditMode);

  // Destello: casilla simple (sin productividad). Restaura el estado previo.
  const destBox = document.getElementById('hechoDestelloBox');
  const destChk = document.getElementById('hechoDestelloChk');
  const destNotaEl = document.getElementById('hechoDestelloNota');
  const prevDest = sessionDestello[planId];
  const destOnInit = !!(prevDest && prevDest.on);
  if (destChk) destChk.checked = destOnInit;
  if (destNotaEl) destNotaEl.value = (prevDest && prevDest.nota) || '';
  if (destBox) {
    destBox.style.display = destOnInit ? 'block' : 'none';
    destBox.classList.toggle('on', destOnInit);
  }

  // ── EDIT MODE ──────────────────────────────────────────────────────────
  // Si estamos reabriendo la tarjeta para EDITAR, restaurar lo que se guardó
  // en la última sub-sesión: pases inicial/final, fallo de memoria, pasajes
  // trabajados con su intensidad y solidez antes/después.
  if (isEditMode) {
    const agg = sessionAggregate[planId];
    const lastSub = (agg && Array.isArray(agg.subsessions) && agg.subsessions.length)
      ? agg.subsessions[agg.subsessions.length - 1]
      : null;
    if (lastSub) {
      if (lastSub.zone) hechoRestoreZone(lastSub.zone);
      // Pasajes trabajados: marcar intensidad
      if (Array.isArray(lastSub.pasajes)) {
        lastSub.pasajes.forEach(p => {
          if (!p || !p.id || !p.intensidad) return;
          _pasajeWork[p.id] = { intensidad: p.intensidad };
          // Activar el botón visual de intensidad correspondiente
          requestAnimationFrame(() => {
            const block = document.getElementById('pw-' + p.id);
            if (!block) return;
            const btn = block.querySelector('.intensidad-btn.' + p.intensidad);
            if (btn) {
              block.querySelectorAll('.intensidad-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              // Mostrar el sub-bloque sol antes/después
              const solPair = document.getElementById('pwsol-' + p.id);
              if (solPair) solPair.style.display = '';
            }
          });
        });
      }
      // Pases inicial/final: restaurar sliders y activar bloque si tenía nota o valor
      const lastPasesRaw = lastSub.pases || null;
      if (lastPasesRaw) {
        if (lastPasesRaw.antes != null) {
          _paseAntesActive = true;
          requestAnimationFrame(() => {
            const content = document.getElementById('paseAntesContent');
            const toggle = document.getElementById('paseAntesToggle');
            const slider = document.getElementById('paseAntesSlider');
            const val = document.getElementById('paseAntesVal');
            const nota = document.getElementById('paseAntesNota');
            if (content) content.style.display = 'block';
            if (toggle) toggle.textContent = '− quitar';
            if (slider) { slider.value = lastPasesRaw.antes; fillSlider(slider, SOL_COLOR); }
            if (val) val.textContent = lastPasesRaw.antes + '%';
            if (nota && lastPasesRaw.notaAntes) nota.value = lastPasesRaw.notaAntes;
          });
        }
        if (lastPasesRaw.despues != null) {
          _paseDespuesActive = true;
          requestAnimationFrame(() => {
            const content = document.getElementById('paseDespuesContent');
            const toggle = document.getElementById('paseDespuesToggle');
            const slider = document.getElementById('paseDespuesSlider');
            const val = document.getElementById('paseDespuesVal');
            const nota = document.getElementById('paseDespuesNota');
            if (content) content.style.display = 'block';
            if (toggle) toggle.textContent = '− quitar';
            if (slider) { slider.value = lastPasesRaw.despues; fillSlider(slider, SOL_COLOR); }
            if (val) val.textContent = lastPasesRaw.despues + '%';
            if (nota && lastPasesRaw.notaDespues) nota.value = lastPasesRaw.notaDespues;
          });
        }
        // Memoria
        if (lastPasesRaw.memLapse) {
          _memLapseYes = true;
          requestAnimationFrame(() => {
            document.querySelectorAll('.memlapse-btn').forEach(b => b.classList.remove('active'));
            const yesBtn = document.querySelector('.memlapse-btn.yes');
            if (yesBtn) yesBtn.classList.add('active');
            const detail = document.getElementById('memLapseDetail');
            if (detail) detail.style.display = '';
          });
        }
        // Mostrar sección de fallo de memoria si hay algún pase
        if (_hechoShowMem) {
          requestAnimationFrame(() => {
            const memSection = document.getElementById('hechoMemSection');
            if (memSection && (_paseAntesActive || _paseDespuesActive)) {
              memSection.style.display = 'block';
            }
          });
        }
      }
    }
  }

  // El resumen animado del tiempo no debe cubrir las decisiones del cierre.
  document.querySelectorAll('.crono-harvest-burst').forEach(el => el.remove());
  openModal('modalHechoDatos');
}

function closeHechoDatos(save) {
  // Si vamos a guardar, lanzar primero el flash de "Hecho" para que el backdrop
  // difuminado de fondo se mantenga continuo (cierre del modal hecho + flash
  // se solapan visualmente). Lo lanzamos en el siguiente microtask para que
  // el modal-overlay del flash esté presente antes de que `closeModal` evalúe
  // si quedan modales abiertos.
  if (save && _hechoObraId) {
    const inCronoView = document.body.classList.contains('crono-focus');
    if (inCronoView) {
      // Marcar planId para animar el resumen lateral al guardar.
      _cronoLastAddedPlanId = _hechoPlanId;
    }
  }
  closeModal('modalHechoDatos');
  if (!save || !_hechoObraId) return;

  const obraId = _hechoObraId;
  const movId = _hechoMovId;
  const planId = _hechoPlanId || obraId;
  const obra = findObra(obraId);
  const entity = movId ? findMovimiento(obraId, movId) : obra;
  const minutos = parseInt(document.getElementById('hechoMinutos').value) || _hechoMinPlan || null;
  const shouldOfferBreak = !!(save && _hechoSubSession && !_hechoEditMode && minutos >= CRONO_LONG_SESSION_BREAK_MIN);
  const nota = document.getElementById('hechoNota').value.trim();
  const zoneSnapshot = obra && obra.tipo !== 'actividad' ? hechoCurrentZoneSnapshot(true) : null;
  const legacyPaseSlidersEnabled = false;
  if (zoneSnapshot && entity) hechoStoreZoneSnapshot(entity, zoneSnapshot);

  if (_hechoQuickSolidezVal != null && obra && obra.tipo !== 'actividad') {
    if (movId) recordMovSolHistory(obraId, movId, _hechoQuickSolidezVal, 'cierre-sesion');
    else recordSolHistory(obraId, _hechoQuickSolidezVal, 'cierre-sesion');
    sessionSolRatings[planId] = _hechoQuickSolidezVal;
  }

  // ★ Aplicar el cambio de minutos al estado en memoria.
  // Antes este valor solo se escribía en el input HTML tmin-, pero NO en
  // sessionMinPlan[planId]: el resultado era que editar los minutos en el
  // modal "Hecho" no se reflejaba en el "concentrado hoy" ni en la nube,
  // se grababa el tiempo originalmente calculado por el cronómetro.
  // Aplicamos como delta para que el caso fusionado (varias sub-sesiones
  // de la misma obra) mantenga el total acumulado bien.
  const minOriginal = _hechoMinPlan || 0;
  const minDelta = (minutos || 0) - minOriginal;
  if (minDelta !== 0) {
    sessionMinPlan[planId] = Math.max(0, (sessionMinPlan[planId] || 0) + minDelta);
  }

  // Store minutes and notes
  const minInp = document.getElementById('tmin-' + planId);
  if (minInp && minutos) { minInp.value = minutos; minInp._touched = true; }
  const noteInp = document.getElementById('tnote-' + planId);
  if (noteInp) noteInp.value = nota;

  // Save pases to paseHistory + solHistory.
  // En editMode no duplicamos paseHistory; ya está registrado de la primera vez.
  // El subsession.pases es lo que se actualiza para reflejar la edición.
  // Target = obra cuando no hay movId, movimiento (entity) cuando sí lo hay.
  // Las actividades no tienen pase/pasaje/sol — saltar entero.
  if (obra && obra.tipo !== 'actividad' && !_hechoEditMode) {
    const target = movId ? entity : obra;
    if (!target) {} else {
    const now = new Date().toISOString();
    // Variables para decidir al final qué valor representa mejor la solidez:
    // priorizamos el PASE EN FRÍO (antes) porque es la verdadera medida de
    // consolidación. El de después refleja "tras haber calentado", está
    // sesgado al alza.
    let solAntesVal = null;
    let solDespuesVal = null;
    if (legacyPaseSlidersEnabled && _paseAntesActive) {
      const sol = parseInt(document.getElementById('paseAntesSlider')?.value || 50);
      const paseNota = document.getElementById('paseAntesNota')?.value.trim() || '';
      if (!target.paseHistory) target.paseHistory = [];
      target.paseHistory.unshift({ date: now, tipo: 'informal', score: Math.round(sol/10), nota: paseNota, momento: 'antes' });
      // Context distinto para que el de antes NO sea sobrescrito por el de
      // después en la misma sesión (recordSolHistory matchea por context).
      if (movId) recordMovSolHistory(obraId, movId, sol, 'pase-antes');
      else recordSolHistory(obraId, sol, 'pase-antes');
      solAntesVal = sol;
    }
    if (legacyPaseSlidersEnabled && _paseDespuesActive) {
      const sol = parseInt(document.getElementById('paseDespuesSlider')?.value || 60);
      const paseNota = document.getElementById('paseDespuesNota')?.value.trim() || '';
      if (!target.paseHistory) target.paseHistory = [];
      target.paseHistory.unshift({ date: now, tipo: 'informal', score: Math.round(sol/10), nota: paseNota, momento: 'despues' });
      if (movId) recordMovSolHistory(obraId, movId, sol, 'pase-despues');
      else recordSolHistory(obraId, sol, 'pase-despues');
      target.lastPase = now;
      solDespuesVal = sol;
    }
    // Decidir el valor que queda como obra.sol (la solidez "oficial"):
    // - Si hay pase EN FRÍO (antes), ese gana — es la medida real de solidez.
    // - Si solo hay caliente (después), se usa ese.
    // - Lo que se queda en obra.sol es lo que ven los algoritmos de
    //   priorización de sesiones, la fase consolidando→mantenimiento, etc.
    const sessionSolForRating = (solAntesVal != null) ? solAntesVal : solDespuesVal;
    if (sessionSolForRating != null) {
      sessionSolRatings[planId] = sessionSolForRating;
      // recordSolHistory ya actualizó obra.sol con el último que llamó.
      // Si hubo ambos, el "después" pisó al "antes". Lo corregimos: forzar
      // el valor del pase EN FRÍO como definitivo, respetando el formato:
      //   - Obras usan sol en escala 0-100
      //   - Movimientos usan sol en escala 1-10
      if (solAntesVal != null && target) {
        if (movId) {
          target.sol = Math.max(1, Math.min(10, Math.round(solAntesVal / 10)));
        } else {
          target.sol = solAntesVal;
        }
      }
    }
    if (target.paseHistory && target.paseHistory.length > 40) {
      target.paseHistory = target.paseHistory.slice(0, 40);
    }

    // Save pasaje work (pasajes viven a nivel de obra, no de movimiento)
    Object.entries(_pasajeWork).forEach(([pasajeId, work]) => {
      const pasaje = (obra.pasajes || []).find(p => p.id === pasajeId);
      if (!pasaje || !work.intensidad) return;
      if (!pasaje.workHistory) pasaje.workHistory = [];
      pasaje.workHistory.unshift({
        date: now,
        intensidad: work.intensidad,
        solAntes: work.solAntes ?? null,
        solDespues: work.solDespues ?? null,
      });
      if (pasaje.workHistory.length > 30) pasaje.workHistory = pasaje.workHistory.slice(0, 30);
      // Update pasaje sol if we have antes/despues
      if (work.solDespues != null) {
        if (!pasaje.solHistory) pasaje.solHistory = [];
        pasaje.solHistory.unshift({ date: now, val: work.solDespues, context: 'trabajo-' + work.intensidad });
        if (pasaje.solHistory.length > 20) pasaje.solHistory = pasaje.solHistory.slice(0, 20);
      }
    });
    } // cierre del bloque else por target válido
  }

  // Advance compases
  // Advance compases — _hechoCompasStep is now absolute new position
  if (_hechoShowCompas && entity && _hechoCompasStep !== _hechoCompasAntes) {
    const nuevo = Math.min(entity.compasesTotal || 9999, _hechoCompasStep);
    // ★ CRÍTICO: persistir el nuevo valor en la entidad. Sin esto, una segunda
    // sesión del mismo día sobre la misma obra abriría el modal con el valor
    // anterior (el de antes de la primera sesión).
    entity.compasActual = nuevo;
    entity.apr = aprFromCompas(entity);
    if (!entity.compasHistory) entity.compasHistory = [];
    const minAcum = movId
      ? getMinutosMovimiento(obraId, movId) + (minutos || 0)
      : getMinutosObra(obraId) + (minutos || 0);
    const today = new Date().toDateString();
    if (entity.compasHistory[0] && new Date(entity.compasHistory[0].date).toDateString() === today) {
      entity.compasHistory[0] = { date: new Date().toISOString(), compas: nuevo, minAcum };
    } else {
      entity.compasHistory.unshift({ date: new Date().toISOString(), compas: nuevo, minAcum });
      if (entity.compasHistory.length > 60) entity.compasHistory = entity.compasHistory.slice(0, 60);
    }
    if (movId) {
      const el = document.getElementById('mov-compas-' + obraId + '-' + movId + '-actual');
      if (el) el.value = nuevo;
    } else {
      const el = document.getElementById('obra-compas-' + obraId + '-actual');
      if (el) el.value = nuevo;
    }
    // Re-render the obra card if currently visible so the new value is reflected
    if (typeof rerenderObraCard === 'function') {
      try { rerenderObraCard(obraId); } catch(e) {}
    }
  }

  // Memory lapse
  if (_hechoShowMem && _memLapseYes && obra) {
    let pasajeId = _memPasajeSelected;
    if (pasajeId === '__nuevo__') {
      const nombre = document.getElementById('memPasajeNombre')?.value.trim();
      const ccIni  = document.getElementById('memPasajeCcInicio')?.value;
      const ccFin  = document.getElementById('memPasajeCcFin')?.value;
      if (nombre || ccIni) {
        const label = nombre || ('cc. ' + ccIni + (ccFin ? '–' + ccFin : ''));
        const text  = label + (ccIni ? ' (cc.' + ccIni + (ccFin ? '–' + ccFin : '') + ')' : '');
        if (!obra.pasajes) obra.pasajes = [];
        const newP = { id: 'ml' + Date.now(), text, status: 'activo', tempoAct: null, tempoObj: null };
        obra.pasajes.unshift(newP);
        pasajeId = newP.id;
      }
    }
    if (pasajeId && pasajeId !== '__nuevo__') {
      const pasaje = (obra.pasajes || []).find(p => p.id === pasajeId);
      if (pasaje) {
        if (!pasaje.memLapses) pasaje.memLapses = [];
        pasaje.memLapses.unshift({ date: new Date().toISOString(), nota });
        pasaje.status = 'activo';
        pasaje.lastMemLapse = new Date().toISOString();
        showToast('Fallo de memoria registrado en "' + pasaje.text.slice(0, 30) + '"');
      }
    }
  }

  saveData();

  // Apply tick visually
  const planItems = document.querySelectorAll('#sessionPlan .tick-row');
  planItems.forEach(row => {
    const btn = row.querySelector('.tick-btn[onclick*="' + planId + '"][onclick*="hecho"]');
    if (btn) {
      row.querySelectorAll('.tick-btn').forEach(b => b.classList.remove('hecho','parcial','saltado'));
      btn.classList.add('hecho');
    }
  });
  sessionTicks[planId] = 'hecho';

  const minRow = document.getElementById('tickmin-' + planId);
  if (minRow) {
    minRow.style.display = 'flex';
    if (minutos && _hechoMinPlan) {
      const diffEl = document.getElementById('tickmin-diff-' + planId);
      if (diffEl) {
        const diff = minutos - _hechoMinPlan;
        diffEl.textContent = diff > 0 ? '+' + diff + 'min' : diff < 0 ? diff + 'min' : '= exacto';
        diffEl.style.color = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--orange)' : 'var(--text3)';
      }
    }
  }

  // Capturar destello: solo cuenta si la caja está visible (slider ≥ umbral) y
  // la casilla "guardar destello" sigue marcada. La nota es opcional.
  const destBox = document.getElementById('hechoDestelloBox');
  const destChk = document.getElementById('hechoDestelloChk');
  const destOn = !!(destBox && destBox.style.display !== 'none' && destChk && destChk.checked);
  const destNota = destOn ? (document.getElementById('hechoDestelloNota')?.value || '').trim() : '';
  if (destOn) {
    const prevDest = sessionDestello[planId] || {};
    sessionDestello[planId] = Object.assign({}, prevDest, { on: true, nota: destNota });
  }
  else delete sessionDestello[planId];

  // Registro de la sub-sesión (timestamps, minutos, zona, destello). La
  // productividad se eliminó: prodVal queda null y no se puntúa la sesión.
  const prodVal = null;
  if (planId) {
    // Recogemos los pasajes trabajados en esta apertura (snapshot de _pasajeWork)
    const subPasajes = [];
    Object.entries(_pasajeWork).forEach(([pid, w]) => {
      if (!w.intensidad) return;
      const pObj = obra && (obra.pasajes || []).find(pp => pp.id === pid);
      subPasajes.push({
        id: pid,
        nombre: pObj ? pObj.text.slice(0, 40) : pid,
        intensidad: w.intensidad,
      });
    });
    // Inicializar agregado si no existe
    if (!sessionAggregate[planId]) {
      sessionAggregate[planId] = { subsessions: [] };
    }
    // Determinar los minutos de ESTA sub-sesión:
    //  - Si es la primera (no había agregado), son los minutos totales actuales
    //    de sessionMinPlan[planId].
    //  - Si ya había sub-sesiones, son los minutos NUEVOS = minutos actuales -
    //    suma de los minutos de las sub-sesiones previas.
    const prevSubMin = (sessionAggregate[planId].subsessions || [])
      .reduce((s, x) => s + (x.min || 0), 0);
    const totalAcum = sessionMinPlan[planId] || 0;
    const subMin = Math.max(0, totalAcum - prevSubMin) || minutos || totalAcum;

    // Recoger timestamps reales capturados por cronoFinish (si están)
    const pending = sessionAggregate[planId]._pendingTimes || null;
    const startedAt = pending ? pending.startedAt : null;
    const endedAt   = pending ? pending.endedAt   : new Date().toISOString();
    const baseSessionNotes = pending && Array.isArray(pending.notes)
      ? pending.notes
      : hechoCronoNotesForPlan(planId, _hechoEditMode);
    let sessionNotes = Array.isArray(baseSessionNotes)
      ? baseSessionNotes.map(cronoNormalizeSessionNote).filter(Boolean)
      : [];
    sessionNotes = sessionNotes.filter(note => note && note.source !== 'observation');
    if (nota && _hechoSubSession) {
      const finalMin = subMin || minutos || totalAcum || 0;
      const display = entity ? entity.name : (obra ? obra.name : '');
      const sub = movId && obra ? obra.name + (obra.composer ? ' · ' + obra.composer : '') : (obra?.composer || '');
      const finalNote = cronoNormalizeSessionNote({
        id: cronoNoteId(),
        text: nota,
        at: new Date().toISOString(),
        phase: 'after',
        phaseLabel: 'observacion',
        minute: finalMin,
        elapsedMs: finalMin * 60000,
        state: 'hecho',
        mode: 'final',
        obraId,
        movId,
        displayName: display,
        subName: sub,
        source: 'observation',
      });
      if (finalNote) sessionNotes.push(finalNote);
    }
    delete sessionAggregate[planId]._pendingTimes;

    // Snapshot de pases/memoria de ESTA apertura del modal, para poder
    // reabrir la tarjeta y editar tras varias sub-sesiones.
    const prevSubForPases = _hechoEditMode
      ? (sessionAggregate[planId].subsessions || [])[Math.max(0, (sessionAggregate[planId].subsessions || []).length - 1)]
      : null;
    const subPases = legacyPaseSlidersEnabled ? {} : Object.assign({}, prevSubForPases?.pases || {});
    if (legacyPaseSlidersEnabled && _paseAntesActive) {
      subPases.antes = parseInt(document.getElementById('paseAntesSlider')?.value || 50);
      const n = document.getElementById('paseAntesNota')?.value.trim();
      if (n) subPases.notaAntes = n;
    }
    if (legacyPaseSlidersEnabled && _paseDespuesActive) {
      subPases.despues = parseInt(document.getElementById('paseDespuesSlider')?.value || 60);
      const n = document.getElementById('paseDespuesNota')?.value.trim();
      if (n) subPases.notaDespues = n;
    }
    if (_memLapseYes) subPases.memLapse = true;

    sessionAggregate[planId].subsessions.push({
      min: subMin,
      prod: prodVal,
      pasajes: subPasajes,
      pases: Object.keys(subPases).length ? subPases : null,
      zone: zoneSnapshot,
      destello: destOn,
      destelloNota: destOn ? destNota : null,
      destelloBoosts: destOn ? destelloBoosts(sessionDestello[planId]) : 0,
      destelloLevel: destOn ? destelloLevelFromBoosts(destelloBoosts(sessionDestello[planId])) : 0,
      destelloHelpLog: destOn ? destelloHelpLog(sessionDestello[planId]) : [],
      destelloHelpedAt: destOn ? (sessionDestello[planId]?.helpedAt || null) : null,
      sessionNotes: sessionNotes.length ? sessionNotes : null,
      notes: sessionNotes.length ? sessionNotes : null,
      startedAt: startedAt,
      endedAt: endedAt,
      timestamp: endedAt, // legacy compat
    });
    // En editMode, fusionamos esta apertura con la última sub-sesión real:
    // mantenemos los minutos/timestamps originales y solo actualizamos los
    // datos de edición (pasajes, pases, prod). Para evitar contar minutos dos
    // veces y mantener el histórico de horas intacto.
    if (_hechoEditMode && sessionAggregate[planId].subsessions.length >= 2) {
      const arr = sessionAggregate[planId].subsessions;
      const justAdded = arr.pop();
      const previous = arr[arr.length - 1];
      // Preservar startedAt/endedAt/timestamp de la previa; sobrescribir
      // pasajes, pases, prod, destello con los nuevos valores editados.
      previous.pasajes = justAdded.pasajes;
      previous.pases = justAdded.pases;
      previous.zone = justAdded.zone;
      previous.prod = justAdded.prod;
      previous.destello = justAdded.destello;
      previous.destelloNota = justAdded.destelloNota;
      previous.destelloBoosts = justAdded.destelloBoosts;
      previous.destelloLevel = justAdded.destelloLevel;
      previous.destelloHelpLog = justAdded.destelloHelpLog;
      previous.destelloHelpedAt = justAdded.destelloHelpedAt;
      previous.sessionNotes = justAdded.sessionNotes;
      previous.notes = justAdded.notes;
      // Si el usuario editó los minutos del modal, propagar a la sub-sesión
      // previa también para que la edición se refleje en su .min.
      if (minDelta !== 0 && previous.min != null) {
        previous.min = Math.max(0, previous.min + minDelta);
      }
    }

    if (sessionNotes.length && startedAt) {
      const plant = (db.sessionPlants || []).find(p =>
        p.startedAt === startedAt &&
        p.obraId === obraId &&
        (p.movId || null) === (movId || null)
      );
      if (plant) {
        plant.notes = sessionNotes.map(cronoNormalizeSessionNote).filter(Boolean);
        saveData();
      }
    }

    // Productividad ponderada
    const weighted = aggregateWeightedProd(planId);
    sessionProductivityRatings[planId] = weighted != null ? weighted : prodVal;
  }

  saveDraft();
  SFX.tick();
  if (_hechoQuickSolidezVal != null && typeof showSavedCheck === 'function') showSavedCheck();
  // Show rating badge on the plan item, and ensure save button visible
  updateProductivityBadge(planId);
  if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
  // El flash de "Hecho" y la marca de planId nuevo se disparan al INICIO de
  // closeHechoDatos para que el backdrop difuminado del modal nunca se rompa.
  refreshConcentradoUI();
  if (typeof cronoRefreshDestelloPhrase === 'function') cronoRefreshDestelloPhrase(true);
  autoSaveTodayPlan();
  // Refrescar el render de eventos: el pase que acabamos de guardar afecta
  // a la solidez de la obra, y por tanto a la "preparación" del evento que
  // la incluye. Si el usuario va al calendario después, debe ver el valor
  // actualizado. (Antes la preparación se calculaba al renderizar pero el
  // render no se disparaba tras pase, así que parecía no actualizarse).
  if (typeof renderCalendario === 'function') {
    try { renderCalendario(); } catch(e) {}
  }
  if (shouldOfferBreak) cronoMaybeShowLongSessionBreak(minutos);
}

// Flash de éxito al guardar la sesión: aparece sobre el cronómetro con el
// mismo backdrop difuminado de los modales, y dentro un tick verde animado
// con la palabra "Hecho". Auto-cierra tras ~1.4s.
function showCronoHechoFlash() {
  let flash = document.getElementById('cronoHechoFlash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'cronoHechoFlash';
    // Usar la clase modal-overlay para heredar el backdrop blur + centrado
    flash.className = 'modal-overlay crono-hecho-flash';
    const petals = [0, 60, 120, 180, 240, 300].map(a =>
      '<ellipse class="cf-petal" cx="70" cy="40" rx="10.5" ry="20" transform="rotate(' + a + ' 70 60)"/>'
    ).join('');
    flash.innerHTML =
      '<div class="crono-hecho-flash-inner">' +
        '<div class="cf-bloom">' +
          '<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<circle class="cf-glow" cx="70" cy="60" r="46"/>' +
            '<g class="cf-stem-g">' +
              '<path class="cf-stem" d="M70 126 C 66 102 74 90 70 72"/>' +
              '<path class="cf-leaf" d="M70 104 Q 50 100 44 84 Q 64 88 70 102 Z"/>' +
            '</g>' +
            '<g class="cf-petals">' + petals + '</g>' +
            '<circle class="cf-core" cx="70" cy="60" r="9"/>' +
          '</svg>' +
        '</div>' +
        '<div class="crono-hecho-flash-text">Hecho</div>' +
      '</div>';
    document.body.appendChild(flash);
  }
  // La flor toma el color de la obra de la sesión. El flash cuelga de <body>,
  // así que copiamos --crono-color (que vive en #view-cronometro) al propio flash.
  const cronoRoot = document.getElementById('view-cronometro');
  const cronoCol = cronoRoot ? getComputedStyle(cronoRoot).getPropertyValue('--crono-color').trim() : '';
  if (cronoCol) flash.style.setProperty('--crono-color', cronoCol);
  else flash.style.removeProperty('--crono-color');
  // Reset animación: quitar y volver a añadir clase tras un frame
  flash.classList.remove('visible');
  void flash.offsetWidth; // forzar reflow para reiniciar la animación
  flash.classList.add('visible');
  document.body.classList.add('modal-open');
  // Quitar tras ~2s con un breve fade-out
  clearTimeout(flash._t);
  flash._t = setTimeout(() => {
    flash.classList.remove('visible');
    // Liberar modal-open sólo si no hay otros modales abiertos
    const anyOpen = document.querySelector('.modal-overlay.visible');
    if (!anyOpen) document.body.classList.remove('modal-open');
  }, 2000);
}

function cronoMaybeShowLongSessionBreak(minutos) {
  if (!Number.isFinite(minutos) || minutos < CRONO_LONG_SESSION_BREAK_MIN) return;
  if (!document.body.classList.contains('crono-focus')) return;
  setTimeout(() => cronoOpenBreakPrompt(minutos), 650);
}

function cronoEnsureBreakOverlay() {
  let overlay = document.getElementById('cronoBreakOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'cronoBreakOverlay';
  overlay.className = 'crono-break-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  return overlay;
}

function cronoBreakMinutesInput() {
  const input = document.getElementById('cronoBreakBreathMin');
  const raw = parseInt(input ? input.value : CRONO_BREATH_DEFAULT_MIN, 10);
  return Math.max(1, Math.min(20, Number.isFinite(raw) ? raw : CRONO_BREATH_DEFAULT_MIN));
}

function cronoOpenBreakPrompt(minutos) {
  cronoStopBreathing();
  const overlay = cronoEnsureBreakOverlay();
  overlay.innerHTML =
    '<div class="crono-break-panel">' +
      '<div class="crono-break-kicker">Cierre de sesión larga</div>' +
      '<div class="crono-break-title">Llevas ' + fmtMinutosLargo(minutos) + ' estudiando.</div>' +
      '<div class="crono-break-copy">Tu cerebro ya ha hecho trabajo real. Un descanso breve ahora ayuda a que lo aprendido se asiente mejor.</div>' +
      '<label class="crono-break-minutes">' +
        '<span>Respiración</span>' +
        '<input id="cronoBreakBreathMin" type="number" min="1" max="20" step="1" value="' + CRONO_BREATH_DEFAULT_MIN + '">' +
        '<span>min</span>' +
      '</label>' +
      '<div class="crono-break-actions">' +
        '<button class="crono-break-btn subtle" onclick="closeCronoBreakOverlay()">Ahora no</button>' +
        '<button class="crono-break-btn secondary" onclick="cronoBreakWalk()">Paseo</button>' +
        '<button class="crono-break-btn primary" onclick="cronoStartBreathing()">Respiración 4-7-8</button>' +
      '</div>' +
    '</div>';
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeCronoBreakOverlay() {
  cronoStopBreathing();
  const overlay = document.getElementById('cronoBreakOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    const anyOpen = document.querySelector('.modal-overlay.visible, .crono-break-overlay.visible');
    if (!anyOpen) document.body.classList.remove('modal-open');
  }, 360);
}

function cronoBreakWalk() {
  closeCronoBreakOverlay();
  showToast('Buen momento para caminar 3-5 minutos y volver con el oído fresco');
}

function cronoStartBreathing() {
  const min = cronoBreakMinutesInput();
  const overlay = cronoEnsureBreakOverlay();
  cronoStopBreathing();
  _cronoBreathStartedAt = Date.now();
  _cronoBreathEndsAt = _cronoBreathStartedAt + min * 60000;
  _cronoBreathPhaseKey = '';
  overlay.innerHTML =
    '<div class="crono-break-panel crono-breath-panel">' +
      '<div class="crono-break-kicker">Respiración 4-7-8</div>' +
      '<div class="crono-breath-circle" id="cronoBreathCircle">' +
        '<div class="crono-breath-phase" id="cronoBreathPhase">Inhala</div>' +
        '<div class="crono-breath-count" id="cronoBreathCount">4</div>' +
      '</div>' +
      '<div class="crono-breath-total" id="cronoBreathTotal"></div>' +
      '<div class="crono-break-copy">Inhala 4, mantén 7, exhala 8. Deja que la sesión baje al cuerpo.</div>' +
      '<div class="crono-break-actions">' +
        '<button class="crono-break-btn subtle" onclick="closeCronoBreakOverlay()">Cerrar</button>' +
      '</div>' +
    '</div>';
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  cronoBreathTick();
  _cronoBreathInterval = setInterval(cronoBreathTick, 250);
}

function cronoBreathPhase(elapsedMs) {
  const cycleMs = CRONO_BREATH_PATTERN.reduce((s, p) => s + p.secs, 0) * 1000;
  let t = elapsedMs % cycleMs;
  for (const phase of CRONO_BREATH_PATTERN) {
    const phaseMs = phase.secs * 1000;
    if (t < phaseMs) return { ...phase, remaining: Math.max(1, Math.ceil((phaseMs - t) / 1000)) };
    t -= phaseMs;
  }
  const first = CRONO_BREATH_PATTERN[0];
  return { ...first, remaining: first.secs };
}

function cronoBreathTick() {
  const now = Date.now();
  const remainingTotal = Math.max(0, _cronoBreathEndsAt - now);
  if (remainingTotal <= 0) {
    cronoStopBreathing();
    const panel = document.querySelector('#cronoBreakOverlay .crono-break-panel');
    if (panel) {
      panel.innerHTML =
        '<div class="crono-break-kicker">Listo</div>' +
        '<div class="crono-break-title">Descanso completado.</div>' +
        '<div class="crono-break-copy">Vuelve sólo si la atención vuelve contigo.</div>' +
        '<div class="crono-break-actions"><button class="crono-break-btn primary" onclick="closeCronoBreakOverlay()">Volver</button></div>';
    }
    return;
  }
  const phase = cronoBreathPhase(now - _cronoBreathStartedAt);
  const circle = document.getElementById('cronoBreathCircle');
  const phaseEl = document.getElementById('cronoBreathPhase');
  const countEl = document.getElementById('cronoBreathCount');
  const totalEl = document.getElementById('cronoBreathTotal');
  if (circle && phase.key !== _cronoBreathPhaseKey) {
    _cronoBreathPhaseKey = phase.key;
    circle.classList.remove('inhale', 'hold', 'exhale');
    circle.style.transitionDuration = phase.secs + 's';
    circle.classList.add(phase.key);
  }
  if (phaseEl) phaseEl.textContent = phase.label;
  if (countEl) countEl.textContent = phase.remaining;
  if (totalEl) totalEl.textContent = cronoFmt(remainingTotal) + ' restantes';
}

function cronoStopBreathing() {
  if (_cronoBreathInterval) {
    clearInterval(_cronoBreathInterval);
    _cronoBreathInterval = null;
  }
  _cronoBreathPhaseKey = '';
}

let _cronoLastAddedPlanId = null;

// Update or create the small productivity badge inside the tick-min-row
function updateProductivityBadge(planId) {
  const val = sessionProductivityRatings[planId];
  // Buscar el item de plan (cualquier tarjeta, no solo extras)
  const planItem = document.getElementById('plan-' + planId);
  if (!planItem) return;
  // Slot dentro del tick-row o crear uno
  const tickRow = planItem.querySelector('.tick-row');
  const minRow = document.getElementById('tickmin-' + planId);
  let prodEl = document.getElementById('prod-' + planId);
  if (!prodEl) {
    prodEl = document.createElement('span');
    prodEl.id = 'prod-' + planId;
    prodEl.style.fontSize = '9px';
    prodEl.style.marginLeft = 'auto';
    prodEl.style.flexShrink = '0';
    // Preferimos colocarlo en el tickmin-row si existe (legacy), si no, en el tick-row
    if (minRow) minRow.appendChild(prodEl);
    else if (tickRow) tickRow.appendChild(prodEl);
  }
  if (val == null) { prodEl.innerHTML = ''; return; }
  const col = solPctColor(val);
  prodEl.innerHTML = '<span style="background:' + col + '22;color:' + col
    + ';border:1px solid ' + col + '44;padding:1px 6px;border-radius:4px">'
    + val + '% sesión</span>';
}

function openObraDetalleSession(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  document.getElementById('obraDetSessionTitle').textContent = obra.name + (obra.composer ? ' · ' + obra.composer : '');
  const tmp = document.createElement('div');
  tmp.innerHTML = renderObraCard(obra, 0);
  const card = tmp.querySelector('.obra-card');
  if (card) card.classList.add('expanded');
  document.getElementById('obraDetSessionBody').innerHTML = tmp.innerHTML;
  openModal('modalObraDetalleSession');
}

function updateMinDiff(planId, minPlan) {
  const input = document.getElementById('tmin-' + planId);
  if (!input) return;
  input._touched = true;
  const real = parseInt(input.value);
  const diffEl = document.getElementById('tickmin-diff-' + planId);
  if (diffEl) {
    if (!real || !minPlan) {
      diffEl.textContent = '';
    } else {
      const diff = real - minPlan;
      diffEl.textContent = diff > 0 ? '+' + diff + 'min' : diff < 0 ? diff + 'min' : '= exacto';
      diffEl.style.color = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--orange)' : 'var(--text3)';
    }
  }
  // ★ Reflejar el cambio de minutos en el estado en memoria. Sin esto,
  // editar el input inline solo actualizaba el texto del diff, pero
  // sessionMinPlan seguía con el valor viejo y el cómputo de "concentrado
  // hoy" + el autoguardado se quedaban con el tiempo original.
  if (!isNaN(real) && real > 0) {
    sessionMinPlan[planId] = real;
    // Editar minutos reales = la tarjeta cuenta como estudiada.
    const entity = currentPlan.find(e => (e._planId || e.id) === planId);
    if (entity) entity._isExtra = true;
    if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
  }
}

// ── ESTADO LABELS ────────────────────────────────────────────────────────────

function solLabel(sol) {
  if (sol >= 9) return { label: 'Maduro',       color: '#5ab87a' };
  if (sol >= 7) return { label: 'Sólido',        color: 'var(--accent)' };
  if (sol >= 5) return { label: 'Construyendo',  color: '#c8a030' };
  if (sol >= 3) return { label: 'Frágil',        color: 'var(--orange)' };
  return               { label: 'Sin solidez',   color: 'var(--red)' };
}

function escLabel(esc) {
  if (esc >= 9) return { label: 'Libre',          color: '#5ab87a' };
  if (esc >= 7) return { label: 'Escénico',        color: 'var(--accent)' };
  if (esc >= 5) return { label: 'En desarrollo',   color: '#c8a030' };
  if (esc >= 3) return { label: 'Nervioso',        color: 'var(--orange)' };
  return               { label: 'Sin exposición',  color: 'var(--red)' };
}

function aprLabel(pct) {
  // pct: 0-100 or null (no compases set)
  if (pct === null)  return { label: null,              color: 'var(--orange)', pct: null };
  if (pct >= 100)    return { label: 'Aprendida ✓',     color: 'var(--green)',  pct };
  if (pct >= 75)     return { label: 'Casi lista',       color: '#9ab030',       pct };
  if (pct >= 50)     return { label: 'Medio camino',     color: 'var(--accent)', pct };
  if (pct >= 25)     return { label: 'Avanzando',        color: 'var(--orange)', pct };
  return                    { label: 'Digitando',         color: 'var(--red)',    pct };
}

function obraFase(obra) {
  if (obra && obra.tipo === 'actividad') return null;
  const apr = aprFromCompas(obra), sol = obra.sol || 1;
  if (apr < 10) return 'digitando';      // not fully learned
  if (sol < 6)  return 'consolidando';
  return 'mantenimiento';
}

function obraFaseLabel(obra) {
  const pct = compasPercent(obra);
  const apr = aprFromCompas(obra);
  const sol = obra.sol || 1;
  const esc = obra.esc || 1;

  // Escena overrides if very high
  if (esc >= 7 && sol >= 7 && pct === 100)
    return { label: (escLabel(esc).label) + ' · 100%', color: escLabel(esc).color };

  // Solidez shown if fully learned
  if (pct === 100 && sol >= 6)
    return { label: solLabel(sol).label, color: solLabel(sol).color };

  // Learning stage (compas-based)
  const al = aprLabel(pct);
  if (al.label) return { label: al.pct !== null ? al.label + ' · ' + al.pct + '%' : al.label, color: al.color };

  // Fallback for obras without compases (use apr 1-10)
  const sl = solLabel(sol);
  const el = escLabel(esc);
  if (esc >= 7) return { label: el.label, color: el.color };
  if (sol >= 6) return { label: sl.label, color: sl.color };
  if (apr >= 6) return { label: 'Aprendida', color: 'var(--orange)' };
  return { label: 'En aprendizaje', color: 'var(--red)' };
}
function obraEffectiveStats(obra) {
  const movs = (obra.movimientos || []).filter(m => m.apr !== undefined || m.compasesTotal);
  if (!movs.length) return obra;
  const resolved = movs.map(m => ({ ...m, _apr: aprFromCompas(m) }));
  const totalW = resolved.reduce((s, m) => s + (m.compasesTotal || m.duracion || 1), 0);
  const w = fn => resolved.reduce((s, m) => s + fn(m) * (m.compasesTotal || m.duracion || 1), 0) / totalW;
  const totalCompases = resolved.reduce((s, m) => s + (m.compasesTotal || 0), 0);
  const actualCompases = resolved.reduce((s, m) => s + Math.min(m.compasActual || 0, m.compasesTotal || 0), 0);
  return {
    ...obra,
    apr: Math.round(w(m => m._apr)),
    sol: Math.round(w(m => m.sol || 1)),
    esc: Math.round(w(m => m.esc || 1)),
    dificultad: Math.round(w(m => m.dificultad || 3)),
    duracion: resolved.reduce((s, m) => s + (m.duracion || 0), 0) || obra.duracion,
    compasesTotal: totalCompases || null,
    compasActual:  actualCompases || null,
  };
}

// Legacy compat
function estadoToFase(estado) { return 'consolidando'; }
function estadoUrgencyBonus(estado) { return 15; }
function estadoTipoPase(estado) { return null; }

function obraTipoPase(obra) {
  const esc = obra.esc || 1, sol = obra.sol || 1;
  if (esc >= 7) return 'escena';
  if (sol >= 6) return 'informal';
  return 'solo';
}

// ── ANÁLISIS DE PASES ────────────────────────────────────────────────────────
function analizarPases(obraId) {
  const hist = (findObra(obraId)?.paseHistory || []).slice(0, 10);
  const counts = { tecnico: 0, memoria: 0, concierto: 0 };
  hist.forEach(p => { if (p.tipo && counts[p.tipo] !== undefined) counts[p.tipo]++; });
  const total = hist.length;
  return { counts, total,
    necesitaConcierto: total >= 3 && counts.concierto === 0,
    excesivamenteTecnico: total >= 5 && counts.tecnico / total > 0.7,
    necesitaMemoria: total >= 3 && counts.memoria === 0 && counts.tecnico > 0
  };
}

// ── PLAN ENTITY SYSTEM ──────────────────────────────────────────────────────
// Expands obras-with-movimientos into independent plan entities so each
// movement gets its own priority score, time allocation, and tick tracking.

function parsePlanId(planId) {
  if (!planId || typeof planId !== 'string') return { obraId: String(planId), movId: null };
  const sep = planId.indexOf('__');
  if (sep === -1) return { obraId: planId, movId: null };
  return { obraId: planId.slice(0, sep), movId: planId.slice(sep + 2) };
}

// Returns a flat list of "plan entities". Obras without movimientos map to
// themselves (backward-compatible). Obras with movimientos expand to one
// entity per movement, each carrying its own stats.
function buildPlanEntities(obras) {
  const entities = [];
  obras.forEach(obra => {
    const movs = (obra.movimientos || []).filter(m => m.name);
    if (!movs.length) {
      entities.push({
        ...obra,
        _planId: obra.id, _obraId: obra.id, _movId: null,
        _isMovimiento: false, _parentName: null
      });
    } else {
      movs.forEach(mov => {
        const planId = obra.id + '__' + mov.id;
        // For solHistory: movements store sol as 1-10 direct val; build a
        // synthetic solHistory from mov.sol so scoring can use it uniformly.
        const syntheticSolHistory = (mov.solHistory && mov.solHistory.length)
          ? mov.solHistory
          : (mov.sol ? [{ date: new Date().toISOString(), val: mov.sol * 10, context: 'initial' }] : []);
        entities.push({
          _planId: planId,
          _obraId: obra.id,
          _movId: mov.id,
          _isMovimiento: true,
          _parentName: obra.name,
          // Use planId as .id so existing compat code that reads .id still works
          id: planId,
          name: mov.name,
          composer: obra.composer,
          // Stats from movement (with obra fallbacks)
          sol: mov.sol || 1,
          esc: mov.esc || 1,
          dificultad: mov.dificultad || obra.dificultad || 3,
          duracion: mov.duracion || 0,
          compasActual: mov.compasActual,
          compasesTotal: mov.compasesTotal,
          compasHistory: mov.compasHistory || [],
          paseHistory: mov.paseHistory || [],
          lastPase: mov.lastPase || null,
          solHistory: syntheticSolHistory,
          // Movements don't have pasajes/origen/eventos — inherit from obra
          pasajes: [],
          origen: obra.origen,
          eventos: obra.eventos,
          _obraRef: obra,
        });
      });
    }
  });
  return entities;
}

// Tick history lookup aware of movId (null = obra-level item)
function getLastTickForEntity(planId) {
  const { obraId, movId } = parsePlanId(planId);
  const hoy = new Date().toDateString();
  for (const s of db.sesiones) {
    if (new Date(s.date).toDateString() === hoy) continue;
    const item = movId
      ? (s.items || []).find(i => i.obraId === obraId && i.movId === movId)
      : (s.items || []).find(i => i.obraId === obraId && !i.movId);
    if (item) return item;
  }
  return null;
}

function getRecentTicksForEntity(planId, n) {
  const { obraId, movId } = parsePlanId(planId);
  const hoy = new Date().toDateString();
  return db.sesiones
    .filter(s => new Date(s.date).toDateString() !== hoy)
    .flatMap(s => (s.items || []).filter(i =>
      movId ? (i.obraId === obraId && i.movId === movId)
            : (i.obraId === obraId && !i.movId)
    ))
    .slice(-n);
}

// Record solidez for a movement (0-100 scale, same as obras)
function recordMovSolHistory(obraId, movId, val, context, dateIso) {
  const mov = findMovimiento(obraId, movId);
  if (!mov || val == null) return;
  const stamp = dateIso || new Date().toISOString();
  if (!mov.solHistory) mov.solHistory = [];
  const today = new Date(stamp).toDateString();
  const last = mov.solHistory[0];
  if (last && new Date(last.date).toDateString() === today && last.context === context) {
    mov.solHistory[0] = { date: stamp, val: parseInt(val), context };
  } else {
    mov.solHistory.unshift({ date: stamp, val: parseInt(val), context });
    if (mov.solHistory.length > 80) mov.solHistory = mov.solHistory.slice(0, 80);
  }
  // Also keep the 1-10 .sol field in sync
  mov.sol = Math.max(1, Math.min(10, Math.round(parseInt(val) / 10)));
  saveData();
}

// ── Pesos del algoritmo de generación ───────────────────────────────────────
// Jerarquía declarada (techo de influencia de cada señal sobre el score):
//   urgencia de evento (60) ≳ pasajes (50) ≈ solidez (50) > rotación (~33)
//   > escenario (20) > ticks (±25) > fatiga (−20)
// Cada bloque está acotado a su techo para que ninguna señal (p.ej. una obra
// con muchos pasajes marcados) aplaste al resto del repertorio. Para afinar el
// comportamiento, tocar SOLO estos números.
const SCORE_W = {
  escListo: 20, escCasi: 10,
  pasajeBase: 8, pasajeTempoMax: 10,
  pasajeLapso: { d1: 35, d3: 22, d7: 14, d14: 8 },
  pasajeCap: 50,
  urgSinEvento: 5, urgFactor: 4, urgCap: 60,
  rotNuncaPase: 15, rotConsolidando: 10, rotMantenimiento: 8, rotNoEnSesion: 18,
  tickSaltado: 25, tickParcial: 12, tickHecho: -8, tick3Hechos: -15,
  fatigaAlta: -15, fatigaMuyAlta: -20,
  solidezMax: 35, solCaida: { c20: 22, c10: 12, c5: 6 }, solidezCap: 50,
};

function generateSession() {
  if (!db.obras || db.obras.length === 0) { showToast('Añade obras primero'); return; }

  const totalMin = selectedTime * 60;
  const hora = new Date().getHours();
  const now = Date.now();

  // ── Filtro: solo obras en eventos futuros ────────────────────────────────
  // Lógica: el generador debe centrarse en lo que está programado, no en todo
  // el repertorio. Las obras sin evento futuro (ej. una obra de un examen ya
  // hecho que no vuelves a tocar pronto) NO deben aparecer aquí. Si quieres
  // tocarlas igualmente, usa "+ Añadir sesión" manual.
  //
  // Excepción única: si el calendario está completamente vacío (vacaciones,
  // hueco entre temporadas), trabajamos con todo el repertorio para que la
  // app siga siendo útil. En cuanto añadas un evento, el filtro se activa.
  const eventosFuturos = (db.eventos || []).filter(ev =>
    !ev.completado && new Date(ev.fecha) > now
  );
  const hayEventosFuturos = eventosFuturos.length > 0;
  const obrasEnEventos = new Set();
  eventosFuturos.forEach(ev => (ev.obras || []).forEach(id => obrasEnEventos.add(id)));

  let obras;
  if (hayEventosFuturos) {
    obras = db.obras.filter(o => obrasEnEventos.has(o.id) && o.tipo !== 'actividad');
    if (!obras.length) {
      showToast('No hay obras programadas en eventos futuros. Añade obras a un evento o usa "+ Añadir sesión" manual.');
      return;
    }
  } else {
    // Excluir actividades: no se generan automáticamente, se añaden manualmente
    obras = db.obras.filter(o => o.tipo !== 'actividad');
  }

  // ── Carga del día actual ──────────────────────────────────────────────────
  const hoy = new Date().toDateString();
  const sesionHoy = db.sesiones.find(s => new Date(s.date).toDateString() === hoy);
  const yaHuboSesionHoy = !!sesionHoy;
  const cargaHoy = yaHuboSesionHoy
    ? (sesionHoy.items || []).reduce((acc, it) => {
        const o = obras.find(x => x.id === it.obraId);
        if (!o || it.tick === 'saltado') return acc;
        return acc + (o.dificultad || 3) * (o.duracion || 8);
      }, 0)
    : 0;

  // ── Fatiga acumulada últimos 5 días (no solo hoy) ────────────────────────
  const cincosDias = 5 * 86400000;
  const cargaSemana = db.sesiones
    .filter(s => (now - new Date(s.date)) <= cincosDias && new Date(s.date).toDateString() !== hoy)
    .reduce((acc, s) => {
      return acc + (s.items || []).reduce((a, it) => {
        const o = obras.find(x => x.id === it.obraId);
        if (!o || it.tick === 'saltado') return a;
        return a + (o.dificultad || 3) * (o.duracion || 8) * 0.3; // días pasados pesan 30%
      }, 0);
    }, 0);
  const cargaTotal = cargaHoy + cargaSemana;

  // ── Deadline más cercano GLOBAL (para tipo de sesión) ────────────────────
  const minDeadlineDaysGlobal = (db.eventos || [])
    .filter(ev => new Date(ev.fecha) > now)
    .reduce((min, ev) => Math.min(min, Math.ceil((new Date(ev.fecha) - now) / 86400000)), 999);

  // ── Obras conciertables ───────────────────────────────────────────────────
  const obrasConciertables = obras.filter(o => obraFase(o) !== 'digitando');
  const ratioConciertable = obrasConciertables.length / Math.max(obras.length, 1);

  // ── Tipo de sesión ────────────────────────────────────────────────────────
  const esMicropase = (
    totalMin <= 20 ||
    (yaHuboSesionHoy && totalMin <= 35) ||
    (selectedEnergy === 'baja' && totalMin <= 30) ||
    (hora >= 21 && yaHuboSesionHoy) ||
    (cargaTotal > 100 && totalMin <= 40)
  );
  const esConcierto = !esMicropase && (
    totalMin >= 30 && totalMin <= 90 &&
    selectedEnergy !== 'baja' &&
    ratioConciertable >= 0.5 &&
    (minDeadlineDaysGlobal <= 14 || (obrasConciertables.length >= 3 && totalMin <= 60))
  );
  let tipoSesion = esMicropase ? 'micropase' : esConcierto ? 'concierto' : 'trabajo';

  // ── Análisis de pases históricos por obra ─────────────────────────────────
  // (defined at module scope below — referenced here for clarity)


  // ── SCORING ───────────────────────────────────────────────────────────────
  // Shared scoring function for both obra-level and movement-level entities.
  function scoreEntity(o, rootObraId) {
    let score = 0;
    const planId = o._planId || o.id;
    const dif = o.dificultad || 3;
    const dur = o.duracion || 8;
    const fase = obraFase(o);
    const urg = computeUrgencia(rootObraId); // calculado una vez, reusado abajo

    // Escenario: menos listo (<7) → más prioridad
    score += (o.esc || 1) < 7 ? SCORE_W.escListo : SCORE_W.escCasi;

    // Pasajes — solo obra-level (los movimientos no tienen pasajes). El bloque
    // se acota a SCORE_W.pasajeCap para que una obra con muchos pasajes
    // marcados no monopolice el plan.
    if (!o._isMovimiento) {
      const evMult = urg.nivel === 'critico' ? 3 : urg.nivel === 'urgente' ? 2 : 1.2;
      let pasajeScore = 0;
      (o.pasajes || []).filter(p => p.status === 'activo').forEach(p => {
        let pScore = SCORE_W.pasajeBase;
        if (p.tempoAct && p.tempoObj && p.tempoObj > p.tempoAct) {
          const ratio = p.tempoAct / p.tempoObj;
          pScore = SCORE_W.pasajeBase + Math.round((1 - ratio) * SCORE_W.pasajeTempoMax);
        }
        if (p.lastMemLapse) {
          const diasLapse = (now - new Date(p.lastMemLapse)) / 86400000;
          const L = SCORE_W.pasajeLapso;
          if (diasLapse < 1)       pScore += L.d1 * evMult;
          else if (diasLapse < 3)  pScore += L.d3 * evMult;
          else if (diasLapse < 7)  pScore += L.d7 * evMult;
          else if (diasLapse < 14) pScore += L.d14 * evMult;
        }
        pasajeScore += pScore;
      });
      score += Math.min(SCORE_W.pasajeCap, pasajeScore);
    }

    // Urgencia calendario — movements inherit from parent obra
    if (urg.nivel === 'sin-evento') score += SCORE_W.urgSinEvento;
    else score += Math.min(SCORE_W.urgCap, urg.score * SCORE_W.urgFactor);

    // Tiempo desde último pase (movement-aware)
    const lastPaseDate = o.lastPase;
    if (!lastPaseDate) score += SCORE_W.rotNuncaPase;
    else {
      const dias = Math.floor((now - new Date(lastPaseDate)) / 86400000);
      if (fase === 'consolidando' && dias > 2) score += SCORE_W.rotConsolidando;
      if (fase === 'mantenimiento' && dias > 7) score += SCORE_W.rotMantenimiento;
      const { movId } = parsePlanId(planId);
      const fueEnSesion = db.sesiones
        .filter(s => (now - new Date(s.date)) <= 7 * 86400000)
        .flatMap(s => s.items || [])
        .some(it => movId
          ? (it.obraId === rootObraId && it.movId === movId)
          : (it.obraId === rootObraId && !it.movId));
      if (!fueEnSesion) score += SCORE_W.rotNoEnSesion;
    }

    // Historial de ticks (movement-aware)
    const lastTick = getLastTickForEntity(planId);
    if (lastTick) {
      if (lastTick.tick === 'saltado') score += SCORE_W.tickSaltado;
      else if (lastTick.tick === 'parcial') score += SCORE_W.tickParcial;
      else if (lastTick.tick === 'hecho') score += SCORE_W.tickHecho;
    }
    const recent = getRecentTicksForEntity(planId, 3);
    if (recent.length === 3 && recent.every(r => r.tick === 'hecho')) score += SCORE_W.tick3Hechos;

    // Fatiga acumulada
    if (cargaTotal > 80 && dif >= 5) score += SCORE_W.fatigaAlta;
    if (cargaTotal > 130 && dif >= 4) score += SCORE_W.fatigaMuyAlta;

    // Solidez — baja solidez = más urgente. Bloque acotado a solidezCap.
    if (o.solHistory && o.solHistory.length) {
      let solScore = 0;
      const solActual = normalizeSolVal(o.solHistory[0].val);
      solScore += Math.round((100 - solActual) / 100 * SCORE_W.solidezMax);
      if (o.solHistory.length >= 2) {
        const solPrev = normalizeSolVal(o.solHistory[1].val);
        const caida = solPrev - solActual;
        if (caida >= 20) solScore += SCORE_W.solCaida.c20;
        else if (caida >= 10) solScore += SCORE_W.solCaida.c10;
        else if (caida >= 5) solScore += SCORE_W.solCaida.c5;
      }
      score += Math.min(SCORE_W.solidezCap, solScore);
    }

    return { ...o, score, dif, dur, fase };
  }

  // scoredObras: whole-obra scoring for concierto mode (plays full pieces)
  const scoredObras = obras.map(o => scoreEntity(o, o.id)).sort((a, b) => b.score - a.score);

  // scored: entity-level — each movement of multi-movement obras is independent
  const allEntities = buildPlanEntities(obras);
  const scored = allEntities.map(o => scoreEntity(o, o._obraId || o.id)).sort((a, b) => b.score - a.score);

  // ── Construir plan ────────────────────────────────────────────────────────
  let currentPlanLocal = [];
  let html = '';

  // Banner de mañana
  if (db.registro && db.registro.length > 0) {
    const last = db.registro[0];
    const esReciente = (now - new Date(last.date)) < 36 * 3600 * 1000;
    if (esReciente && last.manana) {
      html += `<div class="manana-banner">
        <div class="manana-banner-label">Pendiente de ayer</div>
        ${last.manana}
      </div>`;
    }
  }

  // ── MICROPASE ────────────────────────────────────────────────────────────
  if (tipoSesion === 'micropase') {
    const candidatas = scored.filter(o => {
      if ((o.duracion || 8) > totalMin - 2) return false;
      if (obraFase(o) === 'digitando') return false;
      if (cargaTotal > 100 && (o.dificultad || 3) >= 5) return false;
      return true;
    });
    const elegida = candidatas[0] || scored.find(o => obraFase(o) !== 'digitando') || scored[0];
    if (!elegida) { showToast('No hay obras para micropase'); return; }
    currentPlanLocal = [elegida];

    const razon = yaHuboSesionHoy
      ? 'ya estudiaste hoy — este micropase consolida lo trabajado en memoria'
      : cargaTotal > 100 ? 'carga acumulada alta — solo un pase limpio para asentar'
      : hora >= 21 ? 'hora tardía — pase ligero de consolidación'
      : 'tiempo reducido — un pase enfocado';

    // Tipo de pase sugerido basado en M/T/L
    const pa = elegida._isMovimiento ? null : analizarPases(elegida.id);
    const tipoSug = obraTipoPase(elegida) || 'concierto';
    const micropaseTitle = elegida._isMovimiento
      ? `Micropase · ${totalMin} min · ${elegida._parentName} – ${elegida.name}`
      : `Micropase · ${totalMin} min · ${tipoSug}`;

    html += `<div class="session-type-banner micropase">
      <div class="session-type-title">${micropaseTitle}</div>
    </div>`;
    if (elegida._isMovimiento) {
      html += renderMovimientoPlanItem(elegida, 0, elegida.duracion || totalMin, selectedEnergy, cargaTotal);
    } else {
      html += renderMicropaseItem(elegida, totalMin, tipoSug);
    }

  // ── RONDA DE CONCIERTO ────────────────────────────────────────────────────
  } else if (tipoSesion === 'concierto') {
    let tiempoRestante = totalMin;
    const seleccionadas = [];
    // concierto uses scoredObras: full pieces (movimientos not split here)
    for (const o of scoredObras.filter(x => obraFase(x) !== 'digitando')) {
      const dur = (o.duracion || 8) + 2;
      if (tiempoRestante - dur >= 0) { seleccionadas.push(o); tiempoRestante -= dur; }
      if (seleccionadas.length >= 6) break;
    }
    if (seleccionadas.length === 0) tipoSesion = 'trabajo';
    else {
      currentPlanLocal = seleccionadas;
      const durTotal = seleccionadas.reduce((s, o) => s + (o.duracion || 8), 0);
      html += `<div class="session-type-banner concierto">
        <div class="session-type-title">Ronda de concierto · ${durTotal} min · ${totalMin} disponibles</div>
      </div>`;
      seleccionadas.forEach((obra, i) => { html += renderConciertoItem(obra, i, minDeadlineDaysGlobal); });
    }
  }

  // ── SESIÓN DE TRABAJO ─────────────────────────────────────────────────────
  if (tipoSesion === 'trabajo') {
    const round5 = n => Math.max(10, Math.round(n / 5) * 5);

    const baseMaxObras =
      totalMin <= 65  ? 3 :
      totalMin <= 100 ? 4 :
      totalMin <= 145 ? 5 :
      totalMin <= 200 ? 6 : 7;
    const maxObras =
      selectedEnergy === 'alta' ? baseMaxObras + 1 :
      selectedEnergy === 'baja' ? Math.max(3, baseMaxObras - 1) : baseMaxObras;

    const filtered = selectedEnergy === 'baja'
      ? scored.filter(o => obraFase(o) !== 'digitando' && (o.dificultad || 3) <= 4)
      : scored;
    let pool = filtered.length === 0 ? scored : filtered;
    if (cargaTotal > 80) pool = pool.filter(o => (o.dificultad || 3) <= 5);

    // Smart deduplication: if an obra appears as multiple movements, group them together
    // so one multi-movement obra doesn't crowd out other obras entirely.
    // Strategy: limit max movements per obra to 2 within a single session (unless very short session)
    const maxMovsPerObra = totalMin >= 90 ? 3 : 2;
    const obraMovCount = {};
    const poolFiltered = [];
    for (const entity of pool) {
      const oid = entity._obraId || entity.id;
      obraMovCount[oid] = (obraMovCount[oid] || 0) + 1;
      if (obraMovCount[oid] <= maxMovsPerObra) poolFiltered.push(entity);
      if (poolFiltered.length >= maxObras) break;
    }
    currentPlanLocal = poolFiltered;

    // ── Tiempos base por entidad (obra o movimiento) ────────────────────────
    const tiemposBase = currentPlanLocal.map(o => {
      // For movements without explicit duracion, estimate from compases or use 15min default
      const dur = o.duracion || (o.compasesTotal ? Math.max(8, Math.round(o.compasesTotal / 20)) : 15);
      const fase = obraFase(o);
      let minimo;
      if (fase === 'mantenimiento')    minimo = dur + Math.max(3, Math.round(dur * 0.25));
      else if (fase === 'digitando')   minimo = Math.max(12, Math.round(dur * 1.5));
      else /* consolidando */          minimo = dur + Math.max(8, Math.round(dur * 0.5));
      return minimo;
    });

    // ── Distribuir surplus ───────────────────────────────────────────────────
    const totalMinimos = tiemposBase.reduce((s, m) => s + m, 0);
    const surplus = Math.max(0, totalMin - totalMinimos);
    const weights = currentPlanLocal.map(o => {
      const rootId = o._obraId || o.id;
      return Math.max(1, (computeUrgencia(rootId).score || 1)) * (o.dificultad || 3);
    });
    const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;

    // Redondear a 5 min (mín 10)
    let minPorObra = currentPlanLocal.map((o, i) => {
      const raw = tiemposBase[i] + Math.round((weights[i] / totalWeight) * surplus);
      return round5(raw);
    });

    // Ajustar si la asignación se pasa del total disponible: recortar 5 min de
    // la tarjeta mayor repetidamente hasta encajar. Así el recorte se reparte
    // entre todas (no solo la mayor) y se respeta el suelo de 10 min/tarjeta.
    let totalAsign = minPorObra.reduce((s, m) => s + m, 0);
    let _recGuard = 0;
    while (totalAsign > totalMin && _recGuard++ < 500) {
      let idx = -1, max = 10;
      minPorObra.forEach((m, i) => { if (m > max) { max = m; idx = i; } });
      if (idx === -1) break; // todas en el mínimo: no se puede recortar más
      minPorObra[idx] -= 5;
      totalAsign -= 5;
    }

    html += `<div class="session-type-banner trabajo">
      <div class="session-type-title">Sesión de trabajo · ${totalMin} min</div>
      ${cargaTotal > 80 ? '<span style="color:var(--orange)">Carga alta — obras filtradas por dificultad</span>' : ''}
    </div>`;

    // Group consecutive movement entities under their parent obra header
    let lastObraIdSeen = null;
    currentPlanLocal.forEach((entity, i) => {
      if (entity._isMovimiento) {
        if (entity._obraId !== lastObraIdSeen) {
          // Emit a subtle obra-group header
          const obra = entity._obraRef || findObra(entity._obraId);
          const urgInfo = computeUrgencia(entity._obraId);
          const urgSpan = urgInfo.nivel !== 'sin-evento'
            ? ' <span style="font-size:9px;color:' + urgInfo.color + '">' + urgInfo.label + ' · ' + urgInfo.dias + 'd</span>'
            : '';
          html += '<div style="font-size:10px;color:var(--text3);letter-spacing:0.07em;text-transform:uppercase;'
            + 'padding:6px 4px 4px;margin-top:' + (lastObraIdSeen ? '10px' : '0') + ';'
            + 'border-top:' + (lastObraIdSeen ? '1px solid var(--border2)' : 'none') + '">'
            + '<span style="color:var(--text2);font-family:\"Cormorant Garamond\",serif;font-size:14px;text-transform:none">'
            + entity._parentName + '</span>'
            + (entity.composer ? ' <span style="font-size:9px;font-style:italic">' + entity.composer + '</span>' : '')
            + urgSpan + '</div>';
          lastObraIdSeen = entity._obraId;
        }
        html += renderMovimientoPlanItem(entity, i, minPorObra[i], selectedEnergy, cargaTotal);
      } else {
        lastObraIdSeen = null; // reset grouping context
        html += renderTrabajoItem(entity, i, minPorObra[i], selectedEnergy, cargaTotal, analizarPases(entity._obraId || entity.id));
      }
    });
  }

  currentPlan = currentPlanLocal;
  html += _planActionsHTML();

  const planDiv = document.getElementById('sessionPlan');
  planDiv.innerHTML = html;
  planDiv.classList.add('visible');
  planDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  ensureSessionPlanScaffold();
  saveDraft();
}

// ── RENDER HELPERS ────────────────────────────────────────────────────────────

function getLastConciertoPase(obra) {
  return (obra.paseHistory || []).find(p => p.tipo === 'concierto');
}

function renderMicropaseItem(obra, totalMin, tipoSug) {
  tipoSug = tipoSug || (obra.lib >= 4 ? 'concierto' : 'memoria');
  const minPlan = obra.duracion || totalMin || 20;
  sessionMinPlan[obra.id] = minPlan;
  return '<div class="plan-item" id="plan-' + obra.id + '" style="position:relative">' +
    '<button class="plan-item-remove" onclick="removeFromPlan(\'' + obra.id + '\')" title="Quitar de la sesión" aria-label="Quitar">×</button>' +
    '<div class="plan-item-top"><div class="plan-item-num">♩</div><div class="plan-item-content">' +
    '<div class="plan-item-name" onclick="openObraDetalleSession(\'' + obra.id + '\')" style="cursor:pointer;text-decoration:underline dotted var(--border)">' + obra.name + ' <span style="font-size:11px;color:var(--text3);font-style:italic">' + obra.composer + '</span></div>' +
    '<div class="plan-item-detail">pase ' + tipoSug + (obra.duracion ? ' · ' + obra.duracion + ' min' : '') + '</div></div>' +
    '<div class="plan-item-time">' + (obra.duracion || '?') + ' min</div></div>' +
    '<div class="tick-row"><button class="tick-btn" onclick="setTick(\'' + obra.id + '\',\'hecho\',this,' + minPlan + ')">✓ Hecho</button>' +
    '<button class="tick-btn tick-pase-btn" onclick="registerPase(\'' + obra.id + '\')">Pase</button>' +
    '<input class="tick-note" id="tnote-' + obra.id + '" type="text" placeholder="nota..."></div>' +
    renderSolRatingRow(obra.id) +
    '<div class="tick-min-row" id="tickmin-' + obra.id + '" style="display:none;margin-top:6px;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<span style="font-size:9px;color:var(--text3)">minutos reales:</span>' +
    '<input type="number" class="tick-min-input" id="tmin-' + obra.id + '" min="1" max="480" step="5" value="' + minPlan + '" placeholder="' + minPlan + '" oninput="updateMinDiff(\'' + obra.id + '\',' + minPlan + ');saveDraft()" style="width:58px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 7px;color:var(--accent);font-family:\'JetBrains Mono\',monospace;font-size:12px;text-align:center">' +
    '<span style="font-size:9px;color:var(--text3)">/ ' + minPlan + ' planif.</span>' +
    '<span id="tickmin-diff-' + obra.id + '" style="font-size:9px"></span></div></div>';
}

function renderMovimientoPlanItem(entity, i, minAsignado, energia, cargaTotal) {
  const planId = entity._planId;
  const fase = entity.fase || obraFase(entity);
  const urgObra = computeUrgencia(entity._obraId);

  // --- Sugerencia de actividad según fase del movimiento ---
  let actividad = '';
  let sugerencias = '';
  if (fase === 'digitando') {
    actividad = 'estudio · digitación';
    const pct = compasPercent(entity);
    if (pct !== null) sugerencias = 'cc. ' + (entity.compasActual || 0) + '/' + entity.compasesTotal + ' (' + pct + '%)';
  } else if (fase === 'consolidando') {
    const urgNivel = urgObra.nivel;
    const paseFirst = urgNivel === 'critico' || urgNivel === 'urgente' || i === 0;
    actividad = paseFirst ? 'pase · estudio' : 'estudio · pase';
    const sol = entity.sol || 1;
    sugerencias = 'sol ' + sol + '/10';
  } else {
    actividad = 'pase de mantenimiento';
    const sol = entity.sol || 1;
    sugerencias = 'sol ' + sol + '/10';
    if (entity.lastPase) {
      const dias = Math.floor((Date.now() - new Date(entity.lastPase)) / 86400000);
      sugerencias += ' · último ' + dias + 'd';
    }
  }

  // --- Badges ---
  const urgBadge = urgObra.nivel !== 'sin-evento'
    ? '<span style="font-size:9px;color:' + urgObra.color + ';margin-left:6px">' + urgObra.label + ' · ' + urgObra.dias + 'd</span>'
    : '';
  const lastTick = getLastTickForEntity(planId);
  const tickBadge = lastTick?.tick
    ? '<span style="font-size:10px;color:' + ({hecho:'var(--green)',parcial:'var(--orange)',saltado:'var(--red)'}[lastTick.tick]) + ';margin-left:4px">'
      + ({hecho:'✓',parcial:'≈',saltado:'✗'}[lastTick.tick]) + '</span>'
    : '';

  const faseLabel = obraFaseLabel(entity);
  const faseBadge = '<span style="font-size:8px;padding:1px 6px;border-radius:6px;background:' + faseLabel.color + '22;color:' + faseLabel.color + ';border:1px solid ' + faseLabel.color + '44">' + faseLabel.label + '</span>';

  sessionMinPlan[planId] = minAsignado;

  const minRow = '<div class="tick-min-row" id="tickmin-' + planId + '" style="display:none;margin-top:6px;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<span style="font-size:9px;color:var(--text3)">minutos reales:</span>'
    + '<input type="number" class="tick-min-input" id="tmin-' + planId + '" min="1" max="480" step="5" value="' + minAsignado + '"'
    + ' oninput="updateMinDiff(\'' + planId + '\',' + minAsignado + ');saveDraft()"'
    + ' style="width:58px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 7px;color:var(--accent);font-family:\'JetBrains Mono\',monospace;font-size:12px;text-align:center">'
    + '<span style="font-size:9px;color:var(--text3)">/ ' + minAsignado + ' planif.</span>'
    + '<span id="tickmin-diff-' + planId + '" style="font-size:9px"></span></div>';

  return '<div class="plan-item plan-item-mov" id="plan-' + planId + '" style="position:relative">'
    + '<button class="plan-item-remove" onclick="removeFromPlan(\'' + planId + '\')" title="Quitar de la sesión" aria-label="Quitar">×</button>'
    + '<div class="plan-item-top">'
    + '<div class="plan-item-num" style="font-size:11px;opacity:0.6">' + (i + 1) + '.</div>'
    + '<div class="plan-item-content">'
    // Parent obra subtitle
    + '<div style="font-size:9px;color:var(--text3);margin-bottom:3px;display:flex;align-items:center;gap:6px">'
    + '<span>' + entity._parentName + (entity.composer ? ' <em>· ' + entity.composer + '</em>' : '') + '</span>'
    + urgBadge + tickBadge
    + '</div>'
    // Movement name as title
    + '<div class="plan-item-name" style="font-size:16px">' + entity.name + '</div>'
    + '<div style="margin-top:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<div class="plan-item-detail" style="margin:0">' + actividad + (sugerencias ? ' · ' + sugerencias : '') + '</div>'
    + faseBadge
    + '</div>'
    + '</div>'
    + '<div class="plan-item-time" style="text-align:right"><div>~' + minAsignado + 'min</div>'
    + (entity.duracion ? '<div style="font-size:8px;color:var(--text3);margin-top:2px">' + entity.duracion + 'min mov.</div>' : '')
    + '</div>'
    + '</div>'
    // objetivo
    // tick buttons
    + '<div class="tick-row">'
    + '<button class="tick-btn" onclick="setTick(\'' + planId + '\',\'hecho\',this,' + minAsignado + ')">✓ Hecho</button>'
    + '<button class="tick-btn tick-pase-btn" onclick="registerPase(\'' + entity._obraId + '\'' + (entity._movId ? ',\'' + entity._movId + '\'' : '') + ')">Pase</button>'
    + '<input class="tick-note" id="tnote-' + planId + '" type="text" placeholder="nota...">'
    + '</div>'
    + renderSolRatingRow(planId)
    + minRow
    + '</div>';
}

function renderConciertoItem(obra, i, minDeadlineDays) {
  const lastConcierto = getLastConciertoPase(obra);
  const diasSinConcierto = lastConcierto ? Math.floor((Date.now() - new Date(lastConcierto.date)) / 86400000) : null;
  const minPlan = (obra.duracion || 8) + 2;
  sessionMinPlan[obra.id] = minPlan;
  return '<div class="plan-item" id="plan-' + obra.id + '" style="position:relative">' +
    '<button class="plan-item-remove" onclick="removeFromPlan(\'' + obra.id + '\')" title="Quitar de la sesión" aria-label="Quitar">×</button>' +
    '<div class="plan-item-top"><div class="plan-item-num">' + (i+1) + '.</div><div class="plan-item-content">' +
    '<div class="plan-item-name" onclick="openObraDetalleSession(\'' + obra.id + '\')" style="cursor:pointer;text-decoration:underline dotted var(--border)">' + obra.name + ' <span style="font-size:11px;color:var(--text3);font-style:italic">' + obra.composer + '</span></div>' +
    '<div class="plan-item-detail">pase completo' + (obra.duracion ? ' · ' + obra.duracion + ' min' : '') + (diasSinConcierto !== null ? ' · último ' + diasSinConcierto + 'd' : '') + '</div></div>' +
    '<div class="plan-item-time">' + (obra.duracion || '?') + ' min</div></div>' +
    '<div class="tick-row"><button class="tick-btn" onclick="setTick(\'' + obra.id + '\',\'hecho\',this,' + minPlan + ')">✓ Hecho</button>' +
    '<button class="tick-btn tick-pase-btn" onclick="registerPase(\'' + obra.id + '\')">Pase</button>' +
    '<input class="tick-note" id="tnote-' + obra.id + '" type="text" placeholder="nota..."></div>' +
    renderSolRatingRow(obra.id) +
    '<div class="tick-min-row" id="tickmin-' + obra.id + '" style="display:none;margin-top:6px;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<span style="font-size:9px;color:var(--text3)">minutos reales:</span>' +
    '<input type="number" class="tick-min-input" id="tmin-' + obra.id + '" min="1" max="480" step="5" value="' + minPlan + '" oninput="updateMinDiff(\'' + obra.id + '\',' + minPlan + ');saveDraft()" style="width:58px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 7px;color:var(--accent);font-family:\'JetBrains Mono\',monospace;font-size:12px;text-align:center">' +
    '<span style="font-size:9px;color:var(--text3)">/ ' + minPlan + ' planif.</span>' +
    '<span id="tickmin-diff-' + obra.id + '" style="font-size:9px"></span></div></div>';
}

function renderTrabajoItem(obra, i, minAsignado, energia, cargaTotal, paseAnalisis) {
  const pasajosActivos = (obra.pasajes || []).filter(p => p.status === 'activo');
  const fase = obraFase(obra);

  // ── Pase al principio: usa deadline POR OBRA ─────────────────────────────
  const urgObra = computeUrgencia(obra.id);
  const deadlineObra = urgObra.dias || 999;
  const paseAlPrincipio = (
    fase === 'mantenimiento' ||
    deadlineObra <= 7 ||
    (fase === 'consolidando' && energia === 'alta' && i === 0)
  );

  const tipoPaseBadge = '';

  let detailLines = [];

  if (fase === 'digitando') {
    detailLines.push('estudio');
    if (pasajosActivos.length) detailLines.push(pasajosActivos.map(p => {
      let t = p.text;
      if (p.tempoAct && p.tempoObj) t += ` (♩=${p.tempoAct}→${p.tempoObj})`;
      return t;
    }).join(', '));

  } else if (fase === 'consolidando') {
    if (paseAlPrincipio) {
      detailLines.push('pase · estudio');
      if (pasajosActivos.length) detailLines.push(pasajosActivos.slice(0,2).map(p => {
        let t = p.text;
        if (p.tempoAct && p.tempoObj) t += ` (♩=${p.tempoAct}→${p.tempoObj})`;
        return t;
      }).join(' · '));
    } else {
      detailLines.push('estudio · pase');
      if (pasajosActivos.length) detailLines.push(pasajosActivos.slice(0,2).map(p => {
        let t = p.text;
        if (p.tempoAct && p.tempoObj) t += ` (♩=${p.tempoAct}→${p.tempoObj})`;
        return t;
      }).join(', '));
    }

  } else { // mantenimiento/lista
    detailLines.push('pase · anotar');
    if (pasajosActivos.length) detailLines.push(pasajosActivos[0].text);
  }

  // Badges
  const urgInfo = computeUrgencia(obra.id);
  const urgBadge = urgInfo.nivel !== 'sin-evento'
    ? `<span style="font-size:9px;color:${urgInfo.color};margin-left:6px">${urgInfo.label} · ${urgInfo.dias}d</span>` : '';
  const lastTick = getLastTickForObra(obra.id);
  const tickBadge = lastTick?.tick
    ? `<span style="font-size:10px;color:${{hecho:'var(--green)',parcial:'var(--orange)',saltado:'var(--red)'}[lastTick.tick]};margin-left:6px">${{hecho:'✓',parcial:'≈',saltado:'✗'}[lastTick.tick]}</span>` : '';

  sessionMinPlan[obra.id] = minAsignado;
  return '<div class="plan-item" id="plan-' + obra.id + '" style="position:relative">' +
    '<button class="plan-item-remove" onclick="removeFromPlan(\'' + obra.id + '\')" title="Quitar de la sesión" aria-label="Quitar">×</button>' +
    '<div class="plan-item-top"><div class="plan-item-num">' + (i+1) + '.</div><div class="plan-item-content">' +
    '<div class="plan-item-name" onclick="openObraDetalleSession(\'' + obra.id + '\')" style="cursor:pointer;text-decoration:underline dotted var(--border)">' + obra.name + urgBadge + tickBadge + ' <span style="font-size:11px;color:var(--text3);font-style:italic">' + obra.composer + '</span></div>' +
    '</div>' +
    '<div class="plan-item-time" style="text-align:right"><div>~' + minAsignado + 'min</div>' +
    '</div></div>' +
    '<div class="tick-row"><button class="tick-btn" onclick="setTick(\'' + obra.id + '\',\'hecho\',this,' + minAsignado + ')">✓ Hecho</button>' +
    '<button class="tick-btn tick-pase-btn" onclick="registerPase(\'' + obra.id + '\')">Pase</button>' +
    '<input class="tick-note" id="tnote-' + obra.id + '" type="text" placeholder="nota..."></div>' +
    renderSolRatingRow(obra.id) +
    '<div class="tick-min-row" id="tickmin-' + obra.id + '" style="display:none;margin-top:6px;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<span style="font-size:9px;color:var(--text3)">minutos reales:</span>' +
    '<input type="number" class="tick-min-input" id="tmin-' + obra.id + '" min="1" max="480" step="5" value="' + minAsignado + '" oninput="updateMinDiff(\'' + obra.id + '\',' + minAsignado + ');saveDraft()" style="width:58px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 7px;color:var(--accent);font-family:\'JetBrains Mono\',monospace;font-size:12px;text-align:center">' +
    '<span style="font-size:9px;color:var(--text3)">/ ' + minAsignado + ' planif.</span>' +
    '<span id="tickmin-diff-' + obra.id + '" style="font-size:9px"></span></div></div>';
}

// ─── OBRAS ───────────────────────────────────────────────────────────────────

let obrasQuickFilter = 'all';
let obrasSearch = '';
let obrasEditMode = (() => {
  try { return localStorage.getItem('obras_edit_mode') === 'true'; }
  catch(e) { return false; }
})();
// Orden del listado: 'reciente' (orden de creación), 'solidez', 'horas'.
let obrasSort = (() => {
  try { return localStorage.getItem('obras_sort') || 'reciente'; }
  catch(e) { return 'reciente'; }
})();
// Densidad de las tarjetas: 'comodo' (por defecto), 'compacto' o 'mini'.
let obrasDensity = (() => {
  try {
    const v = localStorage.getItem('obras_density') || 'comodo';
    return ['comodo', 'compacto', 'mini'].includes(v) ? v : 'comodo';
  } catch(e) { return 'comodo'; }
})();
const OBRAS_DENSITIES = ['comodo', 'compacto', 'mini'];
// ¿Está desplegada la sección de "menores de 10 h"?
let obrasMinorOpen = (() => {
  try { return localStorage.getItem('obras_minor_open') === 'true'; }
  catch(e) { return false; }
})();
const OBRAS_MINOR_MIN = 600; // 10 horas en minutos

function setObrasSort(value) {
  obrasSort = value || 'reciente';
  try { localStorage.setItem('obras_sort', obrasSort); } catch(e) {}
  renderObras();
}

function toggleObrasDensity() {
  const i = OBRAS_DENSITIES.indexOf(obrasDensity);
  obrasDensity = OBRAS_DENSITIES[(i + 1) % OBRAS_DENSITIES.length];
  try { localStorage.setItem('obras_density', obrasDensity); } catch(e) {}
  renderObras();
}

// Icono del botón de densidad: nº de líneas crece según lo compacto que es.
function _obrasDensityIcon(level) {
  const rows = level === 'mini' ? [5, 9, 13, 17, 21] : level === 'compacto' ? [6, 12, 18] : [8, 16];
  const sw = level === 'mini' ? 1.4 : level === 'compacto' ? 1.7 : 2.1;
  const lines = rows.map(y => '<path d="M4 ' + y + 'h16"/>').join('');
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round">' + lines + '</svg>';
}

function toggleObrasMinor() {
  obrasMinorOpen = !obrasMinorOpen;
  try { localStorage.setItem('obras_minor_open', String(obrasMinorOpen)); } catch(e) {}
  renderObras();
}

// Mapa obraId → minutos totales dedicados, en UN solo pase sobre las sesiones
// (misma contabilidad que getMinutosObra: minutosExtra + items hechos/manuales).
function buildObraMinMap() {
  const map = {};
  (db.obras || []).forEach(o => { map[o.id] = o.minutosExtra || 0; });
  (db.sesiones || []).forEach(s => {
    (s.items || []).forEach(it => {
      const id = it.obraId;
      if (id == null || !(id in map)) return;
      let add = 0;
      if (it.manual && it.minutosEstudiados) add = it.minutosEstudiados;
      else if (it.tick === 'hecho' && it.minutosReales) add = it.minutosReales;
      else if (it.tick === 'hecho' && it.minutosPlan) add = it.minutosPlan;
      if (add) map[id] += add;
    });
  });
  // Las actividades acumulan su tiempo en sessionPlants (no en sesiones).
  if (Array.isArray(db.sessionPlants)) {
    db.sessionPlants.forEach(p => {
      if (!p || p.failed || !p.obraId || !(p.obraId in map)) return;
      // Sólo para entidades que no suman por sesiones (actividades).
      const o = (db.obras || []).find(x => x.id === p.obraId);
      if (o && o.tipo === 'actividad') map[p.obraId] += Math.max(0, Math.round(p.mins || 0));
    });
  }
  return map;
}

function setObrasSearch(value) {
  obrasSearch = value || '';
  renderObras();
}

function setObrasFilter(filter, btn) {
  obrasQuickFilter = filter || 'all';
  document.querySelectorAll('#obrasFilterBtns .obras-filter-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === obrasQuickFilter);
  });
  if (btn) btn.classList.add('active');
  renderObras();
}

function toggleObrasEditMode() {
  obrasEditMode = !obrasEditMode;
  try { localStorage.setItem('obras_edit_mode', String(obrasEditMode)); } catch(e) {}
  renderObras();
}

function obrasSearchText(o) {
  const parts = [o.name, o.composer, o.tipo];
  (o.movimientos || []).forEach(m => parts.push(m.name));
  (o.pasajes || []).forEach(p => parts.push(p.text));
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function obrasMatchesQuickFilter(o) {
  if (obrasQuickFilter === 'all') return true;
  if (obrasQuickFilter === 'actividades') return o.tipo === 'actividad';
  if (o.tipo === 'actividad') return false;
  // Filtros por solidez (única métrica)
  const pct = Math.round((estimateSolActual(o).val) || 0);
  if (obrasQuickFilter === 'fragiles') return pct < 50;
  if (obrasQuickFilter === 'solidas') return pct >= 72;
  return true;
}

function syncObrasToolbar(total, visible) {
  const view = document.getElementById('view-obras');
  if (view) view.classList.toggle('obras-edit-mode', obrasEditMode);
  const countEl = document.getElementById('obrasCount');
  if (countEl) {
    const base = total === 1 ? '1 obra' : total + ' obras';
    countEl.textContent = visible === total ? base : visible + ' de ' + base;
  }
  const editBtn = document.getElementById('obrasEditToggle');
  if (editBtn) {
    editBtn.classList.toggle('active', obrasEditMode);
    editBtn.textContent = obrasEditMode ? 'Editando' : 'Editar';
  }
  const searchEl = document.getElementById('obrasSearchInput');
  if (searchEl && searchEl.value !== obrasSearch) searchEl.value = obrasSearch;
  document.querySelectorAll('#obrasFilterBtns .obras-filter-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === obrasQuickFilter);
  });
  const sortEl = document.getElementById('obrasSortSelect');
  if (sortEl && sortEl.value !== obrasSort) sortEl.value = obrasSort;
  const densEl = document.getElementById('obrasDensityToggle');
  if (densEl) {
    densEl.classList.toggle('active', obrasDensity !== 'comodo');
    const next = { comodo: 'compactar', compacto: 'minimizar', mini: 'ampliar' }[obrasDensity];
    const cur = { comodo: 'cómodas', compacto: 'compactas', mini: 'mini' }[obrasDensity];
    densEl.title = 'Tarjetas ' + cur + ' · toca para ' + next;
    densEl.innerHTML = _obrasDensityIcon(obrasDensity);
  }
}

function renderObras() {
  const list = document.getElementById('obrasList');
  const filtroEl = document.getElementById('filtroEvento');

  // Populate filter dropdown
  const now = Date.now();
  const eventosActivos = (db.eventos || []).filter(ev => new Date(ev.fecha) > now - 86400000)
    .sort((a,b) => new Date(a.fecha) - new Date(b.fecha));
  const filtroActual = filtroEl ? filtroEl.value : '';
  if (filtroEl) {
    filtroEl.innerHTML = '<option value="">Todas las obras</option>' +
      eventosActivos.map(ev => `<option value="${ev.id}" ${ev.id===filtroActual?'selected':''}>${ev.nombre}</option>`).join('');
    filtroEl.value = filtroActual;
  }

  const totalObras = (db.obras || []).length;
  let obras = db.obras || [];
  if (filtroActual) {
    const ev = db.eventos.find(e => e.id === filtroActual);
    if (ev) obras = obras.filter(o => ev.obras.includes(o.id));
  }
  const q = (obrasSearch || '').trim().toLowerCase();
  if (q) obras = obras.filter(o => obrasSearchText(o).includes(q));
  obras = obras.filter(obrasMatchesQuickFilter);
  syncObrasToolbar(totalObras, obras.length);

  // Densidad de las tarjetas como clase del contenedor.
  list.classList.toggle('compact', obrasDensity === 'compacto');
  list.classList.toggle('mini', obrasDensity === 'mini');
  const renderCard = obrasDensity === 'mini'
    ? (o) => renderObraCardMini(o)
    : (o, idx) => renderObraCard(o, idx);

  if (!obras.length) {
    if (totalObras) {
      list.innerHTML = emptyStateHTML(ICON_SEARCH_EMPTY, 'Nada por aquí', 'Prueba con otro filtro o búsqueda.');
    } else {
      list.innerHTML = emptyStateHTML(ICON_SPROUT, 'Tu repertorio está vacío',
        'Añade tu primera obra para empezar a medir su solidez.');
    }
    return;
  }

  const minMap = buildObraMinMap();

  // Orden seleccionado (no muta db.obras: copia para ordenar).
  if (obrasSort === 'horas') {
    obras = obras.slice().sort((a, b) => (minMap[b.id] || 0) - (minMap[a.id] || 0));
  } else if (obrasSort === 'solidez') {
    obras = obras.slice().sort((a, b) =>
      (estimateSolActual(b).val || 0) - (estimateSolActual(a).val || 0));
  }

  // Agrupar "menores de 10 h" en una sección colapsable al final. Se desactiva
  // al buscar/filtrar (para no esconder resultados) y sólo se aplica si hay a la
  // vez obras mayores y menores, para no dejar la lista principal vacía.
  const grouping = !q && !filtroActual;
  const isMinor = o => o.tipo !== 'actividad' && (minMap[o.id] || 0) < OBRAS_MINOR_MIN;
  let mayores = obras, menores = [];
  if (grouping) {
    mayores = obras.filter(o => !isMinor(o));
    menores = obras.filter(isMinor);
    if (!mayores.length || !menores.length) { mayores = obras; menores = []; }
  }

  let html = mayores.map((o, idx) => renderCard(o, idx)).join('');

  if (menores.length) {
    const caret = obrasMinorOpen ? '▾' : '▸';
    html += '<div class="obras-minor-section">'
      + '<button class="obras-minor-header' + (obrasMinorOpen ? ' open' : '') + '"'
      + ' onclick="toggleObrasMinor()" aria-expanded="' + obrasMinorOpen + '">'
      +   '<span class="obras-minor-caret">' + caret + '</span>'
      +   '<span class="obras-minor-title">Menores de 10 h</span>'
      +   '<span class="obras-minor-count">' + menores.length + '</span>'
      + '</button>';
    if (obrasMinorOpen) {
      html += '<div class="obras-minor-body">'
        + menores.map((o, idx) => renderCard(o, idx)).join('')
        + '</div>';
    }
    html += '</div>';
  }

  list.innerHTML = html;
}

// Render simplificado para actividades (lectura a primera vista, técnica, etc.)
// Sólo muestra nombre, color, minutos totales acumulados, y botones edit/del.
function renderActividadCard(o, idx) {
  // Minutos totales: minutosExtra (de Forest o registros antiguos) + suma de
  // sub-sesiones de db.sessionPlants con este obraId.
  let totalMin = o.minutosExtra || 0;
  if (Array.isArray(db.sessionPlants)) {
    db.sessionPlants.forEach(p => {
      if (p.obraId === o.id && !p.failed) totalMin += (p.mins || 0);
    });
  }
  const horas = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const tiempoTxt = horas > 0
    ? horas + 'h' + (mins ? ' ' + mins + 'm' : '')
    : totalMin + ' min';
  const colorHex = obraColorHex(o);
  return `
    <div class="obra-card actividad-card" id="obra-${o.id}">
      <div class="obra-header" onclick="toggleObra('${o.id}')" style="padding:14px 12px">
        <button class="obra-color-dot" title="Cambiar color"
          onclick="event.stopPropagation();openObraColorPicker('${o.id}')"
          style="background:${colorHex || 'transparent'};border-color:${colorHex || 'var(--border2)'};margin-right:8px"></button>
        <div class="obra-name" id="obra-name-display-${o.id}" style="flex:1">
          ${o.name}
          <span style="font-size:8px;background:var(--bg3);color:var(--text3);border-radius:3px;padding:1px 5px;margin-left:6px;letter-spacing:0.04em;text-transform:uppercase">Actividad</span>
        </div>
        <span style="font-size:11px;color:var(--text3);font-family:'JetBrains Mono',monospace;margin-right:8px">${tiempoTxt}</span>
        <button class="obra-quick-btn edit obra-edit-action" title="Editar nombre" onclick="event.stopPropagation();openEditObraNombre('${o.id}')">${ICON_EDIT}</button>
        <button class="obra-quick-btn delete obra-edit-action" title="Eliminar actividad" onclick="event.stopPropagation();confirmDeleteObra('${o.id}')">${ICON_DELETE}</button>
      </div>
    </div>
  `;
}

function obraMapLatestZone(entity) {
  const zone = entity?.currentZone || (entity?.zoneHistory && entity.zoneHistory[0]) || null;
  return zoneSummaryText(zone);
}

function obraMapSolPercent(entity) {
  if (!entity) return null;
  if (entity.solHistory && entity.solHistory[0]) return normalizeSolVal(entity.solHistory[0].val);
  const raw = entity.sol;
  if (raw == null || raw <= 1) return null;
  return normalizeSolVal(raw);
}

function obraMapStageLabel(entity) {
  const zone = entity?.currentZone || (entity?.zoneHistory && entity.zoneHistory[0]) || null;
  if (zone?.stageLabel) return zone.stageLabel;
  return aprendizajeStageMeta(aprendizajeStageFromEntity(entity)).label;
}

function renderObraMap(o) {
  if (!o || o.tipo === 'actividad') return '';
  const movs = (o.movimientos || []).filter(Boolean);
  const activePasajes = (o.pasajes || []).filter(p => p.status !== 'resuelto');

  if (movs.length) {
    const totalWeight = movs.reduce((s, m) => s + (m.compasesTotal || m.duracion || 1), 0) || movs.length;
    const segments = movs.map(m => {
      const pctRaw = compasPercent(m);
      const learned = pctRaw != null ? pctRaw : Math.min(100, aprFromCompas(m) * 10);
      const fl = obraFaseLabel(m);
      const weight = (m.compasesTotal || m.duracion || 1) / totalWeight;
      return '<div class="obra-map-segment" style="flex:' + weight + ';--map-color:' + fl.color + '" title="' +
        escapeHtmlSafe(m.name + ' ' + learned + '%') + '"><span style="width:' + learned + '%"></span></div>';
    }).join('');
    const rows = movs.map((m, i) => {
      const pctRaw = compasPercent(m);
      const learned = pctRaw != null ? pctRaw + '%' : (aprFromCompas(m) * 10) + '%';
      const fl = obraFaseLabel(m);
      const zone = obraMapLatestZone(m);
      const solPct = obraMapSolPercent(m);
      const solText = pctRaw === 100 || (pctRaw == null && aprFromCompas(m) >= 10)
        ? (solPct != null ? solPct + '%' : 'sin medir')
        : 'pendiente';
      return '<div class="obra-map-row">' +
        '<span><i style="background:' + fl.color + '"></i>' + escapeHtmlSafe(m.name || ('Mov. ' + (i + 1))) + '</span>' +
        '<strong>' + learned + '</strong>' +
        '<em>' + escapeHtmlSafe(obraMapStageLabel(m)) + '</em>' +
        '<small>' + escapeHtmlSafe(zone || 'sin zona') + '</small>' +
        '<small>sol ' + escapeHtmlSafe(solText) + '</small>' +
      '</div>';
    }).join('');
    return '<div class="obra-map">' +
      '<div class="obra-map-head"><span>Mapa de obra</span><strong>' + movs.length + ' movimientos</strong></div>' +
      '<div class="obra-map-bar">' + segments + '</div>' +
      '<div class="obra-map-rows">' + rows + '</div>' +
    '</div>';
  }

  const pct = compasPercent(o);
  const learned = pct != null ? pct : Math.min(100, aprFromCompas(o) * 10);
  const fl = obraFaseLabel(o);
  const zone = obraMapLatestZone(o);
  const solPct = obraMapSolPercent(o);
  const solReady = pct === 100 || (pct == null && aprFromCompas(o) >= 10);
  const solText = solReady
    ? (solPct != null ? solPct + '%' : 'sin medir')
    : 'pendiente hasta aprenderla';
  const compasText = o.compasesTotal
    ? ((o.compasActual || 0) + '/' + o.compasesTotal + ' cc.')
    : 'sin compases definidos';
  return '<div class="obra-map">' +
    '<div class="obra-map-head"><span>Mapa de estudio</span><strong>' + learned + '%</strong></div>' +
    '<div class="obra-map-single" style="--map-color:' + fl.color + '"><span style="width:' + learned + '%"></span></div>' +
    '<div class="obra-map-rows">' +
      '<div class="obra-map-row"><span><i style="background:' + fl.color + '"></i>Avance</span><strong>' + escapeHtmlSafe(compasText) + '</strong><em>' + escapeHtmlSafe(obraMapStageLabel(o)) + '</em><small>' + escapeHtmlSafe(zone || 'sin zona') + '</small></div>' +
      '<div class="obra-map-row"><span><i></i>Pasajes activos</span><strong>' + activePasajes.length + '</strong><em>' + (activePasajes.length ? 'seguimiento' : 'limpio') + '</em><small>' + escapeHtmlSafe(activePasajes[0]?.text || 'sin pasaje activo') + '</small></div>' +
      '<div class="obra-map-row"><span><i></i>Solidez</span><strong>' + escapeHtmlSafe(solText) + '</strong><em>' + (solReady ? 'medible' : 'secundaria') + '</em><small>' + (solReady ? 'pase o registro rapido' : 'primero avance') + '</small></div>' +
    '</div>' +
  '</div>';
}

function refreshObraMap(obraId) {
  const card = document.getElementById('obra-' + obraId);
  const obra = findObra(obraId);
  const current = card?.querySelector('.obra-map');
  if (!card || !obra || !current) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderObraMap(obra);
  const next = tmp.firstElementChild;
  if (next) current.replaceWith(next);
}

function obraHeaderProgress(entity) {
  if (!entity || entity.tipo === 'actividad') return '';
  const pct = compasPercent(entity);
  if (pct != null) return pct + '%';
  const apr = aprFromCompas(entity);
  if (!entity.compasesTotal && apr <= 1) return '';
  return Math.min(100, apr * 10) + '%';
}

function obraNextAction(o, eff) {
  if (!o) return '';
  if (o.tipo === 'actividad') return 'registrar tiempo';
  const activePasajes = (o.pasajes || []).filter(p => p.status !== 'resuelto');
  if (activePasajes.length) return activePasajes.length === 1 ? 'trabajar pasaje' : activePasajes.length + ' pasajes activos';
  const fase = obraFase(eff || o);
  if (fase === 'digitando') {
    const pct = compasPercent(eff || o);
    if (pct != null && pct < 100) return 'seguir avance';
    return 'definir compases';
  }
  if (fase === 'consolidando') return 'pase en frio';
  if (fase === 'mantenimiento') return 'mantener';
  return 'revisar';
}

function renderObraDetailTabs(obraId) {
  return '<div class="obra-detail-tabs">' +
    '<button class="obra-tab-btn active" data-tab="resumen" onclick="setObraDetailTab(\'' + obraId + '\',\'resumen\',this)">Resumen</button>' +
    '<button class="obra-tab-btn" data-tab="editar" onclick="setObraDetailTab(\'' + obraId + '\',\'editar\',this)">Editar</button>' +
    '<button class="obra-tab-btn" data-tab="estructura" onclick="setObraDetailTab(\'' + obraId + '\',\'estructura\',this)">Estructura</button>' +
    '<button class="obra-tab-btn" data-tab="seguimiento" onclick="setObraDetailTab(\'' + obraId + '\',\'seguimiento\',this)">Seguimiento</button>' +
  '</div>';
}

function setObraDetailTab(obraId, tab, btn) {
  const card = document.getElementById('obra-' + obraId);
  if (!card) return;
  card.querySelectorAll('.obra-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  card.querySelectorAll('.obra-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
  if (btn) btn.classList.add('active');
}

function renderObraCard(o, idx) {
  // ── ACTIVIDADES: render simplificado ────────────────────────────────
  if (o.tipo === 'actividad') {
    return renderActividadCard(o, idx);
  }
  // ── TARJETA SIMPLE (solidez como única métrica) ─────────────────────
  return renderObraCardSimple(o);
}

// ── TARJETA MINI (densidad máxima) ──────────────────────────────────────
// Una sola fila: color · título · compositor · barra de solidez · %.
// Sin dificultad, duración, urgencia, etiquetas ni botón de evolución.
function renderObraCardMini(o) {
  const colorHex = obraColorHex(o);
  const dot = '<button class="obra-color-dot" title="Color"'
    + ' onclick="event.stopPropagation();openObraColorPicker(\'' + o.id + '\')"'
    + ' style="background:' + (colorHex || 'transparent') + ';border-color:' + (colorHex || 'var(--border2)') + '"></button>';
  const del = '<button class="obra-quick-btn delete obra-edit-action" title="Eliminar"'
    + ' onclick="event.stopPropagation();confirmDeleteObra(\'' + o.id + '\')">' + ICON_DELETE + '</button>';

  if (o.tipo === 'actividad') {
    return '<div class="obra-card obra-card-mini" id="obra-' + o.id + '">'
      + dot
      + '<span class="obra-mini-name" style="flex:1">' + escapeHtmlSafe(o.name) + '</span>'
      + '<span class="obra-mini-comp">actividad</span>'
      + del
      + '</div>';
  }

  const composer = (o.composer && o.composer !== '—')
    ? '<span class="obra-mini-comp">' + escapeHtmlSafe(o.composer) + '</span>' : '';
  const est = estimateSolActual(o);
  const pct = Math.max(0, Math.min(100, Math.round(est.val || 0)));
  const col = solPctColor(pct);
  const hasHist = (o.solHistory || []).length > 0;
  return '<div class="obra-card obra-card-mini" id="obra-' + o.id + '">'
    + dot
    + '<button class="obra-mini-main" onclick="registerPase(\'' + o.id + '\',null)">'
    +   '<span class="obra-mini-name">' + escapeHtmlSafe(o.name) + '</span>'
    +   composer
    +   '<span class="obra-mini-bar"><span class="obra-mini-fill" style="width:' + pct + '%;background:' + col + '"></span></span>'
    +   '<span class="obra-mini-pct" style="color:' + (hasHist ? col : 'var(--text3)') + '">' + (hasHist ? pct : '—') + '</span>'
    + '</button>'
    + del
    + '</div>';
}

// Obra recién medida: su barra de solidez hace un pulso al re-renderizar.
let _justMeasuredObraId = null;

// Iconos de trazo (reemplazan glifos emoji ✎/✕ — más limpios y coherentes)
const ICON_EDIT = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.3 13.2 5.1a1.5 1.5 0 0 1 2.1 0l.6.6a1.5 1.5 0 0 1 0 2.1L6.7 17 3 17.5z"/><path d="M11.8 6.5 14.5 9.2"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M8 6V4.6A1.6 1.6 0 0 1 9.6 3h.8A1.6 1.6 0 0 1 12 4.6V6"/><path d="M6.5 6 7 15.6a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9L13.5 6"/></svg>';

// Ilustraciones de trazo para estados vacíos
const ICON_SPROUT = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M24 42V22"/><path d="M24 28C24 22 19 17 12 17C12 23 17 28 24 28Z"/><path d="M24 24C24 18 29 13 36 13C36 19 31 24 24 24Z"/></svg>';
const ICON_SEARCH_EMPTY = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="21" cy="21" r="12"/><path d="M30 30l8 8"/></svg>';
const ICON_STAR = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M24 8l4.6 9.3 10.3 1.5-7.4 7.3 1.7 10.2L24 31.3l-9.2 4.8 1.7-10.2-7.4-7.3 10.3-1.5z"/></svg>';
const ICON_CALENDAR_EMPTY = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="11" width="30" height="29" rx="3"/><path d="M9 19h30M17 7v8M31 7v8"/></svg>';

function emptyStateHTML(icon, title, sub) {
  return '<div class="empty-state">'
    + '<div class="empty-state-icon">' + icon + '</div>'
    + '<div class="empty-state-title">' + escapeHtmlSafe(title) + '</div>'
    + (sub ? '<div class="empty-state-sub">' + escapeHtmlSafe(sub) + '</div>' : '')
    + '</div>';
}

// Tarjeta de obra minimalista: nombre, compositor, dificultad, duración y
// SOLIDEZ (única métrica). Tocar la barra de solidez abre el medidor rápido.
// Anillo de progreso reutilizable (medidor circular). Usado por el tema Swiss
// en la solidez de las obras y en los tiles de proyección 4 h / 5 h.
function _ringMeterSVG(pct, col, opts) {
  opts = opts || {};
  const size = opts.size || 60, sw = opts.stroke || 6;
  const r = (size - sw) / 2, cx = size / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0));
  const off = c * (1 - p / 100);
  const fs = opts.centerSize || Math.round(size * 0.30);
  const center = (opts.center != null) ? opts.center : String(Math.round(p));
  return '<svg class="ring-meter" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">'
    + '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="var(--bg3)" stroke-width="' + sw + '"/>'
    + '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '"'
    + ' stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"'
    + ' transform="rotate(-90 ' + cx + ' ' + cx + ')"/>'
    + '<text x="' + cx + '" y="' + (cx + fs * 0.34) + '" text-anchor="middle" font-size="' + fs + '"'
    + ' font-weight="800" fill="' + (opts.textColor || 'var(--text)') + '"'
    + ' font-family="-apple-system,Helvetica Neue,Arial,sans-serif">' + center + '</text>'
    + '</svg>';
}

function renderObraCardSimple(o) {
  const dif = o.dificultad || 3;
  const difBadge = '<span class="dif-badge d' + dif + '" title="Dificultad ' + dif + '/10">' + dif + '</span>';
  const colorHex = obraColorHex(o);
  const composer = (o.composer && o.composer !== '—')
    ? '<span class="obra-simple-composer">' + escapeHtmlSafe(o.composer) + '</span>' : '';
  const durTxt = o.duracion ? o.duracion + ' min' : '';

  // Solidez actual estimada (con decaimiento si lleva días sin tocarse)
  const est = estimateSolActual(o);
  const pct = Math.max(0, Math.min(100, Math.round(est.val || 0)));
  const col = solPctColor(pct);
  const hasHist = (o.solHistory || []).length > 0;
  // Pulso de la barra si esta obra se acaba de medir
  const pulse = (o.id === _justMeasuredObraId);
  if (pulse) _justMeasuredObraId = null;
  const decayHint = (hasHist && est.decaying && est.diasGap >= 4)
    ? '<span class="obra-simple-decay" title="Estimada por el tiempo sin tocarla">▾ ' + est.diasGap + 'd</span>'
    : '';

  // Urgencia por evento próximo (se conserva: es un empujón útil)
  let urgPill = '';
  const urg = computeUrgencia(o.id);
  if (urg && urg.nivel && urg.nivel !== 'sin-evento') {
    urgPill = '<span class="obra-simple-urg ' + urg.nivel + '">' + urg.dias + 'd · ' + escapeHtmlSafe(urg.evento.nombre) + '</span>';
  }

  return ''
    + '<div class="obra-card obra-card-simple" id="obra-' + o.id + '">'
    +   '<div class="obra-simple-head">'
    +     '<button class="obra-color-dot" title="Color"'
    +       ' onclick="openObraColorPicker(\'' + o.id + '\')"'
    +       ' style="background:' + (colorHex || 'transparent') + ';border-color:' + (colorHex || 'var(--border2)') + '"></button>'
    +     '<div class="obra-simple-id">'
    +       '<div class="obra-title-line"><span class="obra-name">' + escapeHtmlSafe(o.name) + '</span>' + difBadge + '</div>'
    +       '<div class="obra-simple-meta">' + composer + (durTxt ? '<span>' + durTxt + '</span>' : '') + urgPill + '</div>'
    +     '</div>'
    +     '<button class="obra-quick-btn edit obra-edit-action" title="Editar" onclick="openEditObraNombre(\'' + o.id + '\')">' + ICON_EDIT + '</button>'
    +     '<button class="obra-quick-btn delete obra-edit-action" title="Eliminar" onclick="confirmDeleteObra(\'' + o.id + '\')">' + ICON_DELETE + '</button>'
    +   '</div>'
    +   '<button class="obra-simple-sol' + (pulse ? ' pulse' : '') + '" onclick="registerPase(\'' + o.id + '\',null)">'
    +     '<div class="obra-sol-ring">' + _ringMeterSVG(pct, col, { size: 62, stroke: 6, center: hasHist ? Math.round(pct) : '–', textColor: col }) + '</div>'
    +     '<div class="obra-sol-bar"><div class="obra-sol-fill" style="width:' + pct + '%;background:' + col + '"></div></div>'
    +     '<div class="obra-sol-row">'
    +       '<strong style="color:' + col + '">' + (hasHist ? pct + '%' : '—') + '</strong>'
    +       '<span class="obra-sol-label">' + (hasHist ? solPctLabel(pct) : 'Primer pase pendiente') + '</span>'
    +       decayHint +
        '<span class="obra-sol-medir">Pase ›</span>'
    +     '</div>'
    +   '</button>'
    +   (hasHist ? _obraPredHint(o, pct) : '')
    +   '<button class="obra-simple-graph" onclick="openGrafico(\'' + o.id + '\',null)">Evolución ↗</button>'
    + '</div>';
}

function renderObraCard_LEGACY(o, idx) {
  const eff = obraEffectiveStats(o);  // use weighted stats if movimientos present
  const pasajosHtml = (o.pasajes || []).map(p => renderPasajeItem(o.id, p)).join('');

  const lastPaseText = o.lastPase
    ? `Último pase: ${new Date(o.lastPase).toLocaleDateString('es-ES')}`
    : 'Sin pase registrado aún';

  // Tendencia desde sesiones guardadas
  const recentTicks = db.sesiones.flatMap(s => (s.items||[]).filter(i => i.obraId === o.id)).slice(-5);
  let tendencia = '';
  if (recentTicks.length >= 2) {
    const last3 = recentTicks.slice(-3).map(r => r.tick);
    if (last3.length === 3 && last3.every(t => t === 'hecho')) tendencia = '<span class="obra-tendencia" style="color:var(--green)">↑ racha</span>';
    else if (last3.filter(t => t === 'saltado').length >= 2) tendencia = '<span class="obra-tendencia" style="color:var(--red)">↓ atención</span>';
  }

  const origenTag = o.origen === 'recuperacion'
    ? '<span class="origen-tag recuperacion">Recuperación</span>'
    : '';

  const tipoIcons = { solo: 'solo', informal: 'amigos', evento: 'evento', escena: 'evento', tecnico: 'tec', memoria: 'mem', concierto: 'evento' };
  const paseHistHtml = (o.paseHistory||[]).slice(0,5).map(p => {
    const d = new Date(p.date).toLocaleDateString('es-ES',{day:'numeric',month:'short'});
    const sc = p.score ?? null;
    const col = sc !== null ? scoreColor(sc) : 'var(--text3)';
    const val = sc !== null ? sc : (p.quality === 'bien' ? '✓' : p.quality === 'regular' ? '≈' : p.quality === 'mal' ? '✗' : '—');
    const tipoLabel = p.tipo ? `<span style="color:var(--text3);font-size:8px;background:var(--bg2);border-radius:3px;padding:1px 4px;margin-left:2px">${tipoIcons[p.tipo]||p.tipo}</span>` : '';
    return `<div style="display:flex;gap:8px;font-size:9px;color:var(--text3);padding:4px 0;border-bottom:1px solid var(--border2);align-items:center">
      <span style="color:${col};font-weight:bold;min-width:14px">${val}</span>
      ${tipoLabel}
      <span>${d}</span>
      ${p.note ? `<span style="color:var(--text3)">· ${p.note}</span>` : ''}
    </div>`;
  }).join('');

  const dif = eff.dificultad || 3;
  const difBadge = `<span class="dif-badge d${dif}" title="Dificultad ${dif}/10">${dif}</span>`;
  const duracion = eff.duracion || '';

  const hasMovs = o.movimientos && o.movimientos.length > 0;
  const headerProgress = obraHeaderProgress(eff);
  const headerZone = obraMapLatestZone(o);
  const nextAction = obraNextAction(o, eff);
  const composerLine = o.composer && o.composer !== '—'
    ? '<span class="obra-composer">' + escapeHtmlSafe(o.composer) + '</span>'
    : '';

  // Urgencia block (shared)
  const urgBlock = (() => {
    const urg = computeUrgencia(o.id);
    if (urg.nivel === 'sin-evento') return '';
    const ev = urg.evento;
    return `<div class="urgencia-computed ${urg.nivel}" style="margin-top:8px">
      <span style="font-weight:bold">${urg.label}</span>
      <span style="opacity:0.7">·</span>
      <span>${ev.nombre} · ${urg.dias}d</span>
    </div>`;
  })();

  // Movimientos HTML
  const movimientosHtml = `
    <div class="movimientos-section">
      <div id="movimientos-${o.id}">
        ${(o.movimientos||[]).map(mov => renderMovimientoCard(o.id, mov)).join('')}
      </div>
      <button class="add-movimiento-btn" onclick="addMovimiento('${o.id}')">+ añadir movimiento</button>
    </div>`;

  const durDisplay = eff.duracion || '';

  // Dificultad inline buttons (only shown when no movements — movements have their own)
  const difInline = [1,2,3,4,5,6,7,8,9,10].map(n => {
    const active = (eff.dificultad || 3) === n;
    const col = DIF_COLORS_MAP[n];
    return `<button class="dif-num-btn d${n} ${active?'active':''}"
      style="${active ? 'background:'+col+';border-color:'+col+';color:#fff' : ''}"
      onclick="setDificultadInline('${o.id}',${n},this)">${n}</button>`;
  }).join('');

  const nextActionHtml = `
    <div class="obra-next-card">
      <span>Ahora</span>
      <strong>${escapeHtmlSafe(nextAction || 'revisar')}</strong>
      ${headerZone ? `<em>${escapeHtmlSafe(headerZone)}</em>` : `<em>sin zona</em>`}
    </div>`;

  return `
    <div class="obra-card" id="obra-${o.id}">
      <div class="obra-header" onclick="toggleObra('${o.id}')">
        <button class="obra-color-dot obra-fase-${obraFase(eff)}" title="Cambiar color"
          onclick="event.stopPropagation();openObraColorPicker('${o.id}')"
          style="background:${obraColorHex(o) || 'transparent'};border-color:${obraColorHex(o) || 'var(--border2)'}"></button>
        <div class="obra-name obra-name-stack" id="obra-name-display-${o.id}">
          <div class="obra-title-line"><span>${escapeHtmlSafe(o.name)}</span>${origenTag}${difBadge}${tendencia}</div>
          <div class="obra-card-meta">
            ${composerLine}
            ${headerProgress ? `<span>avance ${headerProgress}</span>` : ''}
            ${headerZone ? `<span>${escapeHtmlSafe(headerZone)}</span>` : ''}
            ${nextAction ? `<span>${escapeHtmlSafe(nextAction)}</span>` : ''}
          </div>
        </div>
        <div class="obra-scores">
          ${durDisplay ? `<span style="font-size:9px;color:var(--text3)">${durDisplay}m</span>` : ''}
          ${hasMovs ? `<span style="font-size:8px;color:var(--accent);background:var(--bg3);border-radius:3px;padding:1px 5px;margin-left:2px">${o.movimientos.length} mov</span>` : ''}
        </div>
        <button class="obra-quick-btn edit obra-edit-action" title="Editar nombre" onclick="event.stopPropagation();openEditObraNombre('${o.id}')">✎</button>
        <button class="obra-quick-btn delete obra-edit-action" title="Eliminar obra" onclick="event.stopPropagation();confirmDeleteObra('${o.id}')">✕</button>
        <div class="obra-chevron">▼</div>
      </div>
      <div class="obra-detail">
        ${renderObraDetailTabs(o.id)}
        <div class="obra-tab-panel active" data-tab="resumen">

        <!-- Estado derivado + evolución -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 12px">
          ${(() => {
            const fl = obraFaseLabel(eff);
            const hasPct = fl.label && fl.label.includes('%');
            return `<span class="estado-badge${hasPct ? ' con-pct' : ''}" style="background:${fl.color}22;color:${fl.color};border:1px solid ${fl.color}44">${fl.label}</span>`;
          })()}
          ${hasMovs ? `<span style="font-size:9px;color:var(--text3)">(media ponderada por duración)</span>` : ''}
          <button class="diagnose-btn" onclick="openGrafico('${o.id}',null)">Evolución ↗</button>
        </div>

        ${renderObraMap(o)}
        ${nextActionHtml}
        ${urgBlock}
        </div>
        <div class="obra-tab-panel" data-tab="editar">

        <!-- Dificultad + Duración (solo sin movimientos) -->
        ${!hasMovs ? `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div>
            <div style="font-size:8px;color:var(--text3);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">Dificultad</div>
            <div class="dif-num-row" id="dif-inline-${o.id}" style="gap:3px">${difInline}</div>
          </div>
          <div>
            <div style="font-size:8px;color:var(--text3);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">Duración</div>
            <div style="display:flex;align-items:center;gap:4px">
              <input class="duracion-field" type="number" min="1" max="90"
                value="${o.duracion||''}" placeholder="min"
                onblur="setDuracion('${o.id}',this.value)"
                style="width:52px">
              <span style="font-size:9px;color:var(--text3)">min</span>
            </div>
          </div>
        </div>

        <!-- Escalas APR (solo sin movimientos). Sol/Esc en display readonly -->
        <div class="obra-scales">
          ${renderCompasWidget(o.id, null, o)}
          <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
          ${['sol','esc'].map((key, idx2) => {
            const labels = ['Solidez','Escena'];
            const descs  = ['de sesiones y pasajes','de pases en escena'];
            const val = o[key] || 1;
            const baseColor = key === 'sol' ? '#c8a030' : 'var(--green)';
            const stateLabel = key === 'sol' ? solLabel(val) : escLabel(val);
            return `<div class="readonly-scale-card" style="flex:1;min-width:130px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:8px 10px">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:10px;color:var(--text2);font-weight:500">${labels[idx2]}</span>
                <span style="font-size:16px;font-family:'Cormorant Garamond',serif;color:${baseColor}">${val}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                <span style="font-size:8px;color:var(--text3);font-style:italic">${descs[idx2]}</span>
                <span style="font-size:8px;padding:1px 5px;border-radius:6px;background:${baseColor}1a;color:${baseColor};border:1px solid ${baseColor}33;white-space:nowrap">${stateLabel.label}</span>
              </div>
            </div>`;
          }).join('')}
          </div>
        </div>` : `
        <!-- Summary when has movements -->
        <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          ${(() => {
            const pct = compasPercent(eff);
            const aprDisplay = pct !== null ? pct + '%' : (eff.apr || 1);
            const aprColor   = compasBarColor(pct);
            return `<div style="text-align:center;background:var(--bg3);border-radius:6px;padding:6px 10px;min-width:60px">
              <div style="font-size:18px;color:${aprColor};font-family:'Cormorant Garamond',serif">${aprDisplay}</div>
              <div style="font-size:8px;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase;margin-top:2px">Aprendido</div>
            </div>`;
          })()}
          ${['sol','esc'].map((key, idx2) => {
            const labels = ['Solidez','Escena'];
            const colors = ['var(--accent)','var(--green)'];
            const val = eff[key] || 1;
            return `<div style="text-align:center;background:var(--bg3);border-radius:6px;padding:6px 10px;min-width:60px">
              <div style="font-size:18px;color:${colors[idx2]};font-family:'Cormorant Garamond',serif">${val}</div>
              <div style="font-size:8px;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase;margin-top:2px">${labels[idx2]}</div>
            </div>`;
          }).join('')}
          <div style="text-align:center;background:var(--bg3);border-radius:6px;padding:6px 10px;min-width:60px">
            <div style="font-size:18px;color:var(--text2);font-family:'Cormorant Garamond',serif">${durDisplay || '—'}m</div>
            <div style="font-size:8px;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase;margin-top:2px">Total</div>
          </div>
        </div>`}

        </div>
        <div class="obra-tab-panel" data-tab="estructura">
        <!-- Movimientos -->
        ${movimientosHtml}
        <!-- Pasajes -->
        <div class="pasajes-section">
          <div id="pasajes-${o.id}">${pasajosHtml}</div>
          <button class="add-pasaje-btn" onclick="addPasaje('${o.id}')">+ añadir pasaje</button>
        </div>
        </div>
        <div class="obra-tab-panel" data-tab="seguimiento">
        ${renderMinutosWidget(o.id)}
        ${renderRangoWidget(o.id, o)}
        ${renderDecayWidget(o.id)}

        <!-- Pase (solo si no hay movimientos): solo historial visible -->
        ${!hasMovs ? `
          <div style="margin:10px 0 4px">
            <div class="last-pase">${lastPaseText}</div>
            ${paseHistHtml ? `<div style="margin-top:8px">${paseHistHtml}</div>` : ''}
          </div>` : ''}

        </div>
      </div>
    </div>`;
}

function updateObraScale(obraId, key, value, _unused) {
  const v = parseInt(value);
  // Find the scale row for this key inside the obra card
  const card = document.getElementById('obra-' + obraId);
  if (card) {
    // Update number and label badge within the slider row
    const rows = card.querySelectorAll('.scale-row');
    rows.forEach(row => {
      const name = row.querySelector('.scale-name');
      if (!name) return;
      const isTarget = (key === 'sol' && name.textContent === 'Solidez') ||
                       (key === 'esc' && name.textContent === 'Escena');
      if (!isTarget) return;
      const baseColor = key === 'sol' ? '#c8a030' : 'var(--green)';
      const stLbl = key === 'sol' ? solLabel(v) : escLabel(v);
      const numEl = row.querySelector('.scale-label-row span:last-child span:first-child');
      const badgeEl = row.querySelector('.scale-label-row span:last-child span:last-child');
      if (numEl) numEl.textContent = v;
      if (badgeEl) {
        badgeEl.textContent = stLbl.label;
        badgeEl.style.background = baseColor + '22';
        badgeEl.style.color = baseColor;
        badgeEl.style.borderColor = baseColor + '44';
      }
      const slider = row.querySelector('.obra-scale-slider');
      if (slider) slider.style.accentColor = baseColor;
    });
    // Update header badge
    const obra = findObra(obraId);
    if (obra) {
      const updated = { ...obra, [key]: v };
      const fl = obraFaseLabel(updated);
      const badge = card.querySelector('.estado-badge');
      if (badge) {
        badge.style.background = fl.color + '22';
        badge.style.color = fl.color;
        badge.style.borderColor = fl.color + '44';
        badge.textContent = fl.label;
      }
    }
  }
}

function saveObraScale(obraId, key, value) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra[key] = parseInt(value);
  saveData();
}

function setDificultadInline(obraId, nivel, btn) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra.dificultad = nivel;
  saveData();
  const row = document.getElementById('dif-inline-' + obraId);
  if (row) row.querySelectorAll('.dif-num-btn').forEach(b => {
    b.classList.remove('active');
    b.style.background = ''; b.style.borderColor = ''; b.style.color = '';
  });
  btn.classList.add('active');
  btn.style.background = DIF_COLORS_MAP[nivel];
  btn.style.borderColor = DIF_COLORS_MAP[nivel];
  btn.style.color = '#fff';
  // Update header badge
  const card = document.getElementById('obra-' + obraId);
  if (card) {
    const badge = card.querySelector('.dif-badge');
    if (badge) { badge.className = `dif-badge d${nivel}`; badge.textContent = nivel; }
  }
}

function toggleObra(id) {
  document.getElementById('obra-' + id).classList.toggle('expanded');
}

// changePack removed — using filtroEvento filter

function setFase(obraId, fase, btn) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra.fase = fase;
  saveData();
  const card = document.getElementById('obra-' + obraId);
  card.querySelectorAll('.fase-btn').forEach(b => {
    b.classList.remove('active');
  });
  btn.classList.add('active');
  const dot = card.querySelector('.obra-fase');
  dot.className = 'obra-fase ' + fase;
  showToast('Fase actualizada');
}

function updateScore(obraId, field, value, label) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra[field] = parseInt(value);
  label.textContent = value + '/5';
  saveData();
  // Update badge
  const card = document.getElementById('obra-' + obraId);
  const badges = card.querySelectorAll('.score-badge');
  badges[0].textContent = 'M' + obra.mem;
  badges[1].textContent = 'T' + obra.tec;
  badges[2].textContent = 'L' + obra.lib;
}

function updateNotes(obraId, val) {
  const obra = findObra(obraId);
  if (obra) { obra.notes = val; saveData(); }
}

// setUrgencia and setDeadline removed — urgency is now derived from calendario

function renderPasajeItem(obraId, p) {
  const isTracking = !!p.tracking;
  const sesiones = p.sesiones || [];
  const lastSesion = sesiones[0] || null;
  const diasDesde = lastSesion
    ? Math.floor((Date.now() - new Date(lastSesion.date)) / 86400000)
    : null;

  let trackingHtml = '';
  if (isTracking) {
    // Stats: total sesiones, score actual, máx alcanzado
    const scores = sesiones.map(s => s.score);
    const scoreActual = scores[0] ?? '—';
    const scoreMax = scores.length ? Math.max(...scores) : '—';
    const totalSes = sesiones.length;

    const statsHtml = totalSes > 0 ? `
      <div class="pasaje-stats">
        <span>Sesiones: <span class="pasaje-stat-val">${totalSes}</span></span>
        <span>Ahora: <span class="pasaje-stat-val">${scoreActual}/10</span></span>
        <span>Máx: <span class="pasaje-stat-val">${scoreMax}/10</span></span>
        ${diasDesde !== null ? `<span>Último: <span class="pasaje-stat-val">${diasDesde === 0 ? 'hoy' : diasDesde + 'd'}</span></span>` : ''}
      </div>` : '<div class="pasaje-stats" style="color:var(--text3)">Sin sesiones aún</div>';

    const miniGraph = totalSes >= 2 ? renderPasajeMiniGraph(sesiones) : '';

    trackingHtml = `<div class="pasaje-tracking-section">
      ${statsHtml}
      <button class="pasaje-log-btn" onclick="openPasajeScore('${obraId}','${p.id}')">+ sesión de hoy</button>
      ${miniGraph}
    </div>`;
  }

  const STATUS_ICON = { activo: '●', mantenimiento: '◐', resuelto: '✓' };
  const STATUS_COLOR = { activo: 'var(--orange)', mantenimiento: 'var(--accent)', resuelto: 'var(--green)' };
  const st = p.status || 'activo';

  // Memory lapse badge
  let memBadge = '';
  if (p.lastMemLapse) {
    const dias = Math.round((Date.now() - new Date(p.lastMemLapse)) / 86400000);
    const col = dias < 3 ? 'var(--red)' : dias < 7 ? 'var(--orange)' : 'var(--accent)';
    memBadge = '<span style="font-size:8px;color:' + col + ';background:' + col + '18;border:1px solid ' + col + '44;border-radius:4px;padding:1px 6px;margin-left:4px" title="Fallo de memoria hace ' + dias + 'd">⚠ mem ' + (dias === 0 ? 'hoy' : dias + 'd') + '</span>';
  }

  const hasSolData = (p.workHistory?.length >= 2) || (p.solHistory?.length >= 2);
  const pasajeChart = hasSolData
    ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border2)">' + renderPasajeSolChart(p) + '</div>'
    : '';

  return `<div class="pasaje-item" style="flex-wrap:wrap" id="pitem-${obraId}-${p.id}">
    <button class="pasaje-status-icon" onclick="cyclePasajeStatus('${obraId}','${p.id}')"
      title="Estado: ${st} (click para cambiar)"
      style="color:${STATUS_COLOR[st]}">${STATUS_ICON[st]}</button>
    <input class="pasaje-text" value="${p.text.replace(/"/g,'&quot;')}" onblur="updatePasajeText('${obraId}','${p.id}',this.value)">
    ${memBadge}
    <button class="pasaje-tracking-toggle ${isTracking ? 'on' : ''}"
      onclick="togglePasajeTracking('${obraId}','${p.id}',this)"
      title="${isTracking ? 'Desactivar seguimiento' : 'Activar seguimiento detallado'}">
      ${isTracking ? '📈 seguimiento' : '📈'}
    </button>
    <button class="pasaje-delete" onclick="deletePasaje('${obraId}','${p.id}')">×</button>
    ${trackingHtml}${pasajeChart}
  </div>`;
}

function renderPasajeMiniGraph(sesiones) {
  const ordered = [...sesiones].sort((a, b) => new Date(a.date) - new Date(b.date));
  const W = 300, H = 70;
  const PAD = { top: 8, right: 8, bottom: 18, left: 24 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const minT = new Date(ordered[0].date).getTime();
  const maxT = new Date(ordered[ordered.length - 1].date).getTime();
  const rangeT = maxT - minT || 1;

  const xOf = d => PAD.left + ((new Date(d).getTime() - minT) / rangeT) * cW;
  const yOf = s => PAD.top + cH - ((s - 1) / 9) * cH;

  // Grid lines 1, 5, 10
  const grid = [1, 5, 10].map(s => {
    const y = yOf(s);
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"
      stroke="var(--border2)" stroke-dasharray="2,2"/>
      <text x="${PAD.left - 3}" y="${y + 3.5}" text-anchor="end" font-size="7"
        fill="var(--text3)" font-family="JetBrains Mono,monospace">${s}</text>`;
  }).join('');

  // Line
  const pts = ordered.map(s => ({ x: xOf(s.date), y: yOf(s.score) }));
  const lineD = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');

  // Area
  const areaD = `${lineD} L${pts[pts.length-1].x},${yOf(1)} L${pts[0].x},${yOf(1)} Z`;

  // Score color per dot
  const scoreColor = s => s >= 8 ? 'var(--green)' : s >= 5 ? 'var(--accent)' : 'var(--orange)';

  const dots = ordered.map(s => {
    const x = xOf(s.date);
    const y = yOf(s.score);
    const d = new Date(s.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const tip = `${d} · ${s.score}/10${s.note ? ' · ' + s.note : ''}`;
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="${scoreColor(s.score)}"
      stroke="var(--bg2)" stroke-width="1"><title>${tip}</title></circle>`;
  }).join('');

  // X labels (inicio y fin)
  const xLabels = [ordered[0], ordered[ordered.length - 1]].map((s, i) => {
    const x = xOf(s.date);
    const d = new Date(s.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `<text x="${x}" y="${H - 3}" text-anchor="${i === 0 ? 'start' : 'end'}"
      font-size="7" fill="var(--text3)" font-family="JetBrains Mono,monospace">${d}</text>`;
  }).join('');

  // Shading for gaps > 4 days (decay zones)
  let decayZones = '';
  for (let i = 1; i < ordered.length; i++) {
    const gap = (new Date(ordered[i].date) - new Date(ordered[i-1].date)) / 86400000;
    if (gap > 4) {
      const x1 = xOf(ordered[i-1].date);
      const x2 = xOf(ordered[i].date);
      decayZones += `<rect x="${x1}" y="${PAD.top}" width="${x2-x1}" height="${cH}"
        fill="var(--red)" opacity="0.06" rx="1"/>`;
    }
  }

  return `<div class="pasaje-mini-graph">
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
        style="width:100%;height:auto;display:block">
      <defs>
        <linearGradient id="pgGrad${Math.random().toString(36).slice(2,6)}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      ${decayZones}
      <path d="${areaD}" fill="var(--accent)" opacity="0.1"/>
      <path d="${lineD}" fill="none" stroke="var(--accent)" stroke-width="1.2"
        stroke-linejoin="round" opacity="0.6"/>
      ${dots}
      ${xLabels}
    </svg>
    <div style="font-size:8px;color:var(--text3);margin-top:2px">
      <span style="display:inline-block;width:8px;height:4px;background:var(--red);opacity:0.3;border-radius:1px;vertical-align:middle"></span>
      zona sin práctica (&gt;4 días)
    </div>
  </div>`;
}
function addPasaje(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  const id = 'p' + Date.now();
  obra.pasajes = obra.pasajes || [];
  obra.pasajes.push({ id, text: 'nuevo pasaje', status: 'activo', tempoAct: null, tempoObj: null, tracking: false, sesiones: [] });
  saveData();
  const container = document.getElementById('pasajes-' + obraId);
  const p = obra.pasajes[obra.pasajes.length - 1];
  const div = document.createElement('div');
  div.innerHTML = renderPasajeItem(obraId, p);
  container.appendChild(div.firstElementChild);
  const input = document.getElementById(`pitem-${obraId}-${id}`)?.querySelector('input.pasaje-text');
  if (input) { input.focus(); input.select(); }
}

function cyclePasajeStatus(obraId, pasajeId) {
  const obra = findObra(obraId);
  if (!obra) return;
  const p = obra.pasajes.find(x => x.id === pasajeId);
  if (!p) return;
  const cycle = ['activo', 'mantenimiento', 'resuelto'];
  p.status = cycle[(cycle.indexOf(p.status) + 1) % cycle.length];
  saveData();
  const STATUS_ICON  = { activo: '●', mantenimiento: '◐', resuelto: '✓' };
  const STATUS_COLOR = { activo: 'var(--orange)', mantenimiento: 'var(--accent)', resuelto: 'var(--green)' };
  const btn = document.querySelector(`#pitem-${obraId}-${pasajeId} .pasaje-status-icon`);
  if (btn) {
    btn.textContent = STATUS_ICON[p.status];
    btn.style.color = STATUS_COLOR[p.status];
    btn.title = `Estado: ${p.status} (click para cambiar)`;
  }
}

function updatePasajeText(obraId, pasajeId, val) {
  const obra = findObra(obraId);
  if (!obra) return;
  const p = obra.pasajes.find(x => x.id === pasajeId);
  if (p) { p.text = val; saveData(); }
}

function deletePasaje(obraId, pasajeId) {
  const obra = findObra(obraId);
  if (!obra) return;
  const pasaje = (obra.pasajes || []).find(p => p.id === pasajeId);
  const label = pasaje ? (pasaje.text || pasaje.nombre || 'este pasaje') : 'este pasaje';
  if (!confirm('¿Eliminar el pasaje "' + label + '"?\n\nEsta acción no se puede deshacer.')) return;
  obra.pasajes = obra.pasajes.filter(p => p.id !== pasajeId);
  saveData();
  const el = document.getElementById(`pitem-${obraId}-${pasajeId}`);
  if (el) el.remove();
  showToast('Pasaje eliminado');
}

function togglePasajeTracking(obraId, pasajeId, btn) {
  const obra = findObra(obraId);
  if (!obra) return;
  const p = obra.pasajes.find(x => x.id === pasajeId);
  if (!p) return;
  p.tracking = !p.tracking;
  if (!p.sesiones) p.sesiones = [];
  saveData();
  // Re-render just this pasaje
  const el = document.getElementById(`pitem-${obraId}-${pasajeId}`);
  if (el) el.outerHTML = renderPasajeItem(obraId, p);
}

// ─── PASAJE SCORE ─────────────────────────────────────────────────────────────

let psObraId = null, psPasajeId = null, psScoreSelected = null;

const SCORE_COLORS = ['','#c84040','#c84040','#d07020','#d07020','#c8a030','#c8a030','#4a9a6a','#4a9a6a','#2a8a5a','#2a8a5a'];

function openPasajeScore(obraId, pasajeId) {
  psObraId = obraId; psPasajeId = pasajeId; psScoreSelected = null;
  const obra = findObra(obraId);
  const p = obra ? obra.pasajes.find(x => x.id === pasajeId) : null;
  document.getElementById('pasajeScoreName').textContent = p ? p.text : '';
  document.getElementById('pscoreNote').value = '';
  // Build score buttons
  const row = document.getElementById('pscoreModalBtns');
  row.innerHTML = [1,2,3,4,5,6,7,8,9,10].map(n =>
    `<button class="pscore-modal-btn" onclick="selectPasajeScore(${n},this)"
      style="">${n}</button>`
  ).join('');
  openModal('modalPasajeScore');
}

function selectPasajeScore(n, btn) {
  psScoreSelected = n;
  document.querySelectorAll('.pscore-modal-btn').forEach(b => {
    b.classList.remove('sel'); b.style.background = ''; b.style.color = '';
  });
  btn.classList.add('sel');
  btn.style.background = SCORE_COLORS[n];
  btn.style.color = '#fff';
}

function confirmPasajeScore() {
  if (!psScoreSelected) { showToast('Elige una puntuación'); return; }
  const obra = findObra(psObraId);
  if (!obra) return;
  const p = obra.pasajes.find(x => x.id === psPasajeId);
  if (!p) return;
  if (!p.sesiones) p.sesiones = [];
  const note = document.getElementById('pscoreNote').value.trim();
  // One entry per day max — replace if already logged today
  const today = new Date().toDateString();
  const existIdx = p.sesiones.findIndex(s => new Date(s.date).toDateString() === today);
  const entry = { date: new Date().toISOString(), score: psScoreSelected, note };
  if (existIdx >= 0) p.sesiones[existIdx] = entry;
  else p.sesiones.unshift(entry);
  if (p.sesiones.length > 60) p.sesiones = p.sesiones.slice(0, 60);
  saveData();
  closeModal('modalPasajeScore');
  showToast('Sesión registrada ✓');
  // Re-render the pasaje item in obras view if visible
  const el = document.getElementById(`pitem-${psObraId}-${psPasajeId}`);
  if (el) el.outerHTML = renderPasajeItem(psObraId, p);
}

function registerPase(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra.lastPase = new Date().toISOString();
  saveData();
  showToast('Pase registrado ✓');
  renderObras();
}

function deleteObra(obraId) {
  db.obras = (db.obras || []).filter(o => o.id !== obraId);
  // Remove from eventos too
  (db.eventos || []).forEach(ev => {
    ev.obras = (ev.obras || []).filter(id => id !== obraId);
  });
  saveData();
  renderObras();
}

function setOrigen(obraId, origen, btn) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra.origen = origen;
  saveData();
  // Update buttons visually
  const card = document.getElementById('obra-' + obraId);
  if (!card) return;
  card.querySelectorAll('.origen-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setDificultad(obraId, nivel, btn) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra.dificultad = nivel;
  saveData();
  const row = document.getElementById('dif-' + obraId);
  if (row) row.querySelectorAll('.dif-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setDuracion(obraId, val) {
  const obra = findObra(obraId);
  if (!obra) return;
  obra.duracion = val ? parseInt(val) : null;
  saveData();
}

function updatePasajeTempo(obraId, pasajeId, field, value) {
  const obra = findObra(obraId);
  if (!obra) return;
  const p = (obra.pasajes || []).find(x => x.id === pasajeId);
  if (!p) return;
  p[field] = value ? parseInt(value) : null;
  saveData();
}

function findObra(id) {
  return (db.obras || []).find(x => x.id === id) || null;
}

function findMovimiento(obraId, movId) {
  const obra = findObra(obraId);
  return obra ? (obra.movimientos || []).find(m => m.id === movId) || null : null;
}

function renderCompasWidget(obraId, movId, entity) {
  const elBase = movId ? 'mov-compas-' + obraId + '-' + movId : 'obra-compas-' + obraId;
  const total  = entity.compasesTotal || '';
  const actual = entity.compasActual  || '';
  const pct    = compasPercent(entity);
  const pctStr = pct !== null ? pct + '%' : '—';
  const barColor = compasBarColor(pct);
  const barW     = pct !== null ? pct : 0;
  const saveCall = movId
    ? `saveCompas('${obraId}','${mov_quote(movId)}','{F}',this.value)`
    : `saveCompas('${obraId}',null,'{F}',this.value)`;
  const saveTotal  = saveCall.replace('{F}', 'compasesTotal').replace("mov_quote('", "'").replace("')", "'");
  const saveActual = saveCall.replace('{F}', 'compasActual').replace("mov_quote('", "'").replace("')", "'");

  const yaAprendida = aprFromCompas(entity) >= 10;
  const aprendidaBtn = yaAprendida ? '' :
    `<button class="marcar-aprendida-btn" onclick="marcarAprendida('${obraId}',${movId ? "'" + movId + "'" : 'null'})" title="Marcar como aprendida sin contar compases (los puedes añadir después)">✓ ya me la sé</button>`;

  return `<div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px">
      <span style="font-size:8px;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase">Progreso de aprendizaje</span>
      ${aprendidaBtn}
    </div>
    <div class="compas-row">
      <div style="display:flex;align-items:center;gap:4px">
        <input class="compas-field" id="${elBase}-actual" type="number" min="0"
          value="${actual}" placeholder="0"
          oninput="debouncedSaveCompas('${obraId}',${movId ? "'"+movId+"'" : 'null'},'compasActual',this.value)"
          onblur="saveCompas('${obraId}',${movId ? "'"+movId+"'" : 'null'},'compasActual',this.value)"
          title="Compás hasta donde llegas">
        <span class="compas-sep">de</span>
        <input class="compas-field" id="${elBase}-total" type="number" min="1"
          value="${total}" placeholder="total"
          oninput="debouncedSaveCompas('${obraId}',${movId ? "'"+movId+"'" : 'null'},'compasesTotal',this.value)"
          onblur="saveCompas('${obraId}',${movId ? "'"+movId+"'" : 'null'},'compasesTotal',this.value)"
          title="Compases totales de la obra/movimiento">
        <span class="compas-sep">cc.</span>
      </div>
      <div class="compas-bar-wrap">
        <div class="compas-bar-track">
          <div class="compas-bar-fill" id="${elBase}-bar-fill" style="width:${barW}%;background:${barColor}"></div>
        </div>
        <div class="compas-label-row">
          <span>aprendido</span>
          <span id="${elBase}-pct" style="color:${barColor};font-size:10px;font-family:'Cormorant Garamond',serif">${pctStr}</span>
        </div>
      </div>
    </div>
    ${renderProyeccionWidget(obraId, movId || null, entity)}
  </div>`;
}
// helper to avoid template literal issues
function mov_quote(s) { return s; }

// ─── MOVIMIENTOS ─────────────────────────────────────────────────────────────

function renderMovimientoCard(obraId, mov) {
  const fl = obraFaseLabel(mov);
  const estBadge = `<span class="estado-badge" style="font-size:8px;padding:2px 7px;background:${fl.color}22;color:${fl.color};border:1px solid ${fl.color}44">${fl.label}</span>`;
  const lastPaseText = mov.lastPase
    ? `Último: ${new Date(mov.lastPase).toLocaleDateString('es-ES')}`
    : 'Sin pase';

  const tipoIcons = { solo: 'solo', informal: 'amigos', evento: 'evento', escena: 'evento', tecnico: 'tec', memoria: 'mem', concierto: 'evento' };
  const paseHistHtml = (mov.paseHistory||[]).slice(0,3).map(p => {
    const d = new Date(p.date).toLocaleDateString('es-ES',{day:'numeric',month:'short'});
    const sc = p.score ?? null;
    const col = sc !== null ? scoreColor(sc) : 'var(--text3)';
    const val = sc !== null ? sc : (p.quality === 'bien' ? '✓' : p.quality === 'regular' ? '≈' : p.quality === 'mal' ? '✗' : '—');
    const tipoLabel = p.tipo ? `<span style="color:var(--text3);font-size:8px;background:var(--bg2);border-radius:3px;padding:1px 4px;margin-left:2px">${tipoIcons[p.tipo]||p.tipo}</span>` : '';
    return `<div style="display:flex;gap:8px;font-size:9px;color:var(--text3);padding:2px 0;align-items:center">
      <span style="color:${col};font-weight:bold">${val}</span>${tipoLabel}<span>${d}</span>${p.note ? `<span>· ${p.note}</span>` : ''}
    </div>`;
  }).join('');

  // Dificultad buttons
  const dif = mov.dificultad || 3;
  const difBtns = [1,2,3,4,5,6,7,8,9,10].map(n => {
    const active = dif === n;
    const col = DIF_COLORS_MAP[n];
    return `<button class="dif-num-btn d${n} ${active?'active':''}"
      style="${active ? 'background:'+col+';border-color:'+col+';color:#fff' : ''}"
      onclick="setMovDificultad('${obraId}','${mov.id}',${n},this)">${n}</button>`;
  }).join('');

  // Scales (sol + esc only — readonly display, no manual sliders)
  const scaleHtml = `<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">` +
    ['sol','esc'].map((key, i) => {
      const labels = ['Solidez','Escena'];
      const val = mov[key] || 1;
      const baseColor = key === 'sol' ? '#c8a030' : 'var(--green)';
      const stLbl = key === 'sol' ? solLabel(val) : escLabel(val);
      return `<div style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--border2);border-radius:7px;padding:6px 9px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:9px;color:var(--text2)">${labels[i]}</span>
          <span style="font-size:14px;font-family:'Cormorant Garamond',serif;color:${baseColor}">${val}</span>
        </div>
        <div style="text-align:right;margin-top:1px">
          <span style="font-size:8px;padding:1px 5px;border-radius:6px;background:${baseColor}1a;color:${baseColor};border:1px solid ${baseColor}33">${stLbl.label}</span>
        </div>
      </div>`;
    }).join('') + `</div>`;

  return `<div class="mov-card" id="mov-${obraId}-${mov.id}">
    <div class="mov-card-header">
      <input class="mov-name-input" value="${mov.name.replace(/"/g,'&quot;')}"
        onblur="updateMovimientoName('${obraId}','${mov.id}',this.value)"
        placeholder="nombre del movimiento">
      <button class="mov-delete-btn" onclick="deleteMovimiento('${obraId}','${mov.id}')">×</button>
    </div>
    ${estBadge}
    <!-- Duración + Dificultad -->
    <div style="display:flex;gap:10px;align-items:flex-start;margin:8px 0;flex-wrap:wrap">
      <div>
        <div style="font-size:8px;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px">Duración</div>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="duracion-field" type="number" min="1" max="60" value="${mov.duracion||''}" placeholder="min"
            onblur="setMovDuracion('${obraId}','${mov.id}',this.value)" style="width:46px">
          <span style="font-size:9px;color:var(--text3)">min</span>
        </div>
      </div>
      <div style="flex:1;min-width:160px">
        <div style="font-size:8px;color:var(--text3);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:3px">Dificultad</div>
        <div class="dif-num-row" id="mov-dif-${obraId}-${mov.id}" style="gap:2px">${difBtns}</div>
      </div>
    </div>
    <!-- Estado: compas widget + scales (display only) -->
    <div style="margin-bottom:8px">
      ${renderCompasWidget(obraId, mov.id, mov)}
      ${scaleHtml}
    </div>
    <!-- Histórico de pases (solo display, los pases se registran desde la sesión) -->
    <div class="mov-actions">
      <button class="mov-diag-btn" onclick="openGrafico('${obraId}','${mov.id}')">Evolución ↗</button>
      <span style="font-size:9px;color:var(--text3);margin-left:4px">${lastPaseText}</span>
    </div>
    ${paseHistHtml ? `<div class="mov-pase-hist">${paseHistHtml}</div>` : ''}
  </div>`;
}

function rerenderObraCard(obraId) {
  const card = document.getElementById('obra-' + obraId);
  if (!card) return;
  const wasExpanded = card.classList.contains('expanded');
  const obra = findObra(obraId);
  if (!obra) return;
  const idx = (db.obras || []).indexOf(obra);
  const newHtml = document.createElement('div');
  newHtml.innerHTML = renderObraCard(obra, idx);
  const newCard = newHtml.firstElementChild;
  if (wasExpanded) newCard.classList.add('expanded');
  card.replaceWith(newCard);
}

function romanNumeral(n) {
  let num = Math.max(1, Math.floor(Number(n) || 1));
  const map = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  map.forEach(([value, glyph]) => {
    while (num >= value) {
      out += glyph;
      num -= value;
    }
  });
  return out;
}

function defaultMovimientoName(index) {
  return romanNumeral(index) + '.';
}

function markMovimientoLearnedIfNoCompases(mov) {
  if (!mov) return mov;
  const hasCompas = mov.compasActual != null || mov.compasesTotal != null;
  mov.apr = hasCompas ? aprFromCompas(mov) : 10;
  return mov;
}

function syncObraDurationFromMovimientos(obra) {
  if (!obra || !Array.isArray(obra.movimientos) || !obra.movimientos.length) return;
  const sum = obra.movimientos.reduce((total, mov) => total + (parseInt(mov.duracion || 0, 10) || 0), 0);
  if (sum > 0) obra.duracion = sum;
}

function addMovimiento(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  if (!obra.movimientos) obra.movimientos = [];
  const id  = 'mv' + Date.now();
  const num = obra.movimientos.length + 1;
  obra.movimientos.push({
    id, name: defaultMovimientoName(num),
    duracion: null, dificultad: obra.dificultad || 3,
    apr: 10, sol: obra.sol || 1, esc: obra.esc || 1,
    lastPase: null, paseHistory: []
  });
  saveData();
  rerenderObraCard(obraId);
  showToast('Movimiento añadido ✓');
}

function deleteMovimiento(obraId, movId) {
  const obra = findObra(obraId);
  if (!obra) return;
  const mov = (obra.movimientos || []).find(m => m.id === movId);
  const label = mov ? (mov.name || 'este movimiento') : 'este movimiento';
  if (!confirm('¿Eliminar "' + label + '" de "' + obra.name + '"?\n\nEsta acción no se puede deshacer.')) return;
  obra.movimientos = (obra.movimientos || []).filter(m => m.id !== movId);
  syncObraDurationFromMovimientos(obra);
  saveData();
  rerenderObraCard(obraId);
  showToast('Movimiento eliminado');
}

function updateMovimientoName(obraId, movId, val) {
  const mov = findMovimiento(obraId, movId);
  if (mov) { mov.name = val; saveData(); }
}

function setMovDuracion(obraId, movId, val) {
  const mov = findMovimiento(obraId, movId);
  if (!mov) return;
  mov.duracion = val ? parseInt(val) : null;
  syncObraDurationFromMovimientos(findObra(obraId));
  saveData();
  // Update obra duracion display
  rerenderObraCard(obraId);
}

function setMovDificultad(obraId, movId, n, btn) {
  const mov = findMovimiento(obraId, movId);
  if (!mov) return;
  mov.dificultad = n;
  saveData();
  const row = document.getElementById('mov-dif-' + obraId + '-' + movId);
  if (row) row.querySelectorAll('.dif-num-btn').forEach((b, i) => {
    const active = i + 1 === n;
    b.classList.toggle('active', active);
    b.style.background = active ? DIF_COLORS_MAP[i+1] : '';
    b.style.borderColor = active ? DIF_COLORS_MAP[i+1] : '';
    b.style.color = active ? '#fff' : '';
  });
}

function updateMovScale(obraId, movId, key, value, numEl, badgeEl) {
  const v = parseInt(value);
  const baseColor = key === 'sol' ? '#c8a030' : 'var(--green)';
  const stLbl = key === 'sol' ? solLabel(v) : escLabel(v);
  if (numEl) { numEl.textContent = v; numEl.style.color = baseColor; }
  if (badgeEl) {
    badgeEl.textContent = stLbl.label;
    badgeEl.style.background = baseColor + '22';
    badgeEl.style.color = baseColor;
    badgeEl.style.borderColor = baseColor + '44';
  }
}

function saveMovScale(obraId, movId, key, value) {
  const mov = findMovimiento(obraId, movId);
  if (!mov) return;
  mov[key] = parseInt(value);
  saveData();
  // Recompute weighted obra label
  rerenderObraCard(obraId);
}

// ─── ADD OBRA ────────────────────────────────────────────────────────────────


function openAddObra() {
  document.getElementById('newObraName').value = '';
  document.getElementById('newObraComposer').value = '';
  const durEl = document.getElementById('newObraDuracion');
  if (durEl) durEl.value = '';
  const difInput = document.getElementById('newObraDificultad');
  if (difInput) difInput.value = 3;
  const difVal = document.getElementById('newObraDificultadVal');
  if (difVal) difVal.textContent = '3';
  const solInput = document.getElementById('newObraSolidez');
  if (solInput) {
    solInput.value = 10;
    solInput.type = 'hidden';
    solInput.style.display = 'none';
    const solLabel = solInput.previousElementSibling;
    if (solLabel) solLabel.style.display = 'none';
  }
  const solVal = document.getElementById('newObraSolidezVal');
  if (solVal) solVal.textContent = '10%';
  const stateNote = document.getElementById('addObraStateNote');
  if (stateNote) stateNote.textContent = 'La solidez real se registra con el primer pase.';
  const tipoBtn = document.querySelector('#modalTipoSelector .origen-btn[data-tipo="obra"]');
  if (tipoBtn) selectModalTipo(tipoBtn, 'obra');
  openModal('modalAddObra');
}

// selectModalFase / selectModalOrigen removed

let modalTipoSelected = 'obra';
function selectModalTipo(btn, tipo) {
  modalTipoSelected = tipo;
  document.querySelectorAll('#modalTipoSelector .origen-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Mostrar/ocultar campos específicos
  const obraExtra = document.getElementById('modalTipoObraExtra');
  const actExtra = document.getElementById('modalTipoActividadExtra');
  const composer = document.getElementById('newObraComposer');
  const nameInput = document.getElementById('newObraName');
  const solSlider = document.getElementById('newObraSolidez');
  const solVal = document.getElementById('newObraSolidezVal');
  if (solSlider) {
    solSlider.type = 'hidden';
    solSlider.style.display = 'none';
    const solLabel = solSlider.previousElementSibling;
    if (solLabel) solLabel.style.display = 'none';
  }
  if (tipo === 'actividad') {
    if (obraExtra) obraExtra.style.display = 'none';
    if (actExtra) actExtra.style.display = '';
    if (composer) composer.style.display = 'none';
    if (nameInput) nameInput.placeholder = 'nombre de la actividad (ej. Lectura a primera vista)';
  } else {
    if (obraExtra) obraExtra.style.display = '';
    if (actExtra) actExtra.style.display = 'none';
    if (composer) composer.style.display = '';
    if (nameInput) nameInput.placeholder = 'título';
    // "Ya la tocaba" arranca con una solidez de partida más alta.
    const def = tipo === 'recuperacion' ? 55 : 10;
    if (solSlider) solSlider.value = def;
    if (solVal) solVal.textContent = def + '%';
  }
  if (typeof updateAddObraPrediccion === 'function') updateAddObraPrediccion();
}

function addObra() {
  const name = document.getElementById('newObraName').value.trim();
  const composer = document.getElementById('newObraComposer').value.trim();
  if (!name) { showToast('Escribe el nombre'); return; }
  if (!db.obras) db.obras = [];
  const newId = 'o' + Date.now();
  const isActividad = modalTipoSelected === 'actividad';
  const isRecuperacion = modalTipoSelected === 'recuperacion';
  const duracionVal = parseInt(document.getElementById('newObraDuracion')?.value || '', 10);
  const dificultadRaw = parseInt(document.getElementById('newObraDificultad')?.value || '3', 10);
  const dificultadVal = Math.max(1, Math.min(10, Number.isFinite(dificultadRaw) ? dificultadRaw : 3));
  const solidezRaw = parseInt(document.getElementById('newObraSolidez')?.value || '10', 10);
  const solidezPct = Math.max(0, Math.min(100, Number.isFinite(solidezRaw) ? solidezRaw : 10));
  const entry = {
    id: newId,
    name,
    composer: isActividad ? '' : (composer || '—'),
    tipo: isActividad ? 'actividad' : 'obra',
    origen: isRecuperacion ? 'recuperacion' : null,
    dificultad: isActividad ? null : dificultadVal,
    duracion: !isActividad && duracionVal > 0 ? duracionVal : null,
    // Prior interno para lectores antiguos: el historial real nace con pases.
    sol: isActividad ? null : Math.max(1, Math.round(solidezPct / 10)),
    solHistory: [],
    notes: '',
  };
  db.obras.push(entry);
  saveData();
  closeModal('modalAddObra');
  renderObras();
  showToast(isActividad ? 'Actividad añadida ✓' : isRecuperacion ? 'Obra recuperada ✓' : 'Obra añadida ✓');
  showSavedCheck();
  // Reset por defecto a "obra" para próxima apertura
  modalTipoSelected = 'obra';
  const tipoBtns = document.querySelectorAll('#modalTipoSelector .origen-btn');
  tipoBtns.forEach(b => b.classList.toggle('active', b.dataset.tipo === 'obra'));
  // Restaurar visibilidad por defecto
  const obraExtra = document.getElementById('modalTipoObraExtra');
  const actExtra = document.getElementById('modalTipoActividadExtra');
  const composerEl = document.getElementById('newObraComposer');
  const nameEl = document.getElementById('newObraName');
  if (obraExtra) obraExtra.style.display = '';
  if (actExtra) actExtra.style.display = 'none';
  if (composerEl) composerEl.style.display = '';
  if (nameEl) { nameEl.placeholder = 'título'; nameEl.value = ''; }
  if (composerEl) composerEl.value = '';
  const durEl = document.getElementById('newObraDuracion');
  if (durEl) durEl.value = '';
  const difInput = document.getElementById('newObraDificultad');
  if (difInput) difInput.value = 3;
  const difValEl = document.getElementById('newObraDificultadVal');
  if (difValEl) difValEl.textContent = '3';
  const solInput = document.getElementById('newObraSolidez');
  if (solInput) solInput.value = 10;
  const solValEl = document.getElementById('newObraSolidezVal');
  if (solValEl) solValEl.textContent = '10%';
}


const DIF_COLORS_MAP = ['','#2a8a5a','#4a9a6a','#6aaa5a','#9ab030','#c8a030','#d07020','#c84040','#a02040','#7a1060','#3a0030'];

// ─── GRÁFICO EVOLUCIÓN ────────────────────────────────────────────────────────

let graficoObraId = null;
let graficoMovId  = null;

function openGrafico(obraId, movId) {
  graficoObraId = obraId;
  graficoMovId  = movId || null;
  const obra = findObra(obraId);
  if (!obra) return;

  document.getElementById('graficoTitle').textContent = movId
    ? obra.name + ' — ' + (findMovimiento(obraId, movId)?.name || '')
    : obra.name;

  // Tabs para movimientos (si los hay y no se abrió desde un movimiento concreto)
  const tabsEl = document.getElementById('graficoMovTabs');
  const hasMovs = obra.movimientos && obra.movimientos.length > 0;
  if (hasMovs && !movId) {
    tabsEl.innerHTML =
      `<button class="cal-tab active" onclick="switchGraficoMov(null,this)">Obra</button>` +
      obra.movimientos.map(m =>
        `<button class="cal-tab" onclick="switchGraficoMov('${m.id}',this)">${m.name}</button>`
      ).join('');
    tabsEl.style.display = 'flex';
  } else {
    tabsEl.innerHTML = '';
    tabsEl.style.display = 'none';
  }

  openModal('modalGrafico');
  // Renderizar tras abrir el modal: el SVG necesita un contenedor con anchura
  // medible para dibujarse bien en móvil.
  requestAnimationFrame(() => renderGraficoSvg());
}

function switchGraficoMov(movId, btn) {
  graficoMovId = movId;
  document.querySelectorAll('#graficoMovTabs .cal-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderGraficoSvg();
}

function renderGraficoSvg() {
  const obra = findObra(graficoObraId);
  if (!obra) return;

  // Obtener historial
  let history;
  if (graficoMovId) {
    const mov = findMovimiento(graficoObraId, graficoMovId);
    history = mov ? [...(mov.paseHistory || [])] : [];
  } else {
    history = [...(obra.paseHistory || [])];
  }

  const wrap = document.getElementById('graficoSvgWrap');
  const leyEl = document.getElementById('graficoLeyenda');

  if (history.length < 2) {
    wrap.innerHTML = `<div style="text-align:center;padding:40px 0;font-size:11px;color:var(--text3)">
      ${history.length === 0 ? 'Aún no hay pases registrados.' : 'Se necesitan al menos 2 pases para mostrar la evolución.'}
    </div>`;
    leyEl.innerHTML = '';
    return;
  }

  // Ordenar cronológicamente
  history.sort((a, b) => new Date(a.date) - new Date(b.date));

  const TIPO_COLOR = {
    tecnico:  'var(--accent)',
    memoria:  'var(--orange)',
    concierto:'#9a70e8'
  };
  const TIPO_LABEL = { tecnico: 'Técnico', memoria: 'Memoria', concierto: 'Concierto' };

  // Normalizar: usar score numérico si existe, si no mapear quality legacy
  const legacyQ = { bien: 8, regular: 5, mal: 2 };
  const getScore = p => p.score ?? (p.quality ? legacyQ[p.quality] : null);

  // Filtrar solo pases con score
  const withScore = history.filter(p => getScore(p) !== null);
  if (withScore.length < 2) {
    wrap.innerHTML = `<div style="text-align:center;padding:40px 0;font-size:11px;color:var(--text3)">Se necesitan al menos 2 pases con puntuación.</div>`;
    leyEl.innerHTML = '';
    return;
  }

  // Dimensiones SVG
  const W = 460, H = 180;
  const PAD = { top: 16, right: 16, bottom: 36, left: 28 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const minT = new Date(withScore[0].date).getTime();
  const maxT = new Date(withScore[withScore.length - 1].date).getTime();
  const rangeT = maxT - minT || 1;

  const xOf = d => PAD.left + ((new Date(d).getTime() - minT) / rangeT) * cW;
  const yOf = s => PAD.top + cH - ((s - 1) / 9) * cH; // 1→bottom, 10→top

  // Media móvil ventana 3
  const smoothed = withScore.map((p, i) => {
    const win = withScore.slice(Math.max(0, i - 1), i + 2);
    const avg = win.reduce((s, x) => s + getScore(x), 0) / win.length;
    return { x: xOf(p.date), y: yOf(avg) };
  });

  const lineD = smoothed.map((pt, i) => (i === 0 ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`)).join(' ');

  // Grid 1, 5, 10
  const gridLines = [1, 5, 10].map(s => {
    const y = yOf(s);
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border2)" stroke-dasharray="3,3"/>
      <text x="${PAD.left - 3}" y="${y + 3.5}" text-anchor="end" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">${s}</text>`;
  }).join('');

  // Eje X
  const step = Math.max(1, Math.floor(withScore.length / 5));
  const xLabels = withScore.filter((_, i) => i % step === 0 || i === withScore.length - 1).map(p => {
    const x = xOf(p.date);
    const d = new Date(p.date);
    return `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">${d.getDate()}/${d.getMonth()+1}</text>`;
  }).join('');

  // Puntos
  const tiposUsados = new Set();
  const dots = withScore.map(p => {
    const sc = getScore(p);
    const x = xOf(p.date);
    const y = yOf(sc);
    const color = TIPO_COLOR[p.tipo] || 'var(--text2)';
    tiposUsados.add(p.tipo || 'tecnico');
    const nota = p.note ? ` · ${p.note}` : '';
    const d = new Date(p.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="var(--bg2)" stroke-width="1.5" opacity="0.92">
      <title>${d} · ${sc}/10${nota}</title>
    </circle>`;
  }).join('');

  // Área rellena debajo de la curva
  const areaD = `${lineD} L${smoothed[smoothed.length-1].x},${yOf(1)} L${smoothed[0].x},${yOf(1)} Z`;

  // Eventos reales que incluyen esta obra, dentro o cerca del rango
  const TIPOS_REALES = new Set(['concurso', 'audicion', 'concierto', 'grabacion']);
  const EVENTO_COLOR = {
    concurso:  '#9a60e0',
    audicion:  '#e05070',
    concierto: '#38c870',
    grabacion: '#4090e0'
  };
  const EVENTO_LABEL = { concurso: 'Concurso', audicion: 'Audición', concierto: 'Concierto', grabacion: 'Grabación' };

  const eventosReales = (db.eventos || []).filter(ev =>
    TIPOS_REALES.has(ev.tipo) && ev.obras.includes(graficoObraId)
  ).map(ev => ({ ...ev, t: new Date(ev.fecha + 'T12:00:00').getTime() }))
   .filter(ev => ev.t >= minT - 7*86400000 && ev.t <= maxT + 7*86400000) // ±7 días del rango
   .sort((a, b) => a.t - b.t);

  const eventLines = eventosReales.map(ev => {
    const x = Math.max(PAD.left, Math.min(W - PAD.right,
      PAD.left + ((ev.t - minT) / rangeT) * cW
    ));
    const col = EVENTO_COLOR[ev.tipo] || '#aaa';
    const d = new Date(ev.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    // Nombre truncado a 14 chars
    const lbl = ev.nombre.length > 14 ? ev.nombre.slice(0, 13) + '…' : ev.nombre;
    return `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + cH}"
        stroke="${col}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>
      <polygon points="${x},${PAD.top - 2} ${x-4},${PAD.top - 9} ${x+4},${PAD.top - 9}"
        fill="${col}" opacity="0.85"/>
      <title>${lbl} · ${d}</title>
      <text x="${x + 3}" y="${PAD.top + 10}" font-size="7.5" fill="${col}"
        font-family="JetBrains Mono,monospace" opacity="0.9">${lbl}</text>`;
  }).join('');

  const eventosUsados = new Set(eventosReales.map(e => e.tipo));

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;display:block">
    <defs>
      <linearGradient id="gAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${gridLines}
    ${eventLines}
    <path d="${areaD}" fill="url(#gAreaGrad)"/>
    <path d="${lineD}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" opacity="0.5"/>
    ${dots}
    ${xLabels}
  </svg>`;

  wrap.innerHTML = svg;

  // Leyenda de tipos de pase
  const leyPases = [...tiposUsados].map(t =>
    `<div class="mes-leyenda-item">
      <div style="width:8px;height:8px;border-radius:50%;background:${TIPO_COLOR[t] || 'var(--text2)'}"></div>
      <span style="font-size:9px;color:var(--text3)">${TIPO_LABEL[t] || t}</span>
    </div>`
  ).join('');

  // Leyenda de eventos reales
  const leyEventos = [...eventosUsados].map(t =>
    `<div class="mes-leyenda-item">
      <div style="width:2px;height:12px;background:${EVENTO_COLOR[t]};opacity:0.8;border-radius:1px"></div>
      <span style="font-size:9px;color:var(--text3)">${EVENTO_LABEL[t] || t}</span>
    </div>`
  ).join('');

  leyEl.innerHTML = leyPases + (leyEventos ? `<span style="color:var(--border);font-size:9px">|</span>${leyEventos}` : '');
}



function renderPases() {
  const el = document.getElementById('pasesList');
  const now = Date.now();

  // Construir lista plana de entidades (obra o movimiento) con sus datos de pase
  const items = [];

  (db.obras || []).forEach(obra => {
    const hasMovs = obra.movimientos && obra.movimientos.length > 0;

    if (hasMovs) {
      // Cada movimiento es una entidad independiente
      obra.movimientos.forEach(mov => {
        const lastPase = mov.lastPase ? new Date(mov.lastPase) : null;
        const dias = lastPase ? Math.floor((now - lastPase) / 86400000) : null;
        const lastEntry = (mov.paseHistory || [])[0] || null;
        items.push({
          id: obra.id + '__' + mov.id,
          obraId: obra.id,
          movId: mov.id,
          nombre: mov.name,
          sub: obra.name + ' · ' + (obra.composer || ''),
          dias,
          lastEntry,
          estado: mov.estado,
          urgencia: computeUrgencia(obra.id)
        });
      });
    } else {
      const lastPase = obra.lastPase ? new Date(obra.lastPase) : null;
      const dias = lastPase ? Math.floor((now - lastPase) / 86400000) : null;
      const lastEntry = (obra.paseHistory || [])[0] || null;
      items.push({
        id: obra.id,
        obraId: obra.id,
        movId: null,
        nombre: obra.name,
        sub: obra.composer || '',
        dias,
        lastEntry,
        estado: obra.estado,
        urgencia: computeUrgencia(obra.id)
      });
    }
  });

  // Ordenar: sin pase primero, luego por días desc
  items.sort((a, b) => {
    if (a.dias === null && b.dias === null) return 0;
    if (a.dias === null) return -1;
    if (b.dias === null) return 1;
    return b.dias - a.dias;
  });

  if (!items.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:11px;padding:30px 0;text-align:center">No hay obras. Añade obras primero.</div>';
    return;
  }

  const qIcons  = { bien: '<span style="color:var(--green)">✓</span>', regular: '<span style="color:var(--orange)">≈</span>', mal: '<span style="color:var(--red)">✗</span>' };
  const tipoLabels = { solo: 'solo', informal: 'amigos', escena: '🎭', tecnico: 'tec', memoria: 'mem', concierto: '🎭' };

  // Agrupar por urgencia / antigüedad
  const grupos = [
    { key: 'sinPase',  label: 'Sin pase registrado',    test: it => it.dias === null },
    { key: 'critico',  label: 'Hace más de 14 días',     test: it => it.dias !== null && it.dias > 14 },
    { key: 'viejo',    label: 'Hace 7–14 días',          test: it => it.dias !== null && it.dias >= 7 && it.dias <= 14 },
    { key: 'medio',    label: 'Hace 3–6 días',           test: it => it.dias !== null && it.dias >= 3 && it.dias <= 6 },
    { key: 'fresco',   label: 'Hace 1–2 días',           test: it => it.dias !== null && it.dias >= 1 && it.dias <= 2 },
    { key: 'hoy',      label: 'Hoy',                     test: it => it.dias === 0 },
  ];

  let html = '';
  grupos.forEach(grupo => {
    const lista = items.filter(grupo.test);
    if (!lista.length) return;
    html += `<div class="pases-group-title">${grupo.label}</div>`;
    lista.forEach(it => {
      // Badge de días
      let badgeClass, badgeText;
      if (it.dias === null) {
        badgeClass = 'nunca'; badgeText = '—';
      } else if (it.dias === 0) {
        badgeClass = 'fresco'; badgeText = 'hoy';
      } else if (it.dias <= 2) {
        badgeClass = 'fresco'; badgeText = it.dias + 'd';
      } else if (it.dias <= 6) {
        badgeClass = 'medio'; badgeText = it.dias + 'd';
      } else if (it.dias <= 14) {
        badgeClass = 'viejo'; badgeText = it.dias + 'd';
      } else {
        badgeClass = 'critico'; badgeText = it.dias + 'd';
      }

      // Último pase info
      let lastInfo = '';
      if (it.lastEntry) {
        const sc = it.lastEntry.score ?? null;
        const t = it.lastEntry.tipo;
        const col = sc !== null ? scoreColor(sc) : 'var(--text3)';
        const val = sc !== null ? sc : (it.lastEntry.quality === 'bien' ? '✓' : it.lastEntry.quality === 'regular' ? '≈' : it.lastEntry.quality === 'mal' ? '✗' : '—');
        lastInfo = `<span style="color:${col};font-weight:bold">${val}</span>` +
          (t ? ` <span style="color:var(--text3)">${tipoLabels[t] || t}</span>` : '');
        if (it.lastEntry.note) lastInfo += ` <span style="color:var(--text3)">· ${it.lastEntry.note}</span>`;
      }

      // Urgencia badge
      const urg = it.urgencia;
      const urgStr = urg.nivel !== 'sin-evento'
        ? `<span style="color:${urg.color}">${urg.label} · ${urg.dias}d</span>` : '';

      // Estado
      const fl = obraFaseLabel(it);
      const estStr = `<span style="color:var(--text3)">${fl.label}</span>`;

      html += `<div class="pase-row" onclick="registerPase('${it.obraId}',${it.movId ? "'" + it.movId + "'" : 'null'})">
        <div>
          <div class="pase-dias-badge ${badgeClass}">${badgeText}</div>
        </div>
        <div class="pase-info">
          <div class="pase-nombre">${it.nombre}</div>
          <div class="pase-sub">
            ${it.sub ? `<span>${it.sub}</span>` : ''}
            ${estStr}
            ${urgStr}
            ${lastInfo ? `<span class="pase-last-quality">${lastInfo}</span>` : ''}
          </div>
        </div>
        <button class="pase-btn" onclick="event.stopPropagation();openGrafico('${it.obraId}',${it.movId ? "'" + it.movId + "'" : 'null'})" style="border-color:var(--border2);color:var(--text3)">↗</button>
        <button class="pase-btn" onclick="event.stopPropagation();registerPase('${it.obraId}',${it.movId ? "'" + it.movId + "'" : 'null'})">+ pase</button>
      </div>`;
    });
  });

  el.innerHTML = html;
}



let mesOffset = 0; // 0 = mes actual, +1 = siguiente, etc.

function switchCalTab(tab, btn) {
  document.querySelectorAll('.cal-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('calPanelEventos').style.display = tab === 'eventos' ? '' : 'none';
  document.getElementById('calPanelMes').style.display     = tab === 'mes'     ? '' : 'none';
  if (tab === 'mes') renderMesCalendario();
}

function cambiarMes(delta) {
  mesOffset += delta;
  renderMesCalendario();
}

function renderMesCalendario() {
  const hoy = new Date();
  const ref = new Date(hoy.getFullYear(), hoy.getMonth() + mesOffset, 1);
  const year = ref.getFullYear();
  const month = ref.getMonth();

  // Label
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  document.getElementById('mesNavLabel').textContent = meses[month] + ' ' + year;

  // Agrupar eventos por día
  const eventosPorDia = {};
  (db.eventos || []).forEach(ev => {
    const d = new Date(ev.fecha + 'T12:00:00');
    const key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (!eventosPorDia[key]) eventosPorDia[key] = [];
    eventosPorDia[key].push(ev);
  });

  // Primer día de la semana (lunes = 0)
  const primerDia = new Date(year, month, 1);
  const offsetInicio = (primerDia.getDay() + 6) % 7; // lunes = 0
  const diasEnMes = new Date(year, month + 1, 0).getDate();
  const diasMesAnterior = new Date(year, month, 0).getDate();

  const grid = document.getElementById('mesGrid');
  let html = '';

  const TIPO_COLORS = { concurso:'#9a60e0', audicion:'#e05070', concierto:'#38c870', grabacion:'#4090e0', clase:'#e0a030', ensayo:'#30c0c0' };

  // Celdas del mes anterior (relleno)
  for (let i = 0; i < offsetInicio; i++) {
    const d = diasMesAnterior - offsetInicio + 1 + i;
    html += `<div class="mes-cell otro-mes"><span class="mes-cell-num">${d}</span></div>`;
  }

  // Días del mes
  for (let d = 1; d <= diasEnMes; d++) {
    const esHoy = d === hoy.getDate() && month === hoy.getMonth() && year === hoy.getFullYear();
    const key = year + '-' + month + '-' + d;
    const evs = eventosPorDia[key] || [];
    const dotsHtml = evs.map(ev =>
      `<div class="mes-dot ${ev.tipo}" title="${ev.nombre}"></div>`
    ).join('');
    html += `<div class="mes-cell${esHoy ? ' hoy' : ''}">
      <span class="mes-cell-num">${d}</span>
      <div class="mes-dots">${dotsHtml}</div>
    </div>`;
  }

  // Celdas del mes siguiente (relleno)
  const totalCeldas = offsetInicio + diasEnMes;
  const celdaSiguiente = totalCeldas % 7 === 0 ? 0 : 7 - (totalCeldas % 7);
  for (let i = 1; i <= celdaSiguiente; i++) {
    html += `<div class="mes-cell otro-mes"><span class="mes-cell-num">${i}</span></div>`;
  }

  grid.innerHTML = html;

  // Leyenda con los tipos presentes en el mes
  const tiposPresentes = new Set();
  Object.values(eventosPorDia).forEach(evs => evs.forEach(ev => {
    const d = new Date(ev.fecha + 'T12:00:00');
    if (d.getFullYear() === year && d.getMonth() === month) tiposPresentes.add(ev.tipo);
  }));
  const TIPO_LABELS = { concurso:'Concurso', audicion:'Audición', concierto:'Concierto', grabacion:'Grabación', clase:'Clase', ensayo:'Ensayo' };
  document.getElementById('mesLeyenda').innerHTML = [...tiposPresentes].map(t =>
    `<div class="mes-leyenda-item"><div class="mes-dot ${t}"></div>${TIPO_LABELS[t]||t}</div>`
  ).join('');
}



// Severity: how "perfect" each event type requires the obra to be
const EVENT_SEVERITY = { concurso: 1.0, audicion: 0.95, grabacion: 0.88, concierto: 0.72, clase: 0.48, ensayo: 0.32 };
const EVENT_LABEL = { concurso: 'Concurso', audicion: 'Audición', grabacion: 'Grabación', concierto: 'Concierto', clase: 'Clase', ensayo: 'Ensayo' };
const FASE_COLORS = { digitando: 'var(--orange)', consolidando: 'var(--accent)', mantenimiento: 'var(--green)', recuperacion: '#7a6acc' };

function computeUrgencia(obraId) {
  const now = Date.now();
  const proximos = (db.eventos || [])
    .filter(ev => !ev.completado && ev.obras.includes(obraId) && new Date(ev.fecha) >= new Date(new Date().toDateString()))
    .map(ev => ({ ...ev, dias: Math.ceil((new Date(ev.fecha) - now) / 86400000) }))
    .sort((a, b) => a.dias - b.dias);

  if (!proximos.length) return { nivel: 'sin-evento', label: 'Sin evento', color: 'var(--text3)', score: 0, evento: null };

  const ev = proximos[0];
  const sev = EVENT_SEVERITY[ev.tipo] || 0.7;
  const adjDias = ev.dias / sev;

  let nivel, label, color;
  if (adjDias <= 0)        { nivel = 'critico';  label = '¡Hoy!';    color = 'var(--red)'; }
  else if (adjDias <= 8)   { nivel = 'critico';  label = 'Crítico';  color = 'var(--red)'; }
  else if (adjDias <= 22)  { nivel = 'urgente';  label = 'Urgente';  color = 'var(--orange)'; }
  else if (adjDias <= 65)  { nivel = 'medio';    label = 'Medio';    color = 'var(--accent)'; }
  else if (adjDias <= 130) { nivel = 'holgado';  label = 'Holgado';  color = 'var(--green)'; }
  else                      { nivel = 'lejano';   label = 'Lejano';   color = 'var(--text3)'; }

  const score = (1000 / Math.max(ev.dias, 0.5)) * sev;
  return { nivel, label, color, score, evento: ev, dias: ev.dias };
}

// ── EVENTO READINESS & RESULTADO ─────────────────────────────────────────────

function readinessColor(pct) {
  if (pct >= 80) return 'var(--green)';
  if (pct >= 60) return 'var(--sol-mid, #8aaa30)';
  if (pct >= 40) return 'var(--accent)';
  if (pct >= 20) return 'var(--orange)';
  return 'var(--red)';
}

function readinessLabel(pct) {
  if (pct >= 85) return 'Listo';
  if (pct >= 70) return 'Bien encaminado';
  if (pct >= 50) return 'En construcción';
  if (pct >= 30) return 'En riesgo';
  return 'Sin preparar';
}

function computeEventoReadiness(evento) {
  const obras = (evento.obras || []).map(id => findObra(id)).filter(Boolean);
  if (!obras.length) return null;

  let totalWeight = 0, totalScore = 0;
  const detalles = [];

  obras.forEach(obra => {
    const weight = obra.duracion || 5;
    // Aprendizaje (0-100): compasPercent o apr fallback
    const pct = compasPercent(obra);
    const aprScore = pct !== null ? pct : Math.min(100, (obra.apr || 1) * 10);
    // Solidez (0-100)
    const solEst = estimateSolActual(obra);
    const solScore = solEst.val; // already 0-100
    // Escena/libertad (0-100): from escHistory or obra.esc (1-10)
    const escHistVal = obra.escHistory?.length ? normalizeSolVal(obra.escHistory[0].val) : null;
    const escScore = escHistVal !== null ? escHistVal : Math.min(100, (obra.esc || 1) * 10);
    // Pase recency bonus/penalty
    let paseBonus = 0;
    if (obra.lastPase) {
      const diasSinPase = (Date.now() - new Date(obra.lastPase)) / 86400000;
      if (diasSinPase <= 7)  paseBonus = 10;
      else if (diasSinPase <= 14) paseBonus = 5;
      else if (diasSinPase > 60)  paseBonus = -10;
    }
    const obraScore = Math.min(100, Math.max(0,
      aprScore * 0.25 + solScore * 0.40 + escScore * 0.30 + paseBonus * 0.05
    ));
    totalScore += obraScore * weight;
    totalWeight += weight;
    detalles.push({ obraId: obra.id, nombre: obra.name, weight, aprScore, solScore, escScore, obraScore });
  });

  const global = totalWeight > 0 ? Math.round(totalScore / totalWeight) : null;
  return { global, detalles };
}

let _eventoResId = null;
const _eventoResExcluidas = new Set(); // obraIds excluidas del resultado

function openEventoResultado(eventoId) {
  const ev = (db.eventos || []).find(e => e.id === eventoId);
  if (!ev) return;
  _eventoResId = eventoId;
  _eventoResExcluidas.clear();
  const obras = (ev.obras || []).map(id => findObra(id)).filter(Boolean);

  document.getElementById('eventoResTitle').textContent = ev.nombre;

  const obrasHtml = obras.map(obra => {
    const solPrev = estimateSolActual(obra).val;
    const escPrev = obra.escHistory?.length ? normalizeSolVal(obra.escHistory[0].val) : Math.min(100, (obra.esc || 1) * 10);
    return '<div class="resultado-obra-block" id="res-block-' + obra.id + '">' +
      '<div class="resultado-obra-head">' +
        '<div class="resultado-obra-name">' + obra.name + (obra.composer ? ' <span style="font-size:11px;color:var(--text3)">' + obra.composer + '</span>' : '') + '</div>' +
        '<button type="button" class="resultado-skip-btn" id="res-skip-' + obra.id + '" onclick="toggleEventoResObra(\'' + obra.id + '\')">No la toqué</button>' +
      '</div>' +

      '<div class="resultado-obra-body" id="res-body-' + obra.id + '">' +
        '<div class="resultado-slider-label"><span>Solidez</span>' +
        '<span class="resultado-pct-val" id="res-sol-val-' + obra.id + '" style="color:' + SOL_COLOR + '">' + solPrev + '%</span></div>' +
        '<input type="range" min="0" max="100" step="1" value="' + solPrev + '" class="sol-slider" id="res-sol-' + obra.id + '" style="color:' + SOL_COLOR + '"' +
        ' oninput="updateResSlider(\'sol\',\'' + obra.id + '\',this.value)">' +

        '<div class="resultado-slider-label" style="margin-top:8px"><span>Libertad en escena</span>' +
        '<span class="resultado-pct-val" id="res-esc-val-' + obra.id + '" style="color:' + ESC_COLOR + '">' + escPrev + '%</span></div>' +
        '<input type="range" min="0" max="100" step="1" value="' + escPrev + '" class="sol-slider" id="res-esc-' + obra.id + '" style="color:' + ESC_COLOR + '"' +
        ' oninput="updateResSlider(\'esc\',\'' + obra.id + '\',this.value)">' +

        '<input type="text" class="modal-input" id="res-nota-' + obra.id + '" placeholder="nota sobre esta obra (opcional)" style="margin-top:8px;margin-bottom:0">' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('eventoResObras').innerHTML = obrasHtml || '<div style="color:var(--text3);font-size:11px">Este evento no tiene obras asignadas.</div>';
  openModal('modalEventoResultado');
  requestAnimationFrame(() => {
    obras.forEach(obra => {
      fillSlider(document.getElementById('res-sol-' + obra.id), SOL_COLOR);
      fillSlider(document.getElementById('res-esc-' + obra.id), ESC_COLOR);
    });
  });
}

// Excluye/incluye una obra del resultado del evento. Las excluidas no cuentan
// en el score global, no graban pase de escena ni quedan en `obrasResultados`.
function toggleEventoResObra(obraId) {
  const excluida = !_eventoResExcluidas.has(obraId);
  if (excluida) _eventoResExcluidas.add(obraId);
  else _eventoResExcluidas.delete(obraId);
  const block = document.getElementById('res-block-' + obraId);
  const body  = document.getElementById('res-body-' + obraId);
  const btn   = document.getElementById('res-skip-' + obraId);
  if (block) block.classList.toggle('excluida', excluida);
  if (body)  body.style.display = excluida ? 'none' : '';
  if (btn)   btn.textContent = excluida ? '↺ Incluir' : 'No la toqué';
}

function updateResSlider(tipo, obraId, val) {
  const col = tipo === 'esc' ? ESC_COLOR : SOL_COLOR;
  const el = document.getElementById('res-' + tipo + '-val-' + obraId);
  if (el) { el.textContent = parseInt(val) + '%'; el.style.color = col; }
  fillSlider(document.getElementById('res-' + tipo + '-' + obraId), col);
}

function confirmEventoResultado() {
  const ev = (db.eventos || []).find(e => e.id === _eventoResId);
  if (!ev) return;
  const obras = (ev.obras || []).map(id => findObra(id)).filter(Boolean);

  let totalScore = 0, totalWeight = 0;
  // Solo las obras NO excluidas se valoran y registran como pase de escena.
  // Las excluidas se guardan aparte con flag skipped:true para tener constancia
  // de que pertenecían al evento pero no se tocaron — sin contaminar las stats.
  const obrasResultados = [];
  const obrasOmitidas = [];
  obras.forEach(obra => {
    if (_eventoResExcluidas.has(obra.id)) {
      obrasOmitidas.push({ obraId: obra.id, obraName: obra.name, skipped: true });
      return;
    }
    const sol = parseInt(document.getElementById('res-sol-' + obra.id)?.value || 0);
    const esc = parseInt(document.getElementById('res-esc-' + obra.id)?.value || 0);
    const nota = document.getElementById('res-nota-' + obra.id)?.value.trim() || '';
    const weight = obra.duracion || 5;
    const obraScore = Math.round(sol * 0.5 + esc * 0.5);
    totalScore += obraScore * weight;
    totalWeight += weight;
    recordSolHistory(obra.id, sol, 'pase-escena');
    recordEscHistory(obra.id, esc, 'pase-escena');
    obrasResultados.push({ obraId: obra.id, obraName: obra.name, sol, esc, nota, obraScore });
  });

  // Si todas las obras se omitieron, marcamos como realizado sin score: que se
  // pinte "✓ Realizado" en lugar de "0% éxito" en rojo.
  const scoreTotal = obrasResultados.length === 0
    ? null
    : (totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0);

  ev.completado = true;
  ev.completedDate = new Date().toISOString();
  ev.resultado = { obrasResultados, obrasOmitidas, scoreTotal };

  saveData();
  closeModal('modalEventoResultado');
  renderCalendario();
  const sufijoOmitidas = obrasOmitidas.length
    ? ' · ' + obrasOmitidas.length + (obrasOmitidas.length === 1 ? ' obra omitida' : ' obras omitidas')
    : '';
  if (obrasResultados.length === 0) {
    showToast(ev.nombre + ' · marcado realizado (todas omitidas)');
  } else {
    showToast(ev.nombre + ' · ' + scoreTotal + '% de éxito ✓' + sufijoOmitidas);
  }
}

function renderCalendario() {
  const list = document.getElementById('eventosList');
  const pastList = document.getElementById('eventosPasadosList');
  const now = Date.now();
  const todos = (db.eventos || []).map(ev => ({
    ...ev,
    dias: Math.ceil((new Date(ev.fecha) - now) / 86400000)
  })).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const pendientes = todos.filter(ev => !ev.completado && ev.dias > -2);
  const completados = todos.filter(ev => ev.completado).sort((a,b) => new Date(b.completedDate||b.fecha) - new Date(a.completedDate||a.fecha));
  const pasados = todos.filter(ev => !ev.completado && ev.dias < -1).reverse();

  if (!pendientes.length) {
    list.innerHTML = emptyStateHTML(ICON_CALENDAR_EMPTY, 'Sin eventos próximos', 'Añade un concierto, concurso, grabación o clase.');
  } else {
    list.innerHTML = pendientes.map(ev => renderEventoCard(ev, false)).join('');
  }

  let pastHtml = '';
  if (completados.length) {
    pastHtml += '<div class="cal-past-label">Realizados</div>' +
      completados.map(ev => renderEventoCard(ev, false, true)).join('');
  }
  if (pasados.length) {
    pastHtml += '<div class="cal-past-label">Sin registrar resultado</div>' +
      pasados.slice(0, 5).map(ev => renderEventoCard(ev, true)).join('');
  }
  pastList.innerHTML = pastHtml;
  updateHeader();
}

function renderEventoCard(ev, isPast, isCompletado) {
  const obras = (ev.obras || []).map(id => db.obras.find(o => o.id === id)).filter(Boolean);

  // Days label - day 0 = critical
  let diasLabel;
  if (isCompletado) {
    const scoreTotal = ev.resultado?.scoreTotal;
    const col = scoreTotal >= 80 ? 'var(--green)' : scoreTotal >= 55 ? 'var(--accent)' : 'var(--orange)';
    diasLabel = scoreTotal != null
      ? '<div class="evento-score-badge" style="background:' + col + '22;color:' + col + ';border:1px solid ' + col + '44">' + scoreTotal + '% éxito</div>'
      : '<div style="font-size:9px;color:var(--green)">✓ Realizado</div>';
  } else if (isPast) {
    diasLabel = '<div class="evento-dias" style="color:var(--text3)">−' + Math.abs(ev.dias) + '</div><div class="evento-dias-label">días atrás</div>';
  } else if (ev.dias === 0) {
    diasLabel = '<div class="evento-dias critico" style="font-size:16px">¡HOY!</div>';
  } else if (ev.dias <= 7) {
    diasLabel = '<div class="evento-dias critico">' + ev.dias + '</div><div class="evento-dias-label">días</div>';
  } else if (ev.dias <= 21) {
    diasLabel = '<div class="evento-dias urgente">' + ev.dias + '</div><div class="evento-dias-label">días</div>';
  } else {
    diasLabel = '<div class="evento-dias">' + ev.dias + '</div><div class="evento-dias-label">días</div>';
  }

  const fechaStr = new Date(ev.fecha).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const obrasHtml = obras.map(o => {
    const faseClass = obraFase(o);
    return '<span class="evento-obra-chip"><span class="evento-obra-dot ' + faseClass + '"></span>' + o.name + '</span>';
  }).join('');

  // Readiness block (only for non-completed upcoming events with obras)
  let readinessHtml = '';
  if (!isCompletado && !isPast && obras.length) {
    const r = computeEventoReadiness(ev);
    if (r && r.global !== null) {
      const col = readinessColor(r.global);
      readinessHtml = '<div class="evento-readiness">' +
        '<div class="readiness-label-row"><span style="font-size:8px;letter-spacing:0.1em;text-transform:uppercase">Preparación</span>' +
        '<span class="readiness-pct" style="color:' + col + '">' + r.global + '%</span></div>' +
        '<div class="readiness-bar-wrap"><div class="readiness-bar-fill" style="width:' + r.global + '%;background:' + col + '"></div></div>' +
        '<div class="readiness-label-row"><span style="color:' + col + '">' + readinessLabel(r.global) + '</span>' +
        '<span style="font-size:7px">' + r.detalles.map(d => d.nombre.split(' ')[0] + ' ' + Math.round(d.obraScore) + '%').join(' · ') + '</span></div>' +
        '</div>';
    }
    // Meta de estudio: horas para llevar TODAS las obras al 80% de solidez.
    const ha = _eventoHorasA80(ev, ev.dias);
    if (ha) {
      const fH = h => h >= 10 ? Math.round(h) + ' h' : (Math.round(h * 2) / 2) + ' h';
      if (ha.faltan === 0) {
        readinessHtml += '<div class="evento-meta80 ok">Todas tus obras ≥ 80% ✓</div>';
      } else {
        let perDia = '';
        if (ha.porDia != null) {
          perDia = '<span class="evento-meta80-sub">' + _eventoRitmoSub(ha.porDia) + '</span>';
        }
        const cuantas = ha.faltan < ha.total ? ' <span class="evento-meta80-n">(' + ha.faltan + '/' + ha.total + ')</span>' : '';
        readinessHtml += '<div class="evento-meta80">' +
          '<span>Para todo al 80%: <strong>' + fH(ha.horas) + '</strong>' + cuantas + '</span>' +
          perDia + '</div>';
      }
    }
  }

  // Resultado detail for completed
  let resultadoHtml = '';
  if (isCompletado && ev.resultado?.obrasResultados?.length) {
    const rows = ev.resultado.obrasResultados.map(r =>
      '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text2);padding:2px 0">' +
      '<span>' + (r.obraName || r.obraId) + '</span>' +
      '<span style="color:' + readinessColor(r.obraScore) + ';font-family:\'JetBrains Mono\',monospace">' + r.obraScore + '%</span></div>'
    ).join('');
    resultadoHtml = '<div style="padding:8px 16px 4px;border-top:1px solid var(--border2)">' + rows + '</div>';
  }

  const doneBtn = isCompletado
    ? '<button class="evento-done-btn completado" disabled>✓ Realizado</button>'
    : '<button class="evento-done-btn" onclick="openEventoResultado(\'' + ev.id + '\')">✓ Marcar realizado</button>';

  const cardOpacity = (isPast && !isCompletado) ? ' style="opacity:0.55"' : '';

  return '<div class="evento-card"' + cardOpacity + '>' +
    '<div class="evento-header"><div>' +
    '<span class="evento-tipo-badge ' + ev.tipo + '">' + (EVENT_LABEL[ev.tipo]||ev.tipo) + '</span>' +
    '<div class="evento-nombre" style="margin-top:6px">' + ev.nombre + '</div>' +
    '<div style="font-size:9px;color:var(--text3);margin-top:2px">' + fechaStr + '</div>' +
    '</div>' +
    '<div class="evento-fecha">' + diasLabel + '</div></div>' +
    (obras.length ? '<div class="evento-obras-section"><div class="evento-obras-label">Obras (' + obras.length + ')</div>' + obrasHtml + '</div>' : '') +
    readinessHtml +
    resultadoHtml +
    '<div class="evento-actions">' +
    doneBtn +
    (!isCompletado ? '<button class="evento-edit-btn" onclick="openEditEvento(\'' + ev.id + '\')">Editar</button>' : '') +
    '<button class="evento-delete-btn" onclick="deleteEvento(\'' + ev.id + '\')">Eliminar</button>' +
    '</div></div>';
}

// ─── EVENTO MODAL ─────────────────────────────────────────────────────────────

let eventoTipoSelected = 'concurso';

function openAddEvento() {
  document.getElementById('eventoEditId').value = '';
  document.getElementById('eventoModalTitle').textContent = 'Nuevo evento';
  document.getElementById('eventoNombre').value = '';
  document.getElementById('eventoFecha').value = '';
  eventoTipoSelected = 'concurso';
  document.querySelectorAll('#eventoTipoSelector .evento-tipo-btn').forEach(b => {
    b.classList.remove('active');
    if (b.classList.contains('concurso')) b.classList.add('active');
  });
  renderObraCheckList([]);
  openModal('modalAddEvento');
}

function openEditEvento(eventoId) {
  const ev = (db.eventos || []).find(e => e.id === eventoId);
  if (!ev) return;
  document.getElementById('eventoEditId').value = eventoId;
  document.getElementById('eventoModalTitle').textContent = 'Editar evento';
  document.getElementById('eventoNombre').value = ev.nombre;
  document.getElementById('eventoFecha').value = ev.fecha;
  eventoTipoSelected = ev.tipo;
  document.querySelectorAll('#eventoTipoSelector .evento-tipo-btn').forEach(b => {
    b.classList.remove('active');
    if (b.classList.contains(ev.tipo)) b.classList.add('active');
  });
  renderObraCheckList(ev.obras || []);
  openModal('modalAddEvento');
}

function selectEventoTipo(tipo, btn) {
  eventoTipoSelected = tipo;
  document.querySelectorAll('#eventoTipoSelector .evento-tipo-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active', tipo);
}

function renderObraCheckList(selectedIds) {
  const container = document.getElementById('obraCheckList');
  container.innerHTML = (db.obras || []).map(o => `
    <label class="obra-check-item">
      <input type="checkbox" value="${o.id}" ${selectedIds.includes(o.id) ? 'checked' : ''} onchange="updateEventoModalPred()">
      <div class="obra-fase ${o.fase}" style="width:7px;height:7px;border-radius:50%;flex-shrink:0"></div>
      <span class="obra-check-name">${o.name}</span>
      <span class="obra-check-composer">${o.composer}</span>
    </label>`).join('');
  updateEventoModalPred();
}

// Caja viva en el modal de evento: horas para llevar las obras marcadas al 80%,
// con ritmo diario si hay fecha. Refleja la selección actual en tiempo real.
function updateEventoModalPred() {
  const box = document.getElementById('eventoMetaPred');
  if (!box) return;
  const ids = [...document.querySelectorAll('#obraCheckList input:checked')].map(el => el.value);
  if (!ids.length) { box.style.display = 'none'; return; }
  const fecha = (document.getElementById('eventoFecha') || {}).value;
  let dias = null;
  if (fecha) {
    const d = new Date(fecha + 'T12:00:00');
    if (!isNaN(d.getTime())) dias = Math.max(0, Math.ceil((d - Date.now()) / 86400000));
  }
  const ha = _eventoHorasA80({ obras: ids }, dias);
  if (!ha) { box.style.display = 'none'; return; }
  box.style.display = '';
  const fH = h => h >= 10 ? Math.round(h) + ' h' : (Math.round(h * 2) / 2) + ' h';
  if (ha.faltan === 0) {
    box.className = 'evento-meta80 ok';
    box.innerHTML = 'Todas estas obras ya están ≥ 80% ✓';
    return;
  }
  box.className = 'evento-meta80';
  let perDia = '';
  if (ha.porDia != null) {
    perDia = '<span class="evento-meta80-sub">' + _eventoRitmoSub(ha.porDia) + '</span>';
  }
  const cuantas = ha.faltan < ha.total ? ' <span class="evento-meta80-n">(' + ha.faltan + '/' + ha.total + ')</span>' : '';
  box.innerHTML = '<span>Para todo al 80%: <strong>' + fH(ha.horas) + '</strong>' + cuantas + '</span>' + perDia;
}

function saveEvento() {
  const nombre = document.getElementById('eventoNombre').value.trim();
  const fecha = document.getElementById('eventoFecha').value;
  if (!nombre) { showToast('Escribe el nombre del evento'); return; }
  if (!fecha) { showToast('Selecciona una fecha'); return; }

  const obraIds = [...document.querySelectorAll('#obraCheckList input:checked')].map(el => el.value);
  const editId = document.getElementById('eventoEditId').value;

  if (!db.eventos) db.eventos = [];

  if (editId) {
    const ev = db.eventos.find(e => e.id === editId);
    if (ev) { ev.nombre = nombre; ev.fecha = fecha; ev.tipo = eventoTipoSelected; ev.obras = obraIds; }
  } else {
    db.eventos.push({ id: 'ev_' + Date.now(), tipo: eventoTipoSelected, nombre, fecha, obras: obraIds });
  }

  saveData();
  closeModal('modalAddEvento');
  renderCalendario();
  updateHeader();
  showToast(editId ? 'Evento actualizado ✓' : 'Evento añadido ✓');
}

function deleteEvento(eventoId) {
  const ev = (db.eventos || []).find(e => e.id === eventoId);
  if (!ev) return;
  const fecha = ev.fecha ? new Date(ev.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  if (!confirm('¿Eliminar el evento "' + (ev.nombre || 'sin nombre') + '"' + (fecha ? ' del ' + fecha : '') + '?\n\nEsta acción no se puede deshacer.')) return;
  db.eventos = (db.eventos || []).filter(e => e.id !== eventoId);
  saveData();
  renderCalendario();
  updateHeader();
  showToast('Evento eliminado');
}

// ─── BREAK TIMER ─────────────────────────────────────────────────────────────

const breakTimers = {};

function startBreakTimer(id, totalSecs) {
  if (breakTimers[id]) {
    clearInterval(breakTimers[id]);
    delete breakTimers[id];
    document.getElementById(id + '-display').style.display = 'none';
    document.getElementById(id + '-btn').textContent = '⏱ Iniciar pausa';
    return;
  }
  let remaining = totalSecs;
  const display = document.getElementById(id + '-display');
  const btn = document.getElementById(id + '-btn');
  display.style.display = 'block';
  btn.textContent = '✕ Cancelar';
  function tick() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    display.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    if (remaining <= 0) {
      clearInterval(breakTimers[id]);
      delete breakTimers[id];
      display.textContent = '✓ Pausa terminada';
      btn.textContent = '⏱ Iniciar pausa';
    }
    remaining--;
  }
  tick();
  breakTimers[id] = setInterval(tick, 1000);
}

// ─── REGISTRO ────────────────────────────────────────────────────────────────




// ─── HISTORIAL SESIONES ──────────────────────────────────────────────────────

// ─── ESTADO DIARIO CHART ─────────────────────────────────────────────────────

// Cache for full-screen modal
let _estadoSesionesCache = [];

// Valor de ESTADO de una sesión, migrando cualquier formato antiguo
// (bienestar/sueño/energia/claridad) a la única variable nueva.
function _sesionEstadoVal(s) {
  const e = s && s.estado;
  if (!e) return null;
  if (typeof e.estado === 'number') return e.estado;
  if (typeof e.bienestar === 'number') return e.bienestar;
  if (typeof e.energia === 'number' && typeof e.claridad === 'number') return Math.round((e.energia + e.claridad) / 2);
  if (typeof e.energia === 'number') return e.energia;
  return null;
}

// Shared SVG builder — called from inline section and from the full-screen modal.
// Una sola serie protagonista "Estado" (área + línea con degradado) y, en
// secundario, la valoración de la "Sesión" como línea fina punteada.
function _smoothSvgPath(pts) {
  if (!pts || !pts.length) return '';
  if (pts.length === 1) return 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
  let d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' '
      + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' '
      + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
  }
  return d;
}

function _buildEstadoChartSvg(W, H, sesiones) {
  const pad = { l: 30, r: 14, t: 20, b: 32 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  const minT = new Date(sesiones[0].date).getTime();
  const maxT = new Date(sesiones[sesiones.length-1].date).getTime();
  const rangeT = maxT - minT || 1;
  const xOf = t => pad.l + ((t - minT) / rangeT) * cW;
  const yOf = v => pad.t + cH - (Math.max(0, Math.min(100, v)) / 100) * cH;
  const baseY = pad.t + cH;
  const id = 'se' + (++_statsGradSeq);

  const defs = '<defs>'
    + '<linearGradient id="' + id + 'a" x1="0" y1="0" x2="0" y2="1">'
    +   '<stop offset="0" style="stop-color:var(--accent2)" stop-opacity="0.42"/>'
    +   '<stop offset="1" style="stop-color:var(--accent)" stop-opacity="0.02"/>'
    + '</linearGradient>'
    + '<linearGradient id="' + id + 'l" x1="0" y1="0" x2="1" y2="0">'
    +   '<stop offset="0" style="stop-color:var(--accent)"/>'
    +   '<stop offset="1" style="stop-color:var(--accent2)"/>'
    + '</linearGradient>'
    + '<filter id="' + id + 'g" x="-20%" y="-60%" width="140%" height="240%">'
    +   '<feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="var(--accent)" flood-opacity="0.4"/>'
    + '</filter>'
    + '</defs>';

  // Grid horizontal (0/50/100) con etiquetas legibles.
  const gridY = [0, 50, 100].map(v => {
    const y = yOf(v);
    return '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W-pad.r) + '" y2="' + y
      + '" stroke="var(--border2)" stroke-width="' + (v === 50 ? 0.8 : 0.6) + '" stroke-dasharray="2,3" opacity="0.6"/>'
      + '<text x="' + (pad.l-4) + '" y="' + (y+3) + '" text-anchor="end" font-size="9" fill="var(--text3)" font-family="\'JetBrains Mono\',monospace">' + v + '</text>';
  }).join('');

  // Serie ESTADO (protagonista): área + línea + puntos.
  const ePts = sesiones.map(s => {
    const v = _sesionEstadoVal(s);
    return v == null ? null : { x: xOf(new Date(s.date).getTime()), y: yOf(v), v, date: s.date };
  }).filter(Boolean);
  let estadoSvg = '';
  if (ePts.length >= 2) {
    const line = _smoothSvgPath(ePts);
    const curveRest = line.replace(/^M[^C]+/, '');
    const area = 'M' + ePts[0].x.toFixed(1) + ',' + baseY + ' '
      + 'L' + ePts[0].x.toFixed(1) + ',' + ePts[0].y.toFixed(1) + ' ' + curveRest
      + ' L' + ePts[ePts.length-1].x.toFixed(1) + ',' + baseY + ' Z';
    estadoSvg += '<path d="' + area + '" fill="url(#' + id + 'a)"/>'
      + '<path d="' + line + '" fill="none" stroke="url(#' + id + 'l)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" filter="url(#' + id + 'g)"/>'
      + ePts.map(p => '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.2" fill="var(--accent2)" stroke="var(--bg2)" stroke-width="1.4"><title>Estado ' + p.v + ' · ' + new Date(p.date).toLocaleDateString('es-ES',{day:'numeric',month:'short'}) + '</title></circle>').join('');
  } else if (ePts.length === 1) {
    const p = ePts[0];
    estadoSvg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.6" fill="var(--accent2)" stroke="var(--bg2)" stroke-width="1.4"/>';
  }

  // Serie SESIÓN (secundaria): cómo fue la sesión, línea fina punteada.
  const rPts = sesiones.filter(s => s.rating != null)
    .map(s => ({ x: xOf(new Date(s.date).getTime()), y: yOf(s.rating) }));
  let ratingSvg = '';
  if (rPts.length >= 2) {
    const line = _smoothSvgPath(rPts);
    ratingSvg = '<path d="' + line + '" fill="none" stroke="var(--orange)" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="4,3" opacity="0.6"/>';
  }

  // Leyenda en la franja superior.
  const legend = '<g font-family="\'JetBrains Mono\',monospace" font-size="9">'
    + '<circle cx="' + (pad.l+5) + '" cy="10" r="3.2" fill="var(--accent2)"/>'
    + '<text x="' + (pad.l+13) + '" y="13" fill="var(--text2)">Estado</text>'
    + (rPts.length >= 2
        ? '<line x1="' + (pad.l+62) + '" y1="10" x2="' + (pad.l+78) + '" y2="10" stroke="var(--orange)" stroke-width="1.5" stroke-dasharray="4,3"/>'
          + '<text x="' + (pad.l+83) + '" y="13" fill="var(--text2)">Sesión</text>'
        : '')
    + '</g>';

  // X date labels — intervalos temporales con filtro de colisión en píxeles.
  // Evita el amontonamiento cuando hay muchas sesiones en poco tiempo.
  const rangeDays = (maxT - minT) / 86400000;
  const dayMs = 86400000;
  const tickInterval = rangeDays <= 10  ? dayMs
    : rangeDays <= 45  ? 7  * dayMs
    : rangeDays <= 120 ? 14 * dayMs
    : 30 * dayMs;
  const firstTickT = Math.ceil(minT / tickInterval) * tickInterval;
  const candidateTimes = [minT];
  for (let t = firstTickT; t <= maxT; t += tickInterval) candidateTimes.push(t);
  if (candidateTimes[candidateTimes.length-1] < maxT) candidateTimes.push(maxT);
  const minPxGap = Math.max(22, Math.round(cW / 10)); // adapt to chart width
  const usedXs = [];
  const xLabels = candidateTimes
    .filter((t, idx, arr) => arr.indexOf(t) === idx && t >= minT && t <= maxT)
    .filter(t => {
      const x = xOf(t);
      if (usedXs.some(ux => Math.abs(ux - x) < minPxGap)) return false;
      usedXs.push(x);
      return true;
    })
    .map(t => {
      const d = new Date(t);
      const lbl = rangeDays > 90
        ? d.getDate() + '/' + (d.getMonth()+1) + '/' + String(d.getFullYear()).slice(2)
        : d.getDate() + '/' + (d.getMonth()+1);
      return '<text x="' + xOf(t) + '" y="' + (H-6) + '" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="\'JetBrains Mono\',monospace">' + lbl + '</text>';
    }).join('');

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">'
    + defs + gridY + ratingSvg + estadoSvg + legend + xLabels + '</svg>';
}

let _estadoChartRangeDays = null; // null = todo el histórico

function setEstadoChartRange(days, btn) {
  _estadoChartRangeDays = days;
  document.querySelectorAll('#estadoChartRangeBtns .sort-btn')
    .forEach(b => b.classList.toggle('active', b === btn));
  _renderEstadoChartModal();
}

function openEstadoChartModal() {
  _estadoChartRangeDays = null;
  document.querySelectorAll('#estadoChartRangeBtns .sort-btn')
    .forEach((b, i) => b.classList.toggle('active', i === 0));
  // Abrir PRIMERO el modal y renderizar luego, cuando el contenedor ya tiene
  // dimensiones reales. Renderizar en display:none puede dejar el SVG con
  // width=0 en algunos navegadores móviles, y el usuario ve el modal vacío.
  openModal('modalEstadoChart');
  requestAnimationFrame(() => _renderEstadoChartModal());
}

function _renderEstadoChartModal() {
  const all = (db.sesiones || [])
    .filter(s => s.estado && (typeof s.estado.estado === 'number' || typeof s.estado.bienestar === 'number' || typeof s.estado.energia === 'number'))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const sesiones = _estadoChartRangeDays
    ? all.filter(s => (Date.now() - new Date(s.date).getTime()) <= _estadoChartRangeDays * 86400000)
    : all;
  const el = document.getElementById('estadoChartModalSvg');
  if (!el) return;
  if (sesiones.length < 2) {
    el.innerHTML = '<div style="padding:40px;text-align:center;font-size:11px;color:var(--text3)">No hay suficientes datos para el rango seleccionado.</div>';
    return;
  }
  el.innerHTML = _buildEstadoChartSvg(680, 240, sesiones);
}

function renderEstadoSection() {
  const el = document.getElementById('estadoSection');
  if (!el) return;

  // Collect all sessions with estado data, chronological asc.
  // Aceptamos sesiones con bienestar (nuevas) o con energia (antiguas, que
  // se migran al vuelo para mostrar coherente en la gráfica).
  const sesionesConEstado = (db.sesiones || [])
    .filter(s => s.estado && (typeof s.estado.estado === 'number' || typeof s.estado.bienestar === 'number' || typeof s.estado.energia === 'number'))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sesionesConEstado.length < 2) {
    el.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:4px">'
      + '<div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;color:var(--accent);font-weight:300;margin-bottom:8px">Estado diario</div>'
      + '<div style="font-size:9px;color:var(--text3);line-height:1.6">Genera al menos 2 sesiones con los sliders de estado para ver la gráfica de ciclos.<br>'
      + (sesionesConEstado.length === 1 ? 'Ya tienes 1 sesión registrada.' : 'Los sliders aparecen al inicio de cada sesión.') + '</div></div>';
    return;
  }

  _estadoSesionesCache = sesionesConEstado; // for full-screen modal

  // Detect pattern: cycles of low ESTADO.
  let patternNote = '';
  const estadoSeries = sesionesConEstado.map(s => {
    const v = _sesionEstadoVal(s);
    return v == null ? 50 : v;
  });
  const dips = [];
  for (let i = 1; i < estadoSeries.length-1; i++) {
    if (estadoSeries[i] < 40 && estadoSeries[i-1] >= 40) dips.push(i);
  }
  if (dips.length >= 2) {
    const gaps = [];
    for (let i = 1; i < dips.length; i++) {
      const t1 = new Date(sesionesConEstado[dips[i-1]].date).getTime();
      const t2 = new Date(sesionesConEstado[dips[i]].date).getTime();
      gaps.push((t2-t1)/86400000);
    }
    const avgCycle = Math.round(gaps.reduce((s,g)=>s+g,0)/gaps.length);
    patternNote = '<div style="font-size:9px;color:var(--text3);background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 10px;margin-top:8px">'
      + '📊 Ciclo detectado: bajón de estado cada ~<strong style="color:var(--accent)">' + avgCycle + ' días</strong> de media'
      + ' (' + dips.length + ' bajones registrados). Con más datos se afinará.</div>';
  } else if (sesionesConEstado.length >= 5) {
    patternNote = '<div style="font-size:9px;color:var(--text3);margin-top:6px">Registra más sesiones para detectar tu ciclo de estado.</div>';
  }

  // Medias de los últimos 7 registros: Estado (la variable única) y Sesión.
  const recent = sesionesConEstado.slice(-7);
  const _avgOf = fn => {
    const vals = recent.map(fn).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((s,v) => s+v, 0) / vals.length) : null;
  };
  const avgCols = [
    { label: 'Estado', color: 'var(--accent)', val: _avgOf(_sesionEstadoVal) },
    { label: 'Sesión', color: 'var(--orange)', val: _avgOf(s => s.rating) },
  ].filter(c => c.val != null).map(c =>
    '<div style="text-align:center;flex:1">'
    + '<div style="font-family:\'Cormorant Garamond\',serif;font-size:22px;color:' + c.color + '">' + c.val + '</div>'
    + '<div style="font-size:8px;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em">' + c.label + '</div>'
    + '</div>').join('');

  el.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:14px 16px">'
    + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">'
    + '<div><div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;color:var(--accent);font-weight:300">Estado diario</div>'
    + '<div style="font-size:8px;color:var(--text3);letter-spacing:0.1em;text-transform:uppercase">Últimas ' + sesionesConEstado.length + ' sesiones registradas</div></div>'
    + '<div style="display:flex;align-items:center;gap:10px">'
    + '<div style="font-size:8px;color:var(--text3)">Media 7d</div>'
    + '<button onclick="openEstadoChartModal()" style="font-family:\'JetBrains Mono\',monospace;font-size:8px;padding:3px 9px;background:transparent;border:1px solid var(--border2);border-radius:5px;color:var(--text3);cursor:pointer">↗ ampliar</button>'
    + '</div></div>'
    + '<div style="display:flex;gap:10px;margin-bottom:12px">' + avgCols + '</div>'
    + _buildEstadoChartSvg(340, 170, sesionesConEstado)
    + patternNote
    + '</div>';
}

// ─── ESTADÍSTICAS · Dashboard de concentración ────────────────────────────────
// Tarjetas con selector Semana/Mes/Año y flechas de periodo: tiempo total con
// barras por día (o por mes en vista Año), día de la semana más fuerte,
// momento del día (curva horaria) y reparto por obra (donut).
// Fuentes de datos:
//  - db.sessionPlants + db.forestPlants: timestamps reales → curva horaria,
//    reparto por obra y días antiguos fuera del cap de db.sesiones.
//  - db.sesiones: total diario (incluye registros manuales sin timestamp).
//    Por día se toma el MÁXIMO de ambas fuentes para no contar doble.
let _statsRange = localStorage.getItem('stats_range') || 'semana';
if (['semana', 'mes', 'año'].indexOf(_statsRange) === -1) _statsRange = 'semana';
let _statsOffset = 0; // 0 = periodo actual, -1 = anterior…

function _statsAllPlants() {
  const out = [];
  const add = p => {
    if (!p || p.failed || !p.startedAt) return;
    const start = new Date(p.startedAt);
    if (isNaN(start.getTime())) return;
    const mins = Math.max(0, Math.round(p.mins || 0));
    if (!mins) return;
    out.push({ obraId: p.obraId || null, tag: p.tag || null, start, mins });
  };
  (db.sessionPlants || []).forEach(add);
  (db.forestPlants || []).forEach(add);
  return out;
}

function _statsISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Mapa por día: minutos netos del día + primer inicio. Sirve para detectar
// "días intensos" (4 h+/5 h+) y a qué hora arrancan. Por defecto usa todo el
// historial; se le puede pasar un subconjunto (p. ej. la ventana de 3 meses).
function _statsDayMap(plants) {
  const map = {};
  (plants || _statsAllPlants()).forEach(p => {
    const iso = _statsISO(p.start);
    if (!map[iso]) map[iso] = { mins: 0, firstMs: Infinity, first: null };
    map[iso].mins += p.mins;
    const ms = p.start.getTime();
    if (ms < map[iso].firstMs) { map[iso].firstMs = ms; map[iso].first = p.start; }
  });
  return map;
}

// Hora media de inicio (minutos desde medianoche) y nº de días que superan
// `thresholdMin` minutos netos. null si no hay ninguno con hora de inicio.
function _statsIntenseStart(dayMap, thresholdMin) {
  const starts = [];
  Object.keys(dayMap).forEach(k => {
    const d = dayMap[k];
    if (d.mins >= thresholdMin && d.first) starts.push(d.first.getHours() * 60 + d.first.getMinutes());
  });
  if (!starts.length) return null;
  const avg = Math.round(starts.reduce((a, b) => a + b, 0) / starts.length);
  return { avgMin: avg, count: starts.length };
}

function _fmtHourMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Minutos netos REALES de hoy en vivo: lo ya consolidado + la sesión en marcha.
function _doneMinHoy() {
  let m = (typeof getMinutosConcentradoHoy === 'function') ? getMinutosConcentradoHoy() : 0;
  if (typeof crono !== 'undefined' && crono
      && (crono.state === 'running' || crono.state === 'paused')
      && typeof cronoEffectiveElapsedMs === 'function') {
    m += Math.floor(cronoEffectiveElapsedMs() / 60000);
  }
  return m;
}

// Probabilidad EN VIVO de llegar hoy a 4 h / 5 h netas, dada la hora actual y
// los minutos ya hechos. Modelo empírico: para cada día pasado miramos cuántos
// minutos se estudiaron A PARTIR de esta hora del día; si lo que queda de hoy
// fuera como ese día, ¿el total (hecho + resto) alcanza la meta? La probabilidad
// es la fracción de días históricos que lo lograrían. Cae sola según avanza la
// hora (queda menos margen) y sube con los minutos ya hechos.
//
// Ventana DESLIZANTE de 3 meses (los últimos ~90 días hasta hoy), que se corre
// cada día. Refleja el hábito actual: bastante larga para no ser aleatoria, pero
// reciente, así que el comportamiento de hace años ya no cuenta. Si hay pocos
// días en la ventana, la amplía (6m → 12m → histórico) para no quedarse en blanco.
function _recentPlants() {
  const all = _statsAllPlants();
  const now = Date.now();
  const countDays = arr => { const s = {}; arr.forEach(p => { s[_statsISO(p.start)] = 1; }); return Object.keys(s).length; };
  const win = d => all.filter(p => p.start.getTime() >= now - d * 86400000);
  const p90 = win(90);
  if (countDays(p90) >= 10) return { plants: p90, scope: '3 meses' };
  const p180 = win(180);
  if (countDays(p180) >= 10) return { plants: p180, scope: '6 meses' };
  const p365 = win(365);
  if (countDays(p365) >= 10) return { plants: p365, scope: '12 meses' };
  return { plants: all, scope: 'histórico' };
}

// ── HORAS BLOQUEADAS HOY ──────────────────────────────────────────────────────
// Franjas en las que Alberto sabe que NO podrá estudiar (cita, clase, etc.).
// Se guardan solo para el día de hoy (se resetean en cuanto cambia la fecha) y
// el modelo de probabilidad descuenta el tiempo histórico que caería en ellas.
function _blkHmToMin(hm) { const a = String(hm).split(':'); return (parseInt(a[0], 10) || 0) * 60 + (parseInt(a[1], 10) || 0); }
function _blockedDayState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('alberto_blocked_hoy') || 'null'); } catch (e) {}
  const today = _statsISO(new Date());
  if (!s || s.date !== today || !Array.isArray(s.blocks)) s = { date: today, blocks: [] };
  return s;
}
function _blockedDaySave(s) { try { localStorage.setItem('alberto_blocked_hoy', JSON.stringify(s)); } catch (e) {} }
function _getBlockedRangesToday() {
  return _blockedDayState().blocks
    .map(b => ({ s: _blkHmToMin(b.start), e: _blkHmToMin(b.end) }))
    .filter(r => r.e > r.s)
    .sort((a, b) => a.s - b.s);
}
function _blockOverlapMin(s, e, ranges) {
  let o = 0;
  for (const r of ranges) { const a = Math.max(s, r.s), b = Math.min(e, r.e); if (b > a) o += b - a; }
  return o;
}
// Minutos bloqueados que aún quedan por delante (a partir de nowMin).
function _blockedMinAfter(nowMin) {
  return _getBlockedRangesToday().reduce((t, r) => t + Math.max(0, r.e - Math.max(r.s, nowMin)), 0);
}
// Hora tope: como muy tarde paro a esta hora (minutos desde medianoche).
// Por defecto medianoche (1440). Preferencia estable, no por día.
function _horaTopeMin() {
  const v = localStorage.getItem('alberto_hora_tope');
  if (!v) return 1440;
  const m = _blkHmToMin(v);
  return (m > 0 && m <= 1440) ? m : 1440;
}
function setHoraTope(v) {
  if (v) localStorage.setItem('alberto_hora_tope', v);
  else localStorage.removeItem('alberto_hora_tope');
  _afterBlockedChange();
}

function _liveIntenseProb(nowMin, doneMin) {
  const todayIso = _statsISO(new Date());
  const { plants, scope } = _recentPlants();
  const byDay = {};
  plants.forEach(p => {
    const iso = _statsISO(p.start);
    if (iso === todayIso) return; // hoy no entra en su propia predicción
    (byDay[iso] || (byDay[iso] = [])).push({ sm: p.start.getHours() * 60 + p.start.getMinutes(), mins: p.mins });
  });
  const days = Object.keys(byDay);
  if (days.length < 8) return null; // pocos datos para fiarse
  const blocks = _getBlockedRangesToday(); // franjas de hoy en las que no estudiaré
  // Proyección por día: hecho hoy + lo que ESE día se hizo tras esta hora.
  const rows = days.map(k => {
    let after = 0;
    byDay[k].forEach(p => {
      if (p.sm < nowMin) return;
      let m = p.mins;
      if (blocks.length) m -= _blockOverlapMin(p.sm, p.sm + p.mins, blocks);
      if (m > 0) after += m;
    });
    return { iso: k, proj: doneMin + after };
  });

  // Estadística base (todos los días por igual).
  const base = _projStats(rows.map(r => ({ proj: r.proj, w: 1 })));

  // Si Alberto ha introducido HOY su estado, condicionamos: pesamos cada día
  // pasado por la similitud de su estado con el de hoy (kernel gaussiano) y
  // mezclamos con la base por shrinkage (más peso a lo condicionado cuanta más
  // muestra parecida haya), para que no sea ruido con pocos días.
  const eToday = _estadoHoySet();
  let estadoInfo = null, out = { p4: base.p4, p5: base.p5, median: base.median, p75: base.p75 };
  if (eToday != null) {
    const estadoByDay = _estadoByDay();
    const sigma = 18; // ~un paso de cara
    let sumW = 0, sumW2 = 0, matched = 0;
    const wrows = rows.map(r => {
      const e = estadoByDay[r.iso];
      let w;
      if (e == null) { w = 0.15; } // días sin estado registrado: cuentan poco
      else { const d = e - eToday; w = Math.exp(-(d * d) / (2 * sigma * sigma)); if (w >= 0.5) matched++; }
      sumW += w; sumW2 += w * w;
      return { proj: r.proj, w };
    });
    const effN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0; // tamaño de muestra efectivo
    const cond = _projStats(wrows);
    const K = 6;
    const alpha = effN / (effN + K); // 0..1: cuánto pesa lo condicionado
    out = {
      p4: alpha * cond.p4 + (1 - alpha) * base.p4,
      p5: alpha * cond.p5 + (1 - alpha) * base.p5,
      median: alpha * cond.median + (1 - alpha) * base.median,
      p75: alpha * cond.p75 + (1 - alpha) * base.p75,
    };
    const fi = estadoToFaceIndex(eToday);
    estadoInfo = {
      val: eToday, matched, effN: Math.round(effN), alpha,
      emoji: (ESTADO_FACES[fi] || {}).emoji, label: (ESTADO_FACES[fi] || {}).label,
      baseP4: Math.round(base.p4),
    };
  }
  return {
    p4: Math.round(out.p4),
    p5: Math.round(out.p5),
    n: days.length,
    scope,
    projMedian: Math.round(out.median),
    projP75: Math.round(out.p75),
    estado: estadoInfo,
  };
}

// Estadística de proyección con pesos: % de días (ponderado) que llegan a 4h/5h
// y cuantiles ponderados (mediana, p75).
function _projStats(rows) {
  const totW = rows.reduce((s, r) => s + r.w, 0) || 1;
  let w4 = 0, w5 = 0;
  rows.forEach(r => { if (r.proj >= 240) w4 += r.w; if (r.proj >= 300) w5 += r.w; });
  const sorted = rows.slice().sort((a, b) => a.proj - b.proj);
  const wq = f => {
    const target = f * totW; let acc = 0;
    for (const r of sorted) { acc += r.w; if (acc >= target) return r.proj; }
    return sorted.length ? sorted[sorted.length - 1].proj : 0;
  };
  return { p4: w4 / totW * 100, p5: w5 / totW * 100, median: wq(0.5), p75: wq(0.75) };
}

// Valor de estado (0-100) desde cualquier formato (número u objeto).
function _estadoVal(src) {
  if (src == null) return null;
  if (typeof src === 'number') return src;
  if (typeof src.estado === 'number') return src.estado;
  if (typeof src.bienestar === 'number') return src.bienestar;
  if (typeof src.energia === 'number' && typeof src.claridad === 'number') return Math.round((src.energia + src.claridad) / 2);
  if (typeof src.energia === 'number') return src.energia;
  return null;
}
// Estado introducido HOY (o null si aún no lo ha tocado hoy).
function _estadoHoySet() {
  const today = new Date().toDateString();
  try { if (db && db.estadoDiario && db.estadoDiario.date === today && db.estadoDiario.userSet) { const v = _estadoVal(db.estadoDiario); if (v != null) return v; } } catch (e) { /* noop */ }
  try { const s = JSON.parse(localStorage.getItem('alberto_estado_v1') || 'null'); if (s && s.date === today && s.userSet) { const v = _estadoVal(s); if (v != null) return v; } } catch (e) { /* noop */ }
  return null;
}
// Mapa iso-día -> estado registrado ese día (de db.sesiones).
function _estadoByDay() {
  const m = {};
  (db.sesiones || []).forEach(s => {
    if (!s || !s.date) return;
    const v = _estadoVal(s.estado);
    if (v != null) m[_statsISO(new Date(s.date))] = v;
  });
  return m;
}

// Devuelve los sub-tramos LIBRES de [a,b] tras quitar las franjas bloqueadas.
function _subtractBlocks(a, b, blocks) {
  if (!blocks || !blocks.length) return [[a, b]];
  const out = [];
  let cur = a;
  for (const r of blocks) {
    if (r.e <= cur || r.s >= b) continue;
    if (r.s > cur) out.push([cur, Math.min(r.s, b)]);
    cur = Math.max(cur, r.e);
    if (cur >= b) break;
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

// Eficiencia de estudio = minutos netos / minutos brutos "enganchado", sobre la
// ventana de 3 meses. Para cada día se agrupan las prácticas en bloques (huecos
// ≤ GAP cuentan como pausa dentro del bloque; huecos mayores = te desenganchaste
// y no cuentan). bruto = suma de los tramos de bloque; neto = suma de minutos
// practicados. Es tu ritmo real: cuánto neto sacas por hora de estar a ello,
// pausas cortas incluidas. Base para predecir la hora de llegada a 4 h / 5 h.
function _studyEfficiency() {
  const { plants, scope } = _recentPlants();
  const todayIso = _statsISO(new Date());
  const byDay = {};
  plants.forEach(p => {
    const iso = _statsISO(p.start);
    if (iso === todayIso) return;
    (byDay[iso] || (byDay[iso] = [])).push({ a: p.start.getHours() * 60 + p.start.getMinutes(), m: p.mins });
  });
  const days = Object.keys(byDay);
  if (days.length < 8) return null;
  const GAP = 30; // hueco máx (min) que se considera pausa dentro de la misma sesión
  let totNet = 0, totGross = 0;
  days.forEach(k => {
    const ps = byDay[k].slice().sort((x, y) => x.a - y.a);
    let bStart = null, bEnd = null;
    const close = () => { if (bStart != null) totGross += (bEnd - bStart); };
    ps.forEach(p => {
      const s = p.a, e = p.a + p.m;
      totNet += p.m;
      if (bStart == null) { bStart = s; bEnd = e; }
      else if (s - bEnd <= GAP) { bEnd = Math.max(bEnd, e); }
      else { close(); bStart = s; bEnd = e; }
    });
    close();
  });
  if (totGross <= 0) return null;
  let ratio = totNet / totGross;
  if (ratio > 1) ratio = 1;
  if (ratio < 0.25) ratio = 0.25; // suelo de seguridad ante datos raros
  return { ratio, scope, days: days.length };
}

// ¿A qué HORA FÍSICA de hoy llegaría a `target` minutos netos? A tu ritmo real
// (eficiencia neta/bruta), para sumar lo que falta necesitas remaining/eficiencia
// minutos brutos "enganchado"; se avanza desde ahora consumiendo solo tiempo
// libre (saltando franjas bloqueadas) hasta tu hora tope. Siempre definida (no
// depende de cuántos días llegaste). Cambia en vivo con minutos, hora y bloqueos.
function _liveTargetETA(nowMin, doneMin, target) {
  const remaining = target - doneMin;
  if (remaining <= 0) return { reached: true };
  const eff = _studyEfficiency();
  if (!eff) return null;
  const grossNeeded = remaining / eff.ratio; // minutos brutos "enganchado" que faltan
  const blocks = _getBlockedRangesToday();
  const cutoff = _horaTopeMin();
  let acc = 0, eta = null;
  for (const [fa, fb] of _subtractBlocks(nowMin, cutoff, blocks)) {
    const len = fb - fa;
    if (acc + len >= grossNeeded) { eta = fa + (grossNeeded - acc); break; }
    acc += len;
  }
  if (eta == null) return { none: true, scope: eff.scope, eff: eff.ratio };
  // Margen de pausa que tu propio ritmo incluye en ese tramo (bruto − neto).
  const breakMin = Math.max(0, Math.round(grossNeeded - remaining));
  return { etaMin: Math.round(eta), breakMin, scope: eff.scope, eff: eff.ratio };
}

// Estado del día para premios: base del % de la mañana + si ya celebramos 4h/5h.
function _probDayState() {
  const today = _statsISO(new Date());
  let s = null;
  try { s = JSON.parse(localStorage.getItem('prob_day_v1') || 'null'); } catch (e) { /* noop */ }
  if (!s || s.date !== today) s = { date: today, base4: null, fired4: false, fired5: false };
  return s;
}
function _probDaySave(s) {
  try { localStorage.setItem('prob_day_v1', JSON.stringify(s)); } catch (e) { /* noop */ }
}

// Hora de comienzo opcional: si Alberto va a empezar más tarde, la fija y el
// "quédate hasta…" se calcula desde esa hora en vez de desde ahora. Se guarda con
// la fecha para limpiarse sola al día siguiente.
function _horaComienzoState() {
  const today = _statsISO(new Date());
  let s = null;
  try { s = JSON.parse(localStorage.getItem('alberto_hora_comienzo_v1') || 'null'); } catch (e) { /* noop */ }
  if (!s || s.date !== today) s = { date: today, hm: '' };
  return s;
}
function _horaComienzoMin() {
  const s = _horaComienzoState();
  if (!s.hm) return null;
  const m = _blkHmToMin(s.hm);
  return (m == null) ? null : m;
}
function setHoraComienzo(hm) {
  const s = _horaComienzoState();
  s.hm = hm || '';
  try { localStorage.setItem('alberto_hora_comienzo_v1', JSON.stringify(s)); } catch (e) { /* noop */ }
}

// Texto para mostrar la probabilidad de hoy. null si no hay datos suficientes.
function _probTextHoy() {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const done = _doneMinHoy();
  const r = _liveIntenseProb(nowMin, done);
  if (!r) return null;
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const doneTxt = done >= 60 ? Math.floor(done / 60) + ' h' + (done % 60 ? ' ' + (done % 60) + ' min' : '') : done + ' min';
  // Proyección: lo más probable que acabes estudiando hoy (mediana), a 5 min,
  // con el "buen día" (p75) como margen al alza.
  const projMin = Math.round(r.projMedian / 5) * 5;
  const p75 = Math.round(r.projP75 / 5) * 5;
  let projVal, projExtra = '';
  if (projMin >= 15) {
    projVal = '≈ ' + fmtMinutos(projMin);
    if (p75 >= projMin + 30 && done < 240) projExtra = 'buen día ' + fmtMinutos(p75);
  } else {
    projVal = 'rara vez sigues';
    if (p75 >= 30) projExtra = 'buen día ' + fmtMinutos(p75);
  }
  // Base del día: el primer % de 4h que vimos hoy, para medir cuánto has
  // remontado y celebrar si lo logras saliendo de pocas probabilidades.
  const dayS = _probDayState();
  if (dayS.base4 == null) { dayS.base4 = r.p4; _probDaySave(dayS); }
  const base4 = dayS.base4;
  const delta = r.p4 - base4;

  // Mensaje de ánimo / PREMIO según el momento.
  let tip, reward = null, celebrate = null;
  if (done >= 300) {
    tip = '✦ ¡5 h netas! Día de excelencia'; reward = 'gold';
    if (!dayS.fired5) celebrate = '5h';
  } else if (done >= 240) {
    tip = (base4 != null && base4 < 45) ? '🏆 ¡Contra pronóstico! 4 h saliendo del ' + base4 + '%' : '🏆 ¡4 h logradas! a por las 5';
    reward = 'gold';
    if (!dayS.fired4) celebrate = '4h';
  } else if (delta >= 20) {
    tip = '🔥 +' + delta + '% desde que arrancaste · ¡vas lanzado!'; reward = 'hot';
  } else {
    tip = r.p4 >= 55 ? 'vas en buena hora' : (r.p4 >= 20 ? 'cuanto antes sigas, más sube' : 'hoy se hace cuesta arriba');
  }

  // Texto compacto (3 líneas) para el cronómetro.
  const proj = projMin >= 15
    ? ('Hoy ≈ <strong>' + fmtMinutos(projMin) + '</strong>' + ((p75 >= projMin + 30 && done < 240) ? ' · buen día ' + fmtMinutos(p75) : ''))
    : ('A esta hora rara vez sigues' + (p75 >= 30 ? ' · buen día ' + fmtMinutos(p75) : ''));
  let prob, sub;
  if (done >= 240) {
    prob = tip;
    sub = (done < 300 ? '5 h: ' + r.p5 + '% · ' : '') + hhmm + ' · llevas ' + doneTxt;
  } else {
    prob = '4 h: <strong>' + r.p4 + '%</strong> · 5 h: <strong>' + r.p5 + '%</strong>';
    sub = hhmm + ' · llevas ' + doneTxt + ' · ' + tip;
  }
  // Una sola línea compacta para el cronómetro (menos texto arriba en reposo).
  let cronoLine;
  if (done >= 300) cronoLine = '<strong>5 h netas hoy</strong> ✦';
  else if (done >= 240) cronoLine = '<strong>4 h hechas</strong> · 5 h ' + r.p5 + '%';
  else cronoLine = '<strong>' + projVal + '</strong> · 4 h ' + r.p4 + '% · 5 h ' + r.p5 + '%';
  // Hora física a la que sueles llegar a 4 h / 5 h (mediana de la ventana de 3 meses,
  // contando lo ya hecho, la hora actual y los bloqueos). Se recalcula en vivo.
  const startOv = _horaComienzoMin();
  const startedLater = startOv != null && startOv > nowMin;
  const fromMin = startedLater ? startOv : nowMin;
  const eta4 = done >= 240 ? { reached: true } : _liveTargetETA(fromMin, done, 240);
  const eta5 = done >= 300 ? { reached: true } : _liveTargetETA(fromMin, done, 300);
  return { proj, prob, sub, cronoLine, p4: r.p4, p5: r.p5, done, projVal, projExtra, tip, reward, celebrate, base4, scope: r.scope, hhmm, doneTxt, eta4, eta5, startMin: startOv, startedLater, estadoAdj: r.estado };
}

// Chip "ajustado a cómo estás hoy": solo si hay señal real (≥3 días parecidos).
function _probEstadoChip(e) {
  if (!e || e.matched < 3) return '';
  const tip = 'Proyección ajustada a días en que te sentías como hoy (' + (e.label || '') + '): ~'
    + e.matched + ' días parecidos. Sin ajustar, 4 h saldría al ' + e.baseP4 + '%.';
  return ' <span class="prob-estado-chip" title="' + tip + '">' + (e.emoji || '') + ' como hoy</span>';
}

// Tarjeta rica (coloreada, por bloques) para la pantalla de Sesión.
function _probRichHTML(t) {
  const done240 = t.done >= 240, done300 = t.done >= 300;
  const blkTotal = _fmtBlockedTotal();
  const blkBtn = '<button class="prob-bloqueo-btn' + (blkTotal ? ' on' : '') + '"'
    + ' onclick="openHorasBloqueadas(event)" title="Horas que hoy no podrás estudiar">⊘'
    + (blkTotal ? ' ' + blkTotal : '') + '</button>';
  const startBtn = '<button class="prob-bloqueo-btn prob-start-btn' + (t.startedLater ? ' on' : '') + '"'
    + ' onclick="openHoraComienzo(event)" title="Hora a la que vas a empezar (calcula el «quédate hasta» desde esa hora)">▷'
    + (t.startedLater ? ' ' + _fmtHourMin(t.startMin) : '') + '</button>';
  return '<div class="prob-head">'
      + '<span class="prob-head-left"><span class="prob-kicker">Hoy</span>'
        + '<span class="prob-scope">' + (t.scope || '3 meses') + '</span></span>'
      + '<span class="prob-context">' + t.hhmm + ' · llevas <b>' + t.doneTxt + '</b></span>'
      + '<span class="prob-head-btns">' + startBtn + blkBtn + '</span>'
    + '</div>'
    + '<div class="prob-body">'
      + '<div class="prob-proj">'
        + '<div class="prob-proj-label">Proyección' + _probEstadoChip(t.estadoAdj) + '</div>'
        + '<div class="prob-proj-val">' + t.projVal + '</div>'
        + (t.projExtra ? '<div class="prob-proj-extra">' + t.projExtra + '</div>' : '')
      + '</div>'
      + '<div class="prob-tiles">'
        + '<div class="prob-tile p4' + (done240 ? ' done' : '') + '">'
          + '<div class="prob-tile-ring">' + _ringMeterSVG(done240 ? 100 : t.p4, done240 ? 'var(--green)' : 'var(--accent)', { size: 58, stroke: 6, center: done240 ? '✓' : Math.round(t.p4), centerSize: done240 ? 24 : 18, textColor: done240 ? 'var(--green)' : 'var(--accent)' }) + '</div>'
          + '<div class="prob-tile-pct">' + (done240 ? '✓' : t.p4 + '<span>%</span>') + '</div>'
          + '<div class="prob-tile-label">4 horas</div>'
          + '<div class="prob-bar"><i style="width:' + (done240 ? 100 : t.p4) + '%"></i></div>'
        + '</div>'
        + '<div class="prob-tile p5' + (done300 ? ' done' : '') + '">'
          + '<div class="prob-tile-ring">' + _ringMeterSVG(done300 ? 100 : t.p5, done300 ? 'var(--green)' : 'var(--orange)', { size: 58, stroke: 6, center: done300 ? '✓' : Math.round(t.p5), centerSize: done300 ? 24 : 18, textColor: done300 ? 'var(--green)' : 'var(--orange)' }) + '</div>'
          + '<div class="prob-tile-pct">' + (done300 ? '✓' : t.p5 + '<span>%</span>') + '</div>'
          + '<div class="prob-tile-label">5 horas</div>'
          + '<div class="prob-bar"><i style="width:' + (done300 ? 100 : t.p5) + '%"></i></div>'
        + '</div>'
      + '</div>'
    + '</div>'
    + _probEtaLine(t)
    + '<div class="prob-tip' + (t.reward ? ' reward-' + t.reward : '') + '">' + t.tip + '</div>';
}

// Línea "¿hasta qué hora?": hora física de hoy a la que llegarías a 4 h / 5 h.
function _probEtaFmt(min) {
  if (min >= 1440) return _fmtHourMin(min - 1440) + ' (mñn)';
  return _fmtHourMin(min);
}
function _fmtBreakShort(min) {
  if (min >= 60) { const h = Math.floor(min / 60), m = min % 60; return m ? h + 'h' + m : h + 'h'; }
  return min + 'm';
}
function _probEtaLine(t) {
  const item = (eta, label, target, color) => {
    if (!eta) return '';
    if (eta.reached) return '<span class="prob-eta-item done"><b>' + label + '</b><span>✓</span></span>';
    if (eta.none) return '<span class="prob-eta-item none"><b>' + label + '</b><span>fuera de alcance</span></span>';
    let pausa = '', tip = '';
    if (eta.breakMin > 0) {
      // Sugerencia de reparto: una pausa por cada ~50 min de estudio restante.
      const remaining = target - t.done;
      const nBreaks = Math.max(1, Math.round(remaining / 50));
      const each = Math.round(eta.breakMin / nBreaks);
      const ritmo = eta.eff ? ' · ritmo ' + Math.round(eta.eff * 100) + '% (neto/bruto)' : '';
      tip = ' title="A tu ritmo llegarías a ' + label + ' hacia las ' + _probEtaFmt(eta.etaMin) + '. Margen de pausa ' + eta.breakMin + ' min — p.ej. ' + nBreaks + ' pausas de ~' + each + ' min' + ritmo + '"';
      pausa = '<i class="prob-eta-rest">☕ ' + _fmtBreakShort(eta.breakMin) + '</i>';
    }
    return '<span class="prob-eta-item"' + tip + '><b style="color:' + color + '">' + label + '</b><span>'
      + _probEtaFmt(eta.etaMin) + '</span>' + pausa + '</span>';
  };
  const a = item(t.eta4, '4 h', 240, 'var(--accent)');
  const b = item(t.eta5, '5 h', 300, 'var(--orange)');
  if (!a && !b) return '';
  const cap = t.startedLater ? ('Empiezas ' + _fmtHourMin(t.startMin) + ' · quédate hasta') : 'Quédate hasta';
  return '<div class="prob-eta"><span class="prob-eta-cap">' + cap + '</span>' + a + b + '</div>';
}

// ── UI de horas bloqueadas ────────────────────────────────────────────────────
function _fmtBlockedTotal() {
  const tot = _getBlockedRangesToday().reduce((t, r) => t + (r.e - r.s), 0);
  if (!tot) return '';
  const h = Math.floor(tot / 60), m = tot % 60;
  return h ? (m ? h + 'h' + m : h + 'h') : m + 'min';
}
function openHorasBloqueadas(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  openModal('modalHorasBloqueadas');
  renderHorasBloqueadasList();
  const tope = document.getElementById('horaTope');
  if (tope) tope.value = localStorage.getItem('alberto_hora_tope') || '';
}

function openHoraComienzo(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  openModal('modalHoraComienzo');
  const i = document.getElementById('horaComienzoInput');
  if (i) i.value = _horaComienzoState().hm || '';
}
function applyHoraComienzo() {
  const i = document.getElementById('horaComienzoInput');
  setHoraComienzo(i ? i.value : '');
  closeModal('modalHoraComienzo');
  if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(true);
}
function clearHoraComienzo() {
  setHoraComienzo('');
  const i = document.getElementById('horaComienzoInput');
  if (i) i.value = '';
  closeModal('modalHoraComienzo');
  if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(true);
}
function renderHorasBloqueadasList() {
  const cont = document.getElementById('horasBloqueadasList');
  if (!cont) return;
  const s = _blockedDayState();
  if (!s.blocks.length) {
    cont.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:6px 0">Sin franjas bloqueadas. Añade abajo las horas que tienes ocupadas hoy.</div>';
    return;
  }
  cont.innerHTML = s.blocks.slice()
    .sort((a, b) => _blkHmToMin(a.start) - _blkHmToMin(b.start))
    .map((b, i) => '<div class="bloq-chip"><span>' + b.start + ' → ' + b.end + '</span>'
      + '<button onclick="removeHoraBloqueada(' + i + ')" title="Quitar">✕</button></div>').join('');
}
function addHoraBloqueada() {
  const d = document.getElementById('bloqDesde'), h = document.getElementById('bloqHasta');
  if (!d || !h || !d.value || !h.value) { showToast('Indica desde y hasta'); return; }
  if (_blkHmToMin(h.value) <= _blkHmToMin(d.value)) { showToast('«Hasta» debe ser posterior a «Desde»'); return; }
  const s = _blockedDayState();
  s.blocks.push({ start: d.value, end: h.value });
  _blockedDaySave(s);
  d.value = ''; h.value = '';
  renderHorasBloqueadasList();
  _afterBlockedChange();
}
function removeHoraBloqueada(i) {
  const s = _blockedDayState();
  const sorted = s.blocks.slice().sort((a, b) => _blkHmToMin(a.start) - _blkHmToMin(b.start));
  const target = sorted[i];
  s.blocks = s.blocks.filter(b => b !== target);
  _blockedDaySave(s);
  renderHorasBloqueadasList();
  _afterBlockedChange();
}
function _afterBlockedChange() {
  if (typeof renderSessionInsights === 'function') renderSessionInsights();
  if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(true);
}

// Refresca los dos sitios donde vive la probabilidad de hoy: el cronómetro
// (#cronoProbabilidad) y la tarjeta de insight de la pantalla de Sesión.
// Throttle por (minuto del día + minutos hechos): solo recalcula cuando cambian.
let _probLastKey = '';
function updateLiveProbabilityUI(force) {
  const cEl = document.getElementById('cronoProbabilidad');
  const sCard = document.getElementById('sessionProbCard');
  if (!cEl && !sCard) return;
  const now = new Date();
  const key = (now.getHours() * 60 + now.getMinutes()) + '|' + _doneMinHoy();
  if (!force && key === _probLastKey) return;
  _probLastKey = key;
  const t = _probTextHoy();
  if (cEl) {
    if (!t) { cEl.style.display = 'none'; }
    else {
      cEl.style.display = '';
      cEl.classList.toggle('hot', t.p4 >= 55 || t.done >= 240);
      cEl.innerHTML = '<span class="crono-prob-line">' + t.cronoLine + '</span>';
    }
  }
  if (sCard) {
    if (!t) { sCard.style.display = 'none'; }
    else { sCard.style.display = ''; sCard.innerHTML = _probRichHTML(t); }
  }
  // PREMIO: celebra una sola vez al día al cruzar 4h / 5h.
  if (t && t.celebrate) {
    const s = _probDayState();
    if (t.celebrate === '5h' && !s.fired5) {
      s.fired5 = true; s.fired4 = true; _probDaySave(s);
      if (typeof showToast === 'function') showToast('✦ ¡5 horas netas hoy! Día de excelencia');
      if (typeof SFX !== 'undefined' && SFX.saveSession) SFX.saveSession();
    } else if (t.celebrate === '4h' && !s.fired4) {
      s.fired4 = true; _probDaySave(s);
      const msg = (s.base4 != null && s.base4 < 45)
        ? '🏆 ¡Contra pronóstico! 4 h saliendo del ' + s.base4 + '%'
        : '🏆 ¡4 horas netas hoy!';
      if (typeof showToast === 'function') showToast(msg);
      if (typeof SFX !== 'undefined' && SFX.saveSession) SFX.saveSession();
    }
  }
}

function _statsPeriod(offset) {
  if (offset == null) offset = _statsOffset;
  const now = new Date();
  let start, end, label;
  if (_statsRange === 'semana') {
    const lunes = new Date(now);
    lunes.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
    lunes.setHours(0, 0, 0, 0);
    start = lunes;
    end = new Date(lunes); end.setDate(lunes.getDate() + 7);
    const dom = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const mes = d => d.toLocaleDateString('es-ES', { month: 'short' });
    label = lunes.getDate() + (lunes.getMonth() !== dom.getMonth() ? ' ' + mes(lunes) : '')
      + ' – ' + dom.getDate() + ' ' + mes(dom) + ' ' + dom.getFullYear();
  } else if (_statsRange === 'mes') {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    label = start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  } else {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(now.getFullYear() + offset + 1, 0, 1);
    label = String(start.getFullYear());
  }
  return { start, end, label };
}

// Total de minutos estudiados en un periodo [start, end).
function _statsTotalMin(start, end) {
  const porDia = _statsMinsPorDia(start, end);
  return Object.keys(porDia).reduce((a, k) => a + porDia[k], 0);
}

// Compara el periodo actual con los dos anteriores AL MISMO PUNTO temporal
// (estilo Forest): si hoy es 14-jun y este año llevo 80h, lo comparo con las
// horas que llevaba a 14-jun del año pasado, no con el total del año pasado.
// Para un periodo en curso (offset 0) el corte es "ahora"; para uno ya
// cerrado (offset < 0) el corte es el final del periodo (completo).
function _statsComparison() {
  const rel = {
    semana: ['Esta semana', 'Semana pasada', 'Hace 2 semanas'],
    mes:    ['Este mes', 'Mes pasado', 'Hace 2 meses'],
    'año':  ['Este año', 'Año pasado', 'Hace 2 años'],
  }[_statsRange];
  const cur = _statsPeriod(_statsOffset);
  const now = Date.now();
  const fullMs = cur.end - cur.start;
  // Punto temporal "hoy" dentro del periodo en curso (corte del marcador).
  const elapsedMs = _statsOffset < 0
    ? fullMs
    : Math.max(0, Math.min(now - cur.start, fullMs));
  const partial = elapsedMs < fullMs - 1000;
  const rows = [0, 1, 2].map(k => {
    const per = _statsPeriod(_statsOffset - k);
    // fullMin = tiempo ABSOLUTO del periodo (hasta su fin, o hasta ahora si
    // aún no ha terminado). Es la longitud de la barra.
    const fullEnd = new Date(Math.min(now, per.end.getTime()));
    const fullMin = _statsTotalMin(per.start, fullEnd);
    // pointMin = acumulado hasta el MISMO día (posición del punto marcador).
    const pointEnd = new Date(per.start.getTime() + elapsedMs);
    const pointMin = _statsTotalMin(per.start, pointEnd);
    return { label: rel[k], fullMin, pointMin };
  });
  return { rows, partial };
}

// Minutos estudiados por día (clave local YYYY-MM-DD) dentro de [start, end).
function _statsMinsPorDia(start, end) {
  const plantas = {};
  _statsAllPlants().forEach(p => {
    if (p.start < start || p.start >= end) return;
    const k = _statsISO(p.start);
    plantas[k] = (plantas[k] || 0) + p.mins;
  });
  const sesiones = {};
  (db.sesiones || []).forEach(s => {
    const d = new Date(s.date);
    if (isNaN(d.getTime()) || d < start || d >= end) return;
    const k = _statsISO(d);
    const min = (s.items || []).reduce((acc, it) => acc + _itemMinReal(it), 0);
    sesiones[k] = (sesiones[k] || 0) + min;
  });
  const out = {};
  Object.keys(plantas).concat(Object.keys(sesiones)).forEach(k => {
    out[k] = Math.max(plantas[k] || 0, sesiones[k] || 0);
  });
  return out;
}

function _statsMinsPorDiaSemana(porDia) {
  const arr = new Array(7).fill(0);
  Object.keys(porDia).forEach(k => {
    const d = new Date(k + 'T12:00:00');
    if (!isNaN(d.getTime())) arr[(d.getDay() + 6) % 7] += porDia[k];
  });
  return arr;
}

// Minutos por hora del día (0-23). Cada planta reparte su duración entre las
// horas que cruza, para que una sesión de 19:30 a 21:00 pese en 19, 20 y 21.
function _statsMinsPorHora(start, end) {
  const horas = new Array(24).fill(0);
  _statsAllPlants().forEach(p => {
    if (p.start < start || p.start >= end) return;
    let t = new Date(p.start);
    let restantes = p.mins;
    let guard = 0;
    while (restantes > 0 && guard < 64) {
      guard++;
      const finHora = new Date(t);
      finHora.setMinutes(60, 0, 0);
      const usa = Math.min(restantes, Math.max(1, Math.round((finHora - t) / 60000)));
      horas[t.getHours()] += usa;
      restantes -= usa;
      t = finHora;
    }
  });
  return horas;
}

// Reparto por obra dentro del periodo (solo tiempo con timestamp: cronómetro
// + Forest). Devuelve [{id, name, mins}] ordenado de mayor a menor.
function _statsMinsPorObra(start, end) {
  const map = {};
  _statsAllPlants().forEach(p => {
    if (p.start < start || p.start >= end) return;
    const key = p.obraId || ('tag:' + (p.tag || '?'));
    if (!map[key]) {
      const obra = (db.obras || []).find(o => o.id === p.obraId);
      map[key] = { id: p.obraId, name: obra ? obra.name : (p.tag || 'Sin obra'), mins: 0 };
    }
    map[key].mins += p.mins;
  });
  return Object.values(map).sort((a, b) => b.mins - a.mins);
}

// ── PREDICTOR DE SOLIDEZ ──────────────────────────────────────────────────────
// Estima cuántas HORAS de estudio (y cuántas semanas) faltan para que una obra
// llegue a una solidez objetivo (80% = "sólida"), a partir del comportamiento
// histórico del propio usuario. Idea: cruzar solHistory (cómo subió la solidez)
// con las horas reales invertidas (plantas) para medir "horas por punto de
// solidez", escalado por la carga de la pieza (dificultad × duración, el mismo
// proxy que ya usa el resto de la app).

// Todas las plantas agrupadas por obraId (una sola pasada).
function _plantsByObra() {
  const map = {};
  _statsAllPlants().forEach(p => {
    if (!p.obraId) return;
    (map[p.obraId] = map[p.obraId] || []).push(p);
  });
  return map;
}

// Horas de estudio en una obra dentro de [desde, hasta] (ms epoch).
function _obraHorasEnVentana(byObra, obraId, desde, hasta) {
  let min = 0;
  (byObra[obraId] || []).forEach(p => {
    const t = p.start.getTime();
    if (t >= desde && t <= hasta) min += p.mins;
  });
  return min / 60;
}

// Carga de una obra = dificultad × duración (duración ausente → 8 min).
function _obraCarga(dificultad, duracion) {
  return (dificultad || 3) * (duracion || 8);
}

function _mediana(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Ajusta el modelo personal: beta = horas necesarias por (punto de solidez ×
// carga). Devuelve { beta, n } con n = nº de obras que aportaron una muestra.
function _solidezModelFit() {
  const byObra = _plantsByObra();
  const samples = [];
  (db.obras || []).forEach(o => {
    const hist = (o.solHistory || [])
      .map(h => ({ d: new Date(h.date).getTime(), v: normalizeSolVal(h.val) }))
      .filter(h => !isNaN(h.d))
      .sort((a, b) => a.d - b.d);
    if (hist.length < 2) return;
    const firstV = hist[0].v, firstD = hist[0].d;
    let peakV = firstV, peakD = firstD;
    hist.forEach(h => { if (h.v > peakV) { peakV = h.v; peakD = h.d; } });
    const dSol = peakV - firstV;
    if (dSol < 10 || peakD <= firstD) return;            // necesita una subida real
    const horas = _obraHorasEnVentana(byObra, o.id, firstD, peakD);
    if (horas < 0.3) return;                              // <20 min: ruido
    const carga = _obraCarga(o.dificultad, o.duracion);
    if (carga <= 0) return;
    samples.push(horas / dSol / carga);
  });
  const beta = samples.length ? _mediana(samples) : 0.011; // 0.011 = arranque razonable
  return { beta, n: samples.length };
}

// Horas que suele recibir UNA obra por semana mientras está activa (mediana).
function _horasPorSemanaPorObra() {
  const byObra = _plantsByObra();
  const tasas = [];
  Object.keys(byObra).forEach(id => {
    let min = 0, t0 = Infinity, t1 = -Infinity;
    byObra[id].forEach(p => {
      min += p.mins;
      const t = p.start.getTime();
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
    });
    if (min < 30) return;
    const semanas = Math.max(1, (t1 - t0) / (7 * 86400000));
    tasas.push((min / 60) / semanas);
  });
  return _mediana(tasas);
}

// Predicción para una obra (nueva o existente).
function predictSolidez(dificultad, duracion, solInicial, objetivo) {
  objetivo = objetivo || 80;
  const puntos = Math.max(0, objetivo - (solInicial || 0));
  if (puntos <= 0) return { yaListo: true };
  const { fit, pace } = _solidezFitCached();
  const horas = fit.beta * _obraCarga(dificultad, duracion) * puntos;
  return {
    yaListo: false,
    horas,
    semanas: pace ? horas / pace : null,
    pace,
    n: fit.n,
    objetivo,
  };
}

// Caché del ajuste: recalcular es O(obras × plantas). La firma cambia cuando
// cambian las obras, el solHistory o las plantas, así que se reutiliza dentro
// de un mismo render (todas las tarjetas) y se refresca solo al variar datos.
let _solFitCache = null, _solFitSig = '';
function _solFitSignature() {
  let solN = 0;
  (db.obras || []).forEach(o => solN += (o.solHistory || []).length);
  const plN = (db.sessionPlants || []).length + (db.forestPlants || []).length;
  return (db.obras || []).length + ':' + solN + ':' + plN;
}
function _solidezFitCached() {
  const sig = _solFitSignature();
  if (_solFitCache && _solFitSig === sig) return _solFitCache;
  _solFitSig = sig;
  _solFitCache = { fit: _solidezModelFit(), pace: _horasPorSemanaPorObra() };
  return _solFitCache;
}

// Horas/semana para MANTENER una obra a su nivel: compensar el decaimiento.
// puntos_perdidos_semana × (horas por punto) = horas/semana. Usa el modelo de
// decaimiento personal (computeDecayRate) y el mismo β del predictor.
function _obraMantenimientoHsem(o, pctActual) {
  const { rate } = computeDecayRate(o);            // puntos/día
  const { fit } = _solidezFitCached();
  const carga = _obraCarga(o.dificultad, o.duracion);
  const estab = 0.5 + Math.min(100, pctActual || 0) / 100 * 0.5; // a más solidez, decae algo menos
  const puntosSemana = rate * 7 * estab;
  return Math.max(0, puntosSemana * fit.beta * carga);
}

// Total de horas para llevar TODAS las obras de un evento al 80%, desde su
// solidez actual estimada. diasRest opcional para el ritmo diario sugerido.
function _eventoHorasA80(ev, diasRest) {
  const obras = (ev.obras || []).map(id => findObra(id)).filter(Boolean);
  if (!obras.length) return null;
  let horas = 0, faltan = 0;
  obras.forEach(o => {
    const pct = estimateSolActual(o).val;
    const p = predictSolidez(o.dificultad, o.duracion, pct, 80);
    if (!p.yaListo && p.horas > 0) { horas += p.horas; faltan++; }
  });
  const out = { horas, faltan, total: obras.length };
  if (diasRest != null && diasRest > 0 && horas > 0) out.porDia = horas / diasRest;
  return out;
}

// Media real de horas estudiadas por día (últimos `dias` días de calendario,
// contando los días en blanco). Sirve para contextualizar un ritmo sugerido.
function _mediaHorasDiaReal(dias) {
  dias = dias || 28;
  const end = new Date();
  const start = new Date(end.getTime() - dias * 86400000);
  const porDia = _statsMinsPorDia(start, end);
  let tot = 0;
  Object.keys(porDia).forEach(k => tot += porDia[k]);
  return (tot / 60) / dias;
}

// Texto del ritmo sugerido de un evento + tu media real de h/día como ancla.
function _eventoRitmoSub(porDia) {
  const pdTxt = porDia >= 1 ? (Math.round(porDia * 10) / 10) + ' h/día' : Math.round(porDia * 60) + ' min/día';
  const media = _mediaHorasDiaReal(28);
  let ctx = '';
  if (media > 0.05) {
    const mTxt = media >= 1 ? (Math.round(media * 10) / 10) + ' h' : Math.round(media * 60) + ' min';
    ctx = ' · tu media ~' + mTxt + '/día';
  }
  return '~' + pdTxt + ' hasta el evento' + ctx;
}

// Línea breve para la tarjeta de obra: "→ 80%: ~12 h · 4 sem" si aún no es
// sólida, o "Mantener: ~1,5 h/sem" si ya pasa de 80%.
function _obraPredHint(o, pctActual) {
  const fH = h => h >= 10 ? Math.round(h) + ' h' : (Math.round(h * 2) / 2) + ' h';
  if (pctActual >= 80) {
    const hsem = _obraMantenimientoHsem(o, pctActual);
    if (!(hsem > 0)) return '';
    const v = hsem < 1 ? (Math.round(hsem * 10) / 10) : (Math.round(hsem * 2) / 2);
    return '<div class="obra-pred-hint hold" title="A tu ritmo, para que no baje del 80%">'
      + 'Mantener · <strong>~' + v + ' h/sem</strong></div>';
  }
  const p = predictSolidez(o.dificultad, o.duracion, pctActual, 80);
  if (p.yaListo || !(p.horas > 0)) return '';
  let sem = '';
  if (p.semanas != null) {
    const s = p.semanas;
    sem = ' · ' + (s < 1 ? '<1 sem' : s < 8 ? (Math.round(s * 2) / 2) + ' sem' : Math.round(s) + ' sem');
  }
  return '<div class="obra-pred-hint" title="A tu ritmo, estimado por tus obras pasadas">'
    + '→ 80%: <strong>' + fH(p.horas) + '</strong>' + sem + '</div>';
}

// Pinta la cajita viva de estimación en el modal "Añadir estudio".
function updateAddObraPrediccion() {
  const box = document.getElementById('addObraPrediccion');
  if (!box) return;
  const dif = parseInt((document.getElementById('newObraDificultad') || {}).value || '3', 10);
  const durRaw = (document.getElementById('newObraDuracion') || {}).value;
  const dur = durRaw ? parseInt(durRaw, 10) : 0;
  const sol = parseInt((document.getElementById('newObraSolidez') || {}).value || '10', 10);
  const p = predictSolidez(dif, dur, sol, 80);
  box.style.display = '';
  if (p.yaListo) {
    box.innerHTML = '<div class="add-obra-pred-main">Ya la marcas como sólida 👍</div>';
    return;
  }
  const fH = h => h >= 10 ? Math.round(h) + ' h' : (Math.round(h * 2) / 2) + ' h';
  const conf = p.n >= 5 ? 'alta' : p.n >= 3 ? 'media' : p.n >= 1 ? 'baja' : 'sin datos todavía';
  let semTxt = '';
  if (p.semanas != null) {
    const sem = p.semanas;
    const semR = sem < 1 ? 'menos de 1 semana'
      : sem < 8 ? (Math.round(sem * 2) / 2) + ' semanas'
      : Math.round(sem) + ' semanas';
    semTxt = '<div class="add-obra-pred-sem">≈ ' + semR + ' a tu ritmo · ~'
      + (Math.round((p.pace || 0) * 2) / 2) + ' h/sem en esta obra</div>';
  }
  const durNota = dur ? '' : '<div class="add-obra-pred-note">Pon la duración para afinar la estimación.</div>';
  box.innerHTML =
    '<div class="add-obra-pred-head">⌛ Para llegar al 80% (sólida)</div>' +
    '<div class="add-obra-pred-main"><strong>' + fH(p.horas) + '</strong> de estudio</div>' +
    semTxt +
    '<div class="add-obra-pred-conf">Según tus obras pasadas · confianza ' + conf + '</div>' +
    durNota;
}

const _STATS_FALLBACK_COLORS = ['#c8a030', '#6a9ac8', '#7ba87a', '#c87878', '#9b7ac8', '#5ea8a0', '#d59060', '#8a8a8a'];
function _statsObraColor(obraId, idx) {
  const obra = (db.obras || []).find(o => o.id === obraId);
  return (obra && obraColorHex(obra)) || _STATS_FALLBACK_COLORS[idx % _STATS_FALLBACK_COLORS.length];
}

// ── Construcción de gráficas SVG ──
function _statsNiceStep(maxVal) {
  const steps = [15, 30, 60, 120, 180, 240, 300, 360, 480, 600, 900, 1200, 1800, 2400, 3600];
  for (let i = 0; i < steps.length; i++) { if (maxVal / steps[i] <= 4) return steps[i]; }
  return 3600;
}
function _statsAxisLabel(min) {
  if (min === 0) return '0';
  return min >= 60 ? (Math.round(min / 60 * 10) / 10) + 'h' : min + 'm';
}

// Tooltip interno al SVG (coordenadas del viewBox → inmune al zoom del body).
function _statsTipMarkup() {
  return '<g class="stats-tip" style="display:none">'
    + '<rect class="stats-tip-bg" rx="5"></rect>'
    + '<text class="stats-tip-txt" text-anchor="middle"></text></g>';
}
function statsChartTip(el, cx, text) {
  const svg = el.ownerSVGElement || (el.closest && el.closest('svg'));
  if (!svg) return;
  const g = svg.querySelector('.stats-tip');
  if (!g) return;
  const txt = g.querySelector('.stats-tip-txt');
  const bg = g.querySelector('.stats-tip-bg');
  txt.textContent = text;
  // Margen amplio para que el número grande no se salga por los bordes del SVG.
  const cxC = Math.max(72, Math.min(cx, 568));
  txt.setAttribute('x', cxC);
  txt.setAttribute('y', 26);
  g.style.display = '';
  let b; try { b = txt.getBBox(); } catch (e) { b = { x: cxC - 30, y: 10, width: 60, height: 22 }; }
  bg.setAttribute('x', b.x - 10);
  bg.setAttribute('y', b.y - 6);
  bg.setAttribute('width', b.width + 20);
  bg.setAttribute('height', b.height + 12);
  clearTimeout(svg._tipT);
  svg._tipT = setTimeout(() => { g.style.display = 'none'; }, 2000);
}
function _statsTipText(label, minutes) {
  // Solo el número (el tiempo), grande y legible. La etiqueta del día/mes ya
  // se ve en el eje X, así que el tooltip muestra únicamente el valor.
  return minutes ? fmtMinutos(minutes) : '0 min';
}

let _statsGradSeq = 0;
// Rectángulo con SOLO las esquinas superiores redondeadas: las barras quedan
// "asentadas" sobre el eje en vez de flotar como píldoras.
function _barTopRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return 'M' + x.toFixed(1) + ',' + (y + h).toFixed(1)
    + ' L' + x.toFixed(1) + ',' + (y + r).toFixed(1)
    + ' Q' + x.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + y.toFixed(1)
    + ' L' + (x + w - r).toFixed(1) + ',' + y.toFixed(1)
    + ' Q' + (x + w).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + w).toFixed(1) + ',' + (y + r).toFixed(1)
    + ' L' + (x + w).toFixed(1) + ',' + (y + h).toFixed(1) + ' Z';
}
function _statsBarChartSVG(values, labels, hoyIdx, tipLabels) {
  const W = 640, H = 196, padL = 38, padR = 8, padT = 12, padB = 24;
  const n = values.length || 1;
  const maxVal = Math.max.apply(null, values.concat([1]));
  const step = _statsNiceStep(maxVal);
  const top = Math.max(step, Math.ceil(maxVal / step) * step);
  const iw = W - padL - padR, ih = H - padT - padB;
  const id = 'sb' + (++_statsGradSeq);
  let svg = '<svg class="stats-chart" viewBox="0 0 ' + W + ' ' + H + '">';
  // Gradientes: barra normal (oro vertical) y barra "hoy" (ámbar cálido) + halo.
  svg += '<defs>'
    + '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
    +   '<stop offset="0" style="stop-color:var(--accent2)"/>'
    +   '<stop offset="1" style="stop-color:var(--accent)" stop-opacity="0.68"/>'
    + '</linearGradient>'
    + '<linearGradient id="' + id + 'h" x1="0" y1="0" x2="0" y2="1">'
    +   '<stop offset="0" style="stop-color:var(--orange)"/>'
    +   '<stop offset="1" style="stop-color:var(--accent2)"/>'
    + '</linearGradient>'
    + '<filter id="' + id + 'g" x="-60%" y="-60%" width="220%" height="220%">'
    +   '<feDropShadow dx="0" dy="1.5" stdDeviation="3.2" flood-color="var(--orange)" flood-opacity="0.55"/>'
    + '</filter>'
    + '<filter id="' + id + 's" x="-40%" y="-30%" width="180%" height="170%">'
    +   '<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.26"/>'
    + '</filter>'
    + '</defs>';
  for (let v = 0; v <= top; v += step) {
    const y = padT + ih * (1 - v / top);
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" class="stats-grid"/>'
      + '<text x="' + (padL - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" class="stats-axis">' + _statsAxisLabel(v) + '</text>';
  }
  const slot = iw / n;
  const bw = Math.min(34, slot * 0.62);
  let hits = '';
  values.forEach((v, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const cx = padL + slot * i + slot / 2;
    const bh = ih * (v / top);
    if (v > 0) {
      const isHoy = i === hoyIdx;
      const h = Math.max(bh, 3);
      const yTop = padT + ih - h;
      const r = Math.min(6, bw / 2);
      svg += '<path d="' + _barTopRectPath(x, yTop, bw, h, r) + '" fill="url(#' + id + (isHoy ? 'h' : '') + ')"'
        + ' class="stats-bar' + (isHoy ? ' hoy' : '') + '" filter="url(#' + id + (isHoy ? 'g' : 's') + ')"/>';
      // Brillo superior: da relieve a la barra (efecto "satinado").
      svg += '<path d="' + _barTopRectPath(x, yTop, bw, Math.min(h, 5), r) + '" class="stats-bar-gloss"/>';
    }
    if (labels[i]) {
      svg += '<text x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle" class="stats-axis'
        + (i === hoyIdx ? ' hoy' : '') + '">' + labels[i] + '</text>';
    }
    const tip = _statsTipText((tipLabels && tipLabels[i]) || labels[i], v);
    hits += '<rect x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + ih
      + '" fill="rgba(0,0,0,0)" pointer-events="all" onclick="statsChartTip(this,' + cx.toFixed(1) + ',\'' + hechoJs(tip) + '\')"/>';
  });
  return svg + hits + _statsTipMarkup() + '</svg>';
}

function _statsLineChartSVG(values, labels, tipLabels) {
  const W = 640, H = 176, padL = 38, padR = 14, padT = 16, padB = 24;
  const n = values.length;
  const maxVal = Math.max.apply(null, values.concat([1]));
  const step = _statsNiceStep(maxVal);
  const top = Math.max(step, Math.ceil(maxVal / step) * step);
  const iw = W - padL - padR, ih = H - padT - padB;
  const px = i => padL + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const py = v => padT + ih * (1 - v / top);
  const id = 'sl' + (++_statsGradSeq);
  let svg = '<svg class="stats-chart" viewBox="0 0 ' + W + ' ' + H + '">';
  // Área con degradado vertical, línea con degradado oro→verde y sombra.
  svg += '<defs>'
    + '<linearGradient id="' + id + 'a" x1="0" y1="0" x2="0" y2="1">'
    +   '<stop offset="0" style="stop-color:var(--accent2)" stop-opacity="0.36"/>'
    +   '<stop offset="1" style="stop-color:var(--accent)" stop-opacity="0.02"/>'
    + '</linearGradient>'
    + '<linearGradient id="' + id + 'l" x1="0" y1="0" x2="1" y2="0">'
    +   '<stop offset="0" style="stop-color:var(--accent)"/>'
    +   '<stop offset="0.55" style="stop-color:var(--accent2)"/>'
    +   '<stop offset="1" style="stop-color:var(--green)"/>'
    + '</linearGradient>'
    + '<filter id="' + id + 'g" x="-30%" y="-60%" width="160%" height="240%">'
    +   '<feDropShadow dx="0" dy="1.5" stdDeviation="2.4" flood-color="var(--accent)" flood-opacity="0.45"/>'
    + '</filter>'
    + '</defs>';
  for (let v = 0; v <= top; v += step) {
    const y = py(v);
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" class="stats-grid"/>'
      + '<text x="' + (padL - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" class="stats-axis">' + _statsAxisLabel(v) + '</text>';
  }
  const pts = values.map((v, i) => px(i) + ',' + py(v)).join(' ');
  svg += '<polygon points="' + padL + ',' + (padT + ih) + ' ' + pts + ' ' + (padL + iw) + ',' + (padT + ih) + '" fill="url(#' + id + 'a)" class="stats-area"/>'
    + '<polyline points="' + pts + '" fill="none" stroke="url(#' + id + 'l)" class="stats-line" filter="url(#' + id + 'g)"/>';
  let peak = 0;
  values.forEach((v, i) => { if (v > values[peak]) peak = i; });
  if (values[peak] > 0) {
    svg += '<line x1="' + px(peak) + '" y1="' + py(values[peak]) + '" x2="' + px(peak) + '" y2="' + (padT + ih) + '" class="stats-peak-line"/>'
      + '<circle cx="' + px(peak) + '" cy="' + py(values[peak]) + '" r="5.5" class="stats-peak-halo"/>'
      + '<circle cx="' + px(peak) + '" cy="' + py(values[peak]) + '" r="4" class="stats-peak-dot"/>';
  }
  labels.forEach((lab, i) => {
    if (lab) svg += '<text x="' + px(i) + '" y="' + (H - 7) + '" text-anchor="middle" class="stats-axis">' + lab + '</text>';
  });
  // Zonas tocables por punto (muestran el valor)
  const slotW = n > 1 ? iw / (n - 1) : iw;
  let hits = '';
  values.forEach((v, i) => {
    const cx = px(i);
    const tip = _statsTipText((tipLabels && tipLabels[i]) || labels[i], v);
    hits += '<rect x="' + (cx - slotW / 2).toFixed(1) + '" y="' + padT + '" width="' + slotW.toFixed(1) + '" height="' + ih
      + '" fill="rgba(0,0,0,0)" pointer-events="all" onclick="statsChartTip(this,' + cx.toFixed(1) + ',\'' + hechoJs(tip) + '\')"/>';
  });
  return svg + hits + _statsTipMarkup() + '</svg>';
}

function _statsDonutSVG(segs, totalMin) {
  const R = 54, C = 2 * Math.PI * R;
  // Hueco fino entre segmentos (solo si hay más de uno) para separarlos.
  const GAP = segs.length > 1 ? 2.5 : 0;
  let off = 0;
  let svg = '<svg class="stats-donut" viewBox="0 0 140 140">'
    + '<circle cx="70" cy="70" r="' + R + '" class="stats-donut-track"/>';
  segs.forEach(s => {
    const full = C * (s.mins / totalMin);
    const len = Math.max(0.5, full - GAP);
    svg += '<circle cx="70" cy="70" r="' + R + '" stroke="' + s.color + '" stroke-dasharray="' + len + ' ' + (C - len)
      + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)" class="stats-donut-seg"/>';
    off += full;
  });
  const centro = totalMin >= 60 ? Math.round(totalMin / 60) + ' h' : totalMin + ' m';
  svg += '<text x="70" y="67" text-anchor="middle" class="stats-donut-big">' + centro + '</text>'
    + '<text x="70" y="86" text-anchor="middle" class="stats-donut-sub">total</text>';
  return svg + '</svg>';
}

// Barras del periodo: por día (semana/mes) o por mes (año).
function _statsBarsData(porDia, start, end) {
  const labels = [], values = [], tipLabels = [];
  let hoyIdx = -1;
  const hoyKey = _statsISO(new Date());
  if (_statsRange === 'año') {
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const mesesL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const porMes = new Array(12).fill(0);
    Object.keys(porDia).forEach(k => { porMes[parseInt(k.slice(5, 7), 10) - 1] += porDia[k]; });
    const now = new Date();
    for (let m = 0; m < 12; m++) {
      labels.push(meses[m]);
      tipLabels.push(mesesL[m]);
      values.push(porMes[m]);
      if (_statsOffset === 0 && m === now.getMonth()) hoyIdx = m;
    }
  } else {
    const dias = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    const d = new Date(start);
    let i = 0;
    while (d < end) {
      const k = _statsISO(d);
      values.push(porDia[k] || 0);
      labels.push(_statsRange === 'semana'
        ? dias[i]
        : (d.getDate() === 1 || d.getDate() % 5 === 0 ? String(d.getDate()) : ''));
      tipLabels.push(d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }));
      if (k === hoyKey) hoyIdx = i;
      d.setDate(d.getDate() + 1);
      i++;
    }
  }
  return { labels, values, hoyIdx, tipLabels };
}

function setStatsRange(r) {
  _statsRange = r;
  _statsOffset = 0;
  localStorage.setItem('stats_range', r);
  renderStatsDashboard();
}
function statsNav(dir) {
  _statsOffset = Math.min(0, _statsOffset + dir);
  renderStatsDashboard();
}
function statsResetOffset() {
  if (_statsOffset === 0) return;
  _statsOffset = 0;
  renderStatsDashboard();
}

const _STATS_DIAS_LARGO = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function _statsComparisonCard() {
  const { rows, partial } = _statsComparison();
  const maxFull = Math.max(1, rows[0].fullMin, rows[1].fullMin, rows[2].fullMin);
  // La comparación se lee EN EL PUNTO (mismo día): pointMin actual vs anterior.
  const cur = rows[0].pointMin, prev = rows[1].pointMin;
  const mismoPunto = partial ? ' a estas alturas' : '';
  let trend;
  if (prev === 0 && cur === 0) trend = 'Aún sin datos para comparar.';
  else if (prev === 0) trend = 'Primer periodo con registro · ' + fmtMinutos(cur);
  else {
    const diff = cur - prev;
    const pct = Math.round(Math.abs(diff) / prev * 100);
    if (diff === 0) trend = 'Igual que ' + rows[1].label.toLowerCase() + mismoPunto + '.';
    else trend = '<strong>' + fmtMinutos(Math.abs(diff)) + (diff > 0 ? ' más' : ' menos')
      + '</strong> que ' + rows[1].label.toLowerCase() + mismoPunto + ' · ' + (diff > 0 ? '+' : '−') + pct + '%';
  }
  const barRows = rows.map((r, i) => {
    // Barra = tiempo absoluto (fullMin). Punto = posición del mismo día,
    // en la MISMA escala (pointMin/maxFull), así el punto siempre cae dentro
    // de la barra y se puede comparar su posición entre barras.
    const fillW = Math.round(r.fullMin / maxFull * 100);
    const dotLeft = Math.round(r.pointMin / maxFull * 100);
    const showDot = partial && r.pointMin > 0;
    const dot = showDot
      ? '<span class="stats-cmp-dot" style="left:' + dotLeft + '%" title="al mismo día"></span>'
      : '';
    const tipTxt = r.label + ': ' + (r.fullMin ? fmtMinutos(r.fullMin) : '0 min')
      + (partial ? ' · a hoy ' + fmtMinutos(r.pointMin) : '');
    return '<div class="stats-cmp-row" onclick="showToast(\'' + hechoJs(tipTxt) + '\')">'
      + '<span class="stats-cmp-label">' + r.label + '</span>'
      + '<div class="stats-cmp-track">'
      +   '<div class="stats-cmp-fill' + (i === 0 ? ' current' : '') + '" style="width:' + fillW + '%"></div>'
      +   dot
      + '</div>'
      + '<span class="stats-cmp-val">' + (r.fullMin ? fmtMinutos(r.fullMin) : '—') + '</span>'
      + '</div>';
  }).join('');
  const sub = partial ? 'El punto marca hoy · ' + trend : trend;
  return '<div class="stats-card">'
    + '<div class="stats-card-title">Tendencia</div>'
    + '<div class="stats-card-sub">' + sub + '</div>'
    + '<div class="stats-cmp">' + barRows + '</div>'
    + _statsMetaSuperar(rows, partial)
    + '</div>';
}

// Meta para superar el periodo anterior. Solo en el periodo EN CURSO (partial):
// si ya vas por encima del total del periodo anterior (cerrado), muestra el
// margen; si aún no, calcula cuánto necesitas estudiar AL DÍA de media en los
// días que quedan para superarlo.
function _statsMetaSuperar(rows, partial) {
  if (!partial) return '';
  const prevTotal = rows[1].fullMin;   // total del periodo anterior (ya cerrado)
  if (prevTotal <= 0) return '';
  const hechoAhora = rows[0].fullMin;  // acumulado este periodo hasta ahora
  const unidad = {
    semana: 'la semana pasada',
    mes: 'el mes pasado',
    'año': 'el año pasado',
  }[_statsRange] || rows[1].label.toLowerCase();
  if (hechoAhora >= prevTotal) {
    const margen = hechoAhora - prevTotal;
    return '<div class="stats-meta-super ahead">'
      + '<span class="stats-meta-ico">✓</span>'
      + '<span>Ya superas ' + unidad + ' · <strong>+' + fmtMinutos(margen) + '</strong> de margen</span>'
      + '</div>';
  }
  const cur = _statsPeriod(_statsOffset);
  const msRest = cur.end.getTime() - Date.now();
  const diasRest = Math.max(1, Math.ceil(msRest / 86400000));
  const falta = prevTotal - hechoAhora;
  const porDia = Math.ceil(falta / diasRest);
  return '<div class="stats-meta-super">'
    + '<span class="stats-meta-ico">▲</span>'
    + '<span>Para superar ' + unidad + ': <strong>' + fmtMinutos(porDia) + '/día</strong>'
    + ' <span class="stats-meta-sub">· faltan ' + fmtMinutos(falta) + ' en ' + diasRest
    + ' día' + (diasRest === 1 ? '' : 's') + '</span></span>'
    + '</div>';
}

// Esqueleto del dashboard de estadísticas: se pinta al instante mientras se
// calcula sobre todo el historial (que puede ser grande con datos de Forest).
function _statsSkeleton() {
  const heights = [70, 90, 55, 80, 45, 95, 60];
  const bars = heights.map(h => '<div class="skeleton" style="height:' + h + '%"></div>').join('');
  return ''
    + '<div class="skeleton" style="height:38px;border-radius:999px;margin-bottom:12px"></div>'
    + '<div class="skeleton" style="height:24px;width:160px;border-radius:8px;margin:0 auto 14px"></div>'
    + '<div class="skel-card">'
    +   '<div class="skeleton skel-line" style="width:42%"></div>'
    +   '<div class="skeleton skel-line" style="width:28%;height:22px"></div>'
    +   '<div class="skel-bars">' + bars + '</div>'
    + '</div>'
    + '<div class="skel-card">'
    +   '<div class="skeleton skel-line" style="width:34%"></div>'
    +   '<div class="skeleton skel-line" style="width:60%"></div>'
    +   '<div class="skeleton skel-line" style="width:50%"></div>'
    + '</div>';
}

// Días con estudio (unión de cronómetro, Forest y sesiones con minutos).
function _statsStudyDays() {
  const set = new Set();
  _statsAllPlants().forEach(p => set.add(_statsISO(p.start)));
  (db.sesiones || []).forEach(s => {
    const d = new Date(s.date);
    if (isNaN(d.getTime())) return;
    const min = (s.items || []).reduce((a, it) => a + _itemMinReal(it), 0);
    if (min > 0) set.add(_statsISO(d));
  });
  return set;
}

// Racha de días consecutivos con estudio (el día en curso no rompe la racha).
function _statsStreak() {
  const days = _statsStudyDays();
  const d = new Date(); d.setHours(12, 0, 0, 0);
  if (!days.has(_statsISO(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(_statsISO(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

const ICON_FLAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1 .4-2 1-2.6C8.8 9.8 9 11 10 11.5 9.2 8 11 5 12 3Z"/></svg>';

function _statsStreakHeader() {
  const n = _statsStreak();
  const big = n >= 1 ? n + (n === 1 ? ' día' : ' días') : 'Sin racha';
  const sub = n >= 1 ? 'estudiando seguido' : 'estudia hoy para empezar';
  return '<div class="stats-streak' + (n >= 1 ? ' on' : '') + '">'
    + '<span class="stats-streak-icon">' + ICON_FLAME + '</span>'
    + '<span class="stats-streak-big">' + big + '</span>'
    + '<span class="stats-streak-sub">' + sub + '</span>'
    + '</div>';
}

// Mapa del año marcando los días de estudio intenso (4 h+ / 5 h+), estilo
// "heatmap" de constancia. Un cuadradito por día; color según minutos netos.
function _statsYearIntenseHeatmap(dayMap, year) {
  const jan1 = new Date(year, 0, 1), dec31 = new Date(year, 11, 31);
  const start = new Date(jan1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // lunes de la 1ª semana
  const cell = 11, gap = 3, step = cell + gap;
  const padL = 6, padT = 16, padB = 4;
  const weeks = Math.ceil(((dec31 - start) / 86400000 + 1) / 7);
  const W = padL + weeks * step + 2;
  const H = padT + 7 * step + padB;
  const monNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  let rects = '', months = '', lastMonth = -1;
  const d = new Date(start);
  for (let w = 0; w < weeks; w++) {
    for (let row = 0; row < 7; row++) {
      if (d.getFullYear() === year) {
        const iso = _statsISO(d);
        const mins = dayMap[iso] ? dayMap[iso].mins : 0;
        let cls = 'h0';
        if (mins >= 300) cls = 'h5';
        else if (mins >= 240) cls = 'h4';
        else if (mins > 0) cls = 'h1';
        const x = padL + w * step, y = padT + row * step;
        rects += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="2.5" class="stats-heat ' + cls + '">'
          + '<title>' + d.getDate() + ' ' + monNames[d.getMonth()].toLowerCase() + (mins ? ' · ' + fmtMinutos(mins) : ' · sin estudio') + '</title></rect>';
        if (d.getDate() <= 7 && d.getMonth() !== lastMonth) {
          lastMonth = d.getMonth();
          months += '<text x="' + x + '" y="' + (padT - 5) + '" class="stats-heat-mon">' + monNames[d.getMonth()] + '</text>';
        }
      }
      d.setDate(d.getDate() + 1);
    }
  }
  const legend = '<div class="stats-heat-legend">'
    + '<span>' + year + '</span>'
    + '<span class="stats-heat-key"><i class="stats-heat-sq h1"></i> algo</span>'
    + '<span class="stats-heat-key"><i class="stats-heat-sq h4"></i> 4 h+</span>'
    + '<span class="stats-heat-key"><i class="stats-heat-sq h5"></i> 5 h+</span>'
    + '</div>';
  return '<div class="stats-heatmap-wrap"><svg class="stats-heatmap" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
    + months + rects + '</svg></div>' + legend;
}

// Tarjeta "Estudio intenso": hora media a la que arrancas los días de 4 h+
// (y 5 h+), con el mapa del año marcando esos días.
function _statsIntenseCard() {
  const dayMapAll = _statsDayMap(); // para el mapa del año entero
  const anyIntenseEver = Object.keys(dayMapAll).some(k => dayMapAll[k].mins >= 240);
  if (!anyIntenseEver) return '';
  // La hora de arranque refleja el HÁBITO actual: ventana deslizante de 3 meses.
  const win = _recentPlants();
  const dayMap3m = _statsDayMap(win.plants);
  const i4 = _statsIntenseStart(dayMap3m, 240);
  const i5 = _statsIntenseStart(dayMap3m, 300);
  const year = (_statsRange === 'año') ? _statsPeriod().start.getFullYear() : new Date().getFullYear();

  let big, sub, cincoLine = '';
  if (i4) {
    const subParts = [i4.count + ' días de 4 h+'];
    if (i5 && i5.count) subParts.push(i5.count + ' de 5 h+');
    big = _fmtHourMin(i4.avgMin);
    sub = 'Hora media a la que arrancas tus días de 4 h+ (' + win.scope + ') · ' + subParts.join(' · ') + '. Empezar mucho más tarde lo hace improbable.';
    if (i5 && i5.count >= 3) cincoLine = '<div class="stats-intense-row"><span class="stats-intense-dot h5"></span>Los de 5 h+ arrancan a las <strong>' + _fmtHourMin(i5.avgMin) + '</strong></div>';
  } else {
    big = '—';
    sub = 'Aún sin días de 4 h+ recientes (' + win.scope + '). El mapa marca los de todo el año.';
  }
  return '<div class="stats-card">'
    + '<div class="stats-card-title">Estudio intenso · 4 h+</div>'
    + '<div class="stats-card-big">' + big + '</div>'
    + '<div class="stats-card-sub">' + sub + '</div>'
    + cincoLine
    + _statsYearIntenseHeatmap(dayMapAll, year)
    + '</div>';
}

function renderStatsDashboard() {
  const el = document.getElementById('statsDashboard');
  if (!el) return;
  const periodo = _statsPeriod();
  const porDia = _statsMinsPorDia(periodo.start, periodo.end);
  const total = Object.keys(porDia).reduce((a, k) => a + porDia[k], 0);

  const seg = '<div class="stats-seg">'
    + [['semana', 'Semana'], ['mes', 'Mes'], ['año', 'Año']].map(r =>
        '<button class="stats-seg-btn' + (r[0] === _statsRange ? ' active' : '') + '" onclick="setStatsRange(\'' + r[0] + '\')">' + r[1] + '</button>'
      ).join('')
    + '</div>';

  const navRow = '<div class="stats-period-row">'
    + '<button class="stats-period-btn" onclick="statsNav(-1)" aria-label="Periodo anterior">‹</button>'
    + '<div class="stats-period-label" onclick="statsResetOffset()" title="Volver al periodo actual">' + periodo.label
    + (_statsOffset !== 0 ? ' <span class="stats-period-reset">⟲</span>' : '') + '</div>'
    + '<button class="stats-period-btn" onclick="statsNav(1)"' + (_statsOffset === 0 ? ' disabled' : '') + ' aria-label="Periodo siguiente">›</button>'
    + '</div>';

  // Tarjeta 1: tiempo de concentración (barras)
  const bars = _statsBarsData(porDia, periodo.start, periodo.end);
  let cards = '<div class="stats-card">'
    + '<div class="stats-card-title">Tiempo de concentración</div>'
    + '<div class="stats-card-big">' + fmtMinutos(total) + '</div>'
    + (total > 0
        ? _statsBarChartSVG(bars.values, bars.labels, bars.hoyIdx, bars.tipLabels)
        : '<div class="stats-empty">Sin estudio en este periodo.</div>')
    + '</div>';

  // Tarjeta comparativa: este periodo vs los dos anteriores (estilo Forest)
  cards += _statsComparisonCard();

  // Tarjeta "Estudio intenso" (4 h+): hora de arranque + mapa del año.
  cards += _statsIntenseCard();

  if (total > 0) {
    // Tarjeta 2: día de la semana (solo mes/año; en semana ya se ve en las barras)
    if (_statsRange !== 'semana') {
      const porSem = _statsMinsPorDiaSemana(porDia);
      let mejor = 0;
      porSem.forEach((v, i) => { if (v > porSem[mejor]) mejor = i; });
      cards += '<div class="stats-card">'
        + '<div class="stats-card-title">Día de la semana</div>'
        + '<div class="stats-card-sub">Más concentración los <strong>' + _STATS_DIAS_LARGO[mejor] + '</strong></div>'
        + _statsLineChartSVG(porSem, ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'], _STATS_DIAS_LARGO)
        + '</div>';
    }

    // Tarjeta 3: momento del día (curva horaria, solo tiempo con timestamp)
    const porHora = _statsMinsPorHora(periodo.start, periodo.end);
    if (porHora.some(v => v > 0)) {
      let pico = 0;
      porHora.forEach((v, i) => { if (v > porHora[pico]) pico = i; });
      const horaLabels = porHora.map((_, h) =>
        (h === 0 || h === 6 || h === 12 || h === 18 || h === 23) ? String(h).padStart(2, '0') + ':00' : '');
      const horaTips = porHora.map((_, h) => String(h).padStart(2, '0') + ':00');
      cards += '<div class="stats-card">'
        + '<div class="stats-card-title">Momento del día</div>'
        + '<div class="stats-card-sub">Pico a las <strong>' + String(pico).padStart(2, '0') + ':00</strong></div>'
        + _statsLineChartSVG(porHora, horaLabels, horaTips)
        + '</div>';
    }

    // Tarjeta 4: reparto por obra (donut + leyenda)
    const porObra = _statsMinsPorObra(periodo.start, periodo.end);
    if (porObra.length) {
      const totalObra = porObra.reduce((a, o) => a + o.mins, 0);
      const top = porObra.slice(0, 6);
      const resto = porObra.slice(6);
      if (resto.length) {
        top.push({ id: null, name: 'Otras (' + resto.length + ')', mins: resto.reduce((a, o) => a + o.mins, 0), _resto: true });
      }
      const segs = top.map((o, i) => ({
        mins: o.mins,
        color: o._resto ? 'var(--text3)' : _statsObraColor(o.id, i),
      }));
      const leyenda = top.map((o, i) =>
        '<div class="stats-legend-row">'
        + '<span class="stats-legend-dot" style="background:' + segs[i].color + '"></span>'
        + '<span class="stats-legend-name">' + escapeHtmlSafe(o.name) + '</span>'
        + '<span class="stats-legend-val">' + fmtMinutos(o.mins) + ' · ' + Math.round(o.mins / totalObra * 100) + '%</span>'
        + '</div>').join('');
      cards += '<div class="stats-card">'
        + '<div class="stats-card-title">Por obra</div>'
        + '<div class="stats-card-sub">Tiempo cronometrado del periodo</div>'
        + '<div class="stats-donut-wrap">' + _statsDonutSVG(segs, totalObra)
        + '<div class="stats-legend">' + leyenda + '</div></div>'
        + '</div>';
    }
  }

  el.innerHTML = _statsStreakHeader() + seg + navRow + cards;
}

// Lista de sesiones plegable: las estadísticas son lo principal de la vista,
// pero la lista sigue disponible para revisar/editar días concretos.
function toggleHistList(force) {
  const list = document.getElementById('sesionesHistorial');
  const btn = document.getElementById('histListToggle');
  if (!list) return;
  const abrir = typeof force === 'boolean' ? force : list.style.display === 'none';
  list.style.display = abrir ? '' : 'none';
  if (btn) btn.textContent = abrir ? 'Ocultar' : 'Mostrar';
  localStorage.setItem('hist_list_open', abrir ? '1' : '0');
}
function _histListApplyPref() {
  toggleHistList(localStorage.getItem('hist_list_open') === '1');
}

function renderSesionesHistorial() {
  const el = document.getElementById('sesionesHistorial');
  if (!db.sesiones || !db.sesiones.length) {
    el.innerHTML = emptyStateHTML(ICON_SEARCH_EMPTY, 'Aún no hay sesiones', 'Cuando estudies con el cronómetro, aparecerán aquí.');
    return;
  }
  const tickIcons = { hecho: '✓', parcial: '≈', saltado: '✗' };
  el.innerHTML = db.sesiones.slice(0, 30).map(s => {
    const d = new Date(s.date);
    const label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });

    // Header meta line (energía, manual, items count, total min)
    const itemsArr = s.items || [];
    const totalMin = itemsArr.reduce((acc, it) => acc + _itemMinReal(it), 0);
    const numHechos = itemsArr.filter(it => it.tick === 'hecho').length;
    const metaParts = [];
    if (itemsArr.length) metaParts.push(itemsArr.length + (itemsArr.length === 1 ? ' obra' : ' obras'));
    if (numHechos > 0 && numHechos !== itemsArr.length) metaParts.push(numHechos + ' hechas');
    if (totalMin > 0) metaParts.push(totalMin + ' min');
    if (s.energia && s.energia !== 'manual') metaParts.push('energía: ' + s.energia);
    if (s.energia === 'manual') metaParts.push('manual');
    const metaLine = metaParts.join(' · ');

    // Big rating block (right side of header)
    let ratingBlock = '';
    if (s.rating != null) {
      const col = solPctColor(s.rating);
      ratingBlock =
        '<div>' +
          '<div class="sesion-hist-rating" style="background:' + col + '18;color:' + col + ';border:1px solid ' + col + '44">' + s.rating + '%</div>' +
          '<div class="sesion-hist-rating-label" style="color:' + col + '">' + ratingLabel(s.rating).toLowerCase() + '</div>' +
        '</div>';
    }

    // Items
    const itemsHtml = itemsArr.map(it => {
      const tick = it.tick;
      const tickClass = tick || 'none';
      const icon = tick ? tickIcons[tick] : '·';
      const badges = [];
      if (it.manual) badges.push('<span class="sesion-hist-obra-badge">manual</span>');
      const minRealItem = _itemMinReal(it);
      if (!it.manual && minRealItem > 0) {
        badges.push('<span class="sesion-hist-obra-badge">' + minRealItem + ' min</span>');
      }
      if (it.solRating != null) {
        const c = solPctColor(it.solRating);
        badges.push('<span class="sesion-hist-obra-badge" style="color:' + c + ';border-color:' + c + '55">solidez ' + it.solRating + '%</span>');
      }
      const zoneLabel = it.zona || zoneSummaryText(it.zone);
      if (zoneLabel) {
        badges.push('<span class="sesion-hist-obra-badge">zona ' + escapeHtmlSafe(zoneLabel) + '</span>');
      }
      if (it.rating != null) {
        const c = solPctColor(it.rating);
        badges.push('<span class="sesion-hist-obra-badge" style="color:' + c + ';border-color:' + c + '55">sesión ' + it.rating + '%</span>');
      }

      return '<div class="sesion-hist-obra">' +
        '<div class="sesion-hist-obra-tick ' + tickClass + '">' + icon + '</div>' +
        '<div class="sesion-hist-obra-name">' + escapeHtmlSafe(it.obraName || '—') + '</div>' +
        '<div class="sesion-hist-obra-badges">' + badges.join('') + '</div>' +
        (it.note ? '<div class="sesion-hist-obra-note">' + escapeHtmlSafe(it.note) + '</div>' : '') +
      '</div>';
    }).join('');

    return '<div class="sesion-hist-item">' +
      '<div class="sesion-hist-header">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="sesion-hist-date">' + label + '</div>' +
          (metaLine ? '<div class="sesion-hist-meta">' + metaLine + '</div>' : '') +
        '</div>' +
        ratingBlock +
        '<div class="sesion-hist-actions">' +
          '<button class="sesion-hist-action" onclick="openEditarSesion(\'' + s.date + '\')" title="Editar sesión">✏️</button>' +
          '<button class="sesion-hist-action danger" onclick="deleteSession(\'' + s.date + '\')" title="Eliminar sesión">✕</button>' +
        '</div>' +
      '</div>' +
      (itemsHtml || '<div style="color:var(--text3);font-size:11px;font-style:italic">Sin items registrados.</div>') +
    '</div>';
  }).join('');
}

// Modal de sesiones individuales con su rango horario (HH:MM–HH:MM), agrupadas
// por día (todos los días, más recientes arriba, con scroll). Lee las plantas
// del cronómetro + Forest (cada planta es un tramo real de estudio). Excluye
// descansos y tramos fallidos.
function openSesionesDetalle() {
  const cont = document.getElementById('sesionesDetalleBody');
  if (!cont) return;
  const plants = [];
  const add = p => {
    if (!p || p.failed || !p.startedAt) return;
    if (p.tipo === 'descanso' || p.obraId === '_rest_') return;
    const start = new Date(p.startedAt);
    if (isNaN(start.getTime())) return;
    const mins = Math.max(0, Math.round(p.mins || 0));
    if (!mins) return;
    const end = p.endedAt ? new Date(p.endedAt) : new Date(start.getTime() + mins * 60000);
    plants.push({ start, end, mins, obraId: p.obraId || null, tag: p.tag || null });
  };
  (db.sessionPlants || []).forEach(add);
  (db.forestPlants || []).forEach(add);
  plants.sort((a, b) => b.start - a.start); // más recientes primero

  if (!plants.length) {
    cont.innerHTML = '<div class="sesdet-empty">Aún no hay sesiones con hora registrada.<br>Estudia con el cronómetro y aparecerán aquí.</div>';
    openModal('modalSesionesDetalle');
    return;
  }

  const fmtH = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const groups = [];
  let curKey = null, cur = null;
  plants.forEach(p => {
    const key = _statsISO(p.start);
    if (key !== curKey) { curKey = key; cur = { date: p.start, items: [], total: 0 }; groups.push(cur); }
    cur.items.push(p);
    cur.total += p.mins;
  });

  const hoyKey = _statsISO(new Date());
  cont.innerHTML = groups.map(g => {
    let label = g.date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    if (_statsISO(g.date) === hoyKey) label = 'Hoy · ' + label;
    const rows = g.items.map(p => {
      const obra = p.obraId ? findObra(p.obraId) : null;
      const color = (obra && obraColorHex(obra)) || 'var(--text3)';
      const name = obra ? obra.name : (p.tag || 'Estudio');
      return '<div class="sesdet-row">' +
        '<span class="sesdet-dot" style="background:' + color + '"></span>' +
        '<span class="sesdet-time">' + fmtH(p.start) + '–' + fmtH(p.end) + '</span>' +
        '<span class="sesdet-name">' + escapeHtmlSafe(name) + '</span>' +
        '<span class="sesdet-min">' + p.mins + ' min</span>' +
      '</div>';
    }).join('');
    return '<div class="sesdet-day">' +
      '<div class="sesdet-day-head">' +
        '<span class="sesdet-day-label">' + label + '</span>' +
        '<span class="sesdet-day-total">' + fmtMinutos(g.total) + '</span>' +
      '</div>' +
      rows +
    '</div>';
  }).join('');
  openModal('modalSesionesDetalle');
}

// Lightweight HTML escape used in renderSesionesHistorial — avoid corrupting names with quotes/HTML
function escapeHtmlSafe(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, ch => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]
  ));
}

function deleteSession(dateStr) {
  const s = db.sesiones.find(x => x.date === dateStr);
  if (!s) return;
  const d = new Date(s.date);
  const label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  const numItems = (s.items || []).length;
  const msg = '¿Eliminar la sesión de ' + label + '?\n' +
              (numItems > 0 ? '(' + numItems + (numItems === 1 ? ' obra registrada)' : ' obras registradas)') : '') +
              '\n\nEsta acción no se puede deshacer.';
  if (!confirm(msg)) return;
  db.sesiones = db.sesiones.filter(x => x.date !== dateStr);
  saveData();
  renderSesionesHistorial();
  renderRacha();
  showToast('Sesión eliminada');
}

// ─── PASAJES GLOBAL VIEW ────────────────────────────────────────────────────

let pasajesSort = 'obra';

function setPasajesSort(sort, btn) {
  pasajesSort = sort;
  document.querySelectorAll('#pasajesSortBtns .sort-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPasajesGlobal();
}

function renderPasajesGlobal() {
  const el = document.getElementById('pasajesGlobalList');
  if (!el) return;

  // Collect all pasajes with obra context
  const all = [];
  (db.obras || []).forEach(obra => {
    (obra.pasajes || []).forEach(p => {
      // Last worked: find most recent session entry for this obra
      let lastWorked = null;
      for (const s of (db.sesiones || [])) {
        if ((s.items||[]).some(i => i.obraId === obra.id && i.tick !== 'saltado')) {
          const d = new Date(s.date);
          if (!lastWorked || d > lastWorked) lastWorked = d;
        }
      }
      // Score: use latest tracking session score if available
      const scores = (p.sesiones || []);
      const lastScore = scores.length ? scores[0].score : null;
      const avgScore  = scores.length
        ? Math.round(scores.slice(0, 5).reduce((s, x) => s + x.score, 0) / Math.min(scores.length, 5))
        : null;

      all.push({ obra, p, lastWorked, lastScore, avgScore });
    });
  });

  if (!all.length) {
    el.innerHTML = `<div class="pasajes-empty">No hay pasajes añadidos aún.<br>Añádelos desde la pestaña Obras.</div>`;
    return;
  }

  const STATUS_ORDER = { activo: 0, mantenimiento: 1, resuelto: 2 };
  const STATUS_LABEL = { activo: 'Activo', mantenimiento: 'Mantenimiento', resuelto: 'Resuelto' };
  const STATUS_COLOR = { activo: 'var(--orange)', mantenimiento: 'var(--accent)', resuelto: 'var(--green)' };
  const STATUS_BAR   = { activo: 25, mantenimiento: 60, resuelto: 95 };

  let html = '';

  if (pasajesSort === 'obra') {
    // Group by obra
    const byObra = {};
    all.forEach(item => {
      const key = item.obra.id;
      if (!byObra[key]) byObra[key] = { obra: item.obra, items: [] };
      byObra[key].items.push(item);
    });
    Object.values(byObra).forEach(group => {
      const n = group.items.length;
      const nResueltos = group.items.filter(i => i.p.status === 'resuelto').length;
      html += `<div class="pasajes-group-header">
        <span>${group.obra.name}</span>
        <span style="color:var(--text3)">${nResueltos}/${n} resueltos</span>
      </div>`;
      group.items.forEach(item => { html += renderPasajeRowGlobal(item, STATUS_LABEL, STATUS_COLOR, STATUS_BAR, false); });
    });

  } else if (pasajesSort === 'estado') {
    // Group by status
    ['activo','mantenimiento','resuelto'].forEach(status => {
      const group = all.filter(i => (i.p.status || 'activo') === status);
      if (!group.length) return;
      html += `<div class="pasajes-group-header">
        <span style="color:${STATUS_COLOR[status]}">${STATUS_LABEL[status]}</span>
        <span style="color:var(--text3)">${group.length} pasajes</span>
      </div>`;
      group.forEach(item => { html += renderPasajeRowGlobal(item, STATUS_LABEL, STATUS_COLOR, STATUS_BAR, true); });
    });

  } else if (pasajesSort === 'score') {
    // Sort by score ascending (worst first), unscored at top
    const sorted = [...all].sort((a, b) => {
      const sa = a.avgScore ?? -1, sb = b.avgScore ?? -1;
      if (sa === sb) return STATUS_ORDER[a.p.status||'activo'] - STATUS_ORDER[b.p.status||'activo'];
      return sa - sb;
    });
    const unscored = sorted.filter(i => i.avgScore === null);
    const scored   = sorted.filter(i => i.avgScore !== null);
    if (unscored.length) {
      html += `<div class="pasajes-group-header"><span>Sin puntuación registrada</span><span style="color:var(--text3)">${unscored.length}</span></div>`;
      unscored.forEach(item => { html += renderPasajeRowGlobal(item, STATUS_LABEL, STATUS_COLOR, STATUS_BAR, true); });
    }
    if (scored.length) {
      html += `<div class="pasajes-group-header"><span>Más imperfectos primero</span><span style="color:var(--text3)">${scored.length}</span></div>`;
      scored.forEach(item => { html += renderPasajeRowGlobal(item, STATUS_LABEL, STATUS_COLOR, STATUS_BAR, true); });
    }

  } else if (pasajesSort === 'reciente') {
    // Sort by lastWorked descending (most recently worked first)
    const sorted = [...all].sort((a, b) => {
      const da = a.lastWorked ? a.lastWorked.getTime() : 0;
      const db2 = b.lastWorked ? b.lastWorked.getTime() : 0;
      return db2 - da;
    });
    html += `<div class="pasajes-group-header"><span>Más trabajados recientemente</span></div>`;
    sorted.forEach(item => { html += renderPasajeRowGlobal(item, STATUS_LABEL, STATUS_COLOR, STATUS_BAR, true); });
  }

  el.innerHTML = html;
}

function openPasajeStats(obraId, pasajeId) {
  const obra = findObra(obraId);
  if (!obra) return;
  const p = (obra.pasajes || []).find(x => x.id === pasajeId);
  if (!p) return;

  const sesiones = [...(p.sesiones || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const scores = sesiones.map(s => s.score);
  const n = scores.length;

  document.getElementById('pstatsTitle').textContent = p.text;
  document.getElementById('pstatsObra').textContent = obra.name + (obra.composer && obra.composer !== '—' ? ' · ' + obra.composer : '');

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpiEl = document.getElementById('pstatsKpis');
  if (n === 0) {
    kpiEl.innerHTML = `<div style="font-size:11px;color:var(--text3);padding:12px 0">Sin entradas registradas aún. Usa "+ registrar hoy" para empezar.</div>`;
    document.getElementById('pstatsGraph').innerHTML = '';
    document.getElementById('pstatsLog').innerHTML = '';
    openModal('modalPasajeStats');
    return;
  }

  const avg    = +(scores.reduce((a, b) => a + b, 0) / n).toFixed(1);
  const last   = scores[n - 1];
  const best   = Math.max(...scores);
  const worst  = Math.min(...scores);

  // Trend: compare last 3 vs previous 3
  let trendLabel = '—', trendColor = 'var(--text3)';
  if (n >= 4) {
    const half = Math.max(2, Math.floor(n / 2));
    const recent = scores.slice(-half).reduce((a,b) => a+b,0) / half;
    const older  = scores.slice(0, Math.floor(n/2)).reduce((a,b) => a+b,0) / Math.floor(n/2);
    const diff = +(recent - older).toFixed(1);
    if (diff > 0.5)       { trendLabel = `+${diff} ↑`; trendColor = 'var(--green)'; }
    else if (diff < -0.5) { trendLabel = `${diff} ↓`; trendColor = 'var(--red)'; }
    else                  { trendLabel = 'estable →'; trendColor = 'var(--accent)'; }
  }

  // Days span
  const firstDate = new Date(sesiones[0].date);
  const lastDate  = new Date(sesiones[n-1].date);
  const spanDays  = Math.max(0, Math.round((lastDate - firstDate) / 86400000));

  const scoreColor = s => s >= 7 ? 'var(--green)' : s >= 4 ? 'var(--accent)' : 'var(--red)';
  const scoreColorHex = s => s >= 7 ? '#2a8a5a' : s >= 4 ? '#c9a96e' : '#c84040';

  kpiEl.innerHTML = [
    { val: n,            label: 'Entradas' },
    { val: last + '/10', label: 'Última',   color: scoreColor(last) },
    { val: avg + '/10',  label: 'Media',    color: scoreColor(avg) },
    { val: best + '/10', label: 'Máximo',   color: 'var(--green)' },
    { val: trendLabel,   label: 'Tendencia',color: trendColor },
    { val: spanDays + 'd', label: 'Período' },
  ].map(k => `<div class="pstats-kpi">
    <div class="pstats-kpi-val" style="${k.color ? 'color:'+k.color : ''}">${k.val}</div>
    <div class="pstats-kpi-label">${k.label}</div>
  </div>`).join('');

  // ── SVG GRAPH ─────────────────────────────────────────────────────────────
  const W = 460, H = 130;
  const PAD = { top: 14, right: 14, bottom: 28, left: 26 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const xOf = i => PAD.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
  const yOf = s => PAD.top + cH - ((s - 1) / 9) * cH;

  // Smoothed line (moving avg window 2)
  const smoothed = sesiones.map((_, i) => {
    const win = scores.slice(Math.max(0, i-1), i+2);
    return win.reduce((a,b) => a+b, 0) / win.length;
  });

  const lineD  = smoothed.map((s, i) => `${i===0?'M':'L'}${xOf(i)},${yOf(s)}`).join(' ');
  const areaD  = `${lineD} L${xOf(n-1)},${yOf(1)} L${xOf(0)},${yOf(1)} Z`;

  // Grid lines 1, 5, 10
  const grid = [1,5,10].map(s => {
    const y = yOf(s);
    return `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="var(--border2)" stroke-dasharray="3,3"/>
      <text x="${PAD.left-3}" y="${y+3}" text-anchor="end" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">${s}</text>`;
  }).join('');

  // X axis labels (show up to 6)
  const step = Math.max(1, Math.floor(n / 5));
  const xLabels = sesiones.filter((_, i) => i % step === 0 || i === n-1).map((s, _, arr) => {
    const i = sesiones.indexOf(s);
    const d = new Date(s.date);
    const lbl = `${d.getDate()}/${d.getMonth()+1}`;
    return `<text x="${xOf(i)}" y="${H-4}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">${lbl}</text>`;
  }).join('');

  // Dots
  const dots = sesiones.map((s, i) => {
    const sc = s.score;
    const d  = new Date(s.date).toLocaleDateString('es-ES', { day:'numeric', month:'short' });
    return `<circle cx="${xOf(i)}" cy="${yOf(sc)}" r="5"
      fill="${scoreColorHex(sc)}" stroke="var(--bg2)" stroke-width="1.5" opacity="0.92">
      <title>${d} · ${sc}/10${s.note ? ' · ' + s.note : ''}</title>
    </circle>`;
  }).join('');

  document.getElementById('pstatsGraph').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
      <defs>
        <linearGradient id="pstatsGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${areaD}" fill="url(#pstatsGrad)"/>
      <path d="${lineD}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" opacity="0.6"/>
      ${dots}
      ${xLabels}
    </svg>`;

  // ── LOG TABLE ─────────────────────────────────────────────────────────────
  const logEl = document.getElementById('pstatsLog');
  const rows  = [...sesiones].reverse().map(s => {
    const d   = new Date(s.date).toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
    const col = scoreColorHex(s.score);
    return `<div class="pstats-log-row">
      <div class="pstats-score-dot" style="background:${col}">${s.score}</div>
      <div class="pstats-log-date">${d}</div>
      <div class="pstats-log-note">${s.note || ''}</div>
    </div>`;
  }).join('');
  logEl.innerHTML = rows || `<div style="color:var(--text3);font-size:10px;padding:8px 0">Sin notas.</div>`;

  openModal('modalPasajeStats');
}

function cyclePasajeStatusGlobal(obraId, pasajeId, btn) {
  const obra = findObra(obraId);
  if (!obra) return;
  const p = (obra.pasajes || []).find(x => x.id === pasajeId);
  if (!p) return;
  const cycle = ['activo', 'mantenimiento', 'resuelto'];
  p.status = cycle[(cycle.indexOf(p.status || 'activo') + 1) % cycle.length];
  saveData();
  // Update pill color inline without full re-render
  btn.className = `pasaje-status-pill ${p.status}`;
  btn.title = `Estado: ${{ activo:'Activo', mantenimiento:'Mantenimiento', resuelto:'Resuelto' }[p.status]} (toca para cambiar)`;
  showToast({ activo:'Activo', mantenimiento:'Mantenimiento', resuelto:'Resuelto' }[p.status] + ' ✓');
  // Also update bar label/fill
  const row = btn.closest('.pasaje-row-global');
  if (row) {
    const STATUS_BAR = { activo: 25, mantenimiento: 60, resuelto: 95 };
    const STATUS_COLOR = { activo: 'var(--orange)', mantenimiento: 'var(--accent)', resuelto: 'var(--green)' };
    const STATUS_LABEL = { activo: 'Activo', mantenimiento: 'Mantenimiento', resuelto: 'Resuelto' };
    const scores = (p.sesiones || []);
    const avgScore = scores.length
      ? Math.round(scores.slice(0,5).reduce((s,x) => s + x.score, 0) / Math.min(scores.length,5))
      : null;
    const fillPct   = avgScore !== null ? Math.round((avgScore/10)*100) : STATUS_BAR[p.status];
    const fillColor = avgScore !== null
      ? (avgScore >= 7 ? 'var(--green)' : avgScore >= 4 ? 'var(--accent)' : 'var(--red)')
      : STATUS_COLOR[p.status];
    const barLabel = avgScore !== null ? `${avgScore}/10 · ${STATUS_LABEL[p.status]}` : STATUS_LABEL[p.status];
    const fill = row.querySelector('.pasaje-bar-fill');
    if (fill) { fill.style.width = fillPct + '%'; fill.style.background = fillColor; }
    const label = row.querySelector('.pasaje-bar-fill')?.closest('.pasaje-bar-track')?.nextElementSibling?.firstElementChild;
    if (label) { label.textContent = barLabel; label.style.color = fillColor; }
  }
}

function renderPasajeRowGlobal(item, STATUS_LABEL, STATUS_COLOR, STATUS_BAR, showObra) {
  const { obra, p, lastWorked, lastScore, avgScore } = item;
  const status   = p.status || 'activo';
  const barPct   = STATUS_BAR[status] || 25;
  const barColor = STATUS_COLOR[status];

  // Score bar: if we have avgScore, use that 0-100 instead of status
  const useScore  = avgScore !== null;
  const fillPct   = useScore ? Math.round((avgScore / 10) * 100) : barPct;
  const fillColor = useScore
    ? (avgScore >= 7 ? 'var(--green)' : avgScore >= 4 ? 'var(--accent)' : 'var(--red)')
    : barColor;
  const barLabel  = useScore
    ? `${avgScore}/10 · ${STATUS_LABEL[status]}`
    : STATUS_LABEL[status];

  const lastStr = lastWorked
    ? lastWorked.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    : '—';

  const tempoInfo = (p.tempoAct && p.tempoObj)
    ? `<span style="font-size:8px;color:var(--text3);margin-left:6px">${p.tempoAct}→${p.tempoObj}bpm</span>`
    : '';

  // Check if already logged today
  const today = new Date().toDateString();
  const loggedToday = (p.sesiones||[]).some(s => new Date(s.date).toDateString() === today);
  const logBtnStyle = loggedToday
    ? 'color:var(--green);border-color:var(--green)'
    : 'color:var(--text3)';
  const logBtnTitle = loggedToday ? '✓ registrado hoy' : '+ registrar hoy';
  const hasHistory = (p.sesiones||[]).length > 0;

  return `<div class="pasaje-row-global">
    <div style="flex:1;min-width:0">
      <div class="pasaje-row-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.text}${tempoInfo}</div>
      ${showObra ? `<div class="pasaje-row-obra" style="margin-top:2px">${obra.name}</div>` : ''}
      <div class="pasaje-bar-track" style="margin-top:5px">
        <div class="pasaje-bar-fill" style="width:${fillPct}%;background:${fillColor}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:2px">
        <div style="font-size:8px;color:${fillColor}">${barLabel}</div>
        <div style="font-size:8px;color:var(--text3)">trabajado: ${lastStr}</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;margin-left:8px">
      <button onclick="openPasajeStats('${obra.id}','${p.id}')"
        style="padding:5px 8px;background:transparent;border:1px solid var(--border2);border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:9px;cursor:pointer;color:${hasHistory ? 'var(--accent)' : 'var(--text3)'}"
        title="Ver estadísticas">↗ stats${hasHistory ? ' (' + (p.sesiones||[]).length + ')' : ''}</button>
      <button onclick="openPasajeScore('${obra.id}','${p.id}')"
        style="padding:5px 8px;background:transparent;border:1px solid ${loggedToday ? 'var(--green)' : 'var(--border2)'};border-radius:6px;font-family:\'JetBrains Mono\',monospace;font-size:9px;cursor:pointer;color:${loggedToday ? 'var(--green)' : 'var(--text3)'}">${logBtnTitle}</button>
    </div>
  </div>`;
}

// ─── PASE QUALITY ────────────────────────────────────────────────────────────

let paseQualityObraId = null;
let paseQualityMovId = null;
let paseQualitySelected = null; // number 1-10, chosen from 5 coarse levels
let paseTipoSelected = 'solo';
let cronoPaseTipoSelected = 'solo';

const PASE_SCORE_CHOICES = [
  { score: 2, label: 'Se cae', sub: 'pierdo el hilo' },
  { score: 4, label: 'Frágil', sub: 'sale con paradas' },
  { score: 6, label: 'Sale', sub: 'con control' },
  { score: 8, label: 'Sólido', sub: 'entero y estable' },
  { score: 10, label: 'Listo', sub: 'para exponer' },
];

function scoreToQuality(n) {
  if (n === null || n === undefined) return null;
  if (n >= 8) return 'bien';
  if (n >= 5) return 'regular';
  return 'mal';
}

function scoreColor(n) {
  if (n >= 8) return 'var(--green)';
  if (n >= 5) return 'var(--accent)';
  return 'var(--red)';
}

function buildPaseScoreBtns() {
  const row = document.getElementById('paseQScoreBtns');
  if (!row) return;
  row.innerHTML = PASE_SCORE_CHOICES.map(ch =>
    `<button class="pscore-modal-btn pase-quality-chip" onclick="selectPaseQ(${ch.score},this)">
      <strong>${escapeHtmlSafe(ch.label)}</strong>
      <span>${escapeHtmlSafe(ch.sub)}</span>
    </button>`
  ).join('');
}

function registerPase(obraId, movId) {
  paseQualityObraId = obraId;
  paseQualityMovId = movId || null;
  paseQualitySelected = null;
  paseTipoSelected = 'solo';
  const obra = findObra(obraId);
  const mov = movId ? findMovimiento(obraId, movId) : null;
  const displayName = mov
    ? `${obra ? obra.name + ' — ' : ''}${mov.name}`
    : (obra ? obra.name : '');
  document.getElementById('paseQualityName').textContent = displayName;
  document.getElementById('paseQNote').value = '';
  document.getElementById('paseQFecha').value = new Date().toISOString().split('T')[0];
  buildPaseScoreBtns();
  document.querySelectorAll('#modalPaseQuality .pase-tipo-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#modalPaseQuality .pase-tipo-btn.solo')?.classList.add('active');
  openModal('modalPaseQuality');
}

function selectPaseTipo(tipo, btn) {
  paseTipoSelected = normalizePaseTipo(tipo);
  const row = btn?.closest('.pase-tipo-row') || document;
  row.querySelectorAll('.pase-tipo-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active', paseTipoSelected);
}

function selectPaseQ(n, btn) {
  paseQualitySelected = n;
  document.querySelectorAll('#paseQScoreBtns .pscore-modal-btn').forEach(b => {
    b.classList.remove('sel'); b.style.background = ''; b.style.color = '';
  });
  btn.classList.add('sel');
  btn.style.background = SCORE_COLORS[n];
  btn.style.color = '#fff';
}

function confirmPase() {
  if (!paseQualitySelected) { showToast('Elige una puntuación'); return; }
  const note = document.getElementById('paseQNote').value.trim();
  const fechaStr = document.getElementById('paseQFecha').value;
  const paseDate = fechaStr ? new Date(fechaStr + 'T12:00:00').toISOString() : new Date().toISOString();
  const tipo = normalizePaseTipo(paseTipoSelected);
  const quality = scoreToQuality(paseQualitySelected);
  const paseEntry = { date: paseDate, score: paseQualitySelected, solidezPct: paseScoreToPct(paseQualitySelected), quality, tipo, note };

  if (paseQualityMovId) {
    const mov = findMovimiento(paseQualityObraId, paseQualityMovId);
    if (!mov) { closeModal('modalPaseQuality'); return; }
    mov.lastPase = paseEntry.date;
    if (!mov.paseHistory) mov.paseHistory = [];
    mov.paseHistory.unshift(paseEntry);
    if (mov.paseHistory.length > 20) mov.paseHistory = mov.paseHistory.slice(0, 20);
    linkPaseToTargetHistory(paseQualityObraId, paseQualityMovId, paseQualitySelected, tipo, paseDate);
    saveData();
    closeModal('modalPaseQuality');
    showToast('Pase registrado ✓');
    const movCard = document.getElementById('mov-' + paseQualityObraId + '-' + paseQualityMovId);
    if (movCard) {
      const lastSpan = movCard.querySelector('.mov-actions span');
      if (lastSpan) lastSpan.textContent = 'Último pase: ' + new Date(paseEntry.date).toLocaleDateString('es-ES');
      const histDiv = movCard.querySelector('.mov-pase-hist');
      const tipoIcons = { solo: 'solo', informal: 'amigos', evento: 'evento', escena: 'evento', tecnico: 'tec', memoria: 'mem', concierto: 'evento' };
      const d = new Date(paseEntry.date).toLocaleDateString('es-ES',{day:'numeric',month:'short'});
      const tipoLabel = paseEntry.tipo ? `<span style="color:var(--text3);font-size:8px;background:var(--bg2);border-radius:3px;padding:1px 4px;margin-left:2px">${tipoIcons[paseEntry.tipo]||paseEntry.tipo}</span>` : '';
      const newRow = `<div style="display:flex;gap:8px;font-size:9px;color:var(--text3);padding:3px 0;align-items:center">
        <span style="color:${scoreColor(paseEntry.score)};font-weight:bold">${paseEntry.score}</span>${tipoLabel}<span>${d}</span>${note?`<span>· ${note}</span>`:''}
      </div>`;
      if (histDiv) histDiv.insertAdjacentHTML('afterbegin', newRow);
      else movCard.insertAdjacentHTML('beforeend', `<div class="mov-pase-hist">${newRow}</div>`);
    }
    return;
  }

  const obra = findObra(paseQualityObraId);
  if (!obra) { closeModal('modalPaseQuality'); return; }
  obra.lastPase = paseEntry.date;
  if (!obra.paseHistory) obra.paseHistory = [];
  obra.paseHistory.unshift(paseEntry);
  if (obra.paseHistory.length > 20) obra.paseHistory = obra.paseHistory.slice(0, 20);
  linkPaseToHistory(paseQualityObraId, paseQualitySelected, tipo, paseDate);
  saveData();
  closeModal('modalPaseQuality');
  showToast('Pase registrado ✓');
  renderObras();
}

// ─── PASE RÁPIDO DESDE CRONÓMETRO ───────────────────────────────────────────

let cronoPaseDraft = [];
const CRONO_PASE_SCORE_CHOICES = [
  { score: 2, label: 'Se cae' },
  { score: 4, label: 'Frágil' },
  { score: 6, label: 'Sale' },
  { score: 8, label: 'Sólido' },
  { score: 10, label: 'Listo' },
];

function cronoPaseDefaultMinutes(resolved) {
  if (!resolved) return 8;
  const direct = parseInt(resolved.entity?.duracion || 0, 10);
  if (direct > 0) return direct;
  if (!resolved.mov && Array.isArray(resolved.obra?.movimientos)) {
    const sum = resolved.obra.movimientos.reduce((s, m) => s + (parseInt(m.duracion || 0, 10) || 0), 0);
    if (sum > 0) return sum;
  }
  return 8;
}

function cronoPaseDraftKey(obraId, movId) {
  return obraId + '::' + (movId || '');
}

function cronoPaseResolveSelect() {
  const val = document.getElementById('cronoPaseObraSelect')?.value || '';
  return studyRegisterResolveValue(val);
}

function cronoPaseSeedCurrentSelection() {
  let val = '';
  if (crono.state !== 'idle' && crono.obraId && crono.obraId !== '_rest_') {
    val = crono.movId ? ('mov::' + crono.obraId + '::' + crono.movId) : ('obra::' + crono.obraId);
  } else {
    val = document.getElementById('cronoObraSelect')?.value || '';
  }
  if (!val) return;
  const sel = document.getElementById('cronoPaseObraSelect');
  if (sel) sel.value = val;
  cronoPaseAddSelected({ silent: true });
}

function openCronoPaseRapido() {
  buildObraSelectOptions('cronoPaseObraSelect');
  cronoPaseDraft = [];
  cronoPaseTipoSelected = 'solo';
  document.querySelectorAll('#modalCronoPaseRapido .pase-tipo-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#modalCronoPaseRapido .pase-tipo-btn.solo')?.classList.add('active');
  cronoPaseSeedCurrentSelection();
  cronoPasePreviewSelected();
  cronoPaseRender();
  openModal('modalCronoPaseRapido');
}

function selectCronoPaseTipo(tipo, btn) {
  cronoPaseTipoSelected = normalizePaseTipo(tipo);
  const row = btn?.closest('.pase-tipo-row') || document;
  row.querySelectorAll('.pase-tipo-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active', cronoPaseTipoSelected);
}

function cronoPasePreviewSelected() {
  const el = document.getElementById('cronoPasePreview');
  if (!el) return;
  const resolved = cronoPaseResolveSelect();
  if (!resolved) {
    el.textContent = 'Selecciona una obra';
    return;
  }
  el.textContent = 'Duración: ' + cronoPaseDefaultMinutes(resolved) + ' min';
}

function cronoPaseAddSelected(opts) {
  const resolved = cronoPaseResolveSelect();
  if (!resolved) {
    if (!opts || !opts.silent) showToast('Selecciona una obra o movimiento');
    return;
  }
  const key = cronoPaseDraftKey(resolved.obraId, resolved.movId);
  if (cronoPaseDraft.some(it => it.key === key)) {
    if (!opts || !opts.silent) showToast('Ya está añadida');
    return;
  }
  cronoPaseDraft.push({
    key,
    obraId: resolved.obraId,
    movId: resolved.movId || null,
    name: resolved.name,
    minutes: cronoPaseDefaultMinutes(resolved),
    score: 8,
  });
  cronoPaseRender();
  if (!opts || !opts.silent) {
    try { Haptics.light(); } catch(e) {}
  }
}

function cronoPaseSetScore(key, score) {
  const item = cronoPaseDraft.find(it => it.key === key);
  if (!item) return;
  item.score = score;
  cronoPaseRender();
}

function cronoPaseSetMinutes(key, value) {
  const item = cronoPaseDraft.find(it => it.key === key);
  if (!item) return;
  const n = Math.max(1, Math.min(180, parseInt(value || '0', 10) || item.minutes || 1));
  item.minutes = n;
  cronoPaseUpdateTotal();
}

function cronoPaseRemove(key) {
  cronoPaseDraft = cronoPaseDraft.filter(it => it.key !== key);
  cronoPaseRender();
}

function cronoPaseUpdateTotal() {
  const el = document.getElementById('cronoPaseTotal');
  if (!el) return;
  const total = cronoPaseDraft.reduce((s, it) => s + (parseInt(it.minutes || 0, 10) || 0), 0);
  el.textContent = total ? ('Total: ' + total + ' min') : '0 min';
}

function cronoPaseRender() {
  const host = document.getElementById('cronoPaseItems');
  if (!host) return;
  if (!cronoPaseDraft.length) {
    host.innerHTML = '<div class="crono-pase-empty">Añade una o varias obras tocadas en el pase.</div>';
    cronoPaseUpdateTotal();
    return;
  }
  host.innerHTML = cronoPaseDraft.map(it => {
    const scoreBtns = CRONO_PASE_SCORE_CHOICES.map(ch =>
      '<button type="button" class="crono-pase-score ' + (it.score === ch.score ? 'active' : '') + '" onclick="cronoPaseSetScore(\'' + it.key + '\',' + ch.score + ')">' +
        escapeHtmlSafe(ch.label) +
      '</button>'
    ).join('');
    return '<div class="crono-pase-item">' +
      '<div class="crono-pase-item-top">' +
        '<div class="crono-pase-item-name">' + escapeHtmlSafe(it.name) + '</div>' +
        '<input class="crono-pase-min" type="number" min="1" max="180" step="1" value="' + it.minutes + '" onchange="cronoPaseSetMinutes(\'' + it.key + '\',this.value)" oninput="cronoPaseSetMinutes(\'' + it.key + '\',this.value)" aria-label="Minutos">' +
        '<span class="crono-pase-min-label">min</span>' +
        '<button type="button" class="crono-pase-remove" onclick="cronoPaseRemove(\'' + it.key + '\')" aria-label="Quitar">×</button>' +
      '</div>' +
      '<div class="crono-pase-score-row">' + scoreBtns + '</div>' +
    '</div>';
  }).join('');
  cronoPaseUpdateTotal();
}

function cronoPaseRecordQuality(item, dateIso) {
  const tipo = normalizePaseTipo(cronoPaseTipoSelected);
  const paseEntry = {
    date: dateIso,
    score: item.score,
    solidezPct: paseScoreToPct(item.score),
    quality: scoreToQuality(item.score),
    tipo,
    note: 'pase rápido',
  };
  if (item.movId) {
    const mov = findMovimiento(item.obraId, item.movId);
    if (!mov) return;
    mov.lastPase = paseEntry.date;
    if (!mov.paseHistory) mov.paseHistory = [];
    mov.paseHistory.unshift(paseEntry);
    if (mov.paseHistory.length > 20) mov.paseHistory = mov.paseHistory.slice(0, 20);
    linkPaseToTargetHistory(item.obraId, item.movId, item.score, tipo, dateIso);
    return;
  }
  const obra = findObra(item.obraId);
  if (!obra) return;
  obra.lastPase = paseEntry.date;
  if (!obra.paseHistory) obra.paseHistory = [];
  obra.paseHistory.unshift(paseEntry);
  if (obra.paseHistory.length > 20) obra.paseHistory = obra.paseHistory.slice(0, 20);
  linkPaseToHistory(item.obraId, item.score, tipo, dateIso);
}

function cronoPaseAddToStudy(item, startedAtIso, endedAtIso) {
  const obra = findObra(item.obraId);
  if (!obra) return null;
  const mov = item.movId ? findMovimiento(item.obraId, item.movId) : null;
  const minutes = Math.max(1, parseInt(item.minutes || 0, 10) || cronoPaseDefaultMinutes({ obra, mov, entity: mov || obra }));
  const existing = currentPlan.find(e =>
    (e._obraId || e.id) === item.obraId &&
    (e._movId || null) === (item.movId || null)
  );
  let targetPlanId, entity;
  if (existing) {
    targetPlanId = existing._planId || existing.id;
    const wasExtra = !!existing._isExtra;
    entity = promotePlanEntityToExtra(existing, obra, mov, item.obraId, item.movId, item.name, targetPlanId);
    if (!wasExtra) {
      sessionMinPlan[targetPlanId] = minutes;
    } else {
      sessionMinPlan[targetPlanId] = (sessionMinPlan[targetPlanId] || 0) + minutes;
    }
  } else {
    targetPlanId = 'pase_' + item.obraId + (item.movId ? '_' + item.movId : '') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    const baseEntity = item.movId
      ? Object.assign({}, mov, { _parentName: obra.name, composer: obra.composer })
      : Object.assign({}, obra);
    entity = Object.assign({}, baseEntity, {
      _planId: targetPlanId,
      _obraId: item.obraId,
      _movId: item.movId || null,
      _isMovimiento: !!item.movId,
      _isExtra: true,
      _displayName: item.name,
    });
    currentPlan.push(entity);
    sessionMinPlan[targetPlanId] = minutes;
  }

  sessionTicks[targetPlanId] = 'hecho';
  sessionProductivityRatings[targetPlanId] = Math.max(0, Math.min(100, item.score * 10));
  if (!sessionAggregate[targetPlanId]) sessionAggregate[targetPlanId] = { subsessions: [] };
  sessionAggregate[targetPlanId].subsessions.push({
    min: minutes,
    prod: item.score * 10,
    timestamp: endedAtIso,
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    pase: true,
    score: item.score,
    tipo: normalizePaseTipo(cronoPaseTipoSelected),
  });

  ensureSessionPlanScaffold();
  const planDiv = document.getElementById('sessionPlan');
  const planEl = document.getElementById('plan-' + targetPlanId);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderExtraItem(entity, sessionMinPlan[targetPlanId]);
  const node = wrapper.firstElementChild;
  if (node) {
    if (planEl) planEl.replaceWith(node);
    else if (planDiv) {
      const addBtn = planDiv.querySelector('.add-extra-btn');
      const saveBtn = planDiv.querySelector('.save-session-btn');
      planDiv.insertBefore(node, addBtn || saveBtn || null);
    }
    const doneBtn = node.querySelector('.tick-btn');
    if (doneBtn) doneBtn.classList.add('hecho');
    if (typeof updateProductivityBadge === 'function') updateProductivityBadge(targetPlanId);
  }
  recordSessionPlant(item.obraId, item.movId, startedAtIso, endedAtIso, minutes, { source: 'pase' });
  return { planId: targetPlanId, minutes };
}

function confirmCronoPaseRapido() {
  if (!cronoPaseDraft.length) {
    showToast('Añade al menos una obra');
    return;
  }
  const total = cronoPaseDraft.reduce((s, it) => s + (parseInt(it.minutes || 0, 10) || 0), 0);
  if (total < 1) {
    showToast('No hay minutos que sumar');
    return;
  }
  const prevConcentradoMin = typeof getMinutosConcentradoHoy === 'function' ? getMinutosConcentradoHoy() : 0;
  let cursor = new Date(Date.now() - total * 60000);
  let added = 0;
  const dateIso = new Date().toISOString();
  cronoPaseDraft.forEach(item => {
    const minutes = Math.max(1, parseInt(item.minutes || 0, 10) || 1);
    const started = new Date(cursor);
    const ended = new Date(cursor.getTime() + minutes * 60000);
    cursor = ended;
    cronoPaseRecordQuality(item, dateIso);
    const res = cronoPaseAddToStudy(item, started.toISOString(), ended.toISOString());
    if (res) added += res.minutes;
  });
  if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
  if (typeof saveDraft === 'function') saveDraft();
  if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
  if (typeof renderRacha === 'function') renderRacha();
  if (typeof _autoSaveTodayPlanNow === 'function') _autoSaveTodayPlanNow();
  else saveData();
  closeModal('modalCronoPaseRapido');
  cronoPaseDraft = [];
  if (typeof cronoPlayHarvest === 'function') {
    cronoPlayHarvest(
      prevConcentradoMin,
      typeof getMinutosConcentradoHoy === 'function' ? getMinutosConcentradoHoy() : prevConcentradoMin + added,
      added
    );
  }
  showToast('Pase guardado · +' + added + ' min');
  try { if (typeof SFX !== 'undefined' && SFX.pase) SFX.pase(); } catch(e) {}
  try { Haptics.medium(); } catch(e) {}
}

// Save draft on any note/objetivo input in the session plan
document.addEventListener('input', function(e) {
  if (e.target.matches('#sessionPlan .tick-note')) {
    saveDraft();
  }
});

// ─── OBRAS GLOBAL CHART ──────────────────────────────────────────────────────

let chartMetric = 'pases';

function setChartMetric(metric, btn) {
  chartMetric = metric;
  document.querySelectorAll('#chartMetricBtns .sort-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderObrasChart();
}

function openObrasChart() {
  chartMetric = 'pases';
  document.querySelectorAll('#chartMetricBtns .sort-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  openModal('modalObrasChart');
  requestAnimationFrame(() => renderObrasChart());
}

function renderObrasChart() {
  const svgEl = document.getElementById('obrasChartSvg');
  const leyEl = document.getElementById('obrasChartLeyenda');
  if (!svgEl) return;

  const obras = (db.obras || []).filter(o => {
    if (chartMetric === 'pases') return (o.paseHistory || []).length >= 1;
    return true;
  });

  if (!obras.length) {
    svgEl.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:11px;color:var(--text3)">No hay datos suficientes aún.</div>';
    leyEl.innerHTML = '';
    return;
  }

  // Palette — enough for up to 10 obras
  const PALETTE = [
    '#c9a96e','#7ec89a','#e07060','#6090d8','#d08040',
    '#a06ad8','#40b8a0','#d06080','#80a040','#8080c0'
  ];

  const W = 500, H = 200;
  const PAD = { top: 16, right: 16, bottom: 32, left: 28 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const xOf = (t, minT, rangeT) => PAD.left + (rangeT > 0 ? ((t - minT) / rangeT) * cW : cW / 2);
  const yOf = v => PAD.top + cH - ((v - 1) / 9) * cH; // scale 1-10

  // Collect all series
  let allTimes = [];

  const series = obras.map((obra, idx) => {
    let points = [];
    if (chartMetric === 'pases') {
      const hist = [...(obra.paseHistory || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
      points = hist.map(p => ({ t: new Date(p.date).getTime(), v: p.score ?? null })).filter(p => p.v !== null);
    } else {
      // For apr/sol/esc — we only have current value, not history.
      // Show as a horizontal line at current value to still participate in the chart.
      const val = obra[chartMetric] || 1;
      const now = Date.now();
      const start = now - 30 * 86400000;
      points = [{ t: start, v: val }, { t: now, v: val }];
    }
    points.forEach(p => allTimes.push(p.t));
    return { obra, points, color: PALETTE[idx % PALETTE.length] };
  }).filter(s => s.points.length >= 1);

  if (!series.length) {
    svgEl.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:11px;color:var(--text3)">Sin datos de pases registrados.</div>';
    leyEl.innerHTML = '';
    return;
  }

  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);
  const rangeT = maxT - minT || 86400000;

  // Grid lines
  const grid = [1, 4, 7, 10].map(v => {
    const y = yOf(v);
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border2)" stroke-dasharray="3,3"/>
      <text x="${PAD.left - 3}" y="${y + 3.5}" text-anchor="end" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">${v}</text>`;
  }).join('');

  // X axis labels — time-based with collision check
  const xRangeDays = (maxT - minT) / 86400000;
  const xDayMs = 86400000;
  const xTickInterval = xRangeDays <= 10  ? xDayMs
    : xRangeDays <= 45  ? 7  * xDayMs
    : xRangeDays <= 120 ? 14 * xDayMs
    : 30 * xDayMs;
  const xFirstTick = Math.ceil(minT / xTickInterval) * xTickInterval;
  const xCands = [minT];
  for (let t = xFirstTick; t <= maxT; t += xTickInterval) xCands.push(t);
  if (xCands[xCands.length-1] < maxT) xCands.push(maxT);
  const xUsedXs = [];
  const xLabels = xCands
    .filter((t, idx, arr) => arr.indexOf(t) === idx && t >= minT && t <= maxT)
    .filter(t => {
      const x = xOf(t, minT, rangeT);
      if (xUsedXs.some(ux => Math.abs(ux - x) < 32)) return false;
      xUsedXs.push(x);
      return true;
    })
    .map(t => {
      const d = new Date(t);
      const lbl = xRangeDays > 90
        ? d.getDate() + '/' + (d.getMonth()+1) + '/' + String(d.getFullYear()).slice(2)
        : d.getDate() + '/' + (d.getMonth()+1);
      return `<text x="${xOf(t, minT, rangeT).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">${lbl}</text>`;
    }).join('');

  // Lines + dots per obra
  const paths = series.map(({ obra, points, color }) => {
    if (points.length === 0) return '';
    const sorted = [...points].sort((a, b) => a.t - b.t);

    // Smooth line
    const lineD = sorted.map((p, i) => {
      const x = xOf(p.t, minT, rangeT);
      const y = yOf(p.v);
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    const dots = sorted.map(p => {
      const x = xOf(p.t, minT, rangeT);
      const y = yOf(p.v);
      const d = new Date(p.t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" stroke="var(--bg2)" stroke-width="1.5" opacity="0.9"><title>${obra.name} · ${d} · ${p.v}/10</title></circle>`;
    }).join('');

    // Label at last point
    const last = sorted[sorted.length - 1];
    const lx = xOf(last.t, minT, rangeT);
    const ly = yOf(last.v);
    const shortName = obra.name.length > 12 ? obra.name.slice(0, 11) + '…' : obra.name;
    const labelX = Math.min(lx + 6, W - PAD.right - 2);

    return `<path d="${lineD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" opacity="0.85"/>
      ${dots}
      <text x="${labelX}" y="${ly + 3}" font-size="7.5" fill="${color}" font-family="JetBrains Mono,monospace" opacity="0.9">${shortName}</text>`;
  }).join('');

  svgEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
    ${grid}${paths}${xLabels}
  </svg>`;

  // Legend
  leyEl.innerHTML = series.map(({ obra, color }) =>
    `<div class="chart-leyenda-item">
      <span class="chart-leyenda-dot" style="background:${color}"></span>
      <span>${obra.name}</span>
    </div>`
  ).join('');
}

// ─── BACKUP ──────────────────────────────────────────────────────────────────

function exportarDatos() {
  const payload = {
    version: 2,
    exportDate: new Date().toISOString(),
    data: db
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const fecha = new Date().toISOString().split('T')[0];
  a.href     = url;
  a.download = `alberto-piano-backup-${fecha}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Datos exportados ✓');
}

function aiLocalDateKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function aiDateLabel(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function aiTimeLabel(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function aiMinutesLabel(mins) {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h && m) return h + ' h ' + m + ' min';
  if (h) return h + ' h';
  return m + ' min';
}

function aiPaseResultLabel(score) {
  const n = Number(score);
  if (n >= 9) return 'Listo';
  if (n >= 8) return 'Sólido';
  if (n >= 6) return 'Sale';
  if (n >= 4) return 'Frágil';
  if (n > 0) return 'Se cae';
  return '';
}

function aiTodayKey() {
  return aiLocalDateKey(new Date());
}

function aiDaysUntil(fecha) {
  if (!fecha) return null;
  const target = new Date(fecha + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function aiLatestPaseForObra(obra) {
  if (!obra) return null;
  const pases = [];
  (obra.paseHistory || []).forEach(p => pases.push({ ...p, target: 'obra completa', movimiento: null }));
  (obra.movimientos || []).forEach(mov => {
    (mov.paseHistory || []).forEach(p => pases.push({ ...p, target: mov.name || 'movimiento', movimiento: mov.name || '' }));
  });
  const sorted = pases
    .filter(p => p && (p.date || p.at))
    .sort((a, b) => new Date(b.date || b.at || 0) - new Date(a.date || a.at || 0));
  const p = sorted[0];
  if (!p) return null;
  const date = p.date || p.at;
  return {
    date,
    day: aiLocalDateKey(date),
    time: aiTimeLabel(date),
    target: p.target || 'obra completa',
    movimiento: p.movimiento || null,
    tipo: typeof normalizePaseTipo === 'function' ? normalizePaseTipo(p.tipo) : (p.tipo || ''),
    score: p.score != null ? p.score : null,
    resultado: aiPaseResultLabel(p.score),
    nota: p.note || p.nota || '',
  };
}

function aiBuildEventoObraStatus(obra, readinessDetail) {
  if (!obra) return null;
  const effective = typeof obraEffectiveStats === 'function' ? obraEffectiveStats(obra) : obra;
  const fase = typeof obraFaseLabel === 'function' ? obraFaseLabel(effective) : null;
  const aprPct = typeof compasPercent === 'function' ? compasPercent(effective) : null;
  const sol = typeof estimateSolActual === 'function' ? estimateSolActual(effective) : null;
  const lastPase = aiLatestPaseForObra(obra);
  const activePasajes = (obra.pasajes || []).filter(p => (p.status || 'activo') !== 'resuelto');
  return {
    obraId: obra.id,
    nombre: obra.name || '',
    compositor: obra.composer || '',
    estadoGeneral: fase ? fase.label : '',
    aprendidoPct: aprPct,
    solidezEstimadaPct: sol ? sol.val : null,
    diasSinMedirSolidez: sol && sol.diasGap != null ? sol.diasGap : null,
    preparacionEventoPct: readinessDetail && readinessDetail.obraScore != null ? Math.round(readinessDetail.obraScore) : null,
    ultimoPase: lastPase,
    pasesRegistrados: (obra.paseHistory || []).length + (obra.movimientos || []).reduce((s, m) => s + ((m.paseHistory || []).length), 0),
    pasajesActivos: activePasajes.map(p => ({
      id: p.id,
      texto: p.text || p.name || p.id,
      estado: p.status || 'activo',
      solidezPct: (p.solHistory || [])[0]?.val ?? null,
    })),
  };
}

function aiObraName(obraId, movId) {
  const obra = findObra(obraId);
  if (!obra) return { obra: obraId || 'sin obra', movimiento: movId || null, label: obraId || 'sin obra' };
  const mov = movId ? findMovimiento(obraId, movId) : null;
  const base = obra.name + (obra.composer && obra.composer !== '—' ? ' · ' + obra.composer : '');
  return {
    obra: obra.name,
    compositor: obra.composer || '',
    movimiento: mov ? mov.name : null,
    label: mov ? base + ' · ' + mov.name : base,
  };
}

function aiDownloadText(filename, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function aiExportFeedback(text, color) {
  const el = document.getElementById('aiExportFeedback');
  if (el) {
    el.textContent = text;
    el.style.color = color || 'var(--green)';
    el.style.display = 'block';
  }
  showToast(text);
}

function aiReadLocalJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; }
}

function aiStudyMinutesFromSession(sesion) {
  return (sesion.items || []).reduce((sum, it) => {
    const val = it.minutosReales != null ? it.minutosReales : (it.minReal != null ? it.minReal : it.minutosPlan);
    return sum + (Number(val) || 0);
  }, 0);
}

function aiBuildPaseRows() {
  const rows = [];
  (db.obras || []).forEach(obra => {
    (obra.paseHistory || []).forEach(p => {
      rows.push({
        date: p.date || p.at || null,
        day: aiLocalDateKey(p.date || p.at),
        time: aiTimeLabel(p.date || p.at),
        obraId: obra.id,
        movId: null,
        obra: obra.name,
        compositor: obra.composer || '',
        movimiento: null,
        tipo: typeof normalizePaseTipo === 'function' ? normalizePaseTipo(p.tipo) : (p.tipo || ''),
        score: p.score != null ? p.score : null,
        resultado: aiPaseResultLabel(p.score),
        solidezPct: p.solidezPct != null ? p.solidezPct : (p.score != null && typeof paseScoreToPct === 'function' ? paseScoreToPct(p.score) : null),
        nota: p.note || p.nota || '',
        raw: p,
      });
    });
    (obra.movimientos || []).forEach(mov => {
      (mov.paseHistory || []).forEach(p => {
        rows.push({
          date: p.date || p.at || null,
          day: aiLocalDateKey(p.date || p.at),
          time: aiTimeLabel(p.date || p.at),
          obraId: obra.id,
          movId: mov.id,
          obra: obra.name,
          compositor: obra.composer || '',
          movimiento: mov.name,
          tipo: typeof normalizePaseTipo === 'function' ? normalizePaseTipo(p.tipo) : (p.tipo || ''),
          score: p.score != null ? p.score : null,
          resultado: aiPaseResultLabel(p.score),
          solidezPct: p.solidezPct != null ? p.solidezPct : (p.score != null && typeof paseScoreToPct === 'function' ? paseScoreToPct(p.score) : null),
          nota: p.note || p.nota || '',
          raw: p,
        });
      });
    });
  });
  return rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function aiBuildStudyRows() {
  const rows = [];
  const addPlant = (p, sourceName) => {
    if (!p || !p.startedAt) return;
    const names = aiObraName(p.obraId, p.movId);
    rows.push({
      day: aiLocalDateKey(p.startedAt),
      start: p.startedAt,
      end: p.endedAt || null,
      timeRange: aiTimeLabel(p.startedAt) + (p.endedAt ? '-' + aiTimeLabel(p.endedAt) : ''),
      minutes: Number(p.mins || p.min || p.minutes || 0) || 0,
      obraId: p.obraId || null,
      movId: p.movId || null,
      obra: names.obra,
      compositor: names.compositor || '',
      movimiento: names.movimiento,
      label: names.label,
      source: p.source || sourceName,
      failed: !!p.failed,
      rest: p.obraId === '_rest_' || p.tipo === 'descanso',
      notes: Array.isArray(p.notes) ? p.notes.map(cronoNormalizeSessionNote).filter(Boolean) : [],
      raw: p,
    });
  };
  (db.sessionPlants || []).forEach(p => addPlant(p, 'sessionPlants'));
  (db.forestPlants || []).forEach(p => addPlant(p, 'forestPlants'));
  return rows.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
}

function aiSessionNoteLabel(note) {
  if (!note) return 'nota';
  const bits = [];
  if (note.at) bits.push(aiTimeLabel(note.at));
  if (note.phase === 'before') bits.push('antes de empezar');
  else if (note.phase === 'after') bits.push('despues de terminar');
  else if (note.minute != null) bits.push('minuto ' + note.minute);
  else if (note.phaseLabel) bits.push(note.phaseLabel);
  return bits.filter(Boolean).join(' · ') || 'nota';
}

function aiBuildSessionCards() {
  return (db.sesiones || []).map(s => ({
    date: s.date,
    day: aiLocalDateKey(s.date),
    label: aiDateLabel(s.date),
    totalMinutes: aiStudyMinutesFromSession(s),
    estado: s.estado || null,
    sueno: s.sueno != null ? s.sueno : null,
    rating: s.rating != null ? s.rating : null,
    items: (s.items || []).map(it => ({
      obraId: it.obraId || it._obraId || null,
      movId: it.movId || it._movId || null,
      obraName: it.obraName || it.name || '',
      tick: it.tick || '',
      minutes: it.minutosReales != null ? it.minutosReales : (it.minReal != null ? it.minReal : it.minutosPlan),
      rating: it.rating != null ? it.rating : null,
      note: it.note || '',
      destello: !!it.destello,
      destelloNota: it.destelloNota || it.destelloTexto || '',
      raw: it,
    })),
    raw: s,
  })).sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function aiBuildObraRows() {
  return (db.obras || []).map(obra => ({
    id: obra.id,
    name: obra.name,
    composer: obra.composer || '',
    tipo: obra.tipo || 'obra',
    fase: typeof obraFase === 'function' ? obraFase(obra) : null,
    minutesTotal: typeof getTotalMinutosObra === 'function' ? getTotalMinutosObra(obra.id) : null,
    lastPase: obra.lastPase || null,
    paseCount: (obra.paseHistory || []).length,
    lastSolHistory: (obra.solHistory || []).slice(0, 12),
    movimientos: (obra.movimientos || []).map(mov => ({
      id: mov.id,
      name: mov.name,
      lastPase: mov.lastPase || null,
      paseCount: (mov.paseHistory || []).length,
      lastSolHistory: (mov.solHistory || []).slice(0, 12),
    })),
    pasajes: (obra.pasajes || []).map(p => ({
      id: p.id,
      text: p.text,
      status: p.status || '',
      sesiones: p.sesiones || [],
      workHistory: p.workHistory || [],
      solHistory: p.solHistory || [],
    })),
  }));
}

function aiBuildPasajeRows() {
  const rows = [];
  const pushRow = (row) => {
    if (!row || !row.date) return;
    rows.push(Object.assign({
      day: aiLocalDateKey(row.date),
      time: aiTimeLabel(row.date),
    }, row));
  };

  (db.obras || []).forEach(obra => {
    (obra.pasajes || []).forEach(p => {
      const currentSol = (p.solHistory || [])[0]?.val ?? null;
      const base = {
        obraId: obra.id,
        obra: obra.name,
        compositor: obra.composer || '',
        pasajeId: p.id,
        pasaje: p.text || p.id,
        estadoActual: p.status || 'activo',
        solidezActualPct: currentSol,
      };

      (p.workHistory || []).forEach(w => pushRow(Object.assign({}, base, {
        date: w.date,
        source: 'workHistory',
        tipoEntrada: 'trabajo',
        intensidad: w.intensidad || '',
        solAntes: w.solAntes ?? null,
        solDespues: w.solDespues ?? null,
        raw: w,
      })));

      (p.sesiones || []).forEach(s => pushRow(Object.assign({}, base, {
        date: s.date,
        source: 'pasaje.sesiones',
        tipoEntrada: 'sesion-pasaje',
        score: s.score ?? null,
        tempoAct: s.tempoAct ?? s.tempo ?? null,
        tempoObj: s.tempoObj ?? null,
        nota: s.nota || s.note || '',
        raw: s,
      })));

      (p.memLapses || []).forEach(m => pushRow(Object.assign({}, base, {
        date: m.date,
        source: 'memLapses',
        tipoEntrada: 'fallo-memoria',
        nota: m.nota || m.note || '',
        raw: m,
      })));
    });
  });

  (db.sesiones || []).forEach(sesion => {
    const aggregate = sesion._aggregate || {};
    Object.values(aggregate).forEach(agg => {
      (agg && agg.subsessions || []).forEach(sub => {
        (sub.pasajes || []).forEach(p => {
          const date = sub.endedAt || sub.timestamp || sesion.date;
          const obra = (db.obras || []).find(o => (o.pasajes || []).some(pp => pp.id === p.id));
          const pasaje = obra ? (obra.pasajes || []).find(pp => pp.id === p.id) : null;
          pushRow({
            date,
            source: 'sesion._aggregate',
            tipoEntrada: 'subsesion',
            obraId: obra ? obra.id : null,
            obra: obra ? obra.name : '',
            compositor: obra ? (obra.composer || '') : '',
            pasajeId: p.id,
            pasaje: p.nombre || (pasaje ? pasaje.text : p.id),
            estadoActual: pasaje ? (pasaje.status || 'activo') : '',
            solidezActualPct: pasaje && (pasaje.solHistory || [])[0] ? pasaje.solHistory[0].val : null,
            intensidad: p.intensidad || '',
            minutes: sub.min || null,
            raw: p,
          });
        });
      });
    });
  });

  return rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function aiBuildEventosRows() {
  return (db.eventos || []).map(ev => {
    const readiness = typeof computeEventoReadiness === 'function' ? computeEventoReadiness(ev) : null;
    const detailById = new Map((readiness?.detalles || []).map(d => [d.obraId, d]));
    const obrasDetalle = (ev.obras || [])
      .map(id => findObra(id))
      .filter(Boolean)
      .map(obra => aiBuildEventoObraStatus(obra, detailById.get(obra.id)))
      .filter(Boolean);
    return {
      id: ev.id,
      nombre: ev.nombre || '',
      tipo: ev.tipo || '',
      fecha: ev.fecha || '',
      dias: aiDaysUntil(ev.fecha),
      completado: !!ev.completado,
      obras: (ev.obras || []).map(id => aiObraName(id).label),
      obrasDetalle,
      preparacionGlobalPct: readiness?.global ?? null,
      raw: ev,
    };
  }).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

function aiBuildDailyRows() {
  const studyRows = aiBuildStudyRows();
  const sessionCards = aiBuildSessionCards();
  const paseRows = aiBuildPaseRows();
  const pasajeRows = aiBuildPasajeRows();
  const estadoEventos = ensureEstadoEventos ? ensureEstadoEventos() : (db.estadoEventos || []);
  const deporteEventos = ensureDeporteEventos ? ensureDeporteEventos() : (db.deporteEventos || []);
  const suenoEventos = ensureSuenoEventos ? ensureSuenoEventos() : (db.suenoEventos || []);
  const triggerEventos = ensureTriggerEventos ? ensureTriggerEventos() : (db.triggerEventos || []);
  const tiempoDisponibleEventos = ensureTiempoDisponibleEventos ? ensureTiempoDisponibleEventos() : (db.tiempoDisponibleEventos || []);
  const dailyJournalEntries = ensureDailyJournalEntries ? ensureDailyJournalEntries() : (db.dailyJournalEntries || []);
  const keys = new Set();
  [studyRows, sessionCards, paseRows, pasajeRows, estadoEventos, deporteEventos, suenoEventos, triggerEventos, tiempoDisponibleEventos, dailyJournalEntries].forEach(arr => {
    (arr || []).forEach(x => {
      const k = x.day || aiLocalDateKey(x.date || x.at || x.start || x.startedAt);
      if (k) keys.add(k);
    });
  });
  return Array.from(keys).sort().map(day => {
    const dayStudies = studyRows.filter(x => x.day === day);
    const totalStudy = dayStudies.filter(x => !x.failed && !x.rest).reduce((s, x) => s + (Number(x.minutes) || 0), 0);
    const tiempoDia = (tiempoDisponibleEventos || [])
      .filter(x => (x.date === new Date(day + 'T12:00:00').toDateString()) || aiLocalDateKey(x.at) === day)
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    return {
      day,
      label: aiDateLabel(day + 'T12:00:00'),
      totalStudyMinutes: totalStudy,
      studyBlocks: dayStudies,
      sessionCards: sessionCards.filter(x => x.day === day),
      pases: paseRows.filter(x => x.day === day),
      pasajes: pasajeRows.filter(x => x.day === day),
      estadoEventos: (estadoEventos || []).filter(x => (x.date === new Date(day + 'T12:00:00').toDateString()) || aiLocalDateKey(x.at) === day),
      deporteEventos: (deporteEventos || []).filter(x => (x.date === new Date(day + 'T12:00:00').toDateString()) || aiLocalDateKey(x.at) === day),
      suenoEventos: (suenoEventos || []).filter(x => (x.date === new Date(day + 'T12:00:00').toDateString()) || aiLocalDateKey(x.at) === day),
      triggerEventos: (triggerEventos || []).filter(x => (x.date === new Date(day + 'T12:00:00').toDateString()) || aiLocalDateKey(x.at) === day),
      tiempoDisponible: tiempoDia.length ? tiempoDia[tiempoDia.length - 1] : null,
      journalEntries: (dailyJournalEntries || [])
        .filter(x => (x.day || aiLocalDateKey(x.at || x.date)) === day)
        .sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))),
    };
  });
}

function buildAiDataPackage() {
  const daily = aiBuildDailyRows();
  const packageData = {
    schema: 'alberto-piano-ai-context-v1',
    appVersion: APP_VERSION,
    exportDate: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    guidance: {
      purpose: 'Paquete para que una IA o Codex pueda analizar el estudio sin acceder directamente al localStorage.',
      priorityRule: 'Las prioridades deben derivarse de datos introducidos por el usuario: notas, pases, eventos, sueño, ánimo, deporte, gatillos, tiempo disponible bruto y tiempo registrado. No inventar recomendaciones como si fueran datos.',
      privacy: 'Incluye notas privadas y datos personales de estudio.',
    },
    counts: {
      obras: (db.obras || []).length,
      sesiones: (db.sesiones || []).length,
      studyBlocks: (db.sessionPlants || []).length + (db.forestPlants || []).length,
      pases: aiBuildPaseRows().length,
      pasajeEntries: aiBuildPasajeRows().length,
      estadoEventos: (ensureEstadoEventos ? ensureEstadoEventos() : (db.estadoEventos || [])).length,
      deporteEventos: (ensureDeporteEventos ? ensureDeporteEventos() : (db.deporteEventos || [])).length,
      suenoEventos: (ensureSuenoEventos ? ensureSuenoEventos() : (db.suenoEventos || [])).length,
      triggerEventos: (ensureTriggerEventos ? ensureTriggerEventos() : (db.triggerEventos || [])).length,
      tiempoDisponibleDias: (ensureTiempoDisponibleEventos ? ensureTiempoDisponibleEventos() : (db.tiempoDisponibleEventos || [])).length,
      dailyJournalEntries: (ensureDailyJournalEntries ? ensureDailyJournalEntries() : (db.dailyJournalEntries || [])).length,
      eventos: (db.eventos || []).length,
    },
    daily,
    obras: aiBuildObraRows(),
    eventos: aiBuildEventosRows(),
    rawData: db,
    localMirrors: {
      estadoEventos: aiReadLocalJson('alberto_estado_eventos_v1'),
      deporteEventos: aiReadLocalJson('alberto_deporte_eventos_v1'),
      suenoEventos: aiReadLocalJson('alberto_sueno_eventos_v1'),
      triggerEventos: aiReadLocalJson('alberto_trigger_eventos_v1'),
      tiempoDisponibleEventos: aiReadLocalJson('alberto_tiempo_disponible_v1'),
    },
  };
  return packageData;
}

let aiExportSelectedDays = [];
let aiExportRangeMode = (function() {
  try { return localStorage.getItem('alberto_ai_export_range_v1') || 'today'; } catch(e) { return 'today'; }
})();
let aiExportContextMode = (function() {
  try { return localStorage.getItem('alberto_ai_export_context_v1') || 'context'; } catch(e) { return 'context'; }
})();

function aiUniqueSortedDates(dates) {
  return Array.from(new Set((dates || [])
    .map(d => String(d || '').trim())
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))))
    .sort();
}

function aiDateKeyOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(offset) || 0));
  return aiLocalDateKey(d);
}

function aiContextModeValue(value) {
  return value === 'data' ? 'data' : 'context';
}

function setAiExportRange(range) {
  const allowed = ['today', 'yesterday', 'today_yesterday', '3', 'selected'];
  aiExportRangeMode = allowed.includes(String(range)) ? String(range) : 'today';
  try { localStorage.setItem('alberto_ai_export_range_v1', aiExportRangeMode); } catch(e) {}
  if (aiExportRangeMode === 'selected' && !aiExportSelectedDays.length) {
    const input = document.getElementById('aiExportDate');
    aiExportSelectedDays = [input?.value || aiTodayKey()];
  }
  updateAiExportControls();
}

function setAiExportContext(mode) {
  aiExportContextMode = aiContextModeValue(mode);
  try { localStorage.setItem('alberto_ai_export_context_v1', aiExportContextMode); } catch(e) {}
  updateAiExportControls();
}

function aiNormalizeTextReportOptions(input) {
  if (typeof input === 'number') return { mode: 'recent', days: input, contextMode: aiContextModeValue(aiExportContextMode) };
  const opts = input || {};
  const contextMode = aiContextModeValue(opts.contextMode || opts.context || aiExportContextMode);
  if (opts.mode === 'today') return { mode: 'today', date: aiTodayKey(), label: opts.label || 'Hoy hasta ahora', contextMode };
  if (opts.mode === 'yesterday') return { mode: 'selected', dates: [aiDateKeyOffset(-1)], label: opts.label || 'Ayer', contextMode };
  if (opts.mode === 'today_yesterday') return { mode: 'selected', dates: [aiDateKeyOffset(-1), aiTodayKey()], label: opts.label || 'Hoy + ayer', contextMode };
  if (opts.mode === 'day') return { mode: 'day', date: opts.date || aiTodayKey(), label: opts.label || 'Dia concreto', contextMode };
  if (opts.mode === 'selected') {
    const dates = aiUniqueSortedDates((opts.dates && opts.dates.length) ? opts.dates : [opts.date || aiTodayKey()]);
    return { mode: 'selected', dates: dates.length ? dates : [aiTodayKey()], label: opts.label || 'Dias seleccionados', contextMode };
  }
  return { mode: 'recent', days: Math.max(1, parseInt(opts.days || opts.maxDays || 14, 10) || 14), label: opts.label || 'Ultimos dias', contextMode };
}

function aiRequestedReportDates(opts) {
  opts = aiNormalizeTextReportOptions(opts);
  if (opts.mode === 'today') return [aiTodayKey()];
  if (opts.mode === 'day') return [opts.date || aiTodayKey()];
  if (opts.mode === 'selected') return aiUniqueSortedDates(opts.dates);
  return [];
}

function aiReportRangeLabel(opts) {
  opts = aiNormalizeTextReportOptions(opts);
  if (opts.label) return opts.label;
  if (opts.mode === 'today') return 'hoy hasta ahora';
  if (opts.mode === 'day') return 'día ' + (opts.date || aiTodayKey());
  if (opts.mode === 'selected') {
    const dates = aiUniqueSortedDates(opts.dates);
    return dates.length ? ('días seleccionados: ' + dates.join(', ')) : 'días seleccionados';
  }
  return 'últimos ' + opts.days + ' días';
}

function aiGetSelectedTextReportOptions() {
  const sel = document.getElementById('aiExportRange');
  const dateInput = document.getElementById('aiExportDate');
  const contextMode = aiContextModeValue(aiExportContextMode);
  const val = aiExportRangeMode || (sel ? sel.value : 'today');
  if (val === 'today') return { mode: 'today', contextMode, label: 'Hoy hasta ahora' };
  if (val === 'yesterday') return { mode: 'selected', dates: [aiDateKeyOffset(-1)], contextMode, label: 'Ayer' };
  if (val === 'today_yesterday') return { mode: 'selected', dates: [aiDateKeyOffset(-1), aiTodayKey()], contextMode, label: 'Hoy + ayer' };
  if (val === 'selected') return { mode: 'selected', dates: aiExportSelectedDays.length ? aiExportSelectedDays.slice() : [dateInput?.value || aiTodayKey()], contextMode, label: 'Dias elegidos' };
  if (val === 'day') return { mode: 'day', date: dateInput?.value || aiTodayKey(), contextMode, label: 'Dia concreto' };
  const n = parseInt(val || '3', 10) || 3;
  return { mode: 'recent', days: n, contextMode, label: 'Ultimos ' + n + ' dias' };
}

function aiRangeFileSuffix(opts) {
  opts = aiNormalizeTextReportOptions(opts);
  if (opts.mode === 'today') return 'hoy-' + aiTodayKey();
  if (opts.mode === 'day') return 'dia-' + (opts.date || aiTodayKey());
  if (opts.mode === 'selected') {
    const dates = aiUniqueSortedDates(opts.dates);
    if (!dates.length) return 'dias-seleccionados-' + aiTodayKey();
    return 'dias-' + dates[0] + (dates.length > 1 ? '_a_' + dates[dates.length - 1] + '-' + dates.length + 'd' : '');
  }
  return 'ultimos-' + opts.days + 'd-' + aiTodayKey();
}

function aiFormatSelectedDateChip(date) {
  return date === aiTodayKey() ? 'Hoy · ' + date : aiDateLabel(date + 'T12:00:00');
}

function renderAiExportSelectedDays() {
  const box = document.getElementById('aiExportSelectedDays');
  if (!box) return;
  if (!aiExportSelectedDays.length) {
    box.innerHTML = '<span class="ai-export-day-empty">Añade días desde el calendario.</span>';
    return;
  }
  box.innerHTML = aiExportSelectedDays.map(date => `
    <span class="ai-export-day-chip">
      ${escapeHtmlSafe(aiFormatSelectedDateChip(date))}
      <button type="button" onclick="removeAiExportSelectedDate('${date}')" aria-label="Quitar ${date}">×</button>
    </span>
  `).join('');
}

function addAiExportSelectedDate(date) {
  const input = document.getElementById('aiExportDate');
  const selected = date || input?.value || aiTodayKey();
  aiExportRangeMode = 'selected';
  aiExportSelectedDays = aiUniqueSortedDates(aiExportSelectedDays.concat(selected));
  if (input) input.value = selected;
  updateAiExportControls();
}

function removeAiExportSelectedDate(date) {
  aiExportSelectedDays = aiExportSelectedDays.filter(d => d !== date);
  renderAiExportSelectedDays();
}

function updateAiExportControls() {
  const sel = document.getElementById('aiExportRange');
  const dateInput = document.getElementById('aiExportDate');
  const addBtn = document.getElementById('aiExportAddDayBtn');
  const selectedBox = document.getElementById('aiExportSelectedDays');
  if (!dateInput) return;
  if (!dateInput.value) dateInput.value = aiTodayKey();
  let mode = aiExportRangeMode || 'today';
  if (!['today', 'yesterday', 'today_yesterday', '3', 'selected'].includes(mode)) {
    mode = 'today';
    aiExportRangeMode = mode;
  }
  if (sel) {
    sel.style.display = 'none';
    if (['today', 'day', 'selected', '3', '7', '14', '21', '30'].includes(mode)) sel.value = mode;
  }
  const showSelected = mode === 'selected';
  const showDate = showSelected;
  dateInput.style.display = showDate ? '' : 'none';
  if (addBtn) addBtn.style.display = showSelected ? '' : 'none';
  if (selectedBox) selectedBox.style.display = showSelected ? '' : 'none';
  if (showSelected && !aiExportSelectedDays.length) aiExportSelectedDays = [dateInput.value || aiTodayKey()];
  if (showSelected) renderAiExportSelectedDays();
  document.querySelectorAll('.ai-export-mode').forEach(btn => {
    if (btn.dataset.range === '3') btn.textContent = '3 dias';
    btn.classList.toggle('active', btn.dataset.range === mode);
  });
  document.querySelectorAll('.ai-export-context').forEach(btn => {
    if (btn.dataset.context === 'data') btn.textContent = 'Sin glosario';
    btn.classList.toggle('active', btn.dataset.context === aiContextModeValue(aiExportContextMode));
  });
}

function aiDayHasReportableActivity(day) {
  if (!day) return false;
  return !!(
    day.totalStudyMinutes ||
    day.studyBlocks.length ||
    day.sessionCards.length ||
    day.pases.length ||
    day.pasajes.length ||
    day.estadoEventos.length ||
    day.deporteEventos.length ||
    day.suenoEventos.length ||
    (day.triggerEventos || []).length ||
    (day.journalEntries || []).length ||
    !!day.tiempoDisponible
  );
}

function aiSelectReportDays(daily, opts) {
  opts = aiNormalizeTextReportOptions(opts);
  const desc = daily.slice().sort((a, b) => b.day.localeCompare(a.day));
  if (opts.mode === 'today' || opts.mode === 'day') {
    const date = opts.date || aiTodayKey();
    return desc.filter(day => day.day === date && aiDayHasReportableActivity(day));
  }
  if (opts.mode === 'selected') {
    const wanted = new Set(aiUniqueSortedDates(opts.dates));
    return daily.slice()
      .sort((a, b) => a.day.localeCompare(b.day))
      .filter(day => wanted.has(day.day) && aiDayHasReportableActivity(day));
  }
  return desc.filter(aiDayHasReportableActivity).slice(0, opts.days || 14);
}

function buildAiTextReport(options) {
  const opts = aiNormalizeTextReportOptions(options);
  const pkg = buildAiDataPackage();
  const days = aiSelectReportDays(pkg.daily, opts);
  const todayKey = aiTodayKey();
  const requestedDates = aiRequestedReportDates(opts);
  const lastRequestedDate = requestedDates.length ? requestedDates[requestedDates.length - 1] : '';
  const reportIncludesToday = requestedDates.includes(todayKey) || days.some(day => day.day === todayKey);
  const upcoming = pkg.eventos.filter(ev => !ev.completado && ev.dias != null && ev.dias >= 0).slice(0, 8);
  const includeContext = opts.contextMode !== 'data';
  const journalEntries = days.flatMap(day => (day.journalEntries || []).map(entry => ({
    day: day.day,
    dayLabel: day.day === todayKey ? 'HOY' : day.label,
    at: entry.at || '',
    text: entry.text || '',
  })));
  const lines = [];
  lines.push(includeContext ? 'PAQUETE DE CONTEXTO PARA IA / CODEX' : 'INFORME DE ESTUDIO PARA IA / SIN GLOSARIO');
  lines.push('Exportado: ' + aiDateLabel(pkg.exportDate) + ' ' + aiTimeLabel(pkg.exportDate));
  lines.push('Versión app: ' + APP_VERSION);
  lines.push('Fecha actual real: ' + aiDateLabel(todayKey + 'T12:00:00') + ' · ' + aiTimeLabel(pkg.exportDate));
  if (requestedDates.length) {
    lines.push('Días solicitados: ' + requestedDates.map(d => d === todayKey ? 'HOY (' + d + ')' : d).join(', '));
    lines.push('Último día solicitado: ' + (lastRequestedDate === todayKey ? 'HOY · ' : '') + aiDateLabel(lastRequestedDate + 'T12:00:00'));
  }
  lines.push('');
  lines.push('GUÍA DE LECTURA PARA LA IA');
  lines.push('- Esta app registra estudio de piano. No presupongas contexto externo: interpreta sólo lo que aparece aquí.');
  lines.push('- Bloque con hora: tramo real registrado por cronómetro/temporizador/Forest. Es el dato más fiable para saber cuándo estudié y cuánto tiempo.');
  lines.push('- Nota de sesión: observación escrita o dictada antes de empezar, en un minuto concreto del cronómetro/temporizador, o después de terminar. Es input directo del usuario; úsalo como contexto prioritario.');
  lines.push('- Tarjeta/sesión guardada: resumen diario o tarjeta de estudio. Puede incluir obra, minutos, tick, nota, destello y datos agregados de sub-sesiones.');
  lines.push('- Pase: ejecución de una obra o movimiento. Es la medida principal de solidez. Tipos: solo = para mí; informal = ante pareja/amigos; evento = audición/concurso/concierto o situación formal. Resultado: Se cae, Frágil, Sale, Sólido o Listo.');
  lines.push('- Pasaje: fragmento concreto dentro de una obra. Puede tener estado actual, intensidad de trabajo, solidez antes/después, fallos de memoria o entradas de seguimiento. Si un pasaje aparece varias veces el mismo día, trátalo como foco recurrente, no como duplicado irrelevante.');
  lines.push('- Estado/sueño/deporte/siesta/gatillos TOC/tiempo disponible: contexto corporal, mental y logístico registrado por mí. Úsalo como contexto, no como diagnóstico clínico ni como causa segura.');
  lines.push('- Tiempo disponible bruto: estimación diaria de cuánto margen teórico tuve para tocar. No equivale a horas estudiadas ni a obligación; sirve para distinguir falta real de tiempo de baja ejecución con tiempo disponible.');
  lines.push('- Eventos próximos: compromisos futuros. Pueden aumentar la relevancia de obras/pasajes, pero no inventes prioridades si no están apoyadas por datos registrados.');
  lines.push('- Regla de interpretación: distingue HECHOS registrados de LECTURAS derivadas. Si propones prioridades, deriva cada una de notas, pases, pasajes, eventos, sueño, ánimo, deporte, gatillos, tiempo disponible o tiempo registrado. No trates inferencias como hechos.');
  lines.push('- Si el último día solicitado aparece como HOY, entiende que el día puede seguir abierto y que la orientación puede ser para terminar hoy o preparar mañana según la hora y la carga ya registrada.');
  lines.push('');
  lines.push('RESUMEN GLOBAL');
  lines.push('- Obras: ' + pkg.counts.obras);
  lines.push('- Sesiones guardadas: ' + pkg.counts.sesiones);
  lines.push('- Bloques con hora: ' + pkg.counts.studyBlocks);
  lines.push('- Pases registrados: ' + pkg.counts.pases);
  lines.push('- Entradas de pasajes: ' + pkg.counts.pasajeEntries);
  lines.push('- Entradas de diario: ' + (pkg.counts.dailyJournalEntries || 0));
  lines.push('- Gatillos registrados: ' + (pkg.counts.triggerEventos || 0));
  lines.push('- Días con tiempo disponible estimado: ' + (pkg.counts.tiempoDisponibleDias || 0));
  lines.push('- Eventos próximos/pasados: ' + pkg.counts.eventos);
  lines.push('- Rango diario exportado: ' + aiReportRangeLabel(opts));
  lines.push('');
  if (journalEntries.length) {
    lines.push('ENTRADAS DEL DIARIO');
    journalEntries.forEach(entry => {
      const when = (entry.dayLabel || entry.day || '') + (entry.at ? ' · ' + aiTimeLabel(entry.at) : '');
      lines.push('- ' + when + ': "' + entry.text + '"');
    });
    lines.push('');
  }
  if (upcoming.length) {
    lines.push('EVENTOS PRÓXIMOS');
    upcoming.forEach(ev => {
      const prep = ev.preparacionGlobalPct != null ? ' · preparación global ' + ev.preparacionGlobalPct + '%' : '';
      lines.push('- ' + ev.fecha + ' · ' + ev.nombre + ' · ' + ev.tipo + ' · faltan ' + ev.dias + ' días' + prep);
      if (ev.obrasDetalle && ev.obrasDetalle.length) {
        ev.obrasDetalle.forEach(o => {
          const bits = [];
          bits.push('estado: ' + (o.estadoGeneral || 'sin estado'));
          if (o.aprendidoPct != null) bits.push('aprendido ' + o.aprendidoPct + '%');
          if (o.solidezEstimadaPct != null) bits.push('solidez estimada ' + o.solidezEstimadaPct + '%');
          if (o.preparacionEventoPct != null) bits.push('preparación evento ' + o.preparacionEventoPct + '%');
          if (o.pasajesActivos && o.pasajesActivos.length) bits.push('pasajes activos ' + o.pasajesActivos.length);
          lines.push('  - ' + o.nombre + (o.compositor && o.compositor !== '—' ? ' · ' + o.compositor : '') + ' · ' + bits.join(' · '));
          if (o.ultimoPase) {
            const up = o.ultimoPase;
            const score = up.score != null ? ' (' + up.score + '/10)' : '';
            const target = up.target && up.target !== 'obra completa' ? ' · ' + up.target : '';
            const note = up.nota ? ' · nota: "' + up.nota + '"' : '';
            lines.push('    Último pase: ' + aiDateLabel(up.date) + (up.time ? ' ' + up.time : '') + target + ' · tipo ' + (up.tipo || 'sin tipo') + ' · ' + (up.resultado || 'sin resultado') + score + note);
          } else {
            lines.push('    Último pase: sin pase registrado');
          }
        });
      } else if (ev.obras.length) {
        lines.push('  Obras: ' + ev.obras.join(' | '));
      }
    });
    lines.push('');
  }
  if (!upcoming.length) {
    lines.push('EVENTOS PRÓXIMOS');
    lines.push('- No hay eventos futuros registrados.');
    lines.push('');
  }
  lines.push(opts.mode === 'recent' ? 'DÍAS RECIENTES' : opts.mode === 'selected' ? 'DÍAS SELECCIONADOS' : 'DÍA SELECCIONADO');
  if (!days.length) {
    lines.push('');
    lines.push(opts.mode === 'today'
      ? 'No hay actividad registrada hoy hasta ahora.'
      : opts.mode === 'day'
        ? 'No hay actividad registrada para el día seleccionado.'
        : opts.mode === 'selected'
          ? 'No hay actividad registrada en los días seleccionados.'
          : 'No hay actividad registrada en el rango seleccionado.');
  }
  days.forEach(day => {
    const dayTitle = day.day === todayKey ? 'HOY · ' + day.label : day.label;
    lines.push('');
    lines.push('## ' + dayTitle + ' · total estudio: ' + aiMinutesLabel(day.totalStudyMinutes));
    if ((day.journalEntries || []).length) {
      lines.push('Diario general: ' + day.journalEntries.length + (day.journalEntries.length === 1 ? ' entrada' : ' entradas') + ' (detalle arriba).');
    }
    if (day.estadoEventos.length) {
      lines.push('Ánimo/bienestar:');
      day.estadoEventos.forEach(e => lines.push('- ' + aiTimeLabel(e.at) + ' · ' + (e.label || e.value)));
    }
    if (day.suenoEventos.length) {
      lines.push('Sueño/siestas:');
      day.suenoEventos.forEach(e => lines.push('- ' + aiTimeLabel(e.at) + ' · ' + (e.kind || 'siesta')));
    }
    if (day.deporteEventos.length) {
      lines.push('Deporte:');
      day.deporteEventos.forEach(e => lines.push('- ' + aiTimeLabel(e.at) + ' · ' + (e.kind || '') + ' · ' + (e.label || e.level || e.value)));
    }
    if (day.tiempoDisponible) {
      const t = day.tiempoDisponible;
      const hour = t.at ? (' · registrado ' + aiTimeLabel(t.at)) : '';
      lines.push('Tiempo disponible bruto:');
      lines.push('- nivel ' + (t.level || '') + ' · ' + (t.label || t.value || 'sin etiqueta') + (t.range ? ' · ' + t.range : '') + hour);
    }
    if ((day.triggerEventos || []).length) {
      lines.push('Gatillos TOC:');
      day.triggerEventos.forEach(e => lines.push('- ' + aiTimeLabel(e.at) + ' · nivel ' + (e.level || '') + ' · ' + (e.label || e.value || 'gatillo')));
    }
    if (day.studyBlocks.length) {
      lines.push('Bloques de estudio con hora:');
      day.studyBlocks.forEach(b => {
        const flags = b.failed ? ' · fallida' : (b.rest ? ' · descanso' : '');
        const notes = Array.isArray(b.notes) ? b.notes : [];
        lines.push('- ' + (b.timeRange || '') + ' · ' + b.label + ' · ' + aiMinutesLabel(b.minutes) + flags + (notes.length ? ' · notas ' + notes.length : ''));
        notes.forEach(note => {
          if (!note || !note.text) return;
          lines.push('  - nota ' + aiSessionNoteLabel(note) + ': "' + note.text + '"');
        });
      });
    }
    if (day.sessionCards.length) {
      lines.push('Tarjetas/sesiones guardadas:');
      day.sessionCards.forEach(s => {
        lines.push('- Sesión · ' + aiMinutesLabel(s.totalMinutes) + (s.rating != null ? ' · productividad ' + s.rating : ''));
        s.items.forEach(it => {
          const note = it.note ? ' · nota: "' + it.note + '"' : '';
          const dest = it.destelloNota ? ' · destello: "' + it.destelloNota + '"' : '';
          lines.push('  - ' + (it.obraName || aiObraName(it.obraId, it.movId).label) + ' · ' + (it.tick || 'sin tick') + ' · ' + aiMinutesLabel(it.minutes) + note + dest);
        });
      });
    }
    if (day.pasajes.length) {
      lines.push('Pasajes trabajados / registrados:');
      const seenPasajes = new Set();
      day.pasajes.forEach(p => {
        const key = [p.pasajeId, p.tipoEntrada, p.date, p.intensidad || '', p.score ?? '', p.solAntes ?? '', p.solDespues ?? ''].join('|');
        if (seenPasajes.has(key)) return;
        seenPasajes.add(key);
        const parts = [];
        if (p.time) parts.push(p.time);
        if (p.obra) parts.push(p.obra);
        parts.push(p.pasaje || p.pasajeId || 'pasaje');
        parts.push('estado actual: ' + (p.estadoActual || 'sin estado'));
        if (p.intensidad) parts.push('intensidad: ' + p.intensidad);
        if (p.solAntes != null || p.solDespues != null) {
          parts.push('solidez pasaje: ' + (p.solAntes != null ? p.solAntes + '%' : '?') + '→' + (p.solDespues != null ? p.solDespues + '%' : '?'));
        } else if (p.solidezActualPct != null) {
          parts.push('solidez pasaje actual: ' + p.solidezActualPct + '%');
        }
        if (p.score != null) parts.push('score pasaje: ' + p.score);
        if (p.tempoAct != null || p.tempoObj != null) parts.push('tempo: ' + (p.tempoAct || '?') + '/' + (p.tempoObj || '?'));
        if (p.minutes != null) parts.push(aiMinutesLabel(p.minutes));
        if (p.tipoEntrada === 'fallo-memoria') parts.push('fallo de memoria');
        if (p.nota) parts.push('nota: "' + p.nota + '"');
        lines.push('- ' + parts.join(' · '));
      });
    }
    if (day.pases.length) {
      lines.push('Pases:');
      day.pases.forEach(p => {
        const mov = p.movimiento ? ' · ' + p.movimiento : '';
        const note = p.nota ? ' · nota: "' + p.nota + '"' : '';
        lines.push('- ' + (p.time || '') + ' · ' + p.obra + mov + ' · tipo ' + (p.tipo || 'sin tipo') + ' · ' + (p.resultado || ('score ' + p.score)) + note);
      });
    }
    const fragilePases = day.pases.filter(p => p.score != null && p.score <= 4);
    const fragilePasajes = day.pasajes.filter(p =>
      p.tipoEntrada === 'fallo-memoria' ||
      (p.score != null && p.score <= 4) ||
      /fragil|frágil|activo|memoria|fall/i.test(p.estadoActual || '') ||
      /cae|fr[aá]gil|insegur|duda|tensi[oó]n|mal|memoria|fall/i.test(p.nota || '')
    );
    const notes = [];
    day.sessionCards.forEach(s => s.items.forEach(it => { if (it.note) notes.push(it.note); }));
    const weakNotes = notes.filter(n => /cae|fr[aá]gil|insegur|duda|tensi[oó]n|mal|memoria|fall/i.test(n));
    if (fragilePases.length || fragilePasajes.length || weakNotes.length) {
      lines.push('Lectura derivada de mis datos:');
      fragilePases.forEach(p => lines.push('- Pase frágil: ' + p.obra + (p.movimiento ? ' · ' + p.movimiento : '') + ' (' + (p.resultado || p.score) + ').'));
      fragilePasajes.slice(0, 8).forEach(p => lines.push('- Pasaje a vigilar: ' + (p.obra ? p.obra + ' · ' : '') + (p.pasaje || p.pasajeId) + ' (' + (p.estadoActual || p.tipoEntrada || 'registrado') + ').'));
      weakNotes.slice(0, 5).forEach(n => lines.push('- Nota sensible: "' + n + '"'));
    }
  });
  lines.push('');
  lines.push('PETICIÓN SUGERIDA A LA IA');
  if (reportIncludesToday) {
    lines.push('Con esta información, ayúdame primero a decidir qué hacer con lo que queda de HOY. No asumas que el día está cerrado sólo porque el texto sea un resumen.');
    lines.push('Si por la hora actual, el tiempo disponible bruto, la carga ya registrada, el sueño, el ánimo, el deporte, los gatillos o las notas parece que aún queda margen razonable, propón un cierre o continuación breve para hoy: obras/pasajes/pases concretos, duración aproximada, criterio de cierre y cuándo parar.');
    lines.push('Si por la hora o por la carga parece que probablemente ya he terminado, entonces sugiere una forma de cerrar el día y preparar mañana. En ambos casos, basa las prioridades sólo en mis datos registrados y distingue hechos de inferencias.');
  } else {
    lines.push('Con esta información, ayúdame a preparar mañana. Basa las prioridades sólo en mis datos registrados: pases, notas, bloques de estudio, sueño, ánimo, deporte, tiempo disponible, siestas, gatillos y eventos próximos. Distingue hechos de inferencias.');
  }
  let text = lines.join('\n');
  if (!includeContext) {
    text = text.replace(/\nGU[\s\S]*?\nRESUMEN GLOBAL/, '\nRESUMEN GLOBAL');
  }
  return text.trimEnd();
}

function exportarDatosIA() {
  const payload = buildAiDataPackage();
  const fecha = new Date().toISOString().slice(0, 10);
  aiDownloadText('alberto-piano-ia-codex-' + fecha + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  aiExportFeedback('JSON para IA descargado');
}

function descargarResumenIA() {
  const opts = aiGetSelectedTextReportOptions();
  aiDownloadText('alberto-piano-resumen-ia-' + aiRangeFileSuffix(opts) + '.txt', buildAiTextReport(opts), 'text/plain;charset=utf-8');
  aiExportFeedback('Resumen TXT descargado');
}

async function copiarDatosIA() {
  const opts = aiGetSelectedTextReportOptions();
  const text = buildAiTextReport(opts);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    aiExportFeedback('Texto IA copiado');
  } catch(e) {
    descargarResumenIA();
    aiExportFeedback('No se pudo copiar; he descargado el TXT', 'var(--orange)');
  }
}

function importarDatos(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      // Acepta tanto el formato con envelope {version, data} como el raw db
      const incoming = parsed.data || parsed;
      if (!incoming.obras) throw new Error('Formato no reconocido');

      const nObras    = (incoming.obras    || []).length;
      const nSesiones = (incoming.sesiones || []).length;
      const nEventos  = (incoming.eventos  || []).length;

      const msg = `¿Importar backup?\n\n${nObras} obras · ${nSesiones} sesiones · ${nEventos} eventos\n\nEsto reemplazará todos los datos actuales.`;
      if (!confirm(msg)) { input.value = ''; return; }

      db = {
        obras:    incoming.obras    || [],
        sesiones: incoming.sesiones || [],
        eventos:  incoming.eventos  || [],
        registro: incoming.registro || []
      };
      saveData();
      closeModal('modalSettings');
      showView('obras');
      showToast(`Importado: ${nObras} obras, ${nSesiones} sesiones ✓`);
    } catch(err) {
      const fb = document.getElementById('importarFeedback');
      fb.textContent = 'Error al leer el archivo: ' + err.message;
      fb.style.color = 'var(--red)';
      fb.style.display = 'block';
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// ─── EDIT OBRA COMPLETA ──────────────────────────────────────────────────────

let editObraMovDraft = [];
let editObraMovDraftObraId = null;

function editObraNumberFromInput(inputOrId, min, max) {
  const el = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
  if (!el) return null;
  const raw = String(el.value || '').trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, max != null ? Math.min(max, n) : n);
}

function editObraCloneMovement(mov) {
  try {
    return JSON.parse(JSON.stringify(mov || {}));
  } catch (err) {
    return { ...(mov || {}) };
  }
}

function editObraJsArg(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function editObraSyncMovDraftFromDom() {
  const list = document.getElementById('editObraMovimientosList');
  if (!list) return;
  const previous = new Map(editObraMovDraft.map(m => [String(m.id), m]));
  editObraMovDraft = Array.from(list.querySelectorAll('.edit-obra-mov-row')).map((row, idx) => {
    const id = row.dataset.movId || ('mv' + Date.now() + '_' + idx);
    const base = previous.get(String(id)) || {};
    const out = {
      ...base,
      id,
      name: (row.querySelector('.edit-mov-name')?.value || '').trim() || defaultMovimientoName(idx + 1),
      duracion: editObraNumberFromInput(row.querySelector('.edit-mov-duracion'), 1, 240),
      dificultad: editObraNumberFromInput(row.querySelector('.edit-mov-dificultad'), 1, 10),
      compasActual: editObraNumberFromInput(row.querySelector('.edit-mov-compas-actual'), 0, 99999),
      compasesTotal: editObraNumberFromInput(row.querySelector('.edit-mov-compases-total'), 1, 99999),
    };
    if (out.compasesTotal && out.compasActual != null && out.compasActual > out.compasesTotal) {
      out.compasActual = out.compasesTotal;
    }
    markMovimientoLearnedIfNoCompases(out);
    if (!Array.isArray(out.paseHistory)) out.paseHistory = [];
    if (!Array.isArray(out.solHistory)) out.solHistory = [];
    return out;
  });
}

function renderEditObraMovimientos() {
  const list = document.getElementById('editObraMovimientosList');
  if (!list) return;
  if (!editObraMovDraft.length) {
    list.innerHTML = '<div class="edit-obra-empty">Sin movimientos. Puedes dejar la obra completa o añadirlos aquí.</div>';
    return;
  }
  list.innerHTML = editObraMovDraft.map((mov, idx) => {
    const id = mov.id || ('mv' + Date.now() + '_' + idx);
    const jsId = editObraJsArg(id);
    return `
      <div class="edit-obra-mov-row" data-mov-id="${escapeHtmlSafe(id)}">
        <div class="edit-obra-mov-top">
          <input class="modal-input edit-obra-mov-name edit-mov-name" type="text" value="${escapeHtmlSafe(mov.name || defaultMovimientoName(idx + 1))}" placeholder="${defaultMovimientoName(idx + 1)}">
          <div class="edit-obra-mov-actions">
            <button type="button" onclick="editObraRegisterPase('${jsId}')">Pase con fecha</button>
            <button type="button" class="danger" onclick="editObraDeleteMovimiento('${jsId}')">Quitar</button>
          </div>
        </div>
        <div class="edit-obra-mov-grid">
          <div>
            <div class="edit-obra-label">Duración</div>
            <input class="modal-input edit-obra-mini edit-mov-duracion" type="number" min="1" max="240" value="${mov.duracion || ''}" placeholder="min">
          </div>
          <div>
            <div class="edit-obra-label">Dificultad</div>
            <input class="modal-input edit-obra-mini edit-mov-dificultad" type="number" min="1" max="10" step="1" value="${mov.dificultad || ''}" placeholder="1-10">
          </div>
          <div>
            <div class="edit-obra-label">Compás actual</div>
            <input class="modal-input edit-obra-mini edit-mov-compas-actual" type="number" min="0" value="${mov.compasActual || ''}" placeholder="0">
          </div>
          <div>
            <div class="edit-obra-label">Compases total</div>
            <input class="modal-input edit-obra-mini edit-mov-compases-total" type="number" min="1" value="${mov.compasesTotal || ''}" placeholder="total">
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openEditObraNombre(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  editObraMovDraftObraId = obraId;
  editObraMovDraft = (obra.movimientos || []).map(editObraCloneMovement);
  document.getElementById('editObraId').value = obraId;
  document.getElementById('editObraNombreInput').value = obra.name || '';
  document.getElementById('editObraComposerInput').value = obra.composer === '—' ? '' : (obra.composer || '');
  document.getElementById('editObraDuracionInput').value = obra.duracion || '';
  document.getElementById('editObraDificultadInput').value = obra.dificultad || '';
  document.getElementById('editObraCompasActualInput').value = obra.compasActual || '';
  document.getElementById('editObraCompasesTotalInput').value = obra.compasesTotal || '';
  renderEditObraMovimientos();
  openModal('modalEditObraNombre');
  setTimeout(() => document.getElementById('editObraNombreInput').focus(), 100);
}

function editObraAddMovimiento() {
  editObraSyncMovDraftFromDom();
  const obra = findObra(editObraMovDraftObraId || document.getElementById('editObraId')?.value);
  const num = editObraMovDraft.length + 1;
  editObraMovDraft.push({
    id: 'mv' + Date.now(),
    name: defaultMovimientoName(num),
    duracion: null,
    dificultad: obra?.dificultad || 3,
    apr: 10,
    sol: obra?.sol || 1,
    esc: obra?.esc || 1,
    lastPase: null,
    paseHistory: [],
    solHistory: [],
    compasHistory: [],
  });
  renderEditObraMovimientos();
}

function editObraDeleteMovimiento(movId) {
  editObraSyncMovDraftFromDom();
  editObraMovDraft = editObraMovDraft.filter(m => String(m.id) !== String(movId));
  renderEditObraMovimientos();
}

function applyEditObraModalChanges(opts) {
  opts = opts || {};
  const obraId = document.getElementById('editObraId').value;
  const nombre = document.getElementById('editObraNombreInput').value.trim();
  const composer = document.getElementById('editObraComposerInput').value.trim();
  if (!nombre) { showToast('El titulo no puede estar vacio'); return false; }
  const obra = findObra(obraId);
  if (!obra) return false;

  editObraSyncMovDraftFromDom();
  obra.name = nombre;
  obra.composer = obra.tipo === 'actividad' ? composer : (composer || '\u2014');
  obra.duracion = editObraNumberFromInput('editObraDuracionInput', 1, 240);
  obra.dificultad = editObraNumberFromInput('editObraDificultadInput', 1, 10);
  obra.compasActual = editObraNumberFromInput('editObraCompasActualInput', 0, 99999);
  obra.compasesTotal = editObraNumberFromInput('editObraCompasesTotalInput', 1, 99999);
  if (obra.compasesTotal && obra.compasActual != null && obra.compasActual > obra.compasesTotal) {
    obra.compasActual = obra.compasesTotal;
  }
  obra.apr = aprFromCompas(obra);
  obra.movimientos = editObraMovDraft.map((mov, idx) => markMovimientoLearnedIfNoCompases({
    ...mov,
    id: mov.id || ('mv' + Date.now() + '_' + idx),
    name: (mov.name || '').trim() || defaultMovimientoName(idx + 1),
  }));
  syncObraDurationFromMovimientos(obra);

  (db.sesiones || []).forEach(s => {
    (s.items || []).forEach(it => {
      if (it.obraId !== obraId) return;
      if (it.movId) {
        const mov = obra.movimientos.find(m => m.id === it.movId);
        it.obraName = mov ? (nombre + ' \u00b7 ' + mov.name) : nombre;
      } else {
        it.obraName = nombre;
      }
    });
  });

  saveData();
  rerenderObraCard(obraId);
  if (opts.close) closeModal('modalEditObraNombre');
  if (opts.toast) showToast('Obra actualizada');
  return true;
}

function editObraRegisterPase(movId) {
  const obraId = document.getElementById('editObraId').value;
  if (!applyEditObraModalChanges({ close: false, toast: false })) return;
  closeModal('modalEditObraNombre');
  registerPase(obraId, movId || null);
}

function saveEditObraNombre() {
  applyEditObraModalChanges({ close: true, toast: true });
}

function confirmDeleteObra(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  if (!confirm(`¿Eliminar "${obra.name}"?`)) return;
  const idx = (db.obras || []).indexOf(obra);
  const eventoIds = (db.eventos || []).filter(ev => (ev.obras || []).includes(obraId)).map(ev => ev.id);
  deleteObra(obraId);
  showUndoToast('Obra eliminada: ' + obra.name, () => {
    if (findObra(obraId)) return;
    const at = idx >= 0 ? Math.min(idx, db.obras.length) : db.obras.length;
    db.obras.splice(at, 0, obra);
    eventoIds.forEach(eid => {
      const ev = (db.eventos || []).find(e => e.id === eid);
      if (ev) { if (!ev.obras) ev.obras = []; if (!ev.obras.includes(obraId)) ev.obras.push(obraId); }
    });
    saveData();
    renderObras();
    showToast('Obra restaurada ✓');
  }, 8000);
}

// ─── SESIÓN MANUAL ─────────────────────────────────────────────────────────

let manualTickSelected = null;

function openSesionManual() {
  openStudyRegister('history');
  return;
  // Populate obra select
  const sel = document.getElementById('manualObraSelect');
  sel.innerHTML = '<option value="">— Selecciona una obra —</option>' +
    (db.obras || []).map(o =>
      `<option value="${o.id}">${o.name}${o.composer && o.composer !== '—' ? ' (' + o.composer + ')' : ''}</option>`
    ).join('');

  // Default date = today
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('manualFecha').value = hoy;
  document.getElementById('manualMinutos').value = '';
  document.getElementById('manualNota').value = '';
  manualTickSelected = null;
  document.querySelectorAll('.manual-tick').forEach(b => {
    b.style.background = 'transparent';
    b.style.borderColor = 'var(--border2)';
  });
  openModal('modalSesionManual');
}

function selectManualTick(tick, btn) {
  manualTickSelected = tick;
  const colors = { hecho: 'var(--green)', parcial: 'var(--orange)', saltado: 'var(--red)' };
  document.querySelectorAll('.manual-tick').forEach(b => {
    b.style.background = 'transparent';
    b.style.borderColor = 'var(--border2)';
    b.style.opacity = '0.5';
  });
  btn.style.background = colors[tick];
  btn.style.color = 'var(--bg)';
  btn.style.borderColor = colors[tick];
  btn.style.opacity = '1';
}

function saveSesionManual() {
  const obraId = document.getElementById('manualObraSelect').value;
  const minutos = parseInt(document.getElementById('manualMinutos').value);
  const fecha   = document.getElementById('manualFecha').value;
  const nota    = document.getElementById('manualNota').value.trim();

  if (!obraId)     { showToast('Selecciona una obra'); return; }
  if (!minutos || minutos < 1) { showToast('Indica los minutos estudiados'); return; }
  if (!fecha)      { showToast('Selecciona una fecha'); return; }

  const obra = findObra(obraId);
  if (!obra) return;

  // Encuentra o crea la sesión para esa fecha
  const fechaStr = new Date(fecha + 'T12:00:00').toDateString();
  let sesion = db.sesiones.find(s => new Date(s.date).toDateString() === fechaStr);

  if (!sesion) {
    sesion = {
      date: new Date(fecha + 'T12:00:00').toISOString(),
      energia: 'manual',
      items: []
    };
    db.sesiones.push(sesion);
    db.sesiones.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // Actualiza o añade el item de la obra
  const existIdx = sesion.items.findIndex(i => i.obraId === obraId);
  const newItem = {
    obraId,
    obraName: obra.name,
    tick: manualTickSelected || 'hecho',
    note: nota,
    objetivo: '',
    manual: true,
    minutosEstudiados: minutos
  };

  if (existIdx >= 0) {
    sesion.items[existIdx] = newItem;
  } else {
    sesion.items.push(newItem);
  }

  if (db.sesiones.length > 365) db.sesiones = db.sesiones.slice(0, 365);
  saveData();
  closeModal('modalSesionManual');
  showToast(`${minutos} min de ${obra.name} registrados ✓`);
  if (document.getElementById('view-historial').classList.contains('active')) {
    renderSesionesHistorial();
  }
}

// ─── THEMES ─────────────────────────────────────────────────────────────────

function normalizeTextSizePreference(size) {
  if (size === 'small' || size === 'normal' || size === 'large') return size;
  // The former XL level was a canvas zoom. Keep existing users at the largest
  // text level without bringing back the global zoom behaviour.
  if (size === 'xlarge') return 'large';
  return 'normal';
}

function setFontSize(size, btn) {
  const normalized = normalizeTextSizePreference(size);
  document.documentElement.setAttribute('data-size', normalized);
  localStorage.setItem('alberto_size', normalized);
  document.querySelectorAll('.size-option').forEach(b => {
    const isActive = b.dataset.size === normalized;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
  if (btn && btn.dataset.size !== normalized) btn = null;
}

// Color de fondo base de cada tema. Se usa para tintar la barra del
// navegador (meta theme-color) y que la app no se sienta "una web".
const THEME_BG = { marmol: '#f2f2f7', 'marmol-night': '#101114' };
const THEME_DAY = 'marmol';
const THEME_NIGHT = 'marmol-night';
function applyThemeColor(theme) {
  const col = THEME_BG[theme] || THEME_BG[THEME_DAY];
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', col);
}

// ¿Es horario de noche? (de 21:00 a 7:00)
function _isNightHour() {
  const h = new Date().getHours();
  return h >= 21 || h < 7;
}

// Aplica Mármol claro u oscuro. Ya no hay temas alternativos activables.
function refreshTheme() {
  const storedMode = localStorage.getItem('alberto_theme_mode');
  const legacyAuto = localStorage.getItem('alberto_autonight') === '1';
  const mode = storedMode === 'dark' || storedMode === 'auto' || storedMode === 'light'
    ? storedMode
    : (legacyAuto ? 'auto' : 'light');
  const display = mode === 'dark' || (mode === 'auto' && _isNightHour()) ? THEME_NIGHT : THEME_DAY;
  localStorage.setItem('alberto_theme_mode', mode);
  localStorage.setItem('alberto_theme', display);
  document.documentElement.setAttribute('data-theme', display);
  applyThemeColor(display);
  document.querySelectorAll('.theme-mode-option').forEach(button => {
    const active = button.dataset.themeMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  setTimeout(initEstadoSliders, 50); // re-fill tras cambio de color
}

function setThemeMode(mode) {
  const normalized = mode === 'dark' || mode === 'auto' ? mode : 'light';
  localStorage.setItem('alberto_theme_mode', normalized);
  refreshTheme();
  if (typeof showToast === 'function') {
    showToast(normalized === 'dark' ? 'Modo oscuro fijado' : normalized === 'auto' ? 'Modo automático activo' : 'Modo claro fijado');
  }
}

function setAutoNight(on) {
  setThemeMode(on ? 'auto' : 'light');
}

function loadTheme() {
  const storedSize = localStorage.getItem('alberto_size');
  const size = normalizeTextSizePreference(storedSize);
  // New installations start at Normal. Existing values are normalized
  // conservatively so a previous XL preference becomes Grande.
  localStorage.setItem('alberto_size', size);
  document.documentElement.setAttribute('data-size', size);

  // Tema (respetando el modo noche automático por hora).
  refreshTheme();

  document.querySelectorAll('.size-option').forEach(b => {
    b.classList.toggle('active', b.dataset.size === size);
    b.setAttribute('aria-checked', b.dataset.size === size ? 'true' : 'false');
  });

  // Revisar el modo noche cada minuto y al volver a la app, para cambiar solo
  // al cruzar las 21:00 / 7:00 sin recargar.
  if (!window._autoNightTimer) {
    window._autoNightTimer = setInterval(refreshTheme, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTheme(); });
    window.addEventListener('focus', refreshTheme);
  }
}

// ─── AUDIO ENGINE ────────────────────────────────────────────────────────────
// Web Audio en iOS Safari es frágil:
//   - El AudioContext puede entrar en estado 'suspended' (background), pero
//     también en 'interrupted' (llamada, otra app reproduce audio) o 'closed'
//     (suspensión prolongada del dispositivo).
//   - resume() es asíncrono — si creas un oscilador antes de que el contexto
//     esté 'running', el sonido se programa pero no suena.
//   - Hay límite de ~64 nodos activos: hay que desconectarlos tras stop().
// Este engine intenta robustecerse contra todo eso.

let _ac = null;
let _acFailureCount = 0;
// Diagnóstico opcional accesible desde consola: window._audioDiag()
window._audioDiag = function() {
  if (!_ac) return { status: 'no-context' };
  return {
    state: _ac.state,
    sampleRate: _ac.sampleRate,
    currentTime: _ac.currentTime,
    failures: _acFailureCount,
  };
};

function getAC() {
  // Si no hay contexto, o está cerrado (suspensión muy larga, iOS lo
  // descarta), crear uno nuevo.
  if (!_ac || _ac.state === 'closed') {
    try {
      _ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {
      _acFailureCount++;
      return null;
    }
  }
  // 'suspended' (visibilidad oculta) y 'interrupted' (otra app, llamada en
  // iOS) ambos necesitan resume(). Antes solo manejábamos 'suspended'.
  if (_ac.state === 'suspended' || _ac.state === 'interrupted') {
    // resume() es async; lanzamos pero NO esperamos aquí. El siguiente sonido
    // tras un resume exitoso ya tendrá el contexto running. Si falla, el
    // failure-count se incrementa y eventualmente recreamos el contexto.
    _ac.resume().catch(() => {
      _acFailureCount++;
      // Tras varios fallos consecutivos, descartamos y forzamos recreación
      if (_acFailureCount >= 3) {
        try { _ac.close(); } catch(e) {}
        _ac = null;
        _acFailureCount = 0;
      }
    });
  } else if (_ac.state === 'running') {
    _acFailureCount = 0; // reset al confirmar que sí suena
  }
  return _ac;
}

// Helper: limpia un nodo source/oscillator tras su stop programado.
// Esto libera referencias y permite que el GC recoja los nodos para no
// acumular el límite de ~64 nodos vivos en iOS Safari.
function _scheduleCleanup(node, stopTime, ac) {
  const ms = Math.max(50, (stopTime - ac.currentTime) * 1000 + 50);
  setTimeout(() => {
    try { node.disconnect(); } catch(e) {}
  }, ms);
}

let _soundVolume = (() => {
  try {
    const raw = parseInt(localStorage.getItem('alberto_sound_volume') || '75', 10);
    return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 75));
  } catch(e) { return 75; }
})();
let _soundMuted = (() => {
  try { return localStorage.getItem('alberto_sound_muted') === 'true'; }
  catch(e) { return false; }
})();

function appSoundGain() {
  if (_soundMuted) return 0;
  return Math.max(0, Math.min(1, _soundVolume / 100));
}

function setSoundVolume(value) {
  const v = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
  _soundVolume = v;
  if (v > 0 && _soundMuted) _soundMuted = false;
  try {
    localStorage.setItem('alberto_sound_volume', String(_soundVolume));
    localStorage.setItem('alberto_sound_muted', String(_soundMuted));
  } catch(e) {}
  refreshSoundVolumeUI();
}

function toggleSoundMute() {
  _soundMuted = !_soundMuted;
  try { localStorage.setItem('alberto_sound_muted', String(_soundMuted)); } catch(e) {}
  refreshSoundVolumeUI();
  if (!_soundMuted) {
    try { SFX.tick(); } catch(e) {}
  }
}

function refreshSoundVolumeUI() {
  const slider = document.getElementById('soundVolumeSlider');
  const label = document.getElementById('soundVolumeLabel');
  const btn = document.getElementById('soundMuteBtn');
  if (slider) slider.value = String(_soundVolume);
  if (label) label.textContent = _soundMuted ? 'off' : _soundVolume + '%';
  if (btn) btn.classList.toggle('active', _soundMuted || _soundVolume <= 0);
}

function playTone(freq, type = 'triangle', dur = 0.25, vol = 0.10, delay = 0) {
  vol = vol * appSoundGain();
  if (vol <= 0) return;
  const ac = getAC();
  if (!ac || ac.state === 'closed') return;
  const schedule = () => {
    // Si tras esperar al resume sigue sin estar running (silencio del SO,
    // pestaña en background, gesto perdido…), abortar limpio en lugar de
    // programar contra un currentTime estancado: eso provocaba "se quedan
    // pegados" tonos que ya no sonaban más tarde.
    if (ac.state !== 'running') return;
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = type;
      const t0 = ac.currentTime + delay;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0);
      // Ataque suave (evita clicks) + cola de release en dos tramos para que el
      // tono suene "dibujado" y no cortado en seco.
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.004);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0008, vol * 0.18), t0 + dur * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const stopAt = t0 + dur + 0.01;
      osc.start(t0);
      osc.stop(stopAt);
      _scheduleCleanup(osc, stopAt, ac);
      _scheduleCleanup(gain, stopAt, ac);
    } catch(e) {
      _acFailureCount++;
    }
  };
  if (ac.state === 'running') schedule();
  else ac.resume().then(schedule).catch(() => { _acFailureCount++; });
}

function playPianoTone(freq, dur = 0.25, vol = 0.10, delay = 0) {
  // Fundamental + octava + un toque de doceava (3x) muy tenue: da cuerpo y
  // brillo sin sonar sintético ni metálico.
  playTone(freq, 'triangle', dur, vol, delay);
  playTone(freq * 2, 'sine', Math.max(0.12, dur * 0.82), vol * 0.15, delay + 0.004);
  playTone(freq * 3, 'sine', Math.max(0.08, dur * 0.6), vol * 0.06, delay + 0.008);
}

// Burst de noise filtrado: para clicks de madera, papel, botón.
//   cutoff: frecuencia del paso-bajo (Hz). Más bajo = más sordo/leñoso.
//   q: resonancia del filtro. Sutil bump = "cuerpo".
//   dur: duración. Muy corta = click; corta = tap.
//   vol: pico de amplitud.
//   delay: offset desde "ahora".
function playNoiseBurst(cutoff, q, dur, vol, delay = 0) {
  vol = vol * appSoundGain();
  if (vol <= 0) return;
  const ac = getAC();
  if (!ac || ac.state === 'closed') return;
  const schedule = () => {
    if (ac.state !== 'running') return;
    try {
      const len = Math.max(1, Math.floor(ac.sampleRate * (dur + 0.02)));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filt = ac.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = cutoff;
      filt.Q.value = q;
      const gain = ac.createGain();
      src.connect(filt); filt.connect(gain); gain.connect(ac.destination);
      const t0 = ac.currentTime + delay;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      const stopAt = t0 + dur + 0.02;
      src.start(t0);
      src.stop(stopAt);
      _scheduleCleanup(src, stopAt, ac);
      _scheduleCleanup(filt, stopAt, ac);
      _scheduleCleanup(gain, stopAt, ac);
    } catch(e) {
      _acFailureCount++;
    }
  };
  if (ac.state === 'running') schedule();
  else ac.resume().then(schedule).catch(() => { _acFailureCount++; });
}

// Despertar el contexto de audio cuando la app vuelve al foreground.
// iOS lo suspende automáticamente y a veces no se recupera solo.
function _wakeAudioContext() {
  if (!_ac) return;
  // Si iOS lo cerró tras una inactividad larga, descartamos la referencia:
  // la próxima llamada a getAC() creará uno nuevo en respuesta a un gesto.
  if (_ac.state === 'closed') {
    _ac = null;
    _acFailureCount = 0;
    return;
  }
  if (_ac.state === 'suspended' || _ac.state === 'interrupted') {
    _ac.resume().catch(() => {
      _acFailureCount++;
      if (_acFailureCount >= 2) {
        try { _ac.close(); } catch(e) {}
        _ac = null;
        _acFailureCount = 0;
      }
    });
  }
}

// Watchdog: si el AudioContext queda "zombi" (state running pero currentTime
// no avanza) tras una pausa larga del SO, ningún sonido se escucha. Detectamos
// medición a medición y, si no avanza, descartamos para forzar recreación.
let _acLastCheckTime = 0;
let _acLastCheckAt = 0;
function _ensureAudioContextAlive() {
  if (!_ac) return;
  if (_ac.state !== 'running') return;
  const now = Date.now();
  const ct = _ac.currentTime;
  if (_acLastCheckAt && now - _acLastCheckAt > 400 && ct === _acLastCheckTime) {
    // No avanzó en >400ms estando supuestamente "running" → AC zombi.
    try { _ac.close(); } catch(e) {}
    _ac = null;
    _acFailureCount = 0;
  }
  _acLastCheckTime = ct;
  _acLastCheckAt = now;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _wakeAudioContext();
  });
  // window.focus también porque iOS no siempre dispara visibilitychange
  window.addEventListener('focus', _wakeAudioContext);
  // pageshow tras volver del bfcache (Safari): el AC viejo suele estar muerto.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      if (_ac) { try { _ac.close(); } catch(_) {} _ac = null; _acFailureCount = 0; }
    } else {
      _wakeAudioContext();
    }
  });
  // Cada gesto del usuario reactiva el audio. NO es 'once': iOS necesita que
  // el resume venga acompañado de un gesto reciente cada vez que el AC haya
  // pasado por suspended.
  const wakeOnGesture = () => {
    _ensureAudioContextAlive();
    if (!_ac) getAC();
    else _wakeAudioContext();
  };
  document.addEventListener('touchstart', wakeOnGesture, { passive: true });
  document.addEventListener('pointerdown', wakeOnGesture, { passive: true });
  document.addEventListener('click', wakeOnGesture, { passive: true });
  document.addEventListener('keydown', wakeOnGesture);
}

// ── SOUND PACKS ──────────────────────────────────────────────────────────────
// Cada pack es un objeto con los mismos métodos. El usuario elige uno y SFX
// proxea las llamadas al pack activo.

const SFX_PACKS = {
  piano: {
    // Acorde mayor — como pulsar teclas suavemente
    generate() {
      [[261.6, 0,    'triangle', 0.6,  0.11],
       [329.6, 0.05, 'triangle', 0.55, 0.09],
       [392.0, 0.10, 'triangle', 0.55, 0.08]
      ].forEach(([f, d, t, dur, v]) => playPianoTone(f, dur, v, d));
    },
    tick() {
      playPianoTone(523.3, 0.35, 0.10, 0);
      playPianoTone(262.0, 0.18, 0.04, 0);
    },
    startSession() {
      playPianoTone(261.6, 0.42, 0.09, 0);
      playPianoTone(392.0, 0.52, 0.10, 0.09);
    },
    save() {
      playPianoTone(392.0, 0.45, 0.10, 0);
      playPianoTone(523.3, 0.50, 0.10, 0.10);
    },
    saveSession() {
      [[349.2, 0,    'triangle', 0.50, 0.09],
       [392.0, 0.08, 'triangle', 0.45, 0.09],
       [440.0, 0.16, 'triangle', 0.45, 0.09],
       [523.3, 0.26, 'triangle', 0.60, 0.11],
      ].forEach(([f, d, t, dur, v]) => playPianoTone(f, dur, v, d));
    },
    skip() {
      playPianoTone(196.0, 0.20, 0.08, 0);
      playPianoTone(185.0, 0.15, 0.04, 0.04);
    },
    open() { playPianoTone(440, 0.18, 0.06, 0); },
    pase() {
      playPianoTone(440.0, 0.30, 0.09, 0);
      playPianoTone(523.3, 0.35, 0.09, 0.12);
    },
    add() {
      playPianoTone(293.7, 0.28, 0.09, 0);
      playPianoTone(369.9, 0.32, 0.09, 0.10);
    },
    del() {
      playPianoTone(369.9, 0.18, 0.07, 0);
      playPianoTone(293.7, 0.18, 0.05, 0.05);
    },
    nav() { playPianoTone(523.3, 0.10, 0.04, 0); },
    memlapse() { playPianoTone(220, 0.40, 0.06, 0); },
  },

  // ── MADERA ──
  // Clicks leñosos: burst de ruido con paso-bajo bajo y poca duración.
  // El "knock" simula una madera golpeada: cutoff bajo (sin agudos),
  // pulso muy breve.
  wood: {
    generate() {
      // Tres "knocks" más profundos, en intervalo musical
      playNoiseBurst(800, 6, 0.08, 0.30, 0);
      playNoiseBurst(700, 6, 0.09, 0.25, 0.08);
      playNoiseBurst(600, 6, 0.10, 0.22, 0.16);
    },
    tick() {
      // Knock corto, sordo
      playNoiseBurst(1200, 4, 0.05, 0.22, 0);
    },
    startSession() {
      playNoiseBurst(900, 5, 0.07, 0.22, 0);
      playNoiseBurst(700, 5, 0.10, 0.20, 0.10);
    },
    save() {
      playNoiseBurst(900, 5, 0.07, 0.25, 0);
      playNoiseBurst(700, 5, 0.10, 0.22, 0.07);
    },
    saveSession() {
      // Cuatro knocks resolutivos
      playNoiseBurst(900, 5, 0.07, 0.22, 0);
      playNoiseBurst(800, 5, 0.07, 0.22, 0.08);
      playNoiseBurst(700, 5, 0.08, 0.24, 0.16);
      playNoiseBurst(550, 5, 0.12, 0.28, 0.25);
    },
    skip() {
      playNoiseBurst(400, 3, 0.06, 0.16, 0);
    },
    open() {
      playNoiseBurst(1500, 3, 0.03, 0.16, 0);
    },
    pase() {
      playNoiseBurst(900, 4, 0.06, 0.22, 0);
      playNoiseBurst(1100, 4, 0.06, 0.20, 0.10);
    },
    add() {
      playNoiseBurst(800, 4, 0.06, 0.22, 0);
      playNoiseBurst(1000, 4, 0.07, 0.22, 0.08);
    },
    del() {
      playNoiseBurst(700, 4, 0.05, 0.20, 0);
      playNoiseBurst(500, 4, 0.07, 0.18, 0.05);
    },
    nav() {
      playNoiseBurst(1800, 2, 0.025, 0.10, 0);
    },
    memlapse() {
      playNoiseBurst(350, 4, 0.18, 0.18, 0);
    },
  },

  // ── PAPEL ──
  // Roces ultra-cortos con cutoff muy alto (preservar agudos) — como pasar
  // una página o un pequeño "fwop".
  paper: {
    generate() {
      playNoiseBurst(4000, 1, 0.05, 0.10, 0);
      playNoiseBurst(3500, 1, 0.07, 0.10, 0.06);
    },
    tick() {
      // "Fst" muy corto
      playNoiseBurst(4500, 0.5, 0.025, 0.10, 0);
    },
    startSession() {
      playNoiseBurst(4200, 1, 0.04, 0.10, 0);
      playNoiseBurst(3600, 1, 0.06, 0.10, 0.08);
    },
    save() {
      playNoiseBurst(4000, 1, 0.04, 0.10, 0);
      playNoiseBurst(3000, 1, 0.07, 0.09, 0.05);
    },
    saveSession() {
      playNoiseBurst(4200, 1, 0.05, 0.10, 0);
      playNoiseBurst(3800, 1, 0.05, 0.10, 0.07);
      playNoiseBurst(3200, 1, 0.08, 0.10, 0.14);
    },
    skip() {
      playNoiseBurst(2500, 1, 0.03, 0.07, 0);
    },
    open() {
      playNoiseBurst(5000, 0.5, 0.015, 0.08, 0);
    },
    pase() {
      playNoiseBurst(4000, 1, 0.04, 0.09, 0);
      playNoiseBurst(4500, 1, 0.05, 0.09, 0.07);
    },
    add() {
      playNoiseBurst(3500, 1, 0.04, 0.09, 0);
      playNoiseBurst(4200, 1, 0.05, 0.09, 0.06);
    },
    del() {
      playNoiseBurst(3000, 1, 0.04, 0.08, 0);
      playNoiseBurst(2200, 1, 0.05, 0.08, 0.04);
    },
    nav() {
      playNoiseBurst(5500, 0.3, 0.015, 0.06, 0);
    },
    memlapse() {
      playNoiseBurst(1500, 1, 0.12, 0.07, 0);
    },
  },
};

// Pack activo, cargado de localStorage
let _activeSoundPack = (function() {
  try {
    return localStorage.getItem('alberto_sound_pack') || 'piano';
  } catch(e) { return 'piano'; }
})();

function setSoundPack(name) {
  if (!SFX_PACKS[name]) return;
  _activeSoundPack = name;
  try { localStorage.setItem('alberto_sound_pack', name); } catch(e) {}
  // Pequeño preview al elegir
  try { SFX_PACKS[name].tick(); } catch(e) {}
}

function getSoundPack() { return _activeSoundPack; }

function refreshSoundOptionUI() {
  document.querySelectorAll('.sound-option').forEach(b => {
    b.classList.toggle('active', b.dataset.sound === _activeSoundPack);
  });
  refreshSoundVolumeUI();
}

// SFX como proxy al pack activo
const SFX = new Proxy({}, {
  get(_, prop) {
    return function(...args) {
      const pack = SFX_PACKS[_activeSoundPack] || SFX_PACKS.piano;
      if (typeof pack[prop] === 'function') return pack[prop](...args);
    };
  }
});


// ─── HÁPTICA (vibración sutil) ────────────────────────────────────────────────
// Feedback táctil para que cada acción "se sienta". Dos backends:
//   1) navigator.vibrate(): Android / Chrome. Acepta patrones en ms.
//   2) Truco del <input switch> de iOS: Safari de iPad/iPhone NO soporta
//      navigator.vibrate, pero desde iOS 17.4 alternar un control "switch"
//      mediante el click de su <label> produce un toque háptico nativo. Creamos
//      un switch oculto y lo pulsamos. Solo funciona dentro de un gesto del
//      usuario (igual que vibrate), por eso lo cableamos a taps/botones, no al
//      pulso continuo del metrónomo.
const Haptics = (() => {
  let enabled = (() => {
    try { return localStorage.getItem('alberto_haptics') !== 'off'; }
    catch(e) { return true; }
  })();
  const canVibrate = typeof navigator !== 'undefined'
    && typeof navigator.vibrate === 'function';
  let swLabel = null;
  function ensureSwitch() {
    if (swLabel || canVibrate) return;
    try {
      swLabel = document.createElement('label');
      swLabel.setAttribute('aria-hidden', 'true');
      swLabel.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');   // atributo propio de iOS
      input.tabIndex = -1;
      swLabel.appendChild(input);
      (document.body || document.documentElement).appendChild(swLabel);
    } catch(e) { swLabel = null; }
  }
  function tapSwitch() {
    ensureSwitch();
    if (swLabel) { try { swLabel.click(); } catch(e) {} }
  }
  // pattern: ms o array de ms para la API vibrate. iosReps: nº de toques del
  // switch para emular un patrón con énfasis en iOS (donde solo hay un toque fijo).
  function fire(pattern, iosReps) {
    if (!enabled) return;
    if (canVibrate) { try { navigator.vibrate(pattern); } catch(e) {} return; }
    tapSwitch();
    const reps = iosReps || 1;
    for (let i = 1; i < reps; i++) setTimeout(tapSwitch, i * 70);
  }
  return {
    tick()    { fire(6); },                  // detente de rueda, blip mínimo
    light()   { fire(9); },                  // tap suave: nav, abrir modal
    medium()  { fire(15); },                 // confirmación: pase, play
    heavy()   { fire(22); },                 // arranque de sesión
    success() { fire([14, 45, 22], 2); },    // logro: hecho, sesión guardada
    warn()    { fire([10, 35, 10], 2); },    // borrar, saltar, límite
    isEnabled() { return enabled; },
    set(on) {
      enabled = !!on;
      try { localStorage.setItem('alberto_haptics', enabled ? 'on' : 'off'); } catch(e) {}
      if (enabled) this.medium();            // preview al activar
      refreshHapticsUI();
    },
    toggle() { this.set(!enabled); return enabled; },
  };
})();

function toggleHaptics() { Haptics.toggle(); }

function refreshHapticsUI() {
  const btn = document.getElementById('hapticsToggleBtn');
  if (!btn) return;
  const on = Haptics.isEnabled();
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
}


// ─── RIPPLE ──────────────────────────────────────────────────────────────────

function addRipple(el, e) {
  const rect = el.getBoundingClientRect();
  const r = document.createElement('span');
  r.className = 'ripple';
  const size = Math.max(rect.width, rect.height);
  r.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX||rect.left+rect.width/2) - rect.left - size/2}px;top:${(e.clientY||rect.top+rect.height/2) - rect.top - size/2}px`;
  el.classList.add('ripple-host');
  el.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}

// ── iOS BACKGROUND PERSISTENCE ───────────────────────────────────────────────
// iOS Safari kills JS when app goes to background. Save everything on hide.

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') {
    // Save draft + estado immediately when going to background
    saveDraft();
    saveEstadoDiario();
    enqueueCloudSync({ immediate: true });
  } else if (document.visibilityState === 'visible') {
    // Came back to foreground — always try to refresh session first
    _restoreSessionIfNeeded();
    // Restore estado sliders
    try {
      loadEstadoDiarioFromSources();
      initEstadoSliders();
    } catch(e) {}
  }
});

async function _restoreSessionIfNeeded() {
  try {
    const sb = getSB();

    // 1. Refrescar token (rápido si aún no expiró)
    const { data: refreshData } = await sb.auth.refreshSession();
    if (refreshData && refreshData.session) {
      return;
    }

    // 2. Probar sesión desde almacenamiento
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      return;
    }

    // 3. No se guardan contraseñas: el usuario decide cuándo volver a entrar.
  } catch(e) {
    // Sin red — la app sigue funcionando en local
  }
}

// ── iPad/iOS keep-alive: refresh token every 45 min proactively ──────────────
// iOS kills JS timers when backgrounded, but this fires when the app IS visible,
// ensuring the token never expires while actively studying.
(function _startTokenRefreshLoop() {
  const REFRESH_INTERVAL = 45 * 60 * 1000; // 45 min
  setInterval(async function() {
    if (document.visibilityState !== 'visible') return;
    try {
      const sb = getSB();
      await sb.auth.refreshSession();
    } catch(e) {}
  }, REFRESH_INTERVAL);
})();

// Also save estado on every slider change (already debounced)
const _origUpdateEstadoBase = updateEstado;
updateEstado = function(dim, val) {
  _origUpdateEstadoBase(dim, val);
  saveEstadoDiario();
};

// ─── REGISTRO DIRECTO ────────────────────────────────────────────────────────

function buildObraSelectOptions(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const obras = (db.obras || []).sort((a, b) => a.name.localeCompare(b.name));
  let opts = '<option value="">— selecciona —</option>';
  obras.forEach(o => {
    const movs = (o.movimientos || []).filter(m => m.name);
    if (!movs.length) {
      opts += '<option value="obra::' + o.id + '">' + o.name + (o.composer ? ' · ' + o.composer : '') + '</option>';
    } else {
      opts += '<option value="" disabled style="color:var(--text3)">── ' + o.name + ' ──</option>';
      movs.forEach(m => {
        opts += '<option value="mov::' + o.id + '::' + m.id + '">  ' + m.name + (m.duracion ? ' (' + m.duracion + 'min)' : '') + '</option>';
      });
    }
  });
  select.innerHTML = opts;
}

let studyRegisterMode = 'plan';
let studyRegisterTick = 'hecho';

function setStudyRegisterMode(mode, btn) {
  studyRegisterMode = mode === 'today' ? 'history' : (mode === 'history' ? 'history' : 'plan');
  document.querySelectorAll('#studyModeRow .study-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === studyRegisterMode);
  });
  if (btn) btn.classList.add('active');
  const isPlan = studyRegisterMode === 'plan';
  const dateWrap = document.getElementById('studyRegisterDateWrap');
  const horaWrap = document.getElementById('studyRegisterHoraWrap');
  const tickWrap = document.getElementById('studyRegisterTickWrap');
  const sub = document.getElementById('studyRegisterSub');
  const saveBtn = document.getElementById('studyRegisterSaveBtn');
  if (dateWrap) dateWrap.style.display = isPlan ? 'none' : '';
  if (horaWrap) horaWrap.style.display = isPlan ? 'none' : '';
  if (tickWrap) tickWrap.style.display = isPlan ? 'none' : '';
  if (sub) sub.textContent = isPlan
    ? 'Se añade al plan de hoy; márcala cuando la trabajes.'
    : 'Estudio ya hecho, al historial con fecha y nota.';
  if (saveBtn) saveBtn.textContent = isPlan ? 'Añadir' : 'Guardar';
}

function selectStudyRegisterTick(tick, btn) {
  studyRegisterTick = tick === 'parcial' ? 'parcial' : 'hecho';
  document.querySelectorAll('#studyRegisterTickWrap .study-tick-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tick === studyRegisterTick);
  });
  if (btn) btn.classList.add('active');
}

function openStudyRegister(mode) {
  buildObraSelectOptions('studyRegisterObra');
  studyRegisterTick = 'hecho';
  const today = new Date().toISOString().split('T')[0];
  const mins = document.getElementById('studyRegisterMinutos');
  const fecha = document.getElementById('studyRegisterFecha');
  const nota = document.getElementById('studyRegisterNota');
  const hora = document.getElementById('studyRegisterHora');
  if (mins) mins.value = '';
  if (fecha) fecha.value = today;
  if (nota) nota.value = '';
  if (hora) hora.value = '';
  const compas = document.getElementById('studyRegisterCompasSection');
  if (compas) compas.style.display = 'none';
  selectStudyRegisterTick('hecho');
  setStudyRegisterMode(mode || 'plan');
  openModal('modalStudyRegister');
}

function studyRegisterResolveValue(val) {
  if (!val) return null;
  if (val.startsWith('mov::')) {
    const parts = val.split('::');
    const obraId = parts[1];
    const movId = parts[2];
    const obra = findObra(obraId);
    const mov = obra?.movimientos?.find(m => m.id === movId);
    if (!obra || !mov) return null;
    return { obraId, movId, obra, mov, entity: mov, name: obra.name + ' · ' + mov.name };
  }
  const obraId = val.replace('obra::', '');
  const obra = findObra(obraId);
  if (!obra) return null;
  return { obraId, movId: null, obra, mov: null, entity: obra, name: obra.name };
}

function studyRegisterOnObraChange() {
  const resolved = studyRegisterResolveValue(document.getElementById('studyRegisterObra')?.value || '');
  const section = document.getElementById('studyRegisterCompasSection');
  if (!section) return;
  if (!resolved || !resolved.entity || !resolved.entity.compasesTotal) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const actual = document.getElementById('studyRegisterCompasActual');
  const total = document.getElementById('studyRegisterCompasTotal');
  if (actual) actual.value = resolved.entity.compasActual || 0;
  if (total) total.textContent = resolved.entity.compasesTotal;
  studyRegisterUpdateCompas();
}

function studyRegisterUpdateCompas() {
  const actual = parseInt(document.getElementById('studyRegisterCompasActual')?.value || '0', 10);
  const total = parseInt(document.getElementById('studyRegisterCompasTotal')?.textContent || '0', 10);
  const pct = document.getElementById('studyRegisterCompasPct');
  if (pct) pct.textContent = total > 0 ? Math.round((actual / total) * 100) + '%' : '';
}

function studyRegisterSaveCompas(resolved) {
  const section = document.getElementById('studyRegisterCompasSection');
  if (!resolved || !resolved.entity || !section || section.style.display === 'none') return;
  const newCompas = parseInt(document.getElementById('studyRegisterCompasActual')?.value || '', 10);
  if (!Number.isFinite(newCompas)) return;
  const entity = resolved.entity;
  if (newCompas !== (entity.compasActual || 0)) {
    entity.compasActual = Math.max(0, newCompas);
    entity.apr = aprFromCompas(entity);
  }
}

function confirmStudyRegister() {
  const val = document.getElementById('studyRegisterObra')?.value || '';
  const minutos = parseInt(document.getElementById('studyRegisterMinutos')?.value || '0', 10);
  const fecha = document.getElementById('studyRegisterFecha')?.value || new Date().toISOString().split('T')[0];
  const nota = document.getElementById('studyRegisterNota')?.value.trim() || '';
  const resolved = studyRegisterResolveValue(val);
  if (!resolved) { showToast('Selecciona una obra o movimiento'); return; }
  if (!minutos || minutos < 1) { showToast('Indica los minutos estudiados'); return; }
  studyRegisterSaveCompas(resolved);

  if (studyRegisterMode === 'plan') {
    buildObraSelectOptions('extraObraSelect');
    const extraSel = document.getElementById('extraObraSelect');
    const extraMin = document.getElementById('extraMinutos');
    if (extraSel) extraSel.value = val;
    if (extraMin) extraMin.value = String(minutos);
    closeModal('modalStudyRegister');
    confirmAddExtra();
    return;
  }

  const date = new Date(fecha + 'T12:00:00');
  const fechaStr = date.toDateString();
  let sesion = db.sesiones.find(s => new Date(s.date).toDateString() === fechaStr);
  if (!sesion) {
    sesion = { date: date.toISOString(), energia: 'manual', items: [] };
    db.sesiones.push(sesion);
    db.sesiones.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  const item = {
    obraId: resolved.obraId,
    movId: resolved.movId,
    obraName: resolved.name,
    tick: studyRegisterTick || 'hecho',
    note: nota,
    objetivo: '',
    manual: true,
    minutosEstudiados: minutos,
    minutosReales: minutos,
  };
  sesion.items.push(item);
  // Hora de inicio real (opcional): si se indica, el tramo se registra a esa
  // hora exacta y aparece en el modal "Por horas"; si no, se coloca al mediodía.
  const hora = (document.getElementById('studyRegisterHora')?.value || '').trim();
  let started;
  if (/^\d{1,2}:\d{2}$/.test(hora)) {
    started = new Date(fecha + 'T' + (hora.length === 4 ? '0' + hora : hora) + ':00');
    if (isNaN(started.getTime())) { started = new Date(date); started.setHours(12, 0, 0, 0); }
  } else {
    started = new Date(date);
    started.setHours(12, Math.min(59, Math.max(0, sesion.items.length - 1)), 0, 0);
  }
  const ended = new Date(started.getTime() + minutos * 60000);
  recordSessionPlant(resolved.obraId, resolved.movId, started.toISOString(), ended.toISOString(), minutos, { source: 'manual' });
  if (db.sesiones.length > 365) db.sesiones = db.sesiones.slice(0, 365);
  saveData();
  closeModal('modalStudyRegister');
  if (typeof renderSesionesHistorial === 'function') renderSesionesHistorial();
  if (typeof renderRacha === 'function') renderRacha();
  if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
  showToast(minutos + ' min registrados · ' + resolved.name);
  if (typeof SFX !== 'undefined' && SFX.save) SFX.save();
}

function openRegistroDirecto() {
  openStudyRegister('today');
  return;
  buildObraSelectOptions('rdObraSelect');
  document.getElementById('rdMinutos').value = '';
  document.getElementById('rdNota').value = '';
  document.getElementById('rdCompasSection').style.display = 'none';
  document.getElementById('rdObraSelect').onchange = function() {
    const val = this.value;
    const cs = document.getElementById('rdCompasSection');
    if (!val) { cs.style.display = 'none'; return; }
    let entity = null;
    if (val.startsWith('mov::')) {
      const [, obraId, movId] = val.split('::');
      entity = findMovimiento(obraId, movId);
    } else {
      entity = findObra(val.replace('obra::', ''));
    }
    if (entity && entity.compasesTotal) {
      cs.style.display = 'block';
      document.getElementById('rdCompasActual').value = entity.compasActual || 0;
      document.getElementById('rdCompasTotal').textContent = entity.compasesTotal;
      rdUpdateCompas();
    } else {
      cs.style.display = 'none';
    }
  };
  openModal('modalRegistroDirecto');
}

function rdUpdateCompas() {
  const actual = parseInt(document.getElementById('rdCompasActual')?.value) || 0;
  const total  = parseInt(document.getElementById('rdCompasTotal')?.textContent) || 0;
  const pctEl  = document.getElementById('rdCompasPct');
  if (pctEl && total) pctEl.textContent = '(' + Math.round(actual/total*100) + '%)';
}

function confirmRegistroDirecto() {
  const val     = document.getElementById('rdObraSelect')?.value;
  const minutos = parseInt(document.getElementById('rdMinutos')?.value) || 0;
  const nota    = document.getElementById('rdNota')?.value.trim() || '';
  if (!val) { showToast('Selecciona una obra'); return; }

  let obraId, movId, obraName;
  if (val.startsWith('mov::')) {
    const parts = val.split('::');
    obraId = parts[1]; movId = parts[2];
    const obra = findObra(obraId);
    const mov  = obra?.movimientos?.find(m => m.id === movId);
    obraName = obra ? obra.name + ' · ' + (mov?.name || '') : obraId;
    // Update compas if changed
    if (mov && document.getElementById('rdCompasSection').style.display !== 'none') {
      const newCompas = parseInt(document.getElementById('rdCompasActual')?.value);
      if (!isNaN(newCompas) && newCompas !== (mov.compasActual || 0)) {
        mov.compasActual = newCompas;
        mov.apr = aprFromCompas(mov);
      }
    }
  } else {
    obraId = val.replace('obra::', '');
    movId  = null;
    const obra = findObra(obraId);
    obraName = obra?.name || obraId;
    if (obra && document.getElementById('rdCompasSection').style.display !== 'none') {
      const newCompas = parseInt(document.getElementById('rdCompasActual')?.value);
      if (!isNaN(newCompas) && newCompas !== (obra.compasActual || 0)) {
        obra.compasActual = newCompas;
        obra.apr = aprFromCompas(obra);
      }
    }
  }

  // Save to today's session
  const today = new Date().toDateString();
  let sesion = db.sesiones.find(s => new Date(s.date).toDateString() === today);
  if (!sesion) {
    sesion = { date: new Date().toISOString(), energia: selectedEnergy, estado: estadoSnapshot(), items: [] };
    db.sesiones.unshift(sesion);
  }
  sesion.items.push({
    obraId, movId, obraName, manual: true,
    tick: 'hecho', minutosReales: minutos || null,
    note: nota, objetivo: ''
  });

  saveData();
  closeModal('modalRegistroDirecto');
  showToast('Registrado: ' + obraName + (minutos ? ' · ' + minutos + 'min' : ''));
  SFX.save();
}

// ─── EDITAR SESION PASADA ─────────────────────────────────────────────────────

let _editSesionIdx = -1;
let _editObraItems = [];

function openEditarSesion(sesionDate) {
  const idx = db.sesiones.findIndex(s => s.date === sesionDate);
  if (idx === -1) return;
  _editSesionIdx = idx;
  _editObraItems = [];

  const s = db.sesiones[idx];
  const d = new Date(s.date);

  // Abrir el modal primero, rellenar después: garantiza que los elementos
  // tengan dimensiones reales y que un re-render no quede en un contenedor
  // display:none (causa frecuente de "el botón no hace nada visible").
  openModal('modalEditarSesion');
  requestAnimationFrame(() => {
    const fechaEl = document.getElementById('editSesionFecha');
    if (fechaEl) fechaEl.textContent =
      d.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    renderEditExistingItems();
    const notaEl = document.getElementById('editNota');
    if (notaEl) notaEl.value = s.notaGeneral || '';
    const obraListEl = document.getElementById('editObraList');
    if (obraListEl) obraListEl.innerHTML = '';
    buildObraSelectOptions('editObraSelect');
    const minEl = document.getElementById('editMinutos');
    if (minEl) minEl.value = '';
  });
}

// Renderiza la lista de items ya guardados, con controles inline para
// editar minutos/tick o eliminar.
function renderEditExistingItems() {
  const container = document.getElementById('editExistingItems');
  if (!container) return;
  if (_editSesionIdx < 0) return;
  const s = db.sesiones[_editSesionIdx];
  const items = s.items || [];
  if (!items.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text3);font-style:italic;padding:8px 4px">Esta sesión no tiene items registrados aún.</div>';
    return;
  }
  const tickIcons = { hecho: '✓', parcial: '≈', saltado: '✗', null: '·' };
  container.innerHTML = items.map((it, i) => {
    const tick = it.tick || null;
    const tickClass = tick || 'none';
    const tickIcon = tick ? tickIcons[tick] : '·';
    const mins = it.minutosReales != null ? it.minutosReales : '';
    return '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:8px;padding:10px 12px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<div class="sesion-hist-obra-tick ' + tickClass + '" style="width:22px;height:22px;font-size:14px;flex-shrink:0">' + tickIcon + '</div>' +
        '<div style="flex:1;font-family:\'Cormorant Garamond\',serif;font-size:15px;line-height:1.2;min-width:0;word-wrap:break-word">' + escapeHtmlSafe(it.obraName || '—') + '</div>' +
        '<button onclick="deleteEditExistingItem(' + i + ')" title="Eliminar este item" style="background:none;border:1px solid var(--border2);border-radius:6px;color:var(--text3);cursor:pointer;font-size:12px;padding:3px 8px;flex-shrink:0">✕</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:10px">' +
        '<span style="color:var(--text3)">Estado:</span>' +
        '<button onclick="setEditExistingTick(' + i + ',\'hecho\',this)" class="edit-mini-btn ' + (tick==='hecho'?'active hecho':'') + '" style="font-size:10px;padding:3px 8px;border-radius:5px;border:1px solid var(--border2);background:' + (tick==='hecho'?'rgba(120,170,100,0.18)':'transparent') + ';color:' + (tick==='hecho'?'var(--green)':'var(--text3)') + ';cursor:pointer">✓</button>' +
        '<button onclick="setEditExistingTick(' + i + ',\'saltado\',this)" class="edit-mini-btn ' + (tick==='saltado'?'active saltado':'') + '" style="font-size:10px;padding:3px 8px;border-radius:5px;border:1px solid var(--border2);background:' + (tick==='saltado'?'rgba(200,100,100,0.18)':'transparent') + ';color:' + (tick==='saltado'?'var(--red)':'var(--text3)') + ';cursor:pointer">✗</button>' +
        '<span style="color:var(--text3);margin-left:6px">Min:</span>' +
        '<input type="number" min="1" max="480" step="5" value="' + mins + '" placeholder="—" ' +
          'onchange="setEditExistingMinutos(' + i + ',this.value)" ' +
          'style="width:54px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--accent);font-family:\'JetBrains Mono\',monospace;font-size:11px;text-align:center">' +
      '</div>' +
      (it.note ? '<div style="font-size:10px;color:var(--text3);font-style:italic;margin-top:6px;padding-left:30px">' + escapeHtmlSafe(it.note) + '</div>' : '') +
    '</div>';
  }).join('');
}

// ¿La sesión que se está editando es la de HOY? Para hoy, los cambios deben
// reflejarse también en el estado en memoria (currentPlan/sessionMinPlan/…),
// porque el autosave reconstruye la sesión de hoy desde memoria y, sin
// sincronizar, pisaría la edición al instante.
function _editSesionEsHoy() {
  if (_editSesionIdx < 0) return false;
  const s = db.sesiones[_editSesionIdx];
  return !!s && new Date(s.date).toDateString() === new Date().toDateString();
}

// Sincroniza un cambio de un item editado con el estado en memoria del día.
function _editSyncLivePlan(item, changes) {
  if (!item || !item._planId) return;
  const pid = item._planId;
  if (changes.remove) {
    currentPlan = currentPlan.filter(e => (e._planId || e.id) !== pid);
    delete sessionMinPlan[pid];
    delete sessionTicks[pid];
    delete sessionSolRatings[pid];
    delete sessionProductivityRatings[pid];
    delete sessionAggregate[pid];
    delete sessionDestello[pid];
    return;
  }
  const entity = currentPlan.find(e => (e._planId || e.id) === pid);
  if (changes.minutos !== undefined) {
    if (changes.minutos == null) {
      delete sessionMinPlan[pid];
    } else {
      sessionMinPlan[pid] = changes.minutos;
      // Editar minutos reales implica que la tarjeta se estudió → cuenta.
      if (entity) entity._isExtra = true;
      const tminInp = document.getElementById('tmin-' + pid);
      if (tminInp) { tminInp.value = changes.minutos; tminInp._touched = true; }
    }
  }
  if (changes.tick !== undefined) {
    if (changes.tick == null) delete sessionTicks[pid];
    else sessionTicks[pid] = changes.tick;
  }
}

// Cambia el tick (hecho/saltado) de un item ya guardado
function setEditExistingTick(itemIdx, tick) {
  if (_editSesionIdx < 0) return;
  const s = db.sesiones[_editSesionIdx];
  if (!s.items || !s.items[itemIdx]) return;
  const item = s.items[itemIdx];
  // Toggle: si ya estaba ese tick, quitarlo
  const nuevoTick = item.tick === tick ? null : tick;
  item.tick = nuevoTick;
  // estudiado coherente con el nuevo tick (manual items se respetan)
  if (!item.manual) item.estudiado = (nuevoTick === 'hecho' || nuevoTick === 'parcial');
  if (_editSesionEsHoy()) _editSyncLivePlan(item, { tick: nuevoTick });
  renderEditExistingItems();
}

// Cambia los minutos reales de un item ya guardado
function setEditExistingMinutos(itemIdx, val) {
  if (_editSesionIdx < 0) return;
  const s = db.sesiones[_editSesionIdx];
  if (!s.items || !s.items[itemIdx]) return;
  const item = s.items[itemIdx];
  const v = parseInt(val);
  const minutos = isNaN(v) ? null : v;
  item.minutosReales = minutos;
  // Editar minutos reales marca el item como estudiado.
  if (minutos != null && !item.manual) item.estudiado = true;
  if (_editSesionEsHoy()) _editSyncLivePlan(item, { minutos });
}

// Elimina un item ya guardado (con confirmación)
function deleteEditExistingItem(itemIdx) {
  if (_editSesionIdx < 0) return;
  const s = db.sesiones[_editSesionIdx];
  if (!s.items || !s.items[itemIdx]) return;
  const item = s.items[itemIdx];
  const name = item.obraName || 'la entrada';
  const eraHoy = _editSesionEsHoy();
  const planId = item._planId;
  const liveEntity = eraHoy && planId ? currentPlan.find(e => (e._planId || e.id) === planId) : null;
  const snap = {
    sesion: s, item, itemIdx, eraHoy, planId,
    liveEntity, liveIdx: liveEntity ? currentPlan.indexOf(liveEntity) : -1,
    tick: sessionTicks[planId], minPlan: sessionMinPlan[planId],
    sol: sessionSolRatings[planId], prod: sessionProductivityRatings[planId],
    agg: sessionAggregate[planId], dest: sessionDestello[planId],
  };
  s.items.splice(itemIdx, 1);
  if (eraHoy) _editSyncLivePlan(item, { remove: true });
  renderEditExistingItems();
  saveData();
  if (eraHoy) { if (typeof saveDraft === 'function') saveDraft(); refreshConcentradoUI(); }
  showUndoToast('Eliminado: ' + name, () => _undoDeleteEditItem(snap));
}

function _undoDeleteEditItem(snap) {
  if (snap.sesion && Array.isArray(snap.sesion.items)) {
    const at = Math.min(snap.itemIdx, snap.sesion.items.length);
    snap.sesion.items.splice(at, 0, snap.item);
  }
  if (snap.eraHoy && snap.liveEntity && !currentPlan.some(e => (e._planId || e.id) === snap.planId)) {
    const at = snap.liveIdx >= 0 ? Math.min(snap.liveIdx, currentPlan.length) : currentPlan.length;
    currentPlan.splice(at, 0, snap.liveEntity);
    if (snap.tick !== undefined) sessionTicks[snap.planId] = snap.tick;
    if (snap.minPlan !== undefined) sessionMinPlan[snap.planId] = snap.minPlan;
    if (snap.sol !== undefined) sessionSolRatings[snap.planId] = snap.sol;
    if (snap.prod !== undefined) sessionProductivityRatings[snap.planId] = snap.prod;
    if (snap.agg !== undefined) sessionAggregate[snap.planId] = snap.agg;
    if (snap.dest !== undefined) sessionDestello[snap.planId] = snap.dest;
  }
  saveData();
  if (snap.eraHoy) { if (typeof saveDraft === 'function') saveDraft(); refreshConcentradoUI(); }
  renderEditExistingItems();
  showToast('Restaurado ✓');
}

function addEditObraItem() {
  const val  = document.getElementById('editObraSelect')?.value;
  const min  = parseInt(document.getElementById('editMinutos')?.value) || 0;
  if (!val) return;

  let label;
  if (val.startsWith('mov::')) {
    const [,obraId,movId] = val.split('::');
    const obra = findObra(obraId);
    const mov  = obra?.movimientos?.find(m=>m.id===movId);
    label = (obra?.name || '') + ' · ' + (mov?.name || '');
  } else {
    label = findObra(val.replace('obra::',''))?.name || val;
  }

  _editObraItems.push({ val, min, label });
  const list = document.getElementById('editObraList');
  list.innerHTML = _editObraItems.map((it,i) =>
    '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border2)">'
    + '<span>' + it.label + '</span>'
    + '<span>' + (it.min ? it.min + 'min' : '—') + '</span>'
    + '</div>'
  ).join('');
}

function confirmEditarSesion() {
  if (_editSesionIdx < 0) return;
  const s = db.sesiones[_editSesionIdx];

  // Add extra obras (newly added in this edit session)
  _editObraItems.forEach(function(it) {
    let obraId, movId, obraName;
    if (it.val.startsWith('mov::')) {
      const [,o,m] = it.val.split('::');
      obraId=o; movId=m;
      obraName = it.label;
    } else {
      obraId = it.val.replace('obra::','');
      movId = null;
      obraName = it.label;
    }
    if (!s.items) s.items = [];
    s.items.push({ obraId, movId, obraName, manual: true, tick: 'hecho',
      minutosReales: it.min || null, note: '', objetivo: '' });
  });

  // Nota general
  const nota = document.getElementById('editNota')?.value.trim();
  if (nota !== undefined) s.notaGeneral = nota;

  // Recomputar el rating agregado de la sesión a partir de los ratings
  // individuales que sobrevivan tras posibles ediciones/borrados.
  const surviving = (s.items || []).filter(i => i.rating != null).map(i => i.rating);
  s.rating = surviving.length
    ? Math.round(surviving.reduce((acc, v) => acc + v, 0) / surviving.length)
    : null;

  // Si editamos la sesión de HOY, los cambios ya se sincronizaron con el estado
  // en memoria (vía _editSyncLivePlan). Persistimos el draft y refrescamos el
  // tiempo concentrado para que se vea al instante y el autosave no lo revierta.
  const editamosHoy = _editSesionEsHoy();

  saveData();
  closeModal('modalEditarSesion');
  renderSesionesHistorial();
  if (typeof renderEstadoSection === 'function') renderEstadoSection();
  if (typeof renderRacha === 'function') renderRacha();
  if (editamosHoy) {
    if (typeof saveDraft === 'function') saveDraft();
    if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
  }
  showToast('Sesión actualizada');
  if (typeof SFX !== 'undefined' && SFX.save) SFX.save();
}

function spawnNotes() {
  const deco = document.getElementById('notesDeco');
  if (!deco) return;
  const notes = ['♩','♪','♫','♬'];
  function spawn() {
    if (!document.getElementById('notesDeco')) return;
    // No spawnear durante modo concentración
    if (document.body.classList.contains('crono-focus')) {
      setTimeout(spawn, 4000);
      return;
    }
    const el = document.createElement('span');
    el.className = 'note-float';
    el.textContent = notes[Math.floor(Math.random() * notes.length)];
    el.style.left = (8 + Math.random() * 84) + '%';
    el.style.color = 'var(--accent)';
    el.style.animationDuration = (5.5 + Math.random() * 3.5) + 's';
    el.style.animationDelay = (Math.random() * 1.5) + 's';
    el.style.fontSize = (11 + Math.random() * 7) + 'px';
    deco.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    // Mucho más espaciado: una nota cada 5-9 segundos en lugar de cada 1.5-3.5
    setTimeout(spawn, 5000 + Math.random() * 4000);
  }
  spawn();
}

// ─── WIRE UP SOUNDS ──────────────────────────────────────────────────────────

// Generate session
const _origGenerateSession = generateSession;
generateSession = function() { SFX.generate(); _origGenerateSession(); };

// Save session → opens rating modal (sound plays on rating confirm)
const _origSaveSession = saveSession;
saveSession = function() { _origSaveSession(); };

// Rating confirm — the real "session saved" sound
const _origCloseRatingSesion = closeRatingSesion;
closeRatingSesion = function(save) {
  if (save) { SFX.saveSession(); Haptics.success(); } else SFX.close();
  _origCloseRatingSesion(save);
};

// Tick buttons
const _origSetTick = setTick;
setTick = function(planId, tick, btn, minPlan) {
  if (tick === 'saltado') { SFX.skip(); Haptics.warn(); }
  else if (tick === 'hecho') Haptics.success();
  else { SFX.open(); Haptics.light(); }
  btn.classList.remove('tick-pop'); void btn.offsetWidth; btn.classList.add('tick-pop');
  _origSetTick(planId, tick, btn, minPlan);
};

// Hecho modal confirm
const _origCloseHechoDatos = closeHechoDatos;
closeHechoDatos = function(save) {
  if (save) { SFX.tick(); Haptics.success(); }
  else SFX.close();
  _origCloseHechoDatos(save);
};

// Open modal — soft tap
const _origOpenModal = openModal;
openModal = function(id) { SFX.open(); Haptics.light(); _origOpenModal(id); };

// Close modal — subtle
const _origCloseModal = closeModal;
closeModal = function(id) { SFX.close(); _origCloseModal(id); };

// Pase confirm
const _origConfirmPase = confirmPase;
confirmPase = function() { SFX.pase(); Haptics.medium(); _origConfirmPase(); };

// Tab navigation
const _origShowView = showView;
showView = function(name) { SFX.nav(); Haptics.light(); _origShowView(name); };

// Add obra / evento
const _origOpenAddObra = openAddObra;
openAddObra = function() { SFX.add(); Haptics.light(); _origOpenAddObra(); };

// Confirm add obra (the real function is `addObra`)
if (typeof addObra === 'function') {
  const _origAddObra = addObra;
  addObra = function() { SFX.save(); Haptics.medium(); _origAddObra(); };
}

// Delete obra/pasaje — subtle descending
const _origDeleteObra = deleteObra;
deleteObra = function(id) { SFX.del(); Haptics.warn(); _origDeleteObra(id); };

// Add pasaje
const _origAddPasaje = addPasaje;
addPasaje = function(obraId) { SFX.pasaje(); Haptics.light(); _origAddPasaje(obraId); };

// Event realizado — milestone arpeggio
const _origConfirmEventoResultado = confirmEventoResultado;
confirmEventoResultado = function() { SFX.milestone(); Haptics.success(); _origConfirmEventoResultado(); };

// Estado sliders — throttled blip
let _sliderSfxTimeout = null;
const _origUpdateEstado = updateEstado;
updateEstado = function(dim, val) {
  clearTimeout(_sliderSfxTimeout);
  _sliderSfxTimeout = setTimeout(() => SFX.slider(), 80);
  _origUpdateEstado(dim, val);
};

// Rating slider — throttled blip
const _origUpdateRatingSlider = updateRatingSlider;
updateRatingSlider = function(val) {
  clearTimeout(_sliderSfxTimeout);
  _sliderSfxTimeout = setTimeout(() => SFX.slider(), 80);
  _origUpdateRatingSlider(val);
};

// Time slider — sonido sutil con debounce (no martillear al arrastrar)
const _origSetTimeFromSlider = setTimeFromSlider;
let _timeSliderSfxTimeout = null;
setTimeFromSlider = function(minVal) {
  clearTimeout(_timeSliderSfxTimeout);
  _timeSliderSfxTimeout = setTimeout(() => SFX.slider(), 70);
  _origSetTimeFromSlider(minVal);
};

// Pase toggle (antes/despues in hecho modal)
const _origTogglePaseBlock = togglePaseBlock;
togglePaseBlock = function(cual) { SFX.toggle(); Haptics.light(); _origTogglePaseBlock(cual); };

// Intensidad pasaje
const _origSelectPasajeIntensidad = selectPasajeIntensidad;
selectPasajeIntensidad = function(id, nivel, btn) {
  SFX.toggle();
  Haptics.light();
  _origSelectPasajeIntensidad(id, nivel, btn);
};

// Ripple on key buttons
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.generate-btn,.save-session-btn,.modal-btn.primary,.energy-btn,.tick-btn,.nav-btn,.time-btn,.register-pase-btn,.pase-btn,.obra-quick-btn,.stepper-btn,.memlapse-btn,.pase-toggle-btn,.evento-done-btn');
  if (btn) addRipple(btn, e);
});



// ─── AUTH & SUPABASE INIT ─────────────────────────────────────────────────────
// Pantalla de login eliminada. Auto-login silencioso desde credenciales
// guardadas. Estas funciones se mantienen como no-op por compatibilidad
// (podrían ser llamadas desde el SFX wrapper o desde un onclick antiguo).

function toggleAuthMode() {}
async function doAuth() {}
function _clearLocalAccountData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) localStorage.setItem('alberto_local_backup_v1', raw);
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(SYNC_META_KEY);
    localStorage.removeItem('pianoCrono_v2');
    localStorage.removeItem('alberto_forest_draft');
  } catch(e) {}
  db = getDefaultData();
  if (typeof currentPlan !== 'undefined' && Array.isArray(currentPlan)) currentPlan.length = 0;
  [typeof sessionTicks !== 'undefined' ? sessionTicks : null,
   typeof sessionMinPlan !== 'undefined' ? sessionMinPlan : null,
   typeof sessionAggregate !== 'undefined' ? sessionAggregate : null,
   typeof sessionSolRatings !== 'undefined' ? sessionSolRatings : null,
   typeof sessionProductivityRatings !== 'undefined' ? sessionProductivityRatings : null,
   typeof sessionDestello !== 'undefined' ? sessionDestello : null]
    .forEach(map => { if (map) Object.keys(map).forEach(key => delete map[key]); });
  if (typeof cronoReset === 'function') cronoReset();
  try {
    if (typeof renderObras === 'function') renderObras();
    if (typeof renderCalendario === 'function') renderCalendario();
    if (typeof renderSesionesHistorial === 'function') renderSesionesHistorial();
    if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
    if (typeof updateHeader === 'function') updateHeader();
  } catch(e) {}
}

async function doLogout(options) {
  options = options || {};
  const meta = _readSyncMeta();
  if (typeof SyncCore !== 'undefined' && SyncCore.isDirty(meta)) {
    const retry = options.silent || confirm('Hay cambios locales pendientes de sincronizar. ¿Reintentar ahora?');
    if (retry) await syncPendingCloudChanges();
    const stillDirty = typeof SyncCore !== 'undefined' && SyncCore.isDirty(_readSyncMeta());
    if (stillDirty && !options.silent && !confirm('La nube no responde. Puedes cerrar sesión conservando una copia local. ¿Continuar?')) return false;
  }
  let signOutError = null;
  try {
    const sb = getSB();
    const result = await sb.auth.signOut();
    if (result && result.error) signOutError = result.error;
  } catch(e) {
    signOutError = e;
  }
  _clearLocalAccountData();
  showView('session');
  updateSyncStatusInfo();
  updateAjustesAccountRow();
  if (signOutError) showToast('Sesión cerrada en este dispositivo; no se pudo contactar con la nube.');
  else if (!options.silent) showToast('Sesión cerrada');
  return true;
}

async function switchAccount() {
  const ok = await doLogout();
  if (ok) openModal('modalCloudSync');
}

// Llamado desde el modal "Recuperar datos" cuando una instalación nueva no
// tiene datos locales y el usuario quiere bajárselos de la nube.
async function doCloudSync() {
  const email = (document.getElementById('cloudEmail')?.value || '').trim();
  const pass = document.getElementById('cloudPass')?.value || '';
  const errEl = document.getElementById('cloudSyncError');
  const btn = document.getElementById('cloudSyncBtn');
  if (errEl) errEl.textContent = '';
  if (!email || !pass) { if (errEl) errEl.textContent = 'Email y contraseña requeridos'; return; }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const sb = getSB();
    const { data: { session: currentSession } } = await sb.auth.getSession();
    if (currentSession && currentSession.user && currentSession.user.email &&
        currentSession.user.email.toLowerCase() !== email.toLowerCase()) {
      const switched = await doLogout({ silent: true });
      if (!switched) {
        if (errEl) errEl.textContent = 'No se pudo cambiar de cuenta';
        if (btn) { btn.disabled = false; btn.textContent = 'Recuperar'; }
        return;
      }
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      const msgs = {
        'Invalid login credentials': 'Email o contraseña incorrectos',
        'Email not confirmed': 'Confirma tu email primero',
      };
      if (errEl) errEl.textContent = msgs[error.message] || error.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Recuperar'; }
      return;
    }
    if (data.session) {
      await onAuthSuccess();
      closeModal('modalCloudSync');
      showToast('Datos sincronizados ✓');
    }
  } catch(e) {
    if (errEl) errEl.textContent = 'Error: ' + (e.message || 'sin red');
    if (btn) { btn.disabled = false; btn.textContent = 'Recuperar'; }
  }
}

// Abre Ajustes y refresca el panel de estado de sincronización
// Ajustes es una pantalla completa (#view-ajustes), no un modal. Guardamos la
// vista anterior para que la flecha ← devuelva a donde estaba el usuario.
let _ajustesPrevView = 'session';
function openSettings() {
  const cur = document.body.getAttribute('data-view');
  if (cur && cur !== 'ajustes') _ajustesPrevView = cur;
  showView('ajustes');
  const sc = document.querySelector('.app-content');
  if (sc) sc.scrollTop = 0;
  if (typeof refreshTheme === 'function') refreshTheme();          // marca el tema activo
  _syncAjustesActiveOptions();                                      // marca fuente/tamaño activos
  if (typeof updateSyncStatusInfo === 'function') updateSyncStatusInfo();
  if (typeof updateAjustesAccountRow === 'function') updateAjustesAccountRow();
  if (typeof refreshSoundOptionUI === 'function') refreshSoundOptionUI();
  if (typeof refreshHapticsUI === 'function') refreshHapticsUI();
  if (typeof updateForestPendientesBtn === 'function') updateForestPendientesBtn();
  if (typeof updateAppVersionInfo === 'function') updateAppVersionInfo();
  if (typeof updateAiExportControls === 'function') updateAiExportControls();
}

// Vuelve a la pantalla desde la que se abrió Ajustes.
function closeAjustes() {
  showView(_ajustesPrevView || 'session');
}

// Re-marca como activas las opciones de fuente y tamaño según lo guardado
// (el tema lo marca refreshTheme). Necesario al abrir la pantalla de Ajustes.
function _syncAjustesActiveOptions() {
  const size = normalizeTextSizePreference(localStorage.getItem('alberto_size'));
  document.querySelectorAll('.size-option').forEach(b => {
    const active = b.dataset.size === size;
    b.classList.toggle('active', active);
    b.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}

// Refresca la información de estado en Ajustes
async function updateSyncStatusInfo() {
  const el = document.getElementById('syncStatusInfo');
  if (!el) return;
  const pending = typeof SyncCore !== 'undefined' && SyncCore.isDirty(_readSyncMeta());
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      el.innerHTML = '✓ Conectado como <span style="color:var(--accent)">' + user.email + '</span><br>'
        + '<span style="font-size:9px">' + (pending ? 'Hay cambios locales pendientes de sincronizar.' : 'Tus datos se guardan también en la nube.') + '</span>';
    } else {
      el.innerHTML = '<span style="color:var(--orange)">⚠ Sin sesión activa</span><br>'
        + '<span style="font-size:9px">La app está funcionando solo en este dispositivo. Pulsa "Re-sincronizar" para conectar con tu cuenta.</span>';
    }
  } catch(e) {
    el.innerHTML = '<span style="color:var(--text3)">Sincronización no disponible (sin red o sin cuenta).</span>';
  }
}

// Fila de cuenta destacada de Ajustes (estilo iOS/Forest): avatar con la
// inicial del email, el correo y el estado de sincronización. Toca → baja a la
// tarjeta de Sincronización (con sus acciones).
async function updateAjustesAccountRow() {
  const av = document.getElementById('ajustesAccountAvatar');
  const nm = document.getElementById('ajustesAccountName');
  const sb2 = document.getElementById('ajustesAccountSub');
  if (!av || !nm || !sb2) return;
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (user && user.email) {
      av.textContent = user.email.charAt(0).toUpperCase();
      nm.textContent = user.email;
      sb2.textContent = 'Sincronizado en la nube';
      sb2.style.color = '';
    } else {
      av.textContent = '·';
      nm.textContent = 'Sin sesión';
      sb2.textContent = 'Solo en este dispositivo · toca para conectar';
      sb2.style.color = 'var(--orange)';
    }
  } catch(e) {
    av.textContent = '·';
    nm.textContent = 'Cuenta';
    sb2.textContent = 'Sincronización no disponible';
    sb2.style.color = '';
  }
}

function ajustesAccountTap() {
  const card = document.getElementById('syncStatusInfo');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Fuerza una re-sincronización con la nube. Útil si los datos locales se han
// desincronizado o si se sospecha que la nube tiene una versión más reciente.
async function forceCloudResync() {
  if (!confirm('Re-sincronizar con la nube descargará los datos remotos y reemplazará lo que haya en este dispositivo si la nube es más reciente.\n\n¿Continuar?')) return;
  try {
    const sb = getSB();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      // No hay sesión — pedir credenciales
      closeModal('modalSettings');
      openModal('modalCloudSync');
      return;
    }
    showSyncIndicator('↺ sincronizando…');
    const reloaded = await loadFromCloud();
    if (reloaded) {
      renderObras();
      renderCalendario();
      renderSesionesHistorial();
      if (typeof renderEstadoSection === 'function') renderEstadoSection();
      if (typeof renderRacha === 'function') renderRacha();
      updateHeader();
      updateSyncStatusInfo();
      // Reconstruir tarjetas de hoy si el plan local está vacío (caso típico:
      // sincronización tras instalación nueva)
      if (typeof restoreSessionFromDbToday === 'function' && (!currentPlan || currentPlan.length === 0)) {
        restoreSessionFromDbToday();
        if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
      }
      showToast('Datos actualizados desde la nube ✓');
    } else {
      showToast('No había datos nuevos en la nube');
    }
  } catch(e) {
    showToast('Error sincronizando: ' + (e.message || 'sin red'));
  }
}

async function onAuthSuccess() {
  // (la pantalla de login ha sido eliminada — esta función sólo carga datos
  // desde la nube si hay sesión válida)
  const reloaded = await loadFromCloud();
  if (reloaded) {
    renderObras();
    renderCalendario();
    if (document.getElementById('view-historial')?.classList.contains('active')) {
      renderSesionesHistorial();
      renderEficienciaSection();
      renderEstadoSection();
    }
    updateHeader();
    // ★ Tras bajar de nube, recargar los sliders de estado diario si la nube
    // tiene un estado más reciente que el local. Esto resuelve "abro la app
    // en otro dispositivo y los sliders están en defaults en vez de donde
    // los puse hace 10 minutos en el otro iPad".
    loadEstadoDiarioFromSources();
    if (typeof initEstadoSliders === 'function') initEstadoSliders();
    // Tras descargar de la nube, queremos que el plan refleje la unión más
    // completa de lo que hay. Estrategia:
    //  - Si el plan en memoria está vacío → restaurar desde db.sesiones[hoy].
    //  - Si el plan en memoria YA tiene tarjetas → comparar con db.sesiones[hoy]:
    //      * Si la nube tiene MÁS tarjetas que el local (caso típico:
    //        instalación nueva sincronizando), usar la nube.
    //      * Si el local tiene más o igual, conservar local (caso: autoSave
    //        de la nube quedó atrás).
    // Esto previene el bug en que `force:true` machacaba draft válido con una
    // nube parcial y borraba tarjetas.
    if (typeof restoreSessionFromDbToday === 'function') {
      const today = new Date().toDateString();
      const sesionNube = (db.sesiones || []).find(s => new Date(s.date).toDateString() === today);
      const itemsNube = sesionNube && Array.isArray(sesionNube.items) ? sesionNube.items.length : 0;
      const itemsLocal = Array.isArray(currentPlan) ? currentPlan.length : 0;
      if (itemsLocal === 0 && itemsNube > 0) {
        restoreSessionFromDbToday();
        if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
      } else if (itemsNube > itemsLocal) {
        // Nube tiene más tarjetas — restaurar con force porque la nube es la
        // fuente más completa en este caso (instalación reciente).
        const restored = restoreSessionFromDbToday({ force: true });
        if (restored && typeof refreshConcentradoUI === 'function') {
          refreshConcentradoUI();
        }
      } else {
        // Local tiene tantas o más tarjetas — NO machacar. Esto preserva
        // las tarjetas locales que aún no se hayan sincronizado a la nube.
        // Disparamos un autoSave para subir las que faltan.
        if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
      }
    }
    refreshStudyViews();
  }
}

async function initApp() {
  // Hide splash after a guaranteed minimum display time.
  setTimeout(function() {
    const s = document.getElementById('splashScreen');
    if (!s || s.classList.contains('gone')) return;
    s.classList.add('fade-out');
    setTimeout(function() { s.classList.add('gone'); }, 650);
  }, 1200);

  // Load local data first so app is usable immediately
  db = loadData();

  // Init UI
  loadTheme();
  loadEstadoDiarioFromSources();
  initEstadoSliders();
  initTimeSlider();
  _currentPlanDay = new Date().toDateString();
  const draftLoaded = loadDraft();
  // Si no había draft local pero hay sesiones de hoy guardadas en la nube/db,
  // reconstruir el plan para que las tarjetas no desaparezcan.
  if (!draftLoaded && typeof restoreSessionFromDbToday === 'function') {
    restoreSessionFromDbToday();
  }
  ensureSessionPlanScaffold();
  updateHeader();
  spawnNotes();
  if (typeof renderRacha === 'function') renderRacha();
  if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI();
  if (typeof renderSessionJournal === 'function') renderSessionJournal();
  if (typeof updateAiExportControls === 'function') updateAiExportControls();
  // Programar el chequeo de medianoche y escuchar visibilitychange por si el
  // setTimeout falla (móviles que duermen tabs en background)
  scheduleNextMidnightCheck();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkDayChange();
    }
  });
  // Listener adicional en window.focus por si visibilitychange no se dispara
  // en algunos navegadores móviles tras volver del background
  window.addEventListener('focus', () => {
    checkDayChange();
  });
  // Comprobación periódica cada 60 segundos: es barato y garantiza que aunque
  // setTimeout falle por estar suspendido, en cuanto la tab despierta se
  // detecte el cambio de día en el siguiente intervalo.
  setInterval(checkDayChange, 60 * 1000);
  // Probabilidad de hoy: refresco periódico para que baje sola con la hora
  // aunque el cronómetro esté parado (recalcula solo si cambió el minuto/min hechos).
  setInterval(() => { if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(); }, 30 * 1000);

  // Forest draft
  try {
    const fd = JSON.parse(localStorage.getItem('alberto_forest_draft') || 'null');
    if (fd && fd.tags && fd.tags.length) {
      forestTagData = fd.tags;
      const btn = document.getElementById('forestReopenBtn');
      if (btn) btn.style.display = 'block';
    }
  } catch(e) {}

  // ── DETECCIÓN DE INSTALACIÓN VACÍA ─────────────────────────────────────────
  // Importante: este chequeo va FUERA del try-catch de Supabase para que
  // funcione incluso si Supabase no carga (ej. red lenta, bloqueador). Si
  // detectamos una instalación vacía sin credenciales, abrimos el modal
  // de recuperación independientemente del estado de Supabase.
  const _hayObras = (db.obras || []).length > 0;
  const _haySesiones = (db.sesiones || []).length > 0;
  const _instalacionVacia = !_hayObras && !_haySesiones;
  // Migración de seguridad: las versiones antiguas guardaban la contraseña
  // completa en localStorage. La sesión persistida de Supabase es suficiente.
  try { localStorage.removeItem('piano_auto_creds'); } catch(e) {}

  // ── SUPABASE AUTO-SYNC ─────────────────────────────────────────────────────
  // Estrategia:
  // 1. Si hay sesión válida → cargar datos cloud y seguir.
  // 2. Si hay credenciales guardadas → re-login silencioso.
  // 3. Si NO hay sesión, NO hay credenciales y NO hay datos locales (instalación
  //    nueva — típicamente PWA recién añadida a pantalla de inicio en iOS, que
  //    tiene almacenamiento separado del Safari del navegador) → mostrar modal
  //    para que el usuario recupere sus datos de la nube.
  // 4. Si no hay sesión ni credenciales pero SÍ hay datos locales → seguir
  //    funcionando en local sin molestar.
  try {
    if (typeof supabase === 'undefined') throw new Error('Supabase not loaded');
    const sb = getSB();

    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await onAuthSuccess();
      return;
    }

    // Si la instalación está vacía y no hay credenciales válidas, ofrecer
    // recuperación cloud
    if (_instalacionVacia) {
      setTimeout(() => openModal('modalCloudSync'), 400);
    }

    // En cualquier caso, escuchar futuros cambios de auth
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await onAuthSuccess();
      }
    });

  } catch(e) {
    console.warn('Auth/sync no disponible, modo local:', e.message);
    // Si Supabase falló pero la instalación está vacía, igual abrimos el modal
    // (el usuario podrá reintentar cuando vuelva la red)
    if (_instalacionVacia) {
      setTimeout(() => openModal('modalCloudSync'), 400);
    }
  }
}

// Adjust app-content top padding - measure after layout settles
function adjustTopPadding() {
  const topbar = document.querySelector('.topbar');
  const c = document.querySelector('.app-content');
  if (!topbar || !c) return;
  const h = topbar.getBoundingClientRect().height;
  if (h > 20) {
    c.style.paddingTop = (h + 4) + 'px'; // +4px buffer
  }
}
// Run immediately, after 100ms, and on resize/orientation change
adjustTopPadding();
if (!document.body.getAttribute('data-view')) document.body.setAttribute('data-view', 'session');
_applySessionClean();
setTimeout(adjustTopPadding, 100);
setTimeout(adjustTopPadding, 500);
setTimeout(initEstadoSliders, 300);
window.addEventListener('resize', adjustTopPadding);
window.addEventListener('orientationchange', function() { setTimeout(adjustTopPadding, 300); });
if (window.ResizeObserver) {
  new ResizeObserver(adjustTopPadding).observe(document.querySelector('.topbar'));
}

// ── CRONÓMETRO ──────────────────────────────────────────────────────────────
// Cronómetro tipo Forest integrado en la app. Selecciona obra/movimiento,
// arranca, puede pausar (máx 5 min) o parar. Al parar con ≥10 min, se añade
// como sesión extra a currentPlan y se abre automáticamente el modal hechoDatos.
// Si dura <10 min, se descarta como fallida.
// La vista activa el "modo concentración": oculta la topbar y muestra una X.

const CRONO_STORAGE_KEY = 'pianoCrono_v2';
const CRONO_MIN_MIN = 10;                  // mínimo de minutos para que cuente
const CRONO_PAUSE_LIMIT_MS = 5 * 60 * 1000; // 5 minutos máx de pausa

// ── PALETA DE COLORES PERSONALIZABLES PARA OBRAS ────────────────────────────
// 8 colores cuidados, calmados, distinguibles. Cada obra puede tener uno.
// "default" es null y usa var(--accent) del tema.
const OBRA_COLORS = [
  // Por defecto: hereda el accent del tema
  { id: 'default',  hex: null,        name: 'Tema' },
  // Cálidos
  { id: 'amber',    hex: '#c8a030',   name: 'Ámbar' },
  { id: 'sunset',   hex: '#d59060',   name: 'Atardecer' },
  { id: 'rust',     hex: '#b86b50',   name: 'Óxido' },
  { id: 'coral',    hex: '#d77f7a',   name: 'Coral' },
  { id: 'rose',     hex: '#c87878',   name: 'Rosa' },
  // Rojos y vinos
  { id: 'crimson',  hex: '#a85060',   name: 'Carmín' },
  { id: 'wine',     hex: '#8a4858',   name: 'Vino' },
  { id: 'plum',     hex: '#a06880',   name: 'Ciruela' },
  // Violetas y azules
  { id: 'mauve',    hex: '#9580a8',   name: 'Malva' },
  { id: 'violet',   hex: '#9b7ac8',   name: 'Violeta' },
  { id: 'indigo',   hex: '#7080b8',   name: 'Índigo' },
  { id: 'sky',      hex: '#6a9ac8',   name: 'Cielo' },
  { id: 'ocean',    hex: '#508aa0',   name: 'Océano' },
  // Verdes
  { id: 'teal',     hex: '#5ea8a0',   name: 'Verde mar' },
  { id: 'sage',     hex: '#7ba87a',   name: 'Salvia' },
  { id: 'forest',   hex: '#4a8a5a',   name: 'Bosque' },
  { id: 'moss',     hex: '#7a9560',   name: 'Musgo' },
  { id: 'olive',    hex: '#9a9050',   name: 'Oliva' },
  // Neutros
  { id: 'sand',     hex: '#bba585',   name: 'Arena' },
  { id: 'stone',    hex: '#8a8a8a',   name: 'Piedra' },
  { id: 'charcoal', hex: '#5a5a5a',   name: 'Carbón' },
];
function obraColorHex(obra) {
  if (!obra || !obra.color || obra.color === 'default') return null;
  const c = OBRA_COLORS.find(x => x.id === obra.color);
  return c ? c.hex : null;
}
function obraColorOrAccent(obra) {
  return obraColorHex(obra) || 'var(--accent)';
}

// Abrir picker de color para una obra concreta
function openObraColorPicker(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  const grid = document.getElementById('obraColorGrid');
  if (!grid) return;
  const currentId = obra.color || 'default';
  grid.innerHTML = OBRA_COLORS.map(c => {
    const isActive = c.id === currentId;
    const isDefault = c.id === 'default';
    const innerStyle = isDefault
      ? ''
      : 'background:' + c.hex + ';';
    return '<button class="obra-color-option' + (isActive ? ' active' : '') + (isDefault ? ' is-default' : '') + '" ' +
      'title="' + c.name + '" ' +
      'style="color:' + (c.hex || 'var(--accent)') + '" ' +
      'onclick="setObraColor(\'' + obraId + '\',\'' + c.id + '\')">' +
      '<span class="obra-color-option-inner" style="' + innerStyle + '"></span>' +
    '</button>';
  }).join('');
  openModal('modalObraColor');
}

function setObraColor(obraId, colorId) {
  const obra = findObra(obraId);
  if (!obra) return;
  if (colorId === 'default') delete obra.color;
  else obra.color = colorId;
  saveData();
  // Actualizar UI: el dot del header y el color en cronómetro si está en uso
  renderObras();
  if (crono.obraId === obraId) {
    crono.color = obraColorHex(obra);
    cronoSaveState();
    cronoApplyColor(crono.color);
  }
  closeModal('modalObraColor');
}

const crono = {
  state: 'idle',         // 'idle' | 'running' | 'paused'
  mode: 'stopwatch',     // 'stopwatch' | 'timer' | 'until'
  timerMinutes: 25,      // minutos seleccionados en modo timer (5..120, step 5)
  untilTime: '',         // HH:MM seleccionado en modo "hasta hora"
  targetMinutes: null,   // minutos objetivo de la sesión en curso (timer mode); null en stopwatch
  targetDurationMs: null,// objetivo persistido en ms; null en cronómetro libre
  runId: null,           // identificador estable de la ejecución actual
  isRest: false,         // true si la sesión actual es un DESCANSO (no cuenta como estudio)
  obraId: null,
  movId: null,
  displayName: '',
  subName: '',
  color: null,           // hex personalizable de la obra; null = accent del tema
  startTs: 0,            // ms al pulsar Comenzar
  pausedMs: 0,           // ms acumulados en pausa
  pauseStartTs: 0,       // ms del inicio de la pausa actual
  tickInterval: null,
  pauseInterval: null,
  lastCountdownSecond: null,
  notes: [],
  observation: '',
};

let _cronoPendingFinishRunId = null;
let _cronoFinalizingRunId = null;

let _cronoWakeLock = null;
let _cronoWakeRetryTimer = null;
let _cronoWakeRetryCount = 0;
let _cronoWakeManualReleaseUntil = 0;
let _cronoWakeLastError = '';

function cronoWakeLockSupported() {
  return !!(navigator && navigator.wakeLock && typeof navigator.wakeLock.request === 'function');
}

function cronoShouldKeepAwake() {
  return crono.state === 'running' && document.visibilityState === 'visible';
}

function cronoClearWakeRetry() {
  if (_cronoWakeRetryTimer) {
    clearTimeout(_cronoWakeRetryTimer);
    _cronoWakeRetryTimer = null;
  }
}

function cronoMarkWakeStatus(status) {
  try { document.body.dataset.cronoWake = status || 'off'; } catch(e) {}
}

function cronoScheduleWakeLockRetry(delayMs) {
  cronoClearWakeRetry();
  if (!cronoShouldKeepAwake() || !cronoWakeLockSupported()) return;
  const delay = Math.max(600, Math.min(delayMs || 1500, 12000));
  _cronoWakeRetryTimer = setTimeout(() => {
    _cronoWakeRetryTimer = null;
    cronoAcquireWakeLock();
  }, delay);
}

async function cronoAcquireWakeLock() {
  if (!cronoShouldKeepAwake()) return;
  if (!cronoWakeLockSupported()) {
    _cronoWakeLastError = 'unsupported';
    cronoMarkWakeStatus('unsupported');
    return;
  }
  if (_cronoWakeLock) {
    cronoMarkWakeStatus('on');
    return;
  }

  try {
    cronoClearWakeRetry();
    const lock = await navigator.wakeLock.request('screen');
    if (!cronoShouldKeepAwake()) {
      try { await lock.release(); } catch(e) {}
      return;
    }

    _cronoWakeLock = lock;
    _cronoWakeRetryCount = 0;
    _cronoWakeLastError = '';
    cronoMarkWakeStatus('on');
    lock.addEventListener('release', () => {
      if (_cronoWakeLock === lock) _cronoWakeLock = null;
      cronoMarkWakeStatus('off');
      if (Date.now() < _cronoWakeManualReleaseUntil) return;
      if (cronoShouldKeepAwake()) cronoScheduleWakeLockRetry(900);
    });
  } catch(e) {
    _cronoWakeLock = null;
    _cronoWakeLastError = (e && (e.name || e.message)) ? (e.name || e.message) : 'WakeLockError';
    cronoMarkWakeStatus('blocked');
    _cronoWakeRetryCount += 1;
    if (_cronoWakeRetryCount <= 8) {
      cronoScheduleWakeLockRetry(1200 + (_cronoWakeRetryCount * 900));
    }
  }
}

async function cronoReleaseWakeLock() {
  cronoClearWakeRetry();
  _cronoWakeRetryCount = 0;
  _cronoWakeManualReleaseUntil = Date.now() + 2000;
  const lock = _cronoWakeLock;
  _cronoWakeLock = null;
  cronoMarkWakeStatus('off');
  if (lock) {
    try { await lock.release(); } catch(e) {}
  }
}

function cronoRefreshWakeLock() {
  if (cronoShouldKeepAwake()) cronoAcquireWakeLock();
  else if (document.visibilityState !== 'visible') cronoClearWakeRetry();
}

document.addEventListener('visibilitychange', cronoHandleLifecycleResume);
window.addEventListener('focus', cronoRefreshWakeLock);
window.addEventListener('pageshow', cronoHandleLifecycleResume);
['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evt => {
  document.addEventListener(evt, cronoRefreshWakeLock, evt === 'keydown' ? false : { passive: true });
});

// Pases registrados durante la sesión (drawer lateral) — se pre-rellenan en el modal Hecho
let _cronoDraftPases = { antesActive: false, antesVal: 50, despuesActive: false, despuesVal: 60 };
let _cronoPaseDrawerOpen = false;
let _cronoRunDrawerTab = 'pasajes';

// Iconos SVG inline (currentColor para integrarse con la paleta)
const CRONO_ICONS = {
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  stop:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
};

function cronoSaveState() {
  try {
    localStorage.setItem(CRONO_STORAGE_KEY, JSON.stringify({
      state: crono.state,
      mode: crono.mode,
      timerMinutes: crono.timerMinutes,
      untilTime: crono.untilTime,
      targetMinutes: crono.targetMinutes,
      targetDurationMs: crono.targetDurationMs,
      runId: crono.runId,
      isRest: crono.isRest,
      obraId: crono.obraId,
      movId: crono.movId,
      displayName: crono.displayName,
      subName: crono.subName,
      color: crono.color,
      startTs: crono.startTs,
      pausedMs: crono.pausedMs,
      pauseStartTs: crono.pauseStartTs,
      notes: Array.isArray(crono.notes) ? crono.notes.slice(-80) : [],
      observation: crono.observation || '',
    }));
  } catch(e) {}
}

function cronoLoadState() {
  try {
    const raw = localStorage.getItem(CRONO_STORAGE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    // Cargar siempre la preferencia de mode + timerMinutes (independiente del state)
    if (s.mode === 'stopwatch' || s.mode === 'timer' || s.mode === 'until') crono.mode = s.mode;
    if (typeof s.timerMinutes === 'number' && s.timerMinutes >= 5 && s.timerMinutes <= 120) {
      crono.timerMinutes = s.timerMinutes;
    }
    if (typeof s.untilTime === 'string') crono.untilTime = s.untilTime;
    crono.notes = Array.isArray(s.notes) ? s.notes.slice(-80).map(cronoNormalizeSessionNote).filter(Boolean) : [];
    crono.observation = typeof s.observation === 'string' ? s.observation.slice(0, 1600) : '';
    if (s.state !== 'running' && s.state !== 'paused') return false;
    if (!s.obraId || !s.startTs) return false;
    crono.state = s.state;
    crono.targetMinutes = s.targetMinutes || null;
    crono.targetDurationMs = Number.isFinite(s.targetDurationMs) && s.targetDurationMs > 0
      ? s.targetDurationMs
      : (crono.targetMinutes != null ? crono.targetMinutes * 60000 : null);
    crono.runId = s.runId || (typeof TimerCore !== 'undefined' ? TimerCore.createRunId() : ('run_' + Date.now()));
    crono.isRest = !!s.isRest;
    crono.obraId = s.obraId;
    crono.movId = s.movId || null;
    crono.displayName = s.displayName || '';
    crono.subName = s.subName || '';
    crono.color = s.color || null;
    crono.startTs = s.startTs;
    crono.pausedMs = s.pausedMs || 0;
    crono.pauseStartTs = s.pauseStartTs || 0;
    return true;
  } catch(e) { return false; }
}

function cronoClearState() {
  try { localStorage.removeItem(CRONO_STORAGE_KEY); } catch(e) {}
}

function cronoFmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
  return pad(m) + ':' + pad(s);
}

let _cronoNoteDraftPhase = 'during';

function cronoNoteId() {
  return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function cronoNoteMinuteFromElapsed(phase, elapsedMs, fallbackMin) {
  if (phase === 'before') return 0;
  if (phase === 'after') return fallbackMin != null ? Math.max(0, Math.round(Number(fallbackMin) || 0)) : null;
  const ms = Math.max(0, Number(elapsedMs) || 0);
  return Math.max(1, Math.ceil(ms / 60000));
}

function cronoNotePhaseLabel(phase, elapsedMs, fallbackMin) {
  if (phase === 'before') return 'antes';
  if (phase === 'after') return 'despues';
  const minute = cronoNoteMinuteFromElapsed('during', elapsedMs, fallbackMin);
  return 'minuto ' + minute;
}

function cronoNormalizeSessionNote(note) {
  if (!note) return null;
  const text = String(note.text || note.nota || '').trim();
  if (!text) return null;
  const phaseRaw = note.phase || note.momento || 'during';
  const phase = phaseRaw === 'before' || phaseRaw === 'after' || phaseRaw === 'during' ? phaseRaw : 'during';
  const elapsedMs = note.elapsedMs != null ? Math.max(0, Math.round(Number(note.elapsedMs) || 0)) : null;
  const minute = note.minute != null ? Math.max(0, Math.round(Number(note.minute) || 0)) : cronoNoteMinuteFromElapsed(phase, elapsedMs, note.fallbackMin);
  return {
    id: note.id || cronoNoteId(),
    text: text.slice(0, 1600),
    at: note.at || note.date || new Date().toISOString(),
    phase,
    phaseLabel: note.phaseLabel || cronoNotePhaseLabel(phase, elapsedMs, minute),
    minute,
    elapsedMs,
    state: note.state || null,
    mode: note.mode || null,
    obraId: note.obraId || null,
    movId: note.movId || null,
    displayName: note.displayName || note.obra || '',
    subName: note.subName || note.movimiento || '',
    source: note.source || 'crono',
  };
}

function cronoCreateSessionNote(text, phase, opts) {
  opts = opts || {};
  const realPhase = phase === 'before' || phase === 'after' || phase === 'during' ? phase : 'during';
  const elapsedMs = opts.elapsedMs != null
    ? Math.max(0, Number(opts.elapsedMs) || 0)
    : (crono.state === 'idle' ? 0 : cronoEffectiveElapsedMs());
  const minute = opts.minute != null ? opts.minute : cronoNoteMinuteFromElapsed(realPhase, elapsedMs, opts.fallbackMin);
  const selected = crono.state === 'idle'
    ? cronoResolveSelectValue(document.getElementById('cronoObraSelect')?.value || '')
    : null;
  return cronoNormalizeSessionNote({
    id: cronoNoteId(),
    text,
    at: opts.at || new Date().toISOString(),
    phase: realPhase,
    phaseLabel: opts.phaseLabel || cronoNotePhaseLabel(realPhase, elapsedMs, minute),
    minute,
    elapsedMs,
    state: crono.state,
    mode: crono.mode,
    obraId: opts.obraId || crono.obraId || selected?.obraId || null,
    movId: opts.movId || crono.movId || selected?.movId || null,
    displayName: opts.displayName || crono.displayName || selected?.displayName || '',
    subName: opts.subName || crono.subName || selected?.subName || '',
    source: opts.source || 'crono',
  });
}

function cronoNoteContextText(phase) {
  if (phase === 'before' || crono.state === 'idle') return 'Objetivo antes de empezar';
  const elapsed = cronoEffectiveElapsedMs();
  return (crono.state === 'paused' ? 'En pausa' : 'En marcha') + ' · ' + cronoNotePhaseLabel('during', elapsed);
}

function openCronoNote(phase) {
  const effectivePhase = (crono.state === 'idle' || phase === 'before') ? 'before' : 'during';
  _cronoNoteDraftPhase = effectivePhase;
  const ctx = document.getElementById('cronoNoteContext');
  const input = document.getElementById('cronoNoteInput');
  if (ctx) ctx.textContent = cronoNoteContextText(effectivePhase);
  if (input) input.value = '';
  openModal('modalCronoNote');
  setTimeout(() => {
    const el = document.getElementById('cronoNoteInput');
    if (el) el.focus();
  }, 140);
}

function confirmCronoNote() {
  const input = document.getElementById('cronoNoteInput');
  const text = (input?.value || '').trim();
  if (!text) {
    showToast('Escribe o dicta una nota');
    return;
  }
  if (!Array.isArray(crono.notes)) crono.notes = [];
  const note = cronoCreateSessionNote(text, _cronoNoteDraftPhase);
  if (note) crono.notes.push(note);
  crono.notes = crono.notes.slice(-80);
  cronoSaveState();
  cronoRenderNoteCounts();
  closeModal('modalCronoNote');
  showToast(_cronoNoteDraftPhase === 'before' ? 'Objetivo guardado' : 'Nota guardada');
}

function cronoRenderNoteCounts() {
  const count = Array.isArray(crono.notes) ? crono.notes.length : 0;
  const label = count ? String(count) : '+';
  ['cronoQuickNoteCount', 'cronoRunNoteCount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
  const tabBadge = document.getElementById('cronoDrawerNoteTabCount');
  if (tabBadge) tabBadge.textContent = label;
  ['cronoQuickNoteBtn', 'cronoRunNoteBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('has-notes', count > 0);
  });
  const tabBtn = document.querySelector('.crono-run-drawer-tab[data-tab="nota"]');
  if (tabBtn) tabBtn.classList.toggle('has-notes', count > 0);
}

function cronoTasks() {
  if (!Array.isArray(db.cronoTasks)) db.cronoTasks = [];
  db.cronoTasks = db.cronoTasks.filter(t => t && typeof t.text === 'string');
  return db.cronoTasks;
}

function cronoActiveTaskCount() {
  return cronoTasks().filter(t => !t.done).length;
}

function cronoRenderTaskCount() {
  const count = cronoActiveTaskCount();
  const badge = document.getElementById('cronoDrawerTaskTabCount');
  if (badge) badge.textContent = count ? String(count) : '+';
  const tabBtn = document.querySelector('.crono-run-drawer-tab[data-tab="tareas"]');
  if (tabBtn) tabBtn.classList.toggle('has-notes', count > 0);
}

function renderCronoTasks() {
  const el = document.getElementById('cronoTasksPanel');
  if (!el) return;
  const activeInput = document.activeElement && document.activeElement.id === 'cronoTaskInput';
  const currentDraft = activeInput ? (document.getElementById('cronoTaskInput')?.value || '') : '';
  const tasks = cronoTasks();
  const pending = tasks.filter(t => !t.done).slice(-12).reverse();
  const done = tasks.filter(t => t.done).slice(-5).reverse();
  const row = t => {
    const cls = 'crono-task-row' + (t.done ? ' is-done' : '');
    return '<button type="button" class="' + cls + '" onclick="toggleCronoTask(\'' + hechoJs(t.id) + '\')" aria-label="Marcar tarea">' +
      '<span class="crono-task-check"></span>' +
      '<span class="crono-task-text">' + escapeHtmlSafe(t.text) + '</span>' +
    '</button>';
  };
  el.innerHTML =
    '<div class="crono-task-add">' +
      '<input id="cronoTaskInput" class="crono-task-input" type="text" maxlength="140" placeholder="Algo por hacer..." onkeydown="cronoTaskInputKey(event)">' +
      '<button type="button" class="crono-task-add-btn" onclick="addCronoTask()">+</button>' +
    '</div>' +
    '<div class="crono-task-list">' +
      (pending.length ? pending.map(row).join('') : '<div class="crono-task-empty">Sin tareas pendientes</div>') +
      (done.length ? '<div class="crono-task-done-label">hechas</div>' + done.map(row).join('') : '') +
    '</div>';
  const input = document.getElementById('cronoTaskInput');
  if (input && activeInput) {
    input.value = currentDraft;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  cronoRenderTaskCount();
}

function cronoTaskInputKey(ev) {
  if (!ev) return;
  if (ev.key === 'Enter') {
    ev.preventDefault();
    addCronoTask();
  }
}

function addCronoTask() {
  const input = document.getElementById('cronoTaskInput');
  const text = (input?.value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    showToast('Escribe una tarea');
    return;
  }
  cronoTasks().push({
    id: 'ct' + Date.now(),
    text,
    done: false,
    createdAt: new Date().toISOString(),
  });
  saveData();
  if (input) input.value = '';
  renderCronoTasks();
  showToast('Tarea añadida');
}

function toggleCronoTask(id) {
  const task = cronoTasks().find(t => t.id === id);
  if (!task) return;
  task.done = !task.done;
  task.doneAt = task.done ? new Date().toISOString() : null;
  saveData();
  renderCronoTasks();
}

function cronoSetRunDrawerTab(tab) {
  const valid = tab === 'nota' || tab === 'pasajes' || tab === 'tareas' ? tab : 'pasajes';
  _cronoRunDrawerTab = valid;
  cronoUpdateRunDrawer();
  try { Haptics.light(); } catch(e) {}
}

function cronoUpdateRunDrawer() {
  const drawer = document.getElementById('cronoRunDrawer');
  if (!drawer) return;
  const tab = _cronoRunDrawerTab === 'nota' || _cronoRunDrawerTab === 'tareas' ? _cronoRunDrawerTab : 'pasajes';
  drawer.dataset.tab = tab;
  drawer.querySelectorAll('.crono-run-drawer-tab').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  drawer.querySelectorAll('.crono-run-drawer-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tab);
  });
  if (tab === 'tareas') renderCronoTasks();
  else cronoRenderTaskCount();
}

function cronoSetObservation(value) {
  crono.observation = String(value || '').slice(0, 1600);
  cronoSaveState();
  cronoUpdateRunObjective();
}

function cronoUpdateRunObjective() {
  const text = document.getElementById('cronoRunObjectiveText');
  const wrap = document.getElementById('cronoRunObjective');
  if (!text || !wrap) return;
  const objective = String(crono.observation || '').replace(/\s+/g, ' ').trim();
  text.textContent = objective || 'Sesión libre';
  wrap.classList.toggle('is-empty', !objective);
}

function cronoSyncObservationInputs() {
  const value = crono.observation || '';
  ['cronoIdleObservation', 'cronoRunObservation'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || document.activeElement === el) return;
    if (el.value !== value) el.value = value;
  });
  cronoUpdateRunObjective();
}

function cronoObservationTextForPlan(planId, isEditMode) {
  const agg = planId ? sessionAggregate[planId] : null;
  const pending = agg && agg._pendingTimes ? agg._pendingTimes : null;
  if (pending && typeof pending.observation === 'string') return pending.observation.trim();
  const notes = hechoCronoNotesForPlan(planId, isEditMode)
    .filter(note => note && note.source === 'observation');
  if (notes.length) return (notes[notes.length - 1].text || '').trim();
  return '';
}

function cronoCreateObservationNote(text, phase, opts) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const note = cronoCreateSessionNote(clean, phase || 'during', Object.assign({}, opts || {}, {
    source: 'observation'
  }));
  if (note) note.kind = 'session-observation';
  return note;
}

function cronoBuildSessionNotes(totalMs, minutos) {
  const notes = (Array.isArray(crono.notes) ? crono.notes : [])
    .map(note => cronoNormalizeSessionNote(Object.assign({
      fallbackMin: minutos,
      obraId: crono.obraId,
      movId: crono.movId,
      displayName: crono.displayName,
      subName: crono.subName,
      mode: crono.mode,
    }, note)))
    .filter(Boolean)
    .map(note => {
      if (note.phase === 'during' && note.elapsedMs != null && totalMs != null) {
        note.elapsedMs = Math.min(note.elapsedMs, Math.max(0, totalMs));
        note.minute = cronoNoteMinuteFromElapsed('during', note.elapsedMs, minutos);
        note.phaseLabel = cronoNotePhaseLabel('during', note.elapsedMs, minutos);
      }
      return note;
    });
  const observationText = (crono.observation || '').trim();
  if (observationText) {
    const phase = crono.state === 'idle' ? 'before' : 'during';
    const observation = cronoCreateObservationNote(observationText, phase, {
      fallbackMin: minutos,
      elapsedMs: Math.min(Math.max(0, totalMs || 0), Math.max(0, typeof cronoEffectiveElapsedMs === 'function' ? cronoEffectiveElapsedMs() : 0)),
      obraId: crono.obraId,
      movId: crono.movId,
      displayName: crono.displayName,
      subName: crono.subName,
      mode: crono.mode,
    });
    if (observation) notes.push(observation);
  }
  return notes;
}

// ── Resumen de minutos concentrado HOY ──────────────────────────────────────
// Suma minutos de todas las tarjetas extras (provenientes del cronómetro) que
// estén en currentPlan. Cada tarjeta puede agregar varias sub-sesiones; los
// minutos totales viven en sessionMinPlan[planId].
function getMinutosConcentradoHoy() {
  let total = 0;
  if (!Array.isArray(currentPlan)) return 0;
  currentPlan.forEach(entity => {
    if (!entity._isExtra) return;
    const pid = entity._planId || entity.id;
    const m = sessionMinPlan[pid];
    if (typeof m === 'number' && m > 0) total += m;
  });
  return total;
}

// "55 minutos" / "3 horas y 40 minutos" / "1 hora" / "0 minutos"
function fmtMinutosLargo(min) {
  if (!min || min <= 0) return '0 minutos';
  if (min < 60) return min + ' minuto' + (min === 1 ? '' : 's');
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hPart = h + ' hora' + (h === 1 ? '' : 's');
  if (m === 0) return hPart;
  return hPart + ' y ' + m + ' minuto' + (m === 1 ? '' : 's');
}

// Lista de items para el mini-resumen: [{label, minutos}, ...]
// Para movimientos: "Obra — Movimiento"; para obras: "Obra"
function getResumenSesionesHoy() {
  if (!Array.isArray(currentPlan)) return [];
  const items = [];
  currentPlan.forEach(entity => {
    if (!entity._isExtra) return;
    const pid = entity._planId || entity.id;
    const min = sessionMinPlan[pid];
    if (typeof min !== 'number' || min <= 0) return;
    const label = entity._isMovimiento
      ? (entity._parentName || '') + ' — ' + entity.name
      : (entity._displayName || entity.name || '—');
    const dest = sessionDestello[pid];
    items.push({
      label, minutos: min, planId: pid,
      destello: !!(dest && dest.on),
      destelloNota: dest && dest.on ? (dest.nota || '') : '',
    });
  });
  // Añadir DESCANSOS del día desde db.sessionPlants. Los agrupamos en una
  // sola entrada con el total de minutos descansados, etiquetada como
  // "Descanso · N min" para distinguir visualmente del estudio real.
  if (Array.isArray(db.sessionPlants)) {
    const todayStr = new Date().toDateString();
    let restMins = 0;
    db.sessionPlants.forEach(p => {
      if (p.tipo !== 'descanso') return;
      if (!p.endedAt) return;
      if (new Date(p.endedAt).toDateString() !== todayStr) return;
      restMins += p.mins || 0;
    });
    if (restMins > 0) {
      items.push({
        label: 'Descanso',
        minutos: restMins,
        planId: '_rest_summary_',
        isRest: true,
      });
    }
  }
  return items;
}

// Devuelve el resumen del ÚLTIMO DÍA CON ACTIVIDAD anterior a hoy. No siempre
// es ayer literal — si pasaste un día sin estudiar, salta al penúltimo.
// Cada item incluye: label, minutos, pasajes trabajados (con su intensidad)
// y la nota general si la había. Útil para mostrar contexto previo en el
// cronómetro: "lo que dejé pendiente, retomo desde aquí".
// Procesa una sesión de db.sesiones y devuelve { etiquetaDia, items }
// con la forma de cada item lista para renderizar en el resumen lateral.
// Devuelve null si la sesión no tiene items con minutos > 0.
function _procesarSesionParaResumen(sesion) {
  if (!Array.isArray(sesion.items) || !sesion.items.length) return null;
  const sesionDate = new Date(sesion.date);
  const diasDif = Math.round((new Date().setHours(0,0,0,0) - new Date(sesion.date).setHours(0,0,0,0)) / 86400000);
  let etiquetaDia;
  if (diasDif === 1) etiquetaDia = 'Ayer';
  else if (diasDif === 2) etiquetaDia = 'Anteayer';
  else if (diasDif <= 7) etiquetaDia = 'Hace ' + diasDif + ' días';
  else etiquetaDia = sesionDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  const aggregate = sesion._aggregate || {};
  const items = sesion.items.map(it => {
    const planId = it._planId || (it.obraId + '::' + (it.movId || ''));
    const obra = (db.obras || []).find(o => o.id === it.obraId);
    if (!obra) return null;
    let label;
    if (it.movId) {
      const mov = (obra.movimientos || []).find(m => m.id === it.movId);
      label = (obra.name || '') + ' — ' + (mov?.name || '?');
    } else {
      label = obra.name + (obra.composer && obra.composer !== '—' ? ' · ' + obra.composer : '');
    }
    // Pasajes trabajados: del aggregate, agrupados por id con intensidad más
    // reciente si aparece varias veces.
    const agg = aggregate[planId];
    const subsessions = agg?.subsessions || [];
    const pasajesMap = {};
    subsessions.forEach(sub => {
      (sub.pasajes || []).forEach(p => {
        if (!p || !p.id) return;
        pasajesMap[p.id] = p.intensidad || pasajesMap[p.id];
      });
    });
    const pasajes = Object.keys(pasajesMap).map(pid => {
      const pasaje = (obra.pasajes || []).find(pp => pp.id === pid);
      if (!pasaje) return null;
      return { name: pasaje.name || pasaje.compases || '?', intensidad: pasajesMap[pid] };
    }).filter(Boolean);
    // Destello: del item (forma persistida) o, de respaldo, de alguna sub-sesión.
    let destello = !!it.destello;
    let destelloNota = (it.destelloNota || '').trim();
    if (!destello && subsessions.some(s => s && s.destello)) {
      destello = true;
      const sub = subsessions.find(s => s && s.destello && (s.destelloNota || '').trim());
      if (sub) destelloNota = (sub.destelloNota || '').trim();
    }
    return {
      label,
      minutos: _itemMinReal(it),
      pasajes,
      nota: (it.note || it.nota || '').trim(),
      destello,
      destelloNota,
    };
  }).filter(Boolean).filter(x => x.minutos > 0);
  if (!items.length) return null;
  return { etiquetaDia, items };
}

// Devuelve un array con hasta N días previos (no hoy) con actividad.
// Cada elemento es { etiquetaDia, items }. Los días sin actividad se saltan
// (si no hubo nada anteayer pero sí hace 3 días, ese se usa como segundo
// elemento). Esto da continuidad pedagógica.
function getResumenSesionesPasadas(maxDias) {
  maxDias = maxDias || 2;
  if (!Array.isArray(db.sesiones) || !db.sesiones.length) return [];
  const todayStr = new Date().toDateString();
  const sesionesOrdenadas = db.sesiones
    .filter(s => new Date(s.date).toDateString() !== todayStr)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const resultado = [];
  for (const sesion of sesionesOrdenadas) {
    if (resultado.length >= maxDias) break;
    const procesada = _procesarSesionParaResumen(sesion);
    if (procesada) resultado.push(procesada);
  }
  return resultado;
}

// Alias retrocompat (algún código viejo podría llamar a getResumenSesionesAyer)
function getResumenSesionesAyer() {
  const resultados = getResumenSesionesPasadas(1);
  return resultados[0] || null;
}

function _cronoAyerMinText(min) {
  min = Math.max(0, parseInt(min || 0, 10));
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }
  return min + ' min';
}

function getResumenComentariosAyer() {
  if (!Array.isArray(db.sesiones) || !db.sesiones.length) return null;
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const ayerStr = ayer.toDateString();
  const sesion = db.sesiones.find(s => s && s.date && new Date(s.date).toDateString() === ayerStr);
  const resumen = sesion ? _procesarSesionParaResumen(sesion) : null;
  if (!resumen || !Array.isArray(resumen.items)) return null;
  const items = resumen.items.filter(it =>
    (it.nota && it.nota.trim()) || (it.destelloNota && it.destelloNota.trim())
  );
  if (!items.length) return null;
  return {
    etiquetaDia: 'Ayer',
    totalMinutos: items.reduce((sum, it) => sum + (it.minutos || 0), 0),
    items,
  };
}

function setCronoAyerOpen(open) {
  const btn = document.getElementById('cronoAyerBtn');
  const panel = document.getElementById('cronoAyerPanel');
  if (!btn || !panel) return;
  btn.classList.toggle('open', !!open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.classList.toggle('open', !!open);
  panel.style.display = open ? '' : 'none';
}

function toggleCronoAyerPanel() {
  const panel = document.getElementById('cronoAyerPanel');
  setCronoAyerOpen(!(panel && panel.classList.contains('open')));
}

function closeCronoAyerPanel() {
  setCronoAyerOpen(false);
}

function renderCronoAyerPanel() {
  const btn = document.getElementById('cronoAyerBtn');
  const btnText = document.getElementById('cronoAyerBtnText');
  const panel = document.getElementById('cronoAyerPanel');
  if (!btn || !panel) return;
  const resumen = getResumenComentariosAyer();
  if (!resumen) {
    btn.style.display = 'none';
    panel.innerHTML = '';
    setCronoAyerOpen(false);
    return;
  }
  const wasOpen = panel.classList.contains('open');
  btn.style.display = '';
  if (btnText) btnText.textContent = 'Ayer · ' + resumen.items.length;
  panel.innerHTML =
    '<div class="crono-ayer-head">' +
      '<strong>Lo escrito ayer</strong>' +
      '<span>' + _cronoAyerMinText(resumen.totalMinutos) + '</span>' +
    '</div>' +
    resumen.items.map(it => {
      const nota = it.nota
        ? '<div class="crono-ayer-note">' + escapeHtmlSafe(it.nota) + '</div>'
        : '';
      const destello = it.destelloNota
        ? '<div class="crono-ayer-destello">✨ ' + escapeHtmlSafe(it.destelloNota) + '</div>'
        : '';
      return '<div class="crono-ayer-item">' +
        '<div class="crono-ayer-line">' +
          '<span class="crono-ayer-name">' + escapeHtmlSafe(it.label) + '</span>' +
          '<span class="crono-ayer-min">' + _cronoAyerMinText(it.minutos) + '</span>' +
        '</div>' +
        nota + destello +
      '</div>';
    }).join('');
  setCronoAyerOpen(wasOpen);
}

// ── DESTELLOS ────────────────────────────────────────────────────────────────
// Recopila todas las sesiones de excelencia marcadas, de todo el historial,
// más recientes primero. Cada entrada: { date, obra, nota }.
// Los días pasados se leen de db.sesiones; HOY se lee del estado en memoria
// (sessionDestello) para que un destello recién marcado aparezca al instante,
// sin esperar al autoguardado (que va con debounce de 800ms).
function destelloBoosts(raw) {
  if (!raw) return 0;
  return Math.max(0, Math.round(Number(raw.boosts ?? raw.destelloBoosts ?? raw.helpCount ?? 0) || 0));
}

function destelloHelpLog(raw) {
  const list = raw && (raw.helpLog || raw.destelloHelpLog || raw.helpedLog);
  return Array.isArray(list) ? list.filter(Boolean).slice(-120) : [];
}

function destelloLevelFromBoosts(boosts) {
  const n = Math.max(0, Math.round(Number(boosts) || 0));
  if (n >= 25) return 5;
  if (n >= 14) return 4;
  if (n >= 7) return 3;
  if (n >= 3) return 2;
  if (n >= 1) return 1;
  return 0;
}

function destelloLevelLabel(boosts) {
  const level = destelloLevelFromBoosts(boosts);
  return level ? ('Nivel ' + level + ' · ' + boosts + (boosts === 1 ? ' ayuda' : ' ayudas')) : 'Sin ayudas todavia';
}

function _syncDestelloSubMeta(aggregate, planId, meta) {
  const subs = aggregate && planId && aggregate[planId] && aggregate[planId].subsessions;
  if (!Array.isArray(subs) || !subs.length) return;
  const destSubs = subs.filter(s => s && s.destello);
  const target = destSubs.length ? destSubs[destSubs.length - 1] : subs[subs.length - 1];
  if (!target) return;
  target.destelloBoosts = meta.boosts || 0;
  target.destelloLevel = destelloLevelFromBoosts(meta.boosts || 0);
  target.destelloHelpLog = Array.isArray(meta.helpLog) ? meta.helpLog.slice(-120) : [];
  target.destelloHelpedAt = meta.helpedAt || null;
}

function getAllDestellos() {
  const out = [];
  const todayStr = new Date().toDateString();

  // HOY — desde memoria
  Object.keys(sessionDestello).forEach(planId => {
    const d = sessionDestello[planId];
    if (!d || !d.on) return;
    const entity = (currentPlan || []).find(e => (e._planId || e.id) === planId);
    let obraName = 'Sesión';
    if (entity) {
      obraName = entity._isMovimiento
        ? (entity._parentName || '') + ' — ' + entity.name
        : (entity._displayName || entity.name || 'Sesión');
    }
    out.push({
      date: new Date().toISOString(),
      obra: obraName,
      nota: (d.nota || '').trim(),
      boosts: destelloBoosts(d),
      level: destelloLevelFromBoosts(destelloBoosts(d)),
      helpLog: destelloHelpLog(d),
      helpedAt: d.helpedAt || null,
      source: 'today',
      planId,
    });
  });

  // DÍAS PASADOS — desde db.sesiones
  if (Array.isArray(db.sesiones)) {
    db.sesiones.forEach((sesion, sesionIdx) => {
      if (!sesion || !Array.isArray(sesion.items)) return;
      if (new Date(sesion.date).toDateString() === todayStr) return; // hoy ya cubierto por memoria
      const aggregate = sesion._aggregate || {};
      sesion.items.forEach((it, itemIdx) => {
        if (!it) return;
        const planId = it._planId || (it.obraId + '::' + (it.movId || ''));
        let on = !!it.destello;
        let nota = (it.destelloNota || '').trim();
        const subs = aggregate[planId]?.subsessions || [];
        const destSub = subs.find(s => s && s.destello) || null;
        // Respaldo: destello guardado solo en alguna sub-sesión.
        if (!on) {
          if (destSub) { on = true; if (!nota) nota = (destSub.destelloNota || '').trim(); }
        }
        if (!on) return;
        // Nombre de la obra: del item guardado o reconstruido desde db.obras.
        let obraName = it.obraName || '';
        if (!obraName) {
          const obra = (db.obras || []).find(o => o.id === it.obraId);
          if (obra) {
            if (it.movId) {
              const mov = (obra.movimientos || []).find(m => m.id === it.movId);
              obraName = obra.name + (mov ? ' — ' + mov.name : '');
            } else {
              obraName = obra.name + (obra.composer && obra.composer !== '—' ? ' · ' + obra.composer : '');
            }
          }
        }
        const boosts = destelloBoosts(it) || destelloBoosts(destSub);
        const helpLog = destelloHelpLog(it).length ? destelloHelpLog(it) : destelloHelpLog(destSub);
        out.push({
          date: sesion.date,
          obra: obraName || 'Sesión',
          nota,
          boosts,
          level: destelloLevelFromBoosts(boosts),
          helpLog,
          helpedAt: it.destelloHelpedAt || destSub?.destelloHelpedAt || null,
          source: 'history',
          sesionIdx,
          itemIdx,
          planId,
        });
      });
    });
  }
  out.sort((a, b) => new Date(b.date) - new Date(a.date));
  return out;
}

// Muestra/oculta el pill de Destellos (abajo a la izquierda) con el conteo.
function refreshDestellosPill() {
  const pill = document.getElementById('cronoDestellosPill');
  if (!pill) return;
  const n = getAllDestellos().length;
  const countEl = document.getElementById('cronoDestellosCount');
  if (countEl) { countEl.textContent = n; countEl.style.display = n > 0 ? '' : 'none'; }
  pill.style.display = n > 0 ? '' : 'none';
}

function _destelloTextForCrono(d) {
  const nota = (d && d.nota ? String(d.nota) : '').trim();
  if (nota) return nota;
  const obra = (d && d.obra ? String(d.obra) : '').trim();
  return obra ? 'Recuerda esa sesión clara en ' + obra : '';
}

function getCronoDestelloPhrases() {
  return getCronoDestelloPhraseEntries().map(x => x.text);
}

function getCronoDestelloPhraseEntries() {
  return getAllDestellos()
    .map(d => ({
      text: _destelloTextForCrono(d).trim(),
      entry: d,
      isDestello: true,
    }))
    .filter(x => x.text.length >= 4);
}

function _syncDestelloSubNota(aggregate, planId, nota) {
  const subs = aggregate && planId && aggregate[planId] && aggregate[planId].subsessions;
  if (!Array.isArray(subs) || !subs.length) return;
  const destSubs = subs.filter(s => s && s.destello);
  const target = destSubs.length ? destSubs[destSubs.length - 1] : subs[subs.length - 1];
  if (target) {
    target.destello = true;
    target.destelloNota = nota;
  }
}

function _clearDestelloSubs(aggregate, planId) {
  const subs = aggregate && planId && aggregate[planId] && aggregate[planId].subsessions;
  if (!Array.isArray(subs) || !subs.length) return;
  subs.forEach(sub => {
    if (!sub) return;
    sub.destello = false;
    sub.destelloNota = null;
  });
}

function updateDestelloNota(entry, nota) {
  if (!entry) return false;
  if (entry.source === 'today') {
    const prev = sessionDestello[entry.planId] || {};
    sessionDestello[entry.planId] = Object.assign({}, prev, { on: true, nota });
    _syncDestelloSubNota(sessionAggregate, entry.planId, nota);
    _syncDestelloSubMeta(sessionAggregate, entry.planId, sessionDestello[entry.planId]);
    if (typeof saveDraft === 'function') saveDraft();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
    return true;
  }
  if (entry.source === 'history' && Array.isArray(db.sesiones)) {
    const sesion = db.sesiones[entry.sesionIdx];
    const item = sesion && Array.isArray(sesion.items) ? sesion.items[entry.itemIdx] : null;
    if (!item) return false;
    item.destello = true;
    item.destelloNota = nota;
    _syncDestelloSubNota(sesion._aggregate, entry.planId, nota);
    _syncDestelloSubMeta(sesion._aggregate, entry.planId, {
      boosts: destelloBoosts(item),
      helpLog: destelloHelpLog(item),
      helpedAt: item.destelloHelpedAt || null,
    });
    saveData();
    return true;
  }
  return false;
}

function clearDestello(entry) {
  if (!entry) return false;
  if (entry.source === 'today') {
    delete sessionDestello[entry.planId];
    _clearDestelloSubs(sessionAggregate, entry.planId);
    if (typeof saveDraft === 'function') saveDraft();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
    return true;
  }
  if (entry.source === 'history' && Array.isArray(db.sesiones)) {
    const sesion = db.sesiones[entry.sesionIdx];
    const item = sesion && Array.isArray(sesion.items) ? sesion.items[entry.itemIdx] : null;
    if (!item) return false;
    item.destello = false;
    item.destelloNota = null;
    _clearDestelloSubs(sesion._aggregate, entry.planId);
    saveData();
    return true;
  }
  return false;
}

function boostDestello(entry) {
  if (!entry) return null;
  const now = new Date().toISOString();
  if (entry.source === 'today') {
    const prev = sessionDestello[entry.planId] || { on: true, nota: entry.nota || '' };
    const helpLog = destelloHelpLog(prev).concat(now).slice(-120);
    const boosts = destelloBoosts(prev) + 1;
    sessionDestello[entry.planId] = Object.assign({}, prev, {
      on: true,
      nota: prev.nota || entry.nota || '',
      boosts,
      level: destelloLevelFromBoosts(boosts),
      helpLog,
      helpedAt: now,
    });
    _syncDestelloSubMeta(sessionAggregate, entry.planId, sessionDestello[entry.planId]);
    if (typeof saveDraft === 'function') saveDraft();
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
    entry.boosts = boosts;
    entry.level = destelloLevelFromBoosts(boosts);
    entry.helpLog = helpLog;
    entry.helpedAt = now;
    return { boosts, level: entry.level };
  }
  if (entry.source === 'history' && Array.isArray(db.sesiones)) {
    const sesion = db.sesiones[entry.sesionIdx];
    const item = sesion && Array.isArray(sesion.items) ? sesion.items[entry.itemIdx] : null;
    if (!item) return null;
    const helpLog = destelloHelpLog(item).concat(now).slice(-120);
    const boosts = destelloBoosts(item) + 1;
    item.destello = true;
    item.destelloNota = item.destelloNota || entry.nota || '';
    item.destelloBoosts = boosts;
    item.destelloLevel = destelloLevelFromBoosts(boosts);
    item.destelloHelpLog = helpLog;
    item.destelloHelpedAt = now;
    _syncDestelloSubMeta(sesion._aggregate, entry.planId, {
      boosts,
      helpLog,
      helpedAt: now,
    });
    saveData();
    entry.boosts = boosts;
    entry.level = destelloLevelFromBoosts(boosts);
    entry.helpLog = helpLog;
    entry.helpedAt = now;
    return { boosts, level: entry.level };
  }
  return null;
}

function openDestelloHelpConfirm(entry, source) {
  if (!entry) {
    showToast('Este texto aun no es un destello guardado');
    return;
  }
  _pendingDestelloBoostEntry = entry;
  _pendingDestelloBoostSource = source || 'run';
  const txt = document.getElementById('destelloHelpConfirmText');
  if (txt) {
    const phrase = _destelloTextForCrono(entry) || entry.nota || entry.obra || 'Destello';
    const boosts = destelloBoosts(entry);
    txt.innerHTML =
      '<div class="destello-help-confirm-quote">' + escapeHtmlSafe(_cronoClampDestelloText(phrase)) + '</div>' +
      '<div class="destello-help-confirm-level">' + escapeHtmlSafe(destelloLevelLabel(boosts)) + '</div>';
  }
  openModal('modalDestelloHelpConfirm');
}

function closeDestelloHelpConfirm() {
  _pendingDestelloBoostEntry = null;
  _pendingDestelloBoostSource = null;
  closeModal('modalDestelloHelpConfirm');
}

function confirmDestelloHelp() {
  const source = _pendingDestelloBoostSource;
  const result = boostDestello(_pendingDestelloBoostEntry);
  if (!result) {
    closeDestelloHelpConfirm();
    showToast('No he podido actualizar el destello');
    return;
  }
  closeDestelloHelpConfirm();
  if (typeof SFX !== 'undefined' && SFX.tick) SFX.tick();
  try { Haptics.light(); } catch(e) {}
  cronoUpdateRunDestello(cronoEffectiveElapsedMs(), true);
  refreshDestellosPill();
  if (typeof renderCronoDestellosCard === 'function') renderCronoDestellosCard();
  if (typeof cronoRefreshDestelloPhrase === 'function') cronoRefreshDestelloPhrase(true);
  if (source === 'list') renderDestellosList(null);
  showToast('Destello +1 · nivel ' + result.level);
}

function cronoBoostCurrentDestello(ev) {
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  openDestelloHelpConfirm(_cronoCurrentDestelloEntry, 'run');
}

function renderDestellosList(editIndex) {
  const list = document.getElementById('destellosList');
  if (!list) return;
  const destellos = getAllDestellos();
  _destellosModalEntries = destellos;
  _destellosEditIndex = Number.isInteger(editIndex) ? editIndex : null;
  if (!destellos.length) {
    list.innerHTML = emptyStateHTML(ICON_STAR, 'Aún no hay destellos', 'Cuando una sesión sea memorable, márcala como destello al guardarla.');
    return;
  }
  let html = '<div class="destellos-count">' + destellos.length
    + (destellos.length === 1 ? ' destello' : ' destellos') + '</div>';
  let lastGroup = '';
  destellos.forEach((d, idx) => {
    const dt = new Date(d.date);
    const group = dt.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    if (group !== lastGroup) {
      lastGroup = group;
      html += '<div class="destellos-group-label">' + group.charAt(0).toUpperCase() + group.slice(1) + '</div>';
    }
    const fecha = dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const isEditing = idx === _destellosEditIndex;
    const boosts = destelloBoosts(d);
    const levelHtml = '<span class="destello-card-level">' + escapeHtmlSafe(destelloLevelLabel(boosts)) + '</span>';
    const notaHtml = isEditing
      ? '<div class="destello-edit-wrap">' +
          '<textarea class="destello-edit-input" id="destelloEditNota' + idx + '" rows="3" placeholder="Escribe la frase que quieres releer en el cronómetro...">' + escapeHtmlSafe(d.nota || '') + '</textarea>' +
          '<div class="destello-edit-actions">' +
            '<button class="destello-edit-btn danger" onclick="removeDestelloNota(' + idx + ')">Quitar destello</button>' +
            '<button class="destello-edit-btn secondary" onclick="cancelDestelloEdit()">Cancelar</button>' +
            '<button class="destello-edit-btn primary" onclick="saveDestelloNota(' + idx + ')">Guardar</button>' +
          '</div>' +
        '</div>'
      : (d.nota
          ? '<div class="destello-card-nota">' + escapeHtmlSafe(d.nota) + '</div>'
          : '<div class="destello-card-nota destello-card-nota--vacia">sin frase todavía</div>');
    const level = destelloLevelFromBoosts(boosts);
    html += '<div class="destello-card destello-level-' + level + '">' +
      '<div class="destello-card-head">' +
        '<span class="destello-card-obra">' + escapeHtmlSafe(d.obra) + '</span>' +
        '<span class="destello-card-fecha">' + fecha + '</span>' +
      '</div>' +
      levelHtml +
      notaHtml +
      (!isEditing ? '<div class="destello-card-actions">' +
        '<button class="destello-card-edit" onclick="editDestelloNota(' + idx + ')">' + (d.nota ? 'Editar frase' : 'Escribir frase') + '</button>' +
        '<button class="destello-card-help" onclick="boostDestelloFromList(' + idx + ')">Me ayuda +1</button>' +
      '</div>' : '') +
    '</div>';
  });
  list.innerHTML = html;
}

function boostDestelloFromList(idx) {
  const entry = _destellosModalEntries[idx];
  openDestelloHelpConfirm(entry, 'list');
}

function editDestelloNota(idx) {
  renderDestellosList(idx);
  setTimeout(() => {
    const input = document.getElementById('destelloEditNota' + idx);
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }, 60);
}

function cancelDestelloEdit() {
  renderDestellosList(null);
}

function saveDestelloNota(idx) {
  const entry = _destellosModalEntries[idx];
  const input = document.getElementById('destelloEditNota' + idx);
  const nota = (input ? input.value : '').trim();
  if (!updateDestelloNota(entry, nota)) {
    showToast('No he podido guardar el destello');
    return;
  }
  renderDestellosList(null);
  refreshDestellosPill();
  if (typeof renderCronoDestellosCard === 'function') renderCronoDestellosCard();
  if (typeof cronoRefreshDestelloPhrase === 'function') cronoRefreshDestelloPhrase(true);
  showToast('Destello actualizado');
}

function removeDestelloNota(idx) {
  const entry = _destellosModalEntries[idx];
  if (!entry) return;
  if (!confirm('¿Quitar este destello?\n\nLa sesión se conserva; solo deja de aparecer como destello.')) return;
  if (!clearDestello(entry)) {
    showToast('No he podido quitar el destello');
    return;
  }
  renderDestellosList(null);
  refreshDestellosPill();
  if (typeof renderCronoDestellosCard === 'function') renderCronoDestellosCard();
  if (typeof cronoRefreshDestelloPhrase === 'function') cronoRefreshDestelloPhrase(true);
  showToast('Destello quitado');
}

function openDestellosModal() {
  renderDestellosList(null);
  openModal('modalDestellos');
}

function _weekStart(d) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function _plantsInRange(start, end) {
  return (db.sessionPlants || []).filter(p => {
    if (!p || p.failed || p.tipo === 'descanso') return false;
    const t = new Date(p.endedAt || p.startedAt).getTime();
    return t >= start.getTime() && t < end.getTime();
  });
}

function _fmtMinShort(min) {
  min = Math.round(min || 0);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}

// ── EMPUJÓN DE ESTUDIO ────────────────────────────────────────────────────────
// "Te convendría retomar X": detecta la obra activa más desatendida ponderando
// días sin tocarla, urgencia de evento próximo que la incluya y dificultad.
// La tarjeta lleva directo al cronómetro con la obra preseleccionada.
function _nudgeLastStudyMap() {
  const map = {}; // obraId → timestamp del último estudio
  const mark = (obraId, t) => {
    if (!obraId || !t || isNaN(t)) return;
    if (!map[obraId] || t > map[obraId]) map[obraId] = t;
  };
  (db.sessionPlants || []).forEach(p => { if (p && !p.failed && p.startedAt) mark(p.obraId, new Date(p.startedAt).getTime()); });
  (db.forestPlants || []).forEach(p => { if (p && !p.failed && p.startedAt) mark(p.obraId, new Date(p.startedAt).getTime()); });
  (db.sesiones || []).forEach(s => {
    const t = new Date(s.date).getTime();
    (s.items || []).forEach(it => { if (_itemEstudiado(it)) mark(it.obraId, t); });
  });
  return map;
}

function computeStudyNudge() {
  const obras = (db.obras || []).filter(o => o.tipo !== 'actividad');
  if (!obras.length) return null;
  const last = _nudgeLastStudyMap();
  const now = Date.now();
  // Eventos próximos (no resueltos) por obra; nos quedamos con el más cercano.
  const evByObra = {};
  (db.eventos || []).forEach(ev => {
    if (ev.resultado && ev.resultado.scoreTotal != null) return;
    const dias = Math.ceil((new Date(ev.fecha + 'T12:00:00') - now) / 86400000);
    if (dias < 0 || dias > 60) return;
    (ev.obras || []).forEach(id => {
      if (!evByObra[id] || evByObra[id].dias > dias) evByObra[id] = { nombre: ev.nombre, dias };
    });
  });
  const hayEventos = Object.keys(evByObra).length > 0;
  const solOf = o => Math.max(0, Math.min(100, Math.round(estimateSolActual(o).val || 0)));

  let best = null;
  obras.forEach(o => {
    const t = last[o.id];
    const dias = t ? Math.floor((now - t) / 86400000) : null;
    const ev = evByObra[o.id] || null;
    const sol = solOf(o);
    const dif = o.dificultad || 3;        // 1-10
    const dur = o.duracion || 8;          // minutos

    let score, reason;
    if (ev) {
      // Una obra con evento próximo SIEMPRE manda. Entre ellas, prioriza la que
      // más te juegas: menos sólida (menos aprendida) + más difícil + más larga,
      // y cuanto más cerca el evento.
      reason = 'evento';
      score = 1000 + Math.max(0, 60 - ev.dias) * 8;   // proximidad del evento
      score += (100 - sol) * 1.4;                      // menos aprendida → más (0-140)
      score += dif * 6;                                // más difícil (6-60)
      score += Math.min(dur, 40) * 0.9;                // más larga (hasta 36)
      if (dias !== null) score += Math.min(dias, 14);  // y si llevas días sin tocarla
    } else {
      // Sin evento: solo entra como rotación, y NUNCA si hay eventos en juego
      // (no inventamos obras sueltas cuando hay algo que preparar).
      if (hayEventos) return;
      if (dias === null) return;            // nunca tocada y sin evento: no urge
      if (dias < 3) return;                 // tocada hace poco: no insistir
      reason = 'rotacion';
      score = Math.min(dias, 40) + (100 - sol) * 0.4;
    }
    if (!best || score > best.score) {
      best = { obraId: o.id, nombre: o.name, dias, ev, sol, dif, reason, score };
    }
  });
  if (!best) return null;

  let accion, motivo;
  if (best.reason === 'evento') {
    accion = 'Prepara';
    const partes = ['en «' + best.ev.nombre + '» ' + (best.ev.dias <= 0 ? '(hoy)' : '(' + best.ev.dias + 'd)')];
    if (best.sol < 70) partes.push(best.sol + '% sólida');
    if (best.dif >= 6) partes.push('difícil');
    motivo = partes.join(' · ');
  } else {
    accion = 'Retoma';
    if (best.dias >= 30) motivo = 'Más de un mes sin tocarla';
    else motivo = best.dias + ' día' + (best.dias === 1 ? '' : 's') + ' sin tocarla';
  }
  return { obraId: best.obraId, nombre: best.nombre, accion, motivo };
}

function nudgeStudyNow(obraId) {
  showView('cronometro');
  const sel = document.getElementById('cronoObraSelect');
  if (!sel) return;
  if (typeof cronoFillSelectInto === 'function') cronoFillSelectInto(sel);
  let v = 'obra::' + obraId;
  if (!Array.from(sel.options).some(op => op.value === v)) {
    const obra = findObra(obraId);
    const m = obra && (obra.movimientos || []).find(x => x.name);
    v = m ? ('mov::' + obraId + '::' + m.id) : '';
  }
  if (v) {
    sel.value = v;
    cronoUpdateStartBtn();
  }
}

function renderSessionInsights() {
  const host = document.getElementById('sessionInsightStack');
  if (!host) return;
  const cards = [];
  const now = new Date();

  // Hoy ofrece una entrada explícita al cronómetro; no recomienda una obra
  // automáticamente antes de que el usuario elija qué quiere estudiar.
  const nudge = null;
  if (nudge) {
    cards.push('<div class="session-insight-card nudge" onclick="nudgeStudyNow(\'' + nudge.obraId + '\')">' +
      '<div style="min-width:0">' +
        '<div class="session-insight-kicker">Te convendría</div>' +
        '<div class="session-insight-main">' + (nudge.accion || 'Retomar') + ' <strong>' + escapeHtmlSafe(nudge.nombre) + '</strong></div>' +
        '<div class="session-insight-sub">' + escapeHtmlSafe(nudge.motivo) + '</div>' +
      '</div>' +
      '<span class="session-insight-nudge-cta">▶ Estudiarla</span>' +
    '</div>');
  }

  const upcoming = (db.eventos || [])
    .map(ev => ({ ...ev, dias: Math.ceil((new Date(ev.fecha + 'T12:00:00') - now) / 86400000) }))
    .filter(ev => ev.dias >= 0 && ev.dias <= 14 && !(ev.resultado && ev.resultado.scoreTotal != null))
    .sort((a,b) => a.dias - b.dias)[0];
  if (upcoming) {
    const readiness = computeEventoReadiness(upcoming);
    const weakest = readiness?.detalles?.slice().sort((a,b) => a.obraScore - b.obraScore).slice(0, 2).map(d => d.nombre).join(' · ');
    cards.push('<div class="session-insight-card event">' +
      '<div class="session-insight-kicker">Evento próximo</div>' +
      '<div class="session-insight-main"><strong>' + escapeHtmlSafe(upcoming.nombre) + '</strong> · ' + (upcoming.dias === 0 ? 'hoy' : 'faltan ' + upcoming.dias + 'd') + '</div>' +
      '<div class="session-insight-sub">Preparación ' + (readiness?.global ?? '—') + '%' + (weakest ? ' · foco: ' + escapeHtmlSafe(weakest) : '') + '</div>' +
    '</div>');
  }

  const start = _weekStart(now);
  const next = new Date(start); next.setDate(start.getDate() + 7);
  const prev = new Date(start); prev.setDate(start.getDate() - 7);
  // Comparar contra lo que llevabas la semana PASADA A ESTAS ALTURAS (mismo
  // momento de la semana), no contra su total. Así la comparación es justa.
  const elapsedMs = now.getTime() - start.getTime();
  const prevPoint = new Date(prev.getTime() + elapsedMs);
  const thisPlants = _plantsInRange(start, next);
  const thisMin = thisPlants.reduce((s,p) => s + (p.mins || 0), 0);
  const prevMin = _plantsInRange(prev, prevPoint).reduce((s,p) => s + (p.mins || 0), 0);
  if (thisMin > 0 || prevMin > 0) {
    const byObra = {};
    thisPlants.forEach(p => { byObra[p.obraId] = (byObra[p.obraId] || 0) + (p.mins || 0); });
    const topId = Object.keys(byObra).sort((a,b) => byObra[b] - byObra[a])[0];
    const topObra = topId ? findObra(topId) : null;
    const delta = thisMin - prevMin;
    const deltaTxt = prevMin > 0
      ? (delta >= 0 ? '+' : '−') + _fmtMinShort(Math.abs(delta)) + ' que la semana pasada a estas alturas'
      : 'sin comparación previa';
    cards.push('<div class="session-insight-card">' +
      '<div class="session-insight-kicker">Tu semana</div>' +
      '<div class="session-insight-main"><strong>' + _fmtMinShort(thisMin) + '</strong> concentrados</div>' +
      '<div class="session-insight-sub">' + escapeHtmlSafe(deltaTxt) + (topObra ? ' · más trabajada: ' + escapeHtmlSafe(topObra.name) : '') + '</div>' +
    '</div>');
  }

  // Días de estudio intenso (4 h+): a qué hora sueles arrancar esos días, según
  // tu hábito de los últimos 3 meses. Si empiezas mucho más tarde, es improbable.
  const winIntense = _recentPlants();
  const dayMap = _statsDayMap(winIntense.plants);
  const intense4 = _statsIntenseStart(dayMap, 240);
  if (intense4 && intense4.count >= 3) {
    const intense5 = _statsIntenseStart(dayMap, 300);
    const cinco = (intense5 && intense5.count >= 3) ? ' · 5 h+ a las ' + _fmtHourMin(intense5.avgMin) : '';
    cards.push('<div class="session-insight-card">' +
      '<div class="session-insight-kicker">Días de 4 h+ · ' + winIntense.scope + '</div>' +
      '<div class="session-insight-main">Sueles arrancar hacia las <strong>' + _fmtHourMin(intense4.avgMin) + '</strong></div>' +
      '<div class="session-insight-sub">' + intense4.count + ' días intensos' + cinco + ' · empezar más tarde lo hace difícil</div>' +
    '</div>');
  }

  // Probabilidad EN VIVO de llegar hoy a 4 h / 5 h (la estrella, va primera).
  const prob = _probTextHoy();
  if (prob) {
    cards.unshift('<div class="session-insight-card prob-card" id="sessionProbCard">' + _probRichHTML(prob) + '</div>');
  }

  host.innerHTML = cards.join('');
  host.style.display = cards.length ? '' : 'none';
}

// ── JARDÍN DEL DÍA (cronómetro en reposo) ────────────────────────────────────
// Dibujo SVG generativo, sin assets externos: colinas, sol o luna según la
// hora, y una flor por cada sesión de hoy en el color de su obra. Las flores
// nuevas brotan con una animación de crecimiento; el resto se mece despacio.
let _gardenPrevN = -1;
let _gardenDay = '';

function _gardenFlower(i, x, y, sz, color, isNew) {
  const H = Math.round(15 * sz + 7);           // altura del tallo
  const swayDelay = ((i * 0.83) % 5.5).toFixed(2);
  const growDelay = (i * 0.07).toFixed(2);
  let corola;
  if (i % 2 === 0) {
    // Nota-flor: cabeza de negra inclinada con un destello
    const rx = (4.4 * sz).toFixed(1), ry = (3.3 * sz).toFixed(1);
    corola = '<ellipse cx="0" cy="' + (-H - 2) + '" rx="' + rx + '" ry="' + ry + '"'
      + ' transform="rotate(-18 0 ' + (-H - 2) + ')" fill="' + color + '"/>'
      + '<circle cx="' + (1.4 * sz).toFixed(1) + '" cy="' + (-H - 3.2).toFixed(1) + '" r="' + (0.9 * sz).toFixed(1) + '" fill="var(--bg)" opacity="0.35"/>';
  } else {
    // Flor de tres pétalos con corazón claro
    const p = (4.6 * sz).toFixed(1), q = (2.6 * sz).toFixed(1);
    corola = [-38, 0, 38].map(a =>
      '<ellipse cx="0" cy="' + (-H - 3.5) + '" rx="' + q + '" ry="' + p + '"'
      + ' transform="rotate(' + a + ' 0 ' + (-H + 1) + ')" fill="' + color + '" opacity="0.92"/>'
    ).join('')
      + '<circle cx="0" cy="' + (-H - 1) + '" r="' + (1.3 * sz).toFixed(1) + '" fill="var(--accent2)" opacity="0.9"/>';
  }
  return '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')">'
    + '<g class="garden-grow"' + (isNew ? '' : ' style="animation:none"') + (isNew ? ' style="animation-delay:' + growDelay + 's"' : '') + '>'
    + '<g class="garden-sway" style="animation-delay:-' + swayDelay + 's">'
    + '<path d="M0 0 C ' + (-1.6 * sz).toFixed(1) + ' ' + (-H / 3).toFixed(1) + ' ' + (1.6 * sz).toFixed(1) + ' ' + (-2 * H / 3).toFixed(1) + ' 0 ' + (-H) + '" class="garden-tallo"/>'
    + '<path d="M0 ' + (-H * 0.45).toFixed(1) + ' Q ' + (-7 * sz).toFixed(1) + ' ' + (-H * 0.55).toFixed(1) + ' ' + (-9 * sz).toFixed(1) + ' ' + (-H * 0.85).toFixed(1) + ' Q ' + (-2.5 * sz).toFixed(1) + ' ' + (-H * 0.72).toFixed(1) + ' 0 ' + (-H * 0.52).toFixed(1) + ' Z" class="garden-hoja"/>'
    + corola
    + '</g></g></g>';
}

function renderCronoGarden() {
  const host = document.getElementById('cronoGarden');
  if (!host) return;
  const hoy = _statsISO(new Date());
  const plantas = (db.sessionPlants || []).filter(p => {
    if (!p || p.failed || p.tipo === 'descanso' || !p.startedAt || !(p.mins > 0)) return false;
    const d = new Date(p.startedAt);
    return !isNaN(d.getTime()) && _statsISO(d) === hoy;
  }).slice(0, 14);
  if (_gardenDay !== hoy) { _gardenPrevN = -1; _gardenDay = hoy; }
  if (plantas.length === _gardenPrevN) return;
  const animFrom = _gardenPrevN < 0 ? 0 : _gardenPrevN; // tras recargar, brotan todas una vez
  _gardenPrevN = plantas.length;

  const h = new Date().getHours();
  const night = h >= 21 || h < 7;
  let svg = '<svg class="crono-garden-svg" viewBox="0 0 360 150" xmlns="http://www.w3.org/2000/svg">';

  // Cielo
  if (night) {
    svg += '<path d="M316 24 a13 13 0 1 0 11 20 a10.5 10.5 0 0 1 -11 -20 z" class="garden-luna"/>';
    [[42, 18], [92, 30], [152, 12], [228, 26], [288, 10], [196, 38]].forEach((s, i) => {
      svg += '<circle cx="' + s[0] + '" cy="' + s[1] + '" r="1.2" class="garden-star" style="animation-delay:' + (i * 0.6).toFixed(1) + 's"/>';
    });
  } else {
    svg += '<circle cx="320" cy="28" r="11" class="garden-sol"/>'
      + '<circle cx="320" cy="28" r="16" class="garden-sol-halo"/>';
  }

  // Colinas (suelo bajado para dar altura al campo)
  svg += '<path d="M0 120 Q 90 96 180 112 T 360 106 L 360 150 L 0 150 Z" class="garden-colina1"/>'
    + '<path d="M0 132 Q 120 114 250 128 T 360 124 L 360 150 L 0 150 Z" class="garden-colina2"/>'
    + '<path d="M14 137 q 3 -8 5 -11 M30 140 q -2 -9 -6 -13 M338 136 q 3 -7 6 -10 M322 139 q -2 -8 -4 -11" class="garden-hierba"/>';

  if (!plantas.length) {
    // Brote solitario: invitación a plantar la primera sesión
    svg += '<g transform="translate(180,124)"><g class="garden-grow"><g class="garden-sway">'
      + '<path d="M0 0 C -1 -6 1 -12 0 -18" class="garden-tallo"/>'
      + '<path d="M0 -11 Q -8 -13 -11 -20 Q -2 -19 0 -12 Z" class="garden-hoja"/>'
      + '<path d="M0 -14 Q 8 -16 11 -24 Q 2 -22 0 -15 Z" class="garden-hoja"/>'
      + '</g></g></g>';
  } else {
    const n = plantas.length;
    const spread = Math.min(48, 320 / n);
    plantas.forEach((p, i) => {
      const obra = findObra(p.obraId);
      const color = (obra && obraColorHex(obra)) || 'var(--accent)';
      const seed = ((i * 2654435761) % 1000) / 1000;
      const x = 180 + (i - (n - 1) / 2) * spread + (seed - 0.5) * 14;
      const y = 124 + Math.sin(x / 47 + 1.3) * 6;
      const sz = 1.5 + Math.min(p.mins || 0, 60) / 60 * 0.75;
      svg += _gardenFlower(i, x, y, sz, color, i >= animFrom);
    });
  }
  svg += '</svg>';
  host.innerHTML = svg;
}


// Refresca todos los textos "hoy te has concentrado..." y el mini-resumen
// Tarjeta "Esta semana" del cronómetro (visible solo en Mármol): total de la
// semana en curso + barras por día (hoy resaltado).
function renderCronoWeekCard() {
  const el = document.getElementById('cronoWeekCard');
  if (!el) return;
  const now = new Date();
  const start = (typeof _weekStart === 'function')
    ? _weekStart(now)
    : (() => { const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d; })();
  const next = new Date(start); next.setDate(start.getDate() + 7);
  const porDia = (typeof _statsMinsPorDia === 'function') ? _statsMinsPorDia(start, next) : {};
  let total = 0; Object.keys(porDia).forEach(k => total += porDia[k]);
  const arr = (typeof _statsMinsPorDiaSemana === 'function') ? _statsMinsPorDiaSemana(porDia) : new Array(7).fill(0);
  const todayIdx = (now.getDay() + 6) % 7;
  const max = Math.max(1, Math.max.apply(null, arr));
  const letters = ['L','M','X','J','V','S','D'];
  let cols = '';
  arr.forEach((v, i) => {
    const h = v > 0 ? Math.max(8, Math.round(v / max * 100)) : 4;
    cols += '<div class="crono-week-col">'
      + '<div class="crono-week-bar' + (i === todayIdx ? ' today' : '') + '" style="height:' + h + '%"></div>'
      + '<span class="crono-week-day">' + letters[i] + '</span></div>';
  });
  el.innerHTML =
    '<div class="crono-week-info">' +
      '<div class="crono-week-lbl">ESTA SEMANA</div>' +
      '<div class="crono-week-big">' + fmtMinutos(total) + '</div>' +
    '</div>' +
    '<div class="crono-week-bars">' + cols + '</div>';
}

// Tarjeta de Destellos (paralela a "Esta semana", solo Mármol): nº de sesiones
// de excelencia + acceso a la lista.
function renderCronoDestellosCard() {
  const el = document.getElementById('cronoDestellosCard');
  if (!el) return;
  let n = 0;
  try { n = (typeof getAllDestellos === 'function') ? getAllDestellos().length : 0; } catch (e) {}
  el.innerHTML =
    '<div class="crono-week-info">' +
      '<div class="crono-week-lbl">DESTELLOS</div>' +
      '<div class="crono-dest-big"><span class="crono-dest-star">★</span> ' + n + '</div>' +
    '</div>' +
    '<div class="crono-dest-cta">Ver ›</div>';
}

// ── PASAJES DIFÍCILES ─────────────────────────────────────────────────────────
// Panel de hasta 5 focos de pasaje del repertorio.
// En cronómetro se registran como bolitas: categoría (rojo/ámbar/perla) y
// dos valoraciones rápidas del día: frío y después. solHistory se conserva
// para que las gráficas existentes puedan seguir leyendo evolución.
const PASAJE_MAX = 5;
const PASAJE_GRAD = 85;
const PASAJE_TIERS = {
  red:   { label: 'Rojo',  color: 'var(--red)',    next: 'amber' },
  amber: { label: 'Ámbar', color: 'var(--orange)', next: 'pearl' },
  pearl: { label: 'Perla', color: 'var(--text3)',  next: 'red' },
};
const PASAJE_SCORE_LABELS = ['', 'Muy mal', 'Mal', 'Normal', 'Bien', 'Excelente'];
let _pasajeNuevoTier = 'red';

function _pasajeDateKey(date) {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function _pasajeTierFromSol(sol) {
  if (sol >= 75) return 'pearl';
  if (sol >= 45) return 'amber';
  return 'red';
}

function _normalizePasajeTier(tier) {
  if (tier === 'orange') return 'amber';
  return PASAJE_TIERS[tier] ? tier : 'red';
}

function _normalizeCronoPasaje(p, i) {
  if (!p || typeof p !== 'object') return null;
  if (!p.id) p.id = 'pj' + Date.now() + '_' + i;
  if (!p.name) p.name = p.text || p.nombre || 'Pasaje';
  if (!p.createdAt) p.createdAt = new Date().toISOString();
  if (!Array.isArray(p.solHistory)) p.solHistory = [];
  if (!Array.isArray(p.focusHistory)) p.focusHistory = [];
  p.tier = _normalizePasajeTier(p.tier || _pasajeTierFromSol(_pasajeSolActual(p)));
  return p;
}
function _cronoPasajes() {
  if (!Array.isArray(db.cronoPasajes)) db.cronoPasajes = [];
  db.cronoPasajes.forEach(_normalizeCronoPasaje);
  return db.cronoPasajes;
}
function _activeCronoPasajes() { return _cronoPasajes().filter(p => !p.graduatedAt); }
function _pasajeSolActual(p) {
  const h = p.solHistory || [];
  return h.length ? (h[h.length - 1].val || 0) : 0;
}
function _pasajeDias(p) {
  const t0 = p.createdAt ? new Date(p.createdAt).getTime() : Date.now();
  const t1 = p.graduatedAt ? new Date(p.graduatedAt).getTime() : Date.now();
  return Math.max(0, Math.round((t1 - t0) / 86400000));
}
function _pasajesMediaDias() {
  const grad = _cronoPasajes().filter(p => p.graduatedAt && p.createdAt);
  if (!grad.length) return null;
  const dias = grad.map(p => _pasajeDias(p));
  return Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
}

let _pasajeOpenId = null;

function updatePasajeSolSlider(slider, valueId) {
  const el = typeof slider === 'string' ? document.getElementById(slider) : slider;
  if (!el) return;
  const raw = parseInt(el.value || '0', 10);
  const val = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
  const label = valueId ? document.getElementById(valueId) : null;
  const color = (typeof solPctColor === 'function') ? solPctColor(val) : 'var(--accent)';
  if (label) {
    label.textContent = val + '%';
    label.style.color = color;
  }
  if (typeof fillSlider === 'function') fillSlider(el, color);
}

function renderCronoPasajes() {
  const runTarget = document.getElementById('cronoPasajesSection');
  const idleTarget = document.getElementById('cronoIdlePasajesSection');
  if (!runTarget && !idleTarget) return;
  const activos = _activeCronoPasajes();
  if (_pasajeOpenId && !activos.some(p => p.id === _pasajeOpenId)) _pasajeOpenId = null;
  const abierto = activos.find(p => p.id === _pasajeOpenId);
  const hoy = _pasajeDateKey();
  const hechosHoy = activos.filter(p => (p.focusHistory || []).some(h => h.key === hoy || _pasajeDateKey(h.date) === hoy)).length;
  const progress = hechosHoy + '/' + activos.length + ' hoy';

  if (idleTarget) {
    idleTarget.innerHTML =
      '<div class="crono-pasajes-head"><span class="crono-week-lbl">PASAJES</span><span class="crono-pasajes-progress">' + progress + '</span></div>' +
      '<div class="crono-pasajes-card crono-pasajes-card-idle' + (abierto ? ' is-expanded' : '') + '">' +
        '<div class="crono-pasajes-summary">' +
          '<div class="crono-pasajes-copy"><div class="crono-pasajes-title">Focos preparados</div></div>' +
          _renderPasajeIdleChips(activos, abierto) +
        '</div>' +
        (abierto ? _renderPasajeCompactExpanded(abierto) : '') +
      '</div>';
  }

  if (runTarget) {
    runTarget.innerHTML =
      '<div class="crono-pasajes-head"><span class="crono-week-lbl">FOCO DE PASAJE</span><span class="crono-pasajes-progress">' + progress + '</span></div>' +
      '<div class="crono-pasajes-card crono-pasajes-card-run' + (abierto ? ' is-expanded' : '') + '">' +
        _renderPasajeFocusList(activos, abierto) +
      '</div>';
  }
}

function _renderPasajeIdleChips(activos, abierto) {
  const chips = activos.map(p => {
    const tier = PASAJE_TIERS[_normalizePasajeTier(p.tier)];
    const open = abierto && abierto.id === p.id;
    return '<button type="button" class="crono-pasaje-name-chip' + (open ? ' active' : '') + '" style="--pasaje-tier-color:' + tier.color + '" onclick="openPasaje(\'' + hechoJs(p.id) + '\')">' +
      '<span aria-hidden="true"></span><strong>' + escapeHtmlSafe(p.name) + '</strong>' +
    '</button>';
  }).join('');
  const add = activos.length < PASAJE_MAX
    ? '<button type="button" class="crono-pasaje-name-chip add" onclick="openPasajeNuevo()"><span aria-hidden="true">+</span><strong>Añadir</strong></button>'
    : '';
  return '<div class="crono-pasaje-name-chips" aria-label="Pasajes preparados">' + (chips || add) + (chips ? add : '') + '</div>';
}

function _renderPasajeFocusList(activos, abierto) {
  if (!activos.length) {
    return '<div class="crono-focus-empty"><span>No hay pasajes preparados</span>' +
      '<button type="button" onclick="openPasajeNuevo()">Añadir pasaje</button></div>';
  }
  const rows = activos.map(p => {
    const tier = PASAJE_TIERS[_normalizePasajeTier(p.tier)];
    const today = _pasajeTodayLog(p) || {};
    const open = abierto && abierto.id === p.id;
    const cold = today.cold ? PASAJE_SCORE_LABELS[today.cold] : '—';
    const after = today.after ? PASAJE_SCORE_LABELS[today.after] : '—';
    return '<div class="crono-focus-pasaje' + (open ? ' is-open' : '') + '" style="--pasaje-tier-color:' + tier.color + '">' +
      '<button type="button" class="crono-focus-pasaje-main" onclick="openPasaje(\'' + hechoJs(p.id) + '\')" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="crono-focus-pasaje-dot" aria-hidden="true"></span>' +
        '<span class="crono-focus-pasaje-copy"><strong>' + escapeHtmlSafe(p.name) + '</strong><span>' + tier.label + '</span></span>' +
        '<span class="crono-focus-pasaje-scores"><span>Frío <strong>' + escapeHtmlSafe(cold) + '</strong></span><span>Después <strong>' + escapeHtmlSafe(after) + '</strong></span></span>' +
        '<span class="crono-focus-pasaje-chevron" aria-hidden="true">⌄</span>' +
      '</button>' +
      (open ? _renderPasajeCompactExpanded(p) : '') +
    '</div>';
  }).join('');
  const add = activos.length < PASAJE_MAX
    ? '<button type="button" class="crono-focus-add" onclick="openPasajeNuevo()">+ Añadir otro pasaje</button>'
    : '';
  return '<div class="crono-focus-pasaje-list">' + rows + add + '</div>';
}

function _renderPasajeCompactExpanded(p) {
  const today = _pasajeTodayLog(p) || {};
  return '<div class="crono-pasaje-expanded crono-pasaje-expanded-compact">' +
    '<div class="crono-pasaje-score-wrap">' +
      _renderPasajeScoreRow(p.id, 'cold', 'En frío', today.cold || 0) +
      _renderPasajeScoreRow(p.id, 'after', 'Después', today.after || 0) +
    '</div>' +
    '<div class="crono-pasaje-expanded-foot"><span class="crono-pasaje-note">Se guarda al tocar</span></div>' +
  '</div>';
}

function _renderPasajeDotRows(activos, abierto) {
  const rows = ['red', 'amber', 'pearl'].map(tierKey => {
    const tier = PASAJE_TIERS[tierKey];
    const items = activos.filter(p => _normalizePasajeTier(p.tier) === tierKey);
    if (!items.length) return '';
    return '<div class="crono-pasajes-dot-row tier-' + tierKey + '" style="--pasaje-tier-color:' + tier.color + '">' +
      '<span class="crono-pasajes-row-label">' + tier.label + '</span>' +
      '<div class="crono-pasajes-row-dots">' +
        items.map(p => _renderPasajeDot(p, abierto && abierto.id === p.id)).join('') +
      '</div>' +
    '</div>';
  }).join('');
  const add = activos.length < PASAJE_MAX
    ? '<div class="crono-pasajes-dot-row crono-pasajes-dot-row-add">' +
        '<span class="crono-pasajes-row-label">A&ntilde;adir</span>' +
        '<div class="crono-pasajes-row-dots">' + _renderPasajeAddDot() + '</div>' +
      '</div>'
    : '';
  return (rows || add) ? rows + add : '';
}

function openPasajeNuevo() {
  if (_activeCronoPasajes().length >= PASAJE_MAX) {
    showToast('Ya tienes 5 pasajes activos');
    return;
  }
  const nom = document.getElementById('pasajeNuevoNombre');
  if (nom) nom.value = '';
  selectPasajeNuevoTier('red');
  openModal('modalPasajeNuevo');
}

function confirmPasajeNuevo() {
  const nom = (document.getElementById('pasajeNuevoNombre')?.value || '').trim();
  if (!nom) { showToast('Escribe el nombre del pasaje'); return; }
  if (_activeCronoPasajes().length >= PASAJE_MAX) { showToast('Ya tienes 5 pasajes'); return; }
  const now = new Date().toISOString();
  _cronoPasajes().push({
    id: 'pj' + Date.now(),
    name: nom,
    tier: _normalizePasajeTier(_pasajeNuevoTier),
    createdAt: now,
    graduatedAt: null,
    focusHistory: [],
    solHistory: [],
  });
  saveData();
  closeModal('modalPasajeNuevo');
  renderCronoPasajes();
  showToast('Pasaje añadido');
}

function openPasaje(id) {
  const p = _cronoPasajes().find(x => x.id === id);
  if (!p) return;
  _pasajeOpenId = _pasajeOpenId === id ? null : id;
  renderCronoPasajes();
}

function _renderPasajeDot(p, isOpen) {
  const tier = PASAJE_TIERS[_normalizePasajeTier(p.tier)];
  const today = _pasajeTodayLog(p);
  const done = !!(today && (today.cold || today.after));
  const cls = 'crono-pasaje-dot tier-' + p.tier + (done ? ' is-done' : '') + (isOpen ? ' is-open' : '');
  return '<button type="button" class="' + cls + '" style="--pasaje-tier-color:' + tier.color + '" onclick="openPasaje(\'' + p.id + '\')" aria-label="' + escapeHtmlSafe(p.name) + '">' +
    '<span></span>' +
  '</button>';
}

function _renderPasajeAddDot() {
  return '<button type="button" class="crono-pasaje-dot crono-pasaje-dot-add" onclick="openPasajeNuevo()" aria-label="Añadir pasaje"><span>+</span></button>';
}

function _renderPasajesLegend() {
  return '<div class="crono-pasajes-legend">' +
    '<span class="tier-red">rojo</span>' +
    '<span class="tier-amber">ámbar</span>' +
    '<span class="tier-pearl">perla</span>' +
  '</div>';
}

function _renderPasajeExpanded(p) {
  const today = _pasajeTodayLog(p) || {};
  const tier = PASAJE_TIERS[_normalizePasajeTier(p.tier)];
  const suggestion = _pasajeSuggestion(p);
  const suggestionHtml = suggestion
    ? '<button type="button" class="crono-pasaje-suggestion" onclick="applyCronoPasajeSuggestion(\'' + p.id + '\')">' + escapeHtmlSafe(suggestion.label) + '</button>'
    : '<span class="crono-pasaje-note">Se guarda al tocar. Sin modal.</span>';
  return '<div class="crono-pasaje-expanded">' +
    '<div class="crono-pasaje-expanded-info">' +
      '<div class="crono-pasaje-expanded-name">' + escapeHtmlSafe(p.name) + '</div>' +
      '<button type="button" class="crono-pasaje-tier-chip tier-' + p.tier + '" style="--pasaje-tier-color:' + tier.color + '" onclick="cycleCronoPasajeTier(\'' + p.id + '\')">' + tier.label + '</button>' +
      '<button type="button" class="crono-pasaje-remove-mini" onclick="removeCronoPasaje(\'' + p.id + '\')" aria-label="Quitar pasaje">Quitar</button>' +
    '</div>' +
    '<div class="crono-pasaje-score-wrap">' +
      _renderPasajeScoreRow(p.id, 'cold', 'Frío', today.cold || 0) +
      _renderPasajeScoreRow(p.id, 'after', 'Después', today.after || 0) +
    '</div>' +
    '<div class="crono-pasaje-expanded-foot">' + suggestionHtml + '</div>' +
  '</div>';
}

function _renderPasajeScoreRow(id, phase, label, selected) {
  let dots = '';
  for (let i = 1; i <= 5; i++) {
    dots += '<button type="button" class="crono-pasaje-score-dot' + (selected === i ? ' active' : '') + '" onclick="saveCronoPasajeScore(\'' + id + '\',\'' + phase + '\',' + i + ')" aria-label="' + label + ' ' + PASAJE_SCORE_LABELS[i] + '"><span></span></button>';
  }
  const out = selected ? PASAJE_SCORE_LABELS[selected] : '-';
  return '<div class="crono-pasaje-score-row">' +
    '<span class="crono-pasaje-score-label">' + label + '</span>' +
    '<div class="crono-pasaje-score-dots">' + dots + '</div>' +
    '<span class="crono-pasaje-score-out">' + out + '</span>' +
  '</div>';
}

function _pasajeTodayLog(p) {
  const today = _pasajeDateKey();
  return (p.focusHistory || []).find(h => h.key === today || _pasajeDateKey(h.date) === today) || null;
}

function _scoreToSol(score) {
  return Math.max(0, Math.min(100, Math.round(score * 20)));
}

function saveCronoPasajeScore(id, phase, score) {
  const p = _cronoPasajes().find(x => x.id === id);
  if (!p || (phase !== 'cold' && phase !== 'after')) return;
  const val = Math.max(1, Math.min(5, parseInt(score, 10) || 1));
  const now = new Date();
  const key = _pasajeDateKey(now);
  if (!Array.isArray(p.focusHistory)) p.focusHistory = [];
  let log = _pasajeTodayLog(p);
  if (!log) {
    log = { date: now.toISOString(), key };
    p.focusHistory.push(log);
  }
  log[phase] = val;
  log.updatedAt = now.toISOString();
  p.lastStudiedAt = now.toISOString();
  if (phase === 'after') _upsertPasajeSolToday(p, _scoreToSol(val), now);
  if (p.focusHistory.length > 160) p.focusHistory = p.focusHistory.slice(-160);
  if (log.cold && log.after) _pasajeOpenId = null;
  saveData();
  if (typeof showSavedCheck === 'function') showSavedCheck();
  renderCronoPasajes();
}

function _upsertPasajeSolToday(p, val, date) {
  if (!Array.isArray(p.solHistory)) p.solHistory = [];
  const key = _pasajeDateKey(date);
  const hit = p.solHistory.find(h => h.context === 'bolitas' && _pasajeDateKey(h.date) === key);
  if (hit) {
    hit.val = val;
    hit.date = date.toISOString();
  } else {
    p.solHistory.push({ date: date.toISOString(), val, context: 'bolitas' });
  }
  if (p.solHistory.length > 200) p.solHistory = p.solHistory.slice(-200);
}

function _pasajeSuggestion(p) {
  const tier = _normalizePasajeTier(p.tier);
  if (tier === 'pearl') return null;
  const recent = (p.focusHistory || []).filter(h => h.after).slice(-3);
  if (recent.length < 3 || recent.some(h => h.after < 4)) return null;
  const next = PASAJE_TIERS[tier].next;
  return {
    tier: next,
    label: next === 'amber' ? 'Puede bajar a ámbar' : 'Puede pasar a perla',
  };
}

function cycleCronoPasajeTier(id) {
  const p = _cronoPasajes().find(x => x.id === id);
  if (!p) return;
  p.tier = PASAJE_TIERS[_normalizePasajeTier(p.tier)].next;
  saveData();
  renderCronoPasajes();
}

function applyCronoPasajeSuggestion(id) {
  const p = _cronoPasajes().find(x => x.id === id);
  const suggestion = p ? _pasajeSuggestion(p) : null;
  if (!p || !suggestion) return;
  p.tier = suggestion.tier;
  saveData();
  renderCronoPasajes();
}

function removeCronoPasaje(id) {
  _pasajeOpenId = id;
  removePasaje();
}

function selectPasajeNuevoTier(tier) {
  _pasajeNuevoTier = _normalizePasajeTier(tier);
  document.querySelectorAll('#modalPasajeNuevo .pasaje-tier-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tier === _pasajeNuevoTier);
  });
}

function savePasajeSolidez() {
  const p = _cronoPasajes().find(x => x.id === _pasajeOpenId);
  if (!p) return;
  const val = Math.max(0, Math.min(100, parseInt(document.getElementById('pasajeRegSol')?.value || '0', 10)));
  if (!Array.isArray(p.solHistory)) p.solHistory = [];
  p.solHistory.push({ date: new Date().toISOString(), val });
  if (p.solHistory.length > 200) p.solHistory = p.solHistory.slice(-200);
  let graduado = false;
  if (val >= PASAJE_GRAD && !p.graduatedAt) { p.graduatedAt = new Date().toISOString(); graduado = true; }
  saveData();
  closeModal('modalPasaje');
  renderCronoPasajes();
  if (graduado) {
    showToast('🎉 ¡Pasaje a punto en ' + _pasajeDias(p) + ' días! Hueco liberado');
    if (typeof SFX !== 'undefined' && SFX.milestone) SFX.milestone();
  } else {
    showToast('Solidez registrada · ' + val + '%');
  }
}

function removePasaje() {
  const p = _cronoPasajes().find(x => x.id === _pasajeOpenId);
  if (!p) return;
  if (!confirm('¿Quitar el pasaje "' + p.name + '"?\n\nSe borra su historial de bolitas y solidez.')) return;
  db.cronoPasajes = _cronoPasajes().filter(x => x.id !== p.id);
  _pasajeOpenId = null;
  saveData();
  closeModal('modalPasaje');
  renderCronoPasajes();
  showToast('Pasaje quitado');
}

// Gráfica simple de la evolución de solidez del pasaje (línea + línea de meta 85%).
function _pasajeChartSVG(p) {
  const hist = (p.solHistory || []).slice();
  if (hist.length < 2) {
    return '<div class="pasaje-chart-empty">Registra la solidez unos cuantos días y aquí verás cómo evoluciona.</div>';
  }
  const W = 412, H = 150, padL = 30, padR = 10, padT = 12, padB = 22;
  const cW = W - padL - padR, cH = H - padT - padB;
  const t0 = new Date(hist[0].date).getTime();
  const t1 = new Date(hist[hist.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);
  const xOf = d => padL + ((new Date(d).getTime() - t0) / span) * cW;
  const yOf = v => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * cH;
  // rejilla y línea de meta
  let g = '';
  [0, 50, 100].forEach(v => {
    const y = yOf(v);
    g += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="var(--border2)" stroke-width="1"/>';
    g += '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-size="8" fill="var(--text3)">' + v + '</text>';
  });
  const yMeta = yOf(PASAJE_GRAD);
  g += '<line x1="' + padL + '" y1="' + yMeta + '" x2="' + (W - padR) + '" y2="' + yMeta + '" stroke="var(--green)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>';
  const pts = hist.map(h => xOf(h.date).toFixed(1) + ',' + yOf(h.val).toFixed(1));
  const line = '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  const dots = hist.map(h => '<circle cx="' + xOf(h.date).toFixed(1) + '" cy="' + yOf(h.val).toFixed(1) + '" r="2.6" fill="var(--accent)"/>').join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pasaje-chart-svg">' + g + line + dots + '</svg>';
}

// Tarjeta resumen del día de la pestaña Sesión (visible solo en Mármol):
function getExplicitDailyGoalMinutes() {
  const candidates = [
    db && db.dailyGoalMinutes,
    db && db.settings && db.settings.dailyGoalMinutes,
  ];
  try {
    const saved = JSON.parse(localStorage.getItem('alberto_daily_goal_v1') || 'null');
    candidates.push(saved && (saved.minutes ?? saved.dailyGoalMinutes));
  } catch(e) {}
  const goal = candidates.map(Number).find(n => Number.isFinite(n) && n > 0);
  return goal ? Math.round(goal) : null;
}

// Resumen neutral cuando no existe una meta diaria explícita; nunca presenta
// una cifra predeterminada como si fuera una decisión del usuario.
function renderSessionResumen() {
  const el = document.getElementById('sessionResumenCard');
  if (!el) return;
  const done = (typeof getMinutosConcentradoHoy === 'function') ? getMinutosConcentradoHoy() : 0;
  const goal = getExplicitDailyGoalMinutes();
  const todayKey = sessionJournalDayKey(new Date());
  const activity = [];
  (db.sessionPlants || []).forEach(plant => {
    if (!plant || plant.failed || plant.tipo === 'descanso' || !plant.startedAt) return;
    if (sessionJournalDayKey(plant.startedAt) === todayKey) {
      activity.push({ at: plant.startedAt, label: 'Estudio' });
    }
  });
  sessionJournalTodayEntries().forEach(entry => activity.push({ at: entry.at, label: 'Diario' }));
  activity.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const lastActivity = activity.length ? activity[activity.length - 1] : null;
  const lastActivityText = lastActivity
    ? 'Última actividad · ' + lastActivity.label.toLowerCase() + ' a las ' + new Date(lastActivity.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : 'Aún sin actividad registrada';
  const goalMarkup = goal
    ? (() => {
        const pct = Math.max(0, Math.min(100, Math.round(done / goal * 100)));
        const C = 2 * Math.PI * 34;
        const dash = (C * pct / 100).toFixed(1);
        return '<svg class="session-resumen-ring" viewBox="0 0 80 80" aria-hidden="true">' +
          '<circle cx="40" cy="40" r="34" fill="none" stroke="var(--bg3)" stroke-width="8"/>' +
          '<circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + C.toFixed(1) + '" transform="rotate(-90 40 40)"/>' +
          '<text x="40" y="46" text-anchor="middle" class="session-resumen-pct">' + pct + '%</text>' +
        '</svg>';
      })()
    : '<div class="session-resumen-neutral" aria-hidden="true">·</div>';
  let racha = 0;
  try { racha = (typeof computeRacha === 'function') ? (computeRacha().racha || 0) : 0; } catch (e) {}
  const rachaHtml = racha > 0
    ? '<div class="session-resumen-racha">racha ' + racha + (racha === 1 ? ' día' : ' días') + '</div>'
    : '';
  el.classList.toggle('is-neutral', !goal);
  el.innerHTML = goalMarkup +
    '<div class="session-resumen-info">' +
      '<div class="session-resumen-lbl">HOY</div>' +
      '<div class="session-resumen-big">' + fmtMinutos(done) + '</div>' +
      '<div class="session-resumen-sub">' + (goal ? ('de tu objetivo de ' + fmtMinutos(goal)) : 'sin objetivo configurado') + '</div>' +
      '<div class="session-resumen-last">' + lastActivityText + '</div>' +
    '</div>' +
    rachaHtml;
}

function refreshConcentradoUI() {
  const min = getMinutosConcentradoHoy();
  if (typeof renderSessionResumen === 'function') renderSessionResumen();
  // Cronómetro: texto completo. Sesión: pill corto ("Hoy · 0 min").
  const cronoEl = document.getElementById('cronoConcentradoText');
  if (cronoEl) cronoEl.textContent = 'Hoy te has concentrado ' + fmtMinutosLargo(min);
  const sessEl = document.getElementById('sessionConcentradoText');
  if (sessEl) sessEl.textContent = 'Hoy · ' + fmtMinutos(min);

  // Pill de destellos (abajo a la izquierda en el cronómetro en reposo)
  if (typeof refreshDestellosPill === 'function') refreshDestellosPill();
  if (typeof renderSessionInsights === 'function') renderSessionInsights();
  if (typeof renderCronoGarden === 'function') renderCronoGarden();
  if (typeof renderCronoWeekCard === 'function') renderCronoWeekCard();
  if (typeof renderCronoDestellosCard === 'function') renderCronoDestellosCard();
  if (typeof renderCronoPasajes === 'function') renderCronoPasajes();
  if (typeof renderCronoAyerPanel === 'function') renderCronoAyerPanel();

  // Mini-resumen lateral eliminado: el jardín del día ya muestra lo
  // estudiado hoy de forma visual, y los Destellos guardan lo memorable.
  // Se mantiene el contenedor oculto por compatibilidad.
  const resumenEl = document.getElementById('cronoResumenLateral');
  if (resumenEl) {
    resumenEl.style.display = 'none';
    resumenEl.innerHTML = '';
    return;
    /* eslint-disable no-unreachable */
    const itemsHoy = getResumenSesionesHoy();
    // Hasta 2 días previos con actividad (Ayer + Anteayer u otros si hubo huecos)
    const pasadas = getResumenSesionesPasadas(2);
    if (!itemsHoy.length && !pasadas.length) {
      resumenEl.style.display = 'none';
      return;
    }
    resumenEl.style.display = '';
    // Captura del planId que se acaba de añadir/actualizar, para animarlo.
    const newId = _cronoLastAddedPlanId;
    _cronoLastAddedPlanId = null;
    let html = '';
    // Sección HOY
    if (itemsHoy.length) {
      html += '<div class="crono-resumen-section crono-resumen-hoy">';
      html += '<div class="crono-resumen-section-label">Hoy</div>';
      html += itemsHoy.map(it => {
        const minTxt = it.minutos >= 60
          ? Math.floor(it.minutos / 60) + 'h' + (it.minutos % 60 ? ' ' + (it.minutos % 60) + 'm' : '')
          : it.minutos + ' min';
        const isNew = (it.planId && it.planId === newId);
        const restCls = it.isRest ? ' is-rest' : '';
        const destCls = it.destello ? ' is-destello' : '';
        const destLabel = it.destello ? '✨ ' : '';
        const destNotaHtml = (it.destello && it.destelloNota)
          ? '<div class="crono-resumen-destello-nota">' + escapeHtmlSafe(it.destelloNota) + '</div>'
          : '';
        return '<div class="crono-resumen-row' + (isNew ? ' is-new' : '') + restCls + destCls + '" data-plan="' + it.planId + '">' +
          '<span class="crono-resumen-label">' + destLabel + it.label + '</span>' +
          '<span class="crono-resumen-min">' + minTxt + '</span>' +
        '</div>' + destNotaHtml;
      }).join('');
      html += '</div>';
    }
    // Secciones de días previos (Ayer, Anteayer, ...).
    // data-dia-idx controla la opacidad CSS: 0 = ayer (más visible),
    // 1 = anteayer (más diluido).
    pasadas.forEach((dia, idx) => {
      html += '<div class="crono-resumen-section crono-resumen-ayer" data-dia-idx="' + idx + '">';
      html += '<div class="crono-resumen-section-label">' + escapeHtmlSafe(dia.etiquetaDia) + '</div>';
      html += dia.items.map(it => {
        const minTxt = it.minutos >= 60
          ? Math.floor(it.minutos / 60) + 'h' + (it.minutos % 60 ? ' ' + (it.minutos % 60) + 'm' : '')
          : it.minutos + ' min';
        let extras = '';
        if (it.pasajes && it.pasajes.length) {
          extras += '<div class="crono-resumen-pasajes">';
          extras += it.pasajes.map(p => {
            const ic = p.intensidad === 'alta' ? '🔥' :
                       p.intensidad === 'media' ? '●' : '○';
            return '<span class="crono-resumen-pasaje">' + ic + ' ' + escapeHtmlSafe(p.name) + '</span>';
          }).join('');
          extras += '</div>';
        }
        if (it.destello && it.destelloNota) {
          extras += '<div class="crono-resumen-destello-nota">' + escapeHtmlSafe(it.destelloNota) + '</div>';
        }
        if (it.nota) {
          extras += '<div class="crono-resumen-nota">' + escapeHtmlSafe(it.nota) + '</div>';
        }
        const destCls = it.destello ? ' is-destello' : '';
        const destLabel = it.destello ? '✨ ' : '';
        return '<div class="crono-resumen-row' + destCls + '">' +
          '<span class="crono-resumen-label">' + destLabel + escapeHtmlSafe(it.label) + '</span>' +
          '<span class="crono-resumen-min">' + minTxt + '</span>' +
          '</div>' + extras;
      }).join('');
      html += '</div>';
    });
    resumenEl.innerHTML = html;
  }
}

// ms reales estudiados (sin contar pausa)
function cronoCurrentMs() {
  if (typeof TimerCore !== 'undefined') {
    return TimerCore.activeElapsedMs(crono, Date.now());
  }
  if (!crono.startTs) return 0;
  const end = crono.state === 'paused' && crono.pauseStartTs ? crono.pauseStartTs : Date.now();
  return Math.max(0, end - crono.startTs - crono.pausedMs);
}

function cronoEffectiveElapsedMs() {
  if (typeof TimerCore !== 'undefined') return TimerCore.effectiveElapsedMs(crono, Date.now());
  const active = cronoCurrentMs();
  return crono.targetDurationMs ? Math.min(active, crono.targetDurationMs) : active;
}

function cronoTargetReached() {
  if (typeof TimerCore !== 'undefined') return TimerCore.isTargetReached(crono, Date.now());
  return !!crono.targetDurationMs && cronoCurrentMs() >= crono.targetDurationMs;
}

function cronoQueueFinish(runId) {
  if (!runId || _cronoPendingFinishRunId === runId || _cronoFinalizingRunId === runId) return;
  _cronoPendingFinishRunId = runId;
  setTimeout(() => {
    if (_cronoPendingFinishRunId === runId) _cronoPendingFinishRunId = null;
    if (crono.runId === runId) cronoFinish(runId);
  }, 0);
}

function cronoHandleLifecycleResume() {
  cronoRefreshWakeLock();
  if (crono.state !== 'running') return;
  if (cronoTargetReached()) {
    cronoStopTick();
    cronoQueueFinish(crono.runId);
  } else if (!crono.tickInterval) {
    cronoStartTick();
    cronoRender();
  }
}

// ms restantes de pausa antes de auto-cierre
function cronoPauseRemainingMs() {
  if (crono.state !== 'paused' || !crono.pauseStartTs) return 0;
  return Math.max(0, CRONO_PAUSE_LIMIT_MS - (Date.now() - crono.pauseStartTs));
}

// ── Modo concentración (oculta topbar, muestra X) ───────────────────────────

function cronoEnterFocus() {
  document.documentElement.classList.add('crono-focus-root');
  document.body.classList.add('crono-focus');
}

function cronoExitFocus() {
  document.documentElement.classList.remove('crono-focus-root');
  document.body.classList.remove('crono-focus');
  document.body.classList.remove('crono-paused');
}

function cronoCloseFocus() {
  // Salir del modo cronómetro: vuelve a Sesión. No para el cronómetro si está
  // corriendo; sólo cambia de vista. Al volver a entrar, el estado sigue ahí.
  showView('session');
}

// ── Render ──────────────────────────────────────────────────────────────────

function cronoRender() {
  const idle = document.getElementById('cronoStageIdle');
  const run  = document.getElementById('cronoStageRun');
  if (!idle || !run) return;

  // Marca de marcha: el pill de Destellos solo se muestra en reposo (idle).
  document.body.classList.toggle('crono-running', crono.state !== 'idle');

  if (crono.state === 'idle') {
    idle.style.display = '';
    run.style.display = 'none';
    document.body.classList.remove('crono-paused');
    // Contador de fallidas, sólo si > 0
    const n = cronoGetFallidasToday();
    const info = document.getElementById('cronoFallidasInfo');
    const nEl  = document.getElementById('cronoFallidasN');
    if (info && nEl) {
      if (n > 0) { info.style.display = ''; nEl.textContent = n; }
      else { info.style.display = 'none'; }
    }
    cronoUpdateStartBtn();
    cronoUpdateTimerProgress();
    cronoRenderNoteCounts();
    cronoRenderTaskCount();
    cronoUpdateRunDrawer();
    cronoSyncObservationInputs();
    return;
  }

  // Running o paused
  idle.style.display = 'none';
  run.style.display  = '';

  // Aplicar color personalizable de la obra (o quitar si no tiene)
  cronoApplyColor(crono.color || null);

  // Nombre de la obra (pildora)
  const nameEl = document.getElementById('cronoRunName');
  if (nameEl) nameEl.textContent = crono.displayName || '—';

  // Estado de la pildora: running activa halo y dot pulse, paused los atenúa
  const pill = document.getElementById('cronoObraPill');
  if (pill) {
    if (crono.state === 'running') {
      pill.classList.add('running');
      pill.classList.remove('paused');
    } else {
      pill.classList.remove('running');
      pill.classList.add('paused');
    }
  }

  // Tiempo principal
  const disp = document.getElementById('cronoDisplay');
  const wrap = document.getElementById('cronoDisplayWrap');
  if (disp) {
    if (crono.targetMinutes != null) {
      const remainingMs = Math.max(0, (crono.targetDurationMs || crono.targetMinutes * 60000) - cronoEffectiveElapsedMs());
      disp.textContent = cronoFmt(remainingMs);
    } else {
      disp.textContent = cronoFmt(cronoEffectiveElapsedMs());
    }
    if (crono.state === 'paused') {
      disp.classList.add('paused');
      if (wrap) wrap.classList.add('is-paused');
    } else {
      disp.classList.remove('paused');
      if (wrap) wrap.classList.remove('is-paused');
    }
    cronoUpdateTimerProgress();
    cronoUpdateRunDestello(cronoEffectiveElapsedMs(), true);
  }

  // Overlay de pausa: activar body.crono-paused para mostrarlo
  const pauseOverlay = document.getElementById('cronoPauseOverlay');
  const runStage = document.getElementById('cronoStageRun');
  if (crono.state === 'paused') {
    document.body.classList.add('crono-paused');
    if (pauseOverlay) pauseOverlay.setAttribute('aria-hidden', 'false');
    if (runStage) runStage.setAttribute('inert', '');
    const ovTime = document.getElementById('cronoPauseOverlayTime');
    if (ovTime) ovTime.textContent = cronoFmt(cronoPauseRemainingMs());
    const ovSession = document.getElementById('cronoPauseOverlaySession');
    if (ovSession) ovSession.textContent = 'Sesión pausada en ' + cronoFmt(cronoEffectiveElapsedMs());
    if (!cronoRender._pauseFocusSet) {
      cronoRender._pauseFocusSet = true;
      setTimeout(() => document.querySelector('#cronoPauseOverlay .crono-pause-overlay-play')?.focus(), 0);
    }
  } else {
    document.body.classList.remove('crono-paused');
    if (pauseOverlay) pauseOverlay.setAttribute('aria-hidden', 'true');
    if (runStage) runStage.removeAttribute('inert');
    cronoRender._pauseFocusSet = false;
  }

  // Controles según estado
  const ctrl = document.getElementById('cronoControls');
  if (!ctrl) return;
  if (crono.state === 'running') {
    const extendBtn = crono.targetMinutes != null && !crono.isRest
      ? '<button class="crono-ctrl-btn extend" onclick="cronoExtendTimer(5)" aria-label="Añadir 5 minutos">+5 min</button>'
      : '';
    ctrl.innerHTML =
      '<button class="crono-ctrl-btn stop" onclick="cronoStop()" aria-label="Terminar y guardar">' + CRONO_ICONS.stop + '</button>' +
      extendBtn +
      '<button class="crono-ctrl-btn primary" onclick="cronoPause()" aria-label="Pausar">' + CRONO_ICONS.pause + '</button>';
  } else if (crono.state === 'paused') {
    ctrl.innerHTML =
      '<button class="crono-ctrl-btn stop" onclick="cronoStop()" aria-label="Terminar y guardar">' + CRONO_ICONS.stop + '</button>' +
      '<button class="crono-ctrl-btn primary" onclick="cronoResume()" aria-label="Reanudar">' + CRONO_ICONS.play + '</button>';
  }
  cronoUpdateSolidityActions();
  cronoRenderNoteCounts();
  cronoRenderTaskCount();
  cronoUpdateRunDrawer();
  cronoSyncObservationInputs();

  // Estado "En marcha / En pausa" (pill de la cabecera, Mármol)
  const stTxt = document.getElementById('cronoRunStatusText');
  const stEl = document.getElementById('cronoRunStatus');
  if (stTxt) stTxt.textContent = crono.state === 'paused' ? 'En pausa' : 'En marcha';
  if (stEl) stEl.classList.toggle('paused', crono.state === 'paused');
  // Subtítulo de objetivo (solo en modo temporizador)
  const tgt = document.getElementById('cronoRunTarget');
  if (tgt) {
    if (crono.targetMinutes) {
      tgt.textContent = (crono.mode === 'until' && crono.untilTime) ? ('hasta ' + crono.untilTime) : ('de ' + fmtMinutos(crono.targetMinutes));
      tgt.style.display = '';
    }
    else tgt.style.display = 'none';
  }
}
function cronoUpdateStartBtn() {
  const btn = document.getElementById('cronoStartBtn');
  const sel = document.getElementById('cronoObraSelect');
  if (!btn || !sel) return;
  if (crono.mode === 'until') cronoEnsureUntilTime();
  const untilMinutes = crono.mode === 'until' ? cronoUntilMinutes() : null;
  btn.disabled = !sel.value || (crono.mode === 'until' && !untilMinutes);
  // Mantener el botón custom sincronizado (dot de color + nombre)
  if (typeof cronoUpdateSelectBtn === 'function') cronoUpdateSelectBtn();
  // Texto del botón según modo
  if (crono.mode === 'timer') {
    btn.textContent = 'Iniciar · ' + crono.timerMinutes + ' min';
  } else if (crono.mode === 'until') {
    btn.textContent = untilMinutes ? ('Iniciar · hasta ' + crono.untilTime) : 'Elige hora futura';
  } else {
    btn.textContent = 'Iniciar';
  }
  // Calcular color de la obra seleccionada y aplicarlo al ensō y al botón
  let color = null;
  if (sel.value) {
    const resolved = cronoResolveSelectValue(sel.value);
    color = resolved ? resolved.color : null;
  }
  cronoApplyColor(color);
  // Mostrar el punto pre-sesión junto al select
  const dot = document.getElementById('cronoIdleDot');
  if (dot) {
    if (sel.value) {
      dot.style.display = '';
      dot.style.background = color || 'var(--accent)';
    } else {
      dot.style.display = 'none';
    }
  }
  cronoUpdateSolidityActions();
  cronoUpdateTimerProjection();
  cronoRenderNoteCounts();
}

function cronoUpdateTimerProjection() {
  const el = document.getElementById('cronoTimerProjection');
  if (!el) return;

  const isTimedMode = crono.mode === 'timer' || crono.mode === 'until';
  if (crono.state !== 'idle' || !isTimedMode) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const addMin = crono.mode === 'until' ? cronoUntilMinutes() : crono.timerMinutes;
  if (!addMin) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const todayMin = typeof getMinutosConcentradoHoy === 'function' ? getMinutosConcentradoHoy() : 0;
  const projectedMin = Math.max(0, todayMin) + Math.max(0, addMin || 0);
  const prefix = crono.mode === 'until'
    ? ('Si llegas hasta ' + crono.untilTime)
    : ('Si terminas ' + addMin + ' min');
  el.innerHTML = prefix + ', <strong>hoy llevarás ' + fmtMinutos(projectedMin) + '</strong>';
  el.style.display = '';
}

// Aplica un color (hex o null) a todos los elementos del cronómetro que deben
// teñirse: ensō, botón plantar (idle) y aros/píldora/halo (running).
function cronoApplyColor(hex) {
  const root = document.getElementById('view-cronometro');
  if (!root) return;
  if (hex) root.style.setProperty('--crono-color', hex);
  else root.style.removeProperty('--crono-color');
}

// ── SOLIDEZ RÁPIDA ─────────────────────────────────────────────────────────
let _quickSolBase = null;
let _quickSolTargets = [];
let _quickSolTargetKey = null;

function _quickSolJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _quickSolFromValue(value) {
  if (!value) return null;
  const resolved = cronoResolveSelectValue(value);
  if (!resolved) return null;
  return {
    obraId: resolved.obraId,
    movId: resolved.movId || null,
    displayName: resolved.displayName,
    subName: resolved.subName || '',
    color: resolved.color || null,
  };
}

function _quickSolCurrentBase(source) {
  if (source === 'hecho' && _hechoObraId) {
    const obra = findObra(_hechoObraId);
    const mov = _hechoMovId ? findMovimiento(_hechoObraId, _hechoMovId) : null;
    const entity = mov || obra;
    if (!obra || !entity) return null;
    return {
      obraId: _hechoObraId,
      movId: _hechoMovId || null,
      displayName: mov ? mov.name : obra.name,
      subName: mov ? (obra.name + (obra.composer ? ' · ' + obra.composer : '')) : (obra.composer || ''),
      color: obraColorHex(obra),
    };
  }
  if (source === 'running' && crono.obraId) {
    return {
      obraId: crono.obraId,
      movId: crono.movId || null,
      displayName: crono.displayName || '—',
      subName: crono.subName || '',
      color: crono.color || null,
    };
  }
  const sel = document.getElementById('cronoObraSelect');
  return _quickSolFromValue(sel ? sel.value : '');
}

function _quickSolTargetName(target) {
  if (!target) return '';
  if (target.type === 'pasaje') return target.name;
  if (target.type === 'mov') return target.name;
  return target.name || 'Obra completa';
}

function _quickSolTargetValue(target) {
  if (!target) return 70;
  if (target.type === 'pasaje') {
    const obra = findObra(target.obraId);
    const p = obra && (obra.pasajes || []).find(x => x.id === target.pasajeId);
    if (!p) return 70;
    if (p.solHistory && p.solHistory[0]) return normalizeSolVal(p.solHistory[0].val);
    if (p.workHistory && p.workHistory[0] && p.workHistory[0].solDespues != null) return normalizeSolVal(p.workHistory[0].solDespues);
    return 50;
  }
  if (target.type === 'mov') {
    const mov = findMovimiento(target.obraId, target.movId);
    if (!mov) return 70;
    if (mov.solHistory && mov.solHistory[0]) return normalizeSolVal(mov.solHistory[0].val);
    return mov.sol != null && mov.sol > 1 ? normalizeSolVal(mov.sol) : 50;
  }
  const obra = findObra(target.obraId);
  if (!obra) return 70;
  if (obra.solHistory && obra.solHistory[0]) return normalizeSolVal(obra.solHistory[0].val);
  return obra.sol != null && obra.sol > 1 ? normalizeSolVal(obra.sol) : 50;
}

function _quickSolBuildTargets(base) {
  const obra = base ? findObra(base.obraId) : null;
  if (!obra || obra.tipo === 'actividad') return [];
  // Solidez de la obra completa + (si tiene) de cada movimiento por separado.
  const targets = [{ key: 'obra:' + obra.id, type: 'obra', obraId: obra.id, name: 'Obra completa', section: 'Obra' }];
  (obra.movimientos || []).forEach(mov => {
    if (!mov || !mov.id) return;
    targets.push({ key: 'mov:' + mov.id, type: 'mov', obraId: obra.id, movId: mov.id, name: mov.name || 'Movimiento', section: 'Movimientos' });
  });
  return targets;
}

function _quickSolRenderTargets() {
  const wrap = document.getElementById('quickSolTargets');
  if (!wrap) return;
  // Con una sola opción (la obra) el selector sobra.
  if (_quickSolTargets.length <= 1) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  let section = '';
  let html = '';
  _quickSolTargets.forEach(t => {
    if (t.section !== section) {
      section = t.section;
      html += '<div class="quick-sol-section">' + escapeHtmlSafe(section) + '</div>';
    }
    const active = t.key === _quickSolTargetKey ? ' active' : '';
    html += '<button class="quick-sol-target' + active + '" onclick="selectQuickSolTarget(\'' + _quickSolJs(t.key) + '\')">' +
      escapeHtmlSafe(_quickSolTargetName(t)) + '</button>';
  });
  wrap.innerHTML = html;
}

function _quickSolSelectedTarget() {
  return _quickSolTargets.find(t => t.key === _quickSolTargetKey) || _quickSolTargets[0] || null;
}

function _quickSolContextText(target) {
  if (!target) return '';
  let hist = [];
  if (target.type === 'pasaje') {
    const obra = findObra(target.obraId);
    const p = obra && (obra.pasajes || []).find(x => x.id === target.pasajeId);
    hist = p?.solHistory || [];
  } else if (target.type === 'mov') {
    hist = findMovimiento(target.obraId, target.movId)?.solHistory || [];
  } else {
    hist = findObra(target.obraId)?.solHistory || [];
  }
  if (!hist.length) return 'Primer registro de solidez para este elemento.';
  const last = hist[0];
  const dias = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000);
  const when = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : 'hace ' + dias + ' días';
  const prev = hist[1] ? normalizeSolVal(hist[1].val) : null;
  const val = normalizeSolVal(last.val);
  const trend = prev == null ? '' : (val > prev ? ' · subió ' + (val - prev) : val < prev ? ' · bajó ' + (prev - val) : ' · estable');
  return 'Último: ' + val + '% · ' + when + trend;
}

function selectQuickSolTarget(key) {
  _quickSolTargetKey = key;
  _quickSolRenderTargets();
  const target = _quickSolSelectedTarget();
  const val = _quickSolTargetValue(target);
  const slider = document.getElementById('quickSolSlider');
  if (slider) slider.value = val;
  updateQuickSolidez(val);
  const context = document.getElementById('quickSolContext');
  if (context) context.textContent = _quickSolContextText(target);
}

const QUICK_SOL_RUBRIC_VALUES = [25, 45, 65, 80, 95];

function _quickSolClosestRubricValue(pct) {
  return QUICK_SOL_RUBRIC_VALUES.reduce((best, v) =>
    Math.abs(v - pct) < Math.abs(best - pct) ? v : best
  , QUICK_SOL_RUBRIC_VALUES[0]);
}

function _quickSolSyncRubric(pct) {
  const closest = _quickSolClosestRubricValue(pct);
  document.querySelectorAll('#quickSolRubric .quick-sol-rubric-btn').forEach(btn => {
    const val = parseInt(btn.getAttribute('data-val') || 0);
    btn.classList.toggle('active', val === closest);
  });
  const save = document.getElementById('quickSolSaveLabel');
  if (save) save.textContent = 'Guardar ' + pct + '%';
}

function updateQuickSolidez(val) {
  const pct = parseInt(val) || 0;
  const value = document.getElementById('quickSolValue');
  const label = document.getElementById('quickSolLabel');
  const slider = document.getElementById('quickSolSlider');
  const color = solPctColor(pct);
  if (value) {
    value.textContent = pct + '%';
    value.style.color = color;
  }
  if (label) label.textContent = solPctLabel(pct);
  fillSlider(slider, color);
  _quickSolSyncRubric(pct);
}

function quickSolidezPreset(val, autoSave) {
  const slider = document.getElementById('quickSolSlider');
  if (slider) slider.value = val;
  updateQuickSolidez(val);
  if (autoSave) {
    window.setTimeout(() => {
      const modal = document.getElementById('modalQuickSolidez');
      if (modal && modal.classList.contains('visible')) confirmQuickSolidez();
    }, 90);
  }
}

function openQuickSolidez(source) {
  const base = _quickSolCurrentBase(source || 'idle');
  if (!base || !base.obraId) {
    showToast('Elige una obra primero');
    if (typeof openCronoObraPicker === 'function') openCronoObraPicker();
    return;
  }
  const obra = findObra(base.obraId);
  if (!obra || obra.tipo === 'actividad') {
    showToast('Las actividades no tienen solidez');
    return;
  }
  _quickSolBase = base;
  _quickSolTargets = _quickSolBuildTargets(base);
  // Por defecto, el movimiento del contexto si lo hay; si no, la obra completa.
  _quickSolTargetKey = (base.movId && _quickSolTargets.some(t => t.key === 'mov:' + base.movId))
    ? 'mov:' + base.movId
    : (_quickSolTargets[0]?.key || null);

  const entity = document.getElementById('quickSolEntity');
  if (entity) {
    const sub = base.subName ? '<span>' + escapeHtmlSafe(base.subName) + '</span>' : '';
    entity.innerHTML = '<strong>' + escapeHtmlSafe(base.displayName || obra.name) + '</strong>' + sub;
  }
  const note = document.getElementById('quickSolNote');
  if (note) note.value = '';
  _quickSolRenderTargets();
  selectQuickSolTarget(_quickSolTargetKey);
  openModal('modalQuickSolidez');
}

function openQuickSolidezTarget(obraId, movId, pasajeId) {
  const obra = findObra(obraId);
  if (!obra || obra.tipo === 'actividad') {
    showToast('No hay solidez para registrar');
    return;
  }
  const mov = movId ? findMovimiento(obraId, movId) : null;
  const base = {
    obraId,
    movId: mov ? mov.id : null,
    displayName: mov ? mov.name : obra.name,
    subName: mov ? (obra.name + (obra.composer ? ' - ' + obra.composer : '')) : (obra.composer || ''),
    color: obraColorHex(obra),
  };
  _quickSolBase = base;
  _quickSolTargets = _quickSolBuildTargets(base);
  const desiredKey = pasajeId ? 'pasaje:' + pasajeId : mov ? 'mov:' + mov.id : 'obra:' + obra.id;
  _quickSolTargetKey = _quickSolTargets.some(t => t.key === desiredKey) ? desiredKey : (_quickSolTargets[0]?.key || null);

  const entity = document.getElementById('quickSolEntity');
  if (entity) {
    const sub = base.subName ? '<span>' + escapeHtmlSafe(base.subName) + '</span>' : '';
    entity.innerHTML = '<strong>' + escapeHtmlSafe(base.displayName || obra.name) + '</strong>' + sub;
  }
  const note = document.getElementById('quickSolNote');
  if (note) note.value = '';
  _quickSolRenderTargets();
  selectQuickSolTarget(_quickSolTargetKey);
  openModal('modalQuickSolidez');
}

function confirmQuickSolidez() {
  const target = _quickSolSelectedTarget();
  if (!target) { closeModal('modalQuickSolidez'); return; }
  const val = parseInt(document.getElementById('quickSolSlider')?.value || 0);
  const note = (document.getElementById('quickSolNote')?.value || '').trim();
  const now = new Date().toISOString();

  if (target.type === 'pasaje') {
    const obra = findObra(target.obraId);
    const p = obra && (obra.pasajes || []).find(x => x.id === target.pasajeId);
    if (p) {
      if (!p.solHistory) p.solHistory = [];
      const today = new Date().toDateString();
      const last = p.solHistory[0];
      const entry = { date: now, val, context: 'rapido', note };
      if (last && new Date(last.date).toDateString() === today && last.context === 'rapido') p.solHistory[0] = entry;
      else p.solHistory.unshift(entry);
      if (p.solHistory.length > 30) p.solHistory = p.solHistory.slice(0, 30);
      p.sol = val;
      saveData();
    }
  } else if (target.type === 'mov') {
    recordMovSolHistory(target.obraId, target.movId, val, 'rapido');
    const mov = findMovimiento(target.obraId, target.movId);
    if (note && mov?.solHistory?.[0]) { mov.solHistory[0].note = note; saveData(); }
  } else {
    recordSolHistory(target.obraId, val, 'rapido');
    const obra = findObra(target.obraId);
    if (note && obra?.solHistory?.[0]) { obra.solHistory[0].note = note; saveData(); }
  }

  closeModal('modalQuickSolidez');
  showToast('Solidez registrada · ' + val + '%');
  showSavedCheck();
  cronoUpdateSolidityActions();
  hechoUpdateFastSolidityAction();
  _justMeasuredObraId = target.obraId || null;
  if (typeof renderObras === 'function' && document.getElementById('view-obras')?.classList.contains('active')) renderObras();
  if (document.getElementById('view-historial')?.classList.contains('active')) {
    if (typeof renderSolidezSection === 'function') renderSolidezSection();
    if (typeof renderSesionesHistorial === 'function') renderSesionesHistorial();
  }
}

function cronoZonePreviewForBase(base) {
  if (!base || !base.obraId) return null;
  const obra = findObra(base.obraId);
  const entity = base.movId ? findMovimiento(base.obraId, base.movId) : obra;
  if (!obra || obra.tipo === 'actividad' || !entity) return null;
  const total = parseInt(entity.compasesTotal || 0);
  if (total) {
    const actual = Math.max(0, Math.min(total, parseInt(entity.compasActual || 0)));
    if (actual < total) {
      const start = actual + 1;
      const end = Math.min(total, Math.max(start, actual + 8));
      return hechoRangeText(start, end);
    }
    const review = hechoDefaultReviewRange(entity);
    return 'repaso ' + hechoRangeText(review.start, review.end);
  }
  if (!base.movId) {
    const activePasajes = (obra.pasajes || []).filter(p => p.status !== 'resuelto');
    if (activePasajes.length) return activePasajes.length === 1 ? '1 pasaje' : activePasajes.length + ' pasajes';
  }
  return base.movId ? 'movimiento' : 'obra completa';
}

function cronoUpdateSolidityActions() {
  const idleBtn = document.getElementById('cronoQuickSolBtn');
  const idleVal = document.getElementById('cronoQuickSolValue');
  const runBtn = document.getElementById('cronoRunSolBtn');
  const runVal = document.getElementById('cronoRunSolValue');
  const runRow = document.querySelector('.crono-run-quick-row');
  const runZoneBtn = document.getElementById('cronoRunZoneBtn');
  const runZoneVal = document.getElementById('cronoRunZoneValue');

  if (idleBtn) idleBtn.style.display = 'none';
  if (idleVal) idleVal.textContent = 'â€”';
  if (runBtn) runBtn.style.display = 'none';
  if (runVal) runVal.textContent = 'â€”';
  const paseRunBase = crono.obraId ? _quickSolCurrentBase('running') : null;
  const paseZonePreview = cronoZonePreviewForBase(paseRunBase);
  if (runRow) runRow.style.display = paseZonePreview ? '' : 'none';
  if (runZoneBtn) runZoneBtn.style.display = paseZonePreview ? '' : 'none';
  if (runZoneVal) runZoneVal.textContent = paseZonePreview || 'al terminar';
  return;

  const idleBase = _quickSolCurrentBase('idle');
  const runBase = crono.obraId ? _quickSolCurrentBase('running') : null;

  function valueFor(base) {
    const targets = _quickSolBuildTargets(base);
    return targets.length ? _quickSolTargetValue(targets[0]) : null;
  }
  const idlePct = valueFor(idleBase);
  const runPct = valueFor(runBase);

  if (idleBtn) {
    idleBtn.classList.toggle('is-empty', idlePct == null);
    idleBtn.title = idlePct == null ? 'Elige una obra para registrar solidez' : 'Registrar solidez rápida';
  }
  if (idleVal) idleVal.textContent = idlePct == null ? '—' : idlePct + '%';
  if (runBtn) runBtn.style.display = runPct == null ? 'none' : '';
  if (runVal) runVal.textContent = runPct == null ? '—' : runPct + '%';
  const zonePreview = cronoZonePreviewForBase(runBase);
  if (runRow) runRow.style.display = (runPct == null && !zonePreview) ? 'none' : '';
  if (runZoneBtn) runZoneBtn.style.display = zonePreview ? '' : 'none';
  if (runZoneVal) runZoneVal.textContent = zonePreview || 'al terminar';
}

function hechoUpdateFastSolidityAction() {
  const wrap = document.getElementById('hechoFastActions');
  const valEl = document.getElementById('hechoFastSolValue');
  const labelEl = document.getElementById('hechoFastSolLabel');
  if (wrap) wrap.style.display = 'none';
  return;
  if (!wrap || !valEl) return;
  const base = _quickSolCurrentBase('hecho');
  const targets = _quickSolBuildTargets(base);
  const pct = targets.length ? _quickSolTargetValue(targets[0]) : null;
  const zone = hechoCurrentZoneSnapshot(false);
  const isLearningZone = zone && (zone.type === 'avance' || zone.type === 'repaso');
  if (labelEl) labelEl.textContent = isLearningZone ? 'Solidez opcional' : 'Registrar solidez';
  wrap.style.display = pct == null ? 'none' : '';
  valEl.textContent = pct == null ? '—' : pct + '%';
}

// ── MODO CRONÓMETRO / TEMPORIZADOR ──────────────────────────────────────────

const TIMER_MIN_MINUTES = 5;
const TIMER_MAX_MINUTES = 120;
const TIMER_STEP_MINUTES = 5;
const TIMER_RADIUS = 88;
const TIMER_CIRC = 2 * Math.PI * TIMER_RADIUS; // ≈ 552.92
const CRONO_RUN_PROGRESS_RADIUS = 94;
const CRONO_RUN_PROGRESS_CIRC = 2 * Math.PI * CRONO_RUN_PROGRESS_RADIUS;

function cronoUpdateTimerProgress(elapsedMs) {
  const wrap = document.getElementById('cronoDisplayWrap');
  const arc = document.getElementById('cronoRunProgressArc');
  const handle = document.getElementById('cronoRunProgressHandle');
  const display = document.getElementById('cronoDisplay');
  const isActive = crono.state !== 'idle';
  const isTimer = crono.targetMinutes != null && isActive;
  if (wrap) wrap.classList.toggle('progress-active', isActive);
  if (wrap) wrap.classList.toggle('timer-active', isTimer);
  if (!isActive) {
    if (arc) arc.setAttribute('stroke-dashoffset', String(CRONO_RUN_PROGRESS_CIRC));
    if (handle) {
      handle.setAttribute('cx', '110');
      handle.setAttribute('cy', String(110 - CRONO_RUN_PROGRESS_RADIUS));
    }
    if (display) display.classList.remove('last-seconds');
    crono.lastCountdownSecond = null;
    return;
  }

  const elapsed = elapsedMs != null ? elapsedMs : cronoEffectiveElapsedMs();
  const targetMs = isTimer ? (crono.targetDurationMs || crono.targetMinutes * 60000) : null;
  const progressPct = targetMs > 0 ? Math.min(1, Math.max(0, elapsed / targetMs)) : 0;
  if (arc) arc.setAttribute('stroke-dashoffset', String(CRONO_RUN_PROGRESS_CIRC * (1 - progressPct)));
  if (handle) {
    const theta = progressPct * 2 * Math.PI;
    const cx = 110 + CRONO_RUN_PROGRESS_RADIUS * Math.sin(theta);
    const cy = 110 - CRONO_RUN_PROGRESS_RADIUS * Math.cos(theta);
    handle.setAttribute('cx', String(cx));
    handle.setAttribute('cy', String(cy));
  }

  const remainingMs = isTimer ? Math.max(0, targetMs - elapsed) : null;
  const lastSeconds = isTimer && crono.state === 'running' && remainingMs > 0 && remainingMs <= 10000;
  if (display) display.classList.toggle('last-seconds', lastSeconds);
  if (lastSeconds) {
    const sec = Math.ceil(remainingMs / 1000);
    if (sec !== crono.lastCountdownSecond) {
      crono.lastCountdownSecond = sec;
      playTone(880, 'sine', 0.045, 0.025, 0);
    }
  } else {
    crono.lastCountdownSecond = null;
  }
}

// Shared AudioContext for the timer drag ticks — created lazily.
let _tickAudioCtx = null;
function _playCronoTick() {
  try {
    if (!_tickAudioCtx || _tickAudioCtx.state === 'closed') {
      _tickAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = _tickAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(700, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.011);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.022);
  } catch(e) {}
}

function cronoSetMode(mode) {
  if (mode !== 'stopwatch' && mode !== 'timer' && mode !== 'until') return;
  if (crono.state !== 'idle') {
    // No permitir cambiar de modo mientras corre una sesión
    showToast('Termina la sesión actual antes de cambiar de modo');
    return;
  }
  crono.mode = mode;
  if (mode === 'until') cronoEnsureUntilTime();
  cronoSaveState();
  cronoApplyModeUI();
  cronoUpdateStartBtn();
}

function cronoSetTimerPreset(minutes) {
  if (crono.state !== 'idle') return;
  const value = Math.max(TIMER_MIN_MINUTES, Math.min(TIMER_MAX_MINUTES, parseInt(minutes, 10) || 25));
  crono.mode = 'timer';
  crono.timerMinutes = value;
  cronoSaveState();
  cronoApplyModeUI();
  cronoTimerRenderSlider();
  try { Haptics.light(); } catch(e) {}
}

function cronoUpdateTimerPresetButtons() {
  document.querySelectorAll('#cronoDurationPresets button').forEach(button => {
    const active = crono.mode === 'timer' && parseInt(button.dataset.minutes || '0', 10) === crono.timerMinutes;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function cronoApplyModeUI() {
  // Toggle visual
  const timedMode = crono.mode === 'timer' || crono.mode === 'until';
  document.body.classList.toggle('crono-timer-mode', timedMode);
  document.body.classList.toggle('crono-until-mode', crono.mode === 'until');
  document.querySelectorAll('.crono-mode-opt').forEach(b => {
    const active = b.dataset.mode === crono.mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  // Mover indicador
  cronoMoveModeIndicator();
  // Si timer mode, actualizar el slider visualmente y el botón "Plantar"
  if (timedMode) {
    if (crono.mode === 'until') cronoEnsureUntilTime();
    cronoTimerRenderSlider();
  }
  cronoUpdateTimerPresetButtons();
  // Mensaje contextual: primero destellos propios, luego frases de respaldo.
  const msg = document.getElementById('cronoIdleMessage');
  if (msg) msg.textContent = _cronoIdlePhrase();
}

const CRONO_IDLE_PHRASES = [
  'Cada repetición precisa le enseña al cerebro por dónde ir',
  'La atención cambia el circuito: toca lento, toca claro',
  'No repitas el fallo: redibújalo despacio',
  'La memoria aparece antes cuando la ruta está limpia',
  'Pocas repeticiones exactas valen más que muchas borrosas',
  'El sistema nervioso aprende lo que haces, no lo que querías hacer',
  'Hoy no peleas con la obra: diseñas reflejos',
  'La concentración convierte esfuerzo en camino disponible',
  'Si lo puedes oír antes de tocarlo, ya estás cambiando la respuesta',
  'La seguridad nace cuando el cuerpo reconoce el camino',
];
function _cronoIdlePhrase() {
  const d = new Date();
  const seed = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
  return _cronoPhraseForSeed(seed);
}

function _cronoPhrasePool() {
  const destellos = (typeof getCronoDestelloPhrases === 'function') ? getCronoDestelloPhrases() : [];
  return destellos.length ? destellos : CRONO_IDLE_PHRASES;
}

function _cronoPhrasePoolEntries() {
  const destellos = (typeof getCronoDestelloPhraseEntries === 'function') ? getCronoDestelloPhraseEntries() : [];
  if (destellos.length) return destellos;
  return CRONO_IDLE_PHRASES.map(text => ({ text, entry: null, isDestello: false }));
}

function _cronoPhraseForSeedEntry(seed) {
  const pool = _cronoPhrasePoolEntries();
  if (!pool.length) return { text: '', entry: null, isDestello: false };
  return pool[Math.abs(seed) % pool.length];
}

function _cronoPhraseForSeed(seed) {
  return _cronoPhraseForSeedEntry(seed).text || '';
}

function _cronoRunPhrase(elapsedMs) {
  return _cronoRunPhraseEntry(elapsedMs).text || '';
}

function _cronoRunPhraseEntry(elapsedMs) {
  const bucket = Math.floor(Math.max(0, elapsedMs || 0) / CRONO_DESTELLO_ROTATE_MS);
  const startSeed = Math.floor((crono.startTs || Date.now()) / CRONO_DESTELLO_ROTATE_MS);
  return _cronoPhraseForSeedEntry(startSeed + bucket);
}

function _cronoClampDestelloText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= CRONO_DESTELLO_MAX_CHARS) return clean;
  return clean.slice(0, CRONO_DESTELLO_MAX_CHARS - 1).trimEnd() + '…';
}

function _cronoDestelloSizeClass(text) {
  const n = String(text || '').length;
  if (n > 145) return 'size-xlong';
  if (n > 105) return 'size-long';
  if (n > 68) return 'size-medium';
  return 'size-short';
}

function cronoUpdateRunDestello(elapsedMs, force) {
  const el = document.getElementById('cronoRunDestello');
  if (!el) return;
  if (crono.state === 'idle') {
    el.textContent = '';
    el.style.display = 'none';
    el.classList.remove('size-short', 'size-medium', 'size-long', 'size-xlong', 'is-destello', 'destello-level-0', 'destello-level-1', 'destello-level-2', 'destello-level-3', 'destello-level-4', 'destello-level-5');
    _cronoLastRunDestelloKey = '';
    _cronoCurrentDestelloEntry = null;
    return;
  }
  const bucket = Math.floor(Math.max(0, elapsedMs || 0) / CRONO_DESTELLO_ROTATE_MS);
  const phrase = _cronoRunPhraseEntry(elapsedMs);
  const rawText = phrase.text || '';
  const text = _cronoClampDestelloText(rawText);
  const entry = phrase.entry || null;
  const boosts = entry ? destelloBoosts(entry) : 0;
  const key = bucket + '::' + rawText + '::' + boosts;
  if (force || key !== _cronoLastRunDestelloKey) {
    _cronoLastRunDestelloKey = key;
    _cronoCurrentDestelloEntry = entry;
    el.classList.remove('is-changing');
    el.classList.remove('size-short', 'size-medium', 'size-long', 'size-xlong', 'is-destello', 'destello-level-0', 'destello-level-1', 'destello-level-2', 'destello-level-3', 'destello-level-4', 'destello-level-5');
    el.classList.add(_cronoDestelloSizeClass(text));
    const level = destelloLevelFromBoosts(boosts);
    if (entry) el.classList.add('is-destello', 'destello-level-' + level);
    void el.offsetWidth;
    if (entry) {
      el.innerHTML =
        '<button type="button" class="crono-run-destello-btn" onclick="cronoBoostCurrentDestello(event)" aria-label="Este destello me ayuda">' +
          '<span class="crono-run-destello-text">' + escapeHtmlSafe(text) + '</span>' +
          '<span class="crono-run-destello-level">' + escapeHtmlSafe(destelloLevelLabel(boosts)) + '</span>' +
        '</button>';
    } else {
      el.innerHTML = '<span class="crono-run-destello-text">' + escapeHtmlSafe(text) + '</span>';
    }
    el.style.display = text ? '' : 'none';
    el.classList.add('is-changing');
  }
}

function cronoRefreshDestelloPhrase(force) {
  const msg = document.getElementById('cronoIdleMessage');
  if (msg && crono.state === 'idle') msg.textContent = _cronoIdlePhrase();
  if (crono.state !== 'idle') cronoUpdateRunDestello(cronoEffectiveElapsedMs(), !!force);
}

function cronoMoveModeIndicator() {
  const toggle = document.getElementById('cronoModeToggle');
  const indicator = document.getElementById('cronoModeIndicator');
  if (!toggle || !indicator) return;
  const active = toggle.querySelector('.crono-mode-opt.active');
  if (!active) return;
  indicator.style.width = active.offsetWidth + 'px';
  indicator.style.left = active.offsetLeft + 'px';
}

function _cronoPad2(n) {
  return String(n).padStart(2, '0');
}

function cronoDefaultUntilTime() {
  const now = new Date();
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  if (d.toDateString() !== now.toDateString()) d.setHours(23, 59, 0, 0);
  return _cronoPad2(d.getHours()) + ':' + _cronoPad2(d.getMinutes());
}

function cronoEnsureUntilTime() {
  if (!/^\d{2}:\d{2}$/.test(crono.untilTime || '')) crono.untilTime = cronoDefaultUntilTime();
  const input = document.getElementById('cronoUntilTime');
  if (input && input.value !== crono.untilTime) input.value = crono.untilTime;
}

function cronoUntilTargetDate() {
  if (!/^\d{2}:\d{2}$/.test(crono.untilTime || '')) return null;
  const parts = crono.untilTime.split(':').map(n => parseInt(n, 10));
  if (!Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const target = new Date();
  target.setHours(parts[0], parts[1], 0, 0);
  return target;
}

function cronoUntilMinutes() {
  const target = cronoUntilTargetDate();
  if (!target) return null;
  const diff = target.getTime() - Date.now();
  if (diff <= 30000) return null;
  return Math.max(1, Math.ceil(diff / 60000));
}

function cronoUntilInfoText() {
  const min = cronoUntilMinutes();
  if (!min) return 'hora ya pasada';
  return 'quedan ' + fmtMinutos(min);
}

function cronoSetUntilTime(value) {
  crono.untilTime = value || '';
  cronoSaveState();
  cronoTimerRenderSlider();
}

function cronoTimerEffectiveMinutes() {
  if (crono.mode === 'until') return cronoUntilMinutes();
  return crono.timerMinutes;
}

// Renderiza el slider radial con crono.timerMinutes
function cronoTimerRenderSlider() {
  const arc = document.getElementById('cronoTimerArc');
  const handle = document.getElementById('cronoTimerHandle');
  const text = document.getElementById('cronoTimerText');
  if (!arc || !handle || !text) return;

  const m = cronoTimerEffectiveMinutes();
  const pct = Math.min(m || 0, TIMER_MAX_MINUTES) / TIMER_MAX_MINUTES; // 0..1
  // Arc: stroke-dashoffset = circ - circ*pct
  arc.setAttribute('stroke-dashoffset', String(TIMER_CIRC * (1 - pct)));

  // Handle: posición sobre la circunferencia, ángulo θ desde "arriba" (12 en punto)
  // θ en radianes; 12 en punto = 0; sentido horario.
  // En SVG con y hacia abajo: x = cx + r*sin(θ), y = cy - r*cos(θ)
  const theta = pct * 2 * Math.PI;
  const cx = 100 + TIMER_RADIUS * Math.sin(theta);
  const cy = 100 - TIMER_RADIUS * Math.cos(theta);
  handle.setAttribute('cx', String(cx));
  handle.setAttribute('cy', String(cy));

  // Texto
  text.textContent = String(m || '—');
  cronoUpdateTimerPresetButtons();
  const untilInput = document.getElementById('cronoUntilTime');
  if (untilInput && crono.mode === 'until') {
    cronoEnsureUntilTime();
    untilInput.value = crono.untilTime;
  }
  const untilInfo = document.getElementById('cronoUntilInfo');
  if (untilInfo) untilInfo.textContent = crono.mode === 'until' ? cronoUntilInfoText() : '';
  // Actualizar el botón "Plantar · N min"
  cronoUpdateStartBtn();
}

// Convierte un punto (x, y) en coordenadas del SVG en minutos snap-eados.
function cronoTimerXYToMinutes(svgX, svgY) {
  // Centro está en (100, 100)
  const dx = svgX - 100;
  const dy = svgY - 100;
  // Ángulo desde "arriba" (12 en punto), sentido horario.
  // atan2(dx, -dy) da 0 cuando dx=0, dy<0 (arriba), creciendo en sentido horario.
  let theta = Math.atan2(dx, -dy);
  if (theta < 0) theta += 2 * Math.PI; // 0..2π
  const pct = theta / (2 * Math.PI);
  let minutes = pct * TIMER_MAX_MINUTES;
  // Snap a step
  minutes = Math.round(minutes / TIMER_STEP_MINUTES) * TIMER_STEP_MINUTES;
  if (minutes < TIMER_MIN_MINUTES) {
    // Por debajo del mínimo: o saltar al mínimo o al máximo según cercanía
    minutes = (pct > 0.5) ? TIMER_MAX_MINUTES : TIMER_MIN_MINUTES;
  }
  if (minutes > TIMER_MAX_MINUTES) minutes = TIMER_MAX_MINUTES;
  return minutes;
}

// Convierte un punto en coords de cliente (touch/mouse) a coords del SVG
function cronoTimerClientToSVG(clientX, clientY) {
  const svg = document.getElementById('cronoTimerSvg');
  if (!svg) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

// Inicializa drag handlers en el SVG del timer
function cronoTimerInitDrag() {
  const svg = document.getElementById('cronoTimerSvg');
  const handle = document.getElementById('cronoTimerHandle');
  if (!svg || svg._cronoBound) return;
  svg._cronoBound = true;

  let isDragging = false;
  let startedOnHandle = false;

  // Distancia (en coords SVG) desde un punto al handle actual. Sirve para
  // decidir si un down empezó SOBRE el handle (cerca del handle => arrastre
  // suave sin saltar) o sobre el track (lejos => salto inmediato al punto).
  function distToHandle(svgX, svgY) {
    const m = crono.timerMinutes;
    const theta = (m / TIMER_MAX_MINUTES) * 2 * Math.PI;
    const hx = 100 + TIMER_RADIUS * Math.sin(theta);
    const hy = 100 - TIMER_RADIUS * Math.cos(theta);
    const dx = svgX - hx;
    const dy = svgY - hy;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function onPointerMove(clientX, clientY) {
    const p = cronoTimerClientToSVG(clientX, clientY);
    if (!p) return;
    let newMin = cronoTimerXYToMinutes(p.x, p.y);
    const prev = crono.timerMinutes;
    // Robust wrap detection using the raw angle, not the snapped value.
    // Fast swipes can jump past multiple steps so checking newMin <= 5 is not enough.
    const dx = p.x - 100, dy = p.y - 100;
    let rawTheta = Math.atan2(dx, -dy);
    if (rawTheta < 0) rawTheta += 2 * Math.PI; // 0..2π, 0 = 12 o'clock CW
    const prevAngle = (prev / TIMER_MAX_MINUTES) * 2 * Math.PI;
    // CW wrap: prev was in "late" sector (>288°) and raw jumped to "early" (<72°)
    if (prevAngle > Math.PI * 1.6 && rawTheta < Math.PI * 0.4) {
      newMin = TIMER_MAX_MINUTES;
    }
    // CCW wrap from min: prev was early, raw jumped to late → clamp at min
    if (prevAngle < Math.PI * 0.4 && rawTheta > Math.PI * 1.6) {
      newMin = TIMER_MIN_MINUTES;
    }
    if (newMin !== prev) {
      crono.timerMinutes = newMin;
      cronoTimerRenderSlider();
      _playCronoTick();
    }
  }

  function onDown(e) {
    e.preventDefault();
    isDragging = true;
    svg.classList.add('dragging');
    if (handle) handle.classList.add('dragging');
    const t = e.touches ? e.touches[0] : e;
    const p = cronoTimerClientToSVG(t.clientX, t.clientY);
    // Si el punto está suficientemente cerca del handle (≈ 24 SVG units, que
    // con viewBox 200 y r=88 es generoso para un dedo), NO saltar al punto:
    // empezamos un arrastre suave desde la posición actual del handle. El
    // handle seguirá al dedo gradualmente conforme se mueva.
    // Si el punto está sobre el track lejos del handle, sí saltar (tap rápido).
    if (p && distToHandle(p.x, p.y) < 24) {
      startedOnHandle = true;
      // No movemos nada en este frame; mantiene posición estable
    } else {
      startedOnHandle = false;
      onPointerMove(t.clientX, t.clientY);
    }
  }
  function onMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const t = e.touches ? e.touches[0] : e;
    onPointerMove(t.clientX, t.clientY);
  }
  function onUp() {
    if (!isDragging) return;
    isDragging = false;
    startedOnHandle = false;
    svg.classList.remove('dragging');
    if (handle) handle.classList.remove('dragging');
    cronoSaveState();
  }

  // Touch
  svg.addEventListener('touchstart', onDown, { passive: false });
  svg.addEventListener('touchmove', onMove, { passive: false });
  svg.addEventListener('touchend', onUp);
  svg.addEventListener('touchcancel', onUp);
  // Mouse
  svg.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ── Tick intervals ──────────────────────────────────────────────────────────

function cronoStartTick() {
  if (crono.tickInterval) clearInterval(crono.tickInterval);
  crono.tickInterval = setInterval(() => {
    const disp = document.getElementById('cronoDisplay');
    const elapsedMs = cronoEffectiveElapsedMs();
    cronoUpdateRunDestello(elapsedMs);
    // En modo timer: mostrar cuenta atrás y auto-finalizar al llegar a 0
    if (crono.targetDurationMs != null || crono.targetMinutes != null) {
      const targetMs = crono.targetDurationMs || crono.targetMinutes * 60000;
      const remainingMs = Math.max(0, targetMs - elapsedMs);
      if (disp) disp.textContent = cronoFmt(remainingMs);
      cronoUpdateTimerProgress(elapsedMs);
      if (remainingMs <= 0) {
        clearInterval(crono.tickInterval);
        crono.tickInterval = null;
        cronoQueueFinish(crono.runId);
      }
    } else {
      // El cronómetro libre no tiene objetivo ni límite artificial.
      if (disp) disp.textContent = cronoFmt(elapsedMs);
      cronoUpdateTimerProgress(elapsedMs);
    }
    // Motivador de hito: muestra el tiempo total redondeado al múltiplo de 15min inferior
    const milestoneEl = document.getElementById('cronoMilestone');
    if (milestoneEl) {
      const minHoy = typeof getMinutosConcentradoHoy === 'function' ? getMinutosConcentradoHoy() : 0;
      const sessionMin = Math.floor(elapsedMs / 60000);
      const totalMin = minHoy + sessionMin;
      const milestone = Math.floor(totalMin / 15) * 15;
      if (milestone >= 15) {
        const h = Math.floor(milestone / 60);
        const m = milestone % 60;
        const t = h > 0 ? (h + 'h' + (m > 0 ? ' ' + m + 'min' : '')) : (m + 'min');
        milestoneEl.textContent = 'si paras ahora · ' + t;
        milestoneEl.style.display = '';
        const rm = document.getElementById('cronoRunMilestone');
        if (rm) {
          rm.innerHTML = '<span class="crono-run-ms-star">★</span> si paras ahora · ' + t;
          rm.style.display = '';
        }
      } else {
        milestoneEl.style.display = 'none';
        const rm = document.getElementById('cronoRunMilestone');
        if (rm) rm.style.display = 'none';
      }
    }
    // Probabilidad en vivo de 4h/5h (recalcula solo al cambiar de minuto).
    if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI();
  }, 1000);
}

function cronoStopTick() {
  if (crono.tickInterval) { clearInterval(crono.tickInterval); crono.tickInterval = null; }
}

function cronoStartPauseCountdown() {
  if (crono.pauseInterval) clearInterval(crono.pauseInterval);
  const update = () => {
    const remaining = cronoPauseRemainingMs();
    // Actualizar tanto el countdown legacy (si existe) como el del overlay nuevo
    const cd = document.getElementById('cronoPauseCountdown');
    if (cd) cd.textContent = cronoFmt(remaining);
    const ovTime = document.getElementById('cronoPauseOverlayTime');
    if (ovTime) ovTime.textContent = cronoFmt(remaining);
    const ovSession = document.getElementById('cronoPauseOverlaySession');
    if (ovSession) ovSession.textContent = 'Sesión pausada en ' + cronoFmt(cronoEffectiveElapsedMs());
    const ring = document.getElementById('cronoPauseRingArc');
    if (ring) {
      const pct = CRONO_PAUSE_LIMIT_MS > 0 ? remaining / CRONO_PAUSE_LIMIT_MS : 0;
      ring.setAttribute('stroke-dashoffset', String(326.73 * (1 - pct)));
    }
    const note = document.getElementById('cronoPauseOverlayNote');
    if (note) note.textContent = 'La sesión se reanudará sola en ' + cronoFmt(remaining) + '.';
    if (remaining <= 0) {
      clearInterval(crono.pauseInterval);
      crono.pauseInterval = null;
      // El tiempo de pausa se acabó → REANUDAR automáticamente la sesión.
      // (Antes se terminaba la sesión; ahora se renuda como en Forest.)
      cronoResume();
      showToast('Pausa terminada · continúa la sesión');
    }
  };
  update();
  crono.pauseInterval = setInterval(update, 1000);
}

function cronoStopPauseCountdown() {
  if (crono.pauseInterval) { clearInterval(crono.pauseInterval); crono.pauseInterval = null; }
}

// ── Resolver una selección del select (formato "obra::xxx" / "mov::xxx::yyy")
// y devolver {obraId, movId, displayName, subName} o null
function cronoResolveSelectValue(val) {
  if (!val) return null;
  if (val.startsWith('mov::')) {
    const parts = val.split('::');
    const obraId = parts[1], movId = parts[2];
    const obra = findObra(obraId);
    const mov  = obra && obra.movimientos ? obra.movimientos.find(m => m.id === movId) : null;
    if (!obra || !mov) return null;
    return {
      obraId, movId,
      displayName: mov.name,
      subName: obra.name + (obra.composer ? ' · ' + obra.composer : ''),
      color: obraColorHex(obra),
    };
  }
  const obraId = val.replace('obra::', '');
  const obra = findObra(obraId);
  if (!obra) return null;
  return {
    obraId, movId: null,
    displayName: obra.name,
    subName: obra.composer || '',
    color: obraColorHex(obra),
  };
}

// ── Acciones ────────────────────────────────────────────────────────────────

function cronoStart() {
  const sel = document.getElementById('cronoObraSelect');
  if (!sel) return;
  const resolved = cronoResolveSelectValue(sel.value);
  if (!resolved) { showToast('Elige una obra o movimiento'); return; }

  // Marcar como la última usada (para que sea el default la próxima vez).
  if (typeof bumpCronoPickRecency === 'function') bumpCronoPickRecency(resolved.obraId);

  _cronoPaseDrawerReset();
  _cronoRunDrawerTab = 'pasajes';
  const firstPasaje = _activeCronoPasajes()[0];
  if (!_pasajeOpenId && firstPasaje) _pasajeOpenId = firstPasaje.id;
  _cronoLastRunDestelloKey = '';
  if (!Array.isArray(crono.notes)) crono.notes = [];

  crono.state = 'running';
  crono.isRest = false;
  crono.obraId = resolved.obraId;
  crono.movId = resolved.movId;
  crono.displayName = resolved.displayName;
  crono.subName = resolved.subName;
  crono.color = resolved.color || null;
  crono.startTs = Date.now();
  crono.pausedMs = 0;
  crono.pauseStartTs = 0;
  if (crono.mode === 'until') {
    const untilMin = cronoUntilMinutes();
    if (!untilMin) {
      crono.state = 'idle';
      showToast('Elige una hora futura');
      cronoUpdateStartBtn();
      return;
    }
    crono.targetMinutes = untilMin;
    const untilTarget = cronoUntilTargetDate();
    crono.targetDurationMs = untilTarget ? Math.max(1, untilTarget.getTime() - crono.startTs) : untilMin * 60000;
  } else {
    // Si modo timer, fijar el objetivo de minutos para auto-finalizar al llegar
    crono.targetMinutes = (crono.mode === 'timer') ? crono.timerMinutes : null;
    crono.targetDurationMs = crono.targetMinutes == null ? null : crono.targetMinutes * 60000;
  }
  crono.runId = typeof TimerCore !== 'undefined' ? TimerCore.createRunId() : ('run_' + Date.now() + '_' + Math.random().toString(36).slice(2));

  cronoSaveState();
  renderCronoPasajes();
  cronoRender();
  cronoStartTick();
  cronoAcquireWakeLock();
  if (typeof SFX !== 'undefined' && SFX.startSession) SFX.startSession();
  try { Haptics.heavy(); } catch(e) {}
}

// Inicia un cronómetro de DESCANSO: cuenta el tiempo pero NO suma al tiempo
// de estudio. Queda registrado en db.sessionPlants[] con tipo:'descanso'
// para llevar constancia. Útil para descansos activos entre sesiones largas.
function cronoStartRest() {
  if (crono.state !== 'idle') {
    showToast('Termina la sesión actual antes de descansar');
    return;
  }
  _cronoRunDrawerTab = 'pasajes';
  _cronoLastRunDestelloKey = '';
  crono.notes = [];
  crono.state = 'running';
  crono.isRest = true;
  crono.obraId = '_rest_';        // marca interna; no apunta a obra real
  crono.movId = null;
  crono.displayName = 'Descanso';
  crono.subName = '';
  crono.color = '#7a8a9a';        // gris-azul tenue para descansos
  crono.startTs = Date.now();
  crono.pausedMs = 0;
  crono.pauseStartTs = 0;
  if (crono.mode === 'until') {
    const untilMin = cronoUntilMinutes();
    if (!untilMin) {
      crono.state = 'idle';
      showToast('Elige una hora futura');
      cronoUpdateStartBtn();
      return;
    }
    crono.targetMinutes = untilMin;
    const untilTarget = cronoUntilTargetDate();
    crono.targetDurationMs = untilTarget ? Math.max(1, untilTarget.getTime() - crono.startTs) : untilMin * 60000;
  } else {
    crono.targetMinutes = (crono.mode === 'timer') ? crono.timerMinutes : null;
    crono.targetDurationMs = crono.targetMinutes == null ? null : crono.targetMinutes * 60000;
  }
  crono.runId = typeof TimerCore !== 'undefined' ? TimerCore.createRunId() : ('run_' + Date.now() + '_' + Math.random().toString(36).slice(2));

  cronoSaveState();
  cronoRender();
  cronoStartTick();
  cronoAcquireWakeLock();
  if (typeof SFX !== 'undefined' && SFX.startSession) SFX.startSession();
}

function cronoTargetEndClock() {
  if (crono.targetMinutes == null) return '';
  const remainingMs = Math.max(0, (crono.targetDurationMs || crono.targetMinutes * 60000) - cronoEffectiveElapsedMs());
  const end = new Date(Date.now() + remainingMs);
  return _cronoPad2(end.getHours()) + ':' + _cronoPad2(end.getMinutes());
}

function cronoExtendTimer(minutes) {
  if (crono.state !== 'running' || crono.targetMinutes == null || crono.isRest) {
    showToast('Solo durante un temporizador activo');
    return;
  }
  const extra = Math.max(1, Math.round(Number(minutes) || TIMER_STEP_MINUTES));
  const previousTargetDuration = crono.targetDurationMs || crono.targetMinutes * 60000;
  crono.targetMinutes += extra;
  crono.targetDurationMs = previousTargetDuration + extra * 60000;
  if (crono.mode === 'until') crono.untilTime = cronoTargetEndClock();
  crono.lastCountdownSecond = null;
  cronoSaveState();
  cronoRender();
  if (!crono.tickInterval) cronoStartTick();
  cronoUpdateTimerProgress();
  const targetEl = document.getElementById('cronoRunTarget');
  if (targetEl) {
    targetEl.classList.remove('is-extended');
    void targetEl.offsetWidth;
    targetEl.classList.add('is-extended');
  }
  try { Haptics.light(); } catch(e) {}
  try { _playCronoTick(); } catch(e) {}
}

function cronoPause() {
  if (crono.state !== 'running') return;
  cronoStopTick();
  cronoReleaseWakeLock();
  crono.state = 'paused';
  crono.pauseStartTs = Date.now();
  cronoSaveState();
  cronoRender();
  cronoStartPauseCountdown();
}

function cronoResume() {
  if (crono.state !== 'paused') return;
  cronoStopPauseCountdown();
  const pauseDur = Date.now() - crono.pauseStartTs;
  crono.pausedMs += pauseDur;
  crono.pauseStartTs = 0;
  crono.state = 'running';
  cronoSaveState();
  cronoRender();
  cronoStartTick();
  cronoAcquireWakeLock();
}

function cronoStop() {
  const ms = cronoEffectiveElapsedMs();
  const min = Math.floor(ms / 60000);
  if (min >= CRONO_MIN_MIN) {
    // El botón ya expresa la acción completa. Guardamos de inmediato y
    // dejamos la valoración opcional para el cierre rápido.
    cronoFinish();
  } else {
    // Sesión que será fallida: mostrar modal HTML elegante
    cronoShowConfirmFallidaModal(ms);
  }
}

// Modal antes de parar con <10 min. Pregunta si quiere abortar como fallida.
function cronoShowConfirmFallidaModal(ms) {
  const dur = cronoFmt(ms);
  let modal = document.getElementById('modalCronoConfirmFallida');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalCronoConfirmFallida';
    modal.className = 'modal-overlay';
    modal.innerHTML =
      '<div class="modal crono-fallida-modal">' +
        '<div class="crono-fallida-icon">⏳</div>' +
        '<div class="crono-fallida-title">¿Parar ahora?</div>' +
        '<div class="crono-fallida-sub">Llevas <span id="cronoConfirmFallidaDur"></span>. Si paras ahora será una <strong>sesión fallida</strong> (mínimo ' + CRONO_MIN_MIN + ' min).</div>' +
        '<div class="crono-fallida-actions">' +
          '<button class="crono-fallida-ok" style="border-color:var(--text2);background:transparent;color:var(--text2)" onclick="cronoConfirmFallidaCancel()">Seguir estudiando</button>' +
          '<button class="crono-fallida-del" onclick="cronoConfirmFallidaAccept()">Parar como fallida</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }
  const durEl = document.getElementById('cronoConfirmFallidaDur');
  if (durEl) durEl.textContent = dur;
  openModal('modalCronoConfirmFallida');
}

function cronoConfirmFallidaCancel() {
  closeModal('modalCronoConfirmFallida');
}

function cronoConfirmFallidaAccept() {
  closeModal('modalCronoConfirmFallida');
  cronoFinish();
}

function cronoForcedFinish() {
  showToast('Pausa expirada · sesión finalizada');
  cronoFinish();
}


function cronoPlayHarvest(prevMin, totalMin, addedMin) {
  if (!Number.isFinite(totalMin) || totalMin <= 0) return;
  const burst = document.createElement('div');
  burst.className = 'crono-harvest-burst';
  burst.innerHTML = '<strong>+' + Math.max(1, addedMin || (totalMin - prevMin)) + 'm</strong><span>sesión guardada</span>';
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1600);
  ['cronoConcentradoText', 'sessionConcentradoText'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('harvest-pop');
    void el.offsetWidth;
    el.classList.add('harvest-pop');
  });
}

function cronoEffectiveEndedAtIso(elapsedMs) {
  if (!crono.startTs) return new Date().toISOString();
  if (crono.state === 'paused' && crono.pauseStartTs) return new Date(crono.pauseStartTs).toISOString();
  if (crono.targetDurationMs != null) {
    return new Date(crono.startTs + (crono.pausedMs || 0) + elapsedMs).toISOString();
  }
  return new Date().toISOString();
}

function cronoFinish(expectedRunId) {
  const runId = crono.runId;
  if (crono.state === 'idle' || !runId || (expectedRunId && expectedRunId !== runId) || _cronoFinalizingRunId === runId) return;
  _cronoFinalizingRunId = runId;
  cronoStopTick();
  cronoStopPauseCountdown();
  cronoReleaseWakeLock();

  // Si el día cambió mientras el cronómetro corría, hacer reset del plan ANTES
  // de añadir esta sesión, para que cuente como sesión del día NUEVO. La
  // sesión se asigna por hora de finalización (igual que Forest).
  const nowDay = new Date().toDateString();
  if (_currentPlanDay !== nowDay) {
    handleDayChange();
  }

  // Los objetivos se aplican también si el navegador despierta tarde. El modo
  // libre conserva todo el tiempo activo, sin un límite artificial.
  const ms = cronoEffectiveElapsedMs();
  const minutos = Math.floor(ms / 60000);
  const cronoSessionNotes = cronoBuildSessionNotes(ms, minutos);

  // ── DESCANSO: no añade tarjeta, no llama al modal hecho, no suma minutos
  // al "concentrado hoy". Solo registra en db.sessionPlants con tipo descanso.
  if (crono.isRest) {
    if (crono.startTs && minutos >= 1) {
      finishStudyBlock({
        obraId: '_rest_',
        movId: null,
        startedAt: new Date(crono.startTs).toISOString(),
        endedAt: cronoEffectiveEndedAtIso(ms),
        mins: minutos,
        runId,
        opts: { source: 'app', notes: cronoSessionNotes, tipo: 'descanso' }
      });
    }
    cronoReset();
    cronoRender();
    refreshConcentradoUI();
    // Pequeño toast de confirmación
    if (minutos >= 1) {
      showToast('Descanso registrado: ' + minutos + ' min');
    }
    return;
  }

  const obraId = crono.obraId;
  const movId  = crono.movId;
  const displayName = crono.displayName;
  const prevConcentradoMin = typeof getMinutosConcentradoHoy === 'function' ? getMinutosConcentradoHoy() : 0;

  if (minutos < CRONO_MIN_MIN) {
    cronoIncFallidas();
    // Guardar la sesión fallida en db.sessionPlants con flag failed:true,
    // para que aparezca en estadísticas y mantenga el historial completo
    // (igual que los "árboles marchitos" del CSV de Forest).
    if (obraId && crono.startTs) {
      const startedAtIso = new Date(crono.startTs).toISOString();
      finishStudyBlock({
        obraId,
        movId,
        startedAt: startedAtIso,
        endedAt: cronoEffectiveEndedAtIso(ms),
        mins: minutos,
        runId,
        opts: { failed: true, notes: cronoSessionNotes }
      });
    }
    cronoReset();
    cronoRender();
    refreshConcentradoUI();
    // Mostrar modal con opciones (¡La próxima vez mejorará!)
    cronoShowFallidaModal(ms);
    return;
  }

  const obra = findObra(obraId);
  if (!obra) {
    showToast('La obra ya no existe — sesión descartada');
    cronoReset();
    cronoRender();
    return;
  }
  const mov = movId && obra.movimientos ? obra.movimientos.find(m => m.id === movId) : null;
  const startedAtIso = new Date(crono.startTs).toISOString();
  const endedAtIso = cronoEffectiveEndedAtIso(ms);
  const blockResult = finishStudyBlock({
    obraId,
    movId,
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    mins: minutos,
    runId,
    opts: { notes: cronoSessionNotes }
  });
  if (!blockResult.persisted) {
    cronoReset();
    cronoRender();
    refreshConcentradoUI();
    return;
  }

  // ── FUSIÓN: buscar tarjeta existente para la misma obra/movimiento ───────
  // Si ya hay una tarjeta de esta misma obra y movimiento en el plan, sumamos
  // los minutos a la existente en lugar de crear una nueva tarjeta.
  const existing = currentPlan.find(e =>
    (e._obraId || e.id) === obraId &&
    (e._movId || null) === (movId || null)
  );

  let targetPlanId, isFusion;

  if (existing) {
    targetPlanId = existing._planId || existing.id;
    isFusion = true;
    const wasExtra = !!existing._isExtra;
    const promoted = promotePlanEntityToExtra(existing, obra, mov, obraId, movId, displayName, targetPlanId);
    if (!wasExtra) {
      // Primera vez que se estudia una tarjeta PLANIFICADA: el valor que tenía
      // era una estimación (p.ej. 10 min). Lo reemplazamos por los minutos
      // REALES estudiados (p.ej. 20). A partir de aquí pasa a ser tarjeta de
      // tiempo real y las siguientes sesiones SÍ suman.
      sessionMinPlan[targetPlanId] = minutos;
    } else {
      // Tarjeta de tiempo real: acumular.
      sessionMinPlan[targetPlanId] = (sessionMinPlan[targetPlanId] || 0) + minutos;
    }
    // Re-renderizar la tarjeta con el total actualizado
    const planEl = document.getElementById('plan-' + targetPlanId);
    if (planEl) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderExtraItem(promoted, sessionMinPlan[targetPlanId]);
      if (wrapper.firstChild) {
        planEl.replaceWith(wrapper.firstChild);
      }
      // Si ya tenía tick "hecho", restaurar la marca visual
      if (sessionTicks[targetPlanId] === 'hecho') {
        const newRow = document.querySelector('#plan-' + targetPlanId + ' .tick-row');
        if (newRow) {
          const hechoBtn = newRow.querySelector('.tick-btn');
          if (hechoBtn) hechoBtn.classList.add('hecho');
        }
        const minRow = document.getElementById('tickmin-' + targetPlanId);
        if (minRow) minRow.style.display = 'flex';
        updateProductivityBadge(targetPlanId);
      }
    }
  } else {
    // Crear nueva tarjeta
    const extraId = 'crono_' + obraId + (movId ? '_' + movId : '') + '_' + Date.now();
    const baseEntity = movId
      ? Object.assign({}, mov, { _parentName: obra.name, composer: obra.composer })
      : Object.assign({}, obra);
    const extraEntity = Object.assign({}, baseEntity, {
      _planId: extraId,
      _obraId: obraId,
      _movId: movId || null,
      _isMovimiento: !!movId,
      _isExtra: true,
      _displayName: displayName,
    });
    currentPlan.push(extraEntity);
    sessionMinPlan[extraId] = minutos;
    targetPlanId = extraId;
    isFusion = false;

    if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
    const planDiv = document.getElementById('sessionPlan');
    if (planDiv && typeof renderExtraItem === 'function') {
      const addBtn  = planDiv.querySelector('.add-extra-btn');
      const saveBtn = planDiv.querySelector('.save-session-btn');
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderExtraItem(extraEntity, minutos);
      if (wrapper.firstChild) {
        planDiv.insertBefore(wrapper.firstChild, addBtn || saveBtn);
      }
      if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
    }
  }

  if (typeof saveDraft === 'function') saveDraft();

  // Capturar timestamps reales de inicio/fin para que closeHechoDatos los
  // grabe en la sub-sesión. Se guardan en un slot temporal del aggregate
  // antes de hacer reset.
  if (!sessionAggregate[targetPlanId]) sessionAggregate[targetPlanId] = { subsessions: [] };
  sessionAggregate[targetPlanId]._pendingTimes = {
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    notes: cronoSessionNotes,
    observation: crono.observation || ''
  };

  cronoReset();
  cronoRender();
  cronoPlayHarvest(
    prevConcentradoMin,
    typeof getMinutosConcentradoHoy === 'function' ? getMinutosConcentradoHoy() : prevConcentradoMin + minutos,
    minutos
  );

  // NO cambiamos a la pestaña sesión. El modal Hecho aparece encima del
  // cronómetro (z-index del overlay del modal está por encima). El usuario
  // sigue viendo el cronómetro al fondo y al cerrar el modal puede seguir
  // plantando si quiere.
  setTimeout(() => {
    if (typeof openHechoDatos === 'function') {
      openHechoDatos(targetPlanId, minutos, { subSession: true });
    }
    refreshConcentradoUI();
    autoSaveTodayPlan();
  }, 120);
}

function cronoReset() {
  cronoReleaseWakeLock();
  crono.state = 'idle';
  crono.isRest = false;
  crono.targetMinutes = null;
  crono.targetDurationMs = null;
  crono.runId = null;
  _cronoPendingFinishRunId = null;
  _cronoFinalizingRunId = null;
  _cronoRunDrawerTab = 'pasajes';
  crono.obraId = null;
  crono.movId = null;
  crono.displayName = '';
  crono.subName = '';
  crono.color = null;
  crono.startTs = 0;
  crono.pausedMs = 0;
  crono.pauseStartTs = 0;
  crono.notes = [];
  crono.observation = '';
  _cronoLastRunDestelloKey = '';
  // NB: NO reseteamos mode ni timerMinutes — son preferencias persistentes.
  // Las guardamos en localStorage para la próxima sesión.
  cronoSaveState();
}

// ── Drawer de pases ──────────────────────────────────────────────────────────

function cronoPaseDrawerToggle() {
  _cronoPaseDrawerOpen = !_cronoPaseDrawerOpen;
  const drawer = document.getElementById('cronoPaseDrawer');
  if (drawer) drawer.classList.toggle('open', _cronoPaseDrawerOpen);
}

function drawerTogglePase(cual) {
  const isAntes = cual === 'antes';
  if (isAntes) {
    _cronoDraftPases.antesActive = !_cronoDraftPases.antesActive;
  } else {
    _cronoDraftPases.despuesActive = !_cronoDraftPases.despuesActive;
  }
  const active = isAntes ? _cronoDraftPases.antesActive : _cronoDraftPases.despuesActive;
  const suffix = isAntes ? 'Antes' : 'Despues';
  const content = document.getElementById('drawer' + suffix + 'Content');
  const btn = document.getElementById('drawer' + suffix + 'Toggle');
  if (content) content.style.display = active ? 'block' : 'none';
  if (btn) btn.textContent = active ? '− quitar' : '+ añadir';
}

function drawerUpdateSlider(cual, val) {
  const pct = parseInt(val);
  if (cual === 'antes') _cronoDraftPases.antesVal = pct;
  else _cronoDraftPases.despuesVal = pct;
  const suffix = cual === 'antes' ? 'Antes' : 'Despues';
  const valEl = document.getElementById('drawer' + suffix + 'Val');
  if (valEl) valEl.textContent = pct + '%';
}

function _cronoPaseDrawerReset() {
  _cronoDraftPases = { antesActive: false, antesVal: 50, despuesActive: false, despuesVal: 60 };
  _cronoPaseDrawerOpen = false;
  const drawer = document.getElementById('cronoPaseDrawer');
  if (drawer) drawer.classList.remove('open');
  ['Antes','Despues'].forEach(s => {
    const c = document.getElementById('drawer' + s + 'Content');
    const b = document.getElementById('drawer' + s + 'Toggle');
    const v = document.getElementById('drawer' + s + 'Val');
    if (c) c.style.display = 'none';
    if (b) b.textContent = '+ añadir';
    if (v) v.textContent = (s === 'Antes' ? '50' : '60') + '%';
    const sl = document.getElementById('drawer' + s + 'Slider');
    if (sl) sl.value = s === 'Antes' ? 50 : 60;
  });
}

// ── Cambiar la obra de una tarjeta ya añadida al plan ─────────────────────
// Útil si elegiste la obra equivocada al plantar. Mueve el tiempo, los ticks,
// el aggregate (sub-sesiones, pasajes), y migra los registros de
// db.sessionPlants asociados al planId al nuevo obraId/movId.

let _changePlanObraTarget = null; // planId actual siendo editado

function openChangePlanObra(planId) {
  const entity = currentPlan.find(e => (e._planId || e.id) === planId);
  if (!entity) return;
  _changePlanObraTarget = planId;
  const sel = document.getElementById('changePlanObraSelect');
  if (!sel) return;
  if (typeof cronoFillSelectInto === 'function') {
    cronoFillSelectInto(sel);
  }
  // Preseleccionar la obra actual
  const currentVal = entity._movId
    ? ('mov::' + entity._obraId + '::' + entity._movId)
    : ('obra::' + entity._obraId);
  const has = Array.from(sel.options).some(o => o.value === currentVal);
  if (has) sel.value = currentVal;
  openModal('modalChangePlanObra');
}

function confirmChangePlanObra() {
  const planId = _changePlanObraTarget;
  if (!planId) { closeModal('modalChangePlanObra'); return; }
  const sel = document.getElementById('changePlanObraSelect');
  if (!sel) return;
  const resolved = cronoResolveSelectValue(sel.value);
  if (!resolved) { showToast('Elige una obra o movimiento'); return; }
  const entity = currentPlan.find(e => (e._planId || e.id) === planId);
  if (!entity) { closeModal('modalChangePlanObra'); return; }

  const oldObraId = entity._obraId;
  const oldMovId = entity._movId || null;
  const newObraId = resolved.obraId;
  const newMovId = resolved.movId || null;

  // Si es la misma, no hacemos nada
  if (oldObraId === newObraId && oldMovId === newMovId) {
    closeModal('modalChangePlanObra');
    return;
  }

  // Comprobar si ya existe una tarjeta en el plan con ese obraId/movId.
  // Si sí, fusionamos esta tarjeta con la existente (sumamos minutos, mergemos
  // sub-sesiones del aggregate, etc.) y eliminamos la tarjeta vieja.
  const existing = currentPlan.find(e =>
    (e._planId || e.id) !== planId &&
    (e._obraId === newObraId) &&
    ((e._movId || null) === newMovId)
  );

  // Migrar entradas de db.sessionPlants
  if (Array.isArray(db.sessionPlants)) {
    db.sessionPlants.forEach(p => {
      // Sólo migramos si la entrada corresponde al planId actual (no hay forma
      // directa de saberlo: usamos el obraId/movId originales como heurística,
      // limitado a las entradas más recientes que coincidan).
      if (p.obraId === oldObraId && (p.movId || null) === oldMovId && p.source === 'app') {
        p.obraId = newObraId;
        p.movId = newMovId;
      }
    });
  }

  if (existing) {
    // Fusionar: sumar minutos y mergear aggregate
    const existingPid = existing._planId || existing.id;
    sessionMinPlan[existingPid] = (sessionMinPlan[existingPid] || 0) + (sessionMinPlan[planId] || 0);
    // Mergear sub-sesiones del aggregate
    const oldAgg = sessionAggregate[planId];
    if (oldAgg && Array.isArray(oldAgg.subsessions)) {
      if (!sessionAggregate[existingPid]) sessionAggregate[existingPid] = { subsessions: [] };
      sessionAggregate[existingPid].subsessions = sessionAggregate[existingPid].subsessions.concat(oldAgg.subsessions);
    }
    // Limpiar estructuras del planId viejo
    delete sessionMinPlan[planId];
    delete sessionTicks[planId];
    delete sessionSolRatings[planId];
    delete sessionProductivityRatings[planId];
    delete sessionAggregate[planId];
    currentPlan = currentPlan.filter(e => (e._planId || e.id) !== planId);
    // Quitar la tarjeta vieja del DOM
    const oldEl = document.getElementById('plan-' + planId);
    if (oldEl) oldEl.remove();
    // Re-renderizar la tarjeta que absorbió
    const planEl = document.getElementById('plan-' + existingPid);
    if (planEl) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderExtraItem(existing, sessionMinPlan[existingPid]);
      if (wrapper.firstChild) planEl.replaceWith(wrapper.firstChild);
      if (sessionTicks[existingPid] === 'hecho') {
        const btn = document.querySelector('#plan-' + existingPid + ' .tick-btn');
        if (btn) btn.classList.add('hecho');
        updateProductivityBadge(existingPid);
      }
    }
    showToast('Tarjeta fusionada con la existente');
  } else {
    // Re-asignar: cambiar los campos del entity, mantener planId
    const obra = findObra(newObraId);
    if (!obra) { closeModal('modalChangePlanObra'); return; }
    entity._obraId = newObraId;
    entity._movId = newMovId;
    entity._isMovimiento = !!newMovId;
    if (newMovId) {
      const mov = (obra.movimientos || []).find(m => m.id === newMovId);
      if (!mov) { closeModal('modalChangePlanObra'); return; }
      entity.name = mov.name;
      entity._parentName = obra.name;
      entity.composer = obra.composer;
      entity._displayName = mov.name;
    } else {
      entity.name = obra.name;
      entity.composer = obra.composer;
      entity._parentName = null;
      entity._displayName = obra.name;
    }
    entity.color = obraColorHex(obra) || null;
    // Re-render la tarjeta
    const planEl = document.getElementById('plan-' + planId);
    if (planEl) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderExtraItem(entity, sessionMinPlan[planId] || 0);
      if (wrapper.firstChild) planEl.replaceWith(wrapper.firstChild);
      if (sessionTicks[planId] === 'hecho') {
        const btn = document.querySelector('#plan-' + planId + ' .tick-btn');
        if (btn) btn.classList.add('hecho');
        updateProductivityBadge(planId);
      }
    }
    showToast('Obra cambiada');
  }

  saveDraft();
  autoSaveTodayPlan();
  refreshConcentradoUI();
  saveData();
  closeModal('modalChangePlanObra');
  _changePlanObraTarget = null;
}

// ── Cambiar de obra durante la sesión ───────────────────────────────────────

function cronoOpenChangeObra() {
  if (crono.state !== 'running' && crono.state !== 'paused') return;
  // Rellenar el select del modal y preseleccionar la obra actual
  const sel = document.getElementById('cronoChangeSelect');
  if (!sel) return;
  cronoFillSelectInto(sel);
  // Preseleccionar la actual
  const currentVal = crono.movId
    ? ('mov::' + crono.obraId + '::' + crono.movId)
    : ('obra::' + crono.obraId);
  const has = Array.from(sel.options).some(o => o.value === currentVal);
  if (has) sel.value = currentVal;
  openModal('modalCronoChangeObra');
}

function cronoConfirmChangeObra() {
  const sel = document.getElementById('cronoChangeSelect');
  if (!sel) return;
  const resolved = cronoResolveSelectValue(sel.value);
  if (!resolved) { showToast('Elige una obra o movimiento'); return; }

  // Si es la misma, simplemente cerramos
  const same = (resolved.obraId === crono.obraId) && (resolved.movId === crono.movId);
  if (same) { closeModal('modalCronoChangeObra'); return; }

  crono.obraId = resolved.obraId;
  crono.movId = resolved.movId;
  crono.displayName = resolved.displayName;
  crono.subName = resolved.subName;
  crono.color = resolved.color || null;
  cronoSaveState();
  cronoRender();
  closeModal('modalCronoChangeObra');
  showToast('Cambiado a: ' + resolved.displayName);
}

// ── Selectores ──────────────────────────────────────────────────────────────

function cronoFillSelectInto(select) {
  if (!select) return;
  const prev = select.value;
  const obras = (db.obras || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  let opts = '<option value="">Elige una obra o actividad</option>';
  obras.forEach(o => {
    // Las actividades no tienen movimientos
    const movs = (o.tipo === 'actividad') ? [] : (o.movimientos || []).filter(m => m.name);
    const labelSuffix = (o.composer && o.composer !== '—') ? ' · ' + o.composer : '';
    if (!movs.length) {
      opts += '<option value="obra::' + o.id + '">' +
        o.name + labelSuffix + '</option>';
    } else {
      opts += '<option value="" disabled>── ' +
        o.name + labelSuffix + ' ──</option>';
      movs.forEach(m => {
        opts += '<option value="mov::' + o.id + '::' + m.id + '">  ' + m.name + '</option>';
      });
    }
  });
  select.innerHTML = opts;
  if (prev) {
    const found = Array.from(select.options).some(o => o.value === prev);
    if (found) select.value = prev;
  }
}

function cronoFillObraSelect() {
  cronoFillSelectInto(document.getElementById('cronoObraSelect'));
  // Tras rellenar el select nativo, sincronizar el botón custom.
  cronoUpdateSelectBtn();
}

// Por defecto, deja seleccionada la ÚLTIMA obra/actividad usada (la de mayor
// recencia), aunque se entre otro día. Solo si no hay nada ya seleccionado y el
// cronómetro está en reposo; el usuario puede cambiarla cuando quiera.
function cronoSelectLastUsed() {
  if (crono && (crono.state === 'running' || crono.state === 'paused')) return;
  const sel = document.getElementById('cronoObraSelect');
  if (!sel || sel.value) return;
  const recency = getCronoPickRecency();
  let bestVal = '', bestT = -1;
  Array.from(sel.options).forEach(opt => {
    if (!opt.value) return;
    const obraId = opt.value.split('::')[1];
    const t = recency[obraId] || 0;
    if (t > bestT) { bestT = t; bestVal = opt.value; }
  });
  if (bestVal && bestT > 0) {
    sel.value = bestVal;
    cronoUpdateSelectBtn();
    if (typeof cronoUpdateStartBtn === 'function') cronoUpdateStartBtn();
  }
}

// Sincroniza el botón custom con el valor actual del <select> nativo.
// Muestra el dot del color de la obra y su nombre + composer.
function cronoUpdateSelectBtn() {
  const sel = document.getElementById('cronoObraSelect');
  const btn = document.getElementById('cronoObraSelectBtn');
  const dot = document.getElementById('cronoObraSelectBtnDot');
  const label = document.getElementById('cronoObraSelectBtnLabel');
  if (!sel || !btn || !dot || !label) return;
  const val = sel.value;
  if (!val) {
    dot.classList.add('is-empty');
    dot.style.background = '';
    label.textContent = 'Elige una obra o actividad';
    return;
  }
  // Resolver obra (y movimiento si aplica) desde el value
  // Formato: "obra::<obraId>" o "mov::<obraId>::<movId>"
  const parts = val.split('::');
  const obraId = parts[1];
  const movId = parts[2] || null;
  const obra = (db.obras || []).find(o => o.id === obraId);
  if (!obra) {
    dot.classList.add('is-empty');
    label.textContent = 'Elige una obra o actividad';
    return;
  }
  dot.classList.remove('is-empty');
  const hex = (typeof obraColorHex === 'function') ? (obraColorHex(obra) || 'var(--accent)') : 'var(--accent)';
  dot.style.background = hex;
  let texto = obra.name;
  if (movId) {
    const mov = (obra.movimientos || []).find(m => m.id === movId);
    if (mov) texto = obra.name + ' — ' + mov.name;
  } else if (obra.composer && obra.composer !== '—') {
    texto = obra.name + ' · ' + obra.composer;
  }
  label.textContent = texto;
}

// Modo del picker: 'crono' (selecciona obra para el cronómetro) |
//                 'pase'  (abre registerPase al elegir obra)
let _obraPickerMode = 'crono';

function openPasePicker() {
  _obraPickerMode = 'pase';
  openCronoObraPicker();
}

// ── Recencia del picker: las últimas obras/actividades elegidas suben arriba ──
function getCronoPickRecency() {
  try { return JSON.parse(localStorage.getItem('cronoPickRecency') || '{}') || {}; }
  catch (e) { return {}; }
}
function bumpCronoPickRecency(obraId) {
  if (!obraId) return;
  try {
    const m = getCronoPickRecency();
    m[obraId] = Date.now();
    localStorage.setItem('cronoPickRecency', JSON.stringify(m));
  } catch (e) {}
}

// Ajusta el picker al viewport visible. Si el teclado del buscador está
// abierto, anclamos arriba (clase .keyboard-open) y cuadramos el alto al
// visualViewport real para que el teclado no tape el modal. Si no hay
// teclado, dejamos que el CSS lo centre con su altura compacta (70dvh).
function _cronoPickerFit() {
  const overlay = document.getElementById('modalCronoObraPicker');
  if (!overlay || !overlay.classList.contains('visible')) return;
  const modal = overlay.querySelector('.modal');
  if (!modal) return;
  const vv = window.visualViewport;
  const visualH = vv ? vv.height : window.innerHeight;
  const innerH = window.innerHeight;
  // Detección de teclado: si el visualViewport es notablemente más pequeño
  // que el viewport completo, es porque el teclado está abierto.
  const keyboardOpen = !!vv && (innerH - visualH > 120);
  overlay.classList.toggle('keyboard-open', keyboardOpen);
  if (keyboardOpen) {
    const h = Math.max(220, Math.round(visualH - 20)) + 'px';
    modal.style.height = h;
    modal.style.maxHeight = h;
  } else {
    // Sin teclado: limpia los estilos inline y el CSS centrado-compacto manda.
    modal.style.height = '';
    modal.style.maxHeight = '';
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', _cronoPickerFit);
  window.visualViewport.addEventListener('scroll', _cronoPickerFit);
}

// Abre el modal picker. Resetea el buscador y renderiza.
function openCronoObraPicker() {
  const search = document.getElementById('cronoObraPickerSearch');
  if (search) search.value = '';
  renderCronoObraPicker();
  openModal('modalCronoObraPicker');
  _cronoPickerFit();
  // Focus al search tras un pequeño delay para que iOS termine la animación
  setTimeout(() => { if (search) search.focus(); _cronoPickerFit(); }, 200);
}

// Renderiza la lista de obras/actividades con su dot de color.
// Filtra por el texto del buscador (case-insensitive, sobre nombre+composer).
function renderCronoObraPicker() {
  const list = document.getElementById('cronoObraPickerList');
  const search = document.getElementById('cronoObraPickerSearch');
  const sel = document.getElementById('cronoObraSelect');
  if (!list) return;
  const q = (search?.value || '').toLowerCase().trim();
  const recency = getCronoPickRecency();
  const obras = (db.obras || []).slice().sort((a, b) => {
    const ra = recency[a.id] || 0, rb = recency[b.id] || 0;
    if (ra !== rb) return rb - ra;        // más reciente primero
    return a.name.localeCompare(b.name);  // sin uso previo: alfabético
  });
  const currentValue = sel?.value || '';

  // Obras y actividades MEZCLADAS en una sola lista, en orden de uso reciente
  // (lo último que tocaste arriba del todo, sin separar por tipo).
  const items = obras.filter(o => {
    if (!q) return true;
    const composerTxt = (o.composer && o.composer !== '—') ? o.composer : '';
    if ((o.name + ' ' + composerTxt).toLowerCase().includes(q)) return true;
    return (o.movimientos || []).some(m => m.name && m.name.toLowerCase().includes(q));
  });

  function obraButtonHTML(o, isActivity) {
    const hex = (typeof obraColorHex === 'function') ? (obraColorHex(o) || '') : '';
    const dotStyle = hex ? 'background:' + hex : '';
    const composerSpan = (o.composer && o.composer !== '—')
      ? '<span class="crono-picker-composer">· ' + escapeHtmlSafe(o.composer) + '</span>'
      : '';
    const movs = isActivity ? [] : (o.movimientos || []).filter(m => m.name);
    let html = '';
    if (!movs.length) {
      const val = 'obra::' + o.id;
      const activeCls = (val === currentValue) ? ' is-active' : '';
      html += '<button class="crono-picker-item' + activeCls + '" onclick="pickCronoObra(\'' + val + '\')">' +
        '<span class="crono-picker-dot" style="' + dotStyle + '"></span>' +
        '<span>' + escapeHtmlSafe(o.name) + composerSpan + '</span>' +
        '</button>';
    } else {
      // Obra con movimientos: encabezado con dot (no clickable como obra
      // entera, porque la lógica de movimientos exige escoger uno) +
      // movimientos debajo indentados.
      html += '<div class="crono-picker-item" style="cursor:default;background:transparent" onclick="event.stopPropagation()">' +
        '<span class="crono-picker-dot" style="' + dotStyle + '"></span>' +
        '<span style="font-weight:500">' + escapeHtmlSafe(o.name) + composerSpan + '</span>' +
        '</div>';
      movs.forEach(m => {
        const val = 'mov::' + o.id + '::' + m.id;
        const activeCls = (val === currentValue) ? ' is-active' : '';
        html += '<button class="crono-picker-item is-mov' + activeCls + '" onclick="pickCronoObra(\'' + val + '\')">' +
          '<span>' + escapeHtmlSafe(m.name) + '</span>' +
          '</button>';
      });
    }
    return html;
  }

  let html = items.map(o => obraButtonHTML(o, o.tipo === 'actividad')).join('');
  if (!html) {
    html = '<div class="crono-picker-empty">' +
      (q ? 'Sin resultados para "' + escapeHtmlSafe(q) + '"' : 'No hay obras todavía') +
      '</div>';
  }
  list.innerHTML = html;
}

// Click en un item del picker: actualiza el select nativo, cierra modal,
// dispara onchange para que la lógica existente (cronoUpdateStartBtn, etc.)
// se ejecute igual que antes.
function pickCronoObra(val) {
  const parts = String(val).split('::');  // 'obra::id' | 'mov::id::movId'
  if (parts.length >= 2) bumpCronoPickRecency(parts[1]);
  closeModal('modalCronoObraPicker');
  if (_obraPickerMode === 'pase') {
    _obraPickerMode = 'crono';
    const obraId = parts[1];
    const movId  = parts[0] === 'mov' && parts[2] ? parts[2] : null;
    if (obraId) registerPase(obraId, movId || undefined);
    return;
  }
  _obraPickerMode = 'crono';
  const sel = document.getElementById('cronoObraSelect');
  if (!sel) return;
  sel.value = val;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  cronoUpdateSelectBtn();
}

// ── Fallidas (counter por día, sólo informativo) ────────────────────────────

function cronoIncFallidas() {
  try {
    const today = new Date().toDateString();
    const k = 'cronoFallidas_' + today;
    const n = (parseInt(localStorage.getItem(k)) || 0) + 1;
    localStorage.setItem(k, String(n));
  } catch(e) {}
}

function cronoGetFallidasToday() {
  try {
    const today = new Date().toDateString();
    return parseInt(localStorage.getItem('cronoFallidas_' + today)) || 0;
  } catch(e) { return 0; }
}

function cronoDecFallidas() {
  try {
    const today = new Date().toDateString();
    const k = 'cronoFallidas_' + today;
    const n = Math.max(0, (parseInt(localStorage.getItem(k)) || 0) - 1);
    localStorage.setItem(k, String(n));
  } catch(e) {}
}

// Modal de sesión fallida — aparece tras parar el cronómetro con <10 min
function cronoShowFallidaModal(ms) {
  const dur = cronoFmt(ms);
  let modal = document.getElementById('modalCronoFallida');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalCronoFallida';
    modal.className = 'modal-overlay';
    modal.innerHTML =
      '<div class="modal crono-fallida-modal">' +
        '<div class="crono-fallida-icon">✿</div>' +
        '<div class="crono-fallida-title">¡La próxima vez mejorará!</div>' +
        '<div class="crono-fallida-sub" id="cronoFallidaSub">Sólo has estudiado <span id="cronoFallidaDur"></span>. Mínimo: ' + CRONO_MIN_MIN + ' min.</div>' +
        '<div class="crono-fallida-actions">' +
          '<button class="crono-fallida-ok" onclick="cronoFallidaOk()">De acuerdo</button>' +
          '<button class="crono-fallida-del" onclick="cronoFallidaBorrarRegistro()">Borrar el registro</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }
  const durEl = document.getElementById('cronoFallidaDur');
  if (durEl) durEl.textContent = dur;
  openModal('modalCronoFallida');
}

function cronoFallidaOk() {
  closeModal('modalCronoFallida');
}

function cronoFallidaBorrarRegistro() {
  cronoDecFallidas();
  closeModal('modalCronoFallida');
  cronoRender();
  showToast('Registro borrado');
}

// ── Entrada / salida de la vista ────────────────────────────────────────────

// Live clock shown in the center of the stopwatch when idle.
let _cronoClockInterval = null;
function _startCronoClock() {
  function _tick() {
    const hourHand = document.getElementById('cronoClockHourHand');
    const minHand  = document.getElementById('cronoClockMinHand');
    const secHand  = document.getElementById('cronoClockSecHand');
    const hoyEl    = document.getElementById('cronoClockHoy');
    if (!hourHand && !hoyEl) return;
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    if (hourHand) hourHand.setAttribute('transform', 'rotate(' + ((h % 12) * 30 + m * 0.5) + ' 100 100)');
    if (minHand)  minHand.setAttribute('transform',  'rotate(' + (m * 6 + s * 0.1) + ' 100 100)');
    if (secHand)  secHand.setAttribute('transform',  'rotate(' + (s * 6) + ' 100 100)');
    if (hoyEl) {
      const min = typeof getMinutosConcentradoHoy === 'function' ? getMinutosConcentradoHoy() : 0;
      hoyEl.textContent = 'hoy · ' + min + ' min';
    }
    if (crono.state === 'idle' && crono.mode === 'until') cronoTimerRenderSlider();
  }
  _tick();
  if (_cronoClockInterval) clearInterval(_cronoClockInterval);
  _cronoClockInterval = setInterval(_tick, 1000);
}
function _stopCronoClock() {
  if (_cronoClockInterval) { clearInterval(_cronoClockInterval); _cronoClockInterval = null; }
}

function cronoOnEnterView() {
  cronoEnterFocus();
  cronoFillObraSelect();
  cronoSelectLastUsed();
  cronoApplyModeUI();
  cronoTimerInitDrag();
  cronoRender();
  refreshConcentradoUI();
  _startCronoClock();
  // El indicador del toggle necesita layout para medir; volver a moverlo tras frame
  requestAnimationFrame(cronoMoveModeIndicator);
  if (crono.state === 'running' && !crono.tickInterval) cronoStartTick();
  if (crono.state === 'paused'  && !crono.pauseInterval) cronoStartPauseCountdown();
}

// Se llama desde showView cuando se cambia a OTRA vista que no es cronometro
function cronoOnLeaveView() {
  _stopCronoClock();
  if (typeof closeCronoAyerPanel === 'function') closeCronoAyerPanel();
  cronoExitFocus();
  document.body.classList.remove('crono-timer-mode');
  document.body.classList.remove('crono-until-mode');
  document.body.classList.remove('crono-running');
}

// Hidratar al cargar (si había sesión activa)
function cronoHydrate() {
  if (cronoLoadState()) {
    if (crono.state === 'paused' && cronoPauseRemainingMs() <= 0) {
      // La pausa expiró estando la app cerrada. En lugar de terminar (como
      // antes), reanudamos la sesión: respetamos los ms acumulados de pausa
      // hasta el límite (5 min) y volvemos al estado running.
      crono.pausedMs += CRONO_PAUSE_LIMIT_MS;
      crono.pauseStartTs = 0;
      crono.state = 'running';
      cronoSaveState();
      cronoStartTick();
    } else if (crono.state === 'running') {
      if (cronoTargetReached()) {
        cronoStopTick();
        cronoQueueFinish(crono.runId);
      } else {
        cronoStartTick();
      }
    } else if (crono.state === 'paused') {
      cronoStartPauseCountdown();
    }
  }
}

window.addEventListener('load', function() {
  setTimeout(cronoHydrate, 100);
  _swUpdateInit();
});

// ── Service Worker update detection ──────────────────────────────────────────
let _swReg = null;
let _appUpdateChecking = false;

function updateAppVersionInfo(text) {
  const el = document.getElementById('appVersionInfo');
  if (!el) return;
  el.textContent = text || ('Versión local: ' + APP_VERSION);
}

function _swUpdateInit() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    _swReg = reg;
    if (reg.waiting) _swShowBanner();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) _swShowBanner();
      });
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => { window.location.reload(); });
}

function _swShowBanner() {
  const b = document.getElementById('swUpdateBanner');
  if (b) b.style.display = 'flex';
}

async function swHardRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister().catch(() => false)));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
  } catch(e) {}
  const url = new URL(window.location.href);
  url.searchParams.set('v', APP_VERSION + '-' + Date.now());
  window.location.replace(url.toString());
}

function swDoUpdate() {
  if (_swReg && _swReg.waiting) {
    _swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  swHardRefresh();
}

async function checkForAppUpdate(manual) {
  if (_appUpdateChecking) return;
  _appUpdateChecking = true;
  const btn = document.getElementById('appUpdateCheckBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Buscando...';
  }
  updateAppVersionInfo('Buscando actualización...');

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        _swReg = reg;
        await reg.update().catch(() => {});
        if (reg.waiting) {
          _swShowBanner();
          updateAppVersionInfo('Nueva versión lista. Pulsa Actualizar.');
          if (manual) showToast('Nueva versión disponible');
          return;
        }
      }
    }

    const res = await fetch('./app.js?update=' + Date.now(), { cache: 'no-store' });
    const txt = await res.text();
    const markerA = "APP_VERSION = '" + APP_VERSION + "'";
    const markerB = 'APP_VERSION = "' + APP_VERSION + '"';
    if (txt && !txt.includes(markerA) && !txt.includes(markerB)) {
      updateAppVersionInfo('Hay una versión distinta. Recargando...');
      if (manual) showToast('Nueva versión encontrada · recargando');
      setTimeout(() => { swHardRefresh(); }, 650);
      return;
    }

    updateAppVersionInfo('Versión local: ' + APP_VERSION + ' · al día');
    if (manual) showToast('No hay actualización pendiente');
  } catch (err) {
    updateAppVersionInfo('No se pudo comprobar. Revisa conexión.');
    if (manual) showToast('No pude comprobar actualizaciones');
  } finally {
    _appUpdateChecking = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Buscar actualización';
    }
  }
}

// ─── FASE 3B · repertorio, pases y evolución ───────────────────────────────
// Estas capas finales consolidan la jerarquía visual del lote 3 sin tocar el
// modelo de datos existente. Se mantienen juntas para que las reglas de la
// tarjeta y de la gráfica puedan evolucionar como un único flujo.

let _phase3ObrasMoreOpen = false;

function toggleObrasMore() {
  _phase3ObrasMoreOpen = !_phase3ObrasMoreOpen;
  renderObras();
}

const _phase3BaseSyncObrasToolbar = syncObrasToolbar;
syncObrasToolbar = function(total, visible) {
  _phase3BaseSyncObrasToolbar(total, visible);
  const view = document.getElementById('view-obras');
  const more = document.getElementById('obrasMoreToggle');
  const sparse = total < 3;
  if (sparse) _phase3ObrasMoreOpen = false;
  if (view) {
    view.classList.toggle('obras-sparse', sparse);
    view.classList.toggle('obras-more-open', !sparse && _phase3ObrasMoreOpen);
  }
  if (more) {
    more.style.display = sparse ? 'none' : 'inline-flex';
    more.setAttribute('aria-expanded', String(!sparse && _phase3ObrasMoreOpen));
    more.textContent = _phase3ObrasMoreOpen ? 'Menos' : 'Más';
  }
};

function _phase3ClampPct(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function _phase3PasePct(entry) {
  if (!entry) return null;
  if (entry.solidezPct != null && Number.isFinite(Number(entry.solidezPct))) {
    return _phase3ClampPct(entry.solidezPct);
  }
  if (entry.score != null && Number.isFinite(Number(entry.score))) {
    return _phase3ClampPct(paseScoreToPct(entry.score));
  }
  const legacy = { bien: 78, regular: 50, mal: 22 };
  return entry.quality && legacy[entry.quality] != null ? legacy[entry.quality] : null;
}

function _phase3HistoryFor(obra, movId) {
  const entity = movId ? findMovimiento(obra.id, movId) : obra;
  return [...(entity?.paseHistory || [])]
    .filter(entry => _phase3PasePct(entry) != null)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function _phase3DateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'sin fecha';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) +
    ' · ' + date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function _phase3MinutesLabel(total) {
  const mins = Math.max(0, Math.round(Number(total) || 0));
  if (mins >= 60) return Math.floor(mins / 60) + ' h' + (mins % 60 ? ' ' + (mins % 60) + ' min' : '');
  return mins + ' min';
}

function _phase3AdminMenu(o) {
  const colorHex = obraColorHex(o);
  return '<details class="obra-admin-menu">' +
    '<summary aria-label="Más acciones de ' + escapeHtmlSafe(o.name) + '">⋯</summary>' +
    '<div class="obra-admin-menu-popover">' +
      '<button class="obra-admin-action obra-color-action" title="Cambiar color"' +
        ' onclick="openObraColorPicker(\'' + o.id + '\')">' +
        '<span class="obra-color-dot" style="background:' + (colorHex || 'transparent') + ';border-color:' + (colorHex || 'var(--border2)') + '"></span>Color</button>' +
      '<button class="obra-admin-action" onclick="openEditObraNombre(\'' + o.id + '\')">Editar</button>' +
      '<button class="obra-admin-action danger" onclick="confirmDeleteObra(\'' + o.id + '\')">Eliminar</button>' +
    '</div>' +
  '</details>';
}

function _phase3TitleAction(o) {
  return 'role="button" tabindex="0" aria-label="Abrir detalle de ' + escapeHtmlSafe(o.name) + '"' +
    ' onclick="openObraDetalleSession(\'' + o.id + '\')"' +
    ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openObraDetalleSession(\'' + o.id + '\')}"';
}

function renderObraCardMini(o) {
  const colorHex = obraColorHex(o);
  const del = '<button class="obra-quick-btn delete obra-edit-action" title="Eliminar"' +
    ' onclick="event.stopPropagation();confirmDeleteObra(\'' + o.id + '\')">' + ICON_DELETE + '</button>';
  if (o.tipo === 'actividad') {
    return '<div class="obra-card obra-card-mini" id="obra-' + o.id + '">' +
      '<span class="obra-color-dot" style="background:' + (colorHex || 'transparent') + '"></span>' +
      '<span class="obra-mini-name" style="flex:1">' + escapeHtmlSafe(o.name) + '</span>' +
      '<span class="obra-mini-comp">actividad</span>' + del + '</div>';
  }
  const history = _phase3HistoryFor(o, null);
  const pct = history.length ? _phase3PasePct(history[0]) : null;
  const col = solPctColor(pct == null ? 0 : pct);
  return '<div class="obra-card obra-card-mini" id="obra-' + o.id + '">' +
    '<span class="obra-color-dot" style="background:' + (colorHex || 'transparent') + '"></span>' +
    '<button class="obra-mini-main" onclick="registerPase(\'' + o.id + '\',null)" aria-label="Registrar pase en ' + escapeHtmlSafe(o.name) + '">' +
      '<span class="obra-mini-name">' + escapeHtmlSafe(o.name) + '</span>' +
      '<span class="obra-mini-bar"><span class="obra-mini-fill" style="width:' + (pct || 0) + '%;background:' + col + '"></span></span>' +
      '<span class="obra-mini-pct" style="color:' + (pct == null ? 'var(--text3)' : col) + '">' + (pct == null ? '—' : pct + '%') + '</span>' +
    '</button>' + del + '</div>';
}

renderObraCardSimple = function(o) {
  if (o.tipo === 'actividad') return renderActividadCard(o, 0);
  const est = estimateSolActual(o);
  const pct = _phase3ClampPct(est.val);
  const col = solPctColor(pct);
  const history = _phase3HistoryFor(o, null);
  const lastDate = o.lastPase || history[0]?.date || null;
  const realMinutes = getMinutosObra(o.id);
  const lastText = lastDate ? 'Último pase · ' + _phase3DateTime(lastDate) : 'Sin pase registrado';
  const scoreCount = history.length;
  const evolution = scoreCount >= 2
    ? '<button class="obra-simple-history" onclick="openGrafico(\'' + o.id + '\',null)">Ver evolución</button>'
    : scoreCount === 1
      ? '<button class="obra-simple-history" onclick="openGrafico(\'' + o.id + '\',null)">Ver historial · 1 pase</button>'
      : '';

  return '<div class="obra-card obra-card-simple" id="obra-' + o.id + '">' +
    '<div class="obra-simple-head">' +
      '<div class="obra-simple-id obra-simple-title" ' + _phase3TitleAction(o) + '>' +
        '<div class="obra-title-line"><span class="obra-name">' + escapeHtmlSafe(o.name) + '</span></div>' +
        '<div class="obra-simple-meta">' +
          '<span>' + escapeHtmlSafe(o.composer && o.composer !== '—' ? o.composer : 'Sin compositor') + '</span>' +
          '<span>Tiempo real · ' + _phase3MinutesLabel(realMinutes) + '</span>' +
        '</div>' +
      '</div>' +
      _phase3AdminMenu(o) +
    '</div>' +
    '<button class="obra-simple-sol obra-primary-pase" onclick="registerPase(\'' + o.id + '\',null)" aria-label="Registrar pase en ' + escapeHtmlSafe(o.name) + '">' +
      '<div class="obra-sol-bar"><div class="obra-sol-fill" style="width:' + pct + '%;background:' + col + '"></div></div>' +
      '<div class="obra-sol-row">' +
        '<strong style="color:' + col + '">' + (scoreCount ? pct + '%' : '—') + '</strong>' +
        '<span class="obra-sol-label">' + (scoreCount ? solPctLabel(pct) : 'Aún sin medir') + '</span>' +
        '<span class="obra-sol-medir">Registrar pase</span>' +
      '</div>' +
    '</button>' +
    '<div class="obra-simple-last">' + escapeHtmlSafe(lastText) + '</div>' +
    evolution +
  '</div>';
};

function _phase3HistoryListHtml(history) {
  if (!history.length) return '<div class="grafico-history-empty">Todavía no hay pases. Registra el primero para empezar a ver evolución.</div>';
  return '<div class="grafico-history-title">Historial de pases · escala 0–100</div>' +
    '<ol class="grafico-history-list" aria-label="Historial cronológico de pases">' +
    history.map(entry => {
      const pct = _phase3PasePct(entry);
      const context = paseTipoShort(entry.tipo);
      const note = entry.note || entry.nota || '';
      return '<li>' +
        '<time datetime="' + escapeHtmlSafe(entry.date || '') + '">' + escapeHtmlSafe(_phase3DateTime(entry.date)) + '</time>' +
        '<strong>' + pct + '%</strong>' +
        '<span>' + escapeHtmlSafe(context) + '</span>' +
        (note ? '<em>' + escapeHtmlSafe(note) + '</em>' : '') +
      '</li>';
    }).join('') + '</ol>';
}

renderGraficoSvg = function() {
  const obra = findObra(graficoObraId);
  if (!obra) return;
  const history = _phase3HistoryFor(obra, graficoMovId);
  const wrap = document.getElementById('graficoSvgWrap');
  const list = document.getElementById('graficoAccessibleList');
  const leyEl = document.getElementById('graficoLeyenda');
  if (!wrap) return;

  if (list) list.innerHTML = _phase3HistoryListHtml(history);
  const dates = new Set(history.map(entry => {
    const date = new Date(entry.date);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-CA');
  }));
  const canTrend = dates.size >= 3 || history.length >= 5;
  if (!canTrend) {
    wrap.innerHTML = history.length
      ? '<div class="grafico-insufficient">Aún no hay muestras suficientes para afirmar una tendencia.</div>'
      : '<div class="grafico-insufficient">Registra el primer pase desde la tarjeta para empezar.</div>';
    if (leyEl) leyEl.innerHTML = '<span class="grafico-scale-note">La evolución aparece con 3 fechas o 5 pases.</span>';
    return;
  }

  const W = 520, H = 220;
  const PAD = { top: 18, right: 18, bottom: 42, left: 34 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const times = history.map((entry, index) => new Date(entry.date).getTime() + index * 1000);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const rangeT = Math.max(1, maxT - minT);
  const xOf = time => PAD.left + ((time - minT) / rangeT) * cW;
  const yOf = pct => PAD.top + cH - (pct / 100) * cH;
  const points = history.map((entry, index) => ({ entry, pct: _phase3PasePct(entry), x: xOf(times[index]), y: yOf(_phase3PasePct(entry)) }));
  const lineD = points.map((point, index) => (index ? 'L' : 'M') + point.x + ',' + point.y).join(' ');
  const gridLines = [0, 25, 50, 75, 100].map(value => {
    const y = yOf(value);
    return '<line x1="' + PAD.left + '" y1="' + y + '" x2="' + (W - PAD.right) + '" y2="' + y + '" stroke="var(--border2)" stroke-dasharray="3,3"/>' +
      '<text x="' + (PAD.left - 5) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">' + value + '%</text>';
  }).join('');
  const labelStep = Math.max(1, Math.ceil(points.length / 5));
  const labels = points.filter((_, index) => index % labelStep === 0 || index === points.length - 1).map(point => {
    const d = new Date(point.entry.date);
    const label = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return '<text x="' + point.x + '" y="' + (H - 9) + '" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="JetBrains Mono,monospace">' + escapeHtmlSafe(label) + '</text>';
  }).join('');
  const dots = points.map(point => {
    const note = point.entry.note || point.entry.nota || '';
    const title = _phase3DateTime(point.entry.date) + ' · ' + point.pct + '%' + (note ? ' · ' + note : '');
    return '<circle cx="' + point.x + '" cy="' + point.y + '" r="5" fill="var(--accent)" stroke="var(--bg2)" stroke-width="1.5"><title>' + escapeHtmlSafe(title) + '</title></circle>';
  }).join('');
  wrap.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" class="grafico-evolucion-svg" role="img" aria-label="Evolución de solidez de 0 a 100 por fecha y hora">' +
    gridLines + '<path d="' + lineD + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' + dots + labels + '</svg>';
  if (leyEl) leyEl.innerHTML = '<span class="grafico-scale-note">Escala 0–100 · cada punto es un pase</span>';
};

// Evita que un doble toque sobre Guardar cree dos registros consecutivos.
const _phase3ConfirmPaseBase = confirmPase;
let _phase3PaseSaving = false;
confirmPase = function() {
  if (_phase3PaseSaving) return;
  _phase3PaseSaving = true;
  try { _phase3ConfirmPaseBase(); }
  finally { setTimeout(() => { _phase3PaseSaving = false; }, 260); }
};

// Boot the app — runs auth, theme, draft restore, racha, etc.
initApp();
