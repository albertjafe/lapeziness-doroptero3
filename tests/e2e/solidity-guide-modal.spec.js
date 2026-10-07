import { test, expect } from '@playwright/test';

const fixture = {
  obras: [
    { id:'general', name:'General', tipo:'actividad', sol:0, solHistory:[], movimientos:[] },
    {
      id:'obra_modal', name:'Sonata de prueba', composer:'Compositor', tipo:'obra', sol:68,
      solHistory:[], paseHistory:[],
      movimientos:[{ id:'m1', name:'I. Allegro', sol:68, solHistory:[], paseHistory:[] }],
    },
  ],
  eventos:[], sesiones:[], registro:[], sessionPlants:[], forestPlants:[],
  estadoEventos:[], impulsoEventos:[], malestarEventos:[], deporteEventos:[], suenoEventos:[], triggerEventos:[],
  tiempoDisponibleEventos:[], dailyJournalEntries:[],
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status:200,
    contentType:'application/javascript',
    body:'/* Supabase bloqueado en tests */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision:0, dirtyRevision:0, lastSyncedRevision:0 }));
  }, fixture);
  await page.goto('/', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'mov::obra_modal::m1';
    cronoUpdateSelectBtn();
    cronoUpdateStartBtn();
  });
}

test('live solidity help shows the scale of the work being studied and lets you change it', async ({ page }) => {
  await prepare(page);

  await expect(page.locator('#cronoTargetSolidityGuideButton')).toBeVisible();
  await expect(page.locator('#cronoTargetSolidity .crono-target-solidity-guide')).toHaveCount(1);
  await expect(page.locator('#cronoTargetSolidity .crono-target-solidity-guide')).not.toHaveAttribute('open', '');
  await expect(page.locator('#solidityGuideHechoV3 .solidity-guide-v3')).toHaveCount(1);

  await page.locator('#cronoTargetSolidityGuideButton').click();
  const modal = page.locator('#cronoSolidityGuideModal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#cronoTargetSolidity .crono-target-solidity-guide')).not.toHaveAttribute('open', '');
  await expect(modal).toContainText('Qué significa cada puntuación');
  await expect(modal).toContainText('Escala · Obra nueva');
  // El tramo marcado es el que nombra la píldora.
  const pill = (await page.locator('#cronoTargetSolidityValue').textContent()).split('·')[1].trim();
  await expect(modal.locator('.solidity-guide-row.is-current b')).toHaveText(pill);
  await expect(modal).toContainText('Todas las notas están en las manos');
  await modal.locator('.solidity-scale-choice', { hasText:'Recuperación' }).click();
  await expect(modal).toContainText('Escala · Recuperación');
  await expect(modal.locator('.solidity-scale-choice.is-active')).toContainText('Recuperación');
  await expect(page.locator('#cronoTargetSolidityScale')).toHaveText('Escala · Recuperación');
  const pillAfter = (await page.locator('#cronoTargetSolidityValue').textContent()).split('·')[1].trim();
  await expect(modal.locator('.solidity-guide-row.is-current b')).toHaveText(pillAfter);
  expect(await page.evaluate(() => findObra('obra_modal').solidityScale)).toBe('repertorio');
  await modal.locator('.solidity-scale-auto').click();
  await expect(modal).toContainText('Escala · Obra nueva');


  await modal.getByRole('button', { name:'Cerrar guía' }).click();
  await expect(modal).toBeHidden();
});
