/* Progressive piano rewards. Finished runs are canonical; combinedLedger caps the shared goal. */
(function(root,factory) {
  const api=factory(typeof module==='object' && module.exports?require('./german-rewards'):root.GermanRewards);
  if(typeof module==='object' && module.exports)module.exports=api;else root.PianoRewards=api;
})(typeof window!=='undefined'?window:globalThis,function(GermanRewards){
  'use strict';
  const CONFIG=Object.freeze({version:1,referenceAmount:150,minimumSeconds:600,
    curve:Object.freeze([[0,0],[3600,.08],[7200,.20],[10800,.40],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60]].map(Object.freeze))});
  const dayKey=(date=new Date())=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  function ensure(db){
    db.pianoRewards||={version:1,sessions:[]};
    if(!Array.isArray(db.pianoRewards.sessions))db.pianoRewards.sessions=[];
    return db.pianoRewards;
  }
  function activeGoal(db){
    return (db?.germanStudy?.goals||[]).filter(goal=>!goal.archivedAt)
      .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)))[0]||null;
  }
  function baseReward(seconds){
    const s=Math.max(0,Number(seconds)||0),points=CONFIG.curve;
    for(let i=1;i<points.length;i++){
      const [x,y]=points[i],[px,py]=points[i-1];
      if(s<=x)return py+(y-py)*(s-px)/(x-px);
    }
    return points.at(-1)[1];
  }
  function record(state,{id,goalId=null,startedAt,endedAt,seconds}){
    if(!id||state.sessions.some(session=>session.id===id))return false;
    const duration=Math.max(0,Number(seconds)||0);
    if(duration<CONFIG.minimumSeconds)return false;
    const end=new Date(endedAt||Date.now());
    state.sessions.push({id,goalId,startedAt:new Date(startedAt||end).toISOString(),endedAt:end.toISOString(),date:dayKey(end),seconds:duration});
    return true;
  }
  function ledger(sessions,goals){
    const byGoal=new Map((goals||[]).map(goal=>[goal.id,goal])),used={},result=[];
    const ordered=(sessions||[]).filter(session=>session&&session.id&&!session.deleted).slice()
      .sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.startedAt).localeCompare(String(b.startedAt))||String(a.id).localeCompare(String(b.id)));
    for(const session of ordered){
      const date=session.date||dayKey(new Date(session.endedAt||session.startedAt)),before=used[date]||0;
      const seconds=Math.max(0,Number(session.seconds)||0),after=before+seconds;used[date]=after;
      const goal=byGoal.get(session.goalId),scale=goal&&GermanRewards?GermanRewards.goalScale(goal.amount):0;
      const base=baseReward(after)-baseReward(before);
      const potential=Math.max(0,Math.round(baseReward(after)*scale*1e6)-Math.round(baseReward(before)*scale*1e6));
      result.push({id:'piano:'+session.id,date,sessionId:session.id,goalId:session.goalId,source:'piano',
        startedAt:session.startedAt,duration:seconds,baseReward:base,goalScale:scale,streakMultiplier:1,
        policyVersion:CONFIG.version,qualified:true,potentialMicroEuros:potential,microEuros:potential,finalReward:potential/1e6});
    }
    return result;
  }
  function combinedLedger(germanRows,pianoRows,goals){
    const byGoal=new Map((goals||[]).map(goal=>[goal.id,goal])),balances={};
    return [...(germanRows||[]).map(row=>({...row,source:row.source||'german'})),...(pianoRows||[])].sort((a,b)=>
      String(a.date).localeCompare(String(b.date))||String(a.startedAt||'').localeCompare(String(b.startedAt||''))||String(a.id).localeCompare(String(b.id))
    ).map(row=>{
      const goal=byGoal.get(row.goalId);
      const raw=row.qualified===false?0:Math.max(0,Number.isFinite(row.potentialMicroEuros)?row.potentialMicroEuros:(row.microEuros||0));
      const remaining=goal?Math.max(0,Math.round(goal.amount*1e6)-(balances[goal.id]||0)):0;
      const microEuros=Math.min(remaining,raw);
      if(goal)balances[goal.id]=(balances[goal.id]||0)+microEuros;
      return {...row,microEuros,finalReward:microEuros/1e6};
    });
  }
  function live(state,goals,goalId,currentSeconds,date=dayKey(),germanRows=[]){
    const pianoRows=ledger(state.sessions,goals),rows=combinedLedger(germanRows,pianoRows,goals);
    const todayRows=rows.filter(row=>row.date===date&&row.source==='piano');
    const savedSeconds=(state.sessions||[]).filter(session=>session.date===date).reduce((sum,session)=>sum+Math.max(0,Number(session.seconds)||0),0);
    const goal=(goals||[]).find(item=>item.id===goalId),scale=goal&&GermanRewards?GermanRewards.goalScale(goal.amount):0;
    const elapsed=Math.max(0,Number(currentSeconds)||0);
    const rawIncrement=Math.max(0,Math.round(baseReward(savedSeconds+elapsed)*scale*1e6)-Math.round(baseReward(savedSeconds)*scale*1e6))/1e6;
    const goalEarned=goal?rows.filter(row=>row.goalId===goalId).reduce((sum,row)=>sum+row.finalReward,0):0;
    const increment=goal?Math.min(Math.max(0,goal.amount-goalEarned),rawIncrement):0;
    const today=todayRows.reduce((sum,row)=>sum+row.finalReward,0)+increment;
    const cap=baseReward(CONFIG.curve.at(-1)[0])*scale;
    const next=CONFIG.curve.find(([seconds])=>seconds>savedSeconds+elapsed);
    return {today,increment,cap,seconds:savedSeconds+elapsed,nextSeconds:next?next[0]:null,nextBase:next?next[1]:CONFIG.curve.at(-1)[1],goalRemaining:goal?Math.max(0,goal.amount-goalEarned-increment):0};
  }
  return {CONFIG,dayKey,ensure,activeGoal,baseReward,record,ledger,combinedLedger,live};
});
