// Enriches the synchronous musical report with daily wellbeing metadata and a
// privacy-preserving digital-activity summary. It also keeps a derived Supabase
// cache fresh after saves so ChatGPT/connected tools can inspect one compact row.
(function professorContextEnrichment(){
  'use strict';
  const core = window.ProfessorCore;
  if (!core || typeof core.buildReport !== 'function' || core.buildReport.__professorEnriched) return;

  const originalBuild = core.buildReport;
  const DAY = 86400000;
  let latestDigital = { available: false, refreshedAt: null, todayMinutes: 0, d7Minutes: 0, todayByCategory: {}, d7ByCategory: {}, todayTopApps: [], d7TopApps: [], devices: [] };
  let refreshPromise = null;
  let cacheTimer = null;
  let wrappedSave = false;

  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const round1 = value => Math.round(num(value) * 10) / 10;
  const dateOf = value => { const d = value instanceof Date ? value : new Date(value); return Number.isFinite(d.getTime()) ? d : null; };
  const localDay = value => {
    const d = dateOf(value); if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  function database(){ try { return typeof db !== 'undefined' ? db : window.db || {}; } catch (error) { return window.db || {}; } }
  function sb(){ try { return typeof window.getSB === 'function' ? window.getSB() : null; } catch (error) { return null; } }

  function dailyState(db, asOf){
    const state = db && db.estadoDiario && typeof db.estadoDiario === 'object' ? db.estadoDiario : null;
    if (!state) return { available: false };
    const stateDay = dateOf(state.date);
    const sameDay = stateDay ? localDay(stateDay) === localDay(asOf) : true;
    if (!sameDay) return { available: false, reason: 'estadoDiario no corresponde al día del informe' };
    return {
      available: true,
      userSet: Boolean(state.userSet),
      sleepUserSet: Boolean(state.suenoUserSet),
      sleepScore: state.sueno == null ? null : num(state.sueno),
      moodScore: state.estado == null ? null : num(state.estado),
      energyScore: state.energia == null ? null : num(state.energia),
      clarityScore: state.claridad == null ? null : num(state.claridad),
      wellbeingScore: state.bienestar == null ? null : num(state.bienestar),
      availableTime: state.tiempoDisponible ?? null,
      naps: state.siestas && typeof state.siestas === 'object' ? { count: num(state.siestas.count), lastAt: state.siestas.lastAt || null } : null,
      sport: state.deporte && typeof state.deporte === 'object' ? { total: num(state.deporte.total), cardio: state.deporte.cardio ?? null, fuerza: state.deporte.fuerza ?? null } : null,
      note: !state.userSet && !state.suenoUserSet ? 'Valores automáticos/neutros: no tratarlos como declaración del usuario.' : null,
    };
  }

  function topMap(map, limit=6){
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([name, minutes])=>({ name, minutes: round1(minutes) }));
  }

  async function refreshDigital(force){
    if (refreshPromise) return refreshPromise;
    if (!force && latestDigital.refreshedAt && Date.now() - new Date(latestDigital.refreshedAt).getTime() < 4 * 60 * 1000) return latestDigital;
    const client = sb();
    if (!client) return latestDigital;
    refreshPromise = (async () => {
      try {
        const auth = await client.auth.getUser();
        const user = auth && auth.data && auth.data.user;
        if (!user || !user.id) return latestDigital;
        const now = new Date();
        const start = new Date(now.getTime() - 7 * DAY);
        const query = await client.from('activity_events')
          .select('started_at,ended_at,local_date,app,category,device_type,source,is_afk')
          .eq('user_id', user.id)
          .gte('local_date', localDay(start));
        if (query && query.error) throw query.error;
        const rows = arr(query && query.data);
        const today = localDay(now);
        const todayCat = {}, d7Cat = {}, todayApps = {}, d7Apps = {}, devices = new Set();
        let todayMinutes = 0, d7Minutes = 0;
        rows.forEach(row => {
          if (!row || row.is_afk) return;
          const startAt = dateOf(row.started_at), endAt = dateOf(row.ended_at);
          if (!startAt || !endAt || endAt <= startAt) return;
          const minutes = Math.min(12 * 60, Math.max(0, (endAt - startAt) / 60000));
          if (!minutes) return;
          const category = String(row.category || 'sin categoría');
          const app = String(row.app || row.source || 'actividad');
          d7Minutes += minutes; d7Cat[category] = (d7Cat[category] || 0) + minutes; d7Apps[app] = (d7Apps[app] || 0) + minutes;
          if (row.device_type) devices.add(String(row.device_type));
          if (String(row.local_date || localDay(startAt)) === today) {
            todayMinutes += minutes; todayCat[category] = (todayCat[category] || 0) + minutes; todayApps[app] = (todayApps[app] || 0) + minutes;
          }
        });
        latestDigital = {
          available: rows.length > 0,
          refreshedAt: new Date().toISOString(),
          eventCount7d: rows.length,
          todayMinutes: round1(todayMinutes), d7Minutes: round1(d7Minutes),
          todayByCategory: Object.fromEntries(Object.entries(todayCat).map(([k,v])=>[k,round1(v)])),
          d7ByCategory: Object.fromEntries(Object.entries(d7Cat).map(([k,v])=>[k,round1(v)])),
          todayTopApps: topMap(todayApps), d7TopApps: topMap(d7Apps), devices: [...devices],
          privacy: 'Solo metadatos agregados: app/categoría/dispositivo/duración; sin texto escrito, mensajes ni pulsaciones.',
        };
        return latestDigital;
      } catch (error) {
        latestDigital = { ...latestDigital, refreshedAt: new Date().toISOString(), error: 'actividad digital no disponible' };
        return latestDigital;
      } finally { refreshPromise = null; }
    })();
    return refreshPromise;
  }

  const wrappedBuild = function buildEnrichedProfessorReport(dbArg, options){
    const report = originalBuild.apply(this, arguments);
    if (!report) return report;
    const asOf = options && options.asOf ? new Date(options.asOf) : new Date(report.asOf || Date.now());
    report.dailyState = dailyState(dbArg || {}, asOf);
    report.digitalActivity = latestDigital;
    return report;
  };
  wrappedBuild.__professorEnriched = true;
  core.buildReport = wrappedBuild;

  async function writeCache(){
    try {
      await refreshDigital(false);
      const client = sb(); if (!client) return false;
      const auth = await client.auth.getUser();
      const user = auth && auth.data && auth.data.user; if (!user || !user.id) return false;
      const data = database();
      const report = core.buildReport(data, { asOf: new Date() });
      const result = await client.from('professor_context_cache').upsert({
        user_id: user.id,
        context: report,
        generated_at: report.generatedAt,
        data_updated_at: data && data._savedAt || null,
      }, { onConflict: 'user_id' });
      return !(result && result.error);
    } catch (error) { return false; }
  }

  function scheduleCache(delay=1400){
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(writeCache, delay);
  }

  function wrapSaveData(){
    if (wrappedSave) return;
    const original = window.saveData;
    if (typeof original !== 'function' || original.__professorCacheWrapped) return;
    const wrapped = function saveDataWithProfessorCache(){
      const result = original.apply(this, arguments);
      if (result && typeof result.then === 'function') return result.finally(() => scheduleCache());
      scheduleCache();
      return result;
    };
    wrapped.__professorCacheWrapped = true;
    window.saveData = wrapped;
    wrappedSave = true;
  }

  window.ProfessorContextEnrichment = { refreshDigital, writeCache, scheduleCache, latestDigital: () => latestDigital };
  wrapSaveData();
  setTimeout(() => { refreshDigital(true).then(() => scheduleCache(50)); }, 1200);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wrapSaveData(); refreshDigital(false); scheduleCache(1800); } });
  window.addEventListener('focus', () => { wrapSaveData(); refreshDigital(false); });
  setInterval(() => refreshDigital(false), 5 * 60 * 1000);
})();
