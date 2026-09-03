(function professorDurationPolicy(root){
  'use strict';

  const MARKER = 'PROFESSOR_DURATION_FALLBACK_V1';
  const RULES = `${MARKER}
POLÍTICA DE DURACIÓN Y PLAN CONDICIONAL
- Separa SIEMPRE dos cosas: (1) tu recomendación profesional sobre cuánto conviene estudiar y (2) qué hacer si el usuario decide estudiar más de todos modos.
- Puedes recomendar con total libertad no ampliar el día, parar en 4 horas, hacer menos, o considerar que 5–6 horas no aportan suficiente valor. Ese consejo debe mantenerse si es lo que concluyes.
- PERO en las peticiones de organizar HOY o LO QUE QUEDA DE HOY nunca termines solo con «yo no ampliaría», «no hace falta estudiar más» o equivalente.
- Después de tu recomendación incluye siempre un apartado claramente separado: «Si aun así quieres ampliar».
- En ese apartado da un plan CONCRETO para llegar a 5 horas TOTALES y otro para llegar a 6 horas TOTALES, contando todo lo que ya se haya estudiado hoy. Indica cuánto tiempo adicional falta para cada total.
- Para cada alternativa de 5 h y 6 h, especifica obra + movimiento, minutos y propósito del bloque. No basta con decir «más de lo mismo» o «repasa repertorio».
- El plan condicional NO implica que recomiendes esas horas. Si crees que 4 h es mejor, dilo primero y luego ofrece igualmente las alternativas de 5 h y 6 h para que el usuario pueda decidir.
- Mantén el filtro musical existente: solo repertorio con evento/proyecto futuro enlazado. No introduzcas una obra sin evento solo para rellenar horas.
- Si al ampliar no merece la pena incorporar otra obra, usa el tiempo adicional en los movimientos enlazados con mayor valor marginal: segundo bloque, trabajo de puntos concretos, pase, memoria, recuperación, resistencia, tempo o consolidación, según los datos.
- Si de verdad no existe trabajo musical útil para completar 5 h o 6 h, dilo explícitamente, pero aun así ofrece la opción menos mala y concreta dentro del repertorio enlazado en vez de omitir la alternativa.
- Si el usuario ya ha superado uno de esos totales hoy, no inventes tiempo negativo: marca ese escalón como ya superado y adapta el siguiente bloque útil desde la hora actual.`;

  function ensurePolicy(prompt){
    const value = String(prompt || '').trim();
    if (value.includes(MARKER)) return value;
    return `${value}${value ? '\n\n' : ''}${RULES}`;
  }

  function install(){
    const professor = root && root.ProfessorCore;
    if (!professor || professor.__professorDurationPolicyInstalled) return false;

    professor.DEFAULT_MASTER_PROMPT = ensurePolicy(professor.DEFAULT_MASTER_PROMPT);

    if (typeof professor.buildPrompt === 'function') {
      const originalBuildPrompt = professor.buildPrompt;
      professor.buildPrompt = function(report, options){
        const opts = Object.assign({}, options || {});
        opts.masterPrompt = ensurePolicy(opts.masterPrompt || professor.DEFAULT_MASTER_PROMPT);
        return originalBuildPrompt.call(this, report, opts);
      };
      professor.buildPrompt.__professorDurationPolicy = true;
    }

    if (typeof professor.buildChatGptUrl === 'function') {
      const originalBuildChatGptUrl = professor.buildChatGptUrl;
      professor.buildChatGptUrl = function(report, options){
        const opts = Object.assign({}, options || {});
        opts.masterPrompt = ensurePolicy(opts.masterPrompt || professor.DEFAULT_MASTER_PROMPT);
        return originalBuildChatGptUrl.call(this, report, opts);
      };
      professor.buildChatGptUrl.__professorDurationPolicy = true;
    }

    professor.__professorDurationPolicyInstalled = true;
    return true;
  }

  root.ProfessorDurationPolicy = { MARKER, RULES, ensurePolicy, install };
  install();
})(typeof window !== 'undefined' ? window : globalThis);
