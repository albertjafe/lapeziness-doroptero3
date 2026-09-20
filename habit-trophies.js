/* Read-only trophy projection for the stopwatch habit objectives. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HabitTrophies = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  const DAY_MS = 86400000;
  const GRADED_REWARD_START_DAY='2026-09-20';
  const LEGACY_REWARD_POLICY=Object.freeze({version:1,points:3,minimumDays:21});
  const REWARD_POLICY = Object.freeze({version:2,points:3,minimumDays:21,failurePoints:Object.freeze([3,1.5,.75,0])});

  function dayNumber(key) {
    const parts = String(key || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return NaN;
    return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY_MS);
  }

  function dayKey(value) {
    const date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) return '';
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function keyAt(startKey, offset) {
    const parts = String(startKey || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return '';
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + offset));
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }

  function logStatus(log) {
    return typeof log === 'string' ? log : (log && log.status || '');
  }

  function itemFor(habit, now) {
    if (!habit || !habit.id || !habit.startDate || habit.deleted) return null;
    const duration = Math.max(1, Math.min(365, Math.round(Number(habit.durationDays) || 21)));
    const today = dayKey(now);
    const index = dayNumber(today) - dayNumber(habit.startDate);
    if (!Number.isFinite(index)) return null;
    const complete = Boolean(habit.completedAt) || index >= duration;
    const evaluatedDays = Math.min(duration, Math.max(0, index));
    let success = 0;
    let failure = 0;
    for (let offset = 0; offset < evaluatedDays; offset += 1) {
      const status = logStatus((habit.logs || {})[keyAt(habit.startDate, offset)]);
      const passed = habit.mode === 'avoid' ? status !== 'failed' : status === 'done';
      if (passed) success += 1;
      else failure += 1;
    }
    if (!complete && index >= 0 && index < duration) {
      const currentStatus = logStatus((habit.logs || {})[today]);
      if (habit.mode === 'do' && currentStatus === 'done') success += 1;
      if (habit.mode === 'avoid' && currentStatus === 'failed') failure += 1;
    }
    const completionKey = habit.completedAt ? dayKey(habit.completedAt) : (complete ? keyAt(habit.startDate, duration - 1) : null);
    const elapsed = Math.min(duration, Math.max(0, index + 1));
    return {
      habit,
      complete,
      status: complete ? 'complete' : (index < 0 ? 'planned' : 'active'),
      startedOn: habit.startDate,
      completedOn: completionKey,
      createdOn: habit.createdAt ? (dayKey(habit.createdAt) || habit.startDate) : habit.startDate,
      duration,
      success,
      failure,
      elapsed,
      progress: complete ? 100 : Math.round(elapsed / duration * 100),
      compliance: Math.round(success / duration * 100),
    };
  }

  function collection(habits, now) {
    return (Array.isArray(habits) ? habits : [])
      .map(habit => itemFor(habit, now))
      .filter(Boolean)
      .sort((a, b) => Number(b.complete) - Number(a.complete) ||
        String(b.completedOn || b.startedOn).localeCompare(String(a.completedOn || a.startedOn)) ||
        String(a.habit.id).localeCompare(String(b.habit.id)));
  }

  function artwork(id, complete, instance) {
    let hash = 0;
    for (const character of String(id || 'habit')) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
    const variant = hash % 3;
    const key = 'ht-' + hash + '-' + String(instance || 'card').replace(/[^a-z0-9-]/gi, '');
    const palettes = [
      ['#fff4c7', '#e8bd55', '#a86616', '#5e3910'],
      ['#fff0dc', '#dda36f', '#a65535', '#5b342c'],
      ['#fff8d9', '#d8c587', '#92762e', '#514225'],
    ];
    const colors = complete ? palettes[variant] : ['#f5f8fb', '#c8d2dc', '#8797a8', '#465668'];
    const [light, mid, dark, shade] = colors;
    const body = variant === 0
      ? `<path d="M81 72H47v16c0 29 17 43 42 44M159 72h34v16c0 29-17 43-42 44" fill="none" stroke="url(#${key}-metal)" stroke-width="12"/><path d="M74 55h92l-7 59c-3 24-19 40-39 40s-36-16-39-40z" fill="url(#${key}-metal)" stroke="${light}"/><ellipse cx="120" cy="55" rx="46" ry="7" fill="url(#${key}-rim)"/><path d="M112 150h16v26l15 9H97l15-9z" fill="url(#${key}-metal)"/><path d="m120 81 5 10 12 2-9 8 2 12-10-6-10 6 2-12-9-8 12-2z" fill="${shade}" opacity=".62"/>`
      : variant === 1
        ? `<path d="m120 36 50 52-17 59-33 32-33-32-17-59z" fill="url(#${key}-metal)" stroke="${light}"/><path d="m120 36-13 56 13 87 17-87z" fill="${light}" opacity=".5"/><path d="m70 88 37 4 13 87-33-32z" fill="${dark}" opacity=".48"/><path d="M113 174h14v11h-14z" fill="url(#${key}-metal)"/>`
        : `<path d="M107 138h26v40l13 7H94l13-7z" fill="url(#${key}-metal)"/><circle cx="120" cy="94" r="53" fill="url(#${key}-metal)" stroke="${light}"/><circle cx="120" cy="94" r="43" fill="url(#${key}-rim)" stroke="${light}" stroke-width="2"/><path d="m120 59 10 22 24 3-18 17 5 24-21-12-21 12 5-24-18-17 24-3z" fill="url(#${key}-metal)" stroke="${light}"/>`;
    return `<div class="habit-trophy-art ${complete ? 'is-earned' : 'is-pending'}" aria-hidden="true"><svg viewBox="0 0 240 250" focusable="false"><defs><linearGradient id="${key}-metal" x1="0" y1="0" x2="1" y2=".3"><stop stop-color="${dark}"/><stop offset=".22" stop-color="${light}"/><stop offset=".46" stop-color="${mid}"/><stop offset=".72" stop-color="${dark}"/><stop offset="1" stop-color="${shade}"/></linearGradient><linearGradient id="${key}-rim" x2="0" y2="1"><stop stop-color="${shade}"/><stop offset="1" stop-color="${mid}"/></linearGradient><linearGradient id="${key}-base" x2="0" y2="1"><stop stop-color="#506078"/><stop offset="1" stop-color="#172338"/></linearGradient></defs><ellipse cx="120" cy="229" rx="78" ry="12" fill="#081426" opacity=".22"/><g class="habit-trophy-object">${body}<path d="M76 191h88v26l-44 10-44-10z" fill="url(#${key}-base)"/><path d="m76 191 44-10 44 10-44 10z" fill="#66758b"/><path d="M90 187h60v7l-30 7-30-7z" fill="url(#${key}-metal)"/>${complete ? `<path d="m182 41 2 7 7 2-7 2-2 7-2-7-7-2 7-2zM54 139l1 5 5 1-5 1-1 5-1-5-5-1 5-1z" fill="${light}"/>` : ''}</g></svg></div>`;
  }

  function createRewardPolicy(habit, now=new Date()) {
    const duration=Number(habit?.durationDays),start=habit?.startDate;
    if(!habit || !dayKey(now) || !['do','avoid'].includes(habit.mode) || !habit.successCriteria?.trim() ||
      !Number.isInteger(duration) || duration<REWARD_POLICY.minimumDays || duration>365 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(start||'') || keyAt(start,0)!==start || start<dayKey(now))return null;
    return {...REWARD_POLICY,agreedAt:new Date(now).toISOString(),startDate:start,durationDays:duration,
      mode:habit.mode,successCriteria:habit.successCriteria.trim()};
  }

  function rewardPointsForFailures(failures,points=REWARD_POLICY.failurePoints){
    const count=Math.max(0,Math.floor(Number(failures)||0));
    const schedule=Array.isArray(points)&&points.length?points:REWARD_POLICY.failurePoints;
    return Math.max(0,Number(schedule[Math.min(count,schedule.length-1)])||0);
  }

  function rewardStatus(habit, now=new Date()) {
    const rule=habit?.effortReward,item=itemFor(habit,now);
    const legacy=rule?.version===LEGACY_REWARD_POLICY.version && rule?.points===LEGACY_REWARD_POLICY.points &&
      rule?.minimumDays===LEGACY_REWARD_POLICY.minimumDays;
    const graduated=rule?.version===REWARD_POLICY.version && rule?.points===REWARD_POLICY.points &&
      rule?.minimumDays===REWARD_POLICY.minimumDays && Array.isArray(rule.failurePoints) &&
      rule.failurePoints.length===REWARD_POLICY.failurePoints.length &&
      rule.failurePoints.every((value,index)=>Number(value)===REWARD_POLICY.failurePoints[index]);
    if(!rule || !item || !['do','avoid'].includes(rule.mode) || (!legacy&&!graduated) || !rule.successCriteria?.trim() ||
      !Number.isFinite(Date.parse(rule.agreedAt)) || dayKey(rule.agreedAt)>rule.startDate ||
      rule.startDate!==habit.startDate || rule.durationDays!==habit.durationDays || rule.mode!==habit.mode ||
      rule.successCriteria!==habit.successCriteria || rule.durationDays<21 || rule.durationDays>365 ||
      !Number.isInteger(rule.durationDays) || keyAt(rule.startDate,0)!==rule.startDate)return {status:'none',points:0,item};

    // The challenge calendar never restarts after a failure. From the transition
    // onward, failures reduce the prize still in play instead of destroying the
    // whole incentive after the first slip.
    const elapsed=dayNumber(dayKey(now))-dayNumber(rule.startDate);
    const earnedOn=keyAt(rule.startDate,rule.durationDays);
    const usesGraduatedReward=graduated || earnedOn>=GRADED_REWARD_START_DAY;
    const potentialPoints=usesGraduatedReward?rewardPointsForFailures(item.failure):item.failure===0?rule.points:0;
    const complete=elapsed>=rule.durationDays;
    const earned=complete&&potentialPoints>0;
    return {status:earned?'earned':potentialPoints<=0?'failed':'active',points:earned?potentialPoints:0,
      potentialPoints,maxPoints:rule.points,graded:usesGraduatedReward,item,earnedOn};
  }

  return { REWARD_POLICY, LEGACY_REWARD_POLICY, GRADED_REWARD_START_DAY, createRewardPolicy, rewardPointsForFailures, rewardStatus, collection, itemFor, artwork, dayKey, keyAt };
});
