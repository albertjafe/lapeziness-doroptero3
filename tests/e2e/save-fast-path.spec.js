import { test, expect } from '@playwright/test';

// Guardado por secciones (v506): debe dar exactamente el mismo documento que el
// camino completo (seguir cambios + fusionar con el disco), y ser mucho más rápido.
const iso = i => new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString();
const data = {
  obras: Array.from({ length: 20 }, (_, i) => ({ id: 'o' + i, name: 'Obra ' + i, tipo: 'obra', movimientos: [{ id: 'm' + i, name: 'I', solHistory: [] }], solHistory: [{ date: iso(i), val: 50 }] })),
  sesiones: Array.from({ length: 800 }, (_, i) => ({ id: 's' + i, date: iso(i), min: 30, items: [{ obraId: 'o1', min: 30 }] })),
  forestPlants: Array.from({ length: 3000 }, (_, i) => ({ id: 'f' + i, mins: 30, obraId: 'o1', startedAt: iso(i), extra: 'z'.repeat(80) })),
  sessionPlants: [], registro: [], eventos: [{ id: 'e1', nombre: 'Concurso', fecha: '2026-11-01', obras: ['o1'] }],
  cronoTasks: Array.from({ length: 10 }, (_, i) => ({ id: 't' + i, text: 'Tarea ' + i, kind: 'personal', priority: 0, done: false, createdAt: iso(i) })),
  habitChallenge: { id: 'h1', title: 'Reto', startDate: '2026-10-01', logs: {}, updatedAt: iso(1) },
  someSetting: 'a',
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(d => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(d));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

test('section-level save gives exactly the same document as the full merge', async ({ page }) => {
  await prepare(page);
  const results = await page.evaluate(() => {
    saveData();                                   // establece lo que hay en disco
    const mutations = {
      task: () => { const t = db.cronoTasks[3]; t.priority = 2; t.updatedAt = new Date().toISOString(); },
      newSession: () => { db.sesiones.push({ id: 'snew', date: new Date().toISOString(), min: 45, items: [] }); },
      deleteTask: () => { db.cronoTasks.splice(1, 1); },
      deleteSection: () => { delete db.someSetting; },
      addSection: () => { db.brandNew = { id: 'x', value: 1 }; },
      nested: () => { db.habitChallenge.logs['2026-10-02'] = { status: 'failed' }; db.obras[0].movimientos[0].name = 'I. Allegro'; },
    };
    const out = {};
    for (const [name, mutate] of Object.entries(mutations)) {
      mutate();
      const snap = { db: JSON.stringify(db), last: JSON.stringify(_lastSavedDocument), cache: _saveCache };
      const realNow = Date.now; const fixed = realNow() + 1000; Date.now = () => fixed;
      const t0 = performance.now(); _prepareLocalDocument(true); const fastMs = performance.now() - t0;
      const fast = JSON.stringify(db);
      // Mismo punto de partida por el camino completo.
      DocumentSyncCore.assign(db, JSON.parse(snap.db));
      _lastSavedDocument = JSON.parse(snap.last);
      _saveCache = null;
      const t1 = performance.now(); _prepareLocalDocument(true); const fullMs = performance.now() - t1;
      const full = JSON.stringify(db);
      Date.now = realNow;
      out[name] = { same: fast === full, fastMs: Math.round(fastMs), fullMs: Math.round(fullMs) };
      if (fast !== full) out[name].diff = [fast.slice(0, 200), full.slice(0, 200)];
      saveData();                                 // guarda y deja la caché lista para el siguiente
      _saveCache = _saveCache || null;
    }
    return { out, cacheReady: !!_saveCache };
  });
  console.log('TIEMPOS', JSON.stringify(results.out));
  for (const [name, r] of Object.entries(results.out)) expect(r.same, name + ' ' + JSON.stringify(r)).toBe(true);
  expect(results.cacheReady).toBe(true);
});

test('if another tab wrote the document, the full path is used', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    saveData();
    const before = !!_saveCache;
    const other = JSON.parse(localStorage.getItem('alberto_piano_v2'));
    other.cronoTasks.push({ id: 'other-tab', text: 'Desde otra pestaña', kind: 'personal', done: false, createdAt: new Date().toISOString() });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(other));
    db.cronoTasks[0].priority = 3; db.cronoTasks[0].updatedAt = new Date().toISOString();
    saveData();
    const saved = JSON.parse(localStorage.getItem('alberto_piano_v2'));
    return { before, keepsOther: saved.cronoTasks.some(t => t.id === 'other-tab'), keepsMine: saved.cronoTasks[0].priority === 3 };
  });
  expect(r.before).toBe(true);
  expect(r.keepsOther).toBe(true);
  expect(r.keepsMine).toBe(true);
});

