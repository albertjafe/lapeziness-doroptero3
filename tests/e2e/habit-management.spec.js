import { test, expect } from '@playwright/test';

async function prepare(page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(w => {
    // Platform routing uses UA Client Hints before navigator.platform.
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => w === 1366 ? 'Win32' : w === 834 ? 'MacIntel' : 'iPhone' });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => w === 1366 ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' : w === 834 ? 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => w === 1366 ? 0 : 5 });
  }, width);
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: '/* isolated */' }));
  await page.addInitScript(() => {
    if (localStorage.getItem('alberto_piano_v2')) return;
    const key = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const active = { id: 'current', title: 'Leer por la mañana', mode: 'do', startDate: key(-2), durationDays: 21, logs: { [key(-1)]: { status: 'done', at: key(-1) + 'T12:00:00Z' } }, customField: { keep: true } };
    const completed = { id: 'finished', title: 'Pasear al salir', mode: 'do', startDate: key(-40), durationDays: 21, completedAt: key(-20), logs: { [key(-40)]: { status: 'done' } }, rewardClaimedAt: key(-19) + 'T12:00:00Z', rewardCoins: 1, customField: { keep: true }, successCriteria: 'Un paseo diario', rulebooks: [{ rule: 'Salir a pasear cada tarde.', effectiveFrom: key(-40), savedAt: key(-40) + 'T12:00:00Z' }] };
    localStorage.setItem('alberto_piano_v2', JSON.stringify({ obras: [], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], habitChallenges: [active, completed], habitChallenge: active }));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HabitsPage && window.MobileV2);
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { closeModal('modalCloudSync'); showView('session'); });
}

for (const [width, height] of [[390, 844], [834, 1194], [1366, 900]]) {
  test(`one-tap habits, selection and adding alongside an active habit at ${width}px`, async ({ page }, testInfo) => {
    await prepare(page, width, height);
    const access = width < 1100 ? page.locator('.mv2-habits-access') : page.locator('.desktop-nav-btn[data-view="habitos"]');
    await expect(access).toBeInViewport();
    await access.click();
    await expect(page.locator('#view-habitos')).toHaveClass(/active/);
    await page.getByRole('combobox', { name: 'Elegir hábito' }).selectOption('finished');
    await expect(page.locator('.hp-manage').getByRole('button', { name: 'Eliminar', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Añadir hábito' }).click();
    await expect(page.locator('#habitTitleInput')).toHaveValue('');
    await page.locator('#habitTitleInput').fill('Preparar la mochila');
    await page.locator('#habitSaveBtn').click();
    await expect(page.locator('#modalHabitChallenge')).not.toHaveClass(/visible/);
    await expect(page.locator('.hp-hero h2')).toHaveText('Preparar la mochila');
    expect(await page.evaluate(() => habitActiveChallenges().map(h => h.title))).toEqual(['Leer por la mañana', 'Preparar la mochila']);
    await page.locator('.hp-today').click();
    expect(await page.evaluate(() => habitActiveChallenges().map(h => habitMetrics(h).todayLog))).toEqual(['', 'done']);
    expect(await page.locator('#view-habitos').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('habit-management.png'), fullPage: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof habitActiveChallenges === 'function');
    expect(await page.evaluate(() => habitActiveChallenges().length)).toBe(2);
    expect(await page.evaluate(() => habitMetrics(habitActiveChallenges().find(h => h.title === 'Preparar la mochila')).todayLog)).toBe('done');
  });
}

test('deletes completed and active habits only after confirmation; stale copies cannot restore them', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    window.staleHabits = JSON.parse(JSON.stringify(db));
    openHabitos('finished');
  });
  const remove = page.locator('.hp-manage').getByRole('button', { name: 'Eliminar', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await remove.click();
  expect(await page.evaluate(() => habitAllChallenges().length)).toBe(2);
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  expect(await page.evaluate(() => habitAllChallenges().map(h => h.id))).toEqual(['current']);
  // The stored tombstone preserves unknown fields and wins in either merge direction.
  expect(await page.evaluate(() => {
    const deleted = db.habitChallenges.find(h => h.id === 'finished');
    return { deleted: deleted.deleted, custom: deleted.customField, merges: [DocumentSyncCore.mergeRemote(staleHabits, db), DocumentSyncCore.mergeRemote(db, staleHabits)].map(data => data.habitChallenges.find(h => h.id === 'finished').deleted) };
  })).toEqual({ deleted: true, custom: { keep: true }, merges: [true, true] });
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect(page.locator('#habitsPageContent')).toContainText('Aún no tienes hábitos');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof habitAllChallenges === 'function');
  expect(await page.evaluate(() => habitAllChallenges())).toEqual([]);
});

test('deleting a habit also removes its reopened cycles without touching another habit', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const all = habitStoredChallenges();
    all.push({ id: 'reopened', reopenOf: 'finished', title: 'Pasear al salir', mode: 'do', startDate: habitDayKey(), durationDays: 14, logs: {}, customField: 'keep' });
    habitPersistChallenges(all);
    saveData();
    openHabitos('finished');
  });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.hp-manage').getByRole('button', { name: 'Eliminar', exact: true }).click();
  expect(await page.evaluate(() => habitAllChallenges().map(h => h.id))).toEqual(['current']);
  expect(await page.evaluate(() => db.habitChallenges.find(h => h.id === 'reopened'))).toMatchObject({ deleted: true, customField: 'keep' });
});

test('restart is cancellable and creates a distinct clean cycle with the same rule', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => openHabitos('finished'));
  await page.getByRole('button', { name: 'Empezar de cero', exact: true }).click();
  await expect(page.locator('#habitTitleInput')).toHaveValue('Pasear al salir');
  await page.locator('#habitCancelBtn').click();
  expect(await page.evaluate(() => habitAllChallenges().length)).toBe(2);
  await page.getByRole('button', { name: 'Empezar de cero', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#habitSaveBtn').click();
  expect(await page.evaluate(() => habitAllChallenges().length)).toBe(2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#habitSaveBtn').click();
  await expect(page.locator('#modalHabitChallenge')).not.toHaveClass(/visible/);
  const state = await page.evaluate(() => {
    const habits = habitAllChallenges();
    const fresh = habits.find(h => h.title === 'Pasear al salir');
    return { count: habits.length, id: fresh.id, start: fresh.startDate, today: habitDayKey(), logs: Object.keys(fresh.logs).filter(k => !k.startsWith('_')), complete: !!fresh.completedAt, claimed: !!fresh.rewardClaimedAt, rule: HabitRulebook.inForce(fresh, habitDayKey())?.rule, deleted: db.habitChallenges.find(h => h.id === 'finished').deleted };
  });
  expect(state).toMatchObject({ count: 2, start: state.today, logs: [], complete: false, claimed: false, rule: 'Salir a pasear cada tarde.', deleted: true });
  expect(state.id).not.toBe('finished');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof habitAllChallenges === 'function');
  expect(await page.evaluate(() => habitAllChallenges().filter(h => h.title === 'Pasear al salir').length)).toBe(1);
});
