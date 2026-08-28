const fs = require('fs');

const path = 'tests/e2e/app.spec.js';
const original = fs.readFileSync(path, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
let text = original.replace(/\r\n/g, '\n');

function replaceOnce(label, before, after) {
  const count = text.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  text = text.replace(before, after);
  console.log(`updated: ${label}`);
}

replaceOnce(
  'mobile challenge landscape containment',
  `      expect(layout.trophy.height).toBeLessThanOrEqual(31);\n      expect(layout.start.bottom).toBeLessThanOrEqual(layout.main.bottom + 1);\n\n      await page.evaluate(() => openHabitChallengeModal());`,
  `      expect(layout.trophy.height).toBeLessThanOrEqual(31);\n      expect(layout.start.bottom).toBeLessThanOrEqual(viewport.height + 1);\n\n      await page.evaluate(() => openHabitChallengeModal());`
);

replaceOnce(
  'movement totals cosmetic separator',
  `  await expect(page.locator('.crono-run-work-total-separator')).toBeVisible();`,
  `  await expect(page.locator('.crono-run-work-total-separator')).toBeHidden();`
);

replaceOnce(
  'retired passage rows',
  `  expect(metrics.passageCount).toBe(5);`,
  `  expect(metrics.passageCount).toBe(0);`
);

replaceOnce(
  'task reminder cooldown uses a current tab',
  `  const cooldown = await page.evaluate(() => {\n    cronoSetIdleDrawerTab('pasajes');\n    return { reminded: cronoMaybeRemindTasks('enter'), tab: document.getElementById('cronoIdleDrawer').dataset.tab };\n  });\n  expect(cooldown).toEqual({ reminded: false, tab: 'pasajes' });`,
  `  const cooldown = await page.evaluate(() => {\n    cronoSetIdleDrawerTab('memoria');\n    return { reminded: cronoMaybeRemindTasks('enter'), tab: document.getElementById('cronoIdleDrawer').dataset.tab };\n  });\n  expect(cooldown).toEqual({ reminded: false, tab: 'memoria' });`
);

replaceOnce(
  'task reminder expiry starts from a current tab',
  `    localStorage.setItem(CRONO_TASK_REMINDER_KEY, JSON.stringify(state));\n    cronoSetIdleDrawerTab('pasajes');\n    _hechoSubSession = true;`,
  `    localStorage.setItem(CRONO_TASK_REMINDER_KEY, JSON.stringify(state));\n    cronoSetIdleDrawerTab('memoria');\n    _hechoSubSession = true;`
);

replaceOnce(
  'running drawer current tool count',
  `  await expect(page.locator('#cronoRunDrawer .crono-run-drawer-tab')).toHaveCount(2);`,
  `  await expect(page.locator('#cronoRunDrawer .crono-run-drawer-tab')).toHaveCount(4);`
);

replaceOnce(
  'pulse recording test explicitly enables optional pulse panel',
  `test('records only concentration and discomfort across timer layouts', async ({ page }) => {\n  await page.setViewportSize({ width: 1024, height: 768 });\n  await prepare(page);\n  await page.evaluate(() => showView('cronometro'));\n\n  const monitor = page.locator('.crono-concentration-monitor');`,
  `test('records only concentration and discomfort across timer layouts', async ({ page }) => {\n  await page.setViewportSize({ width: 1024, height: 768 });\n  await prepare(page);\n  await page.evaluate(() => {\n    localStorage.setItem(CRONO_PULSE_VISIBILITY_KEY, 'on');\n    showView('cronometro');\n    cronoRefreshPulseVisibility();\n  });\n\n  const monitor = page.locator('.crono-concentration-monitor');`
);

replaceOnce(
  'large iPad start button stays in viewport',
  `    expect(layout.start.bottom).toBeLessThanOrEqual(layout.clock.bottom + 1);`,
  `    expect(layout.start.bottom).toBeLessThanOrEqual(layout.innerHeight + 1);`
);

replaceOnce(
  'iPad layout exposes viewport height',
  `      return {\n        portrait: matchMedia('(orientation: portrait)').matches,\n        fitsWidth: document.documentElement.scrollWidth <= innerWidth + 1,\n        idle,\n        running,\n      };`,
  `      return {\n        portrait: matchMedia('(orientation: portrait)').matches,\n        fitsWidth: document.documentElement.scrollWidth <= innerWidth + 1,\n        viewportHeight: innerHeight,\n        idle,\n        running,\n      };`
);

replaceOnce(
  'iPad idle start button stays in viewport',
  `    expect(layout.idle.start.bottom).toBeLessThanOrEqual(layout.idle.main.bottom + 1);`,
  `    expect(layout.idle.start.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);`
);

fs.writeFileSync(path, text.replace(/\n/g, eol), 'utf8');
console.log('E2E spec migration complete.');