test('a task-only save does not repaint study views and the text is built once', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(async () => {
    saveData();
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
    let refreshes = 0, stringifiedDocs = 0;
    const origRefresh = refreshConcentradoUI;
    refreshConcentradoUI = function (...a) { refreshes++; return origRefresh.apply(this, a); };
    const origStringify = JSON.stringify;
    JSON.stringify = function (v, ...rest) { if (v === db) stringifiedDocs++; return origStringify.call(this, v, ...rest); };
    try {
      db.cronoTasks[2].priority = 3; db.cronoTasks[2].updatedAt = new Date().toISOString();
      saveData();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
      const tasksOnly = refreshes;
      db.sesiones.push({ id: 'snew2', date: new Date().toISOString(), min: 30, items: [] });
      saveData();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
      return { tasksOnly, afterStudy: refreshes, stringifiedDocs, cache: !!_saveCache, saved: JSON.parse(localStorage.getItem('alberto_piano_v2')).cronoTasks[2].priority };
    } finally { JSON.stringify = origStringify; refreshConcentradoUI = origRefresh; }
  });
  expect(r.tasksOnly).toBe(0);
  expect(r.afterStudy).toBe(1);
  expect(r.stringifiedDocs).toBe(0);   // se arma por secciones, nunca el documento entero
  expect(r.cache).toBe(true);
  expect(r.saved).toBe(3);
});

test('reading legacy habits stays pure and task edits do not invalidate study caches', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const today = habitDayKey();
    db.habitChallenge = {id:'legacy-habit',mode:'avoid',durationDays:21,startDate:today,
      logs:{'2020-01-01':{status:'failed'}},completedAt:'2020-01-02',rewardClaimedAt:'2020-01-03'};
    db.habitChallenges = [db.habitChallenge];
    saveData();
    await new Promise(r => requestAnimationFrame(() => setTimeout(r,50)));
    const before = JSON.stringify(db.habitChallenge), version = _studyDataVersion;
    const views = [habitAllChallenges(), habitActiveChallenges(), habitCompletedChallenges()];
    renderHabitChallenge();renderHabitCalendar();
    const afterRead = JSON.stringify(db.habitChallenge);
    let refreshes = 0;
    const original = refreshConcentradoUI;
    refreshConcentradoUI = () => {refreshes++;};
    try {
      db.cronoTasks[0].text = 'Solo cambia una tarea';
      db.cronoTasks[0].updatedAt = new Date().toISOString();
      saveData();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r,50)));
      const saved=JSON.parse(localStorage.getItem('alberto_piano_v2'));
      return {pure:before===afterRead,versionStable:version===_studyDataVersion,refreshes,
        active:views[1].length,completed:views[2].length,projectedLogs:Object.keys(views[0][0].logs).length,
        keepsLegacy:!!saved.habitChallenge.logs['2020-01-01']};
    } finally {refreshConcentradoUI=original;}
  });
  expect(result).toEqual({pure:true,versionStable:true,refreshes:0,active:1,completed:0,projectedLogs:0,keepsLegacy:true});
});

