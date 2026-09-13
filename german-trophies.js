/* Read-only collection: the existing goal/session evidence owns every achievement. */
(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./german-rewards') : root.GermanRewards);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GermanTrophies = api;
})(typeof window !== 'undefined' ? window : globalThis, function(R) {
  'use strict';
  function collection(state) {
    const goals=state.goals || [], sessions=state.sessions || [], ledger=R.ledger(sessions,goals);
    const active=goals.filter(g=>!g.archivedAt).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))[0];
    return goals.map(goal=> {
      const progress=R.goalProgress(goal,ledger,sessions);
      // Segment days preserve the calendar on which study actually happened, including midnight splits.
      const days=[...new Set(sessions.filter(s=>s.goalId===goal.id).flatMap(s=>(s.segments || []).filter(x=>x.seconds>0).map(x=>x.day)))].sort();
      const status=progress.complete?'complete':goal.archivedAt?'archived':goal.id!==active?.id?'queued':days.length?'active':'new';
      return {goal,...progress,startedOn:days[0] || null,studyDays:days.length,status,
        percent:progress.complete?100:Math.min(99.9,Math.max(0,progress.amount/goal.amount*100))};
    }).sort((a,b)=>Number(b.complete)-Number(a.complete) ||
      (b.completedOn || b.goal.createdAt).localeCompare(a.completedOn || a.goal.createdAt) || a.goal.id.localeCompare(b.goal.id));
  }
  function artwork(id,complete,instance='card') {
    // IDs and palettes are derived, never interpolate a user-supplied goal name into SVG.
    let hash=0;for(const c of String(id))hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
    const variant=hash%3, key='gt-'+hash+'-'+String(instance).replace(/[^a-z0-9-]/gi,'');
    const palettes=[['#fff6d4','#f4cb6e','#b57525','#684117'],['#fff0dd','#e9ad79','#b56845','#623b32'],['#fff8db','#e4d3a1','#a78c47','#5b4c30']];
    const [light,mid,dark,shade]=complete?palettes[variant]:['#f4fbff','#becfdb','#7f96ac','#43586c'];
    const body=variant===0?
      `<path d="M81 72H47v16c0 29 17 43 42 44M159 72h34v16c0 29-17 43-42 44" fill="none" stroke="url(#${key}-metal)" stroke-width="12"/>
       <path d="M74 55h92l-7 59c-3 24-19 40-39 40s-36-16-39-40z" fill="url(#${key}-metal)" stroke="${light}" stroke-width="1.2"/>
       <ellipse cx="120" cy="56" rx="46" ry="8" fill="${dark}"/><ellipse cx="120" cy="54" rx="46" ry="6" fill="url(#${key}-rim)"/>
       <path d="M112 150h16v26l15 9H97l15-9z" fill="url(#${key}-metal)"/>
       <path d="m120 81 5 10 12 2-9 8 2 12-10-6-10 6 2-12-9-8 12-2z" fill="${shade}" opacity=".65"/>
       <path d="M86 69l4 43c2 15 9 25 18 30" fill="none" stroke="${light}" stroke-width="4" opacity=".6"/>`:
      variant===1?
      `<path d="m120 36 50 52-17 59-33 32-33-32-17-59z" fill="url(#${key}-metal)" stroke="${light}"/>
       <path d="m120 36-13 56 13 87 17-87z" fill="${light}" opacity=".55"/>
       <path d="m70 88 37 4 13 87-33-32z" fill="${dark}" opacity=".5"/>
       <path d="m120 36 17 56 33-4-17 59-33 32" fill="${shade}" opacity=".25"/>
       <path d="m70 88 37 4 30 0 33-4M120 36l-13 56 13 87 17-87z" fill="none" stroke="${light}" opacity=".7"/>
       <path d="M113 174h14v11h-14z" fill="url(#${key}-metal)"/>`:
      `<path d="M107 138h26v40l13 7H94l13-7z" fill="url(#${key}-metal)"/>
       <circle cx="120" cy="94" r="53" fill="url(#${key}-metal)" stroke="${light}"/>
       <circle cx="120" cy="94" r="43" fill="url(#${key}-rim)" stroke="${light}" stroke-width="2"/>
       <path d="m120 59 10 22 24 3-18 17 5 24-21-12-21 12 5-24-18-17 24-3z" fill="url(#${key}-metal)" stroke="${light}"/>
       <path d="M78 108q10 21 28 26M162 108q-10 21-28 26" fill="none" stroke="${dark}" stroke-width="3"/>`;
    return `<div class="german-trophy-art ${complete?'is-earned':'is-pending'}" aria-hidden="true"><svg viewBox="0 0 240 250" focusable="false">
      <defs><linearGradient id="${key}-metal" x1="0" y1="0" x2="1" y2=".3"><stop stop-color="${dark}"/><stop offset=".22" stop-color="${light}"/><stop offset=".43" stop-color="${mid}"/><stop offset=".68" stop-color="${dark}"/><stop offset=".85" stop-color="${mid}"/><stop offset="1" stop-color="${shade}"/></linearGradient>
      <linearGradient id="${key}-rim" x2="0" y2="1"><stop stop-color="${shade}"/><stop offset="1" stop-color="${mid}"/></linearGradient>
      <linearGradient id="${key}-base" x2="0" y2="1"><stop stop-color="#45556d"/><stop offset="1" stop-color="#172236"/></linearGradient></defs>
      <ellipse cx="120" cy="229" rx="78" ry="12" fill="#101a2a" opacity=".16"/>
      <g class="german-trophy-object">${body}
      <path d="M76 191h88v26l-44 10-44-10z" fill="url(#${key}-base)"/><path d="m76 191 44-10 44 10-44 10z" fill="#64738a"/>
      <path d="M90 187h60v7l-30 7-30-7z" fill="url(#${key}-metal)"/>
      <path d="m106 204 28-1v9l-28 1z" fill="${mid}"/><path d="m111 207 18-.6M111 210l12-.4" stroke="${shade}" stroke-width="1"/>
      ${complete?`<path d="m182 41 2 7 7 2-7 2-2 7-2-7-7-2 7-2zM54 139l1 5 5 1-5 1-1 5-1-5-5-1 5-1z" fill="${light}"/>`:''}</g>
      </svg></div>`;
  }
  return {collection,artwork};
});
