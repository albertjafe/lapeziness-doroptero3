/* Named diary sections are scoped to a work. Reuse existing passage IDs; new
   names live in journalSections and use the common document writer.
   Rendering and suggestions never change the database. */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.DiarioSections=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const clean=value=>String(value||'').replace(/[\[\]\r\n]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
  const key=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  function catalog(database,obraId){
    if(!obraId)return [];
    const work=(database.obras||[]).find(x=>x&&String(x.id)===String(obraId));
    const rows=[];
    for(const [kind,list] of [['passage',database.passageTracker?.passages],['section',database.journalSections]]){
      for(const row of Array.isArray(list)?list:[]){
        if(!row||!row.id||row.deleted||row.deletedAt||String(row.obraId)!==String(obraId)||!clean(row.name))continue;
        const movement=(work?.movimientos||[]).find(x=>x&&String(x.id)===String(row.movId));
        rows.push({id:row.id,kind,name:clean(row.name),obraId:row.obraId,movId:row.movId||null,movement:movement?.name||''});
      }
    }
    return rows.sort((a,b)=>a.name.localeCompare(b.name,'es')||a.movement.localeCompare(b.movement,'es'));
  }
  function suggest(database,obraId,query){
    const q=key(query);
    return catalog(database,obraId).filter(x=>!q||key(x.name).includes(q)).slice(0,12);
  }
  function register(database,obraId,name,now=new Date()){
    const value=clean(name);
    if(!value||!obraId||!(database.obras||[]).some(x=>x&&String(x.id)===String(obraId)))return null;
    const existing=catalog(database,obraId).filter(x=>key(x.name)===key(value));
    if(existing.length===1)return existing[0];
    if(existing.length>1)return null; // choose the named movement explicitly
    const stamp=now.toISOString();
    const row={id:'section_'+encodeURIComponent(String(obraId)+'\u0000'+key(value)),obraId,name:value,createdAt:stamp,updatedAt:stamp};
    if(!Array.isArray(database.journalSections))database.journalSections=[];
    database.journalSections.push(row);
    return {...row,kind:'section',movement:''};
  }
  function queryAt(text,caret){
    const value=String(text||''),end=Math.max(0,Math.min(value.length,Number(caret)||0));
    const start=value.lastIndexOf('\n',end-1)+1,line=value.slice(start,end);
    const match=/^(\s*)@([^\[\]\n@]{0,80})$/.exec(line);
    return match?{start:start+match[1].length,end,query:match[2]}:null;
  }
  function insert(text,range,section){
    const value=String(text||''),token='[['+clean(section.name)+']]';
    const tail=value.slice(range.end),suffix=tail.startsWith('\n')?'':'\n';
    const next=value.slice(0,range.start)+token+suffix+tail;
    return {value:next,caret:range.start+token.length+1};
  }
  function references(text,rows,previous=[]){
    const names=[...String(text||'').matchAll(/^\s*\[\[([^\]\n]+)\]\]\s*$/gm)].map(x=>key(x[1]));
    previous=Array.isArray(previous)?previous:[];
    const out=[];
    for(const name of new Set(names)){
      const prior=previous.find(x=>key(x.name)===name);
      const choices=rows.filter(x=>key(x.name)===name);
      const row=prior|| (choices.length===1?choices[0]:null);
      if(row)out.push({id:row.id,kind:row.kind,name:row.name,obraId:row.obraId});
    }
    return out;
  }
  return {clean,key,catalog,suggest,register,queryAt,insert,references};
});
