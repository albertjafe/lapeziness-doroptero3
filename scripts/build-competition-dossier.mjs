// Junta las fichas verificadas de data/concursos/*.json en el dosier que la app
// carga la primera vez (data/concursos-dosier.json). Formato: docs/DOSIER_CONCURSOS_FORMATO.md
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('data/concursos');
const files = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort();
const concursos = files.map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
const ids = new Set();
for (const item of concursos) {
  if (ids.has(item.id)) throw new Error(`id repetido: ${item.id}`);
  ids.add(item.id);
}
const dossier = {
  formato: 'dosier-concursos-piano',
  version: 1,
  generado: '2026-10-02',
  autor: 'Claude · bases oficiales consultadas el 2 de octubre de 2026',
  concursos,
};
fs.writeFileSync('data/concursos-dosier.json', JSON.stringify(dossier, null, 2) + '\n');
console.log(`${concursos.length} concursos → data/concursos-dosier.json`);
