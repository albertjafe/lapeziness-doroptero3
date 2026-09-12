(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GermanSRS = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const GRADES = ['again','hard','good','easy'];
  function schedule(previous = {}, grade, now = Date.now()) {
    if (!GRADES.includes(grade)) throw new Error('Valoración desconocida');
    let ease = previous.ease || 2.5, interval = previous.interval || 0;
    if (grade==='again') { interval=1/1440; ease=Math.max(1.3,ease-.2); }
    if (grade==='hard') { interval=Math.max(1,interval*1.2); ease=Math.max(1.3,ease-.15); }
    if (grade==='good') interval=interval<1 ? 1 : Math.max(1,Math.round(interval*ease));
    if (grade==='easy') { interval=interval<1 ? 4 : Math.round(interval*ease*1.3); ease+=.15; }
    return { reviews: (previous.reviews || 0)+1, lastReview: new Date(now).toISOString(),
      nextReview: new Date(now+interval*86400000).toISOString(), interval, ease, result: grade };
  }
  function cardState(cardId, reviews) {
    return reviews.filter(r=>r.cardId===cardId).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))
      .reduce((state,r)=>schedule(state,r.grade,Date.parse(r.at)),{});
  }
  const normalize = value => String(value).normalize('NFC').trim().toLocaleLowerCase('de').replace(/\s+/g,' ').replace(/[.!?]+$/,'');
  function correct(exercise, answer) {
    if (exercise.type==='free_write') return null;
    return [exercise.answer,...(exercise.acceptedAnswers || [])].filter(x=>typeof x==='string').some(x=>normalize(x)===normalize(answer));
  }
  function queue(state, { mode='mixed', materialId='', now=Date.now(), newLimit=10, limit=40 } = {}) {
    const materials = (state.materials || []).filter(m=>!materialId || m.id===materialId);
    const cards = materials.flatMap(m=>m.cards.map(c=>({...c,materialId:m.id})));
    const exercises = materials.flatMap(m=>m.exercises.map(e=>({...e,materialId:m.id})));
    const reviewed = cards.map(c=>({c,s:cardState(c.id,state.reviews || [])}));
    const due = reviewed.filter(x=>x.s.nextReview && Date.parse(x.s.nextReview)<=now).sort((a,b)=>a.s.nextReview.localeCompare(b.s.nextReview));
    const fresh = reviewed.filter(x=>!x.s.reviews).slice(0,newLimit);
    const pending = exercises.filter(e=>!(state.reviews || []).some(r=>r.exerciseId===e.id && r.result==='correct'));
    const cardItem = x=>({kind:'card',id:x.c.id,materialId:x.c.materialId});
    const exerciseItem = e=>({kind:'exercise',id:e.id,materialId:e.materialId});
    let items = [...(mode==='exercises'?[]:[...due,...fresh].map(cardItem)),...(mode==='cards'?[]:pending.map(exerciseItem))];
    if (!items.length) items = [...(mode==='exercises'?[]:reviewed.filter(x=>x.s.reviews).map(cardItem)),...(mode==='cards'?[]:exercises.map(exerciseItem))];
    return items.slice(0,limit);
  }
  return { GRADES, schedule, cardState, normalize, correct, queue };
});
