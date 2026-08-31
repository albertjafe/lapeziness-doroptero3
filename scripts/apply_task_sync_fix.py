from pathlib import Path


def replace_bytes(path, old, new, label, count=1):
    p = Path(path)
    raw = p.read_bytes()
    for eol in ('\r\n', '\n'):
        old_b = old.replace('\n', eol).encode('utf-8')
        if old_b in raw:
            new_b = new.replace('\n', eol).encode('utf-8')
            if raw.count(old_b) < count:
                raise SystemExit(f'{label}: expected at least {count} occurrences')
            p.write_bytes(raw.replace(old_b, new_b, count))
            return
    raise SystemExit(f'{label}: source snippet not found')


# DataCore: tasks are additive by stable id; same-id newest mutation wins.
data = Path('data-core.js')
text = data.read_text()
marker = "  function mergeStudyHistory(base, other) {"
if marker not in text:
    raise SystemExit('DataCore mergeStudyHistory marker missing')
helper = r'''  function cronoTaskMutationAt(task) {
    if (!task) return '';
    return [task.updatedAt, task.priorityChangedAt, task.doneAt, task.createdAt]
      .map(value => String(value || ''))
      .sort()
      .pop() || '';
  }

  function mergeCronoTasks(a, b) {
    const byId = new Map();
    const add = (task, sourceRank) => {
      if (!task || typeof task !== 'object') return;
      const id = String(task.id || '').trim();
      if (!id) return;
      const current = byId.get(id);
      if (!current) {
        byId.set(id, { task, sourceRank });
        return;
      }
      const currentAt = cronoTaskMutationAt(current.task);
      const candidateAt = cronoTaskMutationAt(task);
      if (candidateAt > currentAt || (candidateAt === currentAt && sourceRank >= current.sourceRank)) {
        byId.set(id, { task: Object.assign({}, current.task, task), sourceRank });
      }
    };
    (a || []).forEach(task => add(task, 0));
    (b || []).forEach(task => add(task, 1));
    return Array.from(byId.values())
      .map(entry => entry.task)
      .sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')) || String(x.id || '').localeCompare(String(y.id || '')))
      .slice(-5000);
  }

'''
text = text.replace(marker, helper + marker, 1)
old = "    merged.memoryCards = mergeMemoryCards(base.memoryCards, other.memoryCards);\n    merged.historicalRepertoire = mergeHistoricalRepertoire(base.historicalRepertoire, other.historicalRepertoire);"
new = "    merged.memoryCards = mergeMemoryCards(base.memoryCards, other.memoryCards);\n    // Las tareas son datos de usuario aditivos: una nube más reciente nunca debe\n    // borrar una tarea creada localmente y aún no subida.\n    merged.cronoTasks = mergeCronoTasks(base.cronoTasks, other.cronoTasks);\n    merged.historicalRepertoire = mergeHistoricalRepertoire(base.historicalRepertoire, other.historicalRepertoire);"
if old not in text:
    raise SystemExit('DataCore cronoTasks insertion marker missing')
text = text.replace(old, new, 1)
old = "    mergeMemoryCards,\n    mergeHabitChallenge,"
new = "    mergeMemoryCards,\n    mergeCronoTasks,\n    cronoTaskMutationAt,\n    mergeHabitChallenge,"
if old not in text:
    raise SystemExit('DataCore export marker missing')
text = text.replace(old, new, 1)
data.write_text(text)

# Every task mutation gets updatedAt so conflicts have a deterministic winner.
replace_bytes(
    'app.js',
    "    createdAt: new Date().toISOString(),\n  });\n  saveData();\n  closeModal('modalCronoNote');",
    "    createdAt: new Date().toISOString(),\n    updatedAt: new Date().toISOString(),\n  });\n  saveData();\n  closeModal('modalCronoNote');",
    'tomorrow task timestamp')
replace_bytes(
    'app.js',
    "    priority: 0,\n    createdAt: new Date().toISOString(),\n  });\n  if (_cronoTaskVoiceSource === source)",
    "    priority: 0,\n    createdAt: new Date().toISOString(),\n    updatedAt: new Date().toISOString(),\n  });\n  if (_cronoTaskVoiceSource === source)",
    'composer task timestamp')
replace_bytes(
    'app.js',
    "  task.priority = next;\n  task.priorityChangedAt = new Date().toISOString();\n  saveData();",
    "  const changedAt = new Date().toISOString();\n  task.priority = next;\n  task.priorityChangedAt = changedAt;\n  task.updatedAt = changedAt;\n  saveData();",
    'priority timestamp')
replace_bytes(
    'app.js',
    "    task.done = !task.done;\n    task.doneAt = task.done ? new Date().toISOString() : null;\n    saveData();",
    "    const changedAt = new Date().toISOString();\n    task.done = !task.done;\n    task.doneAt = task.done ? changedAt : null;\n    task.updatedAt = changedAt;\n    saveData();",
    'done timestamp')

