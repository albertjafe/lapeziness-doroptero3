import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync('app.js', 'utf8');
const source = app.slice(app.indexOf('let _swReg = null;'), app.indexOf('// ─── FASE 3B'));
function harness({ waiting = null, error = null } = {}) {
  const elements = {
    appVersionInfo: { textContent: '' },
    appUpdateCheckBtn: { disabled: false, textContent: '' },
    swUpdateBanner: { style: { display: 'flex' } },
  };
  const safeUpdate = vi.fn();
  const registration = { waiting, update: vi.fn(async () => { if (error) throw error; }) };
  const checkForUpdate = vi.fn(async () => { if (error) throw error; return { registration, waiting }; });
  const fetch = vi.fn(async () => new Response('Version no disponible. Reabre la aplicación.', { status: 503 }));
  const context = {
    window: { UpdateSafety: { checkForUpdate, safeUpdate } },
    navigator: { serviceWorker: { getRegistration: async () => registration } },
    document: { getElementById: id => elements[id], querySelectorAll: () => [] },
    APP_VERSION: 'test-current', showToast: vi.fn(), fetch,
    setTimeout: fn => fn(), Date,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, fetch, safeUpdate, checkForUpdate };
}

describe('manual update detection', () => {
  it('does not confuse the SW 503 response for an unknown app query with a new release', async () => {
    const h = harness();
    await h.context.checkForAppUpdate(true);
    expect(h.elements.appVersionInfo.textContent).toContain('al día');
    expect(h.elements.swUpdateBanner.style.display).toBe('none');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.safeUpdate).not.toHaveBeenCalled();
  });
  it('shows a real waiting worker without starting promotion automatically', async () => {
    const h = harness({ waiting: {} });
    await h.context.checkForAppUpdate(true);
    expect(h.elements.appVersionInfo.textContent).toContain('Nueva versión lista');
    expect(h.elements.swUpdateBanner.style.display).toBe('flex');
    expect(h.safeUpdate).not.toHaveBeenCalled();
  });
  it('reports a failed check instead of declaring another update or an up-to-date app', async () => {
    const h = harness({ error: new Error('offline') });
    await h.context.checkForAppUpdate(true);
    expect(h.elements.appVersionInfo.textContent).toContain('No se pudo comprobar');
    expect(h.elements.appUpdateCheckBtn.disabled).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.safeUpdate).not.toHaveBeenCalled();
  });
});
