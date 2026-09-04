import {describe,it,expect} from 'vitest';
import {assertUniqueDynamicScriptLoads,runtimeAssets} from '../../scripts/check-runtime.mjs';
const helper="function load(id,src){if(document.getElementById(id))return;const s=document.createElement('script');s.id=id;s.src=src;document.head.appendChild(s);}";
describe('runtime loader graph',()=>{
  it('rejects the same asset loaded by helpers with distinct DOM IDs, across URL versions',()=>{
    const sources=new Map([['one.js',helper+"load('one','./persist.js?v=342');"],['two.js',helper+"load('two','persist.js?v=343');"]]);
    expect(()=>assertUniqueDynamicScriptLoads(sources)).toThrow(/Duplicate dynamic script persist.js.*one.*two/);
  });
  it('detects a literal script injection that duplicates a helper under another ID',()=>{
    const sources=new Map([['one.js',helper+"load('one','./persist.js?v=342');"],
      ['two.js',"const loader=document.createElement('script');loader.id='two';loader.src='./persist.js?v=342';document.head.appendChild(loader);"]]);
    expect(()=>assertUniqueDynamicScriptLoads(sources)).toThrow(/Duplicate dynamic script/);
  });
  it('permits a shared guarded DOM ID and separate Worker imports',()=>{
    const sources=new Map([['one.js',helper+"load('same','./persist.js?v=342');"],['two.js',helper+"load('same','persist.js?v=342');"],
      ['worker.js',"importScripts('./persist.js?v=342');"]]);
    expect(assertUniqueDynamicScriptLoads(sources)).toHaveLength(2);
  });
  it('requires a documented reason for an intentional duplicate',()=>{
    const sources=new Map([['one.js',helper+"load('a','persist.js');load('b','persist.js');"]]);
    expect(()=>assertUniqueDynamicScriptLoads(sources,{'persist.js':''})).toThrow();
    expect(assertUniqueDynamicScriptLoads(sources,{'persist.js':'Test-only independent instances'})).toHaveLength(2);
  });
  it('validates the actual reachable runtime graph without duplicate persistence loaders',()=>{
    expect(runtimeAssets()).toContain('./local-save-resilience.js?v=342');
  });
});
