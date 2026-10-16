import { test, expect } from '@playwright/test';

// Un paso de ventana (cerrar → abrir) o dos sonidos grandes seguidos suenan una
// sola vez; separados en el tiempo, cada uno suena (v506).
test('consecutive window sounds play once, separated ones each play', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(() => localStorage.setItem('alberto_piano_v2', JSON.stringify({ obras: [{ id: 'o1', name: 'Obra', tipo: 'obra', movimientos: [] }], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [] })));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const played = await page.evaluate(async () => {
    const out = [];
    const pack = SFX_PACKS[_activeSoundPack] || SFX_PACKS.piano;
    ['open', 'close', 'milestone', 'tick'].forEach(k => { if (typeof pack[k] === 'function') { const f = pack[k]; pack[k] = (...a) => { out.push(k); return f(...a); }; } else pack[k] = () => out.push(k); });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(600);
    SFX.close(); SFX.open();                 // cerrar → abrir: uno
    await wait(600);
    SFX.milestone(); SFX.open();             // dos grandes a la vez: uno
    await wait(600);
    SFX.open(); await wait(500); SFX.open(); // separados: dos
    await wait(600);
    SFX.tick(); await wait(120); SFX.tick(); // ticks: cada uno
    return out;
  });
  expect(played).toEqual(['close', 'milestone', 'open', 'open', 'tick', 'tick']);
});

// En iPad no hay motor háptico: el truco del interruptor de iOS solo hacía
// clics audibles (dos con «éxito», oídos como un doble sonido al guardar).
test.describe('iPad', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  test('haptics never tap the hidden iOS switch on iPad', async ({ page }) => {
    await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
    await page.addInitScript(() => {
      localStorage.setItem('alberto_piano_v2', JSON.stringify({ obras: [], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [] }));
      Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const switches = await page.evaluate(() => { Haptics.success(); Haptics.light(); return document.querySelectorAll('input[switch]').length; });
    expect(switches).toBe(0);
  });
});
