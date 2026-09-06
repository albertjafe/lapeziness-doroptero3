/* Cobertura estructural del catálogo pianístico estándar.
 * Extiende WorkStructureCatalog con movimientos de obras formales del WorkCatalog
 * que todavía no tienen una ficha curada propia. Cuando no fijamos un tempo,
 * usamos solo el numeral romano para no inventar información y permitir que una
 * ficha curada futura lo sustituya de forma segura.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.SoloRepertoireStructure=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';

const VERSION=1;
const ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
const ENTRIES=[];
const generic=count=>Array.from({length:count},(_,index)=>({name:(ROMAN[index]||String(index+1))+'.',duration:null}));
const named=names=>names.map(name=>({name,duration:null}));
const add=(composer,title,count,aliases=[],names=null)=>ENTRIES.push({composer,title,aliases,movements:names?named(names):generic(count)});

// Bach · parejas del Clave bien temperado, suites, partitas y formas claramente seccionales.
for(let i=0;i<24;i++){
  add('Bach',`Well-Tempered Clavier I: Prelude and Fugue No. ${i+1}`,2,[`bwv ${846+i}`,`wtc 1 ${i+1}`],['I. Prélude','II. Fugue']);
  add('Bach',`Well-Tempered Clavier II: Prelude and Fugue No. ${i+1}`,2,[`bwv ${870+i}`,`wtc 2 ${i+1}`],['I. Prélude','II. Fugue']);
}
const bachPartitas=[
  ['Partita No. 1',['I. Praeludium','II. Allemande','III. Corrente','IV. Sarabande','V. Menuet I – Menuet II','VI. Gigue']],
  ['Partita No. 2',['I. Sinfonia','II. Allemande','III. Courante','IV. Sarabande','V. Rondeaux','VI. Capriccio']],
  ['Partita No. 3',['I. Fantasia','II. Allemande','III. Corrente','IV. Sarabande','V. Burlesca','VI. Scherzo','VII. Gigue']],
  ['Partita No. 4',['I. Ouverture','II. Allemande','III. Courante','IV. Aria','V. Sarabande','VI. Menuet','VII. Gigue']],
  ['Partita No. 5',['I. Praeambulum','II. Allemande','III. Corrente','IV. Sarabande','V. Tempo di Minuetto','VI. Passepied','VII. Gigue']],
  ['Partita No. 6',['I. Toccata','II. Allemanda','III. Corrente','IV. Air','V. Sarabande','VI. Tempo di Gavotta','VII. Gigue']],
];
bachPartitas.forEach(([title,names])=>add('Bach',title,names.length,[],names));
const englishSuites=[
  ['English Suite No. 1',['I. Prélude','II. Allemande','III. Courante I','IV. Courante II avec deux doubles','V. Sarabande','VI. Bourrée I – Bourrée II','VII. Gigue']],
  ['English Suite No. 2',['I. Prélude','II. Allemande','III. Courante','IV. Sarabande','V. Bourrée I – Bourrée II','VI. Gigue']],
  ['English Suite No. 3',['I. Prélude','II. Allemande','III. Courante','IV. Sarabande','V. Gavotte I – Gavotte II','VI. Gigue']],
  ['English Suite No. 4',['I. Prélude','II. Allemande','III. Courante','IV. Sarabande','V. Menuet I – Menuet II','VI. Gigue']],
  ['English Suite No. 5',['I. Prélude','II. Allemande','III. Courante','IV. Sarabande','V. Passepied I – Passepied II','VI. Gigue']],
  ['English Suite No. 6',['I. Prélude','II. Allemande','III. Courante','IV. Sarabande','V. Gavotte I – Gavotte II','VI. Gigue']],
];
englishSuites.forEach(([title,names])=>add('Bach',title,names.length,[],names));
const frenchSuites=[
  ['French Suite No. 1',['I. Allemande','II. Courante','III. Sarabande','IV. Menuet I – Menuet II','V. Gigue']],
  ['French Suite No. 2',['I. Allemande','II. Courante','III. Sarabande','IV. Air','V. Menuet','VI. Gigue']],
  ['French Suite No. 3',['I. Allemande','II. Courante','III. Sarabande','IV. Anglaise','V. Menuet – Trio','VI. Gigue']],
  ['French Suite No. 4',['I. Allemande','II. Courante','III. Sarabande','IV. Gavotte','V. Menuet','VI. Air','VII. Gigue']],
  ['French Suite No. 5',['I. Allemande','II. Courante','III. Sarabande','IV. Gavotte','V. Bourrée','VI. Loure','VII. Gigue']],
  ['French Suite No. 6',['I. Allemande','II. Courante','III. Sarabande','IV. Gavotte','V. Polonaise','VI. Bourrée','VII. Menuet','VIII. Gigue']],
];
frenchSuites.forEach(([title,names])=>add('Bach',title,names.length,[],names));
add('Bach','Italian Concerto',3,['bwv 971'],['I. Allegro','II. Andante','III. Presto']);
add('Bach','Chromatic Fantasia and Fugue',2,['bwv 903'],['I. Fantasia','II. Fugue']);

// Beethoven · las 32 sonatas. Los numerales genéricos preservan el conteo sin inventar tempi.
const beethovenCounts=[4,4,4,4,3,3,4,3,3,3,4,4,4,3,4,3,3,4,2,2,3,2,3,2,3,3,2,4,4,3,3,2];
const beethovenOps=['Op. 2 No. 1','Op. 2 No. 2','Op. 2 No. 3','Op. 7','Op. 10 No. 1','Op. 10 No. 2','Op. 10 No. 3','Op. 13','Op. 14 No. 1','Op. 14 No. 2','Op. 22','Op. 26','Op. 27 No. 1','Op. 27 No. 2','Op. 28','Op. 31 No. 1','Op. 31 No. 2','Op. 31 No. 3','Op. 49 No. 1','Op. 49 No. 2','Op. 53','Op. 54','Op. 57','Op. 78','Op. 79','Op. 81a','Op. 90','Op. 101','Op. 106','Op. 109','Op. 110','Op. 111'];
beethovenCounts.forEach((count,index)=>add('Beethoven',`Piano Sonata No. ${index+1}`,count,[`beethoven ${beethovenOps[index]}`,`beethoven sonata ${index+1}`]));

// Mozart · las sonatas del catálogo actual son todas de tres movimientos.
['K. 279','K. 280','K. 281','K. 282','K. 283','K. 284','K. 309','K. 310','K. 311','K. 330','K. 331','K. 332','K. 333','K. 457','K. 533/494','K. 545','K. 570','K. 576']
  .forEach((catalog,index)=>add('Mozart',`Piano Sonata No. ${index+1}`,3,[`mozart ${catalog}`,`mozart sonata ${index+1}`]));

// Haydn · selección del WorkCatalog, con las sonatas bipartitas respetadas.
const haydnCounts={'XVI:20':3,'XVI:23':3,'XVI:24':3,'XVI:32':3,'XVI:33':3,'XVI:34':3,'XVI:35':3,'XVI:37':3,'XVI:40':2,'XVI:46':3,'XVI:48':2,'XVI:49':3,'XVI:50':3,'XVI:51':2,'XVI:52':3};
Object.entries(haydnCounts).forEach(([hob,count])=>add('Haydn',`Piano Sonata, Hob. ${hob}`,count,[`haydn hob ${hob}`,`hob ${hob}`]));

// Romanticismo y siglo XX · obras formalmente divididas del catálogo de piano.
add('Chopin','Piano Sonata No. 2',4,['chopin op 35','chopin sonata 2']);
add('Chopin','Piano Sonata No. 3',4,['chopin op 58','chopin sonata 3']);
add('Schumann','Fantaisie, Op. 17',3,['schumann op 17','schumann fantasie op 17']);
add('Schumann','Piano Sonata No. 1',4,['schumann op 11','schumann sonata 1']);
add('Schumann','Piano Sonata No. 2',4,['schumann op 22','schumann sonata 2']);
add('Schumann','Piano Sonata No. 3',4,['schumann op 14','schumann sonata 3']);
add('Brahms','Piano Sonata No. 1',4,['brahms op 1','brahms sonata 1']);
add('Brahms','Piano Sonata No. 2',4,['brahms op 2','brahms sonata 2']);
add('Brahms','Piano Sonata No. 3',5,['brahms op 5','brahms sonata 3']);
const schubertCounts={'D 664':3,'D 784':3,'D 840':4,'D 845':4,'D 850':4,'D 894':4,'D 958':4,'D 959':4,'D 960':4};
Object.entries(schubertCounts).forEach(([catalog,count])=>add('Schubert',`Piano Sonata, ${catalog}`,count,[`schubert ${catalog}`]));
add('Ravel','Sonatine, M. 40',3,['ravel sonatine','ravel sonatina','m 40'],['I. Modéré','II. Mouvement de menuet','III. Animé']);
add('Rachmaninov','Piano Sonata No. 1',3,['rachmaninov op 28','rachmaninoff op 28']);
add('Rachmaninov','Piano Sonata No. 2',3,['rachmaninov op 36','rachmaninoff op 36']);
const prokofievCounts=[1,4,1,3,3,4,3,3,4];
const prokofievOps=['Op. 1','Op. 14','Op. 28','Op. 29','Op. 38/135','Op. 82','Op. 83','Op. 84','Op. 103'];
prokofievCounts.forEach((count,index)=>{if(count>1)add('Prokofiev',`Piano Sonata No. ${index+1}`,count,[`prokofiev ${prokofievOps[index]}`,`prokofiev sonata ${index+1}`]);});
const scriabinCounts=[4,2,4,2];
const scriabinOps=['Op. 6','Op. 19','Op. 23','Op. 30'];
scriabinCounts.forEach((count,index)=>add('Scriabin',`Piano Sonata No. ${index+1}`,count,[`scriabin ${scriabinOps[index]}`,`scriabin sonata ${index+1}`]));
add('Mendelssohn','Fantasia “Scottish Sonata”',3,['mendelssohn op 28','scottish sonata']);
add('Tchaikovsky','Grand Sonata',4,['tchaikovsky op 37','grand sonata op 37']);
add('Bartók','Piano Sonata, Sz. 80',3,['bartok piano sonata','bartok sz 80'],['I. Allegro moderato','II. Sostenuto e pesante','III. Allegro molto']);
add('Kaprálová','April Preludes, Op. 13',4,['kapralova op 13','april preludes'],['I. Allegro ma non troppo','II. Andante','III. Andante semplice','IV. Vivo']);

function normalize(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[º°ª]/g,'').replace(/[«»“”„'’]/g,'').replace(/\bopus\b/g,'op')
    .replace(/\bno\.?\b|\bnro\.?\b|\bnum\.?\b|\bnumero\b/g,'n').replace(/[^a-z0-9]+/g,' ').trim();
}
function sameEntry(a,b){return normalize(a.composer)===normalize(b.composer)&&normalize(a.title)===normalize(b.title);}
function install(core){
  if(!core||!Array.isArray(core.WORKS))return false;
  if(core.__soloRepertoireStructureVersion===VERSION)return true;
  ENTRIES.forEach(entry=>{
    if(!core.WORKS.some(existing=>sameEntry(existing,entry)))core.WORKS.push({
      composer:entry.composer,
      title:entry.title,
      aliases:(entry.aliases||[]).slice(),
      movements:entry.movements.map(movement=>({...movement})),
    });
  });
  core.__soloRepertoireStructureVersion=VERSION;
  return true;
}

if(root&&root.WorkStructureCatalog)install(root.WorkStructureCatalog);
return {VERSION,ENTRIES,install};
});
