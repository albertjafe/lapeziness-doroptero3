(function taskRecoveryUi(root) {
  'use strict';

  const DB_KEY = 'alberto_piano_v2';
  const RESCUE_KEY = 'alberto_crono_tasks_rescue_v1';
  const BUTTON_ID = 'taskRecoveryOpenBtn';
  const MODAL_ID = 'taskRecoveryModal';

  const parse = value => { try { return JSON.parse(value || 'null'); } catch (error) { return null; } };
  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function taskLabel(task) {
    return String(task && (task.text || task.title || task.nombre || task.note || task.nota || task.label) || '(sin texto)');
  }

  function taskId(task, index) {
    return String(task && task.id || `__missing_${index}`);
  }

  function hashTasks(tasks) {
    if (root.TaskSyncBootstrap && typeof root.TaskSyncBootstrap.hashTasks === 'function') {
      return root.TaskSyncBootstrap.hashTasks(tasks);
    }
    const text = JSON.stringify(arr(tasks).slice().sort((a, b) => String(a && a.id || '').localeCompare(String(b && b.id || ''))));
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function readDb() {
    return parse(root.localStorage && root.localStorage.getItem(DB_KEY)) || {};
  }

  function readState() {
    const state = parse(root.localStorage && root.localStorage.getItem(RESCUE_KEY));
    return state && Array.isArray(state.snapshots) ? state : { snapshots: [] };
  }

  function formatDate(value) {
    if (!value) return 'sin hora';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(date);
    } catch (error) { return date.toLocaleString(); }
  }

  function diff(snapshotTasks, currentTasks) {
    const current = new Map(arr(currentTasks).map((task, index) => [taskId(task, index), task]));
    const snap = new Map(arr(snapshotTasks).map((task, index) => [taskId(task, index), task]));
    const onlySnapshot = [];
    const onlyCurrent = [];
    snap.forEach((task, id) => { if (!current.has(id)) onlySnapshot.push(task); });
    current.forEach((task, id) => { if (!snap.has(id)) onlyCurrent.push(task); });
    return { onlySnapshot, onlyCurrent };
  }

  function ensureStyles() {
    if (document.getElementById('taskRecoveryStyles')) return;
    const style = document.createElement('style');
    style.id = 'taskRecoveryStyles';
    style.textContent = `
      .task-recovery-open{width:100%;margin:10px 0 14px;padding:10px 12px;border:1px solid rgba(180,125,35,.35);border-radius:10px;background:rgba(180,125,35,.08);color:var(--text);font:600 11px 'JetBrains Mono',monospace;letter-spacing:.02em}
      .task-recovery-overlay{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.46);display:flex;align-items:flex-end;justify-content:center;padding:12px;box-sizing:border-box}
      .task-recovery-sheet{width:min(680px,100%);max-height:91dvh;overflow:auto;background:var(--bg,#fff);color:var(--text,#111);border-radius:18px 18px 12px 12px;padding:18px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
      .task-recovery-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;position:sticky;top:-18px;background:var(--bg,#fff);padding:18px 0 12px;z-index:2}
      .task-recovery-title{font-family:'Cormorant Garamond',serif;font-size:25px;line-height:1}.task-recovery-sub{font-size:11px;color:var(--text3);margin-top:5px;line-height:1.45}
      .task-recovery-close{border:0;background:var(--bg3);color:var(--text2);border-radius:9px;padding:8px 10px}
      .task-recovery-card{border:1px solid var(--border2);border-radius:12px;padding:12px;margin:10px 0;background:var(--bg2)}
      .task-recovery-card.good{border-color:rgba(60,150,90,.45)}.task-recovery-meta{font:10px 'JetBrains Mono',monospace;color:var(--text3);line-height:1.55}
      .task-recovery-diff{font-size:12px;margin:7px 0}.task-recovery-diff strong{color:var(--accent)}
      .task-recovery-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.task-recovery-actions button{border:1px solid var(--border2);border-radius:8px;padding:7px 10px;background:var(--bg3);color:var(--text);font-size:11px}.task-recovery-actions .restore{background:var(--accent);color:var(--bg);border-color:var(--accent)}
      .task-recovery-list{margin-top:9px;padding:8px 10px;border-radius:8px;background:var(--bg);max-height:260px;overflow:auto;font-size:12px;line-height:1.45}.task-recovery-list div{padding:4px 0;border-bottom:1px solid var(--border2)}
      .task-recovery-warning{padding:9px 10px;border-radius:9px;background:rgba(190,80,50,.08);font-size:11px;line-height:1.5;margin-bottom:10px}
    `;
    document.head.appendChild(style);
  }

  function copySnapshot(index) {
    const snapshot = readState().snapshots[index];
    if (!snapshot) return;
    const text = JSON.stringify(snapshot, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
    if (typeof root.showToast === 'function') root.showToast('Copia de tareas copiada');
  }

  function toggleList(index) {
    const el = document.getElementById(`taskRecoveryList${index}`);
    if (el) el.hidden = !el.hidden;
  }

  function mergeTombstones(existing, snapshotTombs, removedIds, stamp) {
    const map = new Map();
    arr(existing).concat(arr(snapshotTombs)).forEach(item => {
      if (!item || item.id == null) return;
      const id = String(item.id);
      const at = Date.parse(item.deletedAt || item.updatedAt || item.at || '') || 0;
      const prev = map.get(id);
      const prevAt = prev ? (Date.parse(prev.deletedAt || prev.updatedAt || prev.at || '') || 0) : -1;
      if (!prev || at >= prevAt) map.set(id, { ...item });
    });
    removedIds.forEach(id => map.set(id, { id, deletedAt: stamp, source: 'manual-task-recovery' }));
    return Array.from(map.values());
  }

  async function restoreSnapshot(index) {
    const state = readState();
    const snapshot = state.snapshots[index];
    if (!snapshot || !Array.isArray(snapshot.tasks)) return;
    const ok = root.confirm(`¿Restaurar esta copia de ${snapshot.tasks.length} tareas?\n\nNo se borrará la copia de seguridad.`);
    if (!ok) return;

    const db = readDb();
    const currentIds = new Set(arr(db.cronoTasks).map((task, i) => taskId(task, i)));
    const snapshotIds = new Set(snapshot.tasks.map((task, i) => taskId(task, i)));
    const removedIds = [...currentIds].filter(id => !snapshotIds.has(id));
    const stamp = new Date().toISOString();
    db.cronoTasks = snapshot.tasks.map(task => task && typeof task === 'object' ? { ...task } : task);
    db.cronoTaskTombstones = mergeTombstones(db.cronoTaskTombstones, snapshot.tombstones, removedIds, stamp);
    db._localRevision = Math.max(num(db._localRevision), num(snapshot.revision)) + 1;
    db._savedAt = stamp;
    root.localStorage.setItem(DB_KEY, JSON.stringify(db));

    // Put the chosen snapshot first and make it a fresh rescue point. The
    // dedicated reconciler will compare it with the server and choose the next
    // server revision instead of blindly overwriting either side.
    const fresh = {
      ...snapshot,
      capturedAt: stamp,
      savedAt: stamp,
      revision: db._localRevision,
      taskCount: db.cronoTasks.length,
      tasks: db.cronoTasks.map(task => task && typeof task === 'object' ? { ...task } : task),
      tombstones: db.cronoTaskTombstones.map(item => ({ ...item })),
      fingerprint: hashTasks(db.cronoTasks),
    };
    state.snapshots = [fresh].concat(state.snapshots).slice(0, 8);
    state.updatedAt = stamp;
    root.localStorage.setItem(RESCUE_KEY, JSON.stringify(state));

    try {
      if (root.TaskSyncResilience && typeof root.TaskSyncResilience.reconcile === 'function') {
        await root.TaskSyncResilience.reconcile('manual-task-recovery');
      }
    } catch (error) {}
    try { if (typeof root.renderCronoTasks === 'function') root.renderCronoTasks(); } catch (error) {}
    close();
    if (typeof root.showToast === 'function') root.showToast('Copia restaurada · sincronizando');
    setTimeout(() => open(), 1000);
  }

  function cardHtml(snapshot, index, currentTasks) {
    const tasks = arr(snapshot && snapshot.tasks);
    const d = diff(tasks, currentTasks);
    const same = hashTasks(tasks) === hashTasks(currentTasks);
    const added = d.onlySnapshot.slice(0, 4).map(taskLabel).join(' · ');
    const missing = d.onlyCurrent.slice(0, 4).map(taskLabel).join(' · ');
    const classes = same ? 'task-recovery-card' : 'task-recovery-card good';
    const list = tasks.map((task, i) => `<div>${i + 1}. ${esc(taskLabel(task))}</div>`).join('');
    return `<section class="${classes}">
      <div><strong>${same ? 'Igual que ahora' : 'Copia diferente'}</strong></div>
      <div class="task-recovery-meta">capturada ${esc(formatDate(snapshot.capturedAt))} · rev ${num(snapshot.revision)} · ${tasks.length} tareas</div>
      <div class="task-recovery-diff">${same ? 'No aporta tareas distintas.' : `<strong>+${d.onlySnapshot.length}</strong> que no están ahora · <strong>−${d.onlyCurrent.length}</strong> que ahora sí aparecen`}</div>
      ${added ? `<div class="task-recovery-meta">Solo en esta copia: ${esc(added)}${d.onlySnapshot.length > 4 ? '…' : ''}</div>` : ''}
      ${missing ? `<div class="task-recovery-meta">Solo ahora: ${esc(missing)}${d.onlyCurrent.length > 4 ? '…' : ''}</div>` : ''}
      <div class="task-recovery-actions">
        <button type="button" onclick="TaskRecoveryUI.toggleList(${index})">Ver tareas</button>
        <button type="button" onclick="TaskRecoveryUI.copySnapshot(${index})">Copiar JSON</button>
        ${same ? '' : `<button type="button" class="restore" onclick="TaskRecoveryUI.restoreSnapshot(${index})">Usar esta copia</button>`}
      </div>
      <div id="taskRecoveryList${index}" class="task-recovery-list" hidden>${list}</div>
    </section>`;
  }

  function open() {
    ensureStyles();
    close();
    const db = readDb();
    const state = readState();
    const currentTasks = arr(db.cronoTasks);
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'task-recovery-overlay';
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const cards = state.snapshots.length
      ? state.snapshots.map((snapshot, index) => cardHtml(snapshot, index, currentTasks)).join('')
      : '<div class="task-recovery-warning">No hay todavía ninguna copia de rescate guardada en este dispositivo.</div>';
    overlay.innerHTML = `<div class="task-recovery-sheet" role="dialog" aria-modal="true" aria-label="Recuperar tareas">
      <div class="task-recovery-head"><div><div class="task-recovery-title">Recuperar tareas</div><div class="task-recovery-sub">Estas copias viven solo en este dispositivo. No sincronizamos nada hasta que elijas una.</div></div><button class="task-recovery-close" type="button" onclick="TaskRecoveryUI.close()">✕</button></div>
      <div class="task-recovery-warning">Busca una copia que contenga las tareas nuevas que recuerdas. Si la encuentras, puedes verla o copiarla antes de restaurarla.</div>
      <section class="task-recovery-card"><strong>Estado actual</strong><div class="task-recovery-meta">rev ${num(db._localRevision)} · ${currentTasks.length} tareas · guardado ${esc(formatDate(db._savedAt))}</div></section>
      ${cards}
    </div>`;
    document.body.appendChild(overlay);
  }

  function close() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
  }

  function installButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const state = readState();
    if (!state.snapshots.length) return;
    const host = document.getElementById('view-cronometro') || document.querySelector('.app-content');
    if (!host) return;
    ensureStyles();
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'task-recovery-open';
    button.textContent = '↶ Historial de tareas · recuperar copia';
    button.addEventListener('click', open);
    host.insertBefore(button, host.firstChild);
  }

  const api = { open, close, toggleList, copySnapshot, restoreSnapshot, installButton };
  root.TaskRecoveryUI = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installButton, { once:true });
  else installButton();
  setTimeout(installButton, 1200);
  setTimeout(installButton, 5000);
})(typeof window !== 'undefined' ? window : globalThis);
