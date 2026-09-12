/* Pure, versioned reward policy. Amounts in integer micro-euros in the ledger. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GermanRewards = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const CONFIG = Object.freeze({ version: 1, minimumSeconds: 900, referenceAmount: 150,
    curve: Object.freeze([[0, 0], [900, 1], [1800, 1.25], [2700, 1.55], [3600, 2]].map(Object.freeze)),
    scaleExponent: .45, minScale: .5, maxScale: 15, streakBlock: 4, streakStep: .05, maxBonus: .25 });
  const dayKey = (date = new Date()) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  function shiftDay(day, offset) {
    const [y,m,d] = day.split('-').map(Number);
    return dayKey(new Date(y,m-1,d+offset,12));
  }
  function baseReward(seconds, policy = CONFIG) {
    const s = Math.max(0, Number(seconds) || 0), points = policy.curve;
    for (let i=1; i<points.length; i++) {
      const [x,y] = points[i], [px,py] = points[i-1];
      if (s <= x) return py + (y-py)*(s-px)/(x-px);
    }
    return points[points.length-1][1];
  }
  const goalScale = (amount, p = CONFIG) => Math.min(p.maxScale, Math.max(p.minScale, (amount/p.referenceAmount)**p.scaleExponent));
  const streakMultiplier = (days, p = CONFIG) => 1 + Math.min(p.maxBonus, Math.floor(Math.max(0,days)/p.streakBlock)*p.streakStep);
  function streakAt(days, day) {
    let n=0;
    while (days.has(day)) { n++; day = shiftDay(day,-1); }
    return n;
  }
  function summarizeDays(sessions) {
    const result = {};
    for (const session of sessions) for (const segment of session.segments || [])
      result[segment.day] = (result[segment.day] || 0) + Math.max(0,segment.seconds || 0);
    return result;
  }
  function streakStats(sessions, today = dayKey()) {
    const totals = summarizeDays(sessions);
    const days = new Set(Object.keys(totals).filter(d => totals[d] >= CONFIG.minimumSeconds));
    const current = streakAt(days, days.has(today) ? today : shiftDay(today,-1));
    return { current, best: Math.max(0,...[...days].map(d => streakAt(days,d))),
      today: streakAt(days,today), prospective: days.has(today) ? current : current+1,
      nextBonusIn: streakMultiplier(current)>=1+CONFIG.maxBonus ? 0 : CONFIG.streakBlock-current%CONFIG.streakBlock };
  }
  // Rebuilt from canonical session evidence, including after merging offline devices.
  // Daily time/cap is shared across sessions AND goals. Ordering is independent of merge order.
  function ledger(sessions, goals) {
    const totals = summarizeDays(sessions), qualified = new Set(Object.keys(totals).filter(d => totals[d]>=CONFIG.minimumSeconds));
    const used = {}, balances = {}, result = [], byGoal = new Map(goals.map(g => [g.id,g]));
    const entries = sessions.flatMap(s => (s.segments || []).map(seg => ({s,seg})));
    entries.sort((a,b) => a.seg.day.localeCompare(b.seg.day) || a.s.startedAt.localeCompare(b.s.startedAt) || a.s.id.localeCompare(b.s.id));
    for (const {s,seg} of entries) {
      const before = used[seg.day] || 0, after = before + seg.seconds;
      used[seg.day] = after;
      const goal = byGoal.get(s.goalId), policy = goal?.rewardPolicy || CONFIG;
      const base = baseReward(after,policy)-baseReward(before,policy);
      const scale = goal ? goalScale(goal.amount,policy) : 0;
      const multiplier = streakMultiplier(streakAt(qualified,seg.day),policy);
      // Difference of rounded cumulative amounts avoids per-checkpoint rounding drift.
      const potential = Math.round(baseReward(after,policy)*scale*multiplier*1e6)-Math.round(baseReward(before,policy)*scale*multiplier*1e6);
      const remaining = goal ? Math.max(0,Math.round(goal.amount*1e6)-(balances[goal.id] || 0)) : 0;
      const microEuros = qualified.has(seg.day) ? Math.min(remaining,potential) : 0;
      if (goal) balances[goal.id] = (balances[goal.id] || 0)+microEuros;
      result.push({ id: s.id+':'+seg.day, date: seg.day, sessionId: s.id, goalId: s.goalId,
        duration: seg.seconds, baseReward: base, goalScale: scale, streakMultiplier: multiplier,
        policyVersion: policy.version, qualified: qualified.has(seg.day), microEuros, finalReward: microEuros/1e6 });
    }
    return result;
  }
  function goalProgress(goal, entries, sessions) {
    const rows = entries.filter(e => e.goalId === goal.id);
    const microEuros = rows.reduce((sum,e) => sum+e.microEuros,0);
    return { amount: microEuros/1e6, complete: microEuros >= Math.round(goal.amount*1e6),
      completedOn: microEuros >= Math.round(goal.amount*1e6) ? rows.filter(e=>e.microEuros>0).at(-1)?.date : null,
      seconds: sessions.filter(s=>s.goalId===goal.id).reduce((sum,s)=>sum+(s.segments || []).reduce((n,x)=>n+x.seconds,0),0) };
  }
  return { CONFIG, dayKey, shiftDay, baseReward, goalScale, streakMultiplier, streakAt, summarizeDays, streakStats, ledger, goalProgress };
});
