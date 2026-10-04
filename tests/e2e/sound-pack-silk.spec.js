import { test, expect } from '@playwright/test';

// Paquete «Seda»: cada sonido se renderiza sin altavoz (OfflineAudioContext)
// para comprobar que suena, no satura y queda en el nivel de los demás paquetes.
const METHODS = ['tick', 'nav', 'toggle', 'slider', 'open', 'close', 'add', 'del', 'skip', 'save',
  'saveSession', 'startSession', 'generate', 'pase', 'pasaje', 'milestone', 'memlapse'];

async function render(page, pack, method) {
  return page.evaluate(async ([packName, name]) => {
    const rate = 44100;
    const off = new OfflineAudioContext(1, rate * 2, rate);
    // getAC() es global: el motor programa contra este contexto como si sonara.
    const realGetAC = window.getAC;
    const fake = new Proxy(off, {
      get(target, prop) {
        if (prop === 'state') return 'running';
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    window.getAC = () => fake;
    // La limpieza real desconecta los nodos con un temporizador de reloj; con
    // la máquina cargada llegaría antes de renderizar y daría silencio.
    const realCleanup = window._scheduleCleanup;
    window._scheduleCleanup = () => {};
    try {
      SFX_PACKS[packName][name]();
    } finally {
      window.getAC = realGetAC;
      window._scheduleCleanup = realCleanup;
    }
    const buf = await off.startRendering();
    const data = buf.getChannelData(0);
    let peak = 0, sum = 0, last = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      sum += data[i] * data[i];
      if (v > 0.001) last = i;
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, last)), seconds: last / rate };
  }, [pack, method]);
}

test('Seda: todos los sonidos suenan, sin saturar y al nivel de Piano', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.goto('/');
  await page.waitForFunction(() => typeof SFX_PACKS !== 'undefined' && SFX_PACKS.silk);
  await page.evaluate(() => setSoundVolume(100));
  const piano = await render(page, 'piano', 'tick');
  for (const method of METHODS) {
    const r = await render(page, 'silk', method);
    expect(r.peak, `${method} suena`).toBeGreaterThan(0.005);
    expect(r.peak, `${method} no satura`).toBeLessThan(0.6);
    expect(r.seconds, `${method} termina`).toBeLessThan(1.6);
  }
  const tick = await render(page, 'silk', 'tick');
  expect(tick.peak).toBeGreaterThan(piano.peak * 0.3);
  expect(tick.peak).toBeLessThan(piano.peak * 2.5);

  // Se elige en Ajustes y se recuerda.
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} openSettings(); });
  await page.locator('.sound-option[data-sound="silk"]').click();
  await expect(page.locator('.sound-option[data-sound="silk"]')).toHaveClass(/active/);
  expect(await page.evaluate(() => localStorage.getItem('alberto_sound_pack'))).toBe('silk');
  expect(errors).toEqual([]);
});
