import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('../../piano-rewards'),H=require('../../habit-trophies'),Doc=require('../../document-sync-core');
const newHabit=(mode='avoid',startDate='2026-09-01',id='h')=>{
  const h={id,title:'Menos móvil',mode,startDate,durationDays:21,successCriteria:'Dejar el móvil fuera',logs:{}};
  h.effortReward=H.createRewardPolicy(h,new Date(startDate+'T10:00:00'));return h;
};
const database=(habits=[])=>({obras:[],sessionPlants:[],forestPlants:[],sesiones:[],habitChallenges:habits,
  germanStudy:{goals:[{id:'g',name:'Kindle',amount:220,createdAt:'2026-09-01T10:00:00Z'}],sessions:[],
    effortWallet:{version:1,createdAt:'2026-09-01T12:00:00Z',seedGoalIds:['g'],seedCostPoints:{},redemptions:[]}},pianoRewards:{sessions:[]}});
const sessions=(n,month='2026-09',seconds=18000)=>Array.from({length:n},(_,i)=>({id:month+'-'+i,date:month+'-'+String(i+1).padStart(2,'0'),seconds,activityType:'study'}));
const timed=(id,date,start,seconds,activityType='study',activityFactor=1)=>{
  const startedAt=date+'T'+start+':00',endedAt=new Date(new Date(startedAt).getTime()+seconds*1000).toISOString();
  return {id,date,startedAt,endedAt,seconds,activityType,activityFactor};
};

