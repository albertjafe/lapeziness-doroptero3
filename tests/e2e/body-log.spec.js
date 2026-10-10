import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 13'], defaultBrowserType: undefined });

async function boot(page, hour) {
  // setFixedTime deja correr los temporizadores (el arranque los necesita) con la hora fija.
  const now = new Date(); now.setHours(hour, 0, 0, 0);
  await page.clock.setFixedTime(now);
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const data = { competitionPlanningSeedVersion: 999, obras: [], eventos: [], sessionPlants: [], sesiones: [], forestPlants: [], registro: [] };
  await page.addInitScript(d => { if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(d)); }, data);
  await page.goto('/');
  await page.waitForFunction(() => window.MobileV2 && window.BodyLog && typeof showView === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });
}

test('Sueño: por la mañana una pregunta de un toque que desaparece al contestar', async ({ page }) => {
  await boot(page, 8);
  const prompt = page.locator('#mv2Hoy .bl-sleep');
  await expect(prompt).toContainText('¿Qué tal has dormido?');
  await prompt.getByRole('button', { name: 'Regular' }).click();
  await expect(page.locator('#undoToastMsg')).toHaveText('Sueño: regular');
  await expect(page.locator('#mv2Hoy .bl-sleep')).toHaveCount(0);
  expect(await page.evaluate(() => db.suenoEventos.filter(e => e.kind === 'noche').map(e => e.quality))).toEqual(['regular']);
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('alberto_piano_v2') || '{}').suenoEventos || []).length)).toBe(1);
});

test('Deporte: tipo y minutos desde Hoy; se ve en Hoy y en la hoja del día', async ({ page }) => {
  await boot(page, 18);
  await expect(page.locator('#mv2Hoy .bl-sleep')).toHaveCount(0); // por la tarde ya no pregunta
  const card = page.locator('#mv2Hoy .bl-sport');
  await card.getByRole('button', { name: '＋ Apuntar a mano' }).click();
  const sheet = page.locator('#modalBodySport');
  await expect(sheet).toHaveClass(/visible/);
  await sheet.getByRole('radio', { name: 'Fuerza' }).click();
  await sheet.getByRole('radio', { name: '45' }).click();
  await sheet.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('#undoToastMsg')).toHaveText('Deporte anotado · fuerza · 45 min');
  await expect(card).toContainText('Hoy: fuerza 45 min');
  // La hoja recuerda la última elección; «Otro»: minutos a mano.
  await card.getByRole('button', { name: '＋ Apuntar a mano' }).click();
  await expect(sheet.getByRole('radio', { name: 'Fuerza' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('radio', { name: 'Cardio' }).click();
  await sheet.locator('#blSportOther').fill('25');
  await sheet.getByRole('button', { name: 'Guardar' }).click();
  await expect(card).toContainText('Hoy: cardio 25 min · fuerza 45 min');
  await page.evaluate(() => showView('calendario'));
  const key = await page.evaluate(() => BodyLog.dayKey(new Date()));
  await page.locator(`#mv2Cal .mv2-day[data-day="${key}"]`).first().click();
  await expect(page.locator('#mv2DaySheet')).toContainText('Deporte: cardio 25 min · fuerza 45 min');
});

test('Cronómetro de deporte: empieza, sigue tras recargar, termina y se guarda; la entrada manual sigue', async ({ page }) => {
  await boot(page, 18);
  const card = page.locator('#mv2Hoy .bl-sport');
  await card.getByRole('button', { name: 'Cardio', exact: true }).click();
  await expect(card).toContainText('Cardio en marcha · desde las');
  await expect(card.getByRole('button', { name: '＋ Apuntar a mano' })).toHaveCount(0);
  // El inicio se guarda en el documento: recargar no lo pierde.
  await page.evaluate(() => { db.sportTimer.startedAt = new Date(Date.now() - 31 * 60000).toISOString(); saveLocalNow(); });
  await page.reload();
  await page.waitForFunction(() => window.BodyLog && window.MobileV2);
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });
  await expect(card).toContainText('Cardio en marcha');
  await card.getByRole('button', { name: 'Terminar' }).click();
  await expect(page.locator('#undoToastMsg')).toHaveText('Deporte anotado · cardio · 31 min');
  await expect(card).toContainText('Hoy: cardio 31 min');
  await expect(card.getByRole('button', { name: '＋ Apuntar a mano' })).toBeVisible();
  // Un cronómetro olvidado pide confirmar los minutos.
  await card.getByRole('button', { name: 'Fuerza', exact: true }).click();
  await page.evaluate(() => { db.sportTimer.startedAt = new Date(Date.now() - 5 * 3600000).toISOString(); MobileV2.renderHoy(); });
  await card.getByRole('button', { name: 'Terminar' }).click();
  const sheet = page.locator('#modalBodySport');
  await expect(sheet).toContainText('¿Cuántos minutos fueron?');
  await sheet.locator('#blSportOther').fill('40');
  await sheet.getByRole('button', { name: 'Guardar' }).click();
  await expect(card).toContainText('Hoy: cardio 31 min · fuerza 40 min');
  expect(await page.evaluate(() => BodyLog.activeTimer(db))).toBeNull();
});
