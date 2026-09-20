/* Pure, versioned reward policy. Amounts in integer micro-euros in the ledger. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GermanRewards = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  const PROGRAM_START_DAY = '2026-09-20';
  const IMPLANT_WINDOW_DAYS = 21;
  const IMPLANT_REQUIRED_DAYS = 15;
  const CONSISTENCY_BLOCK_DAYS = 7;
  const CONSISTENCY_BONUS_POINTS = 1;

  const makePolicy = (version, curve) => Object.freeze({
    version,
    minimumSeconds: 900,
    referenceAmount: 150,
    curve: Object.freeze(curve.map(Object.freeze)),
    scaleExponent: .45,
    minScale: .5,
    maxScale: 15,
    streakBlock: 4,
    streakStep: .05,
    maxBonus: .25
  });

  const POLICIES = Object.freeze({
    1: makePolicy(1, [[0,0],[900,1],[1800,1.25],[2700,1.55],[3600,2]]),
    2: makePolicy(2, [[0,0],[900,.5],[1800,.8],[2700,1.1],[3600,1.4]])
  });
  // CONFIG remains the generous implantation policy so old callers that only
  // need the minimum/cap keep the historical contract. policyForDay() selects
  // the actual earning curve from 20-09-2026 onward.
  const CONFIG = POLICIES[1];
  const STABLE_CONFIG = POLICIES[2];

  const dayKey = (date = new Date()) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');

  function shiftDay(day, offset) {
    const [y,m,d] = String(day || '').split('-').map(Number);
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
    for (const session of sessions || []) for (const segment of session.segments || [])
      result[segment.day] = (result[segment.day] || 0) + Math.max(0,segment.seconds || 0);
    return result;
  }

  function qualifyingDays(sessions, throughDay = dayKey()) {
    const totals = summarizeDays(sessions);
    return Object.keys(totals)
      .filter(day => day >= PROGRAM_START_DAY && day <= throughDay && totals[day] >= CONFIG.minimumSeconds)
      .sort();
  }

  function implantationStatus(sessions, today = dayKey()) {
    const eligible = qualifyingDays(sessions,today);
    let implantedOn = null;
    for (const day of eligible) {
      const start = shiftDay(day,-(IMPLANT_WINDOW_DAYS-1));
      let count = 0;
      for (const candidate of eligible) if (candidate >= start && candidate <= day) count++;
      if (count >= IMPLANT_REQUIRED_DAYS) { implantedOn = day; break; }
    }
    const stableFrom = implantedOn ? shiftDay(implantedOn,1) : null;
    const windowStart = today >= PROGRAM_START_DAY
      ? (shiftDay(today,-(IMPLANT_WINDOW_DAYS-1)) < PROGRAM_START_DAY ? PROGRAM_START_DAY : shiftDay(today,-(IMPLANT_WINDOW_DAYS-1)))
      : PROGRAM_START_DAY;
    const windowCount = today < PROGRAM_START_DAY ? 0 : eligible.filter(day => day >= windowStart && day <= today).length;
    return {
      programStartDay: PROGRAM_START_DAY,
      windowDays: IMPLANT_WINDOW_DAYS,
      requiredDays: IMPLANT_REQUIRED_DAYS,
      windowStart,
      windowCount,
      implanted: Boolean(implantedOn),
      implantedOn,
      stableFrom,
      establishedToday: implantedOn === today,
      phase: stableFrom && today >= stableFrom ? 'stable' : 'implantation',
      remainingDays: implantedOn ? 0 : Math.max(0,IMPLANT_REQUIRED_DAYS-windowCount)
    };
  }

  function normalizeLegacyPolicy(policy) {
    if (policy && Array.isArray(policy.curve) && Number(policy.minimumSeconds) > 0) return policy;
    return CONFIG;
  }

  function policyForDay(sessions, day = dayKey(), legacyPolicy = null) {
    if (day < PROGRAM_START_DAY) return normalizeLegacyPolicy(legacyPolicy);
    const status = implantationStatus(sessions,day);
    return status.stableFrom && day >= status.stableFrom ? STABLE_CONFIG : CONFIG;
  }

  function consistencyBonuses(sessions, throughDay = dayKey()) {
    const days = qualifyingDays(sessions,throughDay), result = [];
    let streak = 0, previous = null;
    for (const day of days) {
      streak = previous && shiftDay(previous,1) === day ? streak+1 : 1;
      if (streak >= CONSISTENCY_BLOCK_DAYS && streak % CONSISTENCY_BLOCK_DAYS === 0)
        result.push({date:day,streakDays:streak,points:CONSISTENCY_BONUS_POINTS});
      previous = day;
    }
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
    sessions = Array.isArray(sessions) ? sessions : [];
    goals = Array.isArray(goals) ? goals : [];
    const totals = summarizeDays(sessions), qualified = new Set(Object.keys(totals).filter(d => totals[d]>=CONFIG.minimumSeconds));
    const used = {}, balances = {}, result = [], byGoal = new Map(goals.map(g => [g.id,g]));

    const sessionEntries = sessions.flatMap(s => (s.segments || []).map(seg => ({
      kind:'session', s, seg, date:seg.day, startedAt:s.startedAt || (seg.day+'T00:00:00.000Z'), id:s.id+':'+seg.day
    }))).sort((a,b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

    const lastGoalByDay = {};
    for (const entry of sessionEntries) if (entry.s.goalId) lastGoalByDay[entry.date] = entry.s.goalId;

    const bonusEntries = consistencyBonuses(sessions).map(item => ({
      kind:'consistency', date:item.date, startedAt:item.date+'T23:59:59.999Z',
      id:'german:consistency:'+item.date+':'+item.streakDays,
      goalId:lastGoalByDay[item.date] || null, ...item
    }));

    const events = [...sessionEntries,...bonusEntries].sort((a,b) =>
      a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

    for (const event of events) {
      if (event.kind === 'consistency') {
        const goal = byGoal.get(event.goalId);
        const policy = policyForDay(sessions,event.date,goal?.rewardPolicy);
        const scale = goal ? goalScale(goal.amount,policy) : 0;
        const potential = Math.max(0,Math.round(event.points*scale*1e6));
        const remaining = goal ? Math.max(0,Math.round(goal.amount*1e6)-(balances[goal.id] || 0)) : 0;
        const microEuros = goal ? Math.min(remaining,potential) : 0;
        if (goal) balances[goal.id] = (balances[goal.id] || 0)+microEuros;
        result.push({
          id:event.id,date:event.date,sessionId:null,goalId:event.goalId,source:'german',
          startedAt:event.startedAt,duration:0,baseReward:0,goalScale:scale,streakMultiplier:1,
          sharedEffortVersion:1,effortMicroPoints:Math.round(event.points*1e6),effortPoints:event.points,
          policyVersion:policy.version,qualified:true,potentialMicroEuros:potential,microEuros,finalReward:microEuros/1e6,
          consistencyBonus:true,consistencyStreakDays:event.streakDays,title:'Constancia de alemán · '+event.streakDays+' días'
        });
        continue;
      }

      const {s,seg} = event, before = used[seg.day] || 0, after = before + Math.max(0,Number(seg.seconds)||0);
      used[seg.day] = after;
      const goal = byGoal.get(s.goalId);
      const policy = policyForDay(sessions,seg.day,goal?.rewardPolicy);
      const base = baseReward(after,policy)-baseReward(before,policy);
      const scale = goal ? goalScale(goal.amount,policy) : 0;
      const multiplier = streakMultiplier(streakAt(qualified,seg.day),policy);
      // Difference of rounded cumulative amounts avoids per-checkpoint rounding drift.
      const potential = Math.round(baseReward(after,policy)*scale*multiplier*1e6)-Math.round(baseReward(before,policy)*scale*multiplier*1e6);
      // Effort is the same reward before converting it to the price-dependent euro scale.
      const effortMicroPoints = Math.max(0,Math.round(baseReward(after,policy)*multiplier*1e6)-Math.round(baseReward(before,policy)*multiplier*1e6));
      const remaining = goal ? Math.max(0,Math.round(goal.amount*1e6)-(balances[goal.id] || 0)) : 0;
      const microEuros = qualified.has(seg.day) ? Math.min(remaining,potential) : 0;
      if (goal) balances[goal.id] = (balances[goal.id] || 0)+microEuros;
      result.push({ id: s.id+':'+seg.day, date: seg.day, sessionId: s.id, goalId: s.goalId, source:'german', startedAt:s.startedAt,
        duration: seg.seconds, baseReward: base, goalScale: scale, streakMultiplier: multiplier,
        sharedEffortVersion:Number(s.sharedEffortVersion)||0, effortMicroPoints:qualified.has(seg.day)?effortMicroPoints:0,
        effortPoints:qualified.has(seg.day)?effortMicroPoints/1e6:0,
        policyVersion: policy.version, qualified: qualified.has(seg.day), potentialMicroEuros:potential, microEuros, finalReward: microEuros/1e6 });
    }
    return result;
  }

  function goalProgress(goal, entries, sessions) {
    const rows = entries.filter(e => e.goalId === goal.id);
    const microEuros = rows.reduce((sum,e) => sum+e.microEuros,0);
    return { amount: microEuros/1e6, complete: microEuros >= Math.round(goal.amount*1e6),
      completedOn: microEuros >= Math.round(goal.amount*1e6) ? rows.filter(e=>e.microEuros>0).at(-1)?.date : null,
      seconds: rows.reduce((sum,row)=>sum+Math.max(0,Number(row.duration)||0),0) };
  }

  return {
    CONFIG, STABLE_CONFIG, POLICIES, PROGRAM_START_DAY, IMPLANT_WINDOW_DAYS, IMPLANT_REQUIRED_DAYS,
    CONSISTENCY_BLOCK_DAYS, CONSISTENCY_BONUS_POINTS, dayKey, shiftDay, baseReward, goalScale,
    streakMultiplier, streakAt, summarizeDays, qualifyingDays, implantationStatus, policyForDay,
    consistencyBonuses, streakStats, ledger, goalProgress
  };
});
