/* Manual/quick study activity types.
   Keeps raw manual duration intact and tags the canonical plant so
   DailyStudyMinutes applies the same factors as the live piano timer. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.ManualStudyActivity=api;api.installBrowser(root);}
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const STORAGE_KEY='alberto_manual_study_activity_v1';
  const TYPES=Object.freeze({
    study:Object.freeze({label:'Estudio',factor:1,short:'×1'}),
    mental:Object.freeze({label:'Mental',factor:1,short:'×1'}),
    piano_class:Object.freeze({label:'Clase piano',factor:.5,short:'×0,5'}),
    chamber:Object.freeze({label:'Cámara',factor:.5,short:'×0,5'})
  });

  function normalize(value){
    const key=String(value||'study');
    return Object.prototype.hasOwnProperty.call(TYPES,key)?key:'study';
  }
  function factor(value){return TYPES[normalize(value)].factor;}
  function equivalentMinutes(minutes,value){return Math.max(0,Number(minutes)||0)*factor(value);}
  function optionHtml(selected){
    const active=normalize(selected);
    return Object.entries(TYPES).map(([key,item])=>
      '<option value="'+key+'"'+(key===active?' selected':'')+'>'+item.label+' · '+item.short+'</option>'
    ).join('');
  }

  function installBrowser(root){
    if(!root?.document||root.__manualStudyActivityInstalled)return;
    root.__manualStudyActivityInstalled=true;
    const doc=root.document;

    function appDb(){
      try{if(typeof db!=='undefined'&&db)return db;}catch(error){}
      return root.db||null;
    }

    function storedType(){
      try{return normalize(root.localStorage.getItem(STORAGE_KEY)||'study');}catch(error){return 'study';}
    }
    function storeType(value){
      const type=normalize(value);
      try{root.localStorage.setItem(STORAGE_KEY,type);}catch(error){}
      return type;
    }
    function selectedType(){
      return normalize(doc.getElementById('sessionQuickStudyActivity')?.value||
        doc.getElementById('studyRegisterActivity')?.value||storedType());
    }
    function syncSelectors(value){
      const type=storeType(value);
      ['sessionQuickStudyActivity','studyRegisterActivity'].forEach(id=>{
        const select=doc.getElementById(id);
        if(select&&select.value!==type)select.value=type;
      });
      return type;
    }

    function makeSelect(id,className,label){
      const select=doc.createElement('select');
      select.id=id;
      select.className=className||'';
      select.setAttribute('aria-label',label);
      select.innerHTML=optionHtml(storedType());
      select.addEventListener('change',()=>{
        syncSelectors(select.value);
        try{if(typeof root.syncSessionQuickStudy==='function')root.syncSessionQuickStudy();}catch(error){}
      });
      return select;
    }

    function ensureQuickSelector(){
      const form=doc.getElementById('sessionQuickStudyForm');
      if(!form||doc.getElementById('sessionQuickStudyActivity'))return;
      const time=form.querySelector('.session-quick-study-time');
      if(!time)return;
      const select=makeSelect('sessionQuickStudyActivity','session-quick-study-activity','Tipo de actividad');
      time.insertAdjacentElement('beforebegin',select);
    }

    function ensureModalSelector(){
      const form=doc.getElementById('studyRegisterForm');
      const work=doc.getElementById('studyRegisterObra');
      if(!form||!work||doc.getElementById('studyRegisterActivity'))return;
      const wrap=doc.createElement('div');
      wrap.id='studyRegisterActivityWrap';
      wrap.className='study-register-activity-wrap';
      const label=doc.createElement('div');
      label.className='hecho-field-label';
      label.textContent='Tipo de actividad';
      const select=makeSelect('studyRegisterActivity','modal-input','Tipo de actividad');
      wrap.append(label,select);
      work.insertAdjacentElement('afterend',wrap);
    }

    function ensureSelectors(){
      ensureQuickSelector();
      ensureModalSelector();
      syncSelectors(storedType());
    }

    // Tag the canonical plant before the historical manual writer performs
    // its first save, preventing a momentary ×1 projection for chamber/class.
    function patchPlantWriter(){
      if(typeof root.recordSessionPlant!=='function'||root.recordSessionPlant.__manualActivityAware)return;
      const original=root.recordSessionPlant;
      const wrapped=function(obraId,movId,startedAt,endedAt,mins,options){
        const opts=options||{};
        if(opts.source!=='manual')return original.apply(this,arguments);
        const type=normalize(opts.activityType||selectedType());
        const activityFactor=factor(type);
        const entry=original.call(this,obraId,movId,startedAt,endedAt,mins,{...opts,activityType:type});
        if(entry){
          entry.activityType=type;
          entry.activityFactor=activityFactor;
        }
        return entry;
      };
      wrapped.__manualActivityAware=true;
      wrapped.__original=original;
      root.recordSessionPlant=wrapped;
    }

    // Tag both mirrors after the historical writer has created them. Then
    // persist through the durable local path and queue the existing cloud sync.
    function patchPersistence(){
      if(typeof root.persistManualStudyHistory!=='function'||root.persistManualStudyHistory.__activityAware)return;
      const original=root.persistManualStudyHistory;
      const wrapped=function(resolved,minutos,fecha,options){
        const opts=options||{};
        const type=normalize(opts.activityType||selectedType());
        const result=original.call(this,resolved,minutos,fecha,{...opts,activityType:type});
        if(!result)return result;
        const activityFactor=factor(type);
        if(result.item){
          result.item.activityType=type;
          result.item.activityFactor=activityFactor;
        }
        const plantId=result.item?.studyPlantId;
        const database=appDb();
        const plants=Array.isArray(database?.sessionPlants)?database.sessionPlants:[];
        const plant=(plantId&&plants.find(item=>item?.id===plantId))||
          plants.find(item=>item?.source==='manual'&&item?.id===result.item?.id);
        if(plant){
          plant.activityType=type;
          plant.activityFactor=activityFactor;
          plant.updatedAt=new Date().toISOString();
        }
        try{if(typeof root.saveData==='function')root.saveData();}catch(error){}
        try{if(typeof root.saveLocalNow==='function')root.saveLocalNow();}catch(error){}
        try{if(typeof root.refreshStudyViews==='function')root.refreshStudyViews();}catch(error){}
        try{if(typeof root.enqueueCloudSync==='function')root.enqueueCloudSync();}catch(error){}
        return {...result,activityType:type,activityFactor};
      };
      wrapped.__activityAware=true;
      wrapped.__original=original;
      root.persistManualStudyHistory=wrapped;
    }

    function patchMode(){
      if(typeof root.setStudyRegisterMode!=='function'||root.setStudyRegisterMode.__activityAware)return;
      const original=root.setStudyRegisterMode;
      const wrapped=function(mode){
        const result=original.apply(this,arguments);
        const wrap=doc.getElementById('studyRegisterActivityWrap');
        if(wrap)wrap.style.display=(mode==='history'||mode==='today')?'':'none';
        return result;
      };
      wrapped.__activityAware=true;
      root.setStudyRegisterMode=wrapped;
    }

    function patchOpen(){
      if(typeof root.openStudyRegister!=='function'||root.openStudyRegister.__activityAware)return;
      const original=root.openStudyRegister;
      const wrapped=function(){
        ensureSelectors();
        const result=original.apply(this,arguments);
        const quick=doc.getElementById('sessionQuickStudyActivity')?.value;
        syncSelectors(quick||storedType());
        const wrap=doc.getElementById('studyRegisterActivityWrap');
        const mode=arguments[0];
        if(wrap)wrap.style.display=(mode==='history'||mode==='today')?'':'none';
        return result;
      };
      wrapped.__activityAware=true;
      root.openStudyRegister=wrapped;
    }

    function patchQuickRender(){
      if(typeof root.renderSessionQuickStudy!=='function'||root.renderSessionQuickStudy.__activityAware)return;
      const original=root.renderSessionQuickStudy;
      const wrapped=function(){
        ensureSelectors();
        const result=original.apply(this,arguments);
        syncSelectors(doc.getElementById('sessionQuickStudyActivity')?.value||storedType());
        return result;
      };
      wrapped.__activityAware=true;
      root.renderSessionQuickStudy=wrapped;
    }

    function decorateFeedback(){
      if(typeof root.showSessionQuickStudyFeedback!=='function'||root.showSessionQuickStudyFeedback.__activityAware)return;
      const original=root.showSessionQuickStudyFeedback;
      const wrapped=function(message){
        const minutes=Number(doc.getElementById('sessionQuickStudyMinutes')?.value)||0;
        const type=selectedType(),info=TYPES[type];
        if(minutes>0){
          const net=Math.round(equivalentMinutes(minutes,type)*10)/10;
          message=minutes+' min reales · '+String(net).replace('.',',')+' min netos · '+info.label;
        }
        return original.call(this,message);
      };
      wrapped.__activityAware=true;
      root.showSessionQuickStudyFeedback=wrapped;
    }

    function boot(){
      ensureSelectors();
      patchPlantWriter();
      patchPersistence();
      patchMode();
      patchOpen();
      patchQuickRender();
      decorateFeedback();
    }

    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});
    else boot();
  }

  return {TYPES,normalize,factor,equivalentMinutes,optionHtml,installBrowser};
});
