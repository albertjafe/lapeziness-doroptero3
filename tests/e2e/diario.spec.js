import { test, expect } from '@playwright/test';

const keyOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dayKey = (offset = 0) => { const d = today(); d.setDate(d.getDate() + offset); return keyOf(d); };
const at = (h, m, offset = 0) => { const d = today(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const plant = (id, obraId, h1, m1, h2, m2, extra = {}) => ({
  id, obraId, movId: extra.movId || null, startedAt: at(h1, m1, extra.offset), endedAt: at(h2, m2, extra.offset),
  mins: (h2 * 60 + m2) - (h1 * 60 + m1), source: 'app', ...extra,
});

async function boot(page, extra = {}) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const data = {
    competitionPlanningSeedVersion: 999, eventos: [], sesiones: [], forestPlants: [], registro: [],
    obras: [
      { id: 'haydn', name: 'Sonata Hob. XVI:52', composer: 'Haydn', movimientos: [{ id: 'h1', name: 'I. Allegro' }] },
      { id: 'chopin', name: 'Balada n.º 4', composer: 'Chopin' },
    ],
    sessionPlants: [
      plant('a', 'haydn', 9, 0, 9, 40, { movId: 'h1', notes: [{ text: 'probar el pedal más corto', phaseLabel: 'min 12' }] }),
      plant('b', 'haydn', 9, 50, 10, 30, { movId: 'h1' }),
      plant('c', 'chopin', 10, 45, 11, 30),
      plant('y', 'chopin', 17, 0, 18, 0, { offset: -1 }),
      plant('w', 'haydn', 11, 0, 12, 0, { offset: -2 }),
    ],
    ...extra,
  };
  await page.addInitScript(d => { if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(d)); }, data);
  await page.goto('/');
  await page.waitForFunction(() => window.Diario && typeof showView === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} });
}

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('alberto_piano_v2') || '{}').dailyJournalEntries || []);

