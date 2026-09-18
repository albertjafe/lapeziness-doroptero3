/* Progressive piano rewards derived from canonical study minutes.
   v5 separates effort from its euro projection so several goals can coexist. */
(function(root,factory) {
  const api=factory(typeof module==='object' && module.exports?require('./german-rewards'):root.GermanRewards,
    typeof module==='object' && module.exports?require('./daily-study-minutes'):root.DailyStudyMinutes,
    typeof module==='object' && module.exports?require('./habit-trophies'):root.HabitTrophies);
  if(typeof module==='object' && module.exports)module.exports=api;
  else {root.PianoRewards=api;api.installBrowser?.(root);}
})(typeof window!=='undefined'?window:globalThis,function(GermanRewards,DailyStudyMinutes,HabitTrophies){
  'use strict';
  const FULL_DAY_SECONDS=4*3600;
  const EXCELLENT_DAY_SECONDS=5*3600;
  const SHARED_EFFORT_POLICY_VERSION=5;
  const ACTIVITY_TYPES=Object.freeze({
    study:Object.freeze({id:'study',label:'Estudio',factor:1}),
    piano_class:Object.freeze({id:'piano_class',label:'Clase piano',factor:.5}),
    chamber:Object.freeze({id:'chamber',label:'Cámara',factor:1/3})
  });
  const policy=(version,curve)=>Object.freeze({version,referenceAmount:150,minimumSeconds:600,curve:Object.freeze(curve.map(Object.freeze))});
  const CURVE_V4=[[0,0],[1800,.05],[3600,.11],[5400,.18],[7200,.27],[9000,.38],[10800,.53],[12600,.75],[14400,1.05],[16200,1.43],[18000,1.93],[19800,2.58],[21600,3.38],[23400,4.38],[25200,5.50]];
  const POLICIES=Object.freeze({
    1:policy(1,[[0,0],[3600,.08],[7200,.20],[10800,.40],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60]]),
    2:policy(2,[[0,0],[1800,.035],[3600,.08],[5400,.13],[7200,.20],[9000,.29],[10800,.40],[12600,.55],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60],[23400,3.75],[25200,5.50]]),
    3:policy(3,CURVE_V4),
    4:policy(4,CURVE_V4),
    5:policy(5,CURVE_V4)
  });
  const CONFIG=POLICIES[5];
  const recoveredWallets=new WeakSet();
  const dayKey=(date=new Date())=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  function appDb(){
    try{if(typeof db!=='undefined'&&db)return db;}catch(error){}
    try{if(typeof globalThis!=='undefined'&&globalThis.db)return globalThis.db;}catch(error){}
    return null;
  }
  function appCrono(){
    try{if(typeof crono!=='undefined'&&crono)return crono;}catch(error){}
    try{if(typeof globalThis!=='undefined'&&globalThis.crono)return globalThis.crono;}catch(error){}
    return null;
  }
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
  function availableGoals(db){
    return (db?.germanStudy?.goals||[]).filter(goal=>goal&&goal.id&&!goal.archivedAt&&!goal.deletedAt)
      .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
  }
  function goalScale(goalOrAmount){
    const amount=typeof goalOrAmount==='object'?Number(goalOrAmount?.amount):Number(goalOrAmount);
    return Number.isFinite(amount)&&amount>0&&GermanRewards?GermanRewards.goalScale(amount):0;
  }
  function goalCostPoints(goal){
    const scale=goalScale(goal);return scale>0?Math.max(0,Number(goal?.amount)||0)/scale:Infinity;
  }
  function ensureEffortWallet(db){
    if(!db)return {version:1,createdAt:new Date(0).toISOString(),seedGoalIds:[],seedCostPoints:{},displayGoalId:null,redemptions:[]};
    db.germanStudy||={version:1,materials:[],reviews:[],sessions:[],goals:[],ledger:[]};
    const st=db.germanStudy;
    if(!Array.isArray(st.goals))st.goals=[];
    const active=availableGoals(db);
    if(!st.effortWallet || Number(st.effortWallet.version)!==1){
      const seedGoalIds=active.map(g=>g.id),seedCostPoints={};
      active.forEach(goal=>{seedCostPoints[goal.id]=goalCostPoints(goal);});
      st.effortWallet={version:1,createdAt:new Date().toISOString(),seedGoalIds,seedCostPoints,displayGoalId:active[0]?.id||null,redemptions:[]};
    }
    const wallet=st.effortWallet;
    if(!Array.isArray(wallet.seedGoalIds))wallet.seedGoalIds=[];
    if(!wallet.seedCostPoints||typeof wallet.seedCostPoints!=='object')wallet.seedCostPoints={};
    // A wallet can be initialized before the document's goals finish loading.
    // Recover only goals that were open when this wallet was created; goals
    // added later must never turn older practice into another opening credit.
    const walletStart=Date.parse(wallet.createdAt);
    if(Number.isFinite(walletStart))st.goals.forEach(goal=>{
      if(!goal)return;
      const created=Date.parse(goal.createdAt);
      if(!goal.id||!Number.isFinite(created)||created>walletStart)return;
      if((goal.archivedAt&&Date.parse(goal.archivedAt)<=walletStart)||(goal.deletedAt&&Date.parse(goal.deletedAt)<=walletStart))return;
      if(!wallet.seedGoalIds.includes(goal.id)){wallet.seedGoalIds.push(goal.id);recoveredWallets.add(db);}
    });
    wallet.seedGoalIds.forEach(id=>{
      if(Number.isFinite(Number(wallet.seedCostPoints[id])))return;
      const goal=st.goals.find(g=>g.id===id);if(goal)wallet.seedCostPoints[id]=goalCostPoints(goal);
    });
    if(!Array.isArray(wallet.redemptions))wallet.redemptions=[];
    if(!wallet.createdAt)wallet.createdAt=new Date().toISOString();
    if(!active.some(g=>g.id===wallet.displayGoalId))wallet.displayGoalId=active[0]?.id||null;
    return wallet;
  }
  function activeGoal(db){
    const active=availableGoals(db);if(!active.length)return null;
    const wallet=ensureEffortWallet(db);
    return active.find(goal=>goal.id===wallet.displayGoalId)||active[0]||null;
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
    const saved=ensure(db), goals=db?.germanStudy?.goals||[],wallet=ensureEffortWallet(db);
    const project=sessions=>({...saved,sessions,effortWallet:wallet,bonusRows:bonusRows(db,sessions,today)});
    if(!DailyStudyMinutes || !Array.isArray(db.sessionPlants) || !Array.isArray(db.sesiones))return project(saved.sessions);
    const ordered=goals.filter(g=>g.id && g.createdAt).slice().sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
    if(!ordered.length)return project([]);
    const firstDay=dayKey(new Date(ordered[0].createdAt));
    if(!firstDay || firstDay>today)return project([]);
    const start=new Date(firstDay+'T00:00:00'),end=new Date(today+'T00:00:00');end.setDate(end.getDate()+1);
    const sessions=[];
    const blocks=DailyStudyMinutes.studyBlocks(start,end,db);
    const recorded=saved.sessions.filter(s=>s && s.id && !s.deleted && !s.deletedAt);
    const walletStart=Date.parse(wallet.createdAt)||Date.now();
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
      const rawMins=Number.isFinite(Number(block.rawMins))?Math.max(0,Number(block.rawMins)):Math.max(0,Number(block.mins)||0);
      const blockMs=Date.parse(block.startedAt||block.endedAt||when);
      const fallbackPolicy=Number.isFinite(blockMs)&&blockMs>=walletStart?CONFIG.version:4;
      sessions.push({...previous,id:'study-block:'+(block.id || block.runId || date+':'+index),goalId:goal.id,date,
        startedAt:block.startedAt || when,endedAt:block.endedAt || when,seconds:rawMins*60,
        activityType:type,activityFactor:activityFactor(block.activityType ? block : previous || type),policyVersion:previous?.policyVersion || block.rewardPolicyVersion || fallbackPolicy});
    });
    return project(sessions);
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
        streak=0;result[date]={days:0,multiplier:1,excellentDay:false,frozen:false,seconds};
      }
    }
    return result;
  }
  function streakStats(sessions,date=dayKey()){
    const totals=summarizeDays(sessions),map=streakByDay(sessions),studiedDays=Object.keys(totals).filter(day=>day<=date).sort();
    const today=map[date],pending=(totals[date]||0)>0&&(totals[date]||0)<FULL_DAY_SECONDS;
    const last=(pending?studiedDays.filter(day=>day<date):studiedDays).at(-1),info=last?map[last]:null;
    return {current:info?.days||0,multiplier:streakMultiplier(info?.days||0),today:today?.days||0,
      todayMultiplier:today?.multiplier||1,todaySeconds:totals[date]||0,fullDay:!!today?.fullDay,
      pending,frozen:!totals[date]&&(info?.days||0)>0};
  }
  function excellenceStats(sessions,date=dayKey()){
    const totals=summarizeDays(sessions),map=excellenceByDay(sessions),studiedDays=Object.keys(totals).filter(day=>day<=date).sort();
    const today=map[date],pending=(totals[date]||0)>0&&(totals[date]||0)<FULL_DAY_SECONDS;
    const last=(pending?studiedDays.filter(day=>day<date):studiedDays).at(-1),info=last?map[last]:null;
    return {current:info?.days||0,multiplier:excellenceMultiplier(info?.days||0),today:today?.days||0,
      todayMultiplier:today?.multiplier||1,todaySeconds:totals[date]||0,excellentDay:!!today?.excellentDay,
      pending,frozen:!!today?.frozen||(!totals[date]&&(info?.days||0)>0)};
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
      const goal=byGoal.get(session.goalId),scale=goalScale(goal);
      const rewardPolicy=POLICIES[Number(session.policyVersion)]||POLICIES[1];
      const streakInfo=streaks[date]||{days:0,multiplier:1,fullDay:false};
      const excellenceInfo=excellence[date]||{days:0,multiplier:1,excellentDay:false,frozen:false};
      const fullDayMultiplier=rewardPolicy.version>=3&&streakInfo.fullDay?streakInfo.multiplier:1;
      const excellentMultiplier=rewardPolicy.version>=4&&excellenceInfo.excellentDay?excellenceInfo.multiplier:1;
      const multiplier=fullDayMultiplier*excellentMultiplier;
      const base=baseReward(after,rewardPolicy)-baseReward(before,rewardPolicy);
      const potential=Math.max(0,Math.round(baseReward(after,rewardPolicy)*scale*multiplier*1e6)-Math.round(baseReward(before,rewardPolicy)*scale*multiplier*1e6));
      const effortMicroPoints=Math.max(0,Math.round(baseReward(after,rewardPolicy)*multiplier*1e6)-Math.round(baseReward(before,rewardPolicy)*multiplier*1e6));
      result.push({id:'piano:'+session.id,date,sessionId:session.id,goalId:session.goalId,source:'piano',
        startedAt:session.startedAt,duration:seconds,rawDuration:rawSeconds,activityType:type,activityFactor:factor,baseReward:base,goalScale:scale,
        streakDays:streakInfo.days,streakMultiplier:fullDayMultiplier,fullDay:streakInfo.fullDay,
        excellenceDays:excellenceInfo.days,excellenceMultiplier:excellentMultiplier,excellentDay:excellenceInfo.excellentDay,excellenceFrozen:excellenceInfo.frozen,
        rewardMultiplier:multiplier,policyVersion:rewardPolicy.version,qualified:true,effortMicroPoints,effortPoints:effortMicroPoints/1e6,
        potentialMicroEuros:potential,microEuros:potential,finalReward:potential/1e6});
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
  function studyAchievement(sessions,today=dayKey()){
    const totals=summarizeDays(sessions),months={};
    Object.keys(totals).filter(date=>date<=today && totals[date]>=EXCELLENT_DAY_SECONDS).sort().forEach(date=>{
      (months[date.slice(0,7)]||=[]).push(date);
    });
    const achievedMonth=Object.keys(months).sort().find(month=>months[month].length>=20);
    return {id:'excellence-month',title:'Un mes extraordinario',requiredDays:20,points:5,
      days:(months[today.slice(0,7)]||[]).length,month:today.slice(0,7),earned:!!achievedMonth,
      earnedOn:achievedMonth?months[achievedMonth][19]:null};
  }
  function effortStartDay(db){
    const wallet=ensureEffortWallet(db),seeds=new Set(wallet.seedGoalIds);
    const seedDates=(db.germanStudy?.goals||[]).filter(g=>seeds.has(g.id)&&g.createdAt).map(g=>dayKey(new Date(g.createdAt)));
    return seedDates.sort()[0]||dayKey(new Date(wallet.createdAt));
  }
  function bonusRows(db,sessions,today=dayKey()){
    const since=effortStartDay(db);
    const achievement=studyAchievement((sessions||[]).filter(s=>s.date>=since),today),rows=[];
    const row=(id,date,points,title)=>({id:'bonus:'+id,date,source:'bonus',sharedEffortVersion:1,
      effortMicroPoints:Math.round(points*1e6),qualified:true,title});
    if(achievement.earned)rows.push(row(achievement.id,achievement.earnedOn,achievement.points,achievement.title));
    const habits=new Map((db.habitChallenges||[]).filter(h=>h?.id).map(h=>[h.id,h]));
    if(db.habitChallenge?.id&&!habits.has(db.habitChallenge.id))habits.set(db.habitChallenge.id,db.habitChallenge);
    let previousEnd='';
    // Concurrent offline copies cannot turn overlapping habit cycles into two prizes.
    [...habits.values()].sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate))||String(a.id).localeCompare(String(b.id))).forEach(habit=>{
      const status=HabitTrophies?.rewardStatus(habit,new Date(today+'T12:00:00'));
      if(!status||status.status==='none'||habit.startDate<since||habit.startDate<previousEnd)return;
      previousEnd=status.earnedOn;
      if(status.status==='earned')rows.push(row('habit:'+habit.id,status.earnedOn,status.points,habit.title));
    });
    return rows;
  }
  function rowEffortPoints(row){
    if(!row||row.qualified===false)return 0;
    if(Number.isFinite(Number(row.effortPoints)))return Math.max(0,Number(row.effortPoints));
    if(Number.isFinite(Number(row.effortMicroPoints)))return Math.max(0,Number(row.effortMicroPoints))/1e6;
    const scale=Math.max(0,Number(row.goalScale)||0);
    if(scale>0&&Number.isFinite(Number(row.potentialMicroEuros)))return Math.max(0,Number(row.potentialMicroEuros))/1e6/scale;
    return 0;
  }
  function rowIsShared(row){
    if(!row)return false;
    if(row.source==='piano')return Number(row.policyVersion)>=SHARED_EFFORT_POLICY_VERSION;
    if(row.source==='german')return Number(row.sharedEffortVersion)>=1;
    if(row.source==='bonus')return Number(row.sharedEffortVersion)===1;
    return false;
  }
  function rowBelongsToWallet(row,wallet){
    if(rowIsShared(row))return true;
    return !!row&&new Set(wallet?.seedGoalIds||[]).has(row.goalId);
  }
  function walletPointsFromRows(rows,wallet){
    const seeds=new Set(wallet?.seedGoalIds||[]),legacyByGoal={},bonuses=new Set();let earned=0;
    (rows||[]).forEach(row=>{
      if(!row||row.qualified===false)return;
      if(row.source==='bonus'){if(!row.id||bonuses.has(row.id))return;bonuses.add(row.id);}
      const value=rowEffortPoints(row);if(!(value>0))return;
      if(rowIsShared(row)){earned+=value;return;}
      if(seeds.has(row.goalId))legacyByGoal[row.goalId]=(legacyByGoal[row.goalId]||0)+value;
    });
    Object.entries(legacyByGoal).forEach(([goalId,value])=>{
      const cap=Number(wallet?.seedCostPoints?.[goalId]);
      earned+=Number.isFinite(cap)&&cap>=0?Math.min(value,cap):value;
    });
    const spent=(wallet?.redemptions||[]).reduce((sum,item)=>sum+Math.max(0,Number(item?.points)||0),0);
    return Math.max(0,earned-spent);
  }
  function goalProgressFromWallet(goal,rows,wallet){
    const points=walletPointsFromRows(rows,wallet),scale=goalScale(goal),costPoints=goalCostPoints(goal);
    const amount=Math.min(Math.max(0,Number(goal?.amount)||0),points*scale);
    const target=Math.max(0,Number(goal?.amount)||0);
    return {points,scale,costPoints,amount,remaining:Math.max(0,target-amount),percent:target>0?Math.min(100,amount/target*100):0,complete:target>0&&amount>=target-0.0000005};
  }
  function walletRows(db,pianoState=null){
    const goals=db?.germanStudy?.goals||[];
    const germanRows=GermanRewards?GermanRewards.ledger(db?.germanStudy?.sessions||[],goals):[];
    const state=pianoState||studyState(db);
    const pianoRows=ledger(state.sessions||[],goals);
    const bonuses=state.bonusRows||bonusRows(db,state.sessions);
    return {goals,germanRows,pianoRows,bonusRows:bonuses,rows:[...germanRows,...pianoRows,...bonuses],state};
  }
  function walletSnapshot(db){
    const wallet=ensureEffortWallet(db),bundle=walletRows(db);
    return {...bundle,wallet,points:walletPointsFromRows(bundle.rows,wallet)};
  }
  function goalProgressForDb(db,goalId){
    const snap=walletSnapshot(db),goal=snap.goals.find(g=>g.id===goalId);
    return goal?goalProgressFromWallet(goal,snap.rows,snap.wallet):null;
  }
  function redeemGoal(db,goalId,now=new Date()){
    const snap=walletSnapshot(db),goal=snap.goals.find(g=>g.id===goalId&&!g.archivedAt&&!g.deletedAt);
    if(!goal)return {ok:false,reason:'missing'};
    const progress=goalProgressFromWallet(goal,snap.rows,snap.wallet);
    if(!progress.complete)return {ok:false,reason:'insufficient',progress};
    const id='redeem_'+goalId+'_'+now.getTime();
    snap.wallet.redemptions.push({id,goalId,goalName:goal.name,amount:goal.amount,points:progress.costPoints,createdAt:now.toISOString()});
    goal.archivedAt=now.toISOString();goal.updatedAt=goal.archivedAt;
    const next=availableGoals(db)[0]||null;snap.wallet.displayGoalId=next?.id||null;
    return {ok:true,goal,spentPoints:progress.costPoints,remainingPoints:Math.max(0,progress.points-progress.costPoints)};
  }
  function live(state,goals,goalId,currentSeconds,date=dayKey(),germanRows=[],currentPolicyVersion=CONFIG.version,currentActivityType=null){
    const savedSessions=state.sessions||[],basePianoRows=ledger(savedSessions,goals),bonuses=state.bonusRows||[],baseRows=[...combinedLedger(germanRows,basePianoRows,goals),...bonuses];
    const savedSeconds=savedSessions.filter(session=>session.date===date&&!session.deleted).reduce((sum,session)=>sum+equivalentSeconds(session),0);
    const wallet=state.effortWallet||{version:1,seedGoalIds:[goalId].filter(Boolean),seedCostPoints:{},displayGoalId:goalId,redemptions:[]};
    const selectedGoalId=wallet.displayGoalId&&goals.some(item=>item.id===wallet.displayGoalId&&!item.archivedAt&&!item.deletedAt)?wallet.displayGoalId:goalId;
    const goal=(goals||[]).find(item=>item.id===selectedGoalId),scale=goalScale(goal);
    const elapsed=Math.max(0,Number(currentSeconds)||0),rewardPolicy=POLICIES[Number(currentPolicyVersion)]||CONFIG;
    const type=normalizeActivityType(currentActivityType||runtimeActivityType()),factor=ACTIVITY_TYPES[type].factor;
    const liveSession=elapsed>0?{id:'__live__',goalId:selectedGoalId,startedAt:date+'T23:59:59.999Z',endedAt:date+'T23:59:59.999Z',date,seconds:elapsed,
      activityType:type,activityFactor:factor,policyVersion:rewardPolicy.version}:null;
    const hypotheticalSessions=liveSession?[...savedSessions,liveSession]:savedSessions;
    const hypotheticalPianoRows=ledger(hypotheticalSessions,goals),hypotheticalRows=[...combinedLedger(germanRows,hypotheticalPianoRows,goals),...bonuses];
    const basePoints=walletPointsFromRows(baseRows,wallet),hypotheticalPoints=walletPointsFromRows(hypotheticalRows,wallet);
    const increment=Math.max(0,(hypotheticalPoints-basePoints)*scale);
    const todayEffort=hypotheticalPianoRows.filter(row=>row.date===date&&rowBelongsToWallet(row,wallet)).reduce((sum,row)=>sum+rowEffortPoints(row),0);
    const today=todayEffort*scale;
    const equivalentElapsed=elapsed*factor,totalSeconds=savedSeconds+equivalentElapsed,next=rewardPolicy.curve.find(([seconds])=>seconds>totalSeconds);
    const nextIndex=next?rewardPolicy.curve.indexOf(next):-1,previous=nextIndex>0?rewardPolicy.curve[nextIndex-1]:rewardPolicy.curve.at(-1);
    const streakInfo=streakByDay(hypotheticalSessions)[date]||{days:0,multiplier:1,fullDay:false};
    const excellenceInfo=excellenceByDay(hypotheticalSessions)[date]||{days:0,multiplier:1,excellentDay:false,frozen:false};
    const fullDayMultiplier=rewardPolicy.version>=3&&streakInfo.fullDay?streakInfo.multiplier:1;
    const excellentMultiplier=rewardPolicy.version>=4&&excellenceInfo.excellentDay?excellenceInfo.multiplier:1;
    const liveMultiplier=fullDayMultiplier*excellentMultiplier;
    const hourlyRate=next?((next[1]-previous[1])/(next[0]-previous[0]))*3600*scale*liveMultiplier*factor:0;
    const capSeconds=rewardPolicy.curve.at(-1)[0],capFill=Math.max(0,capSeconds-savedSeconds);
    const capSession={id:'__cap__',goalId:selectedGoalId,startedAt:date+'T23:59:59.999Z',endedAt:date+'T23:59:59.999Z',date,seconds:capFill,
      activityType:'study',activityFactor:1,policyVersion:rewardPolicy.version};
    const capSessions=[...savedSessions,capSession];
    const capInfo=streakByDay(capSessions)[date]||{days:0,multiplier:1,fullDay:false};
    const capExcellence=excellenceByDay(capSessions)[date]||{days:0,multiplier:1,excellentDay:false,frozen:false};
    const capFullMultiplier=rewardPolicy.version>=3&&capInfo.fullDay?capInfo.multiplier:1;
    const capExcellentMultiplier=rewardPolicy.version>=4&&capExcellence.excellentDay?capExcellence.multiplier:1;
    const cap=baseReward(capSeconds,rewardPolicy)*scale*capFullMultiplier*capExcellentMultiplier;
    const progress=goal?goalProgressFromWallet(goal,hypotheticalRows,wallet):null;
    return {today,increment,cap,seconds:totalSeconds,rawCurrentSeconds:elapsed,equivalentCurrentSeconds:equivalentElapsed,currentActivityType:type,currentActivityFactor:factor,
      nextSeconds:next?next[0]:null,nextBase:next?next[1]:rewardPolicy.curve.at(-1)[1],tierStartSeconds:next?previous[0]:rewardPolicy.curve.at(-1)[0],hourlyRate,policyVersion:rewardPolicy.version,
      streakDays:streakInfo.days,streakMultiplier:fullDayMultiplier,fullDay:streakInfo.fullDay,
      excellenceDays:excellenceInfo.days,excellenceMultiplier:excellentMultiplier,excellentDay:excellenceInfo.excellentDay,excellenceFrozen:excellenceInfo.frozen,
      rewardMultiplier:liveMultiplier,goalRemaining:progress?progress.remaining:0,goalEquivalent:progress?progress.amount:0,walletPoints:hypotheticalPoints,
      goalScale:scale,goalCostPoints:goal?goalCostPoints(goal):0,displayGoalId:selectedGoalId};
  }

  /* Browser-only goal manager. The existing Deutsch card remains the mounting
     point, but v5 replaces its single-goal UI with simultaneous projections of
     one common effort wallet. Points stay secondary; euros remain the main UI. */
  function installBrowser(root){
    if(!root||!root.document||root.__pianoEffortWalletUiInstalled)return;
    root.__pianoEffortWalletUiInstalled=true;
    let adding=false,editingId=null,queued=false;
    const doc=root.document;
    const money=n=>Number(n||0).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
    const points=n=>Number(n||0).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2});
    const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function currentDb(){return appDb();}
    function callSave(){try{if(typeof saveData==='function')return saveData()!==false;if(typeof root.saveData==='function')return root.saveData()!==false;}catch(error){}return false;}
    function callCronoSave(){try{if(typeof cronoSaveState==='function')cronoSaveState();else root.cronoSaveState?.();}catch(error){}}
    function callCronoUpdate(){try{if(typeof cronoUpdatePianoReward==='function')cronoUpdatePianoReward();else root.cronoUpdatePianoReward?.();}catch(error){}}
    function saveAndRefresh(){
      callSave();callCronoUpdate();
      try{root.GermanStudy?.refreshMoney?.();}catch(error){}
      schedule();
    }
    function installStyles(){
      if(doc.getElementById('effortWalletGoalStyles'))return;
      const style=doc.createElement('style');style.id='effortWalletGoalStyles';style.textContent=`
        #germanSharedGoal[data-effort-wallet="1"]{display:block}
        #germanSharedGoal .effort-wallet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
        #germanSharedGoal .effort-wallet-head h2{margin:.16rem 0 .25rem}
        #germanSharedGoal .effort-wallet-head p{margin:0;max-width:58ch;color:var(--text2)}
        #germanSharedGoal .effort-wallet-points{flex:0 0 auto;text-align:right;padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:color-mix(in srgb,var(--bg2) 84%,transparent)}
        #germanSharedGoal .effort-wallet-points span{display:block;font-size:9px;letter-spacing:.09em;color:var(--text3);text-transform:uppercase}
        #germanSharedGoal .effort-wallet-points strong{font:700 13px/1.5 'JetBrains Mono',monospace;color:var(--text2)}
        #germanSharedGoal .effort-goal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:10px;margin:12px 0}
        #germanSharedGoal .effort-goal-item{border:1px solid var(--border);border-radius:14px;padding:13px;background:var(--bg2);min-width:0}
        #germanSharedGoal .effort-goal-item.is-selected{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 16%,transparent)}
        #germanSharedGoal .effort-goal-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
        #germanSharedGoal .effort-goal-top h3{margin:0;font-size:16px;overflow-wrap:anywhere}
        #germanSharedGoal .effort-goal-selected{font:700 9px/1 'JetBrains Mono',monospace;letter-spacing:.06em;color:var(--accent);text-transform:uppercase}
        #germanSharedGoal .effort-goal-money{font:700 20px/1.25 'JetBrains Mono',monospace;margin:10px 0 7px}
        #germanSharedGoal .effort-goal-money small{font-size:11px;color:var(--text3);font-weight:500}
        #germanSharedGoal .effort-goal-item progress{width:100%;height:6px}
        #germanSharedGoal .effort-goal-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:7px;font-size:10px;color:var(--text3)}
        #germanSharedGoal .effort-goal-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
        #germanSharedGoal .effort-goal-actions button,#germanSharedGoal .effort-wallet-add{min-height:34px}
        #germanSharedGoal .effort-wallet-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(110px,.45fr);gap:10px;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--bg2)}
        #germanSharedGoal .effort-wallet-form label{display:grid;gap:5px;font-size:10px;color:var(--text3)}
        #germanSharedGoal .effort-wallet-form input{width:100%;box-sizing:border-box}
        #germanSharedGoal .effort-wallet-form-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px}
        #germanSharedGoal .effort-wallet-note{font-size:10px;color:var(--text3);margin:10px 0 0}
        @media(max-width:560px){#germanSharedGoal .effort-wallet-head{display:block}#germanSharedGoal .effort-wallet-points{margin-top:10px;text-align:left;width:max-content}#germanSharedGoal .effort-wallet-form{grid-template-columns:1fr}}
      `;doc.head.appendChild(style);
    }
    function formMarkup(goal){
      return `<form class="effort-wallet-form" id="effortGoalForm" ${goal?`data-id="${esc(goal.id)}"`:''}><label>Objetivo<input name="name" maxlength="80" required autocomplete="off" placeholder="Kindle" value="${esc(goal?.name||'')}"></label><label>Precio (€)<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required value="${esc(goal?.amount??150)}"></label><div class="effort-wallet-form-actions"><button type="button" data-effort-action="cancel-form">Cancelar</button><button type="submit" class="german-primary">${goal?'Guardar':'Añadir objetivo'}</button></div></form>`;
    }
    function render(){
      queued=false;installStyles();
      const host=doc.getElementById('germanSharedGoal'),database=currentDb();
      if(!host||!database)return;
      const wallet=ensureEffortWallet(database),snap=walletSnapshot(database);
      if(recoveredWallets.has(database)&&callSave())recoveredWallets.delete(database);
      const goals=availableGoals(database),selected=activeGoal(database);
      const signature=JSON.stringify([wallet.displayGoalId,adding,editingId,Number(snap.points).toFixed(6),goals.map(g=>[g.id,g.name,g.amount,g.updatedAt||'',g.archivedAt||'',g.deletedAt||'']),wallet.redemptions.length]);
      if(host.dataset.effortWallet==='1'&&host.dataset.effortSignature===signature)return;
      host.dataset.effortWallet='1';host.dataset.effortSignature=signature;
      const cards=goals.map(goal=>{
        const p=goalProgressFromWallet(goal,snap.rows,wallet),isSelected=selected?.id===goal.id;
        return `<article class="effort-goal-item ${isSelected?'is-selected':''}"><div class="effort-goal-top"><h3>${esc(goal.name)}</h3>${isSelected?'<span class="effort-goal-selected">En cronómetro</span>':''}</div><div class="effort-goal-money">${money(p.amount)} <small>/ ${money(goal.amount)}</small></div><progress max="100" value="${p.percent}" aria-label="Progreso de ${esc(goal.name)}"></progress><div class="effort-goal-meta"><span>${p.percent.toFixed(1).replace('.',',')} %</span><span>1 punto = ${money(p.scale)}</span></div><div class="effort-goal-actions">${isSelected?'':`<button data-effort-action="select" data-id="${esc(goal.id)}">Ver en cronómetro</button>`}<button data-effort-action="edit" data-id="${esc(goal.id)}">Editar</button><button data-effort-action="delete" data-id="${esc(goal.id)}">Eliminar</button>${p.complete?`<button class="german-primary" data-effort-action="redeem" data-id="${esc(goal.id)}">Canjear · comprado</button>`:''}</div></article>`;
      }).join('');
      const editGoal=editingId?goals.find(g=>g.id===editingId):null;
      host.innerHTML=`<div class="effort-wallet-head"><div><span class="german-eyebrow">OBJETIVOS DE COMPRA</span><h2>Tus objetivos de compra.</h2><p>El estudio genera un esfuerzo común. En el cronómetro sigues viendo euros del objetivo elegido; aquí ves cuánto representa el mismo esfuerzo en cada compra.</p></div><div class="effort-wallet-points"><span>Banco de esfuerzo</span><strong>${points(snap.points)} pts</strong></div></div><button type="button" class="study-incentives-open" data-open-study-incentives>Rachas y logros de estudio</button>${goals.length?`<div class="effort-goal-grid">${cards}</div>`:'<p>Añade tu primer objetivo. El dinero se mostrará siempre como equivalencia de tu esfuerzo común.</p>'}${editGoal?formMarkup(editGoal):(adding||!goals.length?formMarkup(null):'<button class="effort-wallet-add" data-effort-action="add">+ Añadir otro objetivo</button>')}<p class="effort-wallet-note">Los puntos no sustituyen al dinero: solo evitan duplicar el mismo estudio. Canjear un objetivo gasta su coste interno y reduce proporcionalmente la equivalencia de los demás.</p>`;
    }
    function schedule(){if(queued)return;queued=true;if(root.requestAnimationFrame)root.requestAnimationFrame(render);else setTimeout(render,0);}
    function activeLegacySessionFor(goalId){
      const c=appCrono();
      if(c&&c.state!=='idle'&&!c.isRest&&c.rewardGoalId===goalId&&Number(c.rewardPolicyVersion)<SHARED_EFFORT_POLICY_VERSION)return true;
      const database=currentDb(),sessions=database?.germanStudy?.sessions||[];
      return sessions.some(s=>s.goalId===goalId&&!s.endedAt&&Number(s.sharedEffortVersion)<1);
    }
    doc.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-effort-action]');if(!button)return;
      event.preventDefault();
      const action=button.dataset.effortAction,id=button.dataset.id,database=currentDb();if(!database)return;
      if(action==='add'){adding=true;editingId=null;render();return;}
      if(action==='cancel-form'){adding=false;editingId=null;render();return;}
      if(action==='edit'){editingId=id;adding=false;render();return;}
      if(action==='select'){
        const goal=availableGoals(database).find(g=>g.id===id);if(!goal)return;
        const wallet=ensureEffortWallet(database);wallet.displayGoalId=id;
        const c=appCrono();
        if(c&&c.state!=='idle'&&Number(c.rewardPolicyVersion)>=SHARED_EFFORT_POLICY_VERSION){c.rewardGoalId=id;callCronoSave();}
        saveAndRefresh();return;
      }
      if(action==='delete'){
        const goal=(database.germanStudy?.goals||[]).find(g=>g.id===id&&!g.deletedAt);if(!goal)return;
        if(activeLegacySessionFor(id)){root.alert?.('Termina primero la sesión antigua que está vinculada a este objetivo.');return;}
        if(!root.confirm?.(`¿Eliminar ${goal.name}? El esfuerzo común no se pierde.`))return;
        const now=new Date().toISOString();goal.deletedAt=now;goal.updatedAt=now;
        const wallet=ensureEffortWallet(database);if(wallet.displayGoalId===id)wallet.displayGoalId=availableGoals(database).find(g=>g.id!==id)?.id||null;
        editingId=null;saveAndRefresh();return;
      }
      if(action==='redeem'){
        const c=appCrono();if(c&&c.state!=='idle'){root.alert?.('Termina la sesión antes de canjear un objetivo.');return;}
        const goal=(database.germanStudy?.goals||[]).find(g=>g.id===id);if(!goal)return;
        if(!root.confirm?.(`¿Marcar ${goal.name} como comprado? Esto gastará el esfuerzo equivalente a ${money(goal.amount)}.`))return;
        const result=redeemGoal(database,id);
        if(!result.ok){root.alert?.('Aún no hay esfuerzo suficiente para completar este objetivo.');return;}
        editingId=null;saveAndRefresh();return;
      }
    },true);
    doc.addEventListener('submit',event=>{
      const form=event.target;if(form?.id!=='effortGoalForm')return;
      event.preventDefault();
      const database=currentDb();if(!database)return;
      const data=new FormData(form),name=String(data.get('name')||'').trim(),amount=Math.round(Number(data.get('amount'))*100)/100;
      if(!name||!Number.isFinite(amount)||amount<.01||amount>1e8){root.alert?.('Introduce un nombre y un precio válidos.');return;}
      const st=database.germanStudy,wallet=ensureEffortWallet(database),now=new Date().toISOString(),id=form.dataset.id;
      if(id){const goal=st.goals.find(g=>g.id===id&&!g.deletedAt);if(goal){goal.name=name;goal.amount=amount;goal.updatedAt=now;}}
      else{const goal={id:(root.crypto?.randomUUID?.()||('goal_'+Date.now())),name,amount,createdAt:now,rewardPolicy:JSON.parse(JSON.stringify(GermanRewards.CONFIG))};st.goals.push(goal);if(!wallet.displayGoalId)wallet.displayGoalId=goal.id;}
      adding=false;editingId=null;saveAndRefresh();
    },true);
    function boot(){installStyles();schedule();const view=doc.getElementById('view-deutsch');if(view)new MutationObserver(schedule).observe(view,{childList:true,subtree:true});}
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  }

  return {CONFIG,POLICIES,ACTIVITY_TYPES,FULL_DAY_SECONDS,EXCELLENT_DAY_SECONDS,SHARED_EFFORT_POLICY_VERSION,dayKey,normalizeActivityType,activityFactor,equivalentSeconds,ensure,ensureEffortWallet,studyState,activeGoal,baseReward,goalScale,goalCostPoints,streakMultiplier,excellenceMultiplier,summarizeDays,streakByDay,excellenceByDay,streakStats,excellenceStats,studyAchievement,effortStartDay,bonusRows,record,ledger,combinedLedger,rowEffortPoints,rowBelongsToWallet,walletPointsFromRows,goalProgressFromWallet,walletSnapshot,goalProgressForDb,redeemGoal,live,installBrowser};
});