test('manual activity mirrors are complete in one durable save', async ({ page }) => {
  await prepare(page);
  const result=await page.evaluate(()=>{
    const set=Storage.prototype.setItem;let writes=0;
    Storage.prototype.setItem=function(key,value){if(key===DB_KEY)writes++;return set.call(this,key,value);};
    try {
      const result=persistManualStudyHistory({obraId:'o1',movId:null,name:'Obra 1'},40,habitDayKey(),{activityType:'chamber',useCurrentTime:true});
      const stored=JSON.parse(localStorage.getItem(DB_KEY));
      const plant=stored.sessionPlants.find(x=>x.id===result.item.studyPlantId);
      const item=stored.sesiones.flatMap(x=>x.items||[]).find(x=>x.id===result.item.id);
      return {writes,plant:{type:plant.activityType,factor:plant.activityFactor,mins:plant.mins},
        item:{type:item.activityType,factor:item.activityFactor,mins:item.minutosReales}};
    } finally {Storage.prototype.setItem=set;}
  });
  expect(result).toEqual({writes:1,plant:{type:'chamber',factor:.5,mins:40},item:{type:'chamber',factor:.5,mins:40}});
});

test('task bursts wait for a real quiet interval and flush durably on demand', async ({ page }) => {
  await prepare(page);
  const result=await page.evaluate(async()=>{
    let saves=0;const original=saveData;
    saveData=function(){saves++;return original.apply(this,arguments);};
    try {
      saveDataSoon();await new Promise(r=>setTimeout(r,550));
      saveDataSoon();await new Promise(r=>setTimeout(r,550));
      const duringBurst=saves;
      flushSaveDataSoon();return {duringBurst,afterFlush:saves,pending:!!_saveSoonTimer};
    } finally {saveData=original;}
  });
  expect(result).toEqual({duringBurst:0,afterFlush:1,pending:false});
});

test('correcting an urgent task invalidates rewards even with the same completed count', async ({ page }) => {
  await prepare(page);
  const result=await page.evaluate(()=>{
    const now=Date.now();
    db.cronoTasks.push({id:'completed-urgent',text:'Synthetic urgent task',priority:3,done:true,
      createdAt:new Date(now-2*3600e3).toISOString(),doneAt:new Date(now-3600e3).toISOString()});
    saveData();
    const first=cachedPianoWalletSnapshot(),reused=first===cachedPianoWalletSnapshot();
    db.cronoTasks.find(t=>t.id==='completed-urgent').doneAt=new Date(now-5*3600e3).toISOString();
    saveData();const corrected=cachedPianoWalletSnapshot();
    const rows=snap=>snap.bonusRows.filter(row=>row.process==='urgent-task').length;
    return {reused,invalidated:first!==corrected,before:rows(first),after:rows(corrected)};
  });
  expect(result).toEqual({reused:true,invalidated:true,before:1,after:0});
});

test('the first durable timer snapshot includes the canonical block and reward policy', async ({ page }) => {
  await prepare(page);
  const result=await page.evaluate(()=>{
    const runId='one-atomic-session';
    Object.assign(crono,{state:'running',mode:'stopwatch',runId,startTs:Date.now()-25*60000,
      pausedMs:0,pauseStartTs:null,obraId:'o1',movId:null,displayName:'Synthetic session',isRest:false,
      activityType:'chamber',targetDurationMs:null,rewardGoalId:'synthetic-goal',rewardPolicyVersion:6});
    const set=Storage.prototype.setItem;let first;
    Storage.prototype.setItem=function(key,value){
      if(key===DB_KEY&&!first)first=JSON.parse(value);
      return set.call(this,key,value);
    };
    try {
      cronoFinish(runId);
      const block=first.sessionPlants.find(p=>p.runId===runId);
      const policy=first.pianoRewards.sessions.find(p=>p.id===runId);
      return {block:{mins:block.mins,type:block.activityType,factor:DailyStudyMinutes.activityFactor(block)},
        policy:{goal:policy.goalId,type:policy.activityType},state:crono.state,
        blocks:first.sessionPlants.filter(p=>p.runId===runId).length};
    } finally {Storage.prototype.setItem=set;}
  });
  expect(result).toEqual({block:{mins:25,type:'chamber',factor:.5},policy:{goal:'synthetic-goal',type:'chamber'},state:'idle',blocks:1});
});
