/* Progressive piano rewards derived from canonical study minutes; combinedLedger caps the shared goal. */
(function(root,factory) {
  const api=factory(typeof module==='object' && module.exports?require('./german-rewards'):root.GermanRewards,
    typeof module==='object' && module.exports?require('./daily-study-minutes'):root.DailyStudyMinutes);
  if(typeof module==='object' && module.exports)module.exports=api;else root.PianoRewards=api;
})(typeof window!=='undefined'?window:globalThis,function(GermanRewards,DailyStudyMinutes){
  'use strict';
  const FULL_DAY_SECONDS=4*3600;
  const EXCELLENT_DAY_SECONDS=5*3600;
  const ACTIVITY_TYPES=Object.freeze({
    study:Object.freeze({id:'study',label:'Estudio',factor:1}),
    piano_class:Object.freeze({id:'piano_class',label:'Clase piano',factor:.5}),
    chamber:Object.freeze({id:'chamber',label:'Cámara',factor:1/3})
  });
  const policy=(version,curve)=>Object.freeze({version,referenceAmount:150,minimumSeconds:600,curve:Object.freeze(curve.map(Object.freeze))});
  const POLICIES=Object.freeze({
    1:policy(1,[[0,0],[3600,.08],[7200,.20],[10800,.40],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60]]),
    2:policy(2,[[0,0],[1800,.035],[3600,.08],[5400,.13],[7200,.20],[9000,.29],[10800,.40],[12600,.55],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60],[23400,3.75],[25200,5.50]]),
    3:policy(3,[[0,0],[1800,.05],[3600,.11],[5400,.18],[7200,.27],[9000,.38],[10800,.53],[12600,.75],[14400,1.05],[16200,1.43],[18000,1.93],[19800,2.58],[21600,3.38],[23400,4.38],[25200,5.50]]),
    4:policy(4,[[0,0],[1800,.05],[3600,.11],[5400,.18],[7200,.27],[9000,.38],[10800,.53],[12600,.75],[14400,1.05],[16200,1.43],[18000,1.93],[19800,2.58],[21600,3.38],[23400,4.38],[25200,5.50]])
  });
  const CONFIG=POLICIES[4];
  const dayKey=(date=new Date())=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  function normalizeActivityType(value){
    const key=String(value||'study');
    return ACTIVITY_TYPES[key]?key:'study';
  }
  function activityFactor(value){
    if(value && typeof value==='object'){
      const explicit=Number(value.activityFactor);
      if(Number.isFinite(explicit)&&explicit>0&&explicit<=1)return explicit;
      return ACTIVITY_TYPES[normalizeActivityType(value.activityType)].factor;
    }
    if(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1)return value;
    return ACTIVITY_TYPES[normalizeActivityType(value)].factor;
  }
  function equivalentSeconds(session){
    return Math.max(0,Number(session&&session.seconds)||0)*activityFactor(session||'study');
  }
  function runtimeActivityType(){
    try{return normalizeActivityType(typeof globalThis!=='undefined'?globalThis.__PIANO_ACTIVITY_TYPE__:'study');}
    catch(error){return 'study';}
  }
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
  // A projection, never another saved credit: edits/deletions recalculate money
  // and the daily tier from the same deduplicated minutes shown in the app.
  function studyState(db, today=dayKey()){
    const saved=ensure(db), goals=db?.germanStudy?.goals||[];
    if(!DailyStudyMinutes || !Array.isArray(db.sessionPlants) || !Array.isArray(db.sesiones))return saved;
    const ordered=goals.filter(g=>g.id && g.createdAt).slice().sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
    if(!ordered.length)return {sessions:[]};
    const firstDay=dayKey(new Date(ordered[0].createdAt));
    if(!firstDay || firstDay>today)return {sessions:[]};
    const start=new Date(firstDay+'T00:00:00'),end=new Date(today+'T00:00:00');end.setDate(end.getDate()+1);
    const sessions=[];
    const blocks=DailyStudyMinutes.studyBlocks(start,end,db);
    const recorded=saved.sessions.filter(s=>s && s.id && !s.deleted && !s.deletedAt);
    blocks.forEach((block,index)=>{
      const date=block.date;
      // Identity or timestamps join a surviving canonical block to its policy.
      // Never assign deleted class/chamber time to unrelated manual study.
      const previous=recorded.find(s=>block.runId===s.id || String(block.runId || '').startsWith(s.id+'::passage::') || block.id==='run_'+s.id ||
        (block.startedAt && Date.parse(block.startedAt)===Date.parse(s.startedAt)));
      const attributedGoal=previous?.goalId || block.rewardGoalId;
      const goal=attributedGoal ? goals.find(g=>g.id===attributedGoal) : ordered.find(g=>dayKey(new Date(g.createdAt))<=date &&
        (!g.archivedAt || dayKey(new Date(g.archivedAt))>date) && (!g.deletedAt || dayKey(new Date(g.deletedAt))>date));
      if(!goal)return;
      const when=new Date(date+'T23:59:59').toISOString();
      const type=normalizeActivityType(block.activityType || previous?.activityType);
      sessions.push({...previous,id:'study-block:'+(block.id || block.runId || date+':'+index),goalId:goal.id,date,
        startedAt:block.startedAt || when,endedAt:block.endedAt || when,seconds:Math.max(0,block.mins*60),
        activityType:type,activityFactor:activityFactor(block.activityType ? block : previous || type),policyVersion:previous?.policyVersion || block.rewardPolicyVersion || CONFIG.version});
    });
    return {...saved,sessions};
  }
  function streakMultiplier(days){
    const n=Math.max(0,Math.floor(Number(days)||0));
    if(n>=14)return 1.25;
    if(n>=10)return 1.20;
    if(n>=7)return 1.15;
    if(n>=5)return 1.10;
    if(n>=3)return 1.05;
    return 1;
  }
  function excellenceMultiplier(days){
    const n=Math.max(0,Math.floor(Number(days)||0));
    if(n>=14)return 1.50;
    if(n>=10)return 1.40;
    if(n>=7)return 1.30;
    if(n>=5)return 1.20;
    if(n>=4)return 1.16;
    if(n>=3)return 1.12;
    if(n>=2)return 1.08;
    if(n>=1)return 1.05;
    return 1;
  }
  function summarizeDays(sessions){
    const totals={};
    for(const session of sessions||[]){
      if(!session||!session.id||session.deleted)continue;
      const seconds=equivalentSeconds(session);if(!seconds)continue;
      const date=session.date||dayKey(new Date(session.endedAt||session.startedAt));
      totals[date]=(totals[date]||0)+seconds;
    }
    return totals;
  }
  function streakByDay(sessions){
    const totals=summarizeDays(sessions),result={};let streak=0;
    for(const date of Object.keys(totals).sort()){
      const seconds=totals[date];
      if(seconds>=FULL_DAY_SECONDS){
        streak+=1;result[date]={days:streak,multiplier:streakMultiplier(streak),fullDay:true,seconds};
      }else{
        streak=0;result[date]={days:0,multiplier:1,fullDay:false,seconds};
      }
    }
    return result;
  }
  function excellenceByDay(sessions){
    const totals=summarizeDays(sessions),result={};let streak=0;
    for(const date of Object.keys(totals).sort()){
      const seconds=totals[date];
      if(seconds>=EXCELLENT_DAY_SECONDS){
        streak+=1;
        result[date]={days:streak,multiplier:excellenceMultiplier(streak),excellentDay:true,frozen:false,seconds};
      }else if(seconds>=FULL_DAY_SECONDS){
        result[date]={days:streak,multiplier:excellenceMultiplier(streak),excellentDay:false,frozen:true,seconds};
      }else{
        streak=0;
        result[date]={days:0,multiplier:1,excellentDay:false,frozen:false,seconds};
      }
    }
    return result;
  }
  function streakStats(sessions,date=dayKey()){
    const totals=summarizeDays(sessions),map=streakByDay(sessions),studiedDays=Object.keys(totals).filter(day=>day<=date).sort();
    const last=studiedDays.at(-1),info=last?map[last]:null,today=map[date];
    return {current:info?.days||0,multiplier:streakMultiplier(info?.days||0),today:today?.days||0,
      todayMultiplier:today?.multiplier||1,todaySeconds:totals[date]||0,fullDay:!!today?.fullDay};
  }
  function excellenceStats(sessions,date=dayKey()){
    const totals=summarizeDays(sessions),map=excellenceByDay(sessions),studiedDays=Object.keys(totals).filter(day=>day<=date).sort();
    const last=studiedDays.at(-1),info=last?map[last]:null,today=map[date];
    return {current:info?.days||0,multiplier:excellenceMultiplier(info?.days||0),today:today?.days||0,
      todayMultiplier:today?.multiplier||1,todaySeconds:totals[date]||0,excellentDay:!!today?.excellentDay,frozen:!!today?.frozen};
  }
  function record(state,{id,goalId=null,startedAt,endedAt,seconds,policyVersion=CONFIG.version,activityType=null,activityFactor:explicitFactor=null}){
    if(!id||state.sessions.some(session=>session.id===id))return false;
    const duration=Math.max(0,Number(seconds)||0);
    if(duration<CONFIG.minimumSeconds)return false;
    const type=normalizeActivityType(activityType||runtimeActivityType());
    const factor=Number.isFinite(Number(explicitFactor))&&Number(explicitFactor)>0&&Number(explicitFactor)<=1?Number(explicitFactor):ACTIVITY_TYPES[type].factor;
    const end=new Date(endedAt||Date.now());
    state.sessions.push({id,goalId,startedAt:new Date(startedAt||end).toISOString(),endedAt:end.toISOString(),date:dayKey(end),seconds:duration,
      activityType:type,activityFactor:factor,policyVersion:Number(policyVersion)||CONFIG.version});
    return true;
  }
  function ledger(sessions,goals){
    const byGoal=new Map((goals||[]).map(goal=>[goal.id,goal])),used={},result=[];
    const ordered=(sessions||[]).filter(session=>session&&session.id&&!session.deleted).slice()
      .sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.startedAt).localeCompare(String(b.startedAt))||String(a.id).localeCompare(String(b.id)));
    const streaks=streakByDay(ordered),excellence=excellenceByDay(ordered);
    for(const session of ordered){
      const date=session.date||dayKey(new Date(session.endedAt||session.startedAt)),before=used[date]||0;
      const rawSeconds=Math.max(0,Number(session.seconds)||0),seconds=equivalentSeconds(session),after=before+seconds;used[date]=after;
      const type=normalizeActivityType(session.activityType),factor=activityFactor(session);
      const goal=byGoal.get(session.goalId),scale=goal&&GermanRewards?GermanRewards.goalScale(goal.amount):0;
      const rewardPolicy=POLICIES[Number(session.policyVersion)]||POLICIES[1];
      const streakInfo=streaks[date]||{days:0,multiplier:1,fullDay:false};
      const excellenceInfo=excellence[date]||{days:0,multiplier:1,excellentDay:false,frozen:false};
      const fullDayMultiplier=rewardPolicy.version>=3&&streakInfo.fullDay?streakInfo.multiplier:1;
      const excellentMultiplier=rewardPolicy.version>=4&&excellenceInfo.excellentDay?excellenceInfo.multiplier:1;
      const multiplier=fullDayMultiplier*excellentMultiplier;
      const base=baseReward(after,rewardPolicy)-baseReward(before,rewardPolicy);
      const potential=Math.max(0,Math.round(baseReward(after,rewardPolicy)*scale*multiplier*1e6)-Math.round(baseReward(before,rewardPolicy)*scale*multiplier*1e6));
      result.push({id:'piano:'+session.id,date,sessionId:session.id,goalId:session.goalId,source:'piano',
        startedAt:session.startedAt,duration:seconds,rawDuration:rawSeconds,activityType:type,activityFactor:factor,baseReward:base,goalScale:scale,
        streakDays:streakInfo.days,streakMultiplier:fullDayMultiplier,fullDay:streakInfo.fullDay,
        excellenceDays:excellenceInfo.days,excellenceMultiplier:excellentMultiplier,excellentDay:excellenceInfo.excellentDay,excellenceFrozen:excellenceInfo.frozen,
        rewardMultiplier:multiplier,policyVersion:rewardPolicy.version,qualified:true,potentialMicroEuros:potential,microEuros:potential,finalReward:potential/1e6});
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
  function live(state,goals,goalId,currentSeconds,date=dayKey(),germanRows=[],currentPolicyVersion=CONFIG.version,currentActivityType=null){
    const savedSessions=state.sessions||[],basePianoRows=ledger(savedSessions,goals),baseRows=combinedLedger(germanRows,basePianoRows,goals);
    const savedSeconds=savedSessions.filter(session=>session.date===date&&!session.deleted).reduce((sum,session)=>sum+equivalentSeconds(session),0);
    const goal=(goals||[]).find(item=>item.id===goalId),scale=goal&&GermanRewards?GermanRewards.goalScale(goal.amount):0;
    const elapsed=Math.max(0,Number(currentSeconds)||0),rewardPolicy=POLICIES[Number(currentPolicyVersion)]||CONFIG;
    const type=normalizeActivityType(currentActivityType||runtimeActivityType()),factor=ACTIVITY_TYPES[type].factor;
    const liveSession=elapsed>0?{id:'__live__',goalId,startedAt:date+'T23:59:59.999Z',endedAt:date+'T23:59:59.999Z',date,seconds:elapsed,
      activityType:type,activityFactor:factor,policyVersion:rewardPolicy.version}:null;
    const hypotheticalSessions=liveSession?[...savedSessions,liveSession]:savedSessions;
    const hypotheticalPianoRows=ledger(hypotheticalSessions,goals),hypotheticalRows=combinedLedger(germanRows,hypotheticalPianoRows,goals);
    const earned=(rows)=>goal?rows.filter(row=>row.goalId===goalId).reduce((sum,row)=>sum+row.finalReward,0):0;
    const baseGoalEarned=earned(baseRows),hypotheticalGoalEarned=earned(hypotheticalRows);
    const increment=Math.max(0,hypotheticalGoalEarned-baseGoalEarned);
    const today=hypotheticalRows.filter(row=>row.date===date&&row.source==='piano').reduce((sum,row)=>sum+row.finalReward,0);
    const equivalentElapsed=elapsed*factor,totalSeconds=savedSeconds+equivalentElapsed,next=rewardPolicy.curve.find(([seconds])=>seconds>totalSeconds);
    const nextIndex=next?rewardPolicy.curve.indexOf(next):-1,previous=nextIndex>0?rewardPolicy.curve[nextIndex-1]:rewardPolicy.curve.at(-1);
    const streakInfo=streakByDay(hypotheticalSessions)[date]||{days:0,multiplier:1,fullDay:false};
    const excellenceInfo=excellenceByDay(hypotheticalSessions)[date]||{days:0,multiplier:1,excellentDay:false,frozen:false};
    const fullDayMultiplier=rewardPolicy.version>=3&&streakInfo.fullDay?streakInfo.multiplier:1;
    const excellentMultiplier=rewardPolicy.version>=4&&excellenceInfo.excellentDay?excellenceInfo.multiplier:1;
    const liveMultiplier=fullDayMultiplier*excellentMultiplier;
    const hourlyRate=next?((next[1]-previous[1])/(next[0]-previous[0]))*3600*scale*liveMultiplier*factor:0;
    const capSeconds=rewardPolicy.curve.at(-1)[0],capFill=Math.max(0,capSeconds-savedSeconds);
    const capSession={id:'__cap__',goalId,startedAt:date+'T23:59:59.999Z',endedAt:date+'T23:59:59.999Z',date,seconds:capFill,
      activityType:'study',activityFactor:1,policyVersion:rewardPolicy.version};
    const capSessions=[...savedSessions,capSession];
    const capInfo=streakByDay(capSessions)[date]||{days:0,multiplier:1,fullDay:false};
    const capExcellence=excellenceByDay(capSessions)[date]||{days:0,multiplier:1,excellentDay:false,frozen:false};
    const capFullMultiplier=rewardPolicy.version>=3&&capInfo.fullDay?capInfo.multiplier:1;
    const capExcellentMultiplier=rewardPolicy.version>=4&&capExcellence.excellentDay?capExcellence.multiplier:1;
    const cap=baseReward(capSeconds,rewardPolicy)*scale*capFullMultiplier*capExcellentMultiplier;
    return {today,increment,cap,seconds:totalSeconds,rawCurrentSeconds:elapsed,equivalentCurrentSeconds:equivalentElapsed,currentActivityType:type,currentActivityFactor:factor,
      nextSeconds:next?next[0]:null,nextBase:next?next[1]:rewardPolicy.curve.at(-1)[1],tierStartSeconds:next?previous[0]:rewardPolicy.curve.at(-1)[0],hourlyRate,policyVersion:rewardPolicy.version,
      streakDays:streakInfo.days,streakMultiplier:fullDayMultiplier,fullDay:streakInfo.fullDay,
      excellenceDays:excellenceInfo.days,excellenceMultiplier:excellentMultiplier,excellentDay:excellenceInfo.excellentDay,excellenceFrozen:excellenceInfo.frozen,
      rewardMultiplier:liveMultiplier,goalRemaining:goal?Math.max(0,goal.amount-hypotheticalGoalEarned):0};
  }
  return {CONFIG,POLICIES,ACTIVITY_TYPES,FULL_DAY_SECONDS,EXCELLENT_DAY_SECONDS,dayKey,normalizeActivityType,activityFactor,equivalentSeconds,ensure,studyState,activeGoal,baseReward,streakMultiplier,excellenceMultiplier,summarizeDays,streakByDay,excellenceByDay,streakStats,excellenceStats,record,ledger,combinedLedger,live};
});
