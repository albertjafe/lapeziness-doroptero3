// ─── DATA ───────────────────────────────────────────────────────────────────

const DB_KEY = 'alberto_piano_v2';
// Auth & sync globals — declared with var to avoid TDZ errors
var _authMode = 'login';
var _sbClient = null;
var _saveTimeout = null;
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

function saveData() {
  // 1. Save to localStorage immediately (always works offline)
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  // 2. Debounced save to Supabase
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(function() { syncToCloud(); }, 1500);
}

async function syncToCloud() {
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    showSyncIndicator('↑ guardando…');
    const { error } = await sb.from('user_data').upsert({
      id: user.id,
      data: db,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    showSyncIndicator('✓ guardado');
  } catch(e) {
    showSyncIndicator('⚠ sin conexión');
  }
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
            await sb.from('user_data').upsert({
              id: user.id,
              data: localDb,
              updated_at: new Date().toISOString()
            });
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
    let useCloud = true;
    if (localRaw) {
      try {
        const local = JSON.parse(localRaw);
        const localDate = local._savedAt ? new Date(local._savedAt).getTime() : 0;
        // Only use local if it's more than 60 seconds newer (avoid race conditions)
        useCloud = cloudDate >= (localDate - 60000);
      } catch(e) {}
    }

    if (useCloud) {
      db = data.data;
      db._savedAt = data.updated_at;
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      showSyncIndicator('✓ sincronizado');
      return true;
    }

    // Local is newer — upload it
    showSyncIndicator('↑ local más reciente, subiendo…');
    await sb.from('user_data').upsert({
      id: user.id,
      data: db,
      updated_at: new Date().toISOString()
    });
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
    registro: []
  };
}

let db = loadData();
if (!db.sesiones) db.sesiones = [];
if (!db.eventos) db.eventos = [];
if (!db.obras) db.obras = [];
if (!db.forestPlants) db.forestPlants = [];
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

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  const btns = document.querySelectorAll('.nav-btn');
  const names = ['session','cronometro','obras','calendario','historial'];
  const idx = names.indexOf(name);
  if (idx >= 0) btns[idx].classList.add('active');
  // Modo concentración: activar/desactivar al entrar/salir de cronometro
  if (name !== 'cronometro' && typeof cronoOnLeaveView === 'function') cronoOnLeaveView();
  if (name === 'session')    { renderRacha(); if (typeof refreshConcentradoUI === 'function') refreshConcentradoUI(); }
  if (name === 'cronometro') { cronoOnEnterView(); }
  if (name === 'obras')      renderObras();
  if (name === 'pasajes')    renderPasajesGlobal();
  if (name === 'pases')      renderPases();
  if (name === 'calendario') renderCalendario();
  if (name === 'historial')  { renderSesionesHistorial(); renderEficienciaSection(); renderEstadoSection(); }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2000);
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
  if (overlay.parentNode !== document.body) {
    overlay._originalParent = overlay.parentNode;
    overlay._originalNext = overlay.nextSibling;
    document.body.appendChild(overlay);
  }
  overlay.classList.add('visible');
  // Bloquear scroll del body para que el fondo no se desplace y el modal
  // quede correctamente centrado en el viewport
  document.body.classList.add('modal-open');
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
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  document.getElementById('headerDate').textContent = `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`;
  // Show nearest upcoming event
  const now = Date.now();
  const proxEvento = (db.eventos || [])
    .filter(ev => new Date(ev.fecha) > now)
    .sort((a,b) => new Date(a.fecha) - new Date(b.fecha))[0];
  const headerSub = document.getElementById('packNameHeader');
  if (proxEvento) {
    const dias2 = Math.ceil((new Date(proxEvento.fecha) - now) / 86400000);
    headerSub.textContent = proxEvento.nombre + ' · ' + dias2 + 'd';
  } else {
    headerSub.textContent = '';
  }
}

// ─── SESSION ─────────────────────────────────────────────────────────────────

let selectedEnergy = 'normal';
let selectedTime = 2;
// Estado diario: bienestar (fusión de energía/calma) + sueño.
// Para retrocompatibilidad con código antiguo que lee .energia/.claridad,
// los exponemos como alias en el getter de actualización.
let estadoDiario = { bienestar: 70, sueno: 70, energia: 70, claridad: 70 };
const ESTADO_COLORS = { bienestar: '#c8a030', sueno: '#a090e0', energia: '#c8a030', claridad: '#e08898' };

