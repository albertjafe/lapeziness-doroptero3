/* Selector de repertorio para el modal de eventos.
   Escala a bibliotecas grandes sin tocar el modelo de datos existente. */
(function eventRepertoirePicker() {
  'use strict';

  const LIST_ID = 'obraCheckList';
  const TOOLBAR_ID = 'eventRepertoirePickerTools';
  let listObserver = null;
  let bootTimer = null;

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-ES')
      .trim();
  }

  function list() {
    return document.getElementById(LIST_ID);
  }

  function rows() {
    const host = list();
    return host ? Array.from(host.querySelectorAll('.obra-check-item')) : [];
  }

  function selectedCount() {
    const host = list();
    return host ? host.querySelectorAll('input[type="checkbox"]:checked').length : 0;
  }

  function toolbar() {
    return document.getElementById(TOOLBAR_ID);
  }

  function searchInput() {
    return document.getElementById('eventRepertoireSearch');
  }

  function selectedOnlyButton() {
    return document.getElementById('eventRepertoireSelectedOnly');
  }

  function emptyState() {
    return document.getElementById('eventRepertoireEmpty');
  }

  function isSelectedOnly() {
    return selectedOnlyButton()?.getAttribute('aria-pressed') === 'true';
  }

  function rowSearchText(row) {
    if (!row) return '';
    if (!row.dataset.eventSearchText) {
      row.dataset.eventSearchText = normalize(row.textContent);
    }
    return row.dataset.eventSearchText;
  }

  function updateCount(visible) {
    const count = document.getElementById('eventRepertoireCount');
    if (!count) return;
    const total = rows().length;
    const selected = selectedCount();
    count.textContent = selected
      ? `${selected} seleccionada${selected === 1 ? '' : 's'} · ${visible}/${total} visibles`
      : `${visible}/${total} visibles`;
  }

  function applyFilter() {
    const query = normalize(searchInput()?.value || '');
    const onlySelected = isSelectedOnly();
    let visible = 0;

    rows().forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      const matchesText = !query || rowSearchText(row).includes(query);
      const matchesSelection = !onlySelected || !!checkbox?.checked;
      const show = matchesText && matchesSelection;
      row.hidden = !show;
      if (show) visible += 1;
    });

    const clear = document.getElementById('eventRepertoireSearchClear');
    if (clear) clear.hidden = !query;
    const empty = emptyState();
    if (empty) empty.hidden = visible !== 0;
    updateCount(visible);
  }

  function clearSearch() {
    const input = searchInput();
    if (!input) return;
    input.value = '';
    applyFilter();
    input.focus();
  }

  function toggleSelectedOnly() {
    const button = selectedOnlyButton();
    if (!button) return;
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    button.classList.toggle('is-active', next);
    applyFilter();
  }

  function buildToolbar(host) {
    if (!host || toolbar()) return toolbar();

    const tools = document.createElement('div');
    tools.id = TOOLBAR_ID;
    tools.className = 'event-repertoire-picker-tools';
    tools.innerHTML = `
      <div class="event-repertoire-picker-head">
        <div>
          <strong>Buscar repertorio</strong>
          <span id="eventRepertoireCount"></span>
        </div>
        <button type="button" id="eventRepertoireSelectedOnly" class="event-repertoire-selected" aria-pressed="false">Seleccionadas</button>
      </div>
      <div class="event-repertoire-search-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4.2 4.2"></path></svg>
        <input id="eventRepertoireSearch" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Buscar por obra o compositor…" aria-label="Buscar obras para asignar al evento">
        <button type="button" id="eventRepertoireSearchClear" class="event-repertoire-search-clear" aria-label="Limpiar búsqueda" hidden>×</button>
      </div>`;

    host.insertAdjacentElement('beforebegin', tools);

    const empty = document.createElement('div');
    empty.id = 'eventRepertoireEmpty';
    empty.className = 'event-repertoire-empty';
    empty.hidden = true;
    empty.innerHTML = '<strong>No hay coincidencias</strong><span>Prueba con el compositor, una palabra del título o quita “Seleccionadas”.</span>';
    host.insertAdjacentElement('afterend', empty);

    tools.querySelector('#eventRepertoireSearch')?.addEventListener('input', applyFilter);
    tools.querySelector('#eventRepertoireSearchClear')?.addEventListener('click', clearSearch);
    tools.querySelector('#eventRepertoireSelectedOnly')?.addEventListener('click', toggleSelectedOnly);

    return tools;
  }

  function resetTransientUi() {
    const input = searchInput();
    if (input) input.value = '';
    const selected = selectedOnlyButton();
    if (selected) {
      selected.setAttribute('aria-pressed', 'false');
      selected.classList.remove('is-active');
    }
  }

  function decorateRows() {
    rows().forEach(row => {
      row.dataset.eventSearchText = normalize(row.textContent);
      const checkbox = row.querySelector('input[type="checkbox"]');
      row.classList.toggle('is-selected', !!checkbox?.checked);
    });
  }

  function enhance(options) {
    const host = list();
    if (!host) return false;
    buildToolbar(host);
    decorateRows();
    if (options?.reset) resetTransientUi();
    applyFilter();
    return true;
  }

  function observeList() {
    const host = list();
    if (!host) return false;
    if (listObserver) listObserver.disconnect();
    listObserver = new MutationObserver(() => {
      decorateRows();
      applyFilter();
    });
    listObserver.observe(host, { childList: true, subtree: true });
    host.addEventListener('change', event => {
      if (!event.target?.matches('input[type="checkbox"]')) return;
      event.target.closest('.obra-check-item')?.classList.toggle('is-selected', event.target.checked);
      applyFilter();
    });
    return true;
  }

  function modalIsOpen() {
    const modal = document.getElementById('modalAddEvento');
    if (!modal) return false;
    const style = getComputedStyle(modal);
    return modal.classList.contains('active') || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function observeModal() {
    const modal = document.getElementById('modalAddEvento');
    if (!modal) return false;
    let wasOpen = modalIsOpen();
    const observer = new MutationObserver(() => {
      const open = modalIsOpen();
      if (open && !wasOpen) {
        enhance({ reset: true });
        requestAnimationFrame(() => searchInput()?.focus({ preventScroll: true }));
      }
      wasOpen = open;
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
    return true;
  }

  function wrapRenderer() {
    const original = window.renderObraCheckList;
    if (typeof original !== 'function' || original.__eventRepertoirePickerWrapped) return false;
    const wrapped = function renderObraCheckListSearchable() {
      const result = original.apply(this, arguments);
      enhance({ reset: false });
      return result;
    };
    wrapped.__eventRepertoirePickerWrapped = true;
    window.renderObraCheckList = wrapped;
    return true;
  }

  function boot() {
    clearInterval(bootTimer);
    let attempts = 0;
    const settle = () => {
      attempts += 1;
      const ready = enhance({ reset: false });
      const renderer = wrapRenderer();
      const observed = observeList();
      const modalObserved = observeModal();
      if ((ready && renderer && observed && modalObserved) || attempts > 50) clearInterval(bootTimer);
    };
    settle();
    bootTimer = setInterval(settle, 200);
  }

  window.EventRepertoirePicker = {
    enhance,
    applyFilter,
    clearSearch,
    getState: () => ({
      query: searchInput()?.value || '',
      selectedOnly: isSelectedOnly(),
      selected: selectedCount(),
      visible: rows().filter(row => !row.hidden).length,
      total: rows().length,
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}());