test.describe('una página por día (móvil, iPad, ventana estrecha)', () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test('Diario: pestaña propia; lo estudiado aparece solo y lo escrito se guarda solo, unido a su bloque', async ({ page }) => {
    await boot(page);
    await page.locator('.nav-btn[data-view="diario"]').first().click();
    const view = page.locator('#view-diario');
    await expect(view).toHaveClass(/active/);
    await expect(page.locator('#headerTitle')).toHaveText('Diario');
    await expect(view.locator('.dia-book')).toHaveCount(0);
    const items = view.locator('.dia-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).locator('.dia-time')).toHaveText('09:00–10:30');
    await items.nth(0).locator('.dia-study-details summary').click();
    await expect(items.nth(0).locator('.dia-study-details')).toContainText('09:00–10:30');
    await expect(items.nth(0).locator('.dia-title')).toHaveText('Haydn · Sonata Hob. XVI:52 · I');
    await expect(items.nth(0).locator('.dia-crono')).toContainText('probar el pedal más corto');

    // Tocar el bloque lleva a escribir; sin botón de guardar.
    await items.nth(0).locator('.dia-meta').click();
    await expect(items.nth(0).locator('.dia-ink')).toBeFocused();
    await page.keyboard.type('El desarrollo sigue sucio en la mano izquierda');
    await expect.poll(async () => (await stored(page)).map(e => [e.text, e.ref, e.day])).toEqual([
      ['El desarrollo sigue sucio en la mano izquierda', 'p:a', keyOf(today())],
    ]);
    expect((await stored(page))[0].about).toBe('Haydn · Sonata Hob. XVI:52 · I. Allegro · 09:00–10:30');

    // Una línea libre del día.
    await view.locator('.dia-new .dia-ink').fill('Día tranquilo');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await stored(page)).map(e => e.text).sort()).toEqual(['Día tranquilo', 'El desarrollo sigue sucio en la mano izquierda']);

    // Al volver, todo sigue en su sitio.
    await page.reload();
    await page.waitForFunction(() => window.Diario && typeof showView === 'function');
    await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('diario'); });
    await expect(view.locator('.dia-item').first().locator('.dia-ink')).toHaveValue('El desarrollo sigue sucio en la mano izquierda');
    await expect(view.locator('.dia-free:not(.dia-new) .dia-ink')).toHaveValue('Día tranquilo');

    // Lo escrito se ve con formato; tocarlo abre el campo. Vaciarlo y salir lo quita.
    await expect(view.locator('.dia-item').first().locator('.dia-fmt')).toHaveText('El desarrollo sigue sucio en la mano izquierda');
    await view.locator('.dia-item').first().locator('.dia-fmt').click();
    const ink = view.locator('.dia-item').first().locator('.dia-ink');
    await expect(ink).toBeFocused();
    // Mientras escribes solo se ve el campo: el formato no se queda debajo repetido (v529).
    await expect(view.locator('.dia-item').first().locator('.dia-fmt')).toBeHidden();
    await ink.fill('');
    await ink.blur();
    await expect.poll(async () => (await stored(page)).map(e => e.text)).toEqual(['Día tranquilo']);
  });

  test('Diario: «-» es una tarea de hoy con casilla y número, «+» una para otro día, y tras «:» letra pequeña', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showView('diario'));
    const view = page.locator('#view-diario');
    const line = view.locator('.dia-new .dia-ink');
    await line.click();
    await page.keyboard.type('Tareas:');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('- Comprar los trenes');
    await page.keyboard.press('Enter');
    // Intro sigue la lista.
    await expect(line).toHaveValue('Tareas:\n- Comprar los trenes\n- ');
    await page.keyboard.type('Programa: quitar el profesor');
    await page.keyboard.press('Enter');
    // Intro en una línea de lista vacía la termina.
    await page.keyboard.press('Enter');
    await page.keyboard.type('+ Regalo de mamá a las 9:52');
    await page.keyboard.press('Escape');
    const entry = view.locator('.dia-free:not(.dia-new)').first();
    const items = entry.locator('.dia-li');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).locator('.dia-num')).toHaveText('1.');
    await expect(items.nth(1).locator('.dia-num')).toHaveText('2.');
    await expect(items.nth(1).locator('.dia-aside')).toHaveText('quitar el profesor');
    await expect(items.nth(2)).toHaveClass(/is-later/);
    await expect(items.nth(2).locator('.dia-num')).toHaveCount(0);
    // Las horas no se parten.
    await expect(items.nth(2).locator('.dia-aside')).toHaveCount(0);
    // La misma letra manuscrita al escribir, leer listas y ver títulos.
    const fonts = await entry.evaluate(w => [w.querySelector('.dia-ink'), w.querySelector('.dia-txt'), w.querySelector('.dia-aside')].map(e => getComputedStyle(e).fontFamily));
    expect(new Set(fonts).size).toBe(1);
    expect(fonts[0]).toContain('Diario Kalam');
    expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('22px "Diario Kalam"'); })).toBe(true);
    expect(fonts[0]).toBe(await view.locator('.dia-title').first().evaluate(e => getComputedStyle(e).fontFamily));
    // Marcar una casilla la guarda en el texto, sin abrir el campo.
    await items.nth(0).locator('.dia-box').click();
    await expect(items.nth(0)).toHaveClass(/is-done/);
    await expect(entry.locator('.dia-ink')).toBeHidden();
    await expect.poll(async () => (await stored(page)).map(e => e.text)).toEqual(['Tareas:\n- [x] Comprar los trenes\n- Programa: quitar el profesor\n+ Regalo de mamá a las 9:52']);
  });

  test('Diario: se pasa de un día a otro y no deja ir al futuro', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showView('diario'));
    const view = page.locator('#view-diario');
    await expect(view.locator('[data-act="next"]')).toBeDisabled();
    await view.locator('[data-act="prev"]').click();
    await expect(view.locator('.dia-item')).toHaveCount(1);
    await expect(view.locator('.dia-item .dia-title')).toHaveText('Chopin · Balada n.º 4');
    await expect(view.locator('[data-act="today"]')).toBeVisible();
    await view.locator('[data-act="today"]').click();
    await expect(view.locator('.dia-item')).toHaveCount(2);
  });

  test('Diario: pantalla completa tapa todo lo demás, con la página más ancha y la letra algo menor', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showView('diario'));
    const view = page.locator('#view-diario');
    const before = await view.locator('.dia-paper').evaluate(e => ({ w: e.getBoundingClientRect().width, font: getComputedStyle(e.querySelector('.dia-ink')).fontSize }));
    await view.locator('[data-act="focus"]').click();
    await expect(page.locator('html')).toHaveClass(/dia-focus/);
    await expect(view.locator('[data-act="focus"]')).toHaveText('Salir');
    const after = await page.evaluate(() => {
      const v = document.getElementById('view-diario').getBoundingClientRect();
      const paper = document.querySelector('#view-diario .dia-paper');
      const hit = document.elementFromPoint(5, 5);
      return { v: [v.left, v.top, v.width, v.height], w: paper.getBoundingClientRect().width,
        font: getComputedStyle(paper.querySelector('.dia-ink')).fontSize, covered: !!(hit && hit.closest('#view-diario')),
        meta: getComputedStyle(paper.querySelector('.dia-time')).fontSize };
    });
    expect(after.v).toEqual([0, 0, 1000, 800]);
    expect(after.covered).toBe(true);
    expect(after.w).toBeGreaterThan(before.w);
    expect(parseFloat(after.font)).toBeLessThan(parseFloat(before.font));
    expect(after.meta).toBe('16px');
    // Se escribe igual que siempre.
    await view.locator('.dia-new .dia-ink').click();
    await page.keyboard.type('Escrito a pantalla completa');
    await expect.poll(async () => (await stored(page)).map(e => e.text)).toContain('Escrito a pantalla completa');
    // Esc termina de escribir; otro Esc sale.
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveClass(/dia-focus/);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveClass(/dia-focus/);
    // Cambiar de pestaña también sale.
    await view.locator('[data-act="focus"]').click();
    await page.evaluate(() => showView('session'));
    await expect(page.locator('html')).not.toHaveClass(/dia-focus/);
  });
});