// Persiste estadoDiario en localStorage con marca de fecha.
// La fecha permite que al cambiar de día el estado se reinicie a defaults
// (70/70) en lugar de heredar el del día anterior.
function saveEstadoDiario() {
  try {
    const todayStr = new Date().toDateString();
    const payload = {
      date: todayStr,
      bienestar: estadoDiario.bienestar,
      sueno: estadoDiario.sueno,
      // Alias retrocompatibles
      energia: estadoDiario.bienestar,
      claridad: estadoDiario.bienestar,
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
  sesion.estado = {
    bienestar: estadoDiario.bienestar,
    sueno: estadoDiario.sueno,
    energia: estadoDiario.bienestar,
    claridad: estadoDiario.bienestar,
  };
}

// Carga el estado diario priorizando la fuente más fresca:
// 1) db.estadoDiario (de nube — Supabase ya cargó db cuando llegamos aquí)
// 2) localStorage (caché local)
// 3) defaults (70/70)
// Solo se considera válido si el campo `date` es hoy. En otro caso, defaults.
function loadEstadoDiarioFromSources() {
  const todayStr = new Date().toDateString();
  // 1) db (la nube, si ya está cargada)
  if (db && db.estadoDiario && db.estadoDiario.date === todayStr) {
    const e = db.estadoDiario;
    if (typeof e.bienestar === 'number') estadoDiario.bienestar = e.bienestar;
    if (typeof e.sueno === 'number')     estadoDiario.sueno = e.sueno;
    estadoDiario.energia = estadoDiario.bienestar;
    estadoDiario.claridad = estadoDiario.bienestar;
    return true;
  }
  // 2) localStorage
  try {
    const saved = JSON.parse(localStorage.getItem('alberto_estado_v1') || 'null');
    if (saved && saved.date === todayStr) {
      if (typeof saved.bienestar === 'number') estadoDiario.bienestar = saved.bienestar;
      if (typeof saved.sueno === 'number')     estadoDiario.sueno = saved.sueno;
      estadoDiario.energia = estadoDiario.bienestar;
      estadoDiario.claridad = estadoDiario.bienestar;
      return true;
    } else if (saved && !saved.date && typeof saved.energia === 'number') {
      // Migración: formato antiguo sin date
      Object.assign(estadoDiario, saved);
      if (estadoDiario.bienestar == null && estadoDiario.energia != null && estadoDiario.claridad != null) {
        estadoDiario.bienestar = Math.round((estadoDiario.energia + estadoDiario.claridad) / 2);
      }
      return true;
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
  // Fallback based on current theme
  var t = document.documentElement.getAttribute('data-theme') || 'cozy';
  return (t === 'noche' || t === 'estudio') ? '#2a2520' : '#e8ddd0';
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
  estadoDiario[dim] = n;
  // Mantener alias retrocompat: bienestar refleja energia y claridad a la vez
  if (dim === 'bienestar') {
    estadoDiario.energia = n;
    estadoDiario.claridad = n;
  }
  const valEl = document.getElementById('estval-' + dim);
  if (valEl) { valEl.textContent = val; }
  const slider = document.getElementById('est-' + dim);
  fillEstadoSlider(slider, ESTADO_COLORS[dim]);
  // alias para algoritmo de sesión
  const ref = (estadoDiario.bienestar != null)
    ? estadoDiario.bienestar
    : Math.round((estadoDiario.energia + estadoDiario.claridad) / 2);
  selectedEnergy = ref >= 65 ? 'alta' : ref >= 35 ? 'normal' : 'baja';
  // Persistir cada cambio (debounce ligero para no martillear al arrastrar)
  clearTimeout(updateEstado._t);
  updateEstado._t = setTimeout(() => {
    saveEstadoDiario();
    // También actualizar la sesión de hoy en db.sesiones para que la gráfica
    // de historial muestre los datos correctos.
    if (typeof autoSaveTodayPlan === 'function') autoSaveTodayPlan();
  }, 250);
}

function initEstadoSliders() {
  // Migración: si solo tiene energia/claridad antiguos, generar bienestar.
  if (estadoDiario.bienestar == null) {
    const e = estadoDiario.energia != null ? estadoDiario.energia : 70;
    const c = estadoDiario.claridad != null ? estadoDiario.claridad : 70;
    estadoDiario.bienestar = Math.round((e + c) / 2);
  }
  // Asegurar alias siempre sincronizados con bienestar
  estadoDiario.energia = estadoDiario.bienestar;
  estadoDiario.claridad = estadoDiario.bienestar;
  ['bienestar','sueno'].forEach(dim => {
    const slider = document.getElementById('est-' + dim);
    const valEl  = document.getElementById('estval-' + dim);
    if (!slider) return;
    slider.value = estadoDiario[dim];
    if (valEl) valEl.textContent = estadoDiario[dim];
    slider.style.color = ESTADO_COLORS[dim];
    fillEstadoSlider(slider, ESTADO_COLORS[dim]);
  });
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
    if (it.destello) { groups[planIdKey].destello = true; groups[planIdKey].destelloNota = it.destelloNota || groups[planIdKey].destelloNota || null; }
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
    if (g.destello) sessionDestello[planId] = { on: true, nota: g.destelloNota || '' };
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
      solRating: sessionSolRatings[planId] || null,
      rating: sessionProductivityRatings[planId] != null ? sessionProductivityRatings[planId] : null,
      note: document.getElementById('tnote-' + planId)?.value || '',
      destello: sessionDestello[planId]?.on ? true : false,
      destelloNota: sessionDestello[planId]?.nota || null,
      objetivo: ''
    };
  });
  // Solo registrar solHistory cuando la sesión es para HOY — si se está
  // backdateando un día pasado, no queremos pintar registros de solidez con
  // la fecha equivocada.
  const isToday = targetDate.toDateString() === new Date().toDateString();
  if (isToday) {
    items.forEach(it => {
      if (it.tick === 'hecho' && it.solRating != null) {
        if (it.movId) recordMovSolHistory(it.obraId, it.movId, it.solRating, 'sesion');
        else recordSolHistory(it.obraId, it.solRating, 'sesion');
      }
    });
  }

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
  } else {
    // Primer guardado en esa fecha — capturamos snapshot de los sliders actuales
    const allRatings = items.filter(i => i.rating != null).map(i => i.rating);
    const avgRating = allRatings.length
      ? Math.round(allRatings.reduce((s,v)=>s+v,0) / allRatings.length)
      : null;
    const sesionObj = {
      date: targetDate.toISOString(),
      energia: selectedEnergy,
      estado: { ...estadoDiario },
      rating: avgRating,
      items
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

// Activa/atenúa el campo de nota del destello según la casilla "guardar destello".
function toggleHechoDestello(on) {
  const nota = document.getElementById('hechoDestelloNota');
  const box = document.getElementById('hechoDestelloBox');
  if (nota) nota.disabled = !on;
  if (box) box.classList.toggle('off', !on);
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
    // ★ Resetear sliders de estado a defaults (Bienestar/Sueño = 70).
    // Los sliders sólo persisten DURANTE el día.
    estadoDiario.bienestar = 70;
    estadoDiario.sueno = 70;
    estadoDiario.energia = 70;
    estadoDiario.claridad = 70;
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
  if (!obraId || !startedAt || !endedAt) return;
  if (!Array.isArray(db.sessionPlants)) db.sessionPlants = [];
  // Dedup defensivo: si ya existe una entrada con el mismo startedAt+obraId,
  // no la duplicamos. Improbable pero protege contra dobles llamadas.
  const exists = db.sessionPlants.some(p =>
    p.obraId === obraId && p.startedAt === startedAt
  );
  if (exists) return;
  const entry = {
    obraId,
    movId: movId || null,
    startedAt,
    endedAt,
    mins: Math.max(0, Math.floor(mins || 0)),
    source: 'app',
  };
  // Si la sesión es fallida (<10 min, abortada), marcarla como tal. Esto
  // permite distinguir en estadísticas las sesiones exitosas de las fallidas.
  if (opts && opts.failed) entry.failed = true;
  db.sessionPlants.push(entry);
  // Mantener orden cronológico
  db.sessionPlants.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
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
        startedAt: firstStartedAt,
        endedAt: lastEndedAt,
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
      estado: {
        bienestar: estadoDiario.bienestar,
        sueno: estadoDiario.sueno,
        // Alias retrocompat para código viejo que lea energia/claridad
        energia: estadoDiario.bienestar,
        claridad: estadoDiario.bienestar,
      },
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
}


// ── EXTRA OBRAS ───────────────────────────────────────────────────────────────

function openAddExtra() {
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
    if (!existing._isExtra) {
      // Tarjeta planificada: reemplazar la estimación por el tiempo real.
      sessionMinPlan[targetPlanId] = addMin;
      existing._isExtra = true;
    } else {
      sessionMinPlan[targetPlanId] = (sessionMinPlan[targetPlanId] || 0) + addMin;
    }
    // Re-render la tarjeta con el total actualizado
    const planEl = document.getElementById('plan-' + targetPlanId);
    if (planEl) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderExtraItem(existing, sessionMinPlan[targetPlanId]);
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

function recordSolHistory(obraId, val, context) {
  const obra = findObra(obraId);
  if (!obra || !val) return;
  if (!obra.solHistory) obra.solHistory = [];
  const today = new Date().toDateString();
  const last = obra.solHistory[0];
  if (last && new Date(last.date).toDateString() === today && last.context === context) {
    obra.solHistory[0] = { date: new Date().toISOString(), val: parseInt(val), context };
  } else {
    obra.solHistory.unshift({ date: new Date().toISOString(), val: parseInt(val), context });
    if (obra.solHistory.length > 80) obra.solHistory = obra.solHistory.slice(0, 80);
  }
  obra.sol = parseInt(val);
  saveData();
}

function recordEscHistory(obraId, val, context) {
  const obra = findObra(obraId);
  if (!obra || !val) return;
  if (!obra.escHistory) obra.escHistory = [];
  const today = new Date().toDateString();
  const last = obra.escHistory[0];
  if (last && new Date(last.date).toDateString() === today && last.context === context) {
    obra.escHistory[0] = { date: new Date().toISOString(), val: parseInt(val), context };
  } else {
    obra.escHistory.unshift({ date: new Date().toISOString(), val: parseInt(val), context });
    if (obra.escHistory.length > 80) obra.escHistory = obra.escHistory.slice(0, 80);
  }
  obra.esc = parseInt(val);
  saveData();
}

function linkPaseToHistory(obraId, score, tipo) {
  // Pase scores are 1-10, convert to 0-100 for solHistory
  const pct = Math.round((score - 1) / 9 * 100);
  if (tipo === 'informal' || tipo === 'solo') recordSolHistory(obraId, pct, 'pase-' + tipo);
  if (tipo === 'escena' || tipo === 'concierto') {
    recordEscHistory(obraId, pct, 'pase-escena');
    const obra = findObra(obraId);
    if (obra && pct > (obra.solHistory?.[0]?.val || 0)) recordSolHistory(obraId, pct, 'pase-escena');
  }
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
    h.context === 'pase-escena' || h.context === 'pase-concierto'
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
    el.innerHTML = '<div class="efic-widget"><div class="efic-header"><div><div class="efic-title">Evolución del aprendizaje</div><div class="efic-subtitle">Análisis de eficiencia normalizada por dificultad</div></div></div>' +
      '<div class="efic-trend nodatos">📊 Necesitas <strong>' + faltan + ' obra' + (faltan!==1?'s':'') + ' completada' + (faltan!==1?'s':'') + '</strong> más con compases para activar este análisis.' +
      (datos.length > 0 ? '<br>Ya tienes ' + datos.length + ' obra completada.' : '<br>Completa obras con compas actual = total.') + '</div></div>';
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

  el.innerHTML = '<div class="efic-widget"><div class="efic-header"><div><div class="efic-title">Evolución del aprendizaje</div><div class="efic-subtitle">Eficiencia normalizada por dificultad y extensión</div></div><div style="font-size:8px;color:var(--text3);text-align:right">' + datos.length + ' obras analizadas</div></div><div class="efic-kpis">' + kpisHtml + '</div>' + interpHtml + svgHtml + '<div style="font-size:8px;color:var(--text3);letter-spacing:0.1em;text-transform:uppercase;margin:10px 0 5px">Obras (menor = más eficiente)</div>' + obrasHtml + '</div>';
}

// ── FOREST IMPORT ─────────────────────────────────────────────────────────────

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

function solPctColor(pct) {
  if (pct >= 85) return 'var(--green)';
  if (pct >= 60) return '#8aaa30';
  if (pct >= 40) return 'var(--accent)';
  if (pct >= 20) return 'var(--orange)';
  return 'var(--red)';
}

function solPctLabel(pct) {
  if (pct >= 90) return 'Dominada · fluye sola';
  if (pct >= 75) return 'Sólida · algún fallo menor';
  if (pct >= 60) return 'Construyendo · varios fallos';
  if (pct >= 40) return 'Frágil · muchos fallos';
  if (pct >= 20) return 'Inicio de consolidación';
  return 'Sin solidez aún';
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
  _hechoCompasStep = 0;
  _memLapseYes = false;
  _memPasajeSelected = null;
  _paseAntesActive = false;
  _paseDespuesActive = false;
  _pasajeWork = {};

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
  const showPases = !isActividad && (fase === 'consolidando' || fase === 'mantenimiento');
  const showPasajes = !isActividad;

  // Title
  const obraTitle = obra ? obra.name + (obra.composer ? ' · ' + obra.composer : '') : '';
  const nameEl = document.getElementById('hechoObraName');
  if (movId && entity) {
    nameEl.innerHTML = '<span style="font-size:12px;color:var(--text3)">' + obraTitle + '</span><br><span>' + entity.name + '</span>';
  } else {
    nameEl.textContent = obraTitle;
  }

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

  document.getElementById('hechoNota').value = document.getElementById('tnote-' + planId)?.value || '';

  // Reset destello box, then init productivity slider (que decide si se muestra).
  const destBox = document.getElementById('hechoDestelloBox');
  const destChk = document.getElementById('hechoDestelloChk');
  const destNotaEl = document.getElementById('hechoDestelloNota');
  if (destBox) { destBox.style.display = 'none'; destBox.classList.remove('on'); }
  if (destChk) destChk.checked = true;
  if (destNotaEl) { destNotaEl.value = ''; destNotaEl.disabled = false; }

  // Initialize productivity slider — restore previous value or default to 70
  const prevProd = sessionProductivityRatings[planId];
  const prodInit = (prevProd != null) ? prevProd : 70;
  const prodSlider = document.getElementById('hechoProdSlider');
  if (prodSlider) { prodSlider.value = prodInit; }
  if (typeof updateHechoProd === 'function') updateHechoProd(prodInit);

  // Restaurar un destello previamente guardado para este planId (nota + casilla).
  const prevDest = sessionDestello[planId];
  if (prevDest && destBox) {
    if (destChk) destChk.checked = !!prevDest.on;
    if (destNotaEl) destNotaEl.value = prevDest.nota || '';
    if (prevDest.on || (prevDest.nota || '').length) {
      destBox.style.display = 'block';
      requestAnimationFrame(() => destBox.classList.add('on'));
    }
    toggleHechoDestello(destChk ? destChk.checked : true);
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
      // Marcar planId para animar resumen y disparar flash AHORA
      _cronoLastAddedPlanId = _hechoPlanId;
      showCronoHechoFlash();
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
  const nota = document.getElementById('hechoNota').value.trim();

  // Store minutes and notes
  const minInp = document.getElementById('tmin-' + planId);
  if (minInp && minutos) { minInp.value = minutos; minInp._touched = true; }
  const noteInp = document.getElementById('tnote-' + planId);
  if (noteInp && nota) noteInp.value = nota;

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
    if (_paseAntesActive) {
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
    if (_paseDespuesActive) {
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
  if (destOn) sessionDestello[planId] = { on: true, nota: destNota };
  else delete sessionDestello[planId];

  // Capture productivity rating from the embedded slider.
  // Si esta es una sub-sesión (tarjeta fusionada), añadimos esta sub-sesión al
  // agregado y la productividad final es media ponderada por minutos.
  const prodVal = parseInt(document.getElementById('hechoProdSlider')?.value);
  if (!isNaN(prodVal)) {
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
    delete sessionAggregate[planId]._pendingTimes;

    // Snapshot de pases/memoria de ESTA apertura del modal, para poder
    // reabrir la tarjeta y editar tras varias sub-sesiones.
    const subPases = {};
    if (_paseAntesActive) {
      subPases.antes = parseInt(document.getElementById('paseAntesSlider')?.value || 50);
      const n = document.getElementById('paseAntesNota')?.value.trim();
      if (n) subPases.notaAntes = n;
    }
    if (_paseDespuesActive) {
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
      destello: destOn,
      destelloNota: destOn ? destNota : null,
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
      // Preservar min/startedAt/endedAt/timestamp de la previa; sobrescribir
      // pasajes, pases, prod con los nuevos valores editados.
      previous.pasajes = justAdded.pasajes;
      previous.pases = justAdded.pases;
      previous.prod = justAdded.prod;
      previous.destello = justAdded.destello;
      previous.destelloNota = justAdded.destelloNota;
    }

    // Productividad ponderada
    const weighted = aggregateWeightedProd(planId);
    sessionProductivityRatings[planId] = weighted != null ? weighted : prodVal;
  }

  saveDraft();
  SFX.tick();
  // Show rating badge on the plan item, and ensure save button visible
  updateProductivityBadge(planId);
  if (typeof ensureSessionPlanScaffold === 'function') ensureSessionPlanScaffold();
  // El flash de "Hecho" y la marca de planId nuevo se disparan al INICIO de
  // closeHechoDatos para que el backdrop difuminado del modal nunca se rompa.
  refreshConcentradoUI();
  autoSaveTodayPlan();
  // Refrescar el render de eventos: el pase que acabamos de guardar afecta
  // a la solidez de la obra, y por tanto a la "preparación" del evento que
  // la incluye. Si el usuario va al calendario después, debe ver el valor
  // actualizado. (Antes la preparación se calculaba al renderizar pero el
  // render no se disparaba tras pase, así que parecía no actualizarse).
  if (typeof renderCalendario === 'function') {
    try { renderCalendario(); } catch(e) {}
  }
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
    flash.innerHTML =
      '<div class="crono-hecho-flash-inner">' +
        '<div class="cf-badge">' +
          '<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<path class="cf-check" d="M 17 31 L 26 40 L 43 22"/>' +
          '</svg>' +
        '</div>' +
        '<div class="crono-hecho-flash-text">Hecho</div>' +
      '</div>';
    document.body.appendChild(flash);
  }
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
  const diffEl = document.getElementById('tickmin-diff-' + planId);
  if (!input || !diffEl) return;
  input._touched = true;
  const real = parseInt(input.value), diff = real - minPlan;
  if (!real || !minPlan) { diffEl.textContent = ''; return; }
  diffEl.textContent = diff > 0 ? '+' + diff + 'min' : diff < 0 ? diff + 'min' : '= exacto';
  diffEl.style.color = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--orange)' : 'var(--text3)';
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
function recordMovSolHistory(obraId, movId, val, context) {
  const mov = findMovimiento(obraId, movId);
  if (!mov || val == null) return;
  if (!mov.solHistory) mov.solHistory = [];
  const today = new Date().toDateString();
  const last = mov.solHistory[0];
  if (last && new Date(last.date).toDateString() === today && last.context === context) {
    mov.solHistory[0] = { date: new Date().toISOString(), val: parseInt(val), context };
  } else {
    mov.solHistory.unshift({ date: new Date().toISOString(), val: parseInt(val), context });
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

  let obras = db.obras || [];
  if (filtroActual) {
    const ev = db.eventos.find(e => e.id === filtroActual);
    if (ev) obras = obras.filter(o => ev.obras.includes(o.id));
  }

  if (!obras.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:11px;padding:20px 0">No hay obras. Añade una.</div>';
    return;
  }
  list.innerHTML = obras.map((o, idx) => renderObraCard(o, idx)).join('');
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
        <button class="obra-quick-btn edit" title="Editar nombre" onclick="event.stopPropagation();openEditObraNombre('${o.id}')">✎</button>
        <button class="obra-quick-btn delete" title="Eliminar actividad" onclick="event.stopPropagation();confirmDeleteObra('${o.id}')">✕</button>
      </div>
    </div>
  `;
}

function renderObraCard(o, idx) {
  // ── ACTIVIDADES: render simplificado ────────────────────────────────
  if (o.tipo === 'actividad') {
    return renderActividadCard(o, idx);
  }
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

  const origenTag = '';

  const tipoIcons = { solo: 'solo', informal: 'amigos', escena: '🎭', tecnico: 'tec', memoria: 'mem', concierto: '🎭' };
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

  // Urgencia block (shared)
  const urgBlock = (() => {
    const urg = computeUrgencia(o.id);
    if (urg.nivel === 'sin-evento') return '<div style="font-size:9px;color:var(--text3);margin-top:8px">Sin evento asignado en calendario</div>';
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

  return `
    <div class="obra-card" id="obra-${o.id}">
      <div class="obra-header" onclick="toggleObra('${o.id}')">
        <button class="obra-color-dot obra-fase-${obraFase(eff)}" title="Cambiar color"
          onclick="event.stopPropagation();openObraColorPicker('${o.id}')"
          style="background:${obraColorHex(o) || 'transparent'};border-color:${obraColorHex(o) || 'var(--border2)'}"></button>
        <div class="obra-name" id="obra-name-display-${o.id}">${o.name}${origenTag}${difBadge}${tendencia} <span class="obra-composer">${o.composer}</span></div>
        <div class="obra-scores">
          ${durDisplay ? `<span style="font-size:9px;color:var(--text3)">${durDisplay}m</span>` : ''}
          ${hasMovs ? `<span style="font-size:8px;color:var(--accent);background:var(--bg3);border-radius:3px;padding:1px 5px;margin-left:2px">${o.movimientos.length} mov</span>` : ''}
        </div>
        <button class="obra-quick-btn edit" title="Editar nombre" onclick="event.stopPropagation();openEditObraNombre('${o.id}')">✎</button>
        <button class="obra-quick-btn delete" title="Eliminar obra" onclick="event.stopPropagation();confirmDeleteObra('${o.id}')">✕</button>
        <div class="obra-chevron">▼</div>
      </div>
      <div class="obra-detail">

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

        <!-- Movimientos -->
        ${movimientosHtml}
        ${renderMinutosWidget(o.id)}
        ${renderRangoWidget(o.id, o)}
        ${renderDecayWidget(o.id)}

        <!-- Pase (solo si no hay movimientos): solo historial visible -->
        ${!hasMovs ? `
          <div style="margin:10px 0 4px">
            <div class="last-pase">${lastPaseText}</div>
            ${paseHistHtml ? `<div style="margin-top:8px">${paseHistHtml}</div>` : ''}
          </div>` : ''}

        <!-- Pasajes -->
        <div class="pasajes-section">
          <div id="pasajes-${o.id}">${pasajosHtml}</div>
          <button class="add-pasaje-btn" onclick="addPasaje('${o.id}')">+ añadir pasaje</button>
        </div>

        ${urgBlock}
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
  // Re-render global pasajes view if active
  if (document.getElementById('view-pasajes').classList.contains('active')) renderPasajesGlobal();
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

  const tipoIcons = { solo: 'solo', informal: 'amigos', escena: '🎭', tecnico: 'tec', memoria: 'mem', concierto: '🎭' };
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

function addMovimiento(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  if (!obra.movimientos) obra.movimientos = [];
  const id  = 'mv' + Date.now();
  const num = obra.movimientos.length + 1;
  obra.movimientos.push({
    id, name: `Movimiento ${num}`,
    duracion: null, dificultad: obra.dificultad || 3,
    apr: obra.apr || 1, sol: obra.sol || 1, esc: obra.esc || 1,
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
  const aprChk = document.getElementById('newObraAprendida');
  if (aprChk) aprChk.checked = false;
  modalFaseSelected = 'digitando';
  document.querySelectorAll('#modalFaseSelector .fase-btn').forEach(b => {
    b.classList.remove('active');
    if (b.classList.contains('digitando')) b.classList.add('active');
  });
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
  }
}

function addObra() {
  const name = document.getElementById('newObraName').value.trim();
  const composer = document.getElementById('newObraComposer').value.trim();
  if (!name) { showToast('Escribe el nombre'); return; }
  if (!db.obras) db.obras = [];
  const newId = 'o' + Date.now();
  const isActividad = modalTipoSelected === 'actividad';
  const yaAprendida = !isActividad && !!document.getElementById('newObraAprendida')?.checked;
  const entry = {
    id: newId,
    name,
    composer: isActividad ? '' : (composer || '—'),
    // Las actividades no tienen fase de aprendizaje, dificultad ni duración;
    // tampoco origen "nueva/recuperación". Sólo nombre y tiempo.
    tipo: isActividad ? 'actividad' : 'obra',
    // Si se marca "ya me la sé", nace aprendida (consolidando) en vez de
    // aprendiendo-inicial. Los compases se pueden añadir después.
    estado: isActividad ? null : (yaAprendida ? 'consolidando' : 'aprendiendo-inicial'),
    origen: null,
    dificultad: isActividad ? null : 3,
    duracion: null,
    apr: isActividad ? null : (yaAprendida ? 10 : 1),
    sol: isActividad ? null : 1,
    esc: isActividad ? null : 1,
    lastPase: null,
    pasajes: [],
    notes: '',
  };
  db.obras.push(entry);
  saveData();
  closeModal('modalAddObra');
  renderObras();
  showToast(isActividad ? 'Actividad añadida ✓' : 'Obra añadida ✓');
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
  if (nameEl) nameEl.placeholder = 'título';
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
  if (pct >= 60) return '#8aaa30';
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
    list.innerHTML = '<div class="cal-empty">No hay eventos próximos.<br>Añade un concurso, concierto, grabación o clase.</div>';
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
      <input type="checkbox" value="${o.id}" ${selectedIds.includes(o.id) ? 'checked' : ''}>
      <div class="obra-fase ${o.fase}" style="width:7px;height:7px;border-radius:50%;flex-shrink:0"></div>
      <span class="obra-check-name">${o.name}</span>
      <span class="obra-check-composer">${o.composer}</span>
    </label>`).join('');
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

// Shared SVG builder — called from inline section and from the full-screen modal.
function _buildEstadoChartSvg(W, H, sesiones) {
  const pad = { l: 28, r: 12, t: 12, b: 30 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  const minT = new Date(sesiones[0].date).getTime();
  const maxT = new Date(sesiones[sesiones.length-1].date).getTime();
  const rangeT = maxT - minT || 1;
  const xOf = t => pad.l + ((t - minT) / rangeT) * cW;
  const yOf = v => pad.t + cH - (Math.max(0, Math.min(100, v)) / 100) * cH;

  // Grid
  const gridY = [0, 25, 50, 75, 100].map(v => {
    const y = yOf(v);
    return '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W-pad.r) + '" y2="' + y
      + '" stroke="var(--border2)" stroke-width="' + (v === 50 ? 1 : 0.5) + '" stroke-dasharray="2,3"/>'
      + '<text x="' + (pad.l-3) + '" y="' + (y+3) + '" text-anchor="end" font-size="6.5" fill="var(--text3)">' + v + '</text>';
  }).join('');

  const dims = [
    { key: 'bienestar', color: '#c8a030', label: 'Bienestar', src: 'estado' },
    { key: 'sueno',     color: '#a090e0', label: 'Sueño',     src: 'estado' },
    { key: 'rating',    color: '#e07060', label: 'Sesión',    src: 'root'   },
  ];

  const lines = dims.map(d => {
    const pts = sesiones
      .filter(s => d.src === 'root' ? s.rating != null : true)
      .map(s => {
        let val;
        if (d.src === 'root') {
          val = s.rating;
        } else if (d.key === 'bienestar') {
          if (typeof s.estado?.bienestar === 'number') val = s.estado.bienestar;
          else if (typeof s.estado?.energia === 'number' && typeof s.estado?.claridad === 'number') {
            val = Math.round((s.estado.energia + s.estado.claridad) / 2);
          } else val = 50;
        } else {
          val = s.estado?.[d.key] || 50;
        }
        return { x: xOf(new Date(s.date).getTime()), y: yOf(val), val, date: s.date };
      });
    if (pts.length < 2) return '';
    const pathD = pts.map((p,i) => (i===0?'M':'L') + p.x + ',' + p.y).join(' ');
    const dotsHtml = pts.map(p =>
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" fill="' + d.color + '" stroke="var(--bg2)" stroke-width="1" opacity="0.85">'
      + '<title>' + d.label + ': ' + p.val + ' · ' + new Date(p.date).toLocaleDateString('es-ES',{day:'numeric',month:'short'}) + '</title></circle>'
    ).join('');
    const dashAttr = d.src === 'root' ? ' stroke-dasharray="5,3"' : '';
    return '<path d="' + pathD + '" fill="none" stroke="' + d.color + '" stroke-width="1.8" stroke-linejoin="round" opacity="0.85"' + dashAttr + '/>' + dotsHtml;
  }).join('');

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
      return '<text x="' + xOf(t) + '" y="' + (H-5) + '" text-anchor="middle" font-size="6.5" fill="var(--text3)">' + lbl + '</text>';
    }).join('');

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">'
    + gridY + lines + xLabels + '</svg>';
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
    .filter(s => s.estado && (typeof s.estado.bienestar === 'number' || typeof s.estado.energia === 'number'))
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
    .filter(s => s.estado && (typeof s.estado.bienestar === 'number' || typeof s.estado.energia === 'number'))
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

  // Detect pattern: cycles of low BIENESTAR.
  let patternNote = '';
  const bienestarSeries = sesionesConEstado.map(s => {
    if (typeof s.estado?.bienestar === 'number') return s.estado.bienestar;
    if (typeof s.estado?.energia === 'number' && typeof s.estado?.claridad === 'number') {
      return Math.round((s.estado.energia + s.estado.claridad) / 2);
    }
    return 50;
  });
  const dips = [];
  for (let i = 1; i < bienestarSeries.length-1; i++) {
    if (bienestarSeries[i] < 40 && bienestarSeries[i-1] >= 40) dips.push(i);
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
      + '📊 Ciclo detectado: bajón de bienestar cada ~<strong style="color:var(--accent)">' + avgCycle + ' días</strong> de media'
      + ' (' + dips.length + ' bajones registrados). Con más datos se afinará.</div>';
  } else if (sesionesConEstado.length >= 5) {
    patternNote = '<div style="font-size:9px;color:var(--text3);margin-top:6px">Registra más sesiones para detectar tu ciclo de bienestar.</div>';
  }

  // Dims definition (shared with helper — duplicated here for avgBlock)
  const _statDims = [
    { key: 'bienestar', color: '#c8a030', label: 'Bienestar', src: 'estado' },
    { key: 'sueno',     color: '#a090e0', label: 'Sueño',     src: 'estado' },
    { key: 'rating',    color: '#e07060', label: 'Sesión',    src: 'root'   },
  ];
  const recent = sesionesConEstado.slice(-7);
  const avgBlock = _statDims.map(d => {
    const vals = recent
      .map(s => {
        if (d.src === 'root') return s.rating;
        if (d.key === 'bienestar') {
          if (typeof s.estado?.bienestar === 'number') return s.estado.bienestar;
          if (typeof s.estado?.energia === 'number' && typeof s.estado?.claridad === 'number') {
            return Math.round((s.estado.energia + s.estado.claridad) / 2);
          }
          return null;
        }
        return s.estado?.[d.key];
      })
      .filter(v => v != null);
    if (!vals.length) return '';
    const avg = Math.round(vals.reduce((s,v)=>s+v,0)/vals.length);
    return '<div style="text-align:center;flex:1">'
      + '<div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;color:' + d.color + '">' + avg + '</div>'
      + '<div style="font-size:7px;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em">' + d.label + '</div>'
      + '</div>';
  }).join('');

  const legend = _statDims.map(d => '<span style="color:' + d.color + '">— ' + d.label + '</span>').join(' ');

  el.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:14px 16px">'
    + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">'
    + '<div><div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;color:var(--accent);font-weight:300">Estado diario</div>'
    + '<div style="font-size:8px;color:var(--text3);letter-spacing:0.1em;text-transform:uppercase">Últimas ' + sesionesConEstado.length + ' sesiones registradas</div></div>'
    + '<div style="display:flex;align-items:center;gap:10px">'
    + '<div style="font-size:8px;color:var(--text3)">Media 7d</div>'
    + '<button onclick="openEstadoChartModal()" style="font-family:\'JetBrains Mono\',monospace;font-size:8px;padding:3px 9px;background:transparent;border:1px solid var(--border2);border-radius:5px;color:var(--text3);cursor:pointer">↗ ampliar</button>'
    + '</div></div>'
    + '<div style="display:flex;gap:4px;margin-bottom:12px">' + avgBlock + '</div>'
    + _buildEstadoChartSvg(340, 160, sesionesConEstado)
    + '<div style="font-size:7px;color:var(--text3);display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;padding-left:28px">' + legend + '</div>'
    + patternNote
    + '</div>';
}

function renderSesionesHistorial() {
  const el = document.getElementById('sesionesHistorial');
  if (!db.sesiones || !db.sesiones.length) {
    el.innerHTML = '<div class="sesion-hist-empty">Aún no hay sesiones guardadas.<br>Genera una sesión, márcala con ticks y pulsa Guardar.</div>';
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
let paseQualitySelected = null; // now a number 1-10
let paseTipoSelected = 'tecnico';

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
  row.innerHTML = [1,2,3,4,5,6,7,8,9,10].map(n =>
    `<button class="pscore-modal-btn" onclick="selectPaseQ(${n},this)">${n}</button>`
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
  document.querySelectorAll('.pase-tipo-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.pase-tipo-btn.solo').classList.add('active');
  openModal('modalPaseQuality');
}

function selectPaseTipo(tipo, btn) {
  paseTipoSelected = tipo;
  document.querySelectorAll('.pase-tipo-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active', tipo);
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
  const tipo = paseTipoSelected || 'tecnico';
  const quality = scoreToQuality(paseQualitySelected);
  const paseEntry = { date: paseDate, score: paseQualitySelected, quality, tipo, note };

  if (paseQualityMovId) {
    const mov = findMovimiento(paseQualityObraId, paseQualityMovId);
    if (!mov) { closeModal('modalPaseQuality'); return; }
    mov.lastPase = paseEntry.date;
    if (!mov.paseHistory) mov.paseHistory = [];
    mov.paseHistory.unshift(paseEntry);
    if (mov.paseHistory.length > 20) mov.paseHistory = mov.paseHistory.slice(0, 20);
    saveData();
    closeModal('modalPaseQuality');
    showToast('Pase registrado ✓');
    const movCard = document.getElementById('mov-' + paseQualityObraId + '-' + paseQualityMovId);
    if (movCard) {
      const lastSpan = movCard.querySelector('.mov-actions span');
      if (lastSpan) lastSpan.textContent = 'Último pase: ' + new Date(paseEntry.date).toLocaleDateString('es-ES');
      const histDiv = movCard.querySelector('.mov-pase-hist');
      const tipoIcons = { solo: 'solo', informal: 'amigos', escena: '🎭', tecnico: 'tec', memoria: 'mem', concierto: '🎭' };
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
  linkPaseToHistory(paseQualityObraId, paseQualitySelected, tipo);
  saveData();
  closeModal('modalPaseQuality');
  showToast('Pase registrado ✓');
  renderObras();
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

// ─── EDIT OBRA NOMBRE ────────────────────────────────────────────────────────

function openEditObraNombre(obraId) {
  const obra = findObra(obraId);
  if (!obra) return;
  document.getElementById('editObraId').value = obraId;
  document.getElementById('editObraNombreInput').value = obra.name;
  document.getElementById('editObraComposerInput').value = obra.composer === '—' ? '' : (obra.composer || '');
  openModal('modalEditObraNombre');
  setTimeout(() => document.getElementById('editObraNombreInput').focus(), 100);
}

function saveEditObraNombre() {
  const obraId = document.getElementById('editObraId').value;
  const nombre = document.getElementById('editObraNombreInput').value.trim();
  const composer = document.getElementById('editObraComposerInput').value.trim();
  if (!nombre) { showToast('El título no puede estar vacío'); return; }
  const obra = findObra(obraId);
  if (!obra) return;
  obra.name = nombre;
  obra.composer = composer || '—';
  // Update also in sesiones history
  (db.sesiones || []).forEach(s => {
    (s.items || []).forEach(it => {
      if (it.obraId === obraId) it.obraName = nombre;
    });
  });
  saveData();
  closeModal('modalEditObraNombre');
  rerenderObraCard(obraId);
  showToast('Obra actualizada ✓');
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

function setFont(font, btn) {
  document.documentElement.setAttribute('data-font', font);
  localStorage.setItem('alberto_font', font);
  document.querySelectorAll('.font-option').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function setFontSize(size, btn) {
  const zooms = { small: 0.82, normal: 1, large: 1.22, xlarge: 1.5 };
  const z = zooms[size] || 1;
  applyZoom(z);
  localStorage.setItem('alberto_size', size);
  document.querySelectorAll('.size-option').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// Detect iOS Safari (doesn't support CSS zoom)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function applyZoom(z) {
  if (isIOS) {
    const b = document.body;
    b.style.transformOrigin = 'top left';
    if (z === 1) {
      b.style.transform = '';
      b.style.width = '';
      b.style.minHeight = '';
    } else {
      b.style.transform = 'scale(' + z + ')';
      b.style.width = (100 / z).toFixed(3) + '%';
      b.style.minHeight = (100 / z).toFixed(3) + 'vh';
    }
  } else {
    document.documentElement.style.zoom = z;
    document.documentElement.style.fontSize = Math.round(z * 100) + '%';
  }
}

function editHeaderTitle() {
  const el = document.getElementById('headerTitle');
  if (!el) return;
  const current = localStorage.getItem('alberto_app_title') || 'Planificador de estudio';
  const input = document.createElement('input');
  input.value = current;
  input.style.cssText = 'background:transparent;border:none;border-bottom:1px solid var(--border);color:inherit;font:inherit;width:180px;outline:none;text-align:center;padding:0';
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
  const save = () => {
    const val = input.value.trim() || 'Planificador de estudio';
    localStorage.setItem('alberto_app_title', val);
    document.title = val;
    el.textContent = val;
  };
  input.onblur = save;
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { el.textContent = current; } };
}

function loadAppTitle() {
  const saved = localStorage.getItem('alberto_app_title');
  if (saved) {
    const el = document.getElementById('headerTitle');
    if (el) el.textContent = saved;
    document.title = saved;
  }
}

function setTheme(theme, btn) {
  setTimeout(initEstadoSliders, 50); // re-fill after theme color change
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('alberto_theme', theme);
  document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function loadTheme() {
  // Migration v2: noche → cozy
  if (!localStorage.getItem('alberto_theme_v2_migrated')) {
    localStorage.setItem('alberto_theme_v2_migrated', '1');
    if (!localStorage.getItem('alberto_theme') || localStorage.getItem('alberto_theme') === 'noche') {
      localStorage.setItem('alberto_theme', 'cozy');
    }
    if (!localStorage.getItem('alberto_size') || localStorage.getItem('alberto_size') === 'normal') {
      localStorage.setItem('alberto_size', 'large');
    }
  }
  // Migration v3: force cozy default for everyone (one-time reset)
  if (!localStorage.getItem('alberto_theme_v3_migrated')) {
    localStorage.setItem('alberto_theme_v3_migrated', '1');
    localStorage.setItem('alberto_theme', 'cozy');
  }
  const theme = localStorage.getItem('alberto_theme') || 'cozy';
  const font  = localStorage.getItem('alberto_font')  || 'mono';
  const size  = localStorage.getItem('alberto_size')  || 'large';
  const zooms = { small: 0.82, normal: 1, large: 1.22, xlarge: 1.5 };
  const z = zooms[size] || 1;

  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font', font);
  applyZoom(z);

  document.querySelectorAll('.theme-option').forEach(b => {
    b.classList.toggle('active', (b.dataset.theme || '') === theme);
  });
  document.querySelectorAll('.font-option').forEach(b => {
    b.classList.toggle('active', b.dataset.font === font);
  });
  document.querySelectorAll('.size-option').forEach(b => {
    b.classList.toggle('active', b.dataset.size === size);
  });
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

function playTone(freq, type = 'triangle', dur = 0.25, vol = 0.10, delay = 0) {
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
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
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

// Burst de noise filtrado: para clicks de madera, papel, botón.
//   cutoff: frecuencia del paso-bajo (Hz). Más bajo = más sordo/leñoso.
//   q: resonancia del filtro. Sutil bump = "cuerpo".
//   dur: duración. Muy corta = click; corta = tap.
//   vol: pico de amplitud.
//   delay: offset desde "ahora".
function playNoiseBurst(cutoff, q, dur, vol, delay = 0) {
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
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.001);
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
      ].forEach(([f, d, t, dur, v]) => playTone(f, t, dur, v, d));
    },
    tick() {
      playTone(523.3, 'triangle', 0.35, 0.10, 0);
      playTone(262.0, 'triangle', 0.18, 0.04, 0);
    },
    save() {
      playTone(392.0, 'triangle', 0.45, 0.10, 0);
      playTone(523.3, 'triangle', 0.50, 0.10, 0.10);
    },
    saveSession() {
      [[349.2, 0,    'triangle', 0.50, 0.09],
       [392.0, 0.08, 'triangle', 0.45, 0.09],
       [440.0, 0.16, 'triangle', 0.45, 0.09],
       [523.3, 0.26, 'triangle', 0.60, 0.11],
      ].forEach(([f, d, t, dur, v]) => playTone(f, t, dur, v, d));
    },
    skip() {
      playTone(196.0, 'triangle', 0.20, 0.08, 0);
      playTone(185.0, 'triangle', 0.15, 0.04, 0.04);
    },
    open() { playTone(440, 'triangle', 0.18, 0.06, 0); },
    pase() {
      playTone(440.0, 'triangle', 0.30, 0.09, 0);
      playTone(523.3, 'triangle', 0.35, 0.09, 0.12);
    },
    add() {
      playTone(293.7, 'triangle', 0.28, 0.09, 0);
      playTone(369.9, 'triangle', 0.32, 0.09, 0.10);
    },
    del() {
      playTone(369.9, 'triangle', 0.18, 0.07, 0);
      playTone(293.7, 'triangle', 0.18, 0.05, 0.05);
    },
    nav() { playTone(523.3, 'triangle', 0.10, 0.04, 0); },
    memlapse() { playTone(220, 'sine', 0.40, 0.06, 0); },
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
    syncToCloud();
  } else if (document.visibilityState === 'visible') {
    // Came back to foreground — always try to refresh session first
    _restoreSessionIfNeeded();
    // Restore estado sliders
    try {
      const saved = JSON.parse(localStorage.getItem('alberto_estado_v1') || 'null');
      if (saved && typeof saved.energia === 'number') {
        Object.assign(estadoDiario, saved);
        initEstadoSliders();
      }
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

    // 3. Auto-login silencioso con credenciales guardadas
    const creds = _loadStoredCredentials();
    if (creds) {
      showSyncIndicator('↺ reconectando…');
      const { data, error } = await sb.auth.signInWithPassword({
        email: creds.email, password: creds.password
      });
      if (!error && data.session) {
        showSyncIndicator('✓ reconectado');
        return;
      }
    }
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

function openRegistroDirecto() {
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
    sesion = { date: new Date().toISOString(), energia: selectedEnergy, estado: { ...estadoDiario }, items: [] };
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
  if (save) SFX.saveSession(); else SFX.close();
  _origCloseRatingSesion(save);
};

// Tick buttons
const _origSetTick = setTick;
setTick = function(planId, tick, btn, minPlan) {
  if (tick === 'saltado') SFX.skip();
  else if (tick !== 'hecho') SFX.open();
  btn.classList.remove('tick-pop'); void btn.offsetWidth; btn.classList.add('tick-pop');
  _origSetTick(planId, tick, btn, minPlan);
};

// Hecho modal confirm
const _origCloseHechoDatos = closeHechoDatos;
closeHechoDatos = function(save) {
  if (save) SFX.tick();
  else SFX.close();
  _origCloseHechoDatos(save);
};

// Open modal — soft tap
const _origOpenModal = openModal;
openModal = function(id) { SFX.open(); _origOpenModal(id); };

// Close modal — subtle
const _origCloseModal = closeModal;
closeModal = function(id) { SFX.close(); _origCloseModal(id); };

// Pase confirm
const _origConfirmPase = confirmPase;
confirmPase = function() { SFX.pase(); _origConfirmPase(); };

// Tab navigation
const _origShowView = showView;
showView = function(name) { SFX.nav(); _origShowView(name); };

// Add obra / evento
const _origOpenAddObra = openAddObra;
openAddObra = function() { SFX.add(); _origOpenAddObra(); };

// Confirm add obra (the real function is `addObra`)
if (typeof addObra === 'function') {
  const _origAddObra = addObra;
  addObra = function() { SFX.save(); _origAddObra(); };
}

// Delete obra/pasaje — subtle descending
const _origDeleteObra = deleteObra;
deleteObra = function(id) { SFX.del(); _origDeleteObra(id); };

// Add pasaje
const _origAddPasaje = addPasaje;
addPasaje = function(obraId) { SFX.pasaje(); _origAddPasaje(obraId); };

// Event realizado — milestone arpeggio
const _origConfirmEventoResultado = confirmEventoResultado;
confirmEventoResultado = function() { SFX.milestone(); _origConfirmEventoResultado(); };

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
togglePaseBlock = function(cual) { SFX.toggle(); _origTogglePaseBlock(cual); };

// Intensidad pasaje
const _origSelectPasajeIntensidad = selectPasajeIntensidad;
selectPasajeIntensidad = function(id, nivel, btn) {
  SFX.toggle();
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
async function doLogout() {}

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
      _saveStoredCredentials(email, pass);
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
function openSettings() {
  openModal('modalSettings');
  if (typeof updateSyncStatusInfo === 'function') updateSyncStatusInfo();
  if (typeof refreshSoundOptionUI === 'function') refreshSoundOptionUI();
  if (typeof updateForestPendientesBtn === 'function') updateForestPendientesBtn();
}

// Refresca la información de estado en Ajustes
async function updateSyncStatusInfo() {
  const el = document.getElementById('syncStatusInfo');
  if (!el) return;
  try {
    const sb = getSB();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      el.innerHTML = '✓ Conectado como <span style="color:var(--accent)">' + user.email + '</span><br>'
        + '<span style="font-size:9px">Tus datos se guardan también en la nube y se sincronizan al iniciar.</span>';
    } else {
      el.innerHTML = '<span style="color:var(--orange)">⚠ Sin sesión activa</span><br>'
        + '<span style="font-size:9px">La app está funcionando solo en este dispositivo. Pulsa "Re-sincronizar" para conectar con tu cuenta.</span>';
    }
  } catch(e) {
    el.innerHTML = '<span style="color:var(--text3)">Sincronización no disponible (sin red o sin cuenta).</span>';
  }
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
  loadAppTitle();
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
  const _credsGuardadas = !!_loadStoredCredentials();

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

    if (_credsGuardadas) {
      const creds = _loadStoredCredentials();
      showSyncIndicator('↺ reconectando…');
      const { data, error } = await sb.auth.signInWithPassword({
        email: creds.email, password: creds.password
      });
      if (!error && data.session) {
        await onAuthSuccess();
        return;
      }
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
    if (_instalacionVacia && !_credsGuardadas) {
      setTimeout(() => openModal('modalCloudSync'), 400);
    }
  }
}

function _loadStoredCredentials() {
  try {
    const raw = localStorage.getItem('piano_auto_creds');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

function _saveStoredCredentials(email, password) {
  try {
    localStorage.setItem('piano_auto_creds', JSON.stringify({ email, password }));
  } catch(e) {}
}

function _clearStoredCredentials() {
  localStorage.removeItem('piano_auto_creds');
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

const CRONO_STORAGE_KEY = 'pianoCrono_v1';
const CRONO_MIN_MIN = 10;                  // mínimo de minutos para que cuente
const CRONO_PAUSE_LIMIT_MS = 5 * 60 * 1000; // 5 minutos máx de pausa
const CRONO_MAX_MIN = 120;                 // tope: en modo cronómetro se autodetiene a las 2h
const CRONO_MAX_MS = CRONO_MAX_MIN * 60 * 1000;

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
  mode: 'stopwatch',     // 'stopwatch' | 'timer'
  timerMinutes: 25,      // minutos seleccionados en modo timer (5..120, step 5)
  targetMinutes: null,   // minutos objetivo de la sesión en curso (timer mode); null en stopwatch
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
};

// Pases registrados durante la sesión (drawer lateral) — se pre-rellenan en el modal Hecho
let _cronoDraftPases = { antesActive: false, antesVal: 50, despuesActive: false, despuesVal: 60 };
let _cronoPaseDrawerOpen = false;

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
      targetMinutes: crono.targetMinutes,
      isRest: crono.isRest,
      obraId: crono.obraId,
      movId: crono.movId,
      displayName: crono.displayName,
      subName: crono.subName,
      color: crono.color,
      startTs: crono.startTs,
      pausedMs: crono.pausedMs,
      pauseStartTs: crono.pauseStartTs,
    }));
  } catch(e) {}
}

function cronoLoadState() {
  try {
    const raw = localStorage.getItem(CRONO_STORAGE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    // Cargar siempre la preferencia de mode + timerMinutes (independiente del state)
    if (s.mode === 'stopwatch' || s.mode === 'timer') crono.mode = s.mode;
    if (typeof s.timerMinutes === 'number' && s.timerMinutes >= 5 && s.timerMinutes <= 120) {
      crono.timerMinutes = s.timerMinutes;
    }
    if (s.state !== 'running' && s.state !== 'paused') return false;
    if (!s.obraId || !s.startTs) return false;
    crono.state = s.state;
    crono.targetMinutes = s.targetMinutes || null;
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

// ── DESTELLOS ────────────────────────────────────────────────────────────────
// Recopila todas las sesiones de excelencia marcadas, de todo el historial,
// más recientes primero. Cada entrada: { date, obra, nota }.
// Los días pasados se leen de db.sesiones; HOY se lee del estado en memoria
// (sessionDestello) para que un destello recién marcado aparezca al instante,
// sin esperar al autoguardado (que va con debounce de 800ms).
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
    out.push({ date: new Date().toISOString(), obra: obraName, nota: (d.nota || '').trim() });
  });

  // DÍAS PASADOS — desde db.sesiones
  if (Array.isArray(db.sesiones)) {
    db.sesiones.forEach(sesion => {
      if (!sesion || !Array.isArray(sesion.items)) return;
      if (new Date(sesion.date).toDateString() === todayStr) return; // hoy ya cubierto por memoria
      const aggregate = sesion._aggregate || {};
      sesion.items.forEach(it => {
        if (!it) return;
        const planId = it._planId || (it.obraId + '::' + (it.movId || ''));
        let on = !!it.destello;
        let nota = (it.destelloNota || '').trim();
        // Respaldo: destello guardado solo en alguna sub-sesión.
        if (!on) {
          const subs = aggregate[planId]?.subsessions || [];
          const sub = subs.find(s => s && s.destello);
          if (sub) { on = true; if (!nota) nota = (sub.destelloNota || '').trim(); }
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
        out.push({ date: sesion.date, obra: obraName || 'Sesión', nota });
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
  if (countEl) countEl.textContent = n;
  pill.style.display = n > 0 ? '' : 'none';
}

function openDestellosModal() {
  const list = document.getElementById('destellosList');
  if (list) {
    const destellos = getAllDestellos();
    if (!destellos.length) {
      list.innerHTML = '<div class="destellos-empty">Aún no hay destellos. Cuando una sesión vaya de excelencia (80 o más), podrás guardarla aquí.</div>';
    } else {
      list.innerHTML = destellos.map(d => {
        const fecha = new Date(d.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        const notaHtml = d.nota
          ? '<div class="destello-card-nota">' + escapeHtmlSafe(d.nota) + '</div>'
          : '<div class="destello-card-nota destello-card-nota--vacia">— sin nota —</div>';
        return '<div class="destello-card">' +
          '<div class="destello-card-head">' +
            '<span class="destello-card-obra">' + escapeHtmlSafe(d.obra) + '</span>' +
            '<span class="destello-card-fecha">' + fecha + '</span>' +
          '</div>' + notaHtml +
        '</div>';
      }).join('');
    }
  }
  openModal('modalDestellos');
}

// Refresca todos los textos "hoy te has concentrado..." y el mini-resumen
function refreshConcentradoUI() {
  const min = getMinutosConcentradoHoy();
  const text = 'Hoy te has concentrado ' + fmtMinutosLargo(min);
  const ids = ['cronoConcentradoText', 'sessionConcentradoText'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });

  // Pill de destellos (abajo a la izquierda en el cronómetro en reposo)
  if (typeof refreshDestellosPill === 'function') refreshDestellosPill();

  // Mini-resumen lateral: HOY + AYER
  const resumenEl = document.getElementById('cronoResumenLateral');
  if (resumenEl) {
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
  if (!crono.startTs) return 0;
  if (crono.state === 'paused') {
    return Math.max(0, crono.pauseStartTs - crono.startTs - crono.pausedMs);
  }
  return Math.max(0, Date.now() - crono.startTs - crono.pausedMs);
}

// ms restantes de pausa antes de auto-cierre
function cronoPauseRemainingMs() {
  if (crono.state !== 'paused' || !crono.pauseStartTs) return 0;
  return Math.max(0, CRONO_PAUSE_LIMIT_MS - (Date.now() - crono.pauseStartTs));
}

// ── Modo concentración (oculta topbar, muestra X) ───────────────────────────

function cronoEnterFocus() {
  document.body.classList.add('crono-focus');
}

function cronoExitFocus() {
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
      const remainingMs = Math.max(0, crono.targetMinutes * 60000 - cronoCurrentMs());
      disp.textContent = cronoFmt(remainingMs);
    } else {
      disp.textContent = cronoFmt(cronoCurrentMs());
    }
    if (crono.state === 'paused') {
      disp.classList.add('paused');
      if (wrap) wrap.classList.add('is-paused');
    } else {
      disp.classList.remove('paused');
      if (wrap) wrap.classList.remove('is-paused');
    }
  }

  // Overlay de pausa: activar body.crono-paused para mostrarlo
  if (crono.state === 'paused') {
    document.body.classList.add('crono-paused');
    const ovTime = document.getElementById('cronoPauseOverlayTime');
    if (ovTime) ovTime.textContent = cronoFmt(cronoPauseRemainingMs());
  } else {
    document.body.classList.remove('crono-paused');
  }

  // Controles según estado
  const ctrl = document.getElementById('cronoControls');
  if (!ctrl) return;
  if (crono.state === 'running') {
    ctrl.innerHTML =
      '<button class="crono-ctrl-btn stop" onclick="cronoStop()" aria-label="Parar">' + CRONO_ICONS.stop + '</button>' +
      '<button class="crono-ctrl-btn primary" onclick="cronoPause()" aria-label="Pausar">' + CRONO_ICONS.pause + '</button>';
  } else if (crono.state === 'paused') {
    ctrl.innerHTML =
      '<button class="crono-ctrl-btn stop" onclick="cronoStop()" aria-label="Parar">' + CRONO_ICONS.stop + '</button>' +
      '<button class="crono-ctrl-btn primary" onclick="cronoResume()" aria-label="Reanudar">' + CRONO_ICONS.play + '</button>';
  }
}

// Habilitar/deshabilitar botón start según haya selección
function cronoUpdateStartBtn() {
  const btn = document.getElementById('cronoStartBtn');
  const sel = document.getElementById('cronoObraSelect');
  if (!btn || !sel) return;
  btn.disabled = !sel.value;
  // Mantener el botón custom sincronizado (dot de color + nombre)
  if (typeof cronoUpdateSelectBtn === 'function') cronoUpdateSelectBtn();
  // Texto del botón según modo
  if (crono.mode === 'timer') {
    btn.textContent = 'Plantar · ' + crono.timerMinutes + ' min';
  } else {
    btn.textContent = 'Plantar';
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
}

// Aplica un color (hex o null) a todos los elementos del cronómetro que deben
// teñirse: ensō, botón plantar (idle) y aros/píldora/halo (running).
function cronoApplyColor(hex) {
  const root = document.getElementById('view-cronometro');
  if (!root) return;
  if (hex) root.style.setProperty('--crono-color', hex);
  else root.style.removeProperty('--crono-color');
}

// ── MODO CRONÓMETRO / TEMPORIZADOR ──────────────────────────────────────────

const TIMER_MIN_MINUTES = 5;
const TIMER_MAX_MINUTES = 120;
const TIMER_STEP_MINUTES = 5;
const TIMER_RADIUS = 88;
const TIMER_CIRC = 2 * Math.PI * TIMER_RADIUS; // ≈ 552.92

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
  if (mode !== 'stopwatch' && mode !== 'timer') return;
  if (crono.state !== 'idle') {
    // No permitir cambiar de modo mientras corre una sesión
    showToast('Termina la sesión actual antes de cambiar de modo');
    return;
  }
  crono.mode = mode;
  cronoSaveState();
  cronoApplyModeUI();
  cronoUpdateStartBtn();
}

function cronoApplyModeUI() {
  // Toggle visual
  document.body.classList.toggle('crono-timer-mode', crono.mode === 'timer');
  document.querySelectorAll('.crono-mode-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === crono.mode);
  });
  // Mover indicador
  cronoMoveModeIndicator();
  // Si timer mode, actualizar el slider visualmente y el botón "Plantar"
  if (crono.mode === 'timer') {
    cronoTimerRenderSlider();
  }
  // Mensaje contextual
  const msg = document.getElementById('cronoIdleMessage');
  if (msg) {
    msg.textContent = crono.mode === 'timer'
      ? 'Elige cuánto quieres concentrarte'
      : 'Empieza tu sesión de hoy';
  }
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

// Renderiza el slider radial con crono.timerMinutes
function cronoTimerRenderSlider() {
  const arc = document.getElementById('cronoTimerArc');
  const handle = document.getElementById('cronoTimerHandle');
  const text = document.getElementById('cronoTimerText');
  if (!arc || !handle || !text) return;

  const m = crono.timerMinutes;
  const pct = m / TIMER_MAX_MINUTES; // 0..1
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
  text.textContent = String(m);
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
    const elapsedMs = cronoCurrentMs();
    // En modo timer: mostrar cuenta atrás y auto-finalizar al llegar a 0
    if (crono.targetMinutes != null) {
      const targetMs = crono.targetMinutes * 60000;
      const remainingMs = Math.max(0, targetMs - elapsedMs);
      if (disp) disp.textContent = cronoFmt(remainingMs);
      if (remainingMs <= 0) {
        clearInterval(crono.tickInterval);
        crono.tickInterval = null;
        setTimeout(() => {
          if (typeof SFX !== 'undefined' && SFX.saveSession) SFX.saveSession();
          cronoFinish();
        }, 150);
      }
    } else {
      // Modo cronómetro (sin objetivo): tope de 2h. Si se olvida apagar, se
      // autodetiene y guarda la sesión en lugar de correr indefinidamente.
      if (elapsedMs >= CRONO_MAX_MS) {
        if (disp) disp.textContent = cronoFmt(CRONO_MAX_MS);
        clearInterval(crono.tickInterval);
        crono.tickInterval = null;
        setTimeout(() => {
          showToast('Tope de 2h alcanzado · sesión guardada');
          if (typeof SFX !== 'undefined' && SFX.saveSession) SFX.saveSession();
          cronoFinish();
        }, 150);
        return;
      }
      if (disp) disp.textContent = cronoFmt(elapsedMs);
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
      } else {
        milestoneEl.style.display = 'none';
      }
    }
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

  _cronoPaseDrawerReset();

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
  // Si modo timer, fijar el objetivo de minutos para auto-finalizar al llegar
  crono.targetMinutes = (crono.mode === 'timer') ? crono.timerMinutes : null;

  cronoSaveState();
  cronoRender();
  cronoStartTick();
  if (typeof SFX !== 'undefined' && SFX.tick) SFX.tick();
}

// Inicia un cronómetro de DESCANSO: cuenta el tiempo pero NO suma al tiempo
// de estudio. Queda registrado en db.sessionPlants[] con tipo:'descanso'
// para llevar constancia. Útil para descansos activos entre sesiones largas.
function cronoStartRest() {
  if (crono.state !== 'idle') {
    showToast('Termina la sesión actual antes de descansar');
    return;
  }
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
  crono.targetMinutes = (crono.mode === 'timer') ? crono.timerMinutes : null;

  cronoSaveState();
  cronoRender();
  cronoStartTick();
  if (typeof SFX !== 'undefined' && SFX.tick) SFX.tick();
}

function cronoPause() {
  if (crono.state !== 'running') return;
  cronoStopTick();
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
}

function cronoStop() {
  const ms = cronoCurrentMs();
  const min = Math.floor(ms / 60000);
  if (min >= CRONO_MIN_MIN) {
    // Sesión válida: confirmación simple inline (sin modal, es seguro)
    if (!confirm('¿Parar y guardar la sesión?\n\nLlevas ' + cronoFmt(ms) + ' estudiando.')) return;
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

function cronoFinish() {
  cronoStopTick();
  cronoStopPauseCountdown();

  // Si el día cambió mientras el cronómetro corría, hacer reset del plan ANTES
  // de añadir esta sesión, para que cuente como sesión del día NUEVO. La
  // sesión se asigna por hora de finalización (igual que Forest).
  const nowDay = new Date().toDateString();
  if (_currentPlanDay !== nowDay) {
    handleDayChange();
  }

  // En modo cronómetro capamos a 2h: si la app estuvo cerrada mucho tiempo con
  // una sesión corriendo, no queremos grabar 5h de golpe. En modo temporizador
  // el objetivo ya limita la duración.
  const ms = (crono.targetMinutes == null) ? Math.min(cronoCurrentMs(), CRONO_MAX_MS) : cronoCurrentMs();
  const minutos = Math.floor(ms / 60000);

  // ── DESCANSO: no añade tarjeta, no llama al modal hecho, no suma minutos
  // al "concentrado hoy". Solo registra en db.sessionPlants con tipo descanso.
  if (crono.isRest) {
    if (crono.startTs && minutos >= 1) {
      if (!Array.isArray(db.sessionPlants)) db.sessionPlants = [];
      db.sessionPlants.push({
        obraId: '_rest_',
        movId: null,
        startedAt: new Date(crono.startTs).toISOString(),
        endedAt: new Date().toISOString(),
        mins: minutos,
        source: 'app',
        tipo: 'descanso',
      });
      saveData();
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

  if (minutos < CRONO_MIN_MIN) {
    cronoIncFallidas();
    // Guardar la sesión fallida en db.sessionPlants con flag failed:true,
    // para que aparezca en estadísticas y mantenga el historial completo
    // (igual que los "árboles marchitos" del CSV de Forest).
    if (obraId && crono.startTs) {
      const startedAtIso = new Date(crono.startTs).toISOString();
      const endedAtIso = new Date().toISOString();
      recordSessionPlant(obraId, movId, startedAtIso, endedAtIso, minutos, { failed: true });
      saveData();
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
    if (!existing._isExtra) {
      // Primera vez que se estudia una tarjeta PLANIFICADA: el valor que tenía
      // era una estimación (p.ej. 10 min). Lo reemplazamos por los minutos
      // REALES estudiados (p.ej. 20). A partir de aquí pasa a ser tarjeta de
      // tiempo real y las siguientes sesiones SÍ suman.
      sessionMinPlan[targetPlanId] = minutos;
      existing._isExtra = true;
    } else {
      // Tarjeta de tiempo real: acumular.
      sessionMinPlan[targetPlanId] = (sessionMinPlan[targetPlanId] || 0) + minutos;
    }
    // Re-renderizar la tarjeta con el total actualizado
    const planEl = document.getElementById('plan-' + targetPlanId);
    if (planEl) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderExtraItem(existing, sessionMinPlan[targetPlanId]);
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
  const startedAtIso = new Date(crono.startTs).toISOString();
  const endedAtIso = new Date().toISOString();
  if (!sessionAggregate[targetPlanId]) sessionAggregate[targetPlanId] = { subsessions: [] };
  sessionAggregate[targetPlanId]._pendingTimes = { startedAt: startedAtIso, endedAt: endedAtIso };

  // ★ Registrar también la sub-sesión en db.sessionPlants[] (permanente,
  // sobrevive al cap de db.sesiones[]). Para estadísticas históricas.
  recordSessionPlant(obraId, movId, startedAtIso, endedAtIso, minutos);

  cronoReset();
  cronoRender();

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
  crono.state = 'idle';
  crono.isRest = false;
  crono.targetMinutes = null;
  crono.obraId = null;
  crono.movId = null;
  crono.displayName = '';
  crono.subName = '';
  crono.color = null;
  crono.startTs = 0;
  crono.pausedMs = 0;
  crono.pauseStartTs = 0;
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

// Ajusta la altura del picker al viewport visible. Clave en móvil: cuando el
// teclado del buscador aparece, visualViewport se encoge y el modal queda
// contenido en la zona visible (anclado arriba) en lugar de tapado por el teclado.
function _cronoPickerFit() {
  const overlay = document.getElementById('modalCronoObraPicker');
  if (!overlay || !overlay.classList.contains('visible')) return;
  const modal = overlay.querySelector('.modal');
  if (!modal) return;
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  modal.style.maxHeight = Math.max(220, Math.round(h - 20)) + 'px';
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

  // Separar actividades de obras para mostrarlas agrupadas
  const obrasNormales = [];
  const actividades = [];
  obras.forEach(o => {
    const composerTxt = (o.composer && o.composer !== '—') ? o.composer : '';
    if (q && !(o.name + ' ' + composerTxt).toLowerCase().includes(q)) {
      // Si la obra no matchea, comprobar si algún movimiento sí matchea
      const movMatches = (o.movimientos || []).some(m => m.name && m.name.toLowerCase().includes(q));
      if (!movMatches) return;
    }
    (o.tipo === 'actividad' ? actividades : obrasNormales).push(o);
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

  let html = '';
  if (obrasNormales.length) {
    html += '<div class="crono-picker-section">Obras</div>';
    html += obrasNormales.map(o => obraButtonHTML(o, false)).join('');
  }
  if (actividades.length) {
    html += '<div class="crono-picker-section">Actividades</div>';
    html += actividades.map(o => obraButtonHTML(o, true)).join('');
  }
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

// ── Metrónomo ────────────────────────────────────────────────────────────────

let _metroBpm        = 80;
let _metroPrevBpm    = 80;
let _metroRunning    = false;
let _metroNextTime   = 0;
let _metroTimer      = null;
let _metroAudioCtx   = null;
let _metroTaps       = [];
let _metroCurSlot    = null;   // legacy — unused after ring-buffer redesign
let _metroDispBpm    = null;   // BPM value currently shown in the slot
// Ring-buffer 3-slot display
let _metroSlotEls    = null;   // [el0, el1, el2]
let _metroSlotMid    = 1;      // index of the element currently in 'mid' position
let _metroRatchetTimer = null; // timer del avance número-a-número (ruleta)
// Drawer state
let _metroDrawerOpen   = false;
let _metroDrawerPinned = false;

const _TEMPO_MARKS = [
  { max:  39, label: 'Larghissimo' },
  { max:  59, label: 'Largo'       },
  { max:  65, label: 'Larghetto'   },
  { max:  71, label: 'Adagio'      },
  { max:  77, label: 'Adagietto'   },
  { max:  83, label: 'Andante'     },
  { max:  93, label: 'Andantino'   },
  { max: 103, label: 'Moderato'    },
  { max: 117, label: 'Allegretto'  },
  { max: 137, label: 'Allegro'     },
  { max: 167, label: 'Vivace'      },
  { max: 199, label: 'Presto'      },
  { max: 999, label: 'Prestissimo' },
];

function _metroTempoLabel(bpm) {
  return (_TEMPO_MARKS.find(t => bpm <= t.max) || _TEMPO_MARKS.at(-1)).label;
}

function _metroGetCtx() {
  if (!_metroAudioCtx || _metroAudioCtx.state === 'closed') {
    _metroAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _metroAudioCtx;
}

// Golpe del metrónomo. `when` = timestamp del reloj de audio (segundos) en el
// que debe sonar; si no se pasa, suena de inmediato. Programar el golpe en el
// futuro inmediato (no en `currentTime` exacto) evita que iPad se salte clicks.
// Volumen MUY alto a propósito: ganancias por encima de 1 empujadas contra un
// limitador, para que se oiga fuerte aunque sature, sin crackeo digital.
function _metroPlayTick(isAccent, when) {
  try {
    const ctx = _metroGetCtx();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const t = (typeof when === 'number') ? Math.max(when, ctx.currentTime) : ctx.currentTime;

    // Limitador de salida: deja empujar muchísima ganancia sin que reviente feo.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-10, t);
    comp.knee.setValueAtTime(0, t);
    comp.ratio.setValueAtTime(20, t);
    comp.attack.setValueAtTime(0.001, t);
    comp.release.setValueAtTime(0.05, t);
    comp.connect(ctx.destination);

    // Click agudo — cuerpo del "tic"
    const cOsc = ctx.createOscillator(); const cGain = ctx.createGain();
    cOsc.type = 'square';
    cOsc.frequency.setValueAtTime(isAccent ? 2300 : 1800, t);
    cGain.gain.setValueAtTime(2.8, t);
    cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    cOsc.connect(cGain); cGain.connect(comp);
    cOsc.start(t); cOsc.stop(t + 0.035);

    // Tono grave — da pegada y cuerpo al golpe
    const bOsc = ctx.createOscillator(); const bGain = ctx.createGain();
    bOsc.type = 'square';
    bOsc.frequency.setValueAtTime(isAccent ? 900 : 700, t);
    bGain.gain.setValueAtTime(2.2, t);
    bGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    bOsc.connect(bGain); bGain.connect(comp);
    bOsc.start(t); bOsc.stop(t + 0.1);

    // Flash visual sincronizado con el golpe
    const delayMs = Math.max(0, (t - ctx.currentTime) * 1000);
    if (delayMs < 4) _metroFlashBeat(isAccent);
    else setTimeout(() => _metroFlashBeat(isAccent), delayMs);
  } catch (e) {}
}

function _metroFlashBeat(isAccent) {
  const el = document.getElementById('metroBeatDot');
  if (!el) return;
  el.classList.remove('beat', 'beat-accent');
  void el.offsetWidth;
  el.classList.add('beat');
  if (isAccent) el.classList.add('beat-accent');
}

// Tick discreto de "rueda de reloj" al girar el tempo (arrastre / botones ±).
// Es muy corto y suave para que se note el detente sin molestar.
function _metroPlayWheelTick() {
  try {
    const ctx = _metroGetCtx();
    const play = () => {
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(2500, now);
        osc.frequency.exponentialRampToValueAtTime(1500, now + 0.012);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.03);
      } catch (e) {}
    };
    if (ctx.state !== 'running') ctx.resume().then(play).catch(() => {});
    else play();
  } catch (e) {}
}

// Anima el número mostrado avanzando de uno en uno hasta `target`, como una
// ruleta con detentes. Cada paso reproduce un tick (si tick=true). Saltos
// grandes (p.ej. tap tempo) se ajustan de golpe sin ruleta.
function _metroAnimateDisplayTo(target, tick) {
  clearTimeout(_metroRatchetTimer);
  const stepOnce = () => {
    const cur = _metroDispBpm == null ? _metroBpm : _metroDispBpm;
    if (cur === target) return;
    if (Math.abs(target - cur) > 8) { _metroSlotSetInstant(target); return; }
    const dir = target > cur ? 1 : -1;
    _metroBpmRoll(cur + dir, dir);
    if (tick) _metroPlayWheelTick();
    if ((_metroDispBpm == null ? _metroBpm : _metroDispBpm) !== target) {
      _metroRatchetTimer = setTimeout(stepOnce, 130);
    }
  };
  stepOnce();
}

// Two-slot slot-machine animation for the BPM number.
// dir > 0 = new number enters from below (BPM increased)
// dir < 0 = new number enters from above (BPM decreased)
// Ring-buffer 3-slot BPM animation: prev (top) / current (mid) / next (bot)
// Each slot physically slides into the center so the numbers feel connected.
function _metroSlotInit() {
  const wrap = document.getElementById('metroBpm3Slot');
  if (!wrap) return;
  wrap.innerHTML = '';
  _metroSlotEls = [];
  for (let i = 0; i < 3; i++) {
    const el = document.createElement('span');
    el.className = 'metro-3s';
    wrap.appendChild(el);
    _metroSlotEls.push(el);
  }
  _metroSlotMid = 1;
  _metroSlotSetInstant(_metroBpm);
}

function _metroSlotSetInstant(bpm) {
  if (!_metroSlotEls) { _metroSlotInit(); return; }
  _metroSlotMid = 1;
  const positions = ['top','mid','bot'];
  _metroSlotEls.forEach((el, i) => {
    el.style.transition = 'none';
    el.textContent = bpm + (i - 1);
    el.className = 'metro-3s metro-3s-' + positions[i] + (_metroRunning && i === 1 ? ' running' : '');
  });
  requestAnimationFrame(() => { _metroSlotEls.forEach(el => { el.style.transition = ''; }); });
  _metroDispBpm = bpm;
}

function _metroBpmRoll(newBpm, dir) {
  if (!_metroSlotEls) { _metroSlotInit(); return; }
  const prevBpm = _metroDispBpm ?? _metroBpm;
  if (Math.abs(newBpm - prevBpm) > 2) {
    _metroSlotSetInstant(newBpm);
    return;
  }
  const topIdx = (_metroSlotMid + 2) % 3;
  const botIdx = (_metroSlotMid + 1) % 3;

  if (dir > 0) {
    // Scroll up: recycle top element → instant move to bottom with new value
    const recycled = _metroSlotEls[topIdx];
    recycled.style.transition = 'none';
    recycled.textContent = newBpm + 1;
    recycled.className = 'metro-3s metro-3s-bot';
    void recycled.offsetWidth;
    recycled.style.transition = '';
    _metroSlotMid = (_metroSlotMid + 1) % 3;
    const newTopIdx = (_metroSlotMid + 2) % 3;
    requestAnimationFrame(() => {
      _metroSlotEls[newTopIdx].className = 'metro-3s metro-3s-top';
      _metroSlotEls[_metroSlotMid].className = 'metro-3s metro-3s-mid' + (_metroRunning ? ' running' : '');
    });
  } else {
    // Scroll down: recycle bot element → instant move to top with new value
    const recycled = _metroSlotEls[botIdx];
    recycled.style.transition = 'none';
    recycled.textContent = newBpm - 1;
    recycled.className = 'metro-3s metro-3s-top';
    void recycled.offsetWidth;
    recycled.style.transition = '';
    _metroSlotMid = (_metroSlotMid + 2) % 3;
    const newBotIdx = (_metroSlotMid + 1) % 3;
    requestAnimationFrame(() => {
      _metroSlotEls[_metroSlotMid].className = 'metro-3s metro-3s-mid' + (_metroRunning ? ' running' : '');
      _metroSlotEls[newBotIdx].className = 'metro-3s metro-3s-bot';
    });
  }
  _metroDispBpm = newBpm;
}

// Wheel + touch-swipe on the BPM slot to change tempo
function _metroInitScroll() {
  const wrap = document.getElementById('metroReelWrap');
  if (!wrap || wrap._scrollBound) return;
  wrap._scrollBound = true;

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    metroBpm(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // Píxeles de arrastre por cada paso de BPM. Más alto = rueda más lenta y
  // controlable (antes 8px hacía que el número volase al mover el dedo).
  const STEP_PX = 26;
  let _tY = 0, _tAccum = 0;
  wrap.addEventListener('touchstart', (e) => {
    _tY     = e.touches[0].clientY;
    _tAccum = 0;
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    const dy = _tY - e.touches[0].clientY;
    _tAccum += dy;
    _tY      = e.touches[0].clientY;
    if (Math.abs(_tAccum) >= STEP_PX) {
      e.preventDefault();
      metroBpm(_tAccum > 0 ? 1 : -1);
      _tAccum = _tAccum > 0 ? _tAccum - STEP_PX : _tAccum + STEP_PX;
    }
  }, { passive: false });
}

// ── Drawer state ──────────────────────────────────────────────────────────────
function _metroDrawerInit() {
  _metroDrawerPinned = localStorage.getItem('metro_pinned') === 'true';
  _metroDrawerOpen   = _metroDrawerPinned;
  _metroDrawerApplyState();
  _metroSlotInit();
  _metroInitScroll();
}

function metroDrawerToggle() {
  if (_metroDrawerPinned) return;
  _metroDrawerOpen = !_metroDrawerOpen;
  _metroDrawerApplyState();
}

function metroTogglePin() {
  _metroDrawerPinned = !_metroDrawerPinned;
  if (_metroDrawerPinned) _metroDrawerOpen = true;
  localStorage.setItem('metro_pinned', String(_metroDrawerPinned));
  _metroDrawerApplyState();
}

function _metroDrawerApplyState() {
  const drawer = document.getElementById('metroDrawer');
  const pinBtn = document.getElementById('metroPinBtn');
  if (drawer) {
    drawer.classList.toggle('open', _metroDrawerOpen);
    drawer.classList.toggle('pinned', _metroDrawerPinned);
  }
  if (pinBtn) pinBtn.classList.toggle('active', _metroDrawerPinned);
}

const _METRO_LOOKAHEAD = 0.1;  // s — ventana de pre-programación de golpes
const _METRO_SCHED_MS  = 25;   // ms — cada cuánto corre el planificador

// Planificador con "lookahead" sobre el reloj de Web Audio. En vez de crear el
// golpe en el instante (impreciso) en que dispara el setTimeout —lo que en iPad
// hacía que se saltara clicks al azar—, pre-programa cada golpe con su timestamp
// exacto en el reloj de audio. Así ningún click se pierde ni llega tarde.
// _metroNextTime está en SEGUNDOS del reloj de audio (ctx.currentTime).
function _metroSchedule() {
  if (!_metroRunning) return;
  const ctx = _metroGetCtx();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const interval = 60 / _metroBpm; // segundos por golpe
  // Si nos quedamos atrás (tab en segundo plano dormida), reengancha sin ráfaga.
  if (_metroNextTime < ctx.currentTime) _metroNextTime = ctx.currentTime;
  while (_metroNextTime < ctx.currentTime + _METRO_LOOKAHEAD) {
    _metroPlayTick(false, _metroNextTime); // todos los golpes iguales (sin acento)
    _metroNextTime += interval;
  }
  _metroTimer = setTimeout(_metroSchedule, _METRO_SCHED_MS);
}

function metroToggle() {
  _metroRunning = !_metroRunning;
  if (_metroRunning) {
    const ctx = _metroGetCtx();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    _metroTaps = [];
    _metroNextTime = ctx.currentTime; // arranca en el reloj de audio
    _metroSchedule();
  } else {
    clearTimeout(_metroTimer);
    _metroTimer = null;
  }
  _metroUpdateUI();
}

// delta desde rueda / botones ±: anima la ruleta número a número con tick.
function metroBpm(delta) {
  metroSetBpm(_metroBpm + delta, { ratchet: true });
}

function metroSetBpm(bpm, opts) {
  _metroPrevBpm = _metroBpm;
  _metroBpm = Math.max(20, Math.min(250, Math.round(bpm)));
  // Si está sonando, el planificador (que lee _metroBpm en cada vuelta) adopta
  // el nuevo tempo en la siguiente ventana de lookahead, sin golpe brusco. No
  // tocar _metroTimer aquí: pararía el bucle del planificador.
  _metroUpdateUI(opts);
}

function metroTapTempo() {
  const now = Date.now();
  _metroTaps = _metroTaps.filter(t => now - t < 3500);
  _metroTaps.push(now);
  // Visual feedback on the tap button
  const btn = document.getElementById('metroTapBtn');
  if (btn) { btn.classList.add('tapped'); setTimeout(() => btn.classList.remove('tapped'), 120); }
  if (_metroTaps.length < 2) return;
  let total = 0;
  for (let i = 1; i < _metroTaps.length; i++) total += _metroTaps[i] - _metroTaps[i - 1];
  metroSetBpm(Math.round(60000 / (total / (_metroTaps.length - 1))));
}

function _metroUpdateUI(opts) {
  const slider  = document.getElementById('metroSlider');
  const playBtn = document.getElementById('metroPlayBtn');

  // 3-slot BPM roll
  if (_metroDispBpm !== _metroBpm) {
    if (opts && opts.ratchet) {
      // Rueda/botones ±: avanza número a número con tick (anima también ±5).
      _metroAnimateDisplayTo(_metroBpm, true);
    } else {
      // Slider / programático: un solo giro, sin tick.
      clearTimeout(_metroRatchetTimer);
      _metroBpmRoll(_metroBpm, _metroBpm > _metroPrevBpm ? 1 : -1);
    }
  }
  // Sync mid slot running color
  if (_metroSlotEls) {
    _metroSlotEls[_metroSlotMid].className =
      'metro-3s metro-3s-mid' + (_metroRunning ? ' running' : '');
  }

  // Play/stop button icons
  if (playBtn) {
    const playIcon = playBtn.querySelector('.metro-play-icon');
    const stopIcon = playBtn.querySelector('.metro-stop-icon');
    if (playIcon) playIcon.style.display = _metroRunning ? 'none' : '';
    if (stopIcon) stopIcon.style.display = _metroRunning ? '' : 'none';
    playBtn.classList.toggle('active', _metroRunning);
  }

  // Tab: accent when running
  const tab = document.getElementById('metroDrawerTab');
  if (tab) tab.classList.toggle('running', _metroRunning);

  if (slider) slider.value = _metroBpm;
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
  cronoExitFocus();
  document.body.classList.remove('crono-timer-mode');
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
      cronoStartTick();
    } else if (crono.state === 'paused') {
      cronoStartPauseCountdown();
    }
  }
}

window.addEventListener('load', function() {
  setTimeout(cronoHydrate, 100);
  setTimeout(_metroDrawerInit, 150);
  _swUpdateInit();
});

// ── Service Worker update detection ──────────────────────────────────────────
let _swReg = null;

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

function swDoUpdate() {
  if (_swReg && _swReg.waiting) _swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
}

// Boot the app — runs auth, theme, draft restore, racha, etc.
initApp();
