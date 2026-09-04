/* Seguimiento directo premium de las píldoras líquidas.
 * La posición comprometida es el último punto estable de pointermove: nunca se
 * vuelve a calcular en pointerup, porque Safari/iPadOS puede entregar ahí una
 * coordenada reconciliada que hace saltar el range hacia atrás.
 */
(function paseLiquidDirectTouch() {
  'use strict';

  const activePointers = new Map();
  const commitEpoch = new WeakMap();

  function installImmediateMotionStyle() {
    if (document.getElementById('paseLiquidImmediateMotionStyle')) return;
    const style = document.createElement('style');
    style.id = 'paseLiquidImmediateMotionStyle';
    style.textContent = `
      .pase-liquid-meter {
        touch-action: none !important;
        -webkit-user-select: none;
        user-select: none;
        cursor: ew-resize;
      }
      .pase-liquid-meter .pase-liquid-input {
        touch-action: none !important;
        pointer-events: none !important;
        -webkit-user-select: none;
        user-select: none;
      }
      .pase-liquid-fill,
      .pase-liquid-orb {
        will-change: width, left, transform;
      }
      .pase-liquid-fill {
        transition: width .09s cubic-bezier(.2,.8,.2,1), background .09s ease, box-shadow .09s ease, opacity .09s ease !important;
      }
      .pase-liquid-orb {
        transition: left .09s cubic-bezier(.2,.8,.2,1), transform .09s cubic-bezier(.2,.8,.2,1), background .09s ease, box-shadow .09s ease !important;
      }
      .pase-liquid-meter.is-direct-touching .pase-liquid-fill,
      .pase-liquid-meter.is-direct-touching .pase-liquid-orb {
        transition: none !important;
      }
      .pase-liquid-meter.is-direct-touching .pase-liquid-orb {
        transform: scale(1.04);
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

  function setValue(found, value) {
    if (!found || value == null) return;
    if (String(found.input.value) !== String(value)) found.input.value = String(value);
  }

  function dispatchInput(found) {
    if (found && found.input.isConnected) found.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function scheduleLiveInput(active) {
    if (!active || active.inputFrame) return;
    active.inputFrame = requestAnimationFrame(() => {
      active.inputFrame = 0;
      if (!active.finished) { dispatchInput(active.found); active.lastValue = active.found.input.value; }
    });
  }

  function flushLiveInput(active) {
    if (!active) return;
    if (active.inputFrame) {
      cancelAnimationFrame(active.inputFrame);
      active.inputFrame = 0;
    }
    dispatchInput(active.found);
  }

  function valueFromPointer(found, event) {
    if (!found) return null;
    const rect = found.reservoir.getBoundingClientRect();
    if (!rect.width || !Number.isFinite(event.clientX)) return null;
    const min = Number(found.input.min);
    const max = Number(found.input.max);
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : 100;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return stepValue(found.input, lo + ratio * (hi - lo));
  }

  function updateActive(active, event) {
    const value = valueFromPointer(active && active.found, event);
    if (value == null) return null;
    active.lastValue = value;
    setValue(active.found, value);
    scheduleLiveInput(active);
    return value;
  }

  document.addEventListener('pointerdown', event => {
    if (event.button != null && event.button !== 0) return;
    const meter = event.target && event.target.closest ? event.target.closest('.pase-liquid-meter') : null;
    const found = meter && parts(meter);
    if (!meter || !found) return;
    commitEpoch.set(found.input, (commitEpoch.get(found.input) || 0) + 1);

    const active = {
      meter,
      found,
      lastValue: found.input.value,
      inputFrame: 0,
      finished: false,
    };
    activePointers.set(event.pointerId, active);
    meter.classList.add('is-direct-touching');
    updateActive(active, event);
    try { meter.setPointerCapture(event.pointerId); } catch (error) {}
    event.preventDefault();
  }, { capture: true, passive: false });

  document.addEventListener('pointermove', event => {
    const active = activePointers.get(event.pointerId);
    if (!active) return;
    updateActive(active, event);
    event.preventDefault();
  }, { capture: true, passive: false });

  function lockCommittedValue(found, committed, epoch) {
    if (!found || !found.input) return;
    const lock = () => {
      if (!found.input.isConnected || commitEpoch.get(found.input) !== epoch) return;
      if (String(found.input.value) === String(committed)) return;
      found.input.value = String(committed);
      // Reconciliación visual únicamente: `change` ya se emitió exactamente una vez.
      dispatchInput(found);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(lock);
    setTimeout(lock, 0);
    setTimeout(lock, 60);
    setTimeout(lock, 160);
  }

  function finish(event) {
    const active = activePointers.get(event.pointerId);
    if (!active) return;

    // IMPORTANTE: no usamos event.clientX de pointerup. En iPadOS puede saltar a
    // una coordenada antigua/capturada y devolver la píldora hacia atrás.
    const found = active.found;
    let committed = active.lastValue;
    active.finished = true;
    activePointers.delete(event.pointerId);
    active.meter.classList.remove('is-direct-touching');
    try { active.meter.releasePointerCapture(event.pointerId); } catch (error) {}

    if (found && committed != null) {
      setValue(found, committed);
      // Se fuerza una última actualización visual con el valor estable y después
      // se compromete una sola vez.
      flushLiveInput({ ...active, finished:false });
      committed = found.input.value; // Keep the UI's normalized nonlinear position.
      found.input.dispatchEvent(new Event('change', { bubbles: true }));
      const epoch = (commitEpoch.get(found.input) || 0) + 1;
      commitEpoch.set(found.input, epoch);
      lockCommittedValue(found, committed, epoch);
    }
    event.preventDefault();
  }

  document.addEventListener('pointerup', finish, { capture: true, passive: false });
  document.addEventListener('pointercancel', finish, { capture: true, passive: false });
  installImmediateMotionStyle();
})();
