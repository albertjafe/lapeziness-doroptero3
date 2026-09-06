import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Core=require('../../work-structure-catalog.js');
const Solo=require('../../solo-repertoire-structure.js');
Solo.install(Core);

function count(composer,name){
  const match=Core.matchWorkStructure({composer,name});
  return match&&match.movements.length;
}

describe('standard solo repertoire movement coverage',()=>{
  it('covers representative formal works across the piano catalogue',()=>{
    expect(count('Ludwig van Beethoven','Piano Sonata No. 19 in G minor, Op. 49 No. 1')).toBe(2);
    expect(count('Wolfgang Amadeus Mozart','Piano Sonata No. 11 in A major, K. 331')).toBe(3);
    expect(count('Joseph Haydn','Piano Sonata in G major, Hob. XVI:40')).toBe(2);
    expect(count('Johannes Brahms','Piano Sonata No. 3 in F minor, Op. 5')).toBe(5);
    expect(count('Franz Schubert','Piano Sonata in B-flat major, D 960')).toBe(4);
    expect(count('Sergei Prokofiev','Piano Sonata No. 6 in A major, Op. 82')).toBe(4);
    expect(count('Alexander Scriabin','Piano Sonata No. 4 in F-sharp major, Op. 30')).toBe(2);
    expect(count('Pyotr Ilyich Tchaikovsky','Grand Sonata in G major, Op. 37')).toBe(4);
  });

  it('keeps genuinely single-movement sonatas unsplit',()=>{
    expect(count('Sergei Prokofiev','Piano Sonata No. 1 in F minor, Op. 1')).toBe(null);
    expect(count('Sergei Prokofiev','Piano Sonata No. 3 in A minor, Op. 28')).toBe(null);
    expect(count('Alexander Scriabin','Piano Sonata No. 5, Op. 53')).toBe(null);
  });

  it('adds Bach suite and WTC subdivisions with meaningful names',()=>{
    expect(count('Johann Sebastian Bach','Well-Tempered Clavier II: Prelude and Fugue No. 24, BWV 893')).toBe(2);
    const partita=Core.matchWorkStructure({composer:'Johann Sebastian Bach',name:'Partita No. 3 in A minor, BWV 827'});
    expect(partita.movements).toHaveLength(7);
    expect(partita.movements[0].name).toContain('Fantasia');
    expect(partita.movements[6].name).toContain('Gigue');
  });

  it('preserves the exact Ravel Sonatine names from the curated core',()=>{
    const ravel=Core.matchWorkStructure({composer:'Maurice Ravel',name:'Sonatine, M.40'});
    expect(ravel.movements.map(m=>m.name)).toEqual(['I. Modéré','II. Mouvement de menuet','III. Animé']);
  });

  it('creates the correct count without overwriting a personalised structure',()=>{
    const fresh=Core.completeWorkStructure({composer:'Brahms',name:'Piano Sonata No. 3, Op. 5',movimientos:[]});
    expect(fresh.changed).toBe(true);
    expect(fresh.work.movimientos).toHaveLength(5);
    const custom={composer:'Brahms',name:'Piano Sonata No. 3, Op. 5',movimientos:[{id:'a',name:'Bloque A'},{id:'b',name:'Bloque B'}]};
    const result=Core.completeWorkStructure(custom);
    expect(result.changed).toBe(false);
    expect(result.work.movimientos).toEqual(custom.movimientos);
  });
});
