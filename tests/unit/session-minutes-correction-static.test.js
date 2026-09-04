import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync('session-minutes-correction.js', 'utf8');
const tracker = fs.readFileSync('activity-self-tracker.js', 'utf8');

describe('session minute correction bridge', () => {
  it('links the finish modal to the persisted stopwatch block', () => {
    expect(source).toContain('window.finishStudyBlock');
    expect(source).toContain('lastFinished');
    expect(source).toContain('activePlantId');
  });

  it('writes corrected minutes with audit timestamps', () => {
    expect(source).toContain('plant.originalMins');
    expect(source).toContain('plant.mins = minutes');
    expect(source).toContain('plant.correctedAt = now');
    expect(source).toContain("source: 'hecho-modal'");
  });

  it('keeps a bounded minute correction history', () => {
    expect(source).toContain('plant.minuteCorrections.push(plant.minuteCorrection)');
    expect(source).toContain('plant.minuteCorrections.slice(-10)');
  });

  it('makes edits from the Sessions by hours editor authoritative', () => {
    expect(source).toContain('window.saveTimedStudyEdit');
    expect(source).toContain("source: 'sessions-by-hours'");
    expect(source).toContain('plant.updatedAt = now');
    expect(source).toContain('plant.historicalEdit');
  });

  it('minutes are visible without opening advanced details', () => {
    expect(source).toContain("field.classList.remove('hecho-advanced-only')");
  });

  it('the companion is loaded automatically', () => {
    expect(tracker).toContain('sessionMinutesCorrectionScript');
    expect(tracker).toContain('session-minutes-correction.js?v=342');
  });
});
