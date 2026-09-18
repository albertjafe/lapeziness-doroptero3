import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('../../piano-rewards'),D=require('../../document-sync-core');
const goal={id:'g',name:'Kindle',amount:150,createdAt:'2026-08-01T10:00:00Z'};
const database=()=>({obras:[{id:'w',movimientos:[]}],sessionPlants:[],forestPlants:[],sesiones:[],pianoRewards:{sessions:[]},
  germanStudy:{goals:[{...goal}],sessions:[],effortWallet:{version:1,createdAt:'2026-08-01T12:00:00Z',seedGoalIds:['g'],seedCostPoints:{g:150},displayGoalId:'g',redemptions:[]}}});
const sessions=(hours=5,month='2026-10',n=20)=>Array.from({length:n},(_,i)=>({id:month+':'+i,date:month+'-'+String(i+1).padStart(2,'0'),
  goalId:'g',seconds:hours*3600,policyVersion:month<'2026-10'?5:6,activityType:'study'}));
const points=rows=>rows.reduce((total,row)=>total+P.rowEffortPoints(row),0);

describe('future-only balanced effort policy',()=>{
  it('selects the policy by local calendar day, without changing previous policies',()=>{
    expect(P.policyForDate('2026-09-18').version).toBe(5);
    expect(P.policyForDate('2026-09-19').version).toBe(6);
    expect(P.baseReward(7*3600,P.POLICIES[5])).toBe(5.5);
    expect(P.baseReward(7*3600)).toBe(3.6);
  });
  it('preserves historical manual blocks and tags new manual blocks without changing minutes or mirrors',()=>{
    const data=database();
    for(const [id,date] of [['old','2026-09-18'],['new','2026-09-19']]){
      data.sessionPlants.push({id,obraId:'w',mins:120,startedAt:date+'T10:00:00',source:'manual'});
      data.sesiones.push({id:'mirror:'+id,date:date+'T12:00:00',items:[{id,obraId:'w',manual:true,minutosReales:120,minutosEstudiados:120}]});
    }
    const original=structuredClone(data),state=P.studyState(data,'2026-09-19'),rows=P.ledger(state.sessions,[goal]);
    expect(state.sessions.map(s=>s.policyVersion)).toEqual([5,6]);
    expect(rows.map(P.rowEffortPoints)).toEqual([.27,.60]);
    expect(data).toEqual(original);
    data.sessionPlants[1].mins=60;data.sesiones[1].items[0].minutosReales=60;data.sesiones[1].items[0].minutosEstudiados=60;
    expect(points(P.ledger(P.studyState(data,'2026-09-19').sessions,[goal]))).toBeCloseTo(.52,6);
    data.sessionPlants.pop();data.sesiones.pop();
    expect(points(P.ledger(P.studyState(data,'2026-09-19').sessions,[goal]))).toBe(.27);
  });
  it('keeps an explicitly saved policy across the release boundary and deduplicates finished runs',()=>{
    const data=database(),input={id:'running',goalId:'g',startedAt:'2026-09-18T23:30:00',endedAt:'2026-09-19T00:30:00',seconds:3600,policyVersion:5};
    expect(P.record(data.pianoRewards,input)).toBe(true);expect(P.record(data.pianoRewards,input)).toBe(false);
    expect(P.ledger(data.pianoRewards.sessions,[goal])[0]).toMatchObject({policyVersion:5,effortPoints:.11});
    delete input.policyVersion;input.id='inferred';P.record(data.pianoRewards,input);
    expect(data.pianoRewards.sessions[1].policyVersion).toBe(5);
  });
  it('uses the future policy for manual study even if the wallet loads after that study',()=>{
    const data=database();data.germanStudy.effortWallet.createdAt='2026-10-01T12:00:00Z';
    data.sessionPlants=[{id:'future-manual',obraId:'w',mins:120,startedAt:'2026-09-19T10:00:00',source:'manual'}];
    const state=P.studyState(data,'2026-10-01');
    expect(state.sessions[0].policyVersion).toBe(6);
    expect(points(P.ledger(state.sessions,[goal]))).toBe(.6);
  });
  it('caps the combined streak only in v6, including live rate and daily cap',()=>{
    const data=database(),s=sessions(7,'2026-10',14),old=s.map(item=>({...item,policyVersion:5}));
    expect(P.ledger(old,[goal]).at(-1).rewardMultiplier).toBe(1.875);
    expect(P.ledger(s,[goal]).at(-1)).toMatchObject({rewardMultiplier:1.5,effortPoints:5.4});
    const live=P.live({sessions:s.slice(0,13),effortWallet:data.germanStudy.effortWallet},[goal],'g',6.5*3600,'2026-10-14');
    expect(live.rewardMultiplier).toBe(1.5);expect(live.cap).toBeCloseTo(5.4,8);
    expect(live.hourlyRate).toBeCloseTo(.82*1.5,8);
  });
  it('preserves old one-time awards and does not turn old study into a new monthly prize',()=>{
    const data=database(),old=sessions(5,'2026-08');
    const rows=P.bonusRows(data,old,'2026-10-31');
    expect(rows).toHaveLength(1);expect(rows[0].id).toBe('bonus:excellence-month');expect(points(rows)).toBe(5);
    expect(points(P.bonusRows(data,sessions(5,'2026-09'),'2026-09-30'))).toBe(0);
  });
  it.each([[4,10],[5,25],[6,30]])('pays only %s-hour monthly level total: %s points',(hours,expected)=>{
    const data=database(),rows=P.bonusRows(data,sessions(hours),'2026-10-31');
    expect(points(rows)).toBe(expected);
    expect(P.walletPointsFromRows([...rows,...rows],data.germanStudy.effortWallet)).toBe(expected);
  });
  it('upgrades 10 → 25 → 30 by paying differences and rolls back edited/deleted days',()=>{
    const data=database(),s=sessions(4);
    expect(points(P.bonusRows(data,s,'2026-10-31'))).toBe(10);
    s.forEach(item=>item.seconds=5*3600);const five=P.bonusRows(data,s,'2026-10-31');
    expect(five.map(P.rowEffortPoints)).toEqual([10,15]);
    s.forEach(item=>item.seconds=6*3600);const six=P.bonusRows(data,s,'2026-10-31');
    expect(six.map(P.rowEffortPoints)).toEqual([10,15,5]);
    s[19].seconds=4*3600;expect(points(P.bonusRows(data,s,'2026-10-31'))).toBe(10);
    s[19].deleted=true;expect(points(P.bonusRows(data,s,'2026-10-31'))).toBe(0);
  });
  it('does not combine months, count future days, raw class hours or duplicate same-day summaries',()=>{
    expect(points(P.monthlyBonusRows([...sessions(6,'2026-10',10),...sessions(6,'2026-11',10)],'2026-11-30'))).toBe(0);
    expect(points(P.monthlyBonusRows(sessions(6),'2026-10-19'))).toBe(0);
    expect(points(P.monthlyBonusRows(sessions(6).map(s=>({...s,activityType:'piano_class',activityFactor:.5})),'2026-10-31'))).toBe(0);
    const s=sessions(4,'2026-10',19);s.push({...s[0],id:'extra',seconds:100*3600});
    expect(points(P.monthlyBonusRows(s,'2026-10-31'))).toBe(0);
  });
  it('allows rest days, repeats monthly and preserves legacy awards alongside new ones',()=>{
    const data=database(),s=[...sessions(5,'2026-08'),...sessions(5),...sessions(6,'2026-11')];
    const rows=P.bonusRows(data,s,'2026-11-30');expect(points(rows)).toBe(60);
    expect(P.bonusRows(D.mergeRemote(data,data),s,'2026-11-30')).toEqual(rows);
    const gaps=sessions(4).map((s,i)=>({...s,date:'2026-10-'+String(i+1+(i>=10?2:0)).padStart(2,'0')}));
    expect(points(P.monthlyBonusRows(gaps,'2026-10-31'))).toBe(10);
  });
  it('previews the twentieth-day award once and agrees with the saved wallet',()=>{
    const data=database(),s=sessions(5,'2026-10',19),state={sessions:s,effortWallet:data.germanStudy.effortWallet,effortStartDay:'2026-08-01',bonusRows:[]};
    const live=P.live(state,[goal],'g',5*3600,'2026-10-20');
    const saved=[...s,{id:'twentieth',date:'2026-10-20',seconds:5*3600,goalId:'g',policyVersion:6}];
    const rows=[...P.ledger(saved,[goal]),...P.bonusRows(data,saved,'2026-10-20')];
    expect(live.walletPoints).toBeCloseTo(P.walletPointsFromRows(rows,data.germanStudy.effortWallet),6);
    expect(live.walletPoints).toBeCloseTo(points(P.ledger(saved,[goal]))+25,6);
  });
  it('spends monthly points once across price equivalences without changing the points on repricing',()=>{
    const data=database(),rows=P.bonusRows(data,sessions(6),'2026-10-31'),wallet=data.germanStudy.effortWallet;
    const a={id:'a',amount:50},b={id:'b',amount:50000};
    expect(P.goalProgressFromWallet(a,rows,wallet).points).toBe(30);
    expect(P.goalProgressFromWallet(b,rows,wallet).amount).toBeCloseTo(30*P.goalScale(b),6);
    wallet.redemptions.push({id:'spent',points:10});
    expect(P.goalProgressFromWallet(a,rows,wallet).points).toBe(20);
    expect(P.goalProgressFromWallet(b,rows,wallet).points).toBe(20);
    a.amount=80;expect(P.goalProgressFromWallet(a,rows,wallet).points).toBe(20);
  });
});