describe('bounded study and habit rewards in the shared wallet',()=>{
  it('uses equivalent hours and distinct calendar days for the exceptional month',()=>{
    const s=sessions(19);s.push({...s.at(-1),id:'duplicate-half',seconds:9000});
    expect(P.studyAchievement(s,'2026-09-30').earned).toBe(false);
    s.push({id:'twentieth',date:'2026-09-20',seconds:18000,activityType:'piano_class',activityFactor:.5});
    expect(P.studyAchievement(s,'2026-09-30').earned).toBe(false);
    s.at(-1).seconds=36000;expect(P.studyAchievement(s,'2026-09-30')).toMatchObject({earned:true,earnedOn:'2026-09-20',points:5});
  });
  it('never combines two incomplete months or future study into a prize',()=>{
    expect(P.studyAchievement([...sessions(10,'2026-08'),...sessions(10)],'2026-09-30').earned).toBe(false);
    expect(P.studyAchievement(sessions(20),'2026-09-19').earned).toBe(false);
  });
  it('projects only one five-point prize even after several exceptional months and repeated merges',()=>{
    const data=database(),s=[...sessions(20,'2026-08'),...sessions(20,'2026-07')];
    data.germanStudy.goals[0].createdAt='2026-06-01T10:00:00Z';data.germanStudy.effortWallet.createdAt='2026-06-01T12:00:00Z';
    const rows=P.bonusRows(data,s,'2026-10-30');expect(rows).toHaveLength(1);
    expect(P.walletPointsFromRows([...rows,...rows],data.germanStudy.effortWallet)).toBe(5);
    const merged=Doc.mergeRemote(data,data);expect(P.bonusRows(merged,s,'2026-10-30')).toEqual(rows);
    s[19].seconds=60;s.splice(20);expect(P.bonusRows(data,s,'2026-10-30')).toHaveLength(0);
  });
  it('awards Madrugador only after an early-start day reaches four equivalent hours',()=>{
    const early=[timed('early','2026-09-19','08:30',4*3600)];
    expect(P.secretAchievements(early,'2026-09-19').map(item=>item.id)).toEqual(['early-bird']);
    early[0].seconds=3*3600;early[0].endedAt=new Date(new Date(early[0].startedAt).getTime()+3*3600*1000).toISOString();
    expect(P.secretAchievements(early,'2026-09-19')).toEqual([]);
  });
  it('awards ordinary comeback at 16:00 but lets the epic comeback replace it when the day is later',()=>{
    const ordinary=[timed('ordinary','2026-09-19','15:30',4*3600)];
    expect(P.secretAchievements(ordinary,'2026-09-19').map(item=>item.id)).toEqual(['comeback']);
    const epic=[timed('epic','2026-09-19','17:00',4*3600)];
    expect(P.secretAchievements(epic,'2026-09-19').map(item=>item.id)).toEqual(['epic-comeback']);
  });
  it('scales secret rewards with the active purchase goal instead of paying fixed cents',()=>{
    const data=database(),goal=data.germanStudy.goals[0],wallet=data.germanStudy.effortWallet;
    const rows=P.bonusRows(data,[timed('epic','2026-09-19','17:00',4*3600)],'2026-09-19');
    const secret=rows.filter(row=>row.secretAchievement);
    expect(secret).toHaveLength(1);expect(P.rowEffortPoints(secret[0])).toBe(.8);
    expect(P.goalProgressFromWallet(goal,secret,wallet).amount).toBeCloseTo(.8*P.goalScale(goal),6);
  });
  it('does not back-award secret gaming bonuses before their activation day',()=>{
    expect(P.secretAchievements([timed('old','2026-09-18','08:00',4*3600)],'2026-09-19')).toEqual([]);
  });

  it('avoid earns without daily check-ins only after the entire calendar cycle closes',()=>{
    const h=newHabit();expect(H.rewardStatus(h,'2026-09-21T23:59:00').points).toBe(0);
    expect(H.rewardStatus(h,'2026-09-22T00:01:00')).toMatchObject({status:'earned',points:3});
    h.logs['2026-09-11']={status:'failed'};expect(H.rewardStatus(h,'2026-09-22T12:00:00')).toMatchObject({status:'failed',points:0});
  });
  it('do requires a done record on every day, and early trophy closure grants no effort',()=>{
    const h=newHabit('do');for(let i=0;i<21;i++)h.logs[H.keyAt(h.startDate,i)]='done';
    h.completedAt='2026-09-02';expect(H.rewardStatus(h,'2026-09-02T12:00:00').points).toBe(0);
    expect(H.rewardStatus(h,'2026-09-22T12:00:00').points).toBe(3);
    delete h.logs['2026-09-12'];expect(H.rewardStatus(h,'2026-09-22T12:00:00').points).toBe(0);
  });
  it('old, backdated, short, rule-free or altered contracts do not generate a new credit',()=>{
    const h=newHabit();delete h.effortReward;expect(H.rewardStatus(h,'2026-09-30T12:00:00').points).toBe(0);
    expect(H.createRewardPolicy({...h,durationDays:7},'2026-09-01T12:00:00')).toBeNull();
    expect(H.createRewardPolicy(h,'2026-09-02T12:00:00')).toBeNull();
    expect(H.createRewardPolicy({...h,successCriteria:''},'2026-09-01T12:00:00')).toBeNull();
    const agreed=newHabit();agreed.durationDays=7;expect(H.rewardStatus(agreed,'2026-09-30T12:00:00').points).toBe(0);
  });
  it('deduplicates the legacy singleton and disallows overlapping cycles from offline devices',()=>{
    const h=newHabit(),data=database([h,newHabit('avoid','2026-09-01','other')]);data.habitChallenge=h;
    const rows=P.bonusRows(data,[],'2026-09-30');expect(rows).toHaveLength(1);expect(P.rowEffortPoints(rows[0])).toBe(3);
  });
  it('adds a bonus to every price equivalence and spends it once in the common bank',()=>{
    const data=database(),wallet=data.germanStudy.effortWallet;
    data.germanStudy.goals[0].createdAt='2026-08-01T10:00:00Z';wallet.createdAt='2026-08-01T12:00:00Z';
    const rows=P.bonusRows(data,sessions(20,'2026-08'),'2026-09-30');
    const small={id:'small',amount:50},large={id:'large',amount:50000};
    expect(P.goalProgressFromWallet(small,rows,wallet).amount).toBeCloseTo(5*P.goalScale(small),6);
    expect(P.goalProgressFromWallet(large,rows,wallet).amount).toBeCloseTo(5*P.goalScale(large),6);
    wallet.redemptions=[{id:'purchase',points:4}];expect(P.walletPointsFromRows(rows,wallet)).toBe(1);
    expect(P.goalProgressFromWallet(small,rows,wallet).amount).toBeCloseTo(P.goalScale(small),6);
  });
  it('keeps the live piano total consistent with bonus-inclusive wallet progress',()=>{
    const data=database(),bonus=P.bonusRows(data,[],'2026-09-30');bonus.push({id:'bonus:test',source:'bonus',sharedEffortVersion:1,effortMicroPoints:3000000,qualified:true});
    const state={sessions:[],effortWallet:data.germanStudy.effortWallet,bonusRows:bonus},g=data.germanStudy.goals[0];
    const live=P.live(state,[g],g.id,0,'2026-09-30');expect(live.goalEquivalent).toBeCloseTo(3*P.goalScale(g),6);
    expect(live.today).toBe(0);expect(live.walletPoints).toBe(3);
  });
  it('keeps an unfinished current day pending, freezes rests and resets after a closed short day',()=>{
    const s=sessions(2);s.push({id:'today',date:'2026-09-03',seconds:3600});
    expect(P.streakStats(s,'2026-09-03')).toMatchObject({current:2,pending:true,todayMultiplier:1});
    expect(P.excellenceStats(s,'2026-09-03')).toMatchObject({current:2,pending:true});
    expect(P.excellenceStats(s,'2026-09-04')).toMatchObject({current:0,pending:false});
    expect(P.excellenceStats(s.slice(0,2),'2026-09-04')).toMatchObject({current:2,frozen:true});
  });
  it('counts canonical blocks once even when every day also has a session summary',()=>{
    const data=database();data.obras=[{id:'w',name:'Sonata',movimientos:[]}];
    data.germanStudy.goals[0].createdAt='2026-08-01T10:00:00Z';data.germanStudy.effortWallet.createdAt='2026-08-01T12:00:00Z';
    for(let i=1;i<=20;i++){
      const date='2026-08-'+String(i).padStart(2,'0')+'T10:00:00Z';
      data.sessionPlants.push({id:'block-'+i,obraId:'w',mins:300,startedAt:date});
      data.sesiones.push({id:'mirror-'+i,date,items:[{id:'item-'+i,obraId:'w',minutosReales:300,_fromTimer:true}]});
    }
    const state=P.studyState(data,'2026-08-31');expect(P.studyAchievement(state.sessions,'2026-08-31').days).toBe(20);
    expect(state.bonusRows).toHaveLength(1);expect(P.rowEffortPoints(state.bonusRows[0])).toBe(5);
    data.sessionPlants.pop();data.sesiones.pop();expect(P.studyState(data,'2026-08-31').bonusRows).toHaveLength(0);
  });
  it('does not award historical exceptional months from before the current bank began',()=>{
    const data=database();expect(P.bonusRows(data,sessions(20,'2026-08'),'2026-09-30')).toHaveLength(0);
  });
});
