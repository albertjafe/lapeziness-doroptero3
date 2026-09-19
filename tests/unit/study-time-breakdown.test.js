import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const T=require('../../study-time-breakdown.js');

describe('study time breakdown',()=>{
  it('keeps net and real minutes separate and reports their ratio',()=>{
    const result=T.summarizeBlocks([
      {mins:180,rawMins:180,activityType:'study'},
      {mins:20,rawMins:60,activityType:'chamber'}
    ]);
    expect(result.net).toBe(200);
    expect(result.real).toBe(240);
    expect(result.ratio).toBeCloseTo(83.333333,5);
  });

  it('treats missing raw minutes as equal to net minutes for legacy blocks',()=>{
    expect(T.summarizeBlocks([{mins:45}])).toEqual({net:45,real:45,ratio:100});
  });

  it('reports zero ratio when there is no study',()=>{
    expect(T.summarizeBlocks([])).toEqual({net:0,real:0,ratio:0});
  });
});
