import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const migration = fs.readFileSync('supabase/migrations/20261119150000_reservation_monitor_mozarteum.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/reservation-monitor-ingest/index.ts', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');
const dashboard = fs.readFileSync('reservation-dashboard.js', 'utf8');
const moz = fs.readFileSync('mozarteum-dashboard.js', 'utf8');

describe('Aulas · Salzburgo (monitor del Mozarteum)', () => {
  it('accepts the «mozarteum» source and its single command in every layer', () => {
    for (const table of ['tokens', 'state', 'commands']) {
      expect(migration).toContain(`reservation_monitor_${table}_source_check`);
    }
    expect(migration.match(/'alberto', 'emma', 'chen', 'mozarteum'/g)).toHaveLength(3);
    expect(migration).toContain("'allow_rebook', 'moz_franjas'");
    expect(migration).toContain("source = 'mozarteum'");
    expect(edge).toContain('"moz_franjas"');
    expect(edge).toContain('source === "mozarteum" ? cleanMozState(body.state) : cleanState(body.state)');
  });

  it('keeps the Mozarteum row out of the Asimut dashboard', () => {
    expect(dashboard).toContain("const ASIMUT_SOURCES = ['alberto', 'emma', 'chen'];");
    expect(dashboard).toContain('data.filter(item => ASIMUT_SOURCES.includes(item.source))');
    expect(dashboard).toContain('!ASIMUT_SOURCES.includes(row?.source)');
  });

  it('only sends declarative commands and never calls the booking server', () => {
    expect(moz).toContain("const SOURCE = 'mozarteum';");
    expect(moz).toContain("postCommand('moz_franjas'");
    expect(moz).not.toMatch(/moz\.ac\.at|api\/graphql/);
  });

  it('is loaded, precached and switchable between campuses', () => {
    expect(index).toContain('id="aulasCampusSwitch"');
    expect(index).toContain('data-campus="salzburgo"');
    expect(index).toContain('id="mozarteumPanel"');
    expect(index).toContain('<script src="mozarteum-dashboard.js?v=539"></script>');
    expect(worker).toContain('"./mozarteum-dashboard.js?v=539"');
    expect(worker).toContain('"./mozarteum-dashboard.css?v=539"');
  });
});
