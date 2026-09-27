/* Rescate de copias locales (27-09-2026).
 * Ajustes → Datos → «Recuperar datos de este dispositivo».
 * SOLO LEE el almacenamiento local de este dispositivo (localStorage e
 * IndexedDB): resume en pantalla qué copias de estudio contiene, qué tienen que
 * la app no muestra ahora y, si lo pides, las sube a device_recovery_snapshots
 * para revisarlas. Nunca modifica, borra ni restaura nada, y nunca lee ni envía
 * credenciales, tokens de sesión ni claves de notificaciones. */
(function deviceRecoveryModule(root) {
  'use strict';

  const SENSITIVE = /(auth|cred|token|passw|secret|push|^sb-)/i;
  // Nombres conocidos por si el navegador no sabe listar sus bases IndexedDB.
  const KNOWN_DBS = ['piano_pre_update_rescue_v1', 'piano_snapshot_rescue_v1', 'piano_timer_rescue_v1', 'study-ledger-v1'];
  const SMALL_ITEM = 50 * 1024;
  const PART_CHARS = 3 * 1024 * 1024;
  const SOURCE_LABELS = {
    'localStorage:alberto_piano_v2': 'Datos actuales de la app',
    'localStorage:alberto_local_backup_v1': 'Copia guardada al cerrar sesión',
    'localStorage:alberto_crono_tasks_rescue_v1': 'Rescate de tareas del cronómetro',
    'idb:piano_pre_update_rescue_v1/snapshots': 'Copia previa a la última actualización',
    'idb:piano_snapshot_rescue_v1/snapshots': 'Copia de emergencia (almacenamiento lleno)',
    'idb:piano_timer_rescue_v1': 'Rescate del cronómetro',
  };
  let lastCapture = null;

  function el(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }
  function currentDb() {
    try { return typeof db !== 'undefined' ? db : root.db || null; } catch (_) { return root.db || null; }
  }
  function localDay(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function dayLabel(day) {
    const [y, m, d] = String(day).split('-').map(Number);
    return y ? new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '') : day;
  }
  function stampLabel(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-ES', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).replace('.', '');
  }
  function hours(mins) {
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  }
  function deviceLabel() {
    const ua = navigator.userAgent || '';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Macintosh/.test(ua)) return 'Mac';
    return 'Otro';
  }
  function appVersion() {
    const src = Array.from(document.scripts).map(script => script.getAttribute('src') || '')
      .find(value => /(^|\/)app\.js\?/.test(value)) || '';
    return (src.match(/[?&]v=(\d+)/) || [])[1] || null;
  }
  function safeJson(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return String(value); }
  }

  // ── Lectura (nunca escribe) ───────────────────────────────────────────
  function readLocalStorage() {
    const items = {};
    let skipped = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (SENSITIVE.test(key)) { skipped++; continue; }
        items[key] = localStorage.getItem(key);
      }
    } catch (_) {}
    return { items, skipped };
  }

  /* Abre una base SOLO si ya existe: si el navegador fuera a crearla
   * (onupgradeneeded), se aborta, para no dejar una base vacía que luego
   * confundiría a la app. */
  function openExisting(name) {
    return new Promise(resolve => {
      let request, created = false, done = false;
      const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => finish(null), 6000);
      try { request = indexedDB.open(name); } catch (_) { finish(null); return; }
      request.onupgradeneeded = () => { created = true; try { request.transaction.abort(); } catch (_) {} };
      request.onsuccess = () => {
        const database = request.result;
        if (created) { database.close(); finish(null); } else finish(database);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => {};
    });
  }

  function readStore(database, storeName) {
    return new Promise(resolve => {
      try {
        const tx = database.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();
        tx.oncomplete = () => resolve({ keys: safeJson(keysRequest.result || []), values: safeJson(valuesRequest.result || []) });
        tx.onerror = () => resolve({ error: String(tx.error || 'error') });
        tx.onabort = () => resolve({ error: String(tx.error || 'abort') });
      } catch (error) {
        resolve({ error: String(error) });
      }
    });
  }

  async function readIndexedDb() {
    if (typeof indexedDB === 'undefined') return {};
    let names = [];
    try {
      if (typeof indexedDB.databases === 'function') {
        names = (await indexedDB.databases()).map(item => item && item.name).filter(Boolean);
      }
    } catch (_) {}
    names = [...new Set([...names, ...KNOWN_DBS])].filter(name => !SENSITIVE.test(name));
    const result = {};
    for (const name of names) {
      const database = await openExisting(name);
      if (!database) continue;
      const stores = {};
      for (const storeName of Array.from(database.objectStoreNames)) {
        stores[storeName] = await readStore(database, storeName);
      }
      database.close();
      result[name] = stores;
    }
    return result;
  }

  // ── Resumen ──────────────────────────────────────────────────────────
  function studyDoc(value, depth = 0) {
    if (depth > 3 || value == null) return null;
    let parsed = value;
    if (typeof parsed === 'string') {
      if (parsed.length < 20 || parsed.trim()[0] !== '{') return null;
      try { parsed = JSON.parse(parsed); } catch (_) { return null; }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (Array.isArray(parsed.sessionPlants) || Array.isArray(parsed.sesiones) || parsed.germanStudy) return parsed;
    if (typeof parsed.raw === 'string') return studyDoc(parsed.raw, depth + 1);
    if (parsed.data && typeof parsed.data === 'object') return studyDoc(parsed.data, depth + 1);
    return null;
  }

  function summarize(doc, current) {
    const plants = (Array.isArray(doc.sessionPlants) ? doc.sessionPlants : []).filter(p => p && p.startedAt);
    const currentPlantIds = new Set((current?.sessionPlants || []).map(p => p && (p.id || p.runId || p.startedAt)));
    const currentGoalIds = new Set((current?.germanStudy?.goals || []).map(g => g && g.id));
    const days = {};
    plants.forEach(p => {
      const day = localDay(p.startedAt);
      if (day) days[day] = (days[day] || 0) + Math.max(0, Number(p.mins ?? p.min) || 0);
    });
    const goals = (Array.isArray(doc.germanStudy?.goals) ? doc.germanStudy.goals : [])
      .filter(g => g && !g.deletedAt)
      .map(g => ({ id: g.id, name: g.name, amount: g.amount, createdAt: g.createdAt || null, archived: !!g.archivedAt, missingNow: !currentGoalIds.has(g.id) }));
    const missingPlants = plants.filter(p => !currentPlantIds.has(p.id || p.runId || p.startedAt));
    return {
      savedAt: doc._savedAt || null,
      revision: Number(doc._localRevision) || 0,
      plants: plants.length,
      lastStudy: plants.map(p => p.endedAt || p.startedAt).sort().pop() || null,
      lastDays: Object.keys(days).sort().slice(-4).map(day => ({ day, mins: days[day] })),
      goals,
      missingPlants: missingPlants.length,
      missingMinutes: missingPlants.reduce((sum, p) => sum + Math.max(0, Number(p.mins ?? p.min) || 0), 0),
    };
  }

  async function scan() {
    const current = currentDb();
    const local = readLocalStorage();
    const idb = await readIndexedDb();
    const copies = [];
    Object.entries(local.items).forEach(([key, value]) => {
      const doc = studyDoc(value);
      if (doc) copies.push({ source: `localStorage:${key}`, summary: summarize(doc, current) });
    });
    Object.entries(idb).forEach(([name, stores]) => {
      Object.entries(stores).forEach(([storeName, content]) => {
        (content.values || []).forEach((value, index) => {
          const doc = studyDoc(value);
          if (!doc) return;
          const key = Array.isArray(content.keys) ? content.keys[index] : index;
          copies.push({
            source: `idb:${name}/${storeName}`,
            key: String(key),
            capturedAt: value && value.capturedAt || null,
            summary: summarize(doc, current),
          });
        });
      });
    });
    lastCapture = {
      capturedAt: new Date().toISOString(),
      device: deviceLabel(),
      userAgent: navigator.userAgent,
      appVersion: appVersion(),
      skippedSensitiveKeys: local.skipped,
      copies,
      localStorage: local.items,
      indexedDB: idb,
    };
    return lastCapture;
  }

  // ── Envío y descarga (sólo a petición) ───────────────────────────────
  async function gzipBase64(text) {
    if (typeof CompressionStream !== 'function') return null;
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function uploadParts(capture) {
    const parts = [];
    const small = {};
    Object.entries(capture.localStorage).forEach(([key, value]) => {
      if (String(value || '').length <= SMALL_ITEM) small[key] = value;
      else parts.push({ source: `localStorage:${key}`, value });
    });
    parts.unshift({ source: 'localStorage:(pequeñas)', value: small });
    Object.entries(capture.indexedDB).forEach(([name, stores]) => {
      Object.entries(stores).forEach(([storeName, content]) => parts.push({ source: `idb:${name}/${storeName}`, value: content }));
    });
    return parts;
  }

  async function upload(capture) {
    if (!capture) throw new Error('Primero revisa el dispositivo');
    const sb = getSB();
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user?.id) throw new Error('Inicia sesión en la nube primero');
    const captureId = root.crypto?.randomUUID ? root.crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    const base = {
      capture_id: captureId,
      device_label: capture.device,
      user_agent: String(capture.userAgent || '').slice(0, 400),
      app_version: capture.appVersion,
    };
    const insert = async row => {
      const { error } = await sb.from('device_recovery_snapshots').insert({ ...base, ...row });
      if (error) throw new Error(error.message || String(error));
    };
    await insert({
      source: 'manifest',
      summary: {
        capturedAt: capture.capturedAt,
        skippedSensitiveKeys: capture.skippedSensitiveKeys,
        copies: capture.copies,
        localStorageKeys: Object.fromEntries(Object.entries(capture.localStorage).map(([k, v]) => [k, String(v || '').length])),
        indexedDB: Object.fromEntries(Object.entries(capture.indexedDB).map(([n, stores]) => [n, Object.keys(stores)])),
      },
    });
    let sent = 1;
    for (const part of uploadParts(capture)) {
      const text = JSON.stringify(part.value);
      const compressed = await gzipBase64(text);
      if (!compressed) {
        await insert({ source: part.source, payload: safeJson(part.value), payload_bytes: text.length });
        sent++;
        continue;
      }
      const chunks = Math.max(1, Math.ceil(compressed.length / PART_CHARS));
      for (let i = 0; i < chunks; i++) {
        await insert({
          source: chunks > 1 ? `${part.source}#${i + 1}/${chunks}` : part.source,
          summary: { encoding: 'gzip+base64', chunk: i + 1, chunks },
          payload_gzip_b64: compressed.slice(i * PART_CHARS, (i + 1) * PART_CHARS),
          payload_bytes: text.length,
        });
        sent++;
      }
    }
    return { captureId, parts: sent };
  }

  function download(capture) {
    if (!capture) return;
    const { copies, ...rest } = capture;
    const blob = new Blob([JSON.stringify({ ...rest, copies }, null, 1)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `rescate-${capture.device.toLowerCase()}-${capture.capturedAt.slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  }

  // ── Interfaz ─────────────────────────────────────────────────────────
  function feedback(text, kind) {
    const node = el('deviceRecoveryFeedback');
    if (!node) return;
    node.style.display = text ? '' : 'none';
    node.textContent = text || '';
    node.dataset.kind = kind || '';
  }

  function renderCopies(capture) {
    const list = el('deviceRecoveryList');
    if (!list) return;
    if (!capture.copies.length) {
      list.innerHTML = '<p class="device-recovery-empty">No hay copias de estudio en este dispositivo.</p>';
      return;
    }
    list.innerHTML = capture.copies.map(copy => {
      const s = copy.summary;
      const label = SOURCE_LABELS[copy.source] || SOURCE_LABELS[copy.source.split('/')[0]] || copy.source;
      const extra = [];
      if (s.missingPlants) extra.push(`<span class="device-recovery-flag">${s.missingPlants} sesiones (${hours(s.missingMinutes)}) que la app no muestra ahora</span>`);
      const missingGoals = s.goals.filter(g => g.missingNow);
      if (missingGoals.length) extra.push(`<span class="device-recovery-flag">${missingGoals.length} objetivo${missingGoals.length > 1 ? 's' : ''} que la app no muestra ahora</span>`);
      return `<article class="device-recovery-copy${extra.length ? ' has-missing' : ''}">
        <div class="device-recovery-head"><b>${escapeHtml(label)}</b><small>${escapeHtml(copy.capturedAt ? `copia del ${stampLabel(copy.capturedAt)}` : s.savedAt ? `guardada ${stampLabel(s.savedAt)}` : '')}</small></div>
        <dl>
          <div><dt>Última sesión</dt><dd>${s.lastStudy ? escapeHtml(stampLabel(s.lastStudy)) : '—'}</dd></div>
          <div><dt>Sesiones</dt><dd>${s.plants}</dd></div>
          <div><dt>Últimos días</dt><dd>${s.lastDays.map(d => `${escapeHtml(dayLabel(d.day))}: ${escapeHtml(hours(d.mins))}`).join(' · ') || '—'}</dd></div>
          <div><dt>Objetivos</dt><dd>${s.goals.map(g => `${escapeHtml(g.name)} (${escapeHtml(g.amount)} €)${g.missingNow ? ' ⚠︎' : ''}`).join(' · ') || 'ninguno'}</dd></div>
        </dl>
        ${extra.join('')}
      </article>`;
    }).join('');
  }

  async function onScan(button) {
    button.disabled = true;
    feedback('Revisando el almacenamiento de este dispositivo…', 'loading');
    try {
      const capture = await scan();
      renderCopies(capture);
      const withMissing = capture.copies.filter(c => c.summary.missingPlants || c.summary.goals.some(g => g.missingNow)).length;
      feedback(withMissing
        ? `${capture.copies.length} copias encontradas; ${withMissing} con datos que la app no muestra ahora. Envíalas para recuperarlas.`
        : `${capture.copies.length} copias encontradas; ninguna tiene datos que falten en la app.`, withMissing ? 'warn' : 'ok');
      el('deviceRecoveryUpload')?.removeAttribute('disabled');
      el('deviceRecoveryDownload')?.removeAttribute('disabled');
    } catch (error) {
      feedback(`No se pudo revisar: ${error.message || error}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function onUpload(button) {
    button.disabled = true;
    feedback('Enviando copias a la nube (solo para revisión)…', 'loading');
    try {
      const result = await upload(lastCapture);
      feedback(`Enviado: ${result.parts} partes. Nada de este dispositivo se ha modificado.`, 'ok');
    } catch (error) {
      feedback(`No se pudo enviar: ${error.message || error}. Puedes usar «Descargar copia».`, 'error');
      button.disabled = false;
    }
  }

  function bind() {
    el('deviceRecoveryScan')?.addEventListener('click', event => onScan(event.currentTarget));
    el('deviceRecoveryUpload')?.addEventListener('click', event => onUpload(event.currentTarget));
    el('deviceRecoveryDownload')?.addEventListener('click', () => download(lastCapture));
  }

  root.DeviceRecovery = { scan, upload, download, summarize, studyDoc };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', bind) : bind();
})(typeof window !== 'undefined' ? window : globalThis);
