import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const O = require('../../oportunidades.js');
const DocumentSyncCore = require('../../document-sync-core.js');
const seed = JSON.parse(fs.readFileSync('data/oportunidades-dosier.json', 'utf8'));
const byId = id => O.normalize(seed.oportunidades.find(o => o.id === id));
const BIRTH = '1999-02-19';
const TODAY = '2026-10-03';

describe('dosier de festivales y becas: datos', () => {
  it('el dosier inicial es válido, sin ids repetidos, con fuentes y de los dos tipos', () => {
    const parsed = O.parse(JSON.stringify(seed));
    expect(parsed.errors).toEqual([]);
    expect(parsed.items.length).toBeGreaterThanOrEqual(10);
    for (const item of parsed.items) {
      expect(item.fuentes.length).toBeGreaterThan(0);
      for (const f of item.fuentes) expect(f.url).toMatch(/^https:\/\//);
    }
    const tipos = new Set(parsed.items.map(i => i.tipo));
    expect([...tipos].sort()).toEqual(['beca', 'festival']);
  });

  it('rechaza un dosier de concursos con un mensaje claro y acepta una ficha suelta', () => {
    expect(() => O.parse({ formato: 'dosier-concursos-piano', concursos: [] })).toThrow(/pestaña Concursos/);
    expect(() => O.parse('{nope')).toThrow(/JSON/);
    expect(O.parse(JSON.stringify(seed.oportunidades[0])).items).toHaveLength(1);
    const mixed = O.parse([seed.oportunidades[0], { id: 'Mal Id', nombre: 'x' }]);
    expect(mixed.items).toHaveLength(1);
    expect(mixed.errors).toHaveLength(1);
  });
});

describe('plazos y edad', () => {
  it('AIEnRuta-Clásicos cierra pronto y admite hasta 30 años', () => {
    const o = byId('aienruta-clasicos-2027');
    const dl = O.deadlineStatus(o, TODAY);
    expect(dl.state).toBe('soon');
    expect(dl.days).toBe(25);
    expect(O.eligibility(o, BIRTH, TODAY).state).toBe('yes');
  });

  it('una propuesta abierta todo el año no caduca y va detrás de los plazos con fecha', () => {
    const berlin = byId('embajada-espana-berlin');
    expect(O.deadlineStatus(berlin, TODAY)).toMatchObject({ state: 'rolling', label: 'Abierto todo el año' });
    const sorted = seed.oportunidades.map(O.normalize).sort((a, b) => O.compare(a, b, TODAY));
    const firstRolling = sorted.findIndex(o => O.deadlineStatus(o, TODAY).state === 'rolling');
    const lastDated = sorted.map(o => O.deadlineStatus(o, TODAY).state).lastIndexOf('soon');
    expect(firstRolling).toBeGreaterThan(lastDated);
  });

  it('un plazo pasado queda cerrado', () => {
    const o = byId('aienruta-clasicos-2027');
    expect(O.deadlineStatus(o, '2026-10-29').state).toBe('closed');
  });
});

describe('importar sin perder lo que es tuyo', () => {
  it('añade, actualiza y conserva el interés', () => {
    const state = { fichas: [] };
    const items = O.parse(JSON.stringify(seed)).items;
    expect(O.merge(state, items).added).toBe(items.length);
    state.fichas[0].interes = 'si';
    const changed = Object.assign({}, items[0], { resumen: 'Cambiado' });
    const result = O.merge(state, [changed, items[1]]);
    expect(result).toMatchObject({ added: 0, updated: 1, unchanged: 1 });
    expect(state.fichas[0].interes).toBe('si');
    expect(O.fichaOf(state.fichas[0]).resumen).toBe('Cambiado');
  });

  it('el dosier inicial no pisa una ficha verificada más tarde', () => {
    const items = O.parse(JSON.stringify(seed)).items;
    const newer = Object.assign({}, items[0], { verificado: '2027-01-01', resumen: 'Nuevo' });
    const state = { fichas: [] };
    O.merge(state, [newer]);
    expect(O.merge(state, [items[0]], { onlyNewer: true }).unchanged).toBe(1);
    expect(O.fichaOf(state.fichas[0]).resumen).toBe('Nuevo');
  });
});

describe('seguimiento de contactos', () => {
  const now = new Date('2026-10-03T10:00:00Z');

  it('crear exige nombre y empieza «Por contactar»', () => {
    expect(() => O.newContact({ nombre: '  ' }, now)).toThrow(/nombre/);
    const c = O.newContact({ nombre: 'Ayuntamiento de Daimiel', tipo: 'raro' }, now);
    expect(c).toMatchObject({ estado: 'pendiente', tipo: 'ayuntamiento', archivado: false, proximo: null });
    expect(c.id).toMatch(/^ct-/);
    expect(O.nextStep(c, TODAY)).toMatchObject({ due: true, text: 'Buscar el contacto y enviar el email' });
  });

  it('email enviado → llamar a los 7 días si no hay respuesta', () => {
    const c = O.newContact({ nombre: 'Ayuntamiento de Tomelloso', email: 'cultura@example.org' }, now);
    O.setEstado(c, 'enviado', TODAY);
    expect(c).toMatchObject({ estado: 'enviado', enviado: TODAY, proximo: '2026-10-10' });
    expect(O.nextStep(c, '2026-10-09').due).toBe(false);
    expect(O.nextStep(c, '2026-10-10')).toMatchObject({ due: true });
    expect(O.nextStep(c, '2026-10-10').text).toMatch(/^Llamar/);
    O.setEstado(c, 'llamado', '2026-10-10');
    expect(c.proximo).toBe('2026-10-17');
    expect(c.enviado).toBe(TODAY);
    O.setEstado(c, 'conversando', '2026-10-12');
    expect(c.proximo).toBeNull();
    O.setEstado(c, 'cerrado', '2026-10-20');
    expect(O.nextStep(c, '2026-10-20')).toMatchObject({ done: true, due: false });
  });

  it('ordena primero lo que toca hoy y resume', () => {
    const due = O.setEstado(O.newContact({ nombre: 'B' }, now), 'enviado', '2026-09-20');
    const pending = O.newContact({ nombre: 'A' }, now);
    const waiting = O.setEstado(O.newContact({ nombre: 'C' }, now), 'enviado', TODAY);
    const closed = O.setEstado(O.newContact({ nombre: 'D' }, now), 'cerrado', TODAY);
    const archived = Object.assign(O.newContact({ nombre: 'E' }, now), { archivado: true });
    const sorted = [closed, waiting, pending, due].sort((a, b) => O.compareContacts(a, b, TODAY)).map(c => c.nombre);
    expect(sorted).toEqual(['B', 'A', 'C', 'D']);
    expect(O.followSummary([due, pending, waiting, closed, archived], TODAY)).toEqual({ total: 4, due: 2, calls: 1, pending: 1, closed: 1, open: 3 });
  });

  it('los ayuntamientos sugeridos no se repiten', () => {
    const names = O.SUGERIDOS.map(s => s.nombre.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('dos dispositivos que tocan contactos distintos no se pisan', () => {
    const base = { oportunidades: { fichas: [], contactos: [O.newContact({ nombre: 'X' }, now), O.newContact({ nombre: 'Y' }, now)] } };
    const server = DocumentSyncCore.track(JSON.parse(JSON.stringify(base)), {}, '2026-10-03T10:00:00Z');
    // Dispositivo A marca el email enviado y lo sube.
    const a = JSON.parse(JSON.stringify(server));
    O.setEstado(a.oportunidades.contactos[0], 'enviado', TODAY);
    const afterA = DocumentSyncCore.mergeRemote(server, DocumentSyncCore.track(a, server, '2026-10-03T11:00:00Z'));
    // Dispositivo B, que aún tenía la copia vieja, apunta una nota en el otro contacto.
    const b = JSON.parse(JSON.stringify(server));
    b.oportunidades.contactos[1].nota = 'Concejala de Cultura';
    const merged = DocumentSyncCore.mergeRemote(afterA, DocumentSyncCore.track(b, server, '2026-10-03T12:00:00Z'));
    const byName = Object.fromEntries(merged.oportunidades.contactos.map(c => [c.nombre, c]));
    expect(byName.X.estado).toBe('enviado');
    expect(byName.X.proximo).toBe('2026-10-10');
    expect(byName.Y.nota).toBe('Concejala de Cultura');
  });
});
