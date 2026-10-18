import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const source = fs.readFileSync('effort-incentives-ui.js', 'utf8');
const require = createRequire(import.meta.url);
const Sync = require('../../document-sync-core.js');
const KEY = 'study_secret_bonus_seen_v1';
const reward = (id = 'bonus:process:recorded-pass:2026-10-18', date = '2026-10-18') =>
  ({ id, date, progress: 'process', process: 'recorded-pass', title: 'Pase grabado', effortMicroPoints: 250000 });

function harness({ data = {}, rows = [], storage = new Map(), quota = false } = {}) {
  const nodes = new Map(), shown = [], timers = [], listeners = new Map();
  const document = {
    visibilityState: 'visible',
    body: { appendChild: node => { nodes.set(node.id, node); shown.push(node); } },
    getElementById: id => nodes.get(id),
    createElement: () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() { nodes.delete(this.id); } }),
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  const save = vi.fn();
  const state = { rows, day: '2026-10-18' };
  const root = {
    document, db: data, saveDataSoon: save,
    PianoRewards: { walletSnapshot: () => ({ bonusRows: state.rows }), activeGoal: () => null,
      rowEffortPoints: row => row.effortMicroPoints / 1e6, dayKey: () => state.day },
    HabitTrophies: {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => {
      if (quota) throw new Error('QuotaExceededError'); storage.set(key, value);
    } },
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  vm.runInNewContext(source, { window: root, db: data, requestAnimationFrame: fn => fn(),
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {}, setInterval() {} });
  return { data, state, shown, save, storage, check: options => root.StudyIncentives.checkSecretRewards(options),
    prime: () => timers.find(t => t.delay === 300).fn(), emit: name => listeners.get(name)?.({}) };
}

describe('reward notices remain separate from reward credits', () => {
  it('quietly primes all loaded rewards, including when the browser already remembers other IDs', () => {
    const row = reward();
    const h = harness({ rows: [row], storage: new Map([[KEY, JSON.stringify(['bonus:older'])]]) });
    h.prime();
    expect(h.shown).toHaveLength(0);
    expect(h.data.rewardNoticeSeen[row.id]).toBeTruthy();
    expect(h.save).toHaveBeenCalledOnce();
  });

  it('does not announce yesterday’s rewards when delayed history arrives', () => {
    const h = harness(); h.prime();
    const row = reward('bonus:chest:old-block', '2026-10-17'); h.state.rows = [row]; h.check();
    expect(h.shown).toHaveLength(0);
    expect(h.data.rewardNoticeSeen[row.id]).toBeTruthy();
  });

  it('announces a new reward today once and leaves the credit evidence unchanged', () => {
    const h = harness(); h.prime(); const row = reward(), original = structuredClone(row);
    h.state.rows = [row]; h.check(); h.check();
    expect(h.shown).toHaveLength(1);
    expect(row).toEqual(original);
    expect(h.data.rewardNoticeSeen[row.id]).toBeTruthy();
    expect(h.save).toHaveBeenCalledOnce();
    h.state.day = '2026-10-19'; h.check();
    expect(h.shown).toHaveLength(1);
  });

  it('honours a receipt arriving from another device', () => {
    const h = harness(); h.prime(); const row = reward();
    h.data.rewardNoticeSeen = { [row.id]: '2026-10-18T08:00:00Z' };
    h.state.rows = [row]; h.check();
    expect(h.shown).toHaveLength(0);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('checks receipts written by another tab after this tab initialized', () => {
    const storage = new Map(), a = harness({ storage }), b = harness({ storage }); a.prime(); b.prime();
    a.state.rows = [reward()]; a.check();
    b.state.rows = [reward()]; b.check();
    expect(a.shown).toHaveLength(1); expect(b.shown).toHaveLength(0);
  });

  it('keeps the receipt in the common durable document when the local cache is full', () => {
    const h = harness({ quota: true }); h.prime(); const row = reward(); h.state.rows = [row]; h.check();
    expect(h.shown).toHaveLength(1);
    expect(h.save).toHaveBeenCalledOnce();
    const reopened = harness({ data: structuredClone(h.data), rows: [row], quota: true });
    reopened.prime(); reopened.check();
    expect(reopened.shown).toHaveLength(0);
  });

  it('treats the first cloud hydration as history, then celebrates new local rewards', () => {
    const h = harness(); h.prime(); h.state.rows = [reward()]; h.emit('study-cloud-hydrated'); h.check();
    expect(h.shown).toHaveLength(0);
    h.state.rows.push(reward('bonus:process:deep-session:2026-10-18')); h.check();
    expect(h.shown).toHaveLength(1);
  });

  it('merges independent receipts through the existing document protocol without dropping unknown fields', () => {
    const left = { rewardNoticeSeen: { 'bonus:a': '2026-10-18T08:00:00Z' }, future: { retained: 7 } };
    const right = { rewardNoticeSeen: { 'bonus:b': '2026-10-18T09:00:00Z' } };
    const merged = Sync.mergeRemote(left, right);
    expect(merged.rewardNoticeSeen).toEqual({ ...left.rewardNoticeSeen, ...right.rewardNoticeSeen });
    expect(merged.future).toEqual({ retained: 7 });
  });
});
