/* Profesor -> ChatGPT: abre por defecto como Chat temporal para no llenar el historial.
   `temporary-chat=true` es un parámetro del frontend de chatgpt.com, no una API
   pública estable; si deja de reconocerse, el handoff normal sigue funcionando. */
(function professorTemporaryChat() {
  'use strict';

  const STORAGE_KEY = 'professorTemporaryChat_v1';
  let patchedCore = false;
  let observer = null;
  let timer = null;

  function enabled() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored == null ? true : stored !== 'false';
    } catch (error) {
      return true;
    }
  }

  function setEnabled(value) {
    try { localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false'); } catch (error) {}
    syncToggle();
  }

  function withTemporaryChat(url) {
    const raw = String(url || '');
    if (!enabled() || !/^https:\/\/chatgpt\.com\//i.test(raw)) return raw;
    if (/[?&]temporary-chat=/.test(raw)) return raw.replace(/([?&]temporary-chat=)[^&]*/i, '$1true');
    return raw + (raw.includes('?') ? '&' : '?') + 'temporary-chat=true';
  }

  function patchCore() {
    const core = window.ProfessorCore;
    if (!core || typeof core.buildChatGptUrl !== 'function') return false;
    if (core.buildChatGptUrl.__temporaryChatWrapped) {
      patchedCore = true;
      return true;
    }
    const original = core.buildChatGptUrl;
    const wrapped = function buildTemporaryProfessorChat() {
      const built = original.apply(this, arguments);
      if (!built || typeof built !== 'object') return built;
      return { ...built, url: withTemporaryChat(built.url) };
    };
    wrapped.__temporaryChatWrapped = true;
    wrapped.__original = original;
    core.buildChatGptUrl = wrapped;
    patchedCore = true;
    return true;
  }

  function syncToggle() {
    const button = document.getElementById('professorTemporaryChatToggle');
    if (!button) return;
    const on = enabled();
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('is-active', on);
    const state = button.querySelector('[data-temp-state]');
    const text = on ? 'Activado' : 'Desactivado';
    if (state && state.textContent !== text) state.textContent = text;
  }

  function injectStyles() {
    if (document.getElementById('professorTemporaryChatStyles')) return;
    const style = document.createElement('style');
    style.id = 'professorTemporaryChatStyles';
    style.textContent = `
      .prof-temp-chat-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding:9px 11px;border:1px solid var(--border);border-radius:12px;background:color-mix(in srgb,var(--bg3) 66%,transparent)}
      .prof-temp-chat-copy{min-width:0;display:grid;gap:2px}.prof-temp-chat-copy strong{font-size:10px;color:var(--text2)}.prof-temp-chat-copy span{font-size:8px;line-height:1.3;color:var(--text3)}
      .prof-temp-chat-toggle{flex:0 0 auto;display:flex;align-items:center;gap:7px;min-height:32px;padding:0 9px;border:1px solid var(--border);border-radius:999px;background:var(--bg);color:var(--text3);font:650 8px/1 var(--font-ui);cursor:pointer}
      .prof-temp-chat-toggle::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--text3);opacity:.38}
      .prof-temp-chat-toggle.is-active{border-color:color-mix(in srgb,var(--accent) 35%,var(--border));color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,var(--bg))}.prof-temp-chat-toggle.is-active::before{background:var(--accent);opacity:1;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 10%,transparent)}
      @media(max-width:560px){.prof-temp-chat-row{align-items:flex-start;flex-direction:column}.prof-temp-chat-toggle{align-self:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function injectControl() {
    const host = document.getElementById('view-profesor');
    if (!host || document.getElementById('professorTemporaryChatToggle')) return false;
    const actions = host.querySelector('.prof-actions');
    if (!actions) return false;

    const row = document.createElement('div');
    row.className = 'prof-temp-chat-row';
    row.innerHTML = `
      <div class="prof-temp-chat-copy">
        <strong>Abrir como Chat temporal</strong>
        <span>No aparece en el historial de ChatGPT salvo que después decidas guardarlo.</span>
      </div>
      <button type="button" class="prof-temp-chat-toggle" id="professorTemporaryChatToggle" aria-pressed="true">
        <span data-temp-state>Activado</span>
      </button>`;
    actions.insertAdjacentElement('afterend', row);
    row.querySelector('button').addEventListener('click', () => setEnabled(!enabled()));
    syncToggle();
    return true;
  }

  function observeProfessor() {
    const host = document.getElementById('view-profesor');
    if (!host) return false;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      injectControl();
      syncToggle();
    });
    observer.observe(host, { childList: true, subtree: true });
    return true;
  }

  function boot() {
    injectStyles();
    let attempts = 0;
    clearInterval(timer);
    const settle = () => {
      attempts += 1;
      patchCore();
      injectControl();
      const observed = observeProfessor();
      if ((patchedCore && observed) || attempts > 60) clearInterval(timer);
    };
    settle();
    timer = setInterval(settle, 200);
  }

  window.ProfessorTemporaryChat = {
    enabled,
    setEnabled,
    withTemporaryChat,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}());