# If cloud wins by timestamp but merge changed tasks, upload merged result back.
replace_bytes(
    'app.js',
    "        const localPulseDeletedN = localDb ? (localDb.pulseDeletedIds || []).length : 0;\n        const cloudPulseDeletedN = (data.data.pulseDeletedIds || []).length;\n        const localHasMore = localMin > cloudMin || localEstadoN > cloudEstadoN || localImpulsoN > cloudImpulsoN || localResistenciaN > cloudResistenciaN || localDeporteN > cloudDeporteN || localSuenoN > cloudSuenoN || localTriggerN > cloudTriggerN || localTiempoN > cloudTiempoN || localPulseDeletedN > cloudPulseDeletedN;",
    "        const localPulseDeletedN = localDb ? (localDb.pulseDeletedIds || []).length : 0;\n        const cloudPulseDeletedN = (data.data.pulseDeletedIds || []).length;\n        const mergedTasksChangedCloud = JSON.stringify(db.cronoTasks || []) !== JSON.stringify(data.data.cronoTasks || []);\n        const localHasMore = localMin > cloudMin || localEstadoN > cloudEstadoN || localImpulsoN > cloudImpulsoN || localResistenciaN > cloudResistenciaN || localDeporteN > cloudDeporteN || localSuenoN > cloudSuenoN || localTriggerN > cloudTriggerN || localTiempoN > cloudTiempoN || localPulseDeletedN > cloudPulseDeletedN || mergedTasksChangedCloud;",
    'cloud merged task upload')

# Unit tests reproduce the exact rollback and same-id conflict scenarios.
tests = Path('tests/unit/data-core.test.js')
t = tests.read_text()
insert = r'''

  it('keeps local cronometro tasks when a newer cloud snapshot does not contain them', () => {
    const cloud = {
      cronoTasks: [{ id: 'old-1', text: 'Tarea antigua', createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-20T10:00:00Z', done: false }],
    };
    const local = {
      cronoTasks: [
        { id: 'old-1', text: 'Tarea antigua', createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-20T10:00:00Z', done: false },
        { id: 'new-1', text: 'Añadida ayer', createdAt: '2026-08-30T17:00:00Z', updatedAt: '2026-08-30T17:00:00Z', done: false },
      ],
    };
    const merged = DataCore.mergeStudyHistory(cloud, local);
    expect(merged.cronoTasks.map(task => task.id)).toEqual(['old-1', 'new-1']);
  });

  it('keeps a cloud-only cronometro task when local is the freshest snapshot', () => {
    const merged = DataCore.mergeStudyHistory(
      { cronoTasks: [{ id: 'local-1', text: 'Local', createdAt: '2026-08-30T17:00:00Z', updatedAt: '2026-08-30T17:00:00Z', done: false }] },
      { cronoTasks: [{ id: 'cloud-1', text: 'Nube', createdAt: '2026-08-30T16:00:00Z', updatedAt: '2026-08-30T16:00:00Z', done: false }] }
    );
    expect(merged.cronoTasks.map(task => task.id)).toEqual(['cloud-1', 'local-1']);
  });

  it('uses the newest same-id cronometro task mutation instead of snapshot order', () => {
    const older = { id: 'task-1', text: 'Texto viejo', createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-30T10:00:00Z', done: false, priority: 0 };
    const newer = { id: 'task-1', text: 'Texto nuevo', createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-30T11:00:00Z', done: true, doneAt: '2026-08-30T11:00:00Z', priority: 2 };
    const mergedA = DataCore.mergeStudyHistory({ cronoTasks: [newer] }, { cronoTasks: [older] });
    const mergedB = DataCore.mergeStudyHistory({ cronoTasks: [older] }, { cronoTasks: [newer] });
    expect(mergedA.cronoTasks[0]).toMatchObject({ text: 'Texto nuevo', done: true, priority: 2 });
    expect(mergedB.cronoTasks[0]).toMatchObject({ text: 'Texto nuevo', done: true, priority: 2 });
  });
'''
pos = t.rfind('\n});')
if pos < 0:
    raise SystemExit('data-core test closing marker missing')
t = t[:pos] + insert + t[pos:]
tests.write_text(t)

# Cache bust so installed PWA discovers the fix.
replace_bytes('index.html', 'app.js?v=280', 'app.js?v=281', 'index app version')
replace_bytes('index.html', 'data-core.js?v=230', 'data-core.js?v=231', 'index data-core version')
replace_bytes('sw.js', "const CACHE = 'estudio-v312';", "const CACHE = 'estudio-v313';", 'sw cache version')
replace_bytes('sw.js', "'./app.js?v=280'", "'./app.js?v=281'", 'sw app version')
replace_bytes('sw.js', "'./data-core.js?v=230'", "'./data-core.js?v=231'", 'sw data-core version')
