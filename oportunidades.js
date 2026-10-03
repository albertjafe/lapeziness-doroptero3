/* Oportunidades (03-10-2026): festivales, becas y seguimiento de contactos,
 * en pestañas junto al dosier de concursos (vista #view-concursos).
 *
 * db.oportunidades = {
 *   fichas: [{ id, tipo, ficha, importado, origen, interes }]
 *     · ficha: la ficha completa como TEXTO JSON, igual que en concursos: al
 *       reimportar se sustituye entera (formato en
 *       docs/DOSIER_OPORTUNIDADES_FORMATO.md).
 *     · interes: 'si' | 'no' | null (de la persona; no se pisa al importar).
 *   contactos: [{ id, nombre, tipo, persona, email, telefono, nota,
 *                 oportunidadId, estado, enviado, ultimoContacto, proximo,
 *                 creado, archivado }]
 *     · Se archivan, no se borran: así ninguna copia vieja los resucita y
 *       queda el historial de a quién se escribió.
 *   seedVersion
 * }
 * La edad se calcula con la regla de concursos (ConcursosDossierCore). */
(function(root, factory) {
  const concursos = typeof module !== 'undefined' && module.exports ? require('./concursos-dossier') : root.ConcursosDossierCore;
  const api = factory(concursos);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OportunidadesCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function(CD) {
  'use strict';
  const FORMAT = 'dosier-oportunidades';
  const VERSION = 1;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const ID = /^[a-z0-9][a-z0-9-]{1,80}$/;
  const TIPOS = { festival: 'Festivales y ciclos', beca: 'Becas y ayudas' };
  const VIAS = { convocatoria: 'Convocatoria', audicion: 'Audición', propuesta: 'Propuesta', nominacion: 'Nominación', organizador: 'La pide quien te invita' };
  const isoOrNull = value => (typeof value === 'string' && ISO.test(value) ? value : null);
  const text = (value, max = 4000) => (value == null ? '' : String(value).trim().slice(0, max));
  const list = (value, max = 200) => (Array.isArray(value) ? value : []).slice(0, max);
  const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const obj = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  const strings = (value, max, len) => list(value, max).map(x => text(x, len)).filter(Boolean);

  function todayISO(now = new Date()) {
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  }
  function addDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
  }
  function daysBetween(from, to) {
    const t = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(to) - t(from)) / 86400000);
  }

  // Una ficha de la IA → forma completa, sin campos inventados.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Una ficha no es un objeto.');
    const id = text(raw.id, 90).toLowerCase();
    if (!ID.test(id)) throw new Error(`Id no válido: «${text(raw.id, 40) || '(vacío)'}» (usa minúsculas, números y guiones).`);
    const nombre = text(raw.nombre, 200);
    if (!nombre) throw new Error(`Falta el nombre de «${id}».`);
    const tipo = text(raw.tipo, 20);
    if (!TIPOS[tipo]) throw new Error(`«${id}»: el tipo tiene que ser "festival" o "beca".`);
    const via = obj(raw.via), plazo = obj(raw.plazo), fechas = obj(raw.fechas), dotacion = obj(raw.dotacion), edad = obj(raw.edad), envio = obj(raw.envio), contacto = obj(raw.contacto);
    const url = value => { const v = text(value, 500); return /^https?:\/\//.test(v) ? v : null; };
    return {
      id, tipo, nombre,
      entidad: text(raw.entidad, 200), ciudad: text(raw.ciudad, 120), pais: text(raw.pais, 80), web: url(raw.web) || '',
      resumen: text(raw.resumen, 1200),
      via: { tipo: VIAS[via.tipo] ? via.tipo : 'convocatoria', texto: text(via.texto, 800) },
      plazo: { fecha: isoOrNull(plazo.fecha), nota: text(plazo.nota, 800), cerrado: plazo.cerrado === true, abierto: plazo.abierto === true, recurrente: text(plazo.recurrente, 120) },
      fechas: { inicio: isoOrNull(fechas.inicio), fin: isoOrNull(fechas.fin), nota: text(fechas.nota, 600) },
      dotacion: { importe: num(dotacion.importe), moneda: text(dotacion.moneda, 3).toUpperCase() || null, nota: text(dotacion.nota, 600) },
      edad: {
        min: num(edad.min), max: num(edad.max), aFecha: isoOrNull(edad.aFecha),
        nacidoDesde: isoOrNull(edad.nacidoDesde), nacidoHasta: isoOrNull(edad.nacidoHasta),
        texto: text(edad.texto, 800), sinLimite: edad.sinLimite === true,
      },
      requisitos: strings(raw.requisitos, 20, 600),
      envio: { resumen: text(envio.resumen, 800), documentos: strings(envio.documentos, 20, 200), email: text(envio.email, 200) || null, url: url(envio.url) },
      contacto: { nombre: text(contacto.nombre, 200) || null, email: text(contacto.email, 200) || null, telefono: text(contacto.telefono, 60) || null },
      otros: strings(raw.otros, 20, 600),
      estadoBases: text(raw.estadoBases, 40) || 'sin verificar',
      fuentes: list(raw.fuentes, 12).map(f => ({ titulo: text(f && f.titulo, 200), url: text(f && f.url, 500), consultado: isoOrNull(f && f.consultado) })).filter(f => /^https?:\/\//.test(f.url)),
      verificado: isoOrNull(raw.verificado),
      sinConfirmar: strings(raw.sinConfirmar, 20, 40),
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
    else if (doc && Array.isArray(doc.oportunidades)) {
      if (doc.formato && doc.formato !== FORMAT) throw new Error(`Formato «${doc.formato}» desconocido (se esperaba «${FORMAT}»).`);
      if (doc.version && Number(doc.version) > VERSION) throw new Error(`Versión ${doc.version} del formato: actualiza la app.`);
      items = doc.oportunidades;
    } else if (doc && doc.formato === 'dosier-concursos-piano') throw new Error('Es un dosier de concursos: impórtalo en la pestaña Concursos.');
    else if (doc && doc.id && doc.nombre) items = [doc];
    else throw new Error('No encuentro festivales ni becas en el archivo.');
    if (!items.length) throw new Error('El archivo no trae fichas.');
    const out = [], errors = [], seen = new Set();
    items.slice(0, 300).forEach((raw, index) => {
      try {
        const item = normalize(raw);
        if (seen.has(item.id)) throw new Error(`«${item.id}» aparece dos veces.`);
        seen.add(item.id);
        out.push(item);
      } catch (error) { errors.push(`Ficha ${index + 1}: ${error.message}`); }
    });
    return { items: out, errors };
  }

  function fichaOf(record) {
    if (!record || typeof record.ficha !== 'string') return null;
    try { return normalize(JSON.parse(record.ficha)); } catch (error) { return null; }
  }

  // Importar: añade lo nuevo y sustituye la ficha de lo que ya estaba; nunca
  // toca el interés. onlyNewer (dosier inicial): no pisa una ficha verificada después.
  function merge(state, items, { origen = 'importado', now = new Date().toISOString(), onlyNewer = false } = {}) {
    state.fichas = Array.isArray(state.fichas) ? state.fichas : [];
    const byId = new Map(state.fichas.map(record => [record.id, record]));
    const result = { added: 0, updated: 0, unchanged: 0 };
    items.forEach(item => {
      const ficha = JSON.stringify(item);
      const record = byId.get(item.id);
      if (!record) {
        state.fichas.push({ id: item.id, tipo: item.tipo, ficha, importado: now, origen, interes: null });
        result.added += 1;
        return;
      }
      if (record.ficha === ficha) { result.unchanged += 1; return; }
      const current = fichaOf(record);
      if (onlyNewer && current && current.verificado && (!item.verificado || item.verificado < current.verificado)) { result.unchanged += 1; return; }
      record.ficha = ficha;
      record.tipo = item.tipo;
      record.importado = now;
      record.origen = origen;
      result.updated += 1;
    });
    return result;
  }

  function deadlineStatus(o, today = todayISO()) {
    const end = o.fechas && (o.fechas.fin || o.fechas.inicio);
    const fecha = o.plazo && o.plazo.fecha;
    if (end && end < today && !(fecha && fecha >= today)) return { state: 'finished', label: 'Terminado', days: null };
    if (fecha) {
      const days = daysBetween(today, fecha);
      if (days < 0) return { state: 'closed', label: 'Plazo cerrado', days };
      const label = days === 0 ? 'Cierra hoy' : days === 1 ? 'Cierra mañana' : `Cierra en ${days} días`;
      return { state: days <= 14 ? 'urgent' : days <= 45 ? 'soon' : 'open', label, days };
    }
    if (o.plazo && o.plazo.cerrado) return { state: 'closed', label: 'Plazo cerrado', days: null };
    if (o.plazo && o.plazo.abierto) return { state: 'rolling', label: 'Abierto todo el año', days: null };
    return { state: 'pending', label: o.plazo && o.plazo.recurrente ? `Próximo plazo: ${o.plazo.recurrente.toLowerCase()}` : 'Plazo sin publicar', days: null };
  }

  function eligibility(o, birth, today = todayISO()) {
    if (CD && CD.eligibility) return CD.eligibility(o, birth, today);
    return { state: 'unknown', label: 'Edad sin confirmar', detail: '' };
  }

  const RANK = { urgent: 0, soon: 0, open: 0, rolling: 1, pending: 2, closed: 3, finished: 4 };
  function compare(a, b, today = todayISO()) {
    const sa = deadlineStatus(a, today), sb = deadlineStatus(b, today);
    return RANK[sa.state] - RANK[sb.state]
      || String(a.plazo.fecha || '9999').localeCompare(String(b.plazo.fecha || '9999'))
      || a.nombre.localeCompare(b.nombre);
  }

  // ── Seguimiento de contactos ────────────────────────────────────────────
  const ESTADOS = {
    pendiente: 'Por contactar', enviado: 'Enviado', llamado: 'Llamado',
    conversando: 'En conversación', cerrado: 'Concierto cerrado', descartado: 'No sale',
  };
  const CONTACT_TIPOS = { ayuntamiento: 'Ayuntamiento', festival: 'Festival o ciclo', beca: 'Beca', otro: 'Otro' };
  const FOLLOW_UP_DAYS = 7;
  const SUGERIDOS = [
    { nombre: 'Ayuntamiento de Manzanares', nota: '' },
    { nombre: 'Ayuntamiento de Valdepeñas', nota: '' },
    { nombre: 'Ayuntamiento de Alcázar de San Juan', nota: '' },
    { nombre: 'Ayuntamiento de Tomelloso', nota: '' },
    { nombre: 'Ayuntamiento de Daimiel', nota: '' },
    { nombre: 'Ayuntamiento de La Solana', nota: '' },
    { nombre: 'Ayuntamiento de Membrilla', nota: '' },
    { nombre: 'Ayuntamiento de Pedro Muñoz', nota: 'Ya tocaste allí tras ganar su concurso: dilo en la primera línea del email.' },
  ];

  function newContact(fields, now = new Date()) {
    const f = obj(fields);
    const nombre = text(f.nombre, 200);
    if (!nombre) throw new Error('Pon al menos el nombre.');
    const stamp = now.toISOString();
    return {
      id: `ct-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      nombre, tipo: CONTACT_TIPOS[f.tipo] ? f.tipo : 'ayuntamiento',
      persona: text(f.persona, 200), email: text(f.email, 200), telefono: text(f.telefono, 60), nota: text(f.nota, 1000),
      oportunidadId: text(f.oportunidadId, 90) || null,
      estado: 'pendiente', enviado: null, ultimoContacto: null, proximo: null,
      creado: stamp, archivado: false,
    };
  }

  // Cambia el estado y deja anotado cuándo toca el siguiente paso.
  function setEstado(contact, estado, today = todayISO()) {
    if (!ESTADOS[estado]) return contact;
    contact.estado = estado;
    if (estado === 'enviado') {
      contact.enviado = contact.enviado || today;
      contact.ultimoContacto = today;
      contact.proximo = addDays(today, FOLLOW_UP_DAYS);
    } else if (estado === 'llamado') {
      contact.ultimoContacto = today;
      contact.proximo = addDays(today, FOLLOW_UP_DAYS);
    } else if (estado === 'conversando') {
      contact.ultimoContacto = today;
      contact.proximo = null;
    } else if (estado === 'cerrado' || estado === 'descartado') {
      contact.proximo = null;
    }
    return contact;
  }

  function nextStep(contact, today = todayISO()) {
    const c = obj(contact);
    const due = !!(c.proximo && c.proximo <= today);
    switch (c.estado) {
      case 'pendiente': return { text: c.email ? 'Enviar el email' : 'Buscar el contacto y enviar el email', due: true };
      case 'enviado':
      case 'llamado':
        return due
          ? { text: `Llamar: sin respuesta desde el ${c.ultimoContacto || c.enviado || c.proximo}`, due: true, date: c.proximo }
          : { text: c.proximo ? `Esperar respuesta hasta el ${c.proximo}` : 'Esperar respuesta', due: false, date: c.proximo };
      case 'conversando':
        return due ? { text: 'Retomar la conversación', due: true, date: c.proximo } : { text: 'Cerrar fecha, caché y piano', due: false, date: c.proximo };
      case 'cerrado': return { text: 'Concierto cerrado', due: false, done: true };
      case 'descartado': return { text: 'No sale por ahora', due: false, done: true };
      default: return { text: '', due: false };
    }
  }

  function compareContacts(a, b, today = todayISO()) {
    const na = nextStep(a, today), nb = nextStep(b, today);
    const rank = (c, n) => (n.done ? 3 : n.due ? (c.estado === 'pendiente' ? 1 : 0) : 2);
    return rank(a, na) - rank(b, nb)
      || String(a.proximo || '9999').localeCompare(String(b.proximo || '9999'))
      || String(a.nombre).localeCompare(String(b.nombre));
  }

  function followSummary(contacts, today = todayISO()) {
    const active = (contacts || []).filter(c => !c.archivado);
    const due = active.filter(c => nextStep(c, today).due).length;
    const closed = active.filter(c => c.estado === 'cerrado').length;
    const pending = active.filter(c => c.estado === 'pendiente').length;
    // calls = seguimientos que ya tocan (llamar o retomar); los «Por contactar» van aparte.
    return { total: active.length, due, calls: due - pending, pending, closed, open: active.filter(c => !['cerrado', 'descartado'].includes(c.estado)).length };
  }

  const AI_PROMPT = [
    'Investiga en las webs oficiales festivales, ciclos de conciertos y becas para un pianista clásico (los que te indique, o los que tengan una vía de entrada clara: convocatoria, audición o propuestas aceptadas expresamente) y devuélveme UN ÚNICO archivo JSON con el formato «dosier-oportunidades», versión 1.',
    '',
    'Reglas:',
    '1. Solo fuentes oficiales (web de la entidad, PDF de bases, BOE o boletines). Nada de blogs ni agregadores.',
    '2. No inventes nada. Si un dato no está publicado, pon null (o lista vacía) y añade el nombre del campo a "sinConfirmar". Si usas una edición anterior como referencia, dilo en el texto («Referencia 2025: …»).',
    '3. Fechas AAAA-MM-DD. Importes como número y moneda en código ISO (EUR, USD, GBP, CHF).',
    '4. Textos en español, breves y concretos.',
    '5. "tipo": "festival" (festivales, ciclos, salas, programas de conciertos) o "beca" (becas y ayudas económicas).',
    '6. "via.tipo": "convocatoria", "audicion", "propuesta", "nominacion" u "organizador" (cuando la pide quien te invita).',
    '7. "plazo.abierto": true si aceptan solicitudes todo el año; "plazo.recurrente" para decir cuándo suele abrir («Anual, en enero»).',
    '8. No calcules si soy elegible: copia la regla de edad (min/max/aFecha, nacidoDesde/nacidoHasta o sinLimite).',
    '9. Cada ficha con al menos una fuente (URL exacta y fecha de consulta) y "verificado" con el día que lo comprobaste.',
    '10. "id" estable en minúsculas con guiones. Si te paso un dosier existente, reutiliza sus ids.',
    '',
    'Estructura:',
    '{ "formato": "dosier-oportunidades", "version": 1, "generado": "AAAA-MM-DD", "autor": "…", "oportunidades": [ FICHA, … ] }',
    '',
    'FICHA:',
    '{ "id", "tipo": "festival|beca", "nombre", "entidad", "ciudad", "pais", "web", "resumen",',
    '  "via": { "tipo", "texto" },',
    '  "plazo": { "fecha", "nota", "cerrado": false, "abierto": false, "recurrente" },',
    '  "fechas": { "inicio", "fin", "nota" },',
    '  "dotacion": { "importe", "moneda", "nota" },',
    '  "edad": { "min", "max", "aFecha", "nacidoDesde", "nacidoHasta", "texto", "sinLimite": false },',
    '  "requisitos": [], "envio": { "resumen", "documentos": [], "email", "url" },',
    '  "contacto": { "nombre", "email", "telefono" }, "otros": [],',
    '  "estadoBases": "publicadas|parciales|pendientes|sin verificar",',
    '  "fuentes": [ { "titulo", "url", "consultado" } ], "verificado", "sinConfirmar": [] }',
  ].join('\n');

  const TEMPLATE = {
    formato: FORMAT, version: VERSION, generado: 'AAAA-MM-DD', autor: '',
    oportunidades: [{
      id: 'nombre-corto-2027', tipo: 'festival', nombre: '', entidad: '', ciudad: '', pais: '', web: '', resumen: '',
      via: { tipo: 'convocatoria', texto: '' },
      plazo: { fecha: null, nota: '', cerrado: false, abierto: false, recurrente: '' },
      fechas: { inicio: null, fin: null, nota: '' },
      dotacion: { importe: null, moneda: 'EUR', nota: '' },
      edad: { min: null, max: null, aFecha: null, nacidoDesde: null, nacidoHasta: null, texto: '', sinLimite: false },
      requisitos: [], envio: { resumen: '', documentos: [], email: null, url: null },
      contacto: { nombre: null, email: null, telefono: null }, otros: [],
      estadoBases: 'publicadas', fuentes: [{ titulo: '', url: 'https://', consultado: 'AAAA-MM-DD' }], verificado: null, sinConfirmar: [],
    }],
  };

  return {
    FORMAT, VERSION, TIPOS, VIAS, ESTADOS, CONTACT_TIPOS, FOLLOW_UP_DAYS, SUGERIDOS, AI_PROMPT, TEMPLATE,
    todayISO, addDays, normalize, parse, fichaOf, merge, deadlineStatus, eligibility, compare,
    newContact, setEstado, nextStep, compareContacts, followSummary,
  };
});

(function oportunidadesView() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const O = window.OportunidadesCore;
  const SEED_URL = 'data/oportunidades-dosier.json?v=483';
  const SEED_VERSION = '2026-10-03';
  const TAB_KEY = 'alberto_oportunidades_tab';
  const TABS = [['concursos', 'Concursos'], ['festival', 'Festivales'], ['beca', 'Becas'], ['seguimiento', 'Seguimiento']];
  const STAY_TAB = new Set(TABS.map(t => t[0]));
  const FIELD_LABELS = { via: 'vía de entrada', plazo: 'plazo', fechas: 'fechas', dotacion: 'dotación', edad: 'edad', requisitos: 'requisitos', envio: 'qué enviar', contacto: 'contacto', web: 'web' };
  let tab = 'concursos';
  try { const saved = localStorage.getItem(TAB_KEY); if (STAY_TAB.has(saved)) tab = saved; } catch (error) { /* sin almacenamiento */ }
  const filters = { festival: 'mine', beca: 'mine', seguimiento: 'active' };
  const open = new Set();
  let editing = null;
  let message = '';
  let seeding = null;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ready = () => { try { return typeof db !== 'undefined' && db && typeof db === 'object'; } catch (error) { return false; } };
  const host = () => document.getElementById('view-concursos');
  const panel = () => document.getElementById('opPanel');
  function state() {
    if (!db.oportunidades || typeof db.oportunidades !== 'object') db.oportunidades = { fichas: [], contactos: [] };
    if (!Array.isArray(db.oportunidades.fichas)) db.oportunidades.fichas = [];
    if (!Array.isArray(db.oportunidades.contactos)) db.oportunidades.contactos = [];
    return db.oportunidades;
  }
  function birth() { return (db.perfil && db.perfil.fechaNacimiento) || ''; }
  function persist() {
    try { if (typeof saveData === 'function') saveData(); }
    catch (error) { console.error('[oportunidades] no se pudo guardar', error); }
  }
  function fmtDate(iso, opts) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', Object.assign({ timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }, opts || {}));
  }
  function money(amount, currency) {
    if (amount == null) return '';
    try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0 }).format(amount); }
    catch (error) { return `${amount.toLocaleString('es-ES')} ${currency || ''}`.trim(); }
  }
  const chip = (kind, label, title) => `<span class="cd-chip cd-${kind}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
  const para = value => (value ? `<p>${esc(value)}</p>` : '');
  const bullets = items => (items && items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  // Las fechas que el seguimiento guarda (AAAA-MM-DD) se enseñan en corto.
  const humanize = value => String(value || '').replace(/\d{4}-\d{2}-\d{2}/g, iso => fmtDate(iso, { year: undefined }));

  function entries(tipo) {
    return state().fichas.map(record => ({ record, o: O.fichaOf(record) })).filter(x => x.o && (!tipo || x.o.tipo === tipo));
  }
  function contactFor(id) { return state().contactos.find(c => c.oportunidadId === id && !c.archivado) || null; }
  function gone(o, record, today) {
    const st = O.deadlineStatus(o, today).state;
    return st === 'closed' || st === 'finished' || record.interes === 'no';
  }

  async function ensureSeed() {
    if (!ready()) return;
    const s = state();
    if (String(s.seedVersion || '') >= SEED_VERSION || seeding) return seeding;
    seeding = (async () => {
      try {
        const response = await fetch(SEED_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const parsed = O.parse(await response.text());
        const result = O.merge(state(), parsed.items, { origen: 'dosier 2026-10-03', onlyNewer: true });
        state().seedVersion = SEED_VERSION;
        persist();
        if (result.added || result.updated) render();
      } catch (error) {
        console.warn('[oportunidades] no se pudo cargar el dosier inicial', error);
      } finally { seeding = null; }
    })();
    return seeding;
  }

  // ── Pestañas ─────────────────────────────────────────────────────────────
  function counts(today) {
    const out = { concursos: 0, festival: 0, beca: 0, seguimiento: 0 };
    try {
      const C = window.ConcursosDossierCore;
      const records = (db.concursosDosier && db.concursosDosier.concursos) || [];
      records.forEach(record => {
        const c = C && C.fichaOf(record);
        if (!c) return;
        const st = C.deadlineStatus(c, today).state;
        if (st !== 'closed' && st !== 'finished' && record.interes !== 'no') out.concursos += 1;
      });
    } catch (error) { /* el dosier de concursos aún no ha cargado */ }
    entries().forEach(({ o, record }) => { if (!gone(o, record, today)) out[o.tipo] += 1; });
    out.seguimiento = O.followSummary(state().contactos, today).calls;
    return out;
  }
  function renderTabs(today) {
    const bar = document.getElementById('opTabs');
    if (!bar) return;
    const n = counts(today);
    bar.innerHTML = TABS.map(([key, label]) => {
      const badge = key === 'seguimiento' ? (n.seguimiento ? `<span class="op-tab-due">${n.seguimiento}</span>` : '') : `<span>${n[key]}</span>`;
      return `<button type="button" role="tab" id="opTab-${key}" aria-selected="${tab === key}" aria-controls="${key === 'concursos' ? 'cdPanel' : 'opPanel'}" class="op-tab${tab === key ? ' active' : ''}" data-op-tab="${key}">${label} ${badge}</button>`;
    }).join('');
  }

  // ── Festivales y becas ───────────────────────────────────────────────────
  function summaryHtml(o, record, today) {
    const dl = O.deadlineStatus(o, today);
    const el = O.eligibility(o, birth(), today);
    const followed = contactFor(o.id);
    const chips = [
      chip('dl-' + dl.state, ['urgent', 'soon', 'open'].includes(dl.state) ? `${dl.label} · ${fmtDate(o.plazo.fecha, { year: undefined })}` : dl.label),
      chip('el-' + el.state, el.tentative && el.state !== 'unknown' ? el.label + ' (sin confirmar)' : el.label, el.detail),
      chip('muted', O.VIAS[o.via.tipo]),
      followed ? chip('plan', 'En seguimiento') : '',
      record.interes === 'si' ? chip('fav', '★ Me interesa') : '',
    ].join('');
    const facts = [
      ['Plazo', o.plazo.fecha ? fmtDate(o.plazo.fecha) : (o.plazo.abierto ? 'Todo el año' : (o.plazo.recurrente || 'Sin publicar'))],
      [o.tipo === 'beca' ? 'Dotación' : 'Qué ofrece', o.dotacion.importe != null ? `${o.dotacion.importe >= 1000 && o.tipo === 'beca' ? 'Hasta ' : ''}${money(o.dotacion.importe, o.dotacion.moneda)}` : (o.dotacion.nota ? o.dotacion.nota.split(/[.:]/)[0] : 'Sin datos')],
      ['Vía', O.VIAS[o.via.tipo]],
      ['Dónde', [o.ciudad, o.pais].filter(Boolean).join(', ') || '—'],
    ];
    return `<div class="cd-chips">${chips}</div>
      <h3 class="cd-name">${esc(o.nombre)}</h3>
      <p class="cd-where">${esc(o.entidad)}</p>
      <dl class="cd-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }

  function section(title, body, field, o) {
    if (!body) return '';
    const flag = field && o.sinConfirmar.includes(field) ? ' <span class="cd-unconfirmed">sin confirmar</span>' : '';
    return `<section class="cd-sec"><h4>${esc(title)}${flag}</h4>${body}</section>`;
  }

  function detailHtml(o, record, today) {
    const el = O.eligibility(o, birth(), today);
    const followed = contactFor(o.id);
    const link = (url, label) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || url)}</a>` : '');
    const plazo = `<p><b>Plazo:</b> ${esc(o.plazo.fecha ? fmtDate(o.plazo.fecha, { weekday: 'long' }) : (o.plazo.abierto ? 'abierto todo el año' : 'sin publicar'))}${o.plazo.recurrente ? ` · ${esc(o.plazo.recurrente)}` : ''}</p>${para(o.plazo.nota)}${o.fechas.inicio ? `<p><b>Fechas:</b> ${esc(fmtDate(o.fechas.inicio))}${o.fechas.fin ? ` – ${esc(fmtDate(o.fechas.fin))}` : ''}</p>` : ''}${para(o.fechas.nota)}`;
    const via = `<p><b>${esc(O.VIAS[o.via.tipo])}.</b> ${esc(o.via.texto)}</p>`;
    const envio = `${para(o.envio.resumen)}${bullets(o.envio.documentos)}${o.envio.email ? `<p><b>Enviar a:</b> <a href="mailto:${esc(o.envio.email)}">${esc(o.envio.email)}</a></p>` : ''}${o.envio.url ? `<p>${link(o.envio.url, 'Formulario o bases')}</p>` : ''}`;
    const age = `<p class="cd-age cd-el-${el.state}"><b>${esc(el.label)}</b>${el.detail ? ` · ${esc(el.detail)}` : ''}</p>${para(o.edad.texto)}${bullets(o.requisitos)}`;
    const dot = o.dotacion.importe != null || o.dotacion.nota ? `${o.dotacion.importe != null ? `<p><b>${esc(money(o.dotacion.importe, o.dotacion.moneda))}</b></p>` : ''}${para(o.dotacion.nota)}` : '';
    const contacto = [o.contacto.nombre ? `<p>${esc(o.contacto.nombre)}</p>` : '', o.contacto.email ? `<p><a href="mailto:${esc(o.contacto.email)}">${esc(o.contacto.email)}</a></p>` : '', o.contacto.telefono ? `<p><a href="tel:${esc(o.contacto.telefono.replace(/\s+/g, ''))}">${esc(o.contacto.telefono)}</a></p>` : ''].join('');
    const sources = `<ul class="cd-sources">${o.fuentes.map(f => `<li>${link(f.url, f.titulo || f.url)}${f.consultado ? ` <span>· consultado el ${esc(fmtDate(f.consultado))}</span>` : ''}</li>`).join('')}</ul><p class="cd-verified">${o.verificado ? `Verificado en fuente oficial el ${esc(fmtDate(o.verificado))}.` : 'Sin verificar en fuente oficial.'}</p>`;
    const pending = o.sinConfirmar.length ? `<p class="cd-warn">Sin confirmar: ${esc(o.sinConfirmar.map(f => FIELD_LABELS[f] || f).join(', '))}.</p>` : '';
    const follow = followed
      ? `<button type="button" data-op-action="goto-follow">Ver en seguimiento</button>`
      : `<button type="button" class="cd-primary" data-op-action="follow" data-id="${esc(o.id)}">Añadir a seguimiento</button>`;
    const interest = record.interes === 'si'
      ? `<button type="button" data-op-action="interest" data-value="" data-id="${esc(o.id)}">Quitar «Me interesa»</button>`
      : `<button type="button" data-op-action="interest" data-value="si" data-id="${esc(o.id)}">★ Me interesa</button>`;
    const discard = record.interes === 'no'
      ? `<button type="button" data-op-action="interest" data-value="" data-id="${esc(o.id)}">Recuperar</button>`
      : `<button type="button" data-op-action="interest" data-value="no" data-id="${esc(o.id)}">No me interesa</button>`;
    return `<div class="cd-detail">${pending}
      ${section('Qué es', para(o.resumen))}
      ${section('Cómo se entra', via, 'via', o)}
      ${section('Plazo y fechas', plazo, 'plazo', o)}
      ${section('Qué enviar', envio, 'envio', o)}
      ${section('Requisitos y edad', age, 'edad', o)}
      ${section(o.tipo === 'beca' ? 'Dotación' : 'Qué ofrece', dot, 'dotacion', o)}
      ${section('Contacto', contacto)}
      ${section('Notas', bullets(o.otros))}
      ${section('Fuentes', sources)}
      <div class="cd-actions">${follow}${o.web ? `<a class="op-btn-link" href="${esc(o.web)}" target="_blank" rel="noopener noreferrer">Abrir la web</a>` : ''}${interest}${discard}</div></div>`;
  }

  function renderFichas(tipo, today) {
    const all = entries(tipo);
    const b = birth();
    const filter = filters[tipo];
    const n = { mine: 0, all: 0, archive: 0 };
    all.forEach(({ o, record }) => {
      if (gone(o, record, today)) n.archive += 1;
      else { n.all += 1; if (O.eligibility(o, b, today).state !== 'no') n.mine += 1; }
    });
    const shown = all.filter(({ o, record }) => {
      const out = gone(o, record, today);
      if (filter === 'archive') return out;
      if (out) return false;
      return filter === 'mine' ? O.eligibility(o, b, today).state !== 'no' : true;
    }).sort((x, y) => O.compare(x.o, y.o, today));
    const noun = tipo === 'beca' ? 'becas' : 'festivales';
    return `
      <p class="op-intro">${tipo === 'beca'
        ? 'Becas de estudio y ayudas a la carrera para las que cumples nacionalidad o residencia (España, Alemania y Austria).'
        : 'Festivales, ciclos e instituciones con una vía de entrada clara: convocatoria, audición o propuestas aceptadas.'}</p>
      <div class="cd-toolbar">
        <div class="cd-segment" role="tablist" aria-label="Filtro">
          ${[['mine', 'Para mí'], ['all', 'Todas'], ['archive', 'Archivo']].map(([key, label]) => `<button type="button" role="tab" aria-selected="${filter === key}" class="${filter === key ? 'active' : ''}" data-op-action="filter" data-value="${key}">${label} <span>${n[key]}</span></button>`).join('')}
        </div>
      </div>
      <div class="cd-tools">
        <label class="cd-file">Importar dosier<input type="file" id="opImport" accept=".json,application/json"></label>
        <button type="button" data-op-action="export">Exportar</button>
        <button type="button" data-op-action="ai">Instrucciones para la IA</button>
      </div>
      <p class="cd-message" id="opMessage" role="status"${message ? '' : ' hidden'}>${esc(message)}</p>
      <div class="cd-list">${shown.length ? shown.map(({ o, record }) => `
        <details class="cd-card" data-op-id="${esc(o.id)}"${open.has(o.id) ? ' open' : ''}>
          <summary>${summaryHtml(o, record, today)}</summary>
          ${open.has(o.id) ? detailHtml(o, record, today) : ''}
        </details>`).join('') : `<p class="cd-empty">${all.length ? (filter === 'archive' ? `No hay ${noun} cerrados ni descartados.` : `No hay ${noun} en esta lista.`) : (seeding ? 'Cargando…' : 'Aún no hay fichas. Importa un dosier.')}</p>`}</div>
      <dialog class="cd-dialog" id="opAiDialog" aria-label="Instrucciones para la IA">
        <h2>Instrucciones para la IA</h2>
        <p>Copia este texto en la IA (y, si quieres que actualice lo que ya tienes, adjunta el archivo de «Exportar»). Lo que te devuelva se importa con «Importar dosier».</p>
        <textarea readonly rows="14">${esc(O.AI_PROMPT)}</textarea>
        <div class="cd-actions"><button type="button" class="cd-primary" data-op-action="copy-ai">Copiar</button><button type="button" data-op-action="template">Descargar plantilla</button><button type="button" data-op-action="close-ai">Cerrar</button></div>
      </dialog>`;
  }

  // ── Seguimiento ──────────────────────────────────────────────────────────
  function contactForm(c) {
    const v = c || {};
    const prefix = c ? 'opEdit' : 'opNew';
    const field = (key, label, type = 'text', extra = '') => `<label>${esc(label)}<input type="${type}" id="${prefix}-${key}" value="${esc(v[key] || '')}"${extra}></label>`;
    return `<div class="op-form">
      ${field('nombre', 'Nombre', 'text', ' required autocomplete="off"')}
      <label>Tipo<select id="${prefix}-tipo">${Object.entries(O.CONTACT_TIPOS).map(([key, label]) => `<option value="${key}"${(v.tipo || 'ayuntamiento') === key ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
      ${field('persona', 'Persona (técnico, concejal…)')}
      ${field('email', 'Email', 'email', ' autocomplete="off"')}
      ${field('telefono', 'Teléfono', 'tel', ' autocomplete="off"')}
      ${c ? field('proximo', 'Próximo paso el', 'date') : ''}
      <label class="op-form-wide">Nota<textarea id="${prefix}-nota" rows="2">${esc(v.nota || '')}</textarea></label>
      <div class="cd-actions op-form-wide">${c
        ? `<button type="button" class="cd-primary" data-op-action="save-edit" data-id="${esc(c.id)}">Guardar</button><button type="button" data-op-action="cancel-edit">Cancelar</button>`
        : '<button type="button" class="cd-primary" data-op-action="add-contact">Añadir</button>'}</div>
    </div>`;
  }

  function contactActions(c) {
    const b = (estado, label, primary) => `<button type="button"${primary ? ' class="cd-primary"' : ''} data-op-action="estado" data-value="${estado}" data-id="${esc(c.id)}">${label}</button>`;
    if (c.archivado) return `<button type="button" data-op-action="archive" data-value="" data-id="${esc(c.id)}">Recuperar</button>`;
    const byState = {
      pendiente: [b('enviado', 'Email enviado hoy', true)],
      enviado: [b('llamado', 'Llamé hoy', true), b('conversando', 'Ha respondido')],
      llamado: [b('conversando', 'Ha respondido', true), b('llamado', 'Llamé otra vez')],
      conversando: [b('cerrado', 'Concierto cerrado', true), b('descartado', 'No sale')],
      cerrado: [], descartado: [b('pendiente', 'Volver a intentarlo')],
    }[c.estado] || [];
    return byState.join('') + `<button type="button" data-op-action="edit" data-id="${esc(c.id)}">Editar</button><button type="button" data-op-action="archive" data-value="1" data-id="${esc(c.id)}">Archivar</button>`;
  }

  // Una fila por contacto: en escritorio es una tabla; en el móvil cada fila se apila como tarjeta.
  function contactRow(c, today) {
    const step = O.nextStep(c, today);
    const datos = [c.persona ? `<span>${esc(c.persona)}</span>` : '', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '', c.telefono ? `<a href="tel:${esc(c.telefono.replace(/\s+/g, ''))}">${esc(c.telefono)}</a>` : ''].filter(Boolean).join('');
    const dates = [c.enviado ? `Email: ${fmtDate(c.enviado, { year: undefined })}` : '', c.ultimoContacto && c.ultimoContacto !== c.enviado ? `Último contacto: ${fmtDate(c.ultimoContacto, { year: undefined })}` : ''].filter(Boolean).join(' · ');
    const estado = chip(step.done ? 'muted' : c.estado === 'pendiente' ? 'dl-soon' : 'dl-open', O.ESTADOS[c.estado] || c.estado) + (step.due && c.estado !== 'pendiente' ? chip('dl-urgent', 'Toca hoy') : '');
    const overdue = step.due && c.estado !== 'pendiente';
    const row = `<tr class="op-row${overdue ? ' is-due' : ''}" data-contact="${esc(c.id)}">
      <th scope="row" class="op-c-name"><span class="op-name">${esc(c.nombre)}</span><span class="op-kind">${esc(O.CONTACT_TIPOS[c.tipo] || c.tipo)}</span>${c.nota ? `<span class="op-note">${esc(c.nota)}</span>` : ''}</th>
      <td class="op-c-state" data-label="Estado"><div class="cd-chips">${estado}</div>${dates ? `<span class="op-dates">${esc(dates)}</span>` : ''}</td>
      <td class="op-c-next${overdue ? ' due' : ''}" data-label="Próximo paso">${step.text ? esc(humanize(step.text)) : '—'}</td>
      <td class="op-c-data" data-label="Contacto">${datos || '<span class="op-missing">Falta el email</span>'}</td>
      <td class="op-c-actions">${editing === c.id ? '' : `<div class="cd-actions">${contactActions(c)}</div>`}</td>
    </tr>`;
    return editing === c.id ? row + `<tr class="op-edit-row"><td colspan="5">${contactForm(c)}</td></tr>` : row;
  }

  function renderFollow(today) {
    const all = state().contactos;
    const filter = filters.seguimiento;
    const done = c => ['cerrado', 'descartado'].includes(c.estado);
    const n = { active: 0, closed: 0, archive: 0 };
    all.forEach(c => { if (c.archivado) n.archive += 1; else if (done(c)) n.closed += 1; else n.active += 1; });
    const shown = all.filter(c => (filter === 'archive' ? c.archivado : !c.archivado && (filter === 'closed' ? done(c) : !done(c)))).sort((a, b) => O.compareContacts(a, b, today));
    const sum = O.followSummary(all, today);
    const known = new Set(all.map(c => c.nombre.toLowerCase()));
    const missing = O.SUGERIDOS.filter(s => !known.has(s.nombre.toLowerCase()));
    return `
      <section class="op-follow-head">
        <p>${sum.total ? `<b>${sum.calls ? `${sum.calls} seguimiento${sum.calls === 1 ? '' : 's'} para hoy` : 'Ninguna llamada pendiente hoy'}</b>${sum.pending ? ` · ${sum.pending} por contactar` : ''} · ${sum.open} en marcha · ${sum.closed} cerrado${sum.closed === 1 ? '' : 's'}` : 'Apunta aquí a quién escribes: el seguimiento te dice a quién llamar y cuándo.'}</p>
        <p class="op-hint">Al marcar «Email enviado» se propone llamar a los ${O.FOLLOW_UP_DAYS} días si no hay respuesta.</p>
      </section>
      <div class="cd-toolbar">
        <div class="cd-segment" role="tablist" aria-label="Filtro">
          ${[['active', 'En marcha'], ['closed', 'Cerrados'], ['archive', 'Archivo']].map(([key, label]) => `<button type="button" role="tab" aria-selected="${filter === key}" class="${filter === key ? 'active' : ''}" data-op-action="filter" data-value="${key}">${label} <span>${n[key]}</span></button>`).join('')}
        </div>
      </div>
      <details class="op-add"${editing === 'new' ? ' open' : ''}><summary>＋ Añadir contacto</summary>${contactForm(null)}</details>
      ${missing.length && filter === 'active' ? `<div class="op-suggest"><p>Ayuntamientos de la provincia de Ciudad Real para empezar: ${esc(missing.map(s => s.nombre.replace('Ayuntamiento de ', '')).join(', '))}.</p><button type="button" data-op-action="suggest">Añadir ${missing.length} a «Por contactar»</button></div>` : ''}
      <p class="cd-message" id="opMessage" role="status"${message ? '' : ' hidden'}>${esc(message)}</p>
      ${shown.length ? `<div class="op-table-wrap"><table class="op-table">
        <thead><tr><th scope="col">Contacto</th><th scope="col">Estado</th><th scope="col">Próximo paso</th><th scope="col">Email y teléfono</th><th scope="col"><span class="op-sr">Acciones</span></th></tr></thead>
        <tbody>${shown.map(c => contactRow(c, today)).join('')}</tbody>
      </table></div>` : `<p class="cd-empty">${filter === 'archive' ? 'No hay contactos archivados.' : filter === 'closed' ? 'Aún no hay conciertos cerrados.' : 'No hay contactos en marcha.'}</p>`}`;
  }

  // ── Pintar ───────────────────────────────────────────────────────────────
  function render() {
    const view = host();
    if (!view || !ready() || !O) return;
    const today = O.todayISO();
    renderTabs(today);
    const cd = document.getElementById('cdPanel');
    const op = panel();
    if (!cd || !op) return;
    const showConcursos = tab === 'concursos';
    cd.hidden = !showConcursos;
    op.hidden = showConcursos;
    if (showConcursos) {
      if (window.ConcursosDossier && window.ConcursosDossier.render) window.ConcursosDossier.render();
      return;
    }
    const scrollY = window.scrollY;
    op.setAttribute('aria-labelledby', 'opTab-' + tab);
    op.innerHTML = tab === 'seguimiento' ? renderFollow(today) : renderFichas(tab, today);
    if (document.body.getAttribute('data-view') === 'concursos') window.scrollTo(0, scrollY);
  }

  function say(text) { message = text; const el = document.getElementById('opMessage'); if (el) { el.textContent = text; el.hidden = !text; } }
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFile(file) {
    if (file.size > 3 * 1024 * 1024) throw new Error('El archivo supera 3 MB.');
    const parsed = O.parse(await file.text());
    if (!parsed.items.length) throw new Error(parsed.errors.join(' ') || 'No hay fichas válidas.');
    const result = O.merge(state(), parsed.items, { origen: file.name });
    persist();
    const parts = [];
    if (result.added) parts.push(`${result.added} nueva${result.added === 1 ? '' : 's'}`);
    if (result.updated) parts.push(`${result.updated} actualizada${result.updated === 1 ? '' : 's'}`);
    if (result.unchanged) parts.push(`${result.unchanged} sin cambios`);
    message = `Dosier importado: ${parts.join(', ')}.${parsed.errors.length ? ` Ignorado: ${parsed.errors.join(' ')}` : ''}`;
    render();
  }

  function readForm(prefix) {
    const val = key => { const el = document.getElementById(`${prefix}-${key}`); return el ? el.value : ''; };
    return { nombre: val('nombre'), tipo: val('tipo'), persona: val('persona'), email: val('email'), telefono: val('telefono'), nota: val('nota'), proximo: val('proximo') };
  }

  function setTab(next) {
    if (!STAY_TAB.has(next)) return;
    tab = next; message = ''; editing = null;
    try { localStorage.setItem(TAB_KEY, tab); } catch (error) { /* sin almacenamiento */ }
    render();
  }

  function action(button) {
    const id = button.dataset.id;
    const today = O.todayISO();
    switch (button.dataset.opAction) {
      case 'filter': filters[tab] = button.dataset.value; message = ''; render(); return;
      case 'interest': {
        const record = state().fichas.find(r => r.id === id);
        if (!record) return;
        record.interes = button.dataset.value || null;
        persist(); render(); return;
      }
      case 'follow': {
        const record = state().fichas.find(r => r.id === id);
        const o = record && O.fichaOf(record);
        if (!o || contactFor(o.id)) return;
        const contact = O.newContact({ nombre: o.nombre, tipo: o.tipo, persona: o.contacto.nombre || '', email: o.envio.email || o.contacto.email || '', telefono: o.contacto.telefono || '', oportunidadId: o.id });
        state().contactos.push(contact);
        persist();
        say(`«${o.nombre}» está en Seguimiento, en «Por contactar».`);
        render(); return;
      }
      case 'goto-follow': filters.seguimiento = 'active'; setTab('seguimiento'); return;
      case 'export': {
        const tipo = tab === 'beca' || tab === 'festival' ? tab : null;
        download(`dosier-${tipo === 'beca' ? 'becas' : 'festivales'}-${today}.json`, { formato: O.FORMAT, version: O.VERSION, generado: today, autor: 'Exportado desde la app', oportunidades: entries(tipo).map(x => x.o) });
        return;
      }
      case 'ai': { const dialog = document.getElementById('opAiDialog'); if (dialog && dialog.showModal) dialog.showModal(); else if (dialog) dialog.setAttribute('open', ''); return; }
      case 'close-ai': { const dialog = document.getElementById('opAiDialog'); if (dialog) { if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); } return; }
      case 'copy-ai':
        (navigator.clipboard ? navigator.clipboard.writeText(O.AI_PROMPT) : Promise.reject())
          .then(() => { button.textContent = 'Copiado'; })
          .catch(() => { const area = button.closest('dialog').querySelector('textarea'); area.select(); button.textContent = 'Selecciónalo y cópialo'; });
        return;
      case 'template': download('plantilla-dosier-oportunidades.json', O.TEMPLATE); return;
      case 'add-contact': {
        try {
          const fields = readForm('opNew');
          state().contactos.push(O.newContact(fields));
          persist();
          editing = null;
          say(`«${fields.nombre.trim()}» añadido a «Por contactar».`);
          render();
        } catch (error) { editing = 'new'; say(error.message); }
        return;
      }
      case 'suggest': {
        const known = new Set(state().contactos.map(c => c.nombre.toLowerCase()));
        let added = 0;
        O.SUGERIDOS.forEach(s => {
          if (known.has(s.nombre.toLowerCase())) return;
          state().contactos.push(O.newContact({ nombre: s.nombre, tipo: 'ayuntamiento', nota: s.nota }));
          added += 1;
        });
        persist();
        say(`${added} ayuntamiento${added === 1 ? '' : 's'} en «Por contactar». Añade el email de Cultura de cada uno con «Editar».`);
        render(); return;
      }
      case 'estado': {
        const c = state().contactos.find(x => x.id === id);
        if (!c) return;
        O.setEstado(c, button.dataset.value, today);
        persist(); render(); return;
      }
      case 'edit': editing = id; render(); return;
      case 'cancel-edit': editing = null; render(); return;
      case 'save-edit': {
        const c = state().contactos.find(x => x.id === id);
        if (!c) return;
        const f = readForm('opEdit');
        if (!f.nombre.trim()) { say('Pon al menos el nombre.'); return; }
        Object.assign(c, {
          nombre: f.nombre.trim().slice(0, 200), tipo: O.CONTACT_TIPOS[f.tipo] ? f.tipo : c.tipo,
          persona: f.persona.trim().slice(0, 200), email: f.email.trim().slice(0, 200), telefono: f.telefono.trim().slice(0, 60),
          nota: f.nota.trim().slice(0, 1000), proximo: /^\d{4}-\d{2}-\d{2}$/.test(f.proximo) ? f.proximo : null,
        });
        editing = null;
        persist(); render(); return;
      }
      case 'archive': {
        const c = state().contactos.find(x => x.id === id);
        if (!c) return;
        c.archivado = button.dataset.value === '1';
        persist();
        say(c.archivado ? `«${c.nombre}» archivado.` : `«${c.nombre}» recuperado.`);
        render(); return;
      }
      default:
    }
  }

  function init() {
    const view = host();
    if (!view) return;
    view.addEventListener('click', event => {
      const tabButton = event.target.closest('button[data-op-tab]');
      if (tabButton && view.contains(tabButton)) { event.preventDefault(); setTab(tabButton.dataset.opTab); return; }
      const button = event.target.closest('button[data-op-action]');
      if (button && view.contains(button)) { event.preventDefault(); action(button); }
    });
    view.addEventListener('keydown', event => {
      const current = event.target.closest && event.target.closest('button[data-op-tab]');
      if (!current || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
      const keys = TABS.map(t => t[0]);
      const next = keys[(keys.indexOf(current.dataset.opTab) + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
      event.preventDefault();
      setTab(next);
      const el = document.getElementById('opTab-' + next);
      if (el) el.focus();
    });
    view.addEventListener('toggle', event => {
      const card = event.target.closest && event.target.closest('details.cd-card[data-op-id]');
      if (!card) return;
      const id = card.dataset.opId;
      if (card.open === open.has(id)) return;
      if (card.open) open.add(id); else open.delete(id);
      if (card.open && !card.querySelector('.cd-detail')) {
        const record = state().fichas.find(r => r.id === id);
        const o = record && O.fichaOf(record);
        if (o) card.insertAdjacentHTML('beforeend', detailHtml(o, record, O.todayISO()));
      }
    }, true);
    view.addEventListener('change', event => {
      if (event.target.id === 'opImport' && event.target.files && event.target.files[0]) {
        importFile(event.target.files[0]).catch(error => { say('No se pudo importar: ' + error.message); });
      }
    });
    window.addEventListener('app:viewchange', event => {
      if (event.detail && event.detail.name === 'concursos') { render(); ensureSeed(); }
    });
    window.addEventListener('storage', event => {
      if (event.key === 'alberto_piano_v2' && document.body.getAttribute('data-view') === 'concursos' && !editing) render();
    });
    const boot = attempt => {
      if (ready()) { ensureSeed(); render(); return; }
      if (attempt < 100) setTimeout(() => boot(attempt + 1), 100);
    };
    boot(0);
  }

  window.Oportunidades = { render, ensureSeed, setTab, tab: () => tab, refreshTabs: () => { if (ready() && O) renderTabs(O.todayISO()); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
