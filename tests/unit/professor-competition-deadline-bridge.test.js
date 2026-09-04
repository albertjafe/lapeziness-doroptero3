import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadBridge(baseReport) {
  const source = fs.readFileSync('professor-competition-deadline-bridge.js', 'utf8');
  const context = {
    console,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    ProfessorCore: {
      buildReport: () => structuredClone(baseReport),
      compactContext: () => 'BASE',
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'professor-competition-deadline-bridge.js' });
  return context.ProfessorCore;
}

function unit(movId, solidity = 50) {
  return {
    key: 'waldstein::' + movId,
    obraId: 'waldstein',
    movId,
    label: 'Waldstein · ' + movId,
    solidity,
    recoveryHours: { low: 3, high: 6 },
    recent: { d7: movId === 'III' ? 35 : 350 },
    linkedEvents: [],
    nextEvent: null,
    learningVelocity: { pointsPerHour: movId === 'III' ? 2 : 8 },
    priority: { score: movId === 'III' ? 45 : 30, band: 'media', reasons: [] },
  };
}

const base = {
  asOf: '2026-09-03T08:00:00+02:00',
  events: [],
  units: [unit('I', 85), unit('III', 50)],
  priorities: [],
  warnings: [],
};

describe('Professor competition deadline bridge', () => {
  it('keeps an administrative application deadline separate from the recording target',()=>{
    const core=loadBridge(base);
    const report=core.buildReport({competitionPlans:[{id:'admin',name:'Audición',status:'confirmado',deadline:'2026-10-10',deadlineKind:'application_deadline',requiresVideo:false,
      recordingTarget:'2026-10-01',videoWorkIds:['waldstein'],videoMovements:{waldstein:['III']},repertoireWorkIds:[]}]});
    const deadline=report.events.find(e=>e.role==='application_deadline'),recording=report.events.find(e=>e.role==='recording_target');
    expect(deadline.day).toBe('2026-10-10');expect(deadline.workIds).toEqual([]);
    expect(recording.day).toBe('2026-10-01');expect(recording.workIds).toEqual(['waldstein']);
    expect(report.units.find(u=>u.movId==='I').nextEvent).toBeNull();
    expect(report.units.find(u=>u.movId==='III').nextEvent.role).toBe('recording_target');
  });
  it('targets only explicitly selected movements for a video deadline', () => {
    const core = loadBridge(base);
    const report = core.buildReport({
      competitionPlans: [{
        id: 'leeds', name: 'Leeds', status: 'standby', deadline: '2026-10-31', competitionStart: '2027-09-08',
        videoWorkIds: ['waldstein'], videoMovements: { waldstein: ['III'] },
        repertoireWorkIds: [], professorMovements: {},
      }],
    });
    const first = report.units.find(row => row.movId === 'I');
    const third = report.units.find(row => row.movId === 'III');
    expect(first.nextEvent).toBeNull();
    expect(third.nextEvent.name).toContain('Deadline');
    expect(third.nextEvent.daysAway).toBeGreaterThan(0);
    expect(third.pace.requiredDailyMinutes).toBeGreaterThan(0);
  });

  it('does not invent musical urgency before video repertoire is assigned', () => {
    const core = loadBridge(base);
    const report = core.buildReport({
      competitionPlans: [{
        id: 'montreal', name: 'Montréal', status: 'standby', deadline: '2026-10-31',
        competitionStart: '2027-04-24', videoWorkIds: [], repertoireWorkIds: [],
      }],
    });
    expect(report.units.every(row => row.nextEvent == null)).toBe(true);
    expect(report.warnings.some(text => text.includes('repertorio de vídeo pendiente'))).toBe(true);
  });

  it('plans competitions beyond the old 180-day horizon', () => {
    const core = loadBridge(base);
    const report = core.buildReport({
      competitionPlans: [{
        id: 'leeds', name: 'Leeds', status: 'standby', competitionStart: '2027-09-08',
        repertoireWorkIds: ['waldstein'], professorMovements: { waldstein: ['III'] }, videoWorkIds: [],
      }],
    });
    const third = report.units.find(row => row.movId === 'III');
    expect(third.nextEvent).not.toBeNull();
    expect(third.nextEvent.daysAway).toBeGreaterThan(180);
    expect(report.longHorizon.days).toBe(730);
  });

  it('enriches an existing Google deadline instead of duplicating it', () => {
    const baseWithGoogle = structuredClone(base);
    baseWithGoogle.events = [{
      key: 'google:event-1', source: 'google', id: 'event-1', name: 'DEADLINE vídeo - Leeds',
      day: '2026-10-31', daysAway: 58, workIds: [], repertoireLinked: false,
    }];
    const core = loadBridge(baseWithGoogle);
    const report = core.buildReport({
      competitionPlans: [{
        id: 'leeds', name: 'Leeds', status: 'standby', deadline: '2026-10-31', googleDeadlineEventId: 'event-1',
        videoWorkIds: ['waldstein'], videoMovements: { waldstein: ['III'] }, repertoireWorkIds: [],
      }],
    });
    expect(report.events.filter(row => row.day === '2026-10-31')).toHaveLength(1);
    expect(report.events[0].competitionPlanId).toBe('leeds');
    expect(report.events[0].repertoireLinked).toBe(true);
  });
});
