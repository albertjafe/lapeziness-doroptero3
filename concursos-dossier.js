/* Concursos (02-10-2026): dosier de concursos de piano.
 * db.concursosDosier.concursos = [{ id, ficha, importado, origen, interes }]
 *   · ficha: la ficha completa como TEXTO JSON (formato en
 *     docs/DOSIER_CONCURSOS_FORMATO.md). Es un escalar a propósito: al
 *     reimportar se sustituye entera; como objeto con listas sin id, la fusión
 *     de sincronización juntaría rondas y premios viejos con los nuevos.
 *   · interes: 'si' | 'no' | null (lo marca la persona; no se pisa al importar).
 * db.perfil.fechaNacimiento: la edad y la elegibilidad se calculan siempre a
 * partir de ella, nunca se guardan.
 * La primera vez se carga data/concursos-dosier.json (bases oficiales
 * consultadas el 2-10-2026). */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConcursosDossierCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const FORMAT = 'dosier-concursos-piano';
  const VERSION = 1;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const ID = /^[a-z0-9][a-z0-9-]{1,80}$/;
  const STATES = ['si', 'parcial', 'no', 'desconocido'];
  const isoOrNull = value => (typeof value === 'string' && ISO.test(value) ? value : null);
  const text = (value, max = 4000) => (value == null ? '' : String(value).trim().slice(0, max));
  const list = (value, max = 200) => (Array.isArray(value) ? value : []).slice(0, max);
  const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

  function ageAt(birth, on) {
    if (!isoOrNull(birth) || !isoOrNull(on)) return null;
    const [by, bm, bd] = birth.split('-').map(Number);
    const [oy, om, od] = on.split('-').map(Number);
    let age = oy - by;
    if (om < bm || (om === bm && od < bd)) age -= 1;
    return age;
  }
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  const dmy = iso => (isoOrNull(iso) ? `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
  function todayISO(now = new Date()) {
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  }
  function daysBetween(from, to) {
    const a = Date.UTC(...from.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
    const b = Date.UTC(...to.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
    return Math.round((b - a) / 86400000);
  }

  // Una ficha de la IA → forma completa, sin campos inventados.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Una ficha no es un objeto.');
    const id = text(raw.id, 90).toLowerCase();
    if (!ID.test(id)) throw new Error(`Id no válido: «${text(raw.id, 40) || '(vacío)'}» (usa minúsculas, números y guiones).`);
    const nombre = text(raw.nombre, 200);
    if (!nombre) throw new Error(`Falta el nombre de «${id}».`);
    const obj = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const fechas = obj(raw.fechas), plazo = obj(raw.plazo), cuota = obj(raw.cuota), edad = obj(raw.edad), video = obj(raw.video);
    const estado = value => (STATES.includes(value) ? value : 'desconocido');
    const bool = value => (value === true ? true : value === false ? false : null);
    return {
      id, nombre,
      edicion: text(raw.edicion, 120), ciudad: text(raw.ciudad, 120), pais: text(raw.pais, 80), web: text(raw.web, 500),
      fechas: { inicio: isoOrNull(fechas.inicio), fin: isoOrNull(fechas.fin), nota: text(fechas.nota, 600) },
      plazo: { fecha: isoOrNull(plazo.fecha), hora: text(plazo.hora, 20) || null, zona: text(plazo.zona, 60) || null, nota: text(plazo.nota, 800), cerrado: plazo.cerrado === true },
      cuota: { importe: num(cuota.importe), moneda: text(cuota.moneda, 3).toUpperCase() || null, nota: text(cuota.nota, 400) },
      edad: {
        min: num(edad.min), max: num(edad.max), aFecha: isoOrNull(edad.aFecha),
        nacidoDesde: isoOrNull(edad.nacidoDesde), nacidoHasta: isoOrNull(edad.nacidoHasta),
        texto: text(edad.texto, 800), sinLimite: edad.sinLimite === true,
      },
      video: { exige: bool(video.exige), duracion: text(video.duracion, 120) || null, resumen: text(video.resumen, 800), detalles: list(video.detalles, 20).map(x => text(x, 600)).filter(Boolean) },
      rondas: list(raw.rondas, 12).map(r => ({
        nombre: text(r && r.nombre, 120) || 'Ronda', fecha: isoOrNull(r && r.fecha), duracion: text(r && r.duracion, 120) || null,
        repertorio: list(r && r.repertorio, 30).map(x => text(x, 1500)).filter(Boolean),
      })),
      premios: list(raw.premios, 30).map(p => ({ puesto: text(p && p.puesto, 160), importe: num(p && p.importe), moneda: text(p && p.moneda, 3).toUpperCase() || null, extra: text(p && p.extra, 400) })).filter(p => p.puesto),
      premiosNota: text(raw.premiosNota, 800),
      jurado: list(raw.jurado, 40).map(x => text(x, 160)).filter(Boolean),
      juradoNota: text(raw.juradoNota, 800),
      alojamiento: { estado: estado(obj(raw.alojamiento).estado), texto: text(obj(raw.alojamiento).texto, 600) },
      viaje: { estado: estado(obj(raw.viaje).estado), texto: text(obj(raw.viaje).texto, 600) },
      otros: list(raw.otros, 20).map(x => text(x, 600)).filter(Boolean),
      estadoBases: text(raw.estadoBases, 40) || 'sin verificar',
      fuentes: list(raw.fuentes, 12).map(f => ({ titulo: text(f && f.titulo, 200), url: text(f && f.url, 500), consultado: isoOrNull(f && f.consultado) })).filter(f => /^https?:\/\//.test(f.url)),
      verificado: isoOrNull(raw.verificado),
      sinConfirmar: list(raw.sinConfirmar, 20).map(x => text(x, 40)).filter(Boolean),
    };
  }

  // Acepta el documento completo, un array de fichas o una ficha suelta.
  function parse(input) {
    let doc = input;
    if (typeof input === 'string') {
      try { doc = JSON.parse(input.replace(/^﻿/, '')); }
      catch (error) { throw new Error('El archivo no es JSON válido.'); }
    }
    let items;
    if (Array.isArray(doc)) items = doc;
    else if (doc && Array.isArray(doc.concursos)) {
      if (doc.formato && doc.formato !== FORMAT) throw new Error(`Formato «${doc.formato}» desconocido (se esperaba «${FORMAT}»).`);
      if (doc.version && Number(doc.version) > VERSION) throw new Error(`Versión ${doc.version} del formato: actualiza la app.`);
      items = doc.concursos;
    } else if (doc && doc.id && doc.nombre) items = [doc];
    else throw new Error('No encuentro concursos en el archivo.');
    if (!items.length) throw new Error('El archivo no trae concursos.');
    const out = [], errors = [], seen = new Set();
    items.slice(0, 200).forEach((raw, index) => {
      try {
        const item = normalize(raw);
        if (seen.has(item.id)) throw new Error(`«${item.id}» aparece dos veces.`);
        seen.add(item.id);
        out.push(item);
      } catch (error) { errors.push(`Ficha ${index + 1}: ${error.message}`); }
    });
    return { items: out, errors, meta: doc && !Array.isArray(doc) ? { generado: isoOrNull(doc.generado), autor: text(doc.autor, 200) } : {} };
  }

  function fichaOf(record) {
    if (!record || typeof record.ficha !== 'string') return null;
    try { return normalize(JSON.parse(record.ficha)); } catch (error) { return null; }
  }

  // Importar: añade lo nuevo y sustituye la ficha de lo que ya estaba; nunca
  // toca el interés ni la planificación. onlyNewer (seed): no pisa una ficha
  // verificada después.
  function merge(state, items, { origen = 'importado', now = new Date().toISOString(), onlyNewer = false } = {}) {
    state.concursos = Array.isArray(state.concursos) ? state.concursos : [];
    const byId = new Map(state.concursos.map(record => [record.id, record]));
    const result = { added: 0, updated: 0, unchanged: 0 };
    items.forEach(item => {
      const ficha = JSON.stringify(item);
      const record = byId.get(item.id);
      if (!record) {
        state.concursos.push({ id: item.id, ficha, importado: now, origen, interes: null });
        result.added += 1;
        return;
      }
      if (record.ficha === ficha) { result.unchanged += 1; return; }
      const current = fichaOf(record);
      if (onlyNewer && current && current.verificado && (!item.verificado || item.verificado < current.verificado)) { result.unchanged += 1; return; }
      record.ficha = ficha;
      record.importado = now;
      record.origen = origen;
      result.updated += 1;
    });
    return result;
  }

  function eligibility(c, birth, today = todayISO()) {
    const e = c.edad || {};
    const tentative = (c.sinConfirmar || []).includes('edad') || c.estadoBases === 'sin verificar';
    if (!isoOrNull(birth)) return { state: 'unknown', label: 'Falta tu fecha de nacimiento', detail: '' };
    if (e.nacidoDesde || e.nacidoHasta) {
      const ok = (!e.nacidoDesde || birth >= e.nacidoDesde) && (!e.nacidoHasta || birth <= e.nacidoHasta);
      const ref = e.aFecha || (c.fechas && c.fechas.inicio);
      const age = ref ? ageAt(birth, ref) : null;
      return { state: ok ? 'yes' : 'no', tentative, label: ok ? 'Elegible' : 'Fuera de edad', age, ref,
        detail: `${ok ? 'Tu fecha de nacimiento entra' : 'Tu fecha de nacimiento no entra'} en el rango${e.nacidoDesde ? ` desde el ${dmy(e.nacidoDesde)}` : ''}${e.nacidoHasta ? ` hasta el ${dmy(e.nacidoHasta)}` : ''}.` };
    }
    if (e.min != null || e.max != null) {
      const ref = e.aFecha || (c.fechas && c.fechas.inicio) || (c.plazo && c.plazo.fecha) || today;
      const age = ageAt(birth, ref);
      const ok = (e.min == null || age >= e.min) && (e.max == null || age <= e.max);
      const range = e.min != null && e.max != null ? `${e.min}–${e.max} años` : e.max != null ? `máx. ${e.max} años` : `mín. ${e.min} años`;
      return { state: ok ? 'yes' : 'no', tentative, label: ok ? 'Elegible' : 'Fuera de edad', age, ref, detail: `Tendrás ${age} años el ${dmy(ref)} (${range}).` };
    }
    if (e.sinLimite) return { state: 'yes', tentative, label: 'Sin límite de edad', detail: 'Las bases no ponen límite de edad.' };
    return { state: 'unknown', label: 'Edad sin confirmar', detail: e.texto || 'Las bases no lo dicen todavía.' };
  }

  function deadlineStatus(c, today = todayISO()) {
    const end = (c.fechas && (c.fechas.fin || c.fechas.inicio)) || null;
    if (end && end < today) return { state: 'finished', label: 'Terminado', days: null };
    const fecha = c.plazo && c.plazo.fecha;
    if (c.plazo && c.plazo.cerrado && !(fecha && fecha >= today)) return { state: 'closed', label: 'Plazo cerrado', days: null };
    if (!fecha) return { state: 'pending', label: 'Plazo sin publicar', days: null };
    const days = daysBetween(today, fecha);
    if (days < 0) return { state: 'closed', label: 'Plazo cerrado', days };
    const label = days === 0 ? 'Cierra hoy' : days === 1 ? 'Cierra mañana' : `Cierra en ${days} días`;
    return { state: days <= 14 ? 'urgent' : days <= 45 ? 'soon' : 'open', label, days };
  }

  function sortKey(c, today) {
    const status = deadlineStatus(c, today);
    const rank = { urgent: 0, soon: 0, open: 0, pending: 1, closed: 2, finished: 3 }[status.state];
    return [rank, (c.plazo && c.plazo.fecha) || (c.fechas && c.fechas.inicio) || '9999', c.nombre];
  }
  function compare(a, b, today) {
    const ka = sortKey(a, today), kb = sortKey(b, today);
    return ka[0] - kb[0] || String(ka[1]).localeCompare(String(kb[1])) || ka[2].localeCompare(kb[2]);
  }

  // Ficha → objeto de event-planning.js (EventPlanning.importDossierEntry).
  function toPlan(c, today = todayISO()) {
    const status = deadlineStatus(c, today);
    const money = p => (p.importe != null ? `${p.importe.toLocaleString('es-ES')} ${p.moneda || ''}`.trim() : '');
    return {
      id: c.id, name: c.nombre, start: c.fechas.inicio, end: c.fechas.fin,
      location: [c.ciudad, c.pais].filter(Boolean).join(', '), deadline: c.plazo.fecha,
      requiresVideo: c.video.exige,
      dossierStatus: { urgent: 'PLAZO PROXIMO', soon: 'PLAZO PROXIMO', open: 'PLAZO FUTURO', pending: 'SEGUIMIENTO', closed: 'CERRADO', finished: 'TERMINADO' }[status.state],
      dateNote: c.fechas.nota, eligibility: c.edad.texto,
      video: [c.video.duracion, c.video.resumen].filter(Boolean).join(' · '),
      repertoire: c.rondas.map(r => `${r.nombre}${r.duracion ? ` (${r.duracion})` : ''}: ${r.repertorio.join(' ')}`).join(' · ').slice(0, 2000),
      prizes: c.premios.map(p => `${p.puesto} ${money(p)}`.trim()).join(' / ').slice(0, 600),
      jury: c.jurado.join(', ').slice(0, 600) || c.juradoNota,
    };
  }

  const AI_PROMPT = [
    'Investiga en las webs oficiales los concursos internacionales de piano que te indique (o, si no te digo cuáles, los más relevantes de la próxima temporada) y devuélveme UN ÚNICO archivo JSON con el formato «dosier-concursos-piano», versión 1.',
    '',
    'Reglas:',
    '1. Solo fuentes oficiales (web del concurso, PDF de bases, WFIMC). Nada de blogs ni de datos de ediciones pasadas presentados como actuales.',
    '2. No inventes nada. Si un dato no está publicado, pon null (o lista vacía) y añade el nombre del campo a "sinConfirmar". Si usas una edición anterior como referencia, dilo en el texto.',
    '3. Fechas AAAA-MM-DD. Importes como número y moneda en código ISO (EUR, USD, GBP, CHF, CAD, AUD, JPY).',
    '4. Textos en español, breves y concretos; las listas de obras completas si las bases las dan.',
    '5. Cada concurso con al menos una fuente (URL exacta y fecha de consulta) y "verificado" con el día que lo comprobaste.',
    '6. "id" estable: nombre corto + año, en minúsculas y con guiones (p. ej. "maria-canals-2027"). Si te paso un dosier existente, reutiliza sus ids.',
    '7. No calcules si soy elegible: copia la regla de edad. Rango de nacimiento → nacidoDesde/nacidoHasta (inclusive; «nacidos después del 26-05-1995» = nacidoDesde 1995-05-27). Edad en una fecha → min/max/aFecha. «Menores de 30» → max 29. Sin límite → sinLimite true.',
    '',
    'Estructura:',
    '{ "formato": "dosier-concursos-piano", "version": 1, "generado": "AAAA-MM-DD", "autor": "…", "concursos": [ FICHA, … ] }',
    '',
    'FICHA:',
    '{ "id", "nombre", "edicion", "ciudad", "pais", "web",',
    '  "fechas": { "inicio", "fin", "nota" },',
    '  "plazo": { "fecha", "hora", "zona", "nota", "cerrado": false },',
    '  "cuota": { "importe", "moneda", "nota" },',
    '  "edad": { "min", "max", "aFecha", "nacidoDesde", "nacidoHasta", "texto", "sinLimite": false },',
    '  "video": { "exige": true|false|null, "duracion", "resumen", "detalles": [] },',
    '  "rondas": [ { "nombre", "fecha", "duracion", "repertorio": [] } ],',
    '  "premios": [ { "puesto", "importe", "moneda", "extra" } ], "premiosNota",',
    '  "jurado": [ "Nombre (país)" ], "juradoNota",',
    '  "alojamiento": { "estado": "si|parcial|no|desconocido", "texto" },',
    '  "viaje": { "estado": "si|parcial|no|desconocido", "texto" },',
    '  "otros": [], "estadoBases": "publicadas|parciales|pendientes|sin verificar",',
    '  "fuentes": [ { "titulo", "url", "consultado" } ], "verificado", "sinConfirmar": [] }',
  ].join('\n');

  const TEMPLATE = {
    formato: FORMAT, version: VERSION, generado: 'AAAA-MM-DD', autor: '',
    concursos: [{
      id: 'nombre-corto-2027', nombre: '', edicion: '', ciudad: '', pais: '', web: '',
      fechas: { inicio: null, fin: null, nota: '' },
      plazo: { fecha: null, hora: null, zona: null, nota: '', cerrado: false },
      cuota: { importe: null, moneda: 'EUR', nota: '' },
      edad: { min: null, max: null, aFecha: null, nacidoDesde: null, nacidoHasta: null, texto: '', sinLimite: false },
      video: { exige: null, duracion: null, resumen: '', detalles: [] },
      rondas: [{ nombre: 'Preselección (vídeo)', fecha: null, duracion: null, repertorio: [] }],
      premios: [{ puesto: '1.º', importe: null, moneda: 'EUR', extra: '' }], premiosNota: '',
      jurado: [], juradoNota: '',
      alojamiento: { estado: 'desconocido', texto: '' }, viaje: { estado: 'desconocido', texto: '' },
      otros: [], estadoBases: 'publicadas',
      fuentes: [{ titulo: '', url: 'https://', consultado: 'AAAA-MM-DD' }], verificado: null, sinConfirmar: [],
    }],
  };

  return { FORMAT, VERSION, AI_PROMPT, TEMPLATE, ageAt, todayISO, normalize, parse, fichaOf, merge, eligibility, deadlineStatus, compare, toPlan };
});

(function concursosDossierView() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const C = window.ConcursosDossierCore;
  const SEED_URL = 'data/concursos-dosier.json?v=481';
  const SEED_VERSION = '2026-10-02';
  const DEFAULT_BIRTH = '1999-02-19';
  let filter = 'mine';
  let sortBy = 'plazo';
  const open = new Set();
  let message = '';
  let seeding = null;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ready = () => { try { return typeof db !== 'undefined' && db && typeof db === 'object'; } catch (error) { return false; } };
  const view = () => document.getElementById('view-concursos');
  function state() {
    if (!db.concursosDosier || typeof db.concursosDosier !== 'object') db.concursosDosier = { concursos: [] };
    if (!Array.isArray(db.concursosDosier.concursos)) db.concursosDosier.concursos = [];
    return db.concursosDosier;
  }
  function birth() { return (db.perfil && db.perfil.fechaNacimiento) || ''; }
  function persist() {
    try { if (typeof saveData === 'function') saveData(); }
    catch (error) { console.error('[concursos] no se pudo guardar', error); }
  }
  function fmtDate(iso, opts) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', Object.assign({ timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }, opts || {}));
  }
  function fmtRange(a, b) {
    if (!a) return 'Fechas sin publicar';
    if (!b || a === b) return fmtDate(a);
    if (a.slice(0, 7) === b.slice(0, 7)) return `${Number(a.slice(8))}–${fmtDate(b)}`;
    if (a.slice(0, 4) === b.slice(0, 4)) return `${fmtDate(a, { year: undefined })} – ${fmtDate(b)}`;
    return `${fmtDate(a)} – ${fmtDate(b)}`;
  }
  function money(amount, currency) {
    if (amount == null) return '';
    try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(amount); }
    catch (error) { return `${amount.toLocaleString('es-ES')} ${currency || ''}`.trim(); }
  }
  const STAY = { si: 'Pagado', parcial: 'En parte', no: 'A tu cargo', desconocido: 'Sin datos' };

  function entries() {
    return state().concursos.map(record => ({ record, c: C.fichaOf(record) })).filter(x => x.c);
  }
  function planEvent(id) {
    try { return window.EventPlanning && window.EventPlanning.linkedDossierEvent ? window.EventPlanning.linkedDossierEvent(id) : null; }
    catch (error) { return null; }
  }

  async function ensureSeed() {
    if (!ready()) return;
    const s = state();
    if (!(db.perfil && db.perfil.fechaNacimiento)) {
      db.perfil = Object.assign({}, db.perfil, { fechaNacimiento: DEFAULT_BIRTH });
      persist();
    }
    if (String(s.seedVersion || '') >= SEED_VERSION || seeding) return;
    seeding = (async () => {
      try {
        const response = await fetch(SEED_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const parsed = C.parse(await response.text());
        const result = C.merge(state(), parsed.items, { origen: 'dosier 2026-10-02', onlyNewer: true });
        state().seedVersion = SEED_VERSION;
        persist();
        if (result.added || result.updated) render();
      } catch (error) {
        console.warn('[concursos] no se pudo cargar el dosier inicial', error);
      } finally { seeding = null; }
    })();
    return seeding;
  }

  function chip(kind, label, title) { return `<span class="cd-chip cd-${kind}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`; }

  function summaryHtml(c, record, today) {
    const dl = C.deadlineStatus(c, today);
    const el = C.eligibility(c, birth(), today);
    const ev = planEvent(c.id);
    const first = c.premios.find(p => p.importe != null);
    const chips = [
      chip('dl-' + dl.state, dl.state === 'urgent' || dl.state === 'soon' || dl.state === 'open' ? `${dl.label} · ${fmtDate(c.plazo.fecha, { year: undefined })}` : dl.label),
      chip('el-' + el.state, el.tentative && el.state !== 'unknown' ? el.label + ' (sin confirmar)' : el.label, el.detail),
      ev ? chip('plan', 'En tu plan') : '',
      record.interes === 'si' ? chip('fav', '★ Me interesa') : '',
      c.estadoBases === 'pendientes' ? chip('muted', 'Bases sin publicar') : '',
    ].join('');
    const facts = [
      ['Vídeo', c.video.exige === false ? 'No hace falta' : c.video.duracion || (c.video.exige ? 'Sí' : 'Sin datos')],
      ['1.er premio', first ? money(first.importe, first.moneda) : 'Sin datos'],
      ['Alojamiento', STAY[c.alojamiento.estado]],
      ['Cuota', c.cuota.importe != null ? money(c.cuota.importe, c.cuota.moneda) : 'Sin datos'],
    ];
    return `<div class="cd-chips">${chips}</div>
      <h3 class="cd-name">${esc(c.nombre)}</h3>
      <p class="cd-where">${esc([c.ciudad, c.pais].filter(Boolean).join(', '))} · ${esc(fmtRange(c.fechas.inicio, c.fechas.fin))}</p>
      <dl class="cd-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }

  function section(title, body, field, c) {
    if (!body) return '';
    const flag = field && c.sinConfirmar.includes(field) ? ' <span class="cd-unconfirmed">sin confirmar</span>' : '';
    return `<section class="cd-sec"><h4>${esc(title)}${flag}</h4>${body}</section>`;
  }
  const para = value => (value ? `<p>${esc(value)}</p>` : '');
  const bullets = items => (items && items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

  function detailHtml(c, record, today) {
    const el = C.eligibility(c, birth(), today);
    const ev = planEvent(c.id);
    const plazo = c.plazo.fecha ? `${fmtDate(c.plazo.fecha, { weekday: 'long' })}${c.plazo.hora ? `, ${c.plazo.hora}` : ''}${c.plazo.zona ? ` (${c.plazo.zona})` : ''}` : 'Sin publicar';
    const dates = `<p><b>Concurso:</b> ${esc(fmtRange(c.fechas.inicio, c.fechas.fin))}</p><p><b>Plazo:</b> ${esc(plazo)}</p>${para(c.fechas.nota)}${para(c.plazo.nota)}${c.cuota.importe != null || c.cuota.nota ? `<p><b>Cuota:</b> ${esc([money(c.cuota.importe, c.cuota.moneda), c.cuota.nota].filter(Boolean).join(' · '))}</p>` : ''}`;
    const age = `<p class="cd-age cd-el-${el.state}"><b>${esc(el.label)}</b>${el.detail ? ` · ${esc(el.detail)}` : ''}</p>${para(c.edad.texto)}`;
    const video = c.video.exige === false && !c.video.resumen ? '<p>No hace falta vídeo.</p>' : `${c.video.duracion ? `<p><b>Duración:</b> ${esc(c.video.duracion)}</p>` : ''}${para(c.video.resumen)}${bullets(c.video.detalles)}`;
    const rounds = c.rondas.length ? `<ol class="cd-rounds">${c.rondas.map(r => `<li><b>${esc(r.nombre)}</b>${r.fecha || r.duracion ? ` <span>${esc([r.fecha ? fmtDate(r.fecha) : '', r.duracion].filter(Boolean).join(' · '))}</span>` : ''}${bullets(r.repertorio)}</li>`).join('')}</ol>` : '';
    const prizes = c.premios.length ? `<table class="cd-prizes"><tbody>${c.premios.map(p => `<tr><th>${esc(p.puesto)}</th><td>${esc(money(p.importe, p.moneda))}</td><td>${esc(p.extra)}</td></tr>`).join('')}</tbody></table>` : '';
    const stay = `<p><b>Alojamiento · ${esc(STAY[c.alojamiento.estado])}.</b> ${esc(c.alojamiento.texto)}</p><p><b>Viaje · ${esc(STAY[c.viaje.estado])}.</b> ${esc(c.viaje.texto)}</p>`;
    const sources = `<ul class="cd-sources">${c.fuentes.map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.titulo || f.url)}</a>${f.consultado ? ` <span>· consultado el ${esc(fmtDate(f.consultado))}</span>` : ''}</li>`).join('')}</ul><p class="cd-verified">${c.verificado ? `Verificado en fuente oficial el ${esc(fmtDate(c.verificado))}.` : 'Sin verificar en fuente oficial.'} Importado el ${esc(fmtDate(String(record.importado || '').slice(0, 10)))}.</p>`;
    const mismatch = ev && c.fechas.inicio && (ev.fecha !== c.fechas.inicio || (c.plazo.fecha && ev.deadline && ev.deadline !== c.plazo.fecha));
    const plan = window.EventPlanning && window.EventPlanning.importDossierEntry
      ? (ev
        ? `<button type="button" data-action="open-plan" data-id="${esc(c.id)}">Abrir en el plan</button>${mismatch ? `<button type="button" data-action="sync-plan" data-id="${esc(c.id)}">Actualizar fechas del plan</button><p class="cd-warn">Tu plan dice ${esc(fmtDate(ev.fecha))}${ev.deadline ? `, plazo ${esc(fmtDate(ev.deadline))}` : ''}; el dosier, ${esc(fmtDate(c.fechas.inicio))}${c.plazo.fecha ? `, plazo ${esc(fmtDate(c.plazo.fecha))}` : ''}.</p>` : ''}`
        : (c.fechas.inicio ? `<button type="button" class="cd-primary" data-action="add-plan" data-id="${esc(c.id)}">Añadir a mi plan</button>` : ''))
      : '';
    const interest = record.interes === 'si'
      ? `<button type="button" data-action="interest" data-value="" data-id="${esc(c.id)}">Quitar «Me interesa»</button>`
      : `<button type="button" data-action="interest" data-value="si" data-id="${esc(c.id)}">★ Me interesa</button>`;
    const discard = record.interes === 'no'
      ? `<button type="button" data-action="interest" data-value="" data-id="${esc(c.id)}">Recuperar</button>`
      : `<button type="button" data-action="interest" data-value="no" data-id="${esc(c.id)}">No me interesa</button>`;
    const pending = c.sinConfirmar.length ? `<p class="cd-warn">Sin confirmar en las bases: ${esc(c.sinConfirmar.join(', '))}.</p>` : '';
    return `<div class="cd-detail">${pending}
      ${section('Fechas, plazo y cuota', dates, 'plazo', c)}
      ${section('Edad', age, 'edad', c)}
      ${section('Vídeo de preselección', video, 'video', c)}
      ${section('Rondas y repertorio', rounds, 'rondas', c)}
      ${section('Premios', prizes + para(c.premiosNota), 'premios', c)}
      ${section('Jurado', bullets(c.jurado) + para(c.juradoNota), 'jurado', c)}
      ${section('Alojamiento y viaje', stay, 'alojamiento', c)}
      ${section('Otros requisitos', bullets(c.otros))}
      ${section('Fuentes', sources)}
      <div class="cd-actions">${plan}${interest}${discard}</div></div>`;
  }

  function visible(c, record, today) {
    const dl = C.deadlineStatus(c, today).state;
    const gone = dl === 'closed' || dl === 'finished' || record.interes === 'no';
    if (filter === 'archive') return gone;
    if (gone) return false;
    if (filter === 'mine') return C.eligibility(c, birth(), today).state !== 'no';
    return true;
  }

  function render() {
    const host = view();
    if (!host || !ready() || !C) return;
    const today = C.todayISO();
    const all = entries();
    const sorter = sortBy === 'fecha'
      ? (a, b) => String(a.c.fechas.inicio || '9999').localeCompare(String(b.c.fechas.inicio || '9999')) || a.c.nombre.localeCompare(b.c.nombre)
      : (a, b) => C.compare(a.c, b.c, today);
    const shown = all.filter(x => visible(x.c, x.record, today)).sort(sorter);
    const b = birth();
    const counts = { mine: 0, all: 0, archive: 0 };
    all.forEach(x => {
      const dl = C.deadlineStatus(x.c, today).state;
      const gone = dl === 'closed' || dl === 'finished' || x.record.interes === 'no';
      if (gone) counts.archive += 1;
      else { counts.all += 1; if (C.eligibility(x.c, b, today).state !== 'no') counts.mine += 1; }
    });
    const age = b ? C.ageAt(b, today) : null;
    const scrollY = window.scrollY;
    host.innerHTML = `
      <section class="cd-profile">
        <label>Fecha de nacimiento <input type="date" id="cdBirth" value="${esc(b)}" max="${esc(today)}"></label>
        <p>${age != null ? `Tienes <b>${age} años</b>. La elegibilidad se calcula con la regla exacta de cada concurso.` : 'Pon tu fecha de nacimiento para saber a qué concursos puedes ir.'}</p>
      </section>
      <div class="cd-toolbar">
        <div class="cd-segment" role="tablist" aria-label="Filtro">
          ${[['mine', 'Para mí'], ['all', 'Todos'], ['archive', 'Archivo']].map(([key, label]) => `<button type="button" role="tab" aria-selected="${filter === key}" class="${filter === key ? 'active' : ''}" data-action="filter" data-value="${key}">${label} <span>${counts[key]}</span></button>`).join('')}
        </div>
        <label class="cd-sort">Ordenar <select id="cdSort"><option value="plazo"${sortBy === 'plazo' ? ' selected' : ''}>por plazo</option><option value="fecha"${sortBy === 'fecha' ? ' selected' : ''}>por fecha del concurso</option></select></label>
      </div>
      <div class="cd-tools">
        <label class="cd-file">Importar dosier<input type="file" id="cdImport" accept=".json,application/json"></label>
        <button type="button" data-action="export">Exportar</button>
        <button type="button" data-action="ai">Instrucciones para la IA</button>
      </div>
      <p class="cd-message" id="cdMessage" role="status"${message ? '' : ' hidden'}>${esc(message)}</p>
      <div class="cd-list">${shown.length ? shown.map(({ c, record }) => `
        <details class="cd-card" data-id="${esc(c.id)}"${open.has(c.id) ? ' open' : ''}>
          <summary>${summaryHtml(c, record, today)}</summary>
          ${open.has(c.id) ? detailHtml(c, record, today) : ''}
        </details>`).join('') : `<p class="cd-empty">${all.length ? (filter === 'archive' ? 'No hay concursos cerrados ni descartados.' : 'No hay concursos en esta lista.') : (seeding ? 'Cargando el dosier…' : 'Aún no hay concursos. Importa un dosier.')}</p>`}</div>
      <dialog class="cd-dialog" id="cdAiDialog" aria-label="Instrucciones para la IA">
        <h2>Instrucciones para la IA</h2>
        <p>Copia este texto en la IA (y, si quieres que actualice lo que ya tienes, adjunta el archivo de «Exportar»). Lo que te devuelva se importa con «Importar dosier».</p>
        <textarea readonly rows="14">${esc(C.AI_PROMPT)}</textarea>
        <div class="cd-actions"><button type="button" class="cd-primary" data-action="copy-ai">Copiar</button><button type="button" data-action="template">Descargar plantilla</button><button type="button" data-action="close-ai">Cerrar</button></div>
      </dialog>`;
    if (document.body.getAttribute('data-view') === 'concursos') window.scrollTo(0, scrollY);
  }

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function say(text) { message = text; const el = document.getElementById('cdMessage'); if (el) { el.textContent = text; el.hidden = !text; } }

  async function importFile(file) {
    if (file.size > 3 * 1024 * 1024) throw new Error('El archivo supera 3 MB.');
    const parsed = C.parse(await file.text());
    if (!parsed.items.length) throw new Error(parsed.errors.join(' ') || 'No hay fichas válidas.');
    const result = C.merge(state(), parsed.items, { origen: file.name });
    persist();
    const parts = [];
    if (result.added) parts.push(`${result.added} nuevo${result.added === 1 ? '' : 's'}`);
    if (result.updated) parts.push(`${result.updated} actualizado${result.updated === 1 ? '' : 's'}`);
    if (result.unchanged) parts.push(`${result.unchanged} sin cambios`);
    message = `Dosier importado: ${parts.join(', ')}.${parsed.errors.length ? ` Ignorado: ${parsed.errors.join(' ')}` : ''}`;
    render();
  }

  function action(button) {
    const id = button.dataset.id;
    const record = id ? state().concursos.find(item => item.id === id) : null;
    const c = record ? C.fichaOf(record) : null;
    switch (button.dataset.action) {
      case 'filter': filter = button.dataset.value; render(); return;
      case 'interest':
        if (!record) return;
        record.interes = button.dataset.value || null;
        persist(); render(); return;
      case 'add-plan': {
        if (!c) return;
        const ev = window.EventPlanning.importDossierEntry(C.toPlan(c));
        say(ev ? `«${c.nombre}» está en tu plan (Standby), con su plazo.` : 'No se pudo añadir al plan.');
        render(); return;
      }
      case 'sync-plan':
        if (c && window.EventPlanning.syncDossierDates(C.toPlan(c))) { say('Fechas del plan actualizadas con el dosier.'); render(); }
        return;
      case 'open-plan': {
        const ev = c && planEvent(c.id);
        if (ev && typeof openEditEvento === 'function') openEditEvento(ev.id);
        return;
      }
      case 'export':
        download(`dosier-concursos-${C.todayISO()}.json`, { formato: C.FORMAT, version: C.VERSION, generado: C.todayISO(), autor: 'Exportado desde la app', concursos: entries().map(x => x.c) });
        return;
      case 'ai': { const dialog = document.getElementById('cdAiDialog'); if (dialog && dialog.showModal) dialog.showModal(); else if (dialog) dialog.setAttribute('open', ''); return; }
      case 'close-ai': { const dialog = document.getElementById('cdAiDialog'); if (dialog) { if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); } return; }
      case 'copy-ai':
        (navigator.clipboard ? navigator.clipboard.writeText(C.AI_PROMPT) : Promise.reject())
          .then(() => { button.textContent = 'Copiado'; })
          .catch(() => { const area = button.closest('dialog').querySelector('textarea'); area.select(); button.textContent = 'Selecciónalo y cópialo'; });
        return;
      case 'template': download('plantilla-dosier-concursos.json', C.TEMPLATE); return;
      default:
    }
  }

  function init() {
    const host = view();
    if (!host) return;
    host.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (button && host.contains(button)) { event.preventDefault(); action(button); }
    });
    host.addEventListener('toggle', event => {
      const card = event.target.closest && event.target.closest('details.cd-card');
      if (!card) return;
      const id = card.dataset.id;
      const wasOpen = open.has(id);
      if (card.open === wasOpen) return;
      if (card.open) open.add(id); else open.delete(id);
      if (card.open) {
        const record = state().concursos.find(item => item.id === id);
        const c = record && C.fichaOf(record);
        if (c && !card.querySelector('.cd-detail')) card.insertAdjacentHTML('beforeend', detailHtml(c, record, C.todayISO()));
      }
    }, true);
    host.addEventListener('change', event => {
      if (event.target.id === 'cdBirth') {
        const value = event.target.value;
        if (!value) return;
        db.perfil = Object.assign({}, db.perfil, { fechaNacimiento: value });
        persist(); render();
      } else if (event.target.id === 'cdSort') { sortBy = event.target.value; render(); }
      else if (event.target.id === 'cdImport' && event.target.files && event.target.files[0]) {
        importFile(event.target.files[0]).catch(error => { say('No se pudo importar: ' + error.message); });
      }
    });
    window.addEventListener('app:viewchange', event => {
      if (event.detail && event.detail.name === 'concursos') { render(); ensureSeed(); }
    });
    window.addEventListener('storage', event => {
      if (event.key === 'alberto_piano_v2' && document.body.getAttribute('data-view') === 'concursos') render();
    });
    const boot = attempt => {
      if (ready()) { ensureSeed().then(() => { if (document.body.getAttribute('data-view') === 'concursos') render(); }); render(); return; }
      if (attempt < 100) setTimeout(() => boot(attempt + 1), 100);
    };
    boot(0);
  }

  window.ConcursosDossier = { open: () => (typeof showView === 'function' ? showView('concursos') : null), render, ensureSeed };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
