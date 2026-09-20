import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const A=require('../../manual-study-activity.js');

describe('manual study activity',()=>{
  it('uses the same activity factors as the piano timer',()=>{
    expect(A.factor('study')).toBe(1);
    expect(A.factor('mental')).toBe(1);
    expect(A.factor('piano_class')).toBe(.5);
    expect(A.factor('chamber')).toBeCloseTo(1/3,10);
  });

  it('keeps real chamber minutes intact while projecting one third net',()=>{
    expect(A.equivalentMinutes(40,'chamber')).toBeCloseTo(13.3333333333,8);
  });

  it('falls back safely to normal study for unknown legacy values',()=>{
    expect(A.normalize('something-old')).toBe('study');
    expect(A.equivalentMinutes(40,'something-old')).toBe(40);
  });
});
