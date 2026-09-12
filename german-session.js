(function(root,factory) {
  const api = factory(typeof module==='object' && module.exports ? require('./german-rewards') : root.GermanRewards);
  if (typeof module==='object' && module.exports) module.exports=api; else root.GermanSession=api;
})(typeof window!=='undefined'?window:globalThis,function(R) {
  'use strict';
  const MAX_TICK_GAP_MS=5000, IDLE_MS=5*60*1000;
  function ensure(db) {
    db.germanStudy ||= { version:1, materials:[], reviews:[], sessions:[], goals:[], ledger:[] };
    for (const key of ['materials','reviews','sessions','goals','ledger']) db.germanStudy[key] ||= [];
    return db.germanStudy;
  }
  function create({id,deviceId,goalId=null,queue=[],now=Date.now()}) {
    return {id,deviceId,goalId,startedAt:new Date(now).toISOString(),status:'paused',segments:[],
      queue:queue.map((item,i)=>({...item,contentId:item.id,id:id+':item:'+i})),index:0};
  }
  // Called only for observed foreground intervals. Calendar constructors handle DST/midnight.
  function addInterval(session,from,to) {
    if (session.endedAt || !Number.isFinite(from) || !Number.isFinite(to) || to<=from) return;
    while (from<to) {
      const date=new Date(from), day=R.dayKey(date);
      const midnight=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime();
      const end=Math.min(to,midnight);
      let segment=session.segments.find(s=>s.day===day);
      if (!segment) { segment={id:day,day,seconds:0}; session.segments.push(segment); }
      segment.seconds+=(end-from)/1000;
      from=end;
    }
  }
  function tick(session,{now,lastTick,lastInteraction,visible=true}) {
    if (session.status!=='running' || session.endedAt) return false;
    const gap=now-lastTick;
    if (!visible || gap<0 || gap>MAX_TICK_GAP_MS || now-lastInteraction>IDLE_MS) { session.status='paused'; return false; }
    addInterval(session,lastTick,now); return true;
  }
  function finish(state,id,now=Date.now()) {
    const session=state.sessions.find(s=>s.id===id);
    if (!session) throw new Error('Sesión no encontrada');
    if (!session.endedAt) {session.status='finished';session.endedAt=new Date(now).toISOString();}
    state.ledger=R.ledger(state.sessions,state.goals);
    return session;
  }
  return {MAX_TICK_GAP_MS,IDLE_MS,ensure,create,addInterval,tick,finish};
});
