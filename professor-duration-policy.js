(function professorDurationPolicy(root){
  'use strict';

  const MARKER = 'PROFESSOR_DURATION_FALLBACK_V2';
  const RULES = `${MARKER}
POLÍTICA DE DURACIÓN, HORA REAL Y PLAN CONDICIONAL
- Separa SIEMPRE dos cosas: (1) tu recomendación profesional sobre cuánto conviene estudiar y (2) qué hacer si el usuario decide estudiar más de todos modos.
- Puedes recomendar con total libertad no ampliar el día, parar en 4 horas, hacer menos, o recomendar 5, 5 h 30 o 6 horas si la carga, urgencia y calidad de trabajo disponible lo justifican. Cuatro horas son una referencia, no un techo ni una respuesta automática.
- La HORA ACTUAL REAL es una restricción importante. Para HOY, LO QUE QUEDA DE HOY o AHORA, construye el horario desde la hora local indicada en el contexto temporal de este turno, no desde una mañana imaginaria ni desde la hora a la que se abrió anteriormente la pantalla del Profesor.
- Ten en cuenta pausas y hora aproximada de finalización. Si llegar a 5 o 6 horas totales obligaría a terminar demasiado tarde o haría poco realista el plan, dilo claramente y úsalo al decidir tu recomendación principal.
- Aun cuando desaconsejes ampliar por la hora, fatiga o poco valor marginal, ofrece igualmente las alternativas condicionales pedidas para 5 h y 6 h, indicando su hora aproximada de finalización cuando sea relevante.
- En las peticiones de organizar HOY o LO QUE QUEDA DE HOY nunca termines solo con «yo no ampliaría», «no hace falta estudiar más» o equivalente.
- Después de tu recomendación incluye siempre un apartado claramente separado: «Si aun así quieres ampliar».
- En ese apartado da un plan CONCRETO para llegar a 5 horas TOTALES y otro para llegar a 6 horas TOTALES, contando todo lo que ya se haya estudiado hoy. Indica cuánto tiempo adicional falta para cada total.
- Para cada alternativa de 5 h y 6 h, especifica obra + movimiento, minutos y propósito del bloque. No basta con decir «más de lo mismo» o «repasa repertorio».
- El plan condicional NO implica que recomiendes esas horas. Si crees que 4 h es mejor, dilo primero y luego ofrece igualmente las alternativas de 5 h y 6 h para que el usuario pueda decidir.
- Mantén el filtro musical existente: solo repertorio con evento/proyecto futuro enlazado. No introduzcas una obra sin evento solo para rellenar horas.
- Si al ampliar no merece la pena incorporar otra obra, usa el tiempo adicional en los movimientos enlazados con mayor valor marginal: segundo bloque, trabajo de puntos concretos, pase, memoria, recuperación, resistencia, tempo o consolidación, según los datos.
- Si de verdad no existe trabajo musical útil para completar 5 h o 6 h, dilo explícitamente, pero aun así ofrece la opción menos mala y concreta dentro del repertorio enlazado en vez de omitir la alternativa.
- Si el usuario ya ha superado uno de esos totales hoy, no inventes tiempo negativo: marca ese escalón como ya superado y adapta el siguiente bloque útil desde la hora actual.`;

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
        opts.masterPrompt = promptWithTime(opts.masterPrompt || professor.DEFAULT_MASTER_PROMPT, now);
        return originalBuildPrompt.call(this, freshReport(professor, report, now), opts);
      };
      professor.buildPrompt.__professorDurationPolicy = true;
    }

    if (typeof professor.buildChatGptUrl === 'function') {
      const originalBuildChatGptUrl = professor.buildChatGptUrl;
      professor.buildChatGptUrl = function(report, options){
        const now = new Date();
        const opts = Object.assign({}, options || {});
        opts.masterPrompt = promptWithTime(opts.masterPrompt || professor.DEFAULT_MASTER_PROMPT, now);
        return originalBuildChatGptUrl.call(this, freshReport(professor, report, now), opts);
      };
      professor.buildChatGptUrl.__professorDurationPolicy = true;
    }

    professor.__professorDurationPolicyInstalled = true;
    return true;
  }

  root.ProfessorDurationPolicy = { MARKER, RULES, ensurePolicy, temporalContext, promptWithTime, install };
  install();
})(typeof window !== 'undefined' ? window : globalThis);
