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

test('live solidity help opens the same detailed 0–100 copy as Hecho', async ({ page }) => {
  await prepare(page);

  await expect(page.locator('#cronoTargetSolidityGuideButton')).toBeVisible();
  await expect(page.locator('#cronoTargetSolidity .crono-target-solidity-guide')).toHaveCount(0);
  await expect(page.locator('#solidityGuideHechoV3 .solidity-guide-v3')).toHaveCount(1);

  await page.locator('#cronoTargetSolidityGuideButton').click();
  const modal = page.locator('#cronoSolidityGuideModal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Qué significa cada puntuación');
  await expect(modal).toContainText('Apenas empezada');
  await expect(modal).toContainText('Estás descubriendo notas, digitación o estructura');
  await expect(modal).toContainText('Fiabilidad excepcional');
  await expect(modal).toContainText('múltiples pases y días confirman una consistencia extraordinaria');
  await expect(modal).toContainText('Referencia');

  const copies = await page.evaluate(() => ({
    hecho: document.querySelector('#solidityGuideHechoV3 .solidity-guide-bands')?.innerText.trim(),
    modal: document.querySelector('#cronoSolidityGuideModal .solidity-guide-bands')?.innerText.trim(),
  }));
  expect(copies.modal).toBe(copies.hecho);

  await modal.getByRole('button', { name:'Cerrar guía' }).click();
  await expect(modal).toBeHidden();
});
