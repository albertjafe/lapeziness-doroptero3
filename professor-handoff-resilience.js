(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorHandoffResilience = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const MAX_URL_ENCODED = 7000;
  const URL_RULES = [
    'Actúa como profesor de planificación pianística.',
    'Decide movimiento por movimiento; no repartas horas históricas entre movimientos.',
    'Distingue solidez medida, antigüedad y confianza.',
    'Prioriza riesgo, urgencia y coste restante sin enfriar otra unidad crítica.',
    'Usa lo ya estudiado hoy y solo trata un evento como prioridad musical si tiene repertorio enlazado.',
    'Da una respuesta compacta, concreta y accionable.',
  ].join('\n');

  let installed = false;
  let installTimer = null;

  function modeInstruction(mode) {
    if (mode === 'remaining') return 'Organiza únicamente lo que queda de HOY desde ahora; no reinicies el día.';
    if (mode === 'now') return 'Dime qué debería estudiar AHORA MISMO: decisión principal, duración y plan B corto.';
    if (mode === 'week') return 'Haz balance de los próximos 7 días y distribuye el estudio estratégicamente por movimientos.';
    return 'Organiza el día de hoy de forma realista, movimiento por movimiento.';
  }

  function compactReport(report, unitLimit, eventLimit) {
    const src = report || {};
    return Object.assign({}, src, {
      units: Array.isArray(src.units) ? src.units.slice(0, unitLimit) : [],
      events: Array.isArray(src.events) ? src.events.slice(0, eventLimit) : [],
      priorities: Array.isArray(src.priorities) ? src.priorities.slice(0, unitLimit) : [],
    });
  }

  function buildShortPrompt(report, options, core, unitLimit, eventLimit) {
    const opts = options || {};
    const compact = compactReport(report, unitLimit == null ? 12 : unitLimit, eventLimit == null ? 12 : eventLimit);
    const context = core && typeof core.compactContext === 'function'
      ? core.compactContext(compact, unitLimit == null ? 12 : unitLimit)
      : JSON.stringify(compact);
    const note = String(opts.note || '').trim();
    return `${URL_RULES}\n\nTAREA\n${modeInstruction(opts.mode || 'today')}${note ? `\nCondición del usuario: ${note}` : ''}\n\n${context}`;
  }

  function fitUrlPrompt(report, options, core, maxEncoded) {
    const limit = Math.max(1800, Number(maxEncoded) || MAX_URL_ENCODED);
    const passes = [[12, 12], [9, 9], [6, 7], [4, 5]];
    let prompt = '';
    let encoded = '';
    for (const [units, events] of passes) {
      prompt = buildShortPrompt(report, options, core, units, events);
      encoded = encodeURIComponent(prompt);
      if (encoded.length <= limit) return { prompt, encoded, truncated: units < 12 || events < 12 };
    }
    const safeChars = Math.max(1200, Math.floor(limit * 0.54));
    prompt = prompt.slice(0, safeChars) + '\n[contexto URL abreviado; el prompt completo se ha copiado al portapapeles]';
    encoded = encodeURIComponent(prompt);
    while (encoded.length > limit && prompt.length > 800) {
      prompt = prompt.slice(0, Math.floor(prompt.length * 0.86));
      encoded = encodeURIComponent(prompt);
    }
    return { prompt, encoded, truncated: true };
  }

  function withTemporaryChat(url) {
    try {
      if (root && root.ProfessorTemporaryChat && typeof root.ProfessorTemporaryChat.withTemporaryChat === 'function') {
        return root.ProfessorTemporaryChat.withTemporaryChat(url);
      }
    } catch (error) {}
    return url;
  }

  function buildSafeChatGptUrl(report, options, core) {
    const api = core || (root && root.ProfessorCore);
    if (!api) return null;
    const opts = options || {};
    const fullPrompt = typeof api.buildPrompt === 'function'
      ? api.buildPrompt(report, opts)
      : buildShortPrompt(report, opts, api, 12, 12);
    const fitted = fitUrlPrompt(report, opts, api, MAX_URL_ENCODED);
    const url = withTemporaryChat(`https://chatgpt.com/?prompt=${fitted.encoded}`);
    return {
      url,
      fullPrompt,
      promptForUrl: fitted.prompt,
      truncated: fitted.truncated || fitted.prompt !== fullPrompt,
      encodedLength: fitted.encoded.length,
    };
  }

  function database() {
    try { return typeof db !== 'undefined' ? db : (root && root.db || null); } catch (error) { return root && root.db || null; }
  }

  function optionsFor(mode) {
    const data = database() || {};
    const settings = data.professorSettings && typeof data.professorSettings === 'object' ? data.professorSettings : {};
    const note = root && root.document && root.document.getElementById('professorUserNote')?.value || '';
    const masterPrompt = String(settings.masterPrompt || root?.ProfessorCore?.DEFAULT_MASTER_PROMPT || '');
    return { mode: mode || 'today', note, masterPrompt };
  }

  async function copyText(text) {
    try {
      if (root && root.navigator && root.navigator.clipboard) {
        await root.navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {}
    try {
      const area = root.document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      root.document.body.appendChild(area);
      area.select();
      const ok = root.document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) { return false; }
  }

  function toast(message) {
    try { if (root && typeof root.showToast === 'function') root.showToast(message); } catch (error) {}
  }

  function navigatePopup(popup, url) {
    if (!popup) return false;
    try {
      popup.location.replace(url);
      return true;
    } catch (error) {
      try { popup.location.href = url; return true; } catch (secondError) { return false; }
    }
  }

  function openSafe(mode) {
    if (!root || !root.ProfessorCore) return;

    let popup = null;
    try {
      popup = root.open('about:blank', '_blank');
      if (popup) popup.opener = null;
    } catch (error) {}

    toast('Preparando Profesor…');
    root.setTimeout(async () => {
      try {
        const data = database() || {};
        const report = root.ProfessorCore.buildReport(data, { asOf: new Date() });
        const opts = optionsFor(mode);
        const built = buildSafeChatGptUrl(report, opts, root.ProfessorCore);
        if (!built) throw new Error('ProfessorCore unavailable');

        copyText(built.fullPrompt);
        if (popup && navigatePopup(popup, built.url)) {
          toast(built.truncated
            ? 'ChatGPT abierto · contexto completo copiado también'
            : 'ChatGPT abierto con el contexto del Profesor');
          return;
        }

        toast('El navegador bloqueó la nueva pestaña · superinforme copiado');
      } catch (error) {
        try { if (popup && !popup.closed) popup.close(); } catch (closeError) {}
        toast('No se pudo abrir el Profesor · vuelve a intentarlo');
        console.error('[professor-handoff] fallo al preparar ChatGPT', error);
      }
    }, 0);
  }

  function patchCore() {
    const core = root && root.ProfessorCore;
    if (!core || typeof core.buildReport !== 'function') return false;
    if (!core.buildChatGptUrl || !core.buildChatGptUrl.__responsiveProfessorHandoff) {
      const safe = function responsiveBuildChatGptUrl(report, options) {
        return buildSafeChatGptUrl(report, options, core);
      };
      safe.__responsiveProfessorHandoff = true;
      core.buildChatGptUrl = safe;
    }
    root.openProfessorInChatGPT = openSafe;
    return true;
  }

  function installCapture() {
    if (!root || !root.document || root.document.__responsiveProfessorHandoff) return true;
    root.document.addEventListener('click', event => {
      const button = event.target && event.target.closest && event.target.closest('[data-prof-mode]');
      if (!button || !button.closest('#view-profesor')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openSafe(button.dataset.profMode);
    }, true);
    root.document.__responsiveProfessorHandoff = true;
    return true;
  }

  function install() {
    if (!root || !root.document) return false;
    const coreReady = patchCore();
    installCapture();
    installed = installed || coreReady;
    return coreReady;
  }

  function boot() {
    install();
    let attempts = 0;
    clearInterval(installTimer);
    installTimer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 80) clearInterval(installTimer);
    }, 150);
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  return {
    MAX_URL_ENCODED,
    buildShortPrompt,
    fitUrlPrompt,
    buildSafeChatGptUrl,
    openSafe,
    install,
    isInstalled: () => installed,
  };
});
