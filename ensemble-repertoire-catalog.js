/* Catálogo curado de repertorio estándar de cámara con piano y reducciones
   pianísticas de conciertos solistas. No contiene partituras ni descarga datos.
   Referencias de alcance: categorías IMSLP de violin+piano, cello+piano y piano trio.
   La selección es deliberadamente canónica/práctica, no un espejo de miles de entradas. */
(function(root,factory){
  const api=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.EnsembleRepertoireCatalog=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
'use strict';

const VERSION=2;
const ENTRIES=[{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 1 en re mayor, Op. 12 n.º 1","catalog":"","aliases":[],"movements":["I. Allegro con brio","II. Tema con variazioni. Andante con moto","III. Rondo. Allegro"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 2 en la mayor, Op. 12 n.º 2","catalog":"","aliases":[],"movements":["I. Allegro vivace","II. Andante più tosto Allegretto","III. Allegro piacevole"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 3 en mi bemol mayor, Op. 12 n.º 3","catalog":"","aliases":[],"movements":["I. Allegro con spirito","II. Adagio con molta espressione","III. Rondo. Allegro molto"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 4 en la menor, Op. 23","catalog":"","aliases":[],"movements":["I. Presto","II. Andante scherzoso, più Allegretto","III. Allegro molto"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 5 en fa mayor, Op. 24 «Primavera»","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio molto espressivo","III. Scherzo. Allegro molto","IV. Rondo. Allegro ma non troppo"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 6 en la mayor, Op. 30 n.º 1","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio molto espressivo","III. Allegretto con variazioni"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 7 en do menor, Op. 30 n.º 2","catalog":"","aliases":[],"movements":["I. Allegro con brio","II. Adagio cantabile","III. Scherzo. Allegro","IV. Finale. Allegro"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 8 en sol mayor, Op. 30 n.º 3","catalog":"","aliases":[],"movements":["I. Allegro assai","II. Tempo di Minuetto","III. Allegro vivace"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 9 en la mayor, Op. 47 «Kreutzer»","catalog":"","aliases":[],"movements":["I. Adagio sostenuto – Presto","II. Andante con variazioni","III. Presto"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Ludwig van Beethoven","title":"Sonata para violín y piano n.º 10 en sol mayor, Op. 96","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Adagio espressivo","III. Scherzo. Allegro","IV. Poco Allegretto"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Johannes Brahms","title":"Sonata para violín y piano n.º 1 en sol mayor, Op. 78","catalog":"","aliases":[],"movements":["I. Vivace ma non troppo","II. Adagio","III. Allegro molto moderato"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Johannes Brahms","title":"Sonata para violín y piano n.º 2 en la mayor, Op. 100","catalog":"","aliases":[],"movements":["I. Allegro amabile","II. Andante tranquillo – Vivace","III. Allegretto grazioso (quasi Andante)"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Johannes Brahms","title":"Sonata para violín y piano n.º 3 en re menor, Op. 108","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio","III. Un poco presto e con sentimento","IV. Presto agitato"]},{"category":"camara","instrumentation":"Violín + piano","composer":"César Franck","title":"Sonata para violín y piano en la mayor, FWV 8","catalog":"","aliases":[],"movements":["I. Allegretto ben moderato","II. Allegro","III. Recitativo-Fantasia. Ben moderato","IV. Allegretto poco mosso"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Claude Debussy","title":"Sonata para violín y piano en sol menor, L. 140","catalog":"","aliases":[],"movements":["I. Allegro vivo","II. Intermède. Fantasque et léger","III. Finale. Très animé"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Maurice Ravel","title":"Sonata para violín y piano n.º 2 en sol mayor, M. 77","catalog":"","aliases":[],"movements":["I. Allegretto","II. Blues. Moderato","III. Perpetuum mobile. Allegro"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Sergei Prokofiev","title":"Sonata para violín y piano n.º 1 en fa menor, Op. 80","catalog":"","aliases":[],"movements":["I. Andante assai","II. Allegro brusco","III. Andante","IV. Allegrissimo"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Sergei Prokofiev","title":"Sonata para violín y piano n.º 2 en re mayor, Op. 94bis","catalog":"","aliases":[],"movements":["I. Moderato","II. Scherzo. Presto","III. Andante","IV. Allegro con brio"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Francis Poulenc","title":"Sonata para violín y piano, FP 119","catalog":"","aliases":[],"movements":["I. Allegro con fuoco","II. Intermezzo","III. Presto tragico"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Richard Strauss","title":"Sonata para violín y piano en mi bemol mayor, Op. 18","catalog":"","aliases":[],"movements":["I. Allegro ma non troppo","II. Improvisation. Andante cantabile","III. Finale. Andante – Allegro"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Edvard Grieg","title":"Sonata para violín y piano n.º 3 en do menor, Op. 45","catalog":"","aliases":[],"movements":["I. Allegro molto ed appassionato","II. Allegretto espressivo alla Romanza","III. Allegro animato"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Robert Schumann","title":"Sonata para violín y piano n.º 1 en la menor, Op. 105","catalog":"","aliases":[],"movements":["I. Mit leidenschaftlichem Ausdruck","II. Allegretto","III. Lebhaft"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Gabriel Fauré","title":"Sonata para violín y piano n.º 1 en la mayor, Op. 13","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Andante","III. Allegro vivo","IV. Allegro quasi presto"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Leoš Janáček","title":"Sonata para violín y piano","catalog":"","aliases":[],"movements":["I. Con moto","II. Ballada","III. Allegretto","IV. Adagio"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Béla Bartók","title":"Sonata para violín y piano n.º 1, Sz. 75","catalog":"","aliases":[],"movements":["I. Allegro appassionato","II. Adagio","III. Allegro"]},{"category":"camara","instrumentation":"Violín + piano","composer":"Béla Bartók","title":"Sonata para violín y piano n.º 2, Sz. 76","catalog":"","aliases":[],"movements":["I. Molto moderato","II. Allegretto"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Ludwig van Beethoven","title":"Sonata para violonchelo y piano n.º 1 en fa mayor, Op. 5 n.º 1","catalog":"","aliases":[],"movements":["I. Adagio sostenuto – Allegro","II. Rondo. Allegro vivace"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Ludwig van Beethoven","title":"Sonata para violonchelo y piano n.º 2 en sol menor, Op. 5 n.º 2","catalog":"","aliases":[],"movements":["I. Adagio sostenuto ed espressivo – Allegro molto più tosto presto","II. Rondo. Allegro"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Ludwig van Beethoven","title":"Sonata para violonchelo y piano n.º 3 en la mayor, Op. 69","catalog":"","aliases":[],"movements":["I. Allegro ma non tanto","II. Scherzo. Allegro molto","III. Adagio cantabile – Allegro vivace"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Ludwig van Beethoven","title":"Sonata para violonchelo y piano n.º 4 en do mayor, Op. 102 n.º 1","catalog":"","aliases":[],"movements":["I. Andante – Allegro vivace","II. Adagio – Tempo d'Andante – Allegro vivace"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Ludwig van Beethoven","title":"Sonata para violonchelo y piano n.º 5 en re mayor, Op. 102 n.º 2","catalog":"","aliases":[],"movements":["I. Allegro con brio","II. Adagio con molto sentimento d'affetto","III. Allegro – Allegro fugato"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Johannes Brahms","title":"Sonata para violonchelo y piano n.º 1 en mi menor, Op. 38","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Allegretto quasi Menuetto","III. Allegro"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Johannes Brahms","title":"Sonata para violonchelo y piano n.º 2 en fa mayor, Op. 99","catalog":"","aliases":[],"movements":["I. Allegro vivace","II. Adagio affettuoso","III. Allegro passionato","IV. Allegro molto"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Felix Mendelssohn","title":"Sonata para violonchelo y piano n.º 1 en si bemol mayor, Op. 45","catalog":"","aliases":[],"movements":["I. Allegro vivace","II. Andante","III. Allegro assai"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Felix Mendelssohn","title":"Sonata para violonchelo y piano n.º 2 en re mayor, Op. 58","catalog":"","aliases":[],"movements":["I. Allegro assai vivace","II. Allegretto scherzando","III. Adagio","IV. Molto allegro e vivace"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Frédéric Chopin","title":"Sonata para violonchelo y piano en sol menor, Op. 65","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Scherzo","III. Largo","IV. Finale. Allegro"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Edvard Grieg","title":"Sonata para violonchelo y piano en la menor, Op. 36","catalog":"","aliases":[],"movements":["I. Allegro agitato","II. Andante molto tranquillo","III. Allegro"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Sergei Rachmaninov","title":"Sonata para violonchelo y piano en sol menor, Op. 19","catalog":"","aliases":[],"movements":["I. Lento – Allegro moderato","II. Allegro scherzando","III. Andante","IV. Allegro mosso"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Claude Debussy","title":"Sonata para violonchelo y piano en re menor, L. 135","catalog":"","aliases":[],"movements":["I. Prologue. Lent","II. Sérénade. Modérément animé","III. Finale. Animé"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Sergei Prokofiev","title":"Sonata para violonchelo y piano en do mayor, Op. 119","catalog":"","aliases":[],"movements":["I. Andante grave","II. Moderato","III. Allegro ma non troppo"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Dmitri Shostakovich","title":"Sonata para violonchelo y piano en re menor, Op. 40","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Allegro","III. Largo","IV. Allegro"]},{"category":"camara","instrumentation":"Violonchelo + piano","composer":"Francis Poulenc","title":"Sonata para violonchelo y piano, FP 143","catalog":"","aliases":[],"movements":["I. Allegro. Tempo di marcia","II. Cavatine","III. Ballabile","IV. Finale"]},{"category":"camara","instrumentation":"Clarinete o viola + piano","composer":"Johannes Brahms","title":"Sonata n.º 1 en fa menor, Op. 120 n.º 1","catalog":"","aliases":[],"movements":["I. Allegro appassionato","II. Andante un poco Adagio","III. Allegretto grazioso","IV. Vivace"]},{"category":"camara","instrumentation":"Clarinete o viola + piano","composer":"Johannes Brahms","title":"Sonata n.º 2 en mi bemol mayor, Op. 120 n.º 2","catalog":"","aliases":[],"movements":["I. Allegro amabile","II. Allegro appassionato","III. Andante con moto – Allegro"]},{"category":"camara","instrumentation":"Clarinete + piano","composer":"Carl Maria von Weber","title":"Grand Duo Concertant en mi bemol mayor, Op. 48","catalog":"","aliases":[],"movements":["I. Allegro con fuoco","II. Andante con moto","III. Rondo. Allegro"]},{"category":"camara","instrumentation":"Clarinete + piano","composer":"Camille Saint-Saëns","title":"Sonata para clarinete y piano en mi bemol mayor, Op. 167","catalog":"","aliases":[],"movements":["I. Allegretto","II. Allegro animato","III. Lento","IV. Molto allegro – Allegretto"]},{"category":"camara","instrumentation":"Clarinete + piano","composer":"Francis Poulenc","title":"Sonata para clarinete y piano, FP 184","catalog":"","aliases":[],"movements":["I. Allegro tristamente","II. Romanza","III. Allegro con fuoco"]},{"category":"camara","instrumentation":"Flauta + piano","composer":"Francis Poulenc","title":"Sonata para flauta y piano, FP 164","catalog":"","aliases":[],"movements":["I. Allegretto malincolico","II. Cantilena","III. Presto giocoso"]},{"category":"camara","instrumentation":"Oboe + piano","composer":"Francis Poulenc","title":"Sonata para oboe y piano, FP 185","catalog":"","aliases":[],"movements":["I. Élégie","II. Scherzo","III. Déploration"]},{"category":"camara","instrumentation":"Oboe + piano","composer":"Camille Saint-Saëns","title":"Sonata para oboe y piano en re mayor, Op. 166","catalog":"","aliases":[],"movements":["I. Andantino","II. Allegretto","III. Molto allegro"]},{"category":"camara","instrumentation":"Fagot + piano","composer":"Camille Saint-Saëns","title":"Sonata para fagot y piano en sol mayor, Op. 168","catalog":"","aliases":[],"movements":["I. Allegretto moderato","II. Allegro scherzando","III. Molto adagio – Allegro moderato"]},{"category":"camara","instrumentation":"Trompa + piano","composer":"Ludwig van Beethoven","title":"Sonata para trompa y piano en fa mayor, Op. 17","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Poco Adagio, quasi Andante","III. Rondo. Allegro moderato"]},{"category":"camara","instrumentation":"Trompa + piano","composer":"Richard Strauss","title":"Andante para trompa y piano, TrV 155","catalog":"","aliases":[],"movements":["Andante"]},{"category":"camara","instrumentation":"Viola + piano","composer":"Rebecca Clarke","title":"Sonata para viola y piano","catalog":"","aliases":[],"movements":["I. Impetuoso","II. Vivace","III. Adagio – Allegro"]},{"category":"camara","instrumentation":"Viola + piano","composer":"Dmitri Shostakovich","title":"Sonata para viola y piano, Op. 147","catalog":"","aliases":[],"movements":["I. Moderato","II. Allegretto","III. Adagio"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Ludwig van Beethoven","title":"Trío con piano n.º 1 en mi bemol mayor, Op. 1 n.º 1","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio cantabile","III. Scherzo. Allegro assai","IV. Finale. Presto"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Ludwig van Beethoven","title":"Trío con piano n.º 2 en sol mayor, Op. 1 n.º 2","catalog":"","aliases":[],"movements":["I. Adagio – Allegro vivace","II. Largo con espressione","III. Scherzo. Allegro","IV. Finale. Presto"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Ludwig van Beethoven","title":"Trío con piano n.º 3 en do menor, Op. 1 n.º 3","catalog":"","aliases":[],"movements":["I. Allegro con brio","II. Andante cantabile con variazioni","III. Menuetto. Quasi Allegro","IV. Finale. Prestissimo"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Ludwig van Beethoven","title":"Trío con piano n.º 5 en re mayor, Op. 70 n.º 1 «Geister»","catalog":"","aliases":[],"movements":["I. Allegro vivace e con brio","II. Largo assai ed espressivo","III. Presto"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Ludwig van Beethoven","title":"Trío con piano n.º 6 en mi bemol mayor, Op. 70 n.º 2","catalog":"","aliases":[],"movements":["I. Poco sostenuto – Allegro ma non troppo","II. Allegretto","III. Allegretto ma non troppo","IV. Finale. Allegro"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Ludwig van Beethoven","title":"Trío con piano n.º 7 en si bemol mayor, Op. 97 «Archiduque»","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Scherzo. Allegro","III. Andante cantabile","IV. Allegro moderato – Presto"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Franz Schubert","title":"Trío con piano n.º 1 en si bemol mayor, D 898","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Andante un poco mosso","III. Scherzo. Allegro","IV. Rondo. Allegro vivace"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Franz Schubert","title":"Trío con piano n.º 2 en mi bemol mayor, D 929","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante con moto","III. Scherzo. Allegro moderato","IV. Allegro moderato"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Felix Mendelssohn","title":"Trío con piano n.º 1 en re menor, Op. 49","catalog":"","aliases":[],"movements":["I. Molto allegro ed agitato","II. Andante con moto tranquillo","III. Scherzo. Leggiero e vivace","IV. Finale. Allegro assai appassionato"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Felix Mendelssohn","title":"Trío con piano n.º 2 en do menor, Op. 66","catalog":"","aliases":[],"movements":["I. Allegro energico e con fuoco","II. Andante espressivo","III. Scherzo. Molto allegro quasi presto","IV. Finale. Allegro appassionato"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Robert Schumann","title":"Trío con piano n.º 1 en re menor, Op. 63","catalog":"","aliases":[],"movements":["I. Mit Energie und Leidenschaft","II. Lebhaft, doch nicht zu rasch","III. Langsam, mit inniger Empfindung","IV. Mit Feuer"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Johannes Brahms","title":"Trío con piano n.º 1 en si mayor, Op. 8","catalog":"","aliases":[],"movements":["I. Allegro con brio","II. Scherzo. Allegro molto","III. Adagio","IV. Allegro"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Johannes Brahms","title":"Trío con piano n.º 2 en do mayor, Op. 87","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante con moto","III. Scherzo. Presto","IV. Finale. Allegro giocoso"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Johannes Brahms","title":"Trío con piano n.º 3 en do menor, Op. 101","catalog":"","aliases":[],"movements":["I. Allegro energico","II. Presto non assai","III. Andante grazioso","IV. Allegro molto"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Antonín Dvořák","title":"Trío con piano n.º 3 en fa menor, Op. 65","catalog":"","aliases":[],"movements":["I. Allegro ma non troppo","II. Allegretto grazioso","III. Poco adagio","IV. Finale. Allegro con brio"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Antonín Dvořák","title":"Trío con piano n.º 4 en mi menor, Op. 90 «Dumky»","catalog":"","aliases":[],"movements":["I. Lento maestoso – Allegro quasi doppio movimento","II. Poco adagio – Vivace non troppo","III. Andante – Vivace non troppo","IV. Andante moderato – Allegretto scherzando","V. Allegro","VI. Lento maestoso – Vivace"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Pyotr Ilyich Tchaikovsky","title":"Trío con piano en la menor, Op. 50","catalog":"","aliases":[],"movements":["I. Pezzo elegiaco. Moderato assai – Allegro giusto","II. Tema con variazioni"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Maurice Ravel","title":"Trío con piano en la menor, M. 67","catalog":"","aliases":[],"movements":["I. Modéré","II. Pantoum. Assez vif","III. Passacaille. Très large","IV. Final. Animé"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Dmitri Shostakovich","title":"Trío con piano n.º 2 en mi menor, Op. 67","catalog":"","aliases":[],"movements":["I. Andante – Moderato","II. Allegro con brio","III. Largo","IV. Allegretto"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Bedřich Smetana","title":"Trío con piano en sol menor, Op. 15","catalog":"","aliases":[],"movements":["I. Moderato assai","II. Allegro, ma non agitato","III. Finale. Presto"]},{"category":"camara","instrumentation":"Violín + violonchelo + piano","composer":"Anton Arensky","title":"Trío con piano n.º 1 en re menor, Op. 32","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Scherzo. Allegro molto","III. Elegia. Adagio","IV. Finale. Allegro non troppo"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Wolfgang Amadeus Mozart","title":"Cuarteto con piano n.º 1 en sol menor, K. 478","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante","III. Rondo. Allegro moderato"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Wolfgang Amadeus Mozart","title":"Cuarteto con piano n.º 2 en mi bemol mayor, K. 493","catalog":"","aliases":[],"movements":["I. Allegro","II. Larghetto","III. Allegretto"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Robert Schumann","title":"Cuarteto con piano en mi bemol mayor, Op. 47","catalog":"","aliases":[],"movements":["I. Sostenuto assai – Allegro ma non troppo","II. Scherzo. Molto vivace","III. Andante cantabile","IV. Finale. Vivace"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Johannes Brahms","title":"Cuarteto con piano n.º 1 en sol menor, Op. 25","catalog":"","aliases":[],"movements":["I. Allegro","II. Intermezzo. Allegro ma non troppo","III. Andante con moto","IV. Rondo alla Zingarese. Presto"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Johannes Brahms","title":"Cuarteto con piano n.º 2 en la mayor, Op. 26","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Poco adagio","III. Scherzo. Poco allegro","IV. Finale. Allegro"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Johannes Brahms","title":"Cuarteto con piano n.º 3 en do menor, Op. 60","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Scherzo. Allegro","III. Andante","IV. Finale. Allegro comodo"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Gabriel Fauré","title":"Cuarteto con piano n.º 1 en do menor, Op. 15","catalog":"","aliases":[],"movements":["I. Allegro molto moderato","II. Scherzo. Allegro vivo","III. Adagio","IV. Allegro molto"]},{"category":"camara","instrumentation":"Violín + viola + violonchelo + piano","composer":"Antonín Dvořák","title":"Cuarteto con piano n.º 2 en mi bemol mayor, Op. 87","catalog":"","aliases":[],"movements":["I. Allegro con fuoco","II. Lento","III. Allegro moderato, grazioso","IV. Finale. Allegro ma non troppo"]},{"category":"camara","instrumentation":"2 violines + viola + violonchelo + piano","composer":"Robert Schumann","title":"Quinteto con piano en mi bemol mayor, Op. 44","catalog":"","aliases":[],"movements":["I. Allegro brillante","II. In modo d'una marcia. Un poco largamente","III. Scherzo. Molto vivace","IV. Allegro ma non troppo"]},{"category":"camara","instrumentation":"2 violines + viola + violonchelo + piano","composer":"Johannes Brahms","title":"Quinteto con piano en fa menor, Op. 34","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Andante, un poco Adagio","III. Scherzo. Allegro","IV. Finale. Poco sostenuto – Allegro non troppo"]},{"category":"camara","instrumentation":"2 violines + viola + violonchelo + piano","composer":"Antonín Dvořák","title":"Quinteto con piano n.º 2 en la mayor, Op. 81","catalog":"","aliases":[],"movements":["I. Allegro ma non tanto","II. Dumka. Andante con moto","III. Scherzo (Furiant). Molto vivace","IV. Finale. Allegro"]},{"category":"camara","instrumentation":"2 violines + viola + violonchelo + piano","composer":"César Franck","title":"Quinteto con piano en fa menor, FWV 7","catalog":"","aliases":[],"movements":["I. Molto moderato quasi lento – Allegro","II. Lento, con molto sentimento","III. Allegro non troppo, ma con fuoco"]},{"category":"camara","instrumentation":"2 violines + viola + violonchelo + piano","composer":"Dmitri Shostakovich","title":"Quinteto con piano en sol menor, Op. 57","catalog":"","aliases":[],"movements":["I. Prelude. Lento","II. Fugue. Adagio","III. Scherzo. Allegretto","IV. Intermezzo. Lento","V. Finale. Allegretto"]},{"category":"camara","instrumentation":"2 violines + viola + violonchelo + piano","composer":"Edward Elgar","title":"Quinteto con piano en la menor, Op. 84","catalog":"","aliases":[],"movements":["I. Moderato – Allegro","II. Adagio","III. Andante – Allegro"]},{"category":"camara","instrumentation":"Clarinete + violín + violonchelo + piano","composer":"Olivier Messiaen","title":"Quatuor pour la fin du Temps","catalog":"","aliases":[],"movements":["I. Liturgie de cristal","II. Vocalise, pour l'Ange qui annonce la fin du Temps","III. Abîme des oiseaux","IV. Intermède","V. Louange à l'Éternité de Jésus","VI. Danse de la fureur, pour les sept trompettes","VII. Fouillis d'arcs-en-ciel, pour l'Ange qui annonce la fin du Temps","VIII. Louange à l'Immortalité de Jésus"]},{"category":"camara","instrumentation":"Clarinete + violín + piano","composer":"Béla Bartók","title":"Contrastes, Sz. 111","catalog":"","aliases":[],"movements":["I. Verbunkos","II. Pihenő","III. Sebes"]},{"category":"camara","instrumentation":"Trompa + violín + piano","composer":"Johannes Brahms","title":"Trío para trompa, violín y piano en mi bemol mayor, Op. 40","catalog":"","aliases":[],"movements":["I. Andante","II. Scherzo. Allegro","III. Adagio mesto","IV. Finale. Allegro con brio"]},{"category":"camara","instrumentation":"Clarinete + violonchelo + piano","composer":"Johannes Brahms","title":"Trío para clarinete, violonchelo y piano en la menor, Op. 114","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio","III. Andantino grazioso","IV. Allegro"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para violín n.º 3 en sol mayor, K. 216","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio","III. Rondeau. Allegro"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para violín n.º 4 en re mayor, K. 218","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante cantabile","III. Rondeau. Andante grazioso – Allegro ma non troppo"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para violín n.º 5 en la mayor, K. 219","catalog":"","aliases":[],"movements":["I. Allegro aperto","II. Adagio","III. Rondeau. Tempo di Menuetto"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Ludwig van Beethoven","title":"Concierto para violín en re mayor, Op. 61","catalog":"","aliases":[],"movements":["I. Allegro ma non troppo","II. Larghetto","III. Rondo. Allegro"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Felix Mendelssohn","title":"Concierto para violín en mi menor, Op. 64","catalog":"","aliases":[],"movements":["I. Allegro molto appassionato","II. Andante","III. Allegretto non troppo – Allegro molto vivace"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Max Bruch","title":"Concierto para violín n.º 1 en sol menor, Op. 26","catalog":"","aliases":[],"movements":["I. Vorspiel. Allegro moderato","II. Adagio","III. Finale. Allegro energico"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Johannes Brahms","title":"Concierto para violín en re mayor, Op. 77","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Adagio","III. Allegro giocoso, ma non troppo vivace"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Pyotr Ilyich Tchaikovsky","title":"Concierto para violín en re mayor, Op. 35","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Canzonetta. Andante","III. Finale. Allegro vivacissimo"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Jean Sibelius","title":"Concierto para violín en re menor, Op. 47","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Adagio di molto","III. Allegro, ma non tanto"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Camille Saint-Saëns","title":"Concierto para violín n.º 3 en si menor, Op. 61","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Andantino quasi allegretto","III. Molto moderato e maestoso – Allegro non troppo"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Sergei Prokofiev","title":"Concierto para violín n.º 1 en re mayor, Op. 19","catalog":"","aliases":[],"movements":["I. Andantino","II. Scherzo. Vivacissimo","III. Moderato"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Sergei Prokofiev","title":"Concierto para violín n.º 2 en sol menor, Op. 63","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Andante assai","III. Allegro, ben marcato"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Dmitri Shostakovich","title":"Concierto para violín n.º 1 en la menor, Op. 77/99","catalog":"","aliases":[],"movements":["I. Nocturne. Moderato","II. Scherzo. Allegro","III. Passacaglia. Andante","IV. Burlesque. Allegro con brio"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Samuel Barber","title":"Concierto para violín, Op. 14","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante","III. Presto in moto perpetuo"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Erich Wolfgang Korngold","title":"Concierto para violín en re mayor, Op. 35","catalog":"","aliases":[],"movements":["I. Moderato nobile","II. Romance. Andante","III. Finale. Allegro assai vivace"]},{"category":"acompanamiento","instrumentation":"Violín + reducción de piano","composer":"Béla Bartók","title":"Concierto para violín n.º 2, Sz. 112","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Andante tranquillo","III. Allegro molto"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Joseph Haydn","title":"Concierto para violonchelo n.º 1 en do mayor, Hob. VIIb:1","catalog":"","aliases":[],"movements":["I. Moderato","II. Adagio","III. Allegro molto"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Joseph Haydn","title":"Concierto para violonchelo n.º 2 en re mayor, Hob. VIIb:2","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Adagio","III. Rondo. Allegro"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Robert Schumann","title":"Concierto para violonchelo en la menor, Op. 129","catalog":"","aliases":[],"movements":["I. Nicht zu schnell","II. Langsam","III. Sehr lebhaft"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Antonín Dvořák","title":"Concierto para violonchelo en si menor, Op. 104","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio ma non troppo","III. Finale. Allegro moderato"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Edward Elgar","title":"Concierto para violonchelo en mi menor, Op. 85","catalog":"","aliases":[],"movements":["I. Adagio – Moderato","II. Lento – Allegro molto","III. Adagio","IV. Allegro – Moderato – Allegro, ma non troppo"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Camille Saint-Saëns","title":"Concierto para violonchelo n.º 1 en la menor, Op. 33","catalog":"","aliases":[],"movements":["I. Allegro non troppo","II. Allegretto con moto","III. Tempo primo"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Édouard Lalo","title":"Concierto para violonchelo en re menor","catalog":"","aliases":[],"movements":["I. Prélude. Lento – Allegro maestoso","II. Intermezzo. Andantino con moto","III. Introduction. Andante – Allegro vivace"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Dmitri Shostakovich","title":"Concierto para violonchelo n.º 1 en mi bemol mayor, Op. 107","catalog":"","aliases":[],"movements":["I. Allegretto","II. Moderato","III. Cadenza","IV. Allegro con moto"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Sergei Prokofiev","title":"Sinfonía-Concierto para violonchelo, Op. 125","catalog":"","aliases":[],"movements":["I. Andante","II. Allegro giusto","III. Andante con moto"]},{"category":"acompanamiento","instrumentation":"Violonchelo + reducción de piano","composer":"Pyotr Ilyich Tchaikovsky","title":"Variaciones sobre un tema rococó, Op. 33","catalog":"","aliases":[],"movements":["Introduzione. Moderato assai quasi Andante","Tema. Moderato semplice","Variazione I. Tempo della Thema","Variazione II. Tempo della Thema","Variazione III. Andante sostenuto","Variazione IV. Andante grazioso","Variazione V. Allegro moderato","Variazione VI. Andante","Variazione VII e Coda. Allegro vivo"]},{"category":"acompanamiento","instrumentation":"Viola + reducción de piano","composer":"William Walton","title":"Concierto para viola","catalog":"","aliases":[],"movements":["I. Andante comodo","II. Vivo, e molto preciso","III. Allegro moderato"]},{"category":"acompanamiento","instrumentation":"Viola + reducción de piano","composer":"Béla Bartók","title":"Concierto para viola, Sz. 120","catalog":"","aliases":[],"movements":["I. Moderato","II. Adagio religioso","III. Allegro vivace"]},{"category":"acompanamiento","instrumentation":"Viola + reducción de piano","composer":"Franz Anton Hoffmeister","title":"Concierto para viola en re mayor","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio","III. Rondo"]},{"category":"acompanamiento","instrumentation":"Viola + reducción de piano","composer":"Carl Stamitz","title":"Concierto para viola n.º 1 en re mayor, Op. 1","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante moderato","III. Rondo"]},{"category":"acompanamiento","instrumentation":"Clarinete + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para clarinete en la mayor, K. 622","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio","III. Rondo. Allegro"]},{"category":"acompanamiento","instrumentation":"Flauta + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para flauta n.º 1 en sol mayor, K. 313","catalog":"","aliases":[],"movements":["I. Allegro maestoso","II. Adagio ma non troppo","III. Rondo. Tempo di Menuetto"]},{"category":"acompanamiento","instrumentation":"Flauta + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para flauta n.º 2 en re mayor, K. 314","catalog":"","aliases":[],"movements":["I. Allegro aperto","II. Andante ma non troppo","III. Allegro"]},{"category":"acompanamiento","instrumentation":"Oboe + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para oboe en do mayor, K. 314","catalog":"","aliases":[],"movements":["I. Allegro aperto","II. Adagio non troppo","III. Rondo. Allegretto"]},{"category":"acompanamiento","instrumentation":"Fagot + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para fagot en si bemol mayor, K. 191","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante ma Adagio","III. Rondo. Tempo di Menuetto"]},{"category":"acompanamiento","instrumentation":"Trompa + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para trompa n.º 2 en mi bemol mayor, K. 417","catalog":"","aliases":[],"movements":["I. Allegro maestoso","II. Andante","III. Rondo"]},{"category":"acompanamiento","instrumentation":"Trompa + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para trompa n.º 3 en mi bemol mayor, K. 447","catalog":"","aliases":[],"movements":["I. Allegro","II. Romance. Larghetto","III. Allegro"]},{"category":"acompanamiento","instrumentation":"Trompa + reducción de piano","composer":"Wolfgang Amadeus Mozart","title":"Concierto para trompa n.º 4 en mi bemol mayor, K. 495","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Romance. Andante","III. Rondo. Allegro vivace"]},{"category":"acompanamiento","instrumentation":"Clarinete + reducción de piano","composer":"Carl Maria von Weber","title":"Concierto para clarinete n.º 1 en fa menor, Op. 73","catalog":"","aliases":[],"movements":["I. Allegro","II. Adagio ma non troppo","III. Rondo. Allegretto"]},{"category":"acompanamiento","instrumentation":"Clarinete + reducción de piano","composer":"Carl Maria von Weber","title":"Concierto para clarinete n.º 2 en mi bemol mayor, Op. 74","catalog":"","aliases":[],"movements":["I. Allegro","II. Romanze. Andante con moto","III. Alla Polacca"]},{"category":"acompanamiento","instrumentation":"Oboe + reducción de piano","composer":"Richard Strauss","title":"Concierto para oboe en re mayor, TrV 292","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Andante","III. Vivace – Allegro"]},{"category":"acompanamiento","instrumentation":"Trompa + reducción de piano","composer":"Richard Strauss","title":"Concierto para trompa n.º 1 en mi bemol mayor, Op. 11","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante","III. Allegro"]},{"category":"acompanamiento","instrumentation":"Flauta + reducción de piano","composer":"Carl Nielsen","title":"Concierto para flauta, FS 119","catalog":"","aliases":[],"movements":["I. Allegro moderato","II. Allegretto"]},{"category":"acompanamiento","instrumentation":"Flauta + reducción de piano","composer":"Jacques Ibert","title":"Concierto para flauta","catalog":"","aliases":[],"movements":["I. Allegro","II. Andante","III. Allegro scherzando"]}];
const CORE_SOURCE='catalogo-curado';
let addWrapped=false;
let searchInstalled=false;

function norm(value){
  return String(value==null?'':value).replace(/œ/gi,'oe').replace(/æ/gi,'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[º°ª]/g,'').replace(/[’‘`´]/g,"'").replace(/\bopus\b/g,'op')
    .replace(/\b(?:numero|number|num|nro|nr|no)\.?\b/g,'n')
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function tokenSet(value){return new Set(norm(value).split(/\s+/).filter(Boolean));}
function composerLoose(value){
  const n=norm(value);
  return n.replace(/\b(johann sebastian|ludwig van|wolfgang amadeus|johannes|sergei|sergey|pyotr ilyich|dmitri|antonin|antonín|carl maria von|camille|francis|richard|robert|felix|edvard|claude|maurice|gabriel|leos|leos|bela|béla|franz|cesar|césar|edward|olivier)\b/g,'').replace(/\s+/g,' ').trim()||n;
}
function entryText(entry){
  return norm([entry.composer,entry.title,entry.catalog,entry.instrumentation,entry.category].concat(entry.aliases||[]).join(' '));
}
function scoreEntry(entry,composer,title){
  const qTitle=norm(title),qComposer=norm(composer);
  if(!qTitle)return 0;
  const titleText=norm([entry.title,entry.catalog].join(' '));
  const aliases=(entry.aliases||[]).map(norm);
  let score=0;
  if(qTitle===titleText||aliases.includes(qTitle))score=100;
  else if(titleText.includes(qTitle)||qTitle.includes(titleText))score=92;
  const q=tokenSet(qTitle),c=tokenSet(titleText+' '+aliases.join(' '));
  const common=[...q].filter(token=>c.has(token)).length;
  score=Math.max(score,common/Math.max(1,Math.min(q.size,c.size))*78);
  if(qComposer){
    const a=composerLoose(qComposer),b=composerLoose(entry.composer);
    if(a===b||a.includes(b)||b.includes(a))score+=18;
    else return 0;
  }
  return score;
}
function matchEntry(workOrComposer,maybeTitle){
  const work=typeof workOrComposer==='object'&&workOrComposer?workOrComposer:{composer:workOrComposer,name:maybeTitle};
  let best=null,bestScore=0;
  ENTRIES.forEach(entry=>{
    const score=scoreEntry(entry,work.composer||work.compositor||'',work.name||work.title||work.nombre||'');
    if(score>bestScore){best=entry;bestScore=score;}
  });
  return bestScore>=76?{...best,score:Math.round(bestScore)}:null;
}
function movementTemplate(name,index){
  return {
    id:'mv'+Date.now()+'_'+index+'_'+Math.random().toString(36).slice(2,7),
    name,
    duracion:null,
    duracionEstimada:true,
    duracionFuente:CORE_SOURCE,
    dificultad:5,apr:1,esc:1,sol:1,solHistory:[],paseHistory:[],zoneHistory:[],
    compasHistory:[],compasActual:null,compasesTotal:null,lastPase:null
  };
}
function genericMovement(name){
  const n=norm(name);
  return !n||/^movimiento\s*\d+$/.test(n)||/^movement\s*\d+$/.test(n)||/^(i|ii|iii|iv|v|vi|vii|viii)\.?$/.test(n);
}
function applyEntry(work,entry){
  if(!work||!entry||!Array.isArray(entry.movements)||!entry.movements.length)return false;
  let changed=false;
  if(entry.category==='camara'||entry.category==='acompanamiento'){
    if(!work.repertoireCategory){work.repertoireCategory=entry.category;changed=true;}
    if(!work.instrumentation&&!work.instrumentacion&&entry.instrumentation){work.instrumentation=entry.instrumentation;changed=true;}
  }
  const current=Array.isArray(work.movimientos)?work.movimientos:[];
  if(!current.length){
    work.movimientos=entry.movements.map(movementTemplate);
    return true;
  }
  if(current.length!==entry.movements.length)return changed;
  work.movimientos=current.map((movement,index)=>{
    if(!movement)return movement;
    if(genericMovement(movement.name)){
      changed=true;
      return {...movement,name:entry.movements[index]};
    }
    return movement;
  });
  return changed;
}
function soloExtraStructure(work){
  const composer=norm(work&& (work.composer||work.compositor));
  const title=norm(work&& (work.name||work.nombre||work.title));
  if(composer.includes('bach')){
    const m=title.match(/\bbwv\s*(\d{3})\b/);
    const bwv=m?Number(m[1]):0;
    if(bwv>=846&&bwv<=893)return {
      composer:'Johann Sebastian Bach',
      title:'Preludio y fuga, BWV '+bwv,
      movements:['I. Prélude','II. Fugue'],
      category:'estructura'
    };
  }
  if((composer.includes('kapral')||composer.includes('kapralova'))&&/\bop\s*13\b/.test(title)){
    if(/\b2\b.*\b3\b|n\s*2.*n\s*3/.test(title))return {
      composer:'Vítězslava Kaprálová',title:'Preludios de abril, Op. 13 (n.º 2 y 3)',
      movements:['II. Andante','III. Andante semplice'],category:'estructura'
    };
    return {
      composer:'Vítězslava Kaprálová',title:'Preludios de abril, Op. 13',
      movements:['I. Allegro ma non troppo','II. Andante','III. Andante semplice','IV. Vivo'],category:'estructura'
    };
  }
  return null;
}
function completeWork(work){
  if(!work||work.tipo==='actividad')return false;
  const core=root.WorkStructureCatalog;
  if(core&&typeof core.completeWorkStructure==='function'){
    const result=core.completeWorkStructure(work);
    if(result&&result.changed){
      work.movimientos=result.work.movimientos;
      return true;
    }
  }
  const own=matchEntry(work)||soloExtraStructure(work);
  return own?applyEntry(work,own):false;
}
function appDb(){
  try{if(typeof db!=='undefined'&&db)return db;}catch(error){}
  try{if(typeof DB!=='undefined'&&DB)return DB;}catch(error){}
  return root.db||root.DB||null;
}
function persist(){
  try{
    if(typeof root.saveData==='function'){
      const result=root.saveData();
      if(result&&typeof result.catch==='function')result.catch(()=>{});
    } else if(typeof root.saveLocalNow==='function') root.saveLocalNow();
  }catch(error){}
}
function enrichDatabase(save=true){
  const database=appDb();
  if(!database||!Array.isArray(database.obras))return [];
  const changed=[];
  database.obras.forEach(work=>{
    if(completeWork(work))changed.push(String(work.id||work.name||'obra'));
  });
  if(changed.length&&save)persist();
  return changed;
}
function search(query,limit=8,category=null){
  const q=norm(query);
  if(q.length<2)return [];
  const qt=tokenSet(q);
  return ENTRIES.map((entry,index)=>{
    if(category&&entry.category!==category)return null;
    const text=entryText(entry),tokens=tokenSet(text);
    let score=text.includes(q)?120:0;
    let common=0;
    for(const token of qt){
      if(tokens.has(token)){score+=18;common++;}
      else if([...tokens].some(word=>word.startsWith(token))){score+=12;common++;}
      else if(token.length>=5)return null;
    }
    if(common===qt.size)score+=20;
    return {entry,index,score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(item=>item.entry);
}
function labelCategory(entry){return entry.category==='acompanamiento'?'Acompañamiento · reducción de piano':'Cámara';}
function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function choose(entry){
  const title=document.getElementById('newObraName');
  const composer=document.getElementById('newObraComposer');
  if(title){title.value=entry.title;title.dataset.ensembleCatalog='1';}
  if(composer)composer.value=entry.composer;
  title&&title.dispatchEvent(new Event('change',{bubbles:true}));
  composer&&composer.dispatchEvent(new Event('change',{bubbles:true}));
  if(typeof root.updateAddObraPrediccion==='function')root.updateAddObraPrediccion();
  document.getElementById('workcatResults')?.classList.remove('open');
}
function renderSearch(){
  const input=document.getElementById('newObraName');
  const panel=document.getElementById('workcatResults');
  if(!input||!panel)return;
  panel.querySelector('.ensemblecat-section')?.remove();
  const isActivity=document.querySelector('#modalTipoSelector .origen-btn.active')?.dataset.tipo==='actividad';
  if(isActivity||String(input.value||'').trim().length<2)return;
  const results=search(input.value,6);
  if(!results.length)return;
  const section=document.createElement('div');
  section.className='ensemblecat-section';
  section.innerHTML='<div class="ensemblecat-heading">Cámara y acompañamientos</div>';
  results.forEach(entry=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='workcat-item ensemblecat-item';
    button.innerHTML='<span class="workcat-title">'+esc(entry.title)+'</span>'
      +'<span class="workcat-composer">'+esc(entry.composer)+'</span>'
      +'<span class="workcat-meta">'+esc(labelCategory(entry)+' · '+entry.instrumentation+' · '+entry.movements.length+' movimientos')+'</span>';
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>choose(entry));
    section.appendChild(button);
  });
  const manual=panel.querySelector('.workcat-manual');
  if(manual)panel.insertBefore(section,manual); else panel.appendChild(section);
  panel.classList.add('open');
}
function installSearch(){
  if(searchInstalled)return true;
  const input=document.getElementById('newObraName');
  const panel=document.getElementById('workcatResults');
  if(!input||!panel)return false;
  searchInstalled=true;
  const schedule=()=>setTimeout(renderSearch,0);
  input.addEventListener('input',schedule);
  input.addEventListener('focus',schedule);
  document.getElementById('modalTipoSelector')?.addEventListener('click',schedule);
  if(!document.getElementById('ensembleCatalogStyles')){
    const style=document.createElement('style');
    style.id='ensembleCatalogStyles';
    style.textContent='.ensemblecat-section{border-top:1px solid var(--border2);margin-top:3px;padding-top:4px}.ensemblecat-heading{padding:7px 11px 4px;font:600 8px/1.2 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}';
    document.head.appendChild(style);
  }
  return true;
}
function wrapAddObra(){
  if(addWrapped)return true;
  const original=root.addObra;
  if(typeof original!=='function')return false;
  const wrapped=function(){
    const result=original.apply(this,arguments);
    const finish=()=>{setTimeout(()=>enrichDatabase(true),0);};
    if(result&&typeof result.then==='function')return result.then(value=>{finish();return value;});
    finish();
    return result;
  };
  wrapped.__ensembleCatalogWrapped=true;
  wrapped.__original=original;
  root.addObra=wrapped;
  addWrapped=true;
  return true;
}
function boot(attempt=0){
  const ready=!!root.WorkStructureCatalog;
  if(ready){
    enrichDatabase(true);
    wrapAddObra();
    installSearch();
  }
  if((!ready||!addWrapped||!searchInstalled)&&attempt<120)setTimeout(()=>boot(attempt+1),100);
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot(0),{once:true});
  else boot(0);
}

return {
  version:VERSION,
  getCatalog:()=>ENTRIES.map(entry=>({...entry,movements:entry.movements.slice(),aliases:(entry.aliases||[]).slice()})),
  search,
  matchEntry,
  completeWork,
  enrichDatabase,
  soloExtraStructure
};
});
