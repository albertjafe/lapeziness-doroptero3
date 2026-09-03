/* Seguimiento directo de las píldoras líquidas: el líquido debe quedarse exactamente
 * donde termina el dedo, también en Safari/iPadOS al liberar el range nativo. */
(function paseLiquidDirectTouch() {
  'use strict';

  const activePointers = new Map();

  function installImmediateMotionStyle() {
    if (document.getElementById('paseLiquidImmediateMotionStyle')) return;
    const style = document.createElement('style');
    style.id = 'paseLiquidImmediateMotionStyle';
    style.textContent = `
      .pase-liquid-meter,
      .pase-liquid-meter .pase-liquid-input {
        touch-action: none !important;
        -webkit-user-select: none;
        user-select: none;
      }
      .pase-liquid-fill {
        transition: background .08s ease, box-shadow .08s ease, opacity .08s ease !important;
      }
      .pase-liquid-orb {
        transition: background .08s ease, box-shadow .08s ease !important;
      }
      .pase-liquid-meter.is-direct-touching .pase-liquid-fill,
      .pase-liquid-meter.is-direct-touching .pase-liquid-orb {
        transition: none !important;
      }
    `;
    document.head.appendChild(style);
  }

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

  function applyValue(found, value, dispatchInput = true) {
    if (!found) return;
    if (String(found.input.value) !== String(value)) found.input.value = String(value);
    if (dispatchInput) found.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function updateFromPointer(meter, event) {
    const found = parts(meter);
    if (!found) return null;
    const rect = found.reservoir.getBoundingClientRect();
    if (!rect.width) return null;
    const min = Number(found.input.min);
    const max = Number(found.input.max);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : 100;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const value = stepValue(found.input, lo + ratio * (hi - lo));
    applyValue(found, value, true);
    return value;
  }

  document.addEventListener('pointerdown', event => {
    if (event.button != null && event.button !== 0) return;
    const target = event.target && event.target.closest ? event.target.closest('.pase-liquid-meter') : null;
    const found = target && parts(target);
    if (!target || !found) return;
    const value = updateFromPointer(target, event);
    activePointers.set(event.pointerId, { meter: target, lastValue: value == null ? found.input.value : value });
    target.classList.add('is-direct-touching');
    try { target.setPointerCapture(event.pointerId); } catch (error) {}
    event.preventDefault();
  }, { capture: true, passive: false });

  document.addEventListener('pointermove', event => {
    const active = activePointers.get(event.pointerId);
    if (!active) return;
    const value = updateFromPointer(active.meter, event);
    if (value != null) active.lastValue = value;
    event.preventDefault();
  }, { capture: true, passive: false });

  function finish(event) {
    const active = activePointers.get(event.pointerId);
    if (!active) return;

    // pointerup puede llegar unos píxeles después del último pointermove en iPad.
    // Lo leemos una vez más: el valor comprometido es literalmente donde sale el dedo.
    if (event.type === 'pointerup') {
      const finalValue = updateFromPointer(active.meter, event);
      if (finalValue != null) active.lastValue = finalValue;
    }

    const found = parts(active.meter);
    const committed = active.lastValue;
    activePointers.delete(event.pointerId);
    active.meter.classList.remove('is-direct-touching');
    try { active.meter.releasePointerCapture(event.pointerId); } catch (error) {}

    if (found && committed != null) {
      applyValue(found, committed, false);
      found.input.dispatchEvent(new Event('change', { bubbles: true }));

      // Safari a veces reconcilia un último evento nativo tras pointerup y recupera
      // el valor previo. Reafirmamos el valor final después de ese turno nativo.
      const lockFinalValue = () => {
        if (!found.input.isConnected || String(found.input.value) === String(committed)) return;
        found.input.value = String(committed);
        found.input.dispatchEvent(new Event('input', { bubbles: true }));
        found.input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(lockFinalValue);
      setTimeout(lockFinalValue, 0);
      setTimeout(lockFinalValue, 40);
    }
  }

  document.addEventListener('pointerup', finish, { capture: true, passive: false });
  document.addEventListener('pointercancel', finish, { capture: true, passive: false });
  installImmediateMotionStyle();
})();
