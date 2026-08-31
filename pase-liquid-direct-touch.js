/* Seguimiento directo de las píldoras líquidas: el líquido debe estar debajo del dedo,
 * sin depender de que Safari acierte primero con el thumb invisible del range. */
(function paseLiquidDirectTouch() {
  'use strict';

  const activePointers = new Map();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function stepValue(input, raw) {
    const min = Number(input.min);
    const max = Number(input.max);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : 100;
    const step = Number(input.step);
    let value = clamp(raw, lo, hi);
    if (Number.isFinite(step) && step > 0) {
      value = lo + Math.round((value - lo) / step) * step;
      value = clamp(value, lo, hi);
      const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
      value = Number(value.toFixed(Math.min(6, decimals)));
    }
    return value;
  }

  function parts(meter) {
    if (!meter) return null;
    const input = meter.querySelector('.pase-liquid-input');
    const reservoir = meter.querySelector('.pase-liquid-reservoir') || meter;
    if (!input || input.disabled) return null;
    return { input, reservoir };
  }

  function updateFromPointer(meter, event) {
    const found = parts(meter);
    if (!found) return;
    const rect = found.reservoir.getBoundingClientRect();
    if (!rect.width) return;
    const min = Number(found.input.min);
    const max = Number(found.input.max);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : 100;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const value = stepValue(found.input, lo + ratio * (hi - lo));
    if (String(found.input.value) !== String(value)) found.input.value = String(value);
    found.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  document.addEventListener('pointerdown', event => {
    if (event.button != null && event.button !== 0) return;
    const target = event.target && event.target.closest ? event.target.closest('.pase-liquid-meter') : null;
    if (!target || !parts(target)) return;
    activePointers.set(event.pointerId, target);
    target.classList.add('is-direct-touching');
    try { target.setPointerCapture(event.pointerId); } catch (error) {}
    updateFromPointer(target, event);
    event.preventDefault();
  }, { capture: true, passive: false });

  document.addEventListener('pointermove', event => {
    const meter = activePointers.get(event.pointerId);
    if (!meter) return;
    updateFromPointer(meter, event);
    event.preventDefault();
  }, { capture: true, passive: false });

  function finish(event) {
    const meter = activePointers.get(event.pointerId);
    if (!meter) return;
    activePointers.delete(event.pointerId);
    meter.classList.remove('is-direct-touching');
    const found = parts(meter);
    if (found) found.input.dispatchEvent(new Event('change', { bubbles: true }));
    try { meter.releasePointerCapture(event.pointerId); } catch (error) {}
  }

  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);
})();
