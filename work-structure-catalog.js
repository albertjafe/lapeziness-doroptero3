(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WorkStructureCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const WORKS = [
    { composer:'Bach', title:'Suite inglesa n.º 2 en la menor, BWV 807', aliases:['english suite 2 bwv 807','bach bwv 807'], movements:[
      {name:'I. Prélude',duration:5},{name:'II. Allemande',duration:4},{name:'III. Courante',duration:2.5},{name:'IV. Sarabande',duration:4.5},{name:'V. Bourrée I – Bourrée II',duration:4},{name:'VI. Gigue',duration:3.5}
    ]},
    { composer:'Bartók', title:'Sonata para piano (1926), Sz. 80, BB 88', aliases:['bartok sonata 1926','bartok piano sonata sz 80','bartok bb 88','sonata para piano sz 80'], movements:[
      {name:'I. Allegro moderato',duration:null},{name:'II. Sostenuto e pesante',duration:null},{name:'III. Allegro molto',duration:null}
    ]},
    { composer:'Beethoven', title:'Concierto para piano n.º 3 en do menor, Op. 37', aliases:['beethoven piano concerto 3 op 37','beethoven concierto 3 op 37','concierto piano 3 op 37'], movements:[
      {name:'I. Allegro con brio',duration:17},{name:'II. Largo',duration:10},{name:'III. Rondo. Allegro',duration:10}
    ]},
    { composer:'Beethoven', title:'Sonata para piano n.º 11 en si bemol mayor, Op. 22', aliases:['beethoven op 22','sonata 11 op 22'], movements:[
      {name:'I. Allegro con brio',duration:8},{name:'II. Adagio con molta espressione',duration:8},{name:'III. Menuetto',duration:4},{name:'IV. Rondo. Allegretto',duration:6}
    ]},
    { composer:'Beethoven', title:'Sonata para piano n.º 21 en do mayor, Op. 53 «Waldstein»', aliases:['waldstein','beethoven op 53','sonata 21 op 53'], movements:[
      {name:'I. Allegro con brio',duration:11},{name:'II. Introduzione. Adagio molto',duration:4},{name:'III. Rondo. Allegretto moderato – Prestissimo',duration:10}
    ]},
    { composer:'Beethoven', title:'Sonata para piano n.º 32 en do menor, Op. 111', aliases:['beethoven op 111','sonata 32 op 111'], movements:[
      {name:'I. Maestoso – Allegro con brio ed appassionato',duration:9},{name:'II. Arietta. Adagio molto semplice e cantabile',duration:17}
    ]},
    { composer:'Beethoven', title:'Sonata para violonchelo n.º 3 en la mayor, Op. 69', aliases:['beethoven cello op 69','beethoven violonchelo op 69','cello sonata 3 op 69'], movements:[
      {name:'I. Allegro ma non tanto',duration:8},{name:'II. Scherzo. Allegro molto',duration:5},{name:'III. Adagio cantabile – Allegro vivace',duration:7}
    ]},
    { composer:'Brahms', title:'Sonata para piano n.º 1 en do mayor, Op. 1', aliases:['brahms sonata 1 op 1','brahms op 1'], movements:[
      {name:'I. Allegro',duration:9},{name:'II. Andante',duration:7},{name:'III. Scherzo. Allegro molto e con fuoco',duration:5},{name:'IV. Finale. Allegro con fuoco',duration:6}
    ]},
    { composer:'Brahms', title:'Sonata para violonchelo n.º 2 en fa mayor, Op. 99', aliases:['brahms cello sonata 2 op 99','brahms op 99 cello'], movements:[
      {name:'I. Allegro vivace',duration:9},{name:'II. Adagio affettuoso',duration:7},{name:'III. Allegro passionato',duration:7},{name:'IV. Allegro molto',duration:4}
    ]},
    { composer:'Brahms', title:'Trío con piano n.º 1 en si mayor, Op. 8', aliases:['brahms piano trio 1 op 8','brahms trio op 8'], movements:[
      {name:'I. Allegro con brio',duration:14},{name:'II. Scherzo. Allegro molto',duration:7},{name:'III. Adagio',duration:8},{name:'IV. Allegro',duration:7}
    ]},
    { composer:'Haydn', title:'Sonata para piano en fa mayor, Hob. XVI:23', aliases:['haydn hob xvi 23','haydn sonata 23'], movements:[
      {name:'I. Allegro moderato',duration:5},{name:'II. Adagio',duration:5},{name:'III. Finale. Presto',duration:3}
    ]},
    { composer:'Haydn', title:'Sonata para piano en re mayor, Hob. XVI:33', aliases:['haydn hob xvi 33','haydn sonata 33'], movements:[
      {name:'I. Allegro',duration:5},{name:'II. Adagio',duration:4},{name:'III. Tempo di Menuetto',duration:3}
    ]},
    { composer:'Mozart', title:'Sonata para piano n.º 18 en re mayor, K. 576', aliases:['mozart k 576','mozart sonata 576'], movements:[
      {name:'I. Allegro',duration:5},{name:'II. Adagio',duration:5},{name:'III. Allegretto',duration:4}
    ]},
    { composer:'Prokofiev', title:'Sonata para piano n.º 7 en si bemol mayor, Op. 83', aliases:['prokofiev sonata 7 op 83','prokofiev op 83'], movements:[
      {name:'I. Allegro inquieto',duration:8},{name:'II. Andante caloroso',duration:6},{name:'III. Precipitato',duration:4}
    ]},
    { composer:'Rachmaninov', title:'Concierto para piano n.º 3 en re menor, Op. 30', aliases:['rachmaninov concerto 3 op 30','rach 3 op 30'], movements:[
      {name:'I. Allegro ma non tanto',duration:16},{name:'II. Intermezzo. Adagio',duration:11},{name:'III. Finale. Alla breve',duration:15}
    ]},
    { composer:'Rachmaninov', title:'Momentos musicales, Op. 16', aliases:['rachmaninov op 16','moments musicaux op 16','momentos op 16'], movements:[
      {name:'I. Andantino',duration:6},{name:'II. Allegretto',duration:2},{name:'III. Andante cantabile',duration:4},{name:'IV. Presto',duration:3},{name:'V. Adagio sostenuto',duration:4},{name:'VI. Maestoso',duration:4}
    ]},
    { composer:'Schumann', title:'Concierto para piano en la menor, Op. 54', aliases:['schumann piano concerto op 54','schumann concierto op 54'], movements:[
      {name:'I. Allegro affettuoso',duration:14},{name:'II. Intermezzo. Andantino grazioso',duration:5},{name:'III. Allegro vivace',duration:10}
    ]},
    { composer:'Tchaikovsky', title:'Concierto para piano n.º 1 en si bemol menor, Op. 23', aliases:['tchaikovsky piano concerto 1 op 23','tchaikovsky concierto 1 op 23','concierto piano 1 op 23'], movements:[
      {name:'I. Allegro non troppo e molto maestoso – Allegro con spirito',duration:20},{name:'II. Andantino semplice – Prestissimo – Tempo I',duration:7},{name:'III. Allegro con fuoco',duration:7}
    ]}
  ];

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/[º°ª]/g,'').replace(/[«»“”„'’]/g,'').replace(/\bopus\b/g,'op')
      .replace(/\bno\.?\b|\bnro\.?\b|\bnum\.?\b|\bnumero\b/g,'n').replace(/[^a-z0-9]+/g,' ').trim();
  }
  function tokens(value){ return new Set(normalize(value).split(/\s+/).filter(Boolean)); }
  function scoreCandidate(entry, composer, title) {
    const query=normalize(`${composer||''} ${title||''}`); if(!query) return 0;
    const candidates=[entry.title].concat(entry.aliases||[]).map(alias=>normalize(`${entry.composer} ${alias}`));
    let best=0;
    candidates.forEach(candidate=>{
      if(query===candidate) best=Math.max(best,100);
      if(query.includes(candidate)||candidate.includes(query)) best=Math.max(best,92);
      const q=tokens(query),c=tokens(candidate),common=Array.from(q).filter(token=>c.has(token)).length;
      const coverage=common/Math.max(1,Math.min(q.size,c.size));
      const comp=normalize(composer),entryComp=normalize(entry.composer);
      const composerMatch=Boolean(comp)&&(comp.includes(entryComp)||entryComp.includes(comp));
      best=Math.max(best,coverage*75+(composerMatch?15:0));
    });
    return best;
  }
  function matchWorkStructure(workOrComposer,maybeTitle){
    const work=typeof workOrComposer==='object'&&workOrComposer?workOrComposer:{composer:workOrComposer,name:maybeTitle};
    let winner=null,winnerScore=0;
    WORKS.forEach(entry=>{const score=scoreCandidate(entry,work.composer||'',work.name||work.title||'');if(score>winnerScore){winner=entry;winnerScore=score;}});
    return winnerScore>=72?{...winner,score:Math.round(winnerScore)}:null;
  }
  function isGenericMovementName(name){const n=normalize(name);return !n||/^movimiento\s*\d+$/.test(n)||/^movement\s*\d+$/.test(n)||/^(i|ii|iii|iv|v|vi|vii|viii)\.?$/.test(n);}
  function makeMovement(template,index){return {id:`mv${Date.now()}_${index}_${Math.random().toString(36).slice(2,7)}`,name:template.name,duracion:template.duration,duracionEstimada:true,duracionFuente:'catalogo-curado',dificultad:5,apr:1,esc:1,sol:1,solHistory:[],paseHistory:[],zoneHistory:[],compasHistory:[],compasActual:null,compasesTotal:null,lastPase:null};}
  function completeWorkStructure(work,structure){
    if(!work)return{work,changed:false,structure:null};const matched=structure||matchWorkStructure(work);if(!matched)return{work,changed:false,structure:null};
    const clone={...work,movimientos:Array.isArray(work.movimientos)?work.movimientos.map(m=>({...m})):[]};let changed=false;
    if(!clone.movimientos.length){clone.movimientos=matched.movements.map(makeMovement);changed=true;}
    else if(clone.movimientos.length===matched.movements.length){clone.movimientos=clone.movimientos.map((movement,index)=>{const template=matched.movements[index],next={...movement};if(isGenericMovementName(next.name)&&template.name){next.name=template.name;changed=true;}if(next.duracion==null&&template.duration!=null){next.duracion=template.duration;next.duracionEstimada=true;next.duracionFuente:'catalogo-curado';changed=true;}return next;});}
    return{work:clone,changed,structure:matched};
  }
  return{WORKS,normalize,isGenericMovementName,matchWorkStructure,completeWorkStructure};
});
