// Local browser benchmark. External requests and service workers are blocked.
// An optional authorized snapshot stays local; reports contain only metrics.
import fs from 'node:fs';
import {chromium} from 'playwright';

const args=process.argv.slice(2), option=name=>args[args.indexOf(name)+1];
const desktop=args.includes('--desktop'), finish=args.includes('--finish');
const snapshot=args.includes('--snapshot')?option('--snapshot'):null;
const output=args.includes('--output')?option('--output'):null;
const rate=args.includes('--rate')?Number(option('--rate')):1;
const origin=args.includes('--url')?new URL(option('--url')).origin:'http://127.0.0.1:4173';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))throw Error('Use a local test server');
const stamp=i=>new Date(Date.UTC(2025,0,1,0,i*30)).toISOString();
const data=snapshot?JSON.parse(fs.readFileSync(snapshot,'utf8')):{
  obras:Array.from({length:46},(_,i)=>({id:'w'+i,name:'Synthetic work '+i,tipo:'obra',sol:40,movimientos:[],solHistory:[]})),
  eventos:[],registro:[],cronoTasks:Array.from({length:110},(_,i)=>({id:'t'+i,text:'Synthetic task '+i,done:false,priority:0,createdAt:stamp(i)})),
  forestPlants:Array.from({length:8260},(_,i)=>({id:'f'+i,obraId:'w'+i%46,mins:20,startedAt:stamp(i),extra:'x'.repeat(300)})),
  sessionPlants:[],sesiones:[],germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],
    goals:[{id:'benchmark-goal',name:'Synthetic goal',amount:150,createdAt:stamp(0)}]},pianoRewards:{sessions:[]}
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:desktop?{width:1440,height:900}:{width:1194,height:834},
    hasTouch:!desktop,isMobile:!desktop,serviceWorkers:'block',
    ...(!desktop?{deviceScaleFactor:2,userAgent:'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}:{})});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();let pageErrors=0;
  page.on('pageerror',()=>pageErrors++);
  await page.addInitScript(seed=>{
    localStorage.setItem('alberto_piano_v2',JSON.stringify(seed));
    localStorage.setItem('alberto_sync_v1',JSON.stringify({localRevision:seed._localRevision||0,dirtyRevision:0,lastSyncedRevision:seed._localRevision||0}));
    window.__perf={frames:[],long:[],writes:0};
    const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='alberto_piano_v2')window.__perf.writes++;return write.call(this,key,value);};
    try {new PerformanceObserver(list=>list.getEntries().forEach(entry=>window.__perf.long.push(entry.duration))).observe({type:'longtask',buffered:true});}catch(_){}
    let previous;
    const frame=now=>{if(previous!==undefined)window.__perf.frames.push(now-previous);previous=now;requestAnimationFrame(frame);};
    requestAnimationFrame(frame);
  },data);
  const cdp=await context.newCDPSession(page);
  if(rate>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate});
  await page.goto(origin,{waitUntil:'load'});await pause(4000);
  const report={engine:'Chromium',touchLayout:!desktop,cpuRate:rate,privateSnapshot:!!snapshot,
    bytes:Buffer.byteLength(JSON.stringify(data)),phases:[]};
  async function phase(name,action,wait=2200){
    await page.evaluate(()=>{window.__perf.frames=[];window.__perf.long=[];window.__perf.writes=0;});
    const actionResult=await page.evaluate(action);await pause(wait);
    const metrics=await page.evaluate(()=>({maxFrameGapMs:Math.max(0,...window.__perf.frames),
      longTasksMs:window.__perf.long,documentWrites:window.__perf.writes}));
    report.phases.push({name,...actionResult,...metrics});
  }
  await phase('enter-timer',()=>{const start=performance.now();showView('cronometro');return {handlerMs:performance.now()-start};});
  if(finish){
    await phase('finish-session',()=>{
      const work=db.obras.find(x=>x.tipo!=='actividad'&&!x.deleted&&!x.deletedAt);
      Object.assign(crono,{state:'running',mode:'crono',runId:'local-benchmark-'+Date.now(),startTs:Date.now()-25*60000,
        pausedMs:0,pauseStartTs:null,obraId:work.id,movId:null,displayName:'Synthetic session',activityType:'study',isRest:false,
        targetDurationMs:null,rewardGoalId:PianoRewards.activeGoal(db)?.id||null,rewardPolicyVersion:6});
      const before=db.sessionPlants.length,start=performance.now();cronoFinish(crono.runId);
      return {handlerMs:performance.now()-start,blocksAdded:db.sessionPlants.length-before};
    },4500);
  }else{
    await phase('open-tasks',()=>{const start=performance.now();cronoOpenTaskBoard();return {handlerMs:performance.now()-start};});
    await page.evaluate(()=>cronoCloseTaskBoard());await pause(700);
    await phase('open-work-picker',()=>{const start=performance.now();openCronoObraPicker('start');return {handlerMs:performance.now()-start};});
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id)));await pause(500);
    await phase('add-task',()=>{document.getElementById('cronoQuickTask-idle').value='Synthetic benchmark task';
      const start=performance.now();cronoQuickAddTask(null,'idle');return {handlerMs:performance.now()-start};},3200);
    await phase('save-manual-session',()=>{renderSessionQuickStudy();const select=document.getElementById('sessionQuickStudyObra');
      select.value=Array.from(select.options).find(x=>x.value&&!x.disabled).value;
      document.getElementById('sessionQuickStudyMinutes').value='25';const before=db.sessionPlants.length,start=performance.now();
      saveSessionQuickStudy();return {handlerMs:performance.now()-start,blocksAdded:db.sessionPlants.length-before};},3800);
  }
  report.pageErrors=pageErrors;
  const json=JSON.stringify(report,null,2);
  if(output)fs.writeFileSync(output,json+'\n');
  console.log(json);
  if(pageErrors)process.exitCode=1;
}finally {await browser.close();}
