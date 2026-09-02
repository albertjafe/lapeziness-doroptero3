const fs = require('fs');
const path = require('path');

describe('session minute correction bridge', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'session-minutes-correction.js'), 'utf8');
  const tracker = fs.readFileSync(path.join(process.cwd(), 'activity-self-tracker.js'), 'utf8');

  test('links the finish modal to the persisted stopwatch block', () => {
    expect(source).toContain('window.finishStudyBlock');
    expect(source).toContain('lastFinished');
    expect(source).toContain('activePlantId');
  });

  test('writes corrected minutes with audit timestamps', () => {
    expect(source).toContain('plant.originalMins');
    expect(source).toContain('plant.mins = minutes');
    expect(source).toContain('plant.correctedAt = now');
    expect(source).toContain("source: 'hecho-modal'");
  });

  test('minutes are visible without opening advanced details', () => {
    expect(source).toContain("field.classList.remove('hecho-advanced-only')");
  });

  test('the companion is loaded automatically', () => {
    expect(tracker).toContain('sessionMinutesCorrectionScript');
    expect(tracker).toContain('session-minutes-correction.js?v=1');
  });
});
