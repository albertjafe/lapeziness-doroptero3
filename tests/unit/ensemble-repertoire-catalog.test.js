import vm from 'node:vm';
import fs from 'node:fs';
import {describe,it,expect} from 'vitest';

const structureSource=fs.readFileSync('work-structure-catalog.js','utf8');
const ensembleSource=fs.readFileSync('ensemble-repertoire-catalog.js','utf8');

function loadCatalog(){
  const context={
    console,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    JSON,
    setTimeout:()=>0,
  };
  vm.createContext(context);
  vm.runInContext(structureSource,context);
  vm.runInContext(ensembleSource,context);
  return {
    core:context.WorkStructureCatalog,
    catalog:context.EnsembleRepertoireCatalog,
  };
}

describe('chamber and accompaniment repertoire catalog',()=>{
  it('contains a broad standard catalog with movement metadata',()=>{
    const {catalog}=loadCatalog();
    const entries=catalog.getCatalog();
    expect(catalog.version).toBe(1);
    expect(entries.length).toBeGreaterThanOrEqual(130);
    expect(entries.every(entry=>entry.composer&&entry.title&&entry.instrumentation)).toBe(true);
    expect(entries.every(entry=>Array.isArray(entry.movements)&&entry.movements.length>0)).toBe(true);
    expect(entries.some(entry=>entry.category==='camara')).toBe(true);
    expect(entries.some(entry=>entry.category==='acompanamiento')).toBe(true);
  });

  it('finds standard chamber works and concerto reductions',()=>{
    const {catalog}=loadCatalog();
    const franck=catalog.search('Franck violin',5);
    expect(franck.some(entry=>/Franck/.test(entry.composer)&&/Sonata para violín/.test(entry.title))).toBe(true);

    const concerto=catalog.search('Tchaikovsky concierto violin',5);
    const tchaikovsky=concerto.find(entry=>/Tchaikovsky/.test(entry.composer));
    expect(tchaikovsky?.category).toBe('acompanamiento');
    expect(tchaikovsky?.movements).toHaveLength(3);
  });

  it('repairs the stored Prokofiev Seventh Sonata from the existing core structure',()=>{
    const {catalog}=loadCatalog();
    const work={
      id:'o1779114554256',
      composer:'Prokofiev',
      name:'Sonata para piano n.º 7 en si bemol mayor, Op. 83',
      movimientos:[],
    };
    expect(catalog.completeWork(work)).toBe(true);
    expect(work.movimientos.map(movement=>movement.name)).toEqual([
      'I. Allegro inquieto',
      'II. Andante caloroso',
      'III. Precipitato',
    ]);
  });

  it('also recognises Prelude and Fugue as two structural units',()=>{
    const {catalog}=loadCatalog();
    const work={composer:'Bach',name:'Preludio y fuga en re mayor, BWV 874 (Clave bien temperado II)',movimientos:[]};
    expect(catalog.completeWork(work)).toBe(true);
    expect(work.movimientos.map(movement=>movement.name)).toEqual(['I. Prélude','II. Fugue']);
  });

  it('does not overwrite an existing personalised movement structure',()=>{
    const {catalog}=loadCatalog();
    const work={
      composer:'César Franck',
      name:'Sonata para violín y piano en la mayor, FWV 8',
      movimientos:[
        {id:'custom-a',name:'Bloque personal A',sol:73},
        {id:'custom-b',name:'Bloque personal B',sol:64},
      ],
    };
    expect(catalog.completeWork(work)).toBe(false);
    expect(work.movimientos).toEqual([
      {id:'custom-a',name:'Bloque personal A',sol:73},
      {id:'custom-b',name:'Bloque personal B',sol:64},
    ]);
  });

  it('can add movement structure to a chamber catalog work without adding the work itself',()=>{
    const {catalog}=loadCatalog();
    const work={composer:'Sergei Prokofiev',name:'Sonata para violín y piano n.º 2 en re mayor, Op. 94bis',movimientos:[]};
    expect(catalog.completeWork(work)).toBe(true);
    expect(work.movimientos).toHaveLength(4);
    expect(work.movimientos[0].name).toBe('I. Moderato');
    expect(work.movimientos[3].name).toBe('IV. Allegro con brio');
  });
});