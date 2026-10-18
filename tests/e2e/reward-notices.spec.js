import { test, expect } from '@playwright/test';

test.use({ timezoneId: 'Europe/Berlin' });
const seenKey = 'study_secret_bonus_seen_v1';
const today = '2026-10-18', yesterday = '2026-10-17';
const id = day => 'bonus:process:recorded-pass:' + day;
const fixture = { competitionPlanningSeedVersion: 999, obras: [{ id: 'w', name: 'Synthetic work', movimientos: [] }],
  sessionPlants: [], forestPlants: [], sesiones: [], eventos: [], registro: [], habitChallenges: [],
  germanStudy: { version: 1, materials: [], reviews: [], sessions: [], ledger: [],
    goals: [{ id: 'g', name: 'Sheet music', amount: 220, createdAt: '2026-09-01T10:00:00Z' }] } };

async function boot(page, { quota = false } = {}) {
  await page.clock.setFixedTime(new Date(today + 'T12:00:00+02:00'));
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.addInitScript(({ data, quota, key }) => {
    if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(['bonus:older-notice']));
    if (quota) {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === 'alberto_piano_v2' || name === key) throw new DOMException('Synthetic full storage', 'QuotaExceededError');
        return set.call(this, name, value);
      };
    }
  }, { data: fixture, quota, key: seenKey });
  await page.goto('/');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/);
  await page.waitForFunction(() => window.StudyIncentives && window.LocalSaveResilience);
  await page.evaluate(async () => {
    await LocalSaveResilience.recoverSnapshot();
    document.querySelectorAll('.modal-overlay.visible').forEach(x => closeModal(x.id));
    StudyIncentives.checkSecretRewards({ prime: true });
  });
}

async function recordPass(page, day) {
  await page.evaluate(day => {
    (db.obras[0].paseHistory ||= []).push({ date: day + 'T09:00:00+02:00', tipo: 'grabacion', score: 7 });
    saveData(); StudyIncentives.checkSecretRewards();
  }, day);
}

async function flush(page) {
  await page.evaluate(async () => { flushSaveDataSoon(); await LocalSaveResilience.flush(); });
}

test('late history stays quiet, a new reward is celebrated, and the next day preserves the same balance without another notice', async ({ page }) => {
  await boot(page);
  await recordPass(page, yesterday);
  await expect(page.locator('#studySecretRewardToast')).toHaveCount(0);
  expect(await page.evaluate(key => !!db.rewardNoticeSeen[key], id(yesterday))).toBe(true);
  expect(await page.evaluate(() => PianoRewards.walletSnapshot(db).points)).toBeCloseTo(.25, 5);
  await recordPass(page, today);
  await expect(page.locator('#studySecretRewardToast')).toContainText('Pase grabado');
  await flush(page);
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00+02:00'));
  await page.reload();
  await page.waitForFunction(() => window.StudyIncentives);
  await page.evaluate(() => StudyIncentives.checkSecretRewards());
  await expect(page.locator('#studySecretRewardToast')).toHaveCount(0);
  expect(await page.evaluate(() => PianoRewards.walletSnapshot(db).points)).toBeCloseTo(.5, 5);
});

test('full localStorage saves the notice receipt through IndexedDB and restores it after reopening', async ({ page }) => {
  await boot(page, { quota: true });
  await recordPass(page, today);
  await expect(page.locator('#studySecretRewardToast')).toContainText('Pase grabado');
  await flush(page);
  const rescued = await page.evaluate(async key => {
    const snapshot = (await LocalSaveResilience.getRescueSnapshot()).data;
    return { receipt: snapshot.rewardNoticeSeen[key], points: PianoRewards.walletSnapshot(snapshot).points,
      cache: localStorage.getItem('study_secret_bonus_seen_v1') };
  }, id(today));
  expect(rescued.receipt).toBeTruthy(); expect(rescued.points).toBeCloseTo(.25, 5);
  expect(rescued.cache).not.toContain(id(today));
  await page.reload();
  await page.waitForFunction(() => window.StudyIncentives && window.LocalSaveResilience);
  await page.evaluate(async () => {
    await LocalSaveResilience.recoverSnapshot(); StudyIncentives.checkSecretRewards();
  });
  await expect(page.locator('#studySecretRewardToast')).toHaveCount(0);
  expect(await page.evaluate(key => !!db.rewardNoticeSeen[key], id(today))).toBe(true);
  expect(await page.evaluate(() => PianoRewards.walletSnapshot(db).points)).toBeCloseTo(.25, 5);
});

test('a synchronized receipt suppresses the same reward on another device without recalculating study for receipt-only saves', async ({ page, browser }) => {
  await boot(page); await recordPass(page, today); await flush(page);
  const remote = await page.evaluate(() => structuredClone(db));
  const context = await browser.newContext({ timezoneId: 'Europe/Berlin' }), other = await context.newPage();
  try {
    await boot(other);
    // Initial cloud hydration has already happened; this models a later sync.
    await other.evaluate(() => window.dispatchEvent(new CustomEvent('study-cloud-hydrated')));
    await other.evaluate(remote => {
      DocumentSyncCore.assign(db, DocumentSyncCore.mergeRemote(remote, db));
      _rememberLocalDocument(); StudyIncentives.checkSecretRewards();
    }, remote);
    await expect(other.locator('#studySecretRewardToast')).toHaveCount(0);
    expect(await other.evaluate(() => PianoRewards.walletSnapshot(db).points)).toBeCloseTo(.25, 5);
    const versions = await other.evaluate(() => {
      saveData(); const before = _studyDataVersion;
      db.rewardNoticeSeen['bonus:receipt-only'] = new Date().toISOString(); saveData();
      return { before, after: _studyDataVersion, persisted: JSON.parse(localStorage.getItem('alberto_piano_v2')).rewardNoticeSeen['bonus:receipt-only'] };
    });
    expect(versions.after).toBe(versions.before); expect(versions.persisted).toBeTruthy();
  } finally { await context.close(); }
});
