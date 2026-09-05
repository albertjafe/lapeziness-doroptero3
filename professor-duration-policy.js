(function professorDurationPolicy(root){
  'use strict';

  const MARKER = 'PROFESSOR_DURATION_PREFERENCE_V3';
  const RULES = `${MARKER}
POLÍTICA DE DURACIÓN Y PLAN REALISTA
- La referencia diaria es la PREFERENCIA_DURACION de este turno (4, 5 o 6+ horas TOTALES), contando lo ya estudiado hoy. No impongas siempre 4 horas.
- Orden de precedencia: condición explícita del usuario para este turno > preferencia diaria guardada > cifras por defecto de prompts antiguos. La preferencia nueva sustituye cualquier antigua regla fija de 4 horas.
- Separa tu recomendación profesional de las ampliaciones opcionales. La referencia no es una obligación ni un techo: puedes recomendar menos, parar, o ampliar si lo justifican preparación, fatiga y compromisos reales.
- Construye HOY, LO QUE QUEDA DE HOY y AHORA desde HORA_LOCAL_REAL. Cuenta pausas y da la hora aproximada de finalización; no empieces desde una mañana imaginaria.
- Resta todo lo estudiado HOY, incluido el tiempo de sesión activa ya incluido en el total. Nunca sumes dos veces ni generes minutos negativos.
- Para HOY/LO QUE QUEDA DE HOY: plan principal con obra + movimiento, minutos y propósito; después «Si aun así quieres ampliar», con los escalones de este turno y su tiempo adicional. Una ampliación NO implica que recomiendes esas horas. Si no hay trabajo útil, dilo; no rellenes.
- Para AHORA: bloque concreto desde este instante y alternativa breve. Para 7 días: usa la referencia por día, ajustada a disponibilidad, compromisos y recuperación; no conviertas referencia × 7 en una cuota obligatoria.
- Mantén solo repertorio con evento/proyecto futuro enlazado en el plan. No introduzcas una obra sin evento solo para rellenar horas. Ampliar puede reforzar o repetir movimientos elegidos, incorporar otras unidades enlazadas o combinar ambas opciones según valor marginal.`;

  function normalizeHours(value) {
    const hours = Number(value);
    return [4,5,6].includes(hours) ? hours : 4;
  }

  function budgetContext(value, report, mode) {
    const hours = normalizeHours(value);
    const studied = Math.max(0, Number(report?.today?.totalKnownMinutes) || 0);
    const alternatives = hours === 4 ? [5,6] : hours === 5 ? [6] : [7];
    return `PREFERENCIA_DURACION
Referencia guardada: ${hours === 6 ? '6+':hours} horas TOTALES al día; base para calcular = ${hours * 60} min.
Ya estudiado HOY = ${studied} min; para alcanzar la base faltan ${Math.max(0,hours * 60-studied)} min.
${mode === 'week' ? 'Esta referencia es diaria, no el total semanal. ' : ''}${hours === 6 ? '6+ permite ampliar sobre 6 h si hay valor real; no obliga a 7 h ni fija un techo. ' : ''}
Escalones opcionales de este turno: ${alternatives.map(h => `${h} horas TOTALES (adicionales desde ahora: ${Math.max(0,h*60-studied)} min${studied>=h*60 ? '; ya alcanzado':''})`).join('; ')}.
Si la condición del usuario cambia la disponibilidad, recalcula estos números antes de planificar.`;
  }

  function database(){
    try { return typeof db !== 'undefined' ? db : (root && root.db ? root.db : null); }
    catch (error) { return root && root.db ? root.db : null; }
  }

  function ensurePolicy(prompt){
    const value = String(prompt || '').trim();
    if (value.includes(MARKER)) return value;
    return `${value}${value ? '\n\n' : ''}${RULES}`;
  }

  function temporalContext(now){
    const d = now instanceof Date ? now : new Date();
    let zone = '';
    let local = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (error) {}
    try {
      local = new Intl.DateTimeFormat('es-ES', {
        year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit',
        hour12:false, timeZoneName:'short'
      }).format(d);
    } catch (error) { local = d.toString(); }
    return `CONTEXTO TEMPORAL DE ESTE TURNO\nHORA_LOCAL_REAL=${local}${zone ? ` | zona=${zone}` : ''}\nINSTANTE_ISO=${d.toISOString()}\nUsa esta hora como «ahora» para calcular lo que cabe realmente hoy, las pausas y la hora aproximada de finalización.`;
  }

  function promptWithTime(prompt, now){
    return `${ensurePolicy(prompt)}\n\n${temporalContext(now)}`;
  }

  function freshReport(professor, fallback, now){
    const data = database();
    if (!data || !professor || typeof professor.buildReport !== 'function') return fallback;
    try {
      const report = professor.buildReport(data, { asOf: now });
      report.deviceLocalNow = temporalContext(now);
      return report;
    } catch (error) { return fallback; }
  }

  function install(){
    const professor = root && root.ProfessorCore;
    if (!professor || professor.__professorDurationPolicyInstalled) return false;

    professor.DEFAULT_MASTER_PROMPT = ensurePolicy(professor.DEFAULT_MASTER_PROMPT);

    if (typeof professor.buildPrompt === 'function') {
      const originalBuildPrompt = professor.buildPrompt;
      professor.buildPrompt = function(report, options){
        const now = new Date();
        const opts = Object.assign({}, options || {});
        const fresh = freshReport(professor, report, now);
        opts.masterPrompt = promptWithTime(opts.masterPrompt || professor.DEFAULT_MASTER_PROMPT, now) + '\n\n' + budgetContext(opts.dailyHours ?? database()?.professorSettings?.dailyHours,fresh,opts.mode);
        return originalBuildPrompt.call(this, fresh, opts);
      };
      professor.buildPrompt.__professorDurationPolicy = true;
    }

    if (typeof professor.buildChatGptUrl === 'function') {
      const originalBuildChatGptUrl = professor.buildChatGptUrl;
      professor.buildChatGptUrl = function(report, options){
        const now = new Date();
        const opts = Object.assign({}, options || {});
        const fresh = freshReport(professor, report, now);
        opts.masterPrompt = promptWithTime(opts.masterPrompt || professor.DEFAULT_MASTER_PROMPT, now) + '\n\n' + budgetContext(opts.dailyHours ?? database()?.professorSettings?.dailyHours,fresh,opts.mode);
        return originalBuildChatGptUrl.call(this, fresh, opts);
      };
      professor.buildChatGptUrl.__professorDurationPolicy = true;
    }

    professor.__professorDurationPolicyInstalled = true;
    return true;
  }

  root.ProfessorDurationPolicy = { MARKER, RULES, normalizeHours, budgetContext, ensurePolicy, temporalContext, promptWithTime, install };
  install();
})(typeof window !== 'undefined' ? window : globalThis);