test.describe('libro de escritorio', () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  const pages = page => page.locator('#view-diario .dia-spread > .dia-book-page');
  const settled = page => expect(page.locator('#view-diario .dia-turning')).toHaveCount(0, { timeout: 3000 });

  test('se abre a toda la pestaña con ayer y hoy, sin desplazar la página', async ({ page }) => {
    await boot(page);
    await page.locator('.nav-btn[data-view="diario"]').first().click();
    // La tapa se abre solo la primera vez.
    await expect(page.locator('.dia-turning.is-opening')).toHaveCount(1);
    await settled(page);
    await expect(pages(page)).toHaveCount(2);
    await expect(pages(page).nth(0)).toHaveAttribute('data-day', dayKey(-1));
    await expect(pages(page).nth(1)).toHaveAttribute('data-day', dayKey(0));
    await expect(pages(page).nth(1).locator('.dia-item').first().locator('.dia-crono')).toContainText('probar el pedal más corto');
    await expect(page.locator('#view-diario [data-act="next"]')).toBeDisabled();

    const size = await page.evaluate(() => {
      const r = document.querySelector('.dia-cover').getBoundingClientRect();
      return { w: r.width, bottom: r.bottom, inner: innerHeight, scroll: document.documentElement.scrollHeight };
    });
    expect(size.w).toBeGreaterThan(900);
    expect(size.bottom).toBeLessThanOrEqual(size.inner);
    expect(size.scroll).toBeLessThanOrEqual(size.inner);

    await page.locator('.nav-btn[data-view="session"]').first().click();
    await page.locator('.nav-btn[data-view="diario"]').first().click();
    await expect(page.locator('.dia-turning')).toHaveCount(0);
  });

  test('la hoja gira al pasar y cada escrito queda en el día de su página', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showView('diario'));
    await settled(page);

    await pages(page).nth(0).locator('.dia-item .dia-meta').click();
    await page.keyboard.type('La coda de ayer');
    await pages(page).nth(1).locator('.dia-new .dia-ink').click();
    await page.keyboard.type('Nota de hoy sin guardar a mano');

    await page.locator('#view-diario [data-act="prev"]').click();
    await expect(page.locator('.dia-leaf')).toHaveCount(1);
    await expect(pages(page).nth(0)).toHaveAttribute('data-day', dayKey(-3));
    await expect(pages(page).nth(1)).toHaveAttribute('data-day', dayKey(-2));
    await settled(page);
    await expect(pages(page).nth(1).locator('.dia-title')).toHaveText('Haydn · Sonata Hob. XVI:52');
    await expect.poll(async () => (await stored(page)).map(e => [e.text, e.day, e.ref || '']).sort()).toEqual([
      ['La coda de ayer', dayKey(-1), 'p:y'],
      ['Nota de hoy sin guardar a mano', dayKey(0), ''],
    ]);

    // Con las flechas del teclado se vuelve; en la última no se pasa de hoy.
    await page.keyboard.press('ArrowRight');
    await expect(pages(page).nth(1)).toHaveAttribute('data-day', dayKey(0));
    await settled(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.dia-turning')).toHaveCount(0);
    await expect(pages(page).nth(0).locator('.dia-item .dia-ink')).toHaveValue('La coda de ayer');

    // Dos seguidas sin esperar: se acaba la primera y empieza la segunda.
    await page.locator('#view-diario [data-act="prev"]').click();
    await page.locator('#view-diario [data-act="prev"]').click();
    await expect(pages(page).nth(1)).toHaveAttribute('data-day', dayKey(-4));
    await expect(page.locator('.dia-leaf')).toHaveCount(1);
    await settled(page);
    await page.locator('#view-diario [data-act="today"]').click();
    await expect(pages(page).nth(1)).toHaveAttribute('data-day', dayKey(0));
    await settled(page);
    await expect(page.locator('#view-diario [data-act="today"]')).toHaveCount(0);
  });

  test('tocar lo vacío de la hoja lleva a escribir en ese día', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showView('diario'));
    await settled(page);
    const sheet = pages(page).nth(0).locator('.dia-sheet');
    const box = await sheet.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
    await expect(pages(page).nth(0).locator('.dia-new .dia-ink')).toBeFocused();
  });

  test('si el sistema pide menos movimiento, cambia de hoja sin animación', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);
    await page.evaluate(() => showView('diario'));
    await expect(page.locator('.dia-turning')).toHaveCount(0);
    await page.locator('#view-diario [data-act="prev"]').click();
    await expect(pages(page).nth(1)).toHaveAttribute('data-day', dayKey(-2));
    await expect(page.locator('.dia-turning')).toHaveCount(0);
  });

  test('a pantalla completa el libro llena la ventana y el botón lo devuelve', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showView('diario'));
    await settled(page);
    const before = await page.locator('.dia-cover').evaluate(e => e.getBoundingClientRect().width);
    await page.locator('#view-diario [data-act="focus"]').click();
    await expect(page.locator('html')).toHaveClass(/dia-focus/);
    const r = await page.evaluate(() => {
      const c = document.querySelector('.dia-cover').getBoundingClientRect();
      const hit = document.elementFromPoint(innerWidth / 2, 3);
      return { w: c.width, bottom: c.bottom, inner: innerHeight, covered: !!(hit && hit.closest('#view-diario')) };
    });
    expect(r.w).toBeGreaterThan(before + 150);
    expect(r.bottom).toBeLessThanOrEqual(r.inner);
    expect(r.bottom).toBeGreaterThan(r.inner - 40);
    expect(r.covered).toBe(true);
    await expect(pages(page)).toHaveCount(2);
    await page.locator('#view-diario [data-act="focus"]').click();
    await expect(page.locator('html')).not.toHaveClass(/dia-focus/);
    await expect.poll(() => page.locator('.dia-cover').evaluate(e => Math.round(e.getBoundingClientRect().width))).toBe(Math.round(before));
  });

  test('al estrechar la ventana pasa a una página por día', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showView('diario'));
    await settled(page);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.locator('#view-diario .dia-book')).toHaveCount(0);
    await expect(page.locator('#view-diario .dia-page')).toHaveAttribute('data-day', dayKey(0));
    await page.setViewportSize({ width: 1440, height: 860 });
    await expect(pages(page)).toHaveCount(2);
  });
});
