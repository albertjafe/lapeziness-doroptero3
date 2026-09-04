import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EventSyncCore = require('../../event-sync-core.js');
const DataCore = require('../../data-core.js');

describe('calendar event reconciliation', () => {
  it('restores cloud events omitted by a newer local snapshot', () => {
    const cloud = {
      _localRevision: 8,
      _savedAt: '2026-09-04T08:40:00Z',
      eventos: [
        { id: 'existing', nombre: 'Existente' },
        { id: 'exam-camera', nombre: 'Examen de cámara HfMT', updatedAt: '2026-09-04T08:37:00Z' },
        { id: 'exam-piano', nombre: 'Examen de repertorio de piano HfMT', updatedAt: '2026-09-04T08:37:00Z' },
      ],
    };
    const local = {
      _localRevision: 9,
      _savedAt: '2026-09-04T09:00:00Z',
      eventos: [{ id: 'existing', nombre: 'Existente' }],
    };

    const merged = EventSyncCore.mergeCalendarEvents(local, cloud);
    expect(merged.eventos.map(event => event.id)).toEqual([
      'existing',
      'exam-camera',
      'exam-piano',
    ]);
  });

  it('keeps explicit tombstone deletion authoritative across devices', () => {
    const cloud = {
      eventos: [
        { id: 'keep', nombre: 'Conservar' },
        { id: 'delete-me', nombre: 'Eliminar' },
      ],
    };
    const local = {
      eventos: [{ id: 'keep', nombre: 'Conservar' }],
      planningEventTombstones: ['delete-me'],
    };

    const merged = EventSyncCore.mergeCalendarEvents(local, cloud);
    expect(merged.eventos.map(event => event.id)).toEqual(['keep']);
    expect(merged.planningEventTombstones).toContain('delete-me');
  });

  it('uses the most recent mutation for the same event id', () => {
    const oldCopy = {
      eventos: [{ id: 'exam', nombre: 'Nombre viejo', updatedAt: '2026-09-04T08:00:00Z' }],
    };
    const newCopy = {
      eventos: [{ id: 'exam', nombre: 'Nombre nuevo', updatedAt: '2026-09-04T09:00:00Z' }],
    };

    expect(EventSyncCore.mergeCalendarEvents(oldCopy, newCopy).eventos[0].nombre).toBe('Nombre nuevo');
    expect(EventSyncCore.mergeCalendarEvents(newCopy, oldCopy).eventos[0].nombre).toBe('Nombre nuevo');
  });

  it('patches DataCore so normal study reconciliation also merges events', () => {
    const sandbox = { mergeStudyHistory: DataCore.mergeStudyHistory };
    expect(EventSyncCore.install(sandbox)).toBe(true);

    const merged = sandbox.mergeStudyHistory(
      { eventos: [{ id: 'local-only', nombre: 'Local' }], sessionPlants: [], forestPlants: [], sesiones: [] },
      { eventos: [{ id: 'cloud-only', nombre: 'Cloud' }], sessionPlants: [], forestPlants: [], sesiones: [] }
    );

    expect(merged.eventos.map(event => event.id).sort()).toEqual(['cloud-only', 'local-only']);
  });
});
