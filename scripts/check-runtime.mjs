import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Inventory the repo's ID/src loader helpers and literal DOM script injections.
// Worker importScripts run in a separate realm and are intentionally excluded.
export function assertUniqueDynamicScriptLoads(sources, intentional={}){
  const loads=[];
  for(const [file,source] of sources){
    const helpers=new Set([...source.matchAll(/function\s+(\w+)\s*\(\s*id\s*,\s*src\b/g)].map(m=>m[1]));
    for(const m of source.matchAll(/\b(\w+)\(\s*['"]([^'"]+)['"]\s*,\s*['"]((?:\.\/)?[\w-]+\.js(?:\?v=\d+)?)['"]/g)){
      if(helpers.has(m[1]))loads.push({file,id:m[2],url:m[3]});
    }
    for(const m of source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*document\.createElement\(['"]script['"]\)/g)){
      const tail=source.slice(m.index),end=new RegExp('appendChild\\(\\s*'+m[1]+'\\s*\\)').exec(tail);
      if(!end)continue;
      const block=tail.slice(0,end.index);
      const literal=property=>new RegExp('\\b'+m[1]+'\\.'+property+'\\s*=\\s*[\'"]([^\'"]+)[\'"]').exec(block)?.[1];
      const url=literal('src');
      if(url&&/^(?:\.\/)?[\w-]+\.js(?:\?v=\d+)?$/.test(url))loads.push({file,id:literal('id')||'no-id:'+file+':'+m.index,url});
    }
  }
  const grouped=new Map();
  for(const entry of loads){
    const asset=entry.url.replace(/^\.\//,'').split('?')[0];
    if(!grouped.has(asset))grouped.set(asset,[]);
    grouped.get(asset).push(entry);
  }
  for(const [asset,entries] of grouped){
    if(new Set(entries.map(e=>e.id)).size<2)continue; // shared DOM ID guard
    if(typeof intentional[asset]==='string'&&intentional[asset].trim())continue;
    throw Error('Duplicate dynamic script '+asset+': '+entries.map(e=>e.file+' ['+e.id+']').join(', '));
  }
  return loads;
}
export function runtimeAssets(){
  const assets=new Set(['./index.html','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png']);
  const pending=['index.html'],seen=new Set(),sources=new Map();
  while(pending.length){
    const file=pending.pop();if(seen.has(file))continue;seen.add(file);
    const text=fs.readFileSync(path.join(root,file),'utf8');
    sources.set(file,text);
    for(const m of text.matchAll(/['"]((?:\.\/)?[\w-]+\.(?:js|css)(?:\?v=\d+)?)['"]/g)){
      const url='./'+m[1].replace(/^\.\//,'');const name=url.slice(2).split('?')[0];
      if(name==='sw.js')continue;
      if(!fs.existsSync(path.join(root,name)))throw Error('Missing runtime asset '+url);
      assets.add(url);pending.push(name);
    }
  }
  assertUniqueDynamicScriptLoads(sources);
  return [...assets].sort();
}
export function check(){
  const assets=runtimeAssets(),worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const declared=JSON.parse(worker.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
  for(const url of assets)if(!declared.includes(url))throw Error('SW does not precache '+url);
  for(const url of declared)if(!assets.includes(url))throw Error('Unused SW precache '+url);
  const versions=new Map();
  for(const url of assets){
    const [name,query]=url.split('?');
    if(versions.has(name)&&versions.get(name)!==query)throw Error('Mixed versions for '+name);
    versions.set(name,query);
  }
  for(const file of [...versions.keys(),'./sw.js'].filter(x=>x.endsWith('.js'))){
    const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
    if(result.status)throw Error(file+'\n'+result.stderr);
  }
  console.log(`Runtime verified: ${assets.length} assets; syntax, loader versions, unique dynamic script IDs and SW precache agree.`);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))check();
