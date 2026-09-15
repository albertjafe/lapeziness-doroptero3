/* Progressive piano rewards. Finished runs are canonical; combinedLedger caps the shared goal. */
(function(root,factory) {
  const api=factory(typeof module==='object' && module.exports?require('./german-rewards'):root.GermanRewards);
  if(typeof module==='object' && module.exports)module.exports=api;else root.PianoRewards=api;
})(typeof window!=='undefined'?window:globalThis,function(GermanRewards){
  'use strict';
  const policy=(version,curve)=>Object.freeze({version,referenceAmount:150,minimumSeconds:600,curve:Object.freeze(curve.map(Object.freeze))});
  const POLICIES=Object.freeze({
    1:policy(1,[[0,0],[3600,.08],[7200,.20],[10800,.40],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60]]),
    2:policy(2,[[0,0],[1800,.035],[3600,.08],[5400,.13],[7200,.20],[9000,.29],[10800,.40],[12600,.55],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60],[23400,3.75],[25200,5.50]])
  });
  const CONFIG=POLICIES[2];
  const dayKey=(date=new Date())=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  function ensure(db){
    db.pianoRewards||={version:1,sessions:[]};
    if(!Array.isArray(db.pianoRewards.sessions))db.pianoRewards.sessions=[];
    return db.pianoRewards;
  }
  function activeGoal(db){
    return (db?.germanStudy?.goals||[]).filter(goal=>!goal.archivedAt&&!goal.deletedAt)
      .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)))[0]||null;
  }
  function baseReward(seconds,rewardPolicy=CONFIG){
    const s=Math.max(0,Number(seconds)||0),points=rewardPolicy.curve;
    for(let i=1;i<points.length;i++){
      const [x,y]=points[i],[px,py]=points[i-1];
      if(s<=x)return py+(y-py)*(s-px)/(x-px);
    }
    return points.at(-1)[1];
  }
  function record(state,{id,goalId=null,startedAt,endedAt,seconds,policyVersion=CONFIG.version}){
    if(!id||state.sessions.some(session=>session.id===id))return false;
    const duration=Math.max(0,Number(seconds)||0);
    if(duration<CONFIG.minimumSeconds)return false;
    const end=new Date(endedAt||Date.now());
    state.sessions.push({id,goalId,startedAt:new Date(startedAt||end).toISOString(),endedAt:end.toISOString(),date:dayKey(end),seconds:duration,policyVersion:Number(policyVersion)||CONFIG.version});
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
      const rewardPolicy=POLICIES[Number(session.policyVersion)]||POLICIES[1];
      const base=baseReward(after,rewardPolicy)-baseReward(before,rewardPolicy);
      const potential=Math.max(0,Math.round(baseReward(after,rewardPolicy)*scale*1e6)-Math.round(baseReward(before,rewardPolicy)*scale*1e6));
      result.push({id:'piano:'+session.id,date,sessionId:session.id,goalId:session.goalId,source:'piano',
        startedAt:session.startedAt,duration:seconds,baseReward:base,goalScale:scale,streakMultiplier:1,
        policyVersion:rewardPolicy.version,qualified:true,potentialMicroEuros:potential,microEuros:potential,finalReward:potential/1e6});
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
  function live(state,goals,goalId,currentSeconds,date=dayKey(),germanRows=[],currentPolicyVersion=CONFIG.version){
    const pianoRows=ledger(state.sessions,goals),rows=combinedLedger(germanRows,pianoRows,goals);
    const todayRows=rows.filter(row=>row.date===date&&row.source==='piano');
    const savedSeconds=(state.sessions||[]).filter(session=>session.date===date).reduce((sum,session)=>sum+Math.max(0,Number(session.seconds)||0),0);
    const goal=(goals||[]).find(item=>item.id===goalId),scale=goal&&GermanRewards?GermanRewards.goalScale(goal.amount):0;
    const elapsed=Math.max(0,Number(currentSeconds)||0),rewardPolicy=POLICIES[Number(currentPolicyVersion)]||CONFIG;
    const rawIncrement=Math.max(0,Math.round(baseReward(savedSeconds+elapsed,rewardPolicy)*scale*1e6)-Math.round(baseReward(savedSeconds,rewardPolicy)*scale*1e6))/1e6;
    const goalEarned=goal?rows.filter(row=>row.goalId===goalId).reduce((sum,row)=>sum+row.finalReward,0):0;
    const increment=goal?Math.min(Math.max(0,goal.amount-goalEarned),rawIncrement):0;
    const today=todayRows.reduce((sum,row)=>sum+row.finalReward,0)+increment;
    const cap=baseReward(rewardPolicy.curve.at(-1)[0],rewardPolicy)*scale;
    const totalSeconds=savedSeconds+elapsed,next=rewardPolicy.curve.find(([seconds])=>seconds>totalSeconds);
    const nextIndex=next?rewardPolicy.curve.indexOf(next):-1,previous=nextIndex>0?rewardPolicy.curve[nextIndex-1]:rewardPolicy.curve.at(-1);
    const hourlyRate=next?((next[1]-previous[1])/(next[0]-previous[0]))*3600*scale:0;
    return {today,increment,cap,seconds:totalSeconds,nextSeconds:next?next[0]:null,nextBase:next?next[1]:rewardPolicy.curve.at(-1)[1],
      tierStartSeconds:next?previous[0]:rewardPolicy.curve.at(-1)[0],hourlyRate,policyVersion:rewardPolicy.version,
      goalRemaining:goal?Math.max(0,goal.amount-goalEarned-increment):0};
  }
  return {CONFIG,POLICIES,dayKey,ensure,activeGoal,baseReward,record,ledger,combinedLedger,live};
});
