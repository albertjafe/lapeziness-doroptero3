/* Desplegables de obras con buscador. Los <select> de obras (registro manual,
   registro rápido de Hoy, editar sesión, añadir sesión, registro directo) en
   el iPad abrían la lista nativa: sin búsqueda y en orden alfabético fijo.
   Ahora un botón ocupa su sitio y abre el selector del cronómetro (buscador,
   filtro por evento y últimas usadas primero). El <select> sigue existiendo,
   oculto, y recibe el valor y su «change»: la lógica de guardado no cambia. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  const IDS = ['studyRegisterObra', 'sessionQuickStudyObra', 'editObraSelect', 'extraObraSelect', 'rdObraSelect'];

  function buttonFor(select) {
    return doc.querySelector('.obra-pick-btn[data-for="' + select.id + '"]');
  }

  function labelFor(select) {
    const value = select.value;
    const placeholder = (select.options[0] && !select.options[0].value && select.options[0].textContent.trim()) || 'Elige obra';
    if (!value) return { text: /selecciona/i.test(placeholder) ? 'Elige obra o movimiento' : placeholder, empty: true };
    if (value.indexOf('mov::') === 0 && typeof root.findObra === 'function') {
      const parts = value.split('::');
      const obra = root.findObra(parts[1]);
      const mov = obra && (obra.movimientos || []).find(m => m.id === parts[2]);
      if (obra && mov) return { text: obra.name + ' · ' + mov.name, empty: false };
    }
    const option = select.selectedOptions && select.selectedOptions[0];
    return { text: option ? option.textContent.trim() : value, empty: false };
  }

  function refresh(select) {
    const btn = select && buttonFor(select);
    if (!btn) return;
    const label = labelFor(select);
    const span = btn.querySelector('.obra-pick-label');
    if (span) span.textContent = label.text;
    btn.classList.toggle('is-empty', label.empty);
    btn.disabled = select.disabled;
  }

  function enhance(select) {
    if (!select || select.dataset.obraPicker) return;
    select.dataset.obraPicker = '1';
    select.classList.add('obra-pick-native');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'obra-pick-btn' + (select.classList.contains('modal-input') ? ' modal-input' : '');
    btn.dataset.for = select.id;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-label', (select.getAttribute('aria-label') || 'Obra o movimiento') + ': elegir con buscador');
    if (select.style.marginBottom) btn.style.marginBottom = select.style.marginBottom;
    btn.innerHTML = '<svg class="obra-pick-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>' +
      '<span class="obra-pick-label"></span><span class="obra-pick-chev" aria-hidden="true">›</span>';
    // Delante del <select>: otros módulos insertan cosas justo detrás de él.
    select.insertAdjacentElement('beforebegin', btn);
    btn.addEventListener('click', () => {
      if (typeof root.openCronoObraPicker === 'function') root.openCronoObraPicker('select', select.id);
    });
    select.addEventListener('change', () => refresh(select));
    refresh(select);
  }

  function enhanceAll() {
    IDS.forEach(id => enhance(doc.getElementById(id)));
  }

  // Tras rellenar un desplegable, el llamador suele fijar su valor en el mismo
  // paso: se repinta la etiqueta al terminar ese código (microtarea).
  function hook() {
    const original = root.buildObraSelectOptions;
    if (typeof original !== 'function' || original.__obraPicker) return !!original;
    const wrapped = function (selectId) {
      const result = original.apply(this, arguments);
      const select = doc.getElementById(selectId);
      if (select && IDS.includes(selectId)) {
        enhance(select);
        queueMicrotask(() => refresh(select));
      }
      return result;
    };
    wrapped.__obraPicker = true;
    root.buildObraSelectOptions = wrapped;
    const openModal = root.openModal;
    if (typeof openModal === 'function' && !openModal.__obraPicker) {
      const openWrapped = function (id) {
        const result = openModal.apply(this, arguments);
        const overlay = doc.getElementById(id);
        if (overlay) queueMicrotask(() => overlay.querySelectorAll('select[data-obra-picker]').forEach(refresh));
        return result;
      };
      openWrapped.__obraPicker = true;
      root.openModal = openWrapped;
    }
    return true;
  }

  enhanceAll();
  if (!hook()) doc.addEventListener('DOMContentLoaded', hook, { once: true });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', enhanceAll, { once: true });

  root.ObraSelectPicker = { enhance, refresh, labelFor, IDS };
})(typeof window !== 'undefined' ? window : globalThis);
