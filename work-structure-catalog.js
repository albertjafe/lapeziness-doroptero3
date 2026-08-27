(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WorkStructureCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const WORKS = [
    {
      composer: 'Beethoven',
      title: 'Concierto para piano n.º 3 en do menor, Op. 37',
      aliases: ['beethoven piano concerto 3 op 37', 'beethoven concierto 3 op 37', 'concierto piano 3 op 37'],
      movements: [
        { name: 'I. Allegro con brio', duration: 17 },
        { name: 'II. Largo', duration: 10 },
        { name: 'III. Rondo. Allegro', duration: 10 },
      ],
    },
    {
      composer: 'Beethoven',
      title: 'Sonata para piano n.º 21 en do mayor, Op. 53 «Waldstein»',
      aliases: ['waldstein', 'beethoven op 53', 'sonata 21 op 53'],
      movements: [
        { name: 'I. Allegro con brio', duration: 11 },
        { name: 'II. Introduzione. Adagio molto', duration: 4 },
        { name: 'III. Rondo. Allegretto moderato – Prestissimo', duration: 10 },
      ],
    },
    {
      composer: 'Beethoven',
      title: 'Sonata para violonchelo n.º 3 en la mayor, Op. 69',
      aliases: ['beethoven cello op 69', 'beethoven violonchelo op 69', 'cello sonata 3 op 69'],
      movements: [
        { name: 'I. Allegro ma non tanto', duration: 8 },
        { name: 'II. Scherzo. Allegro molto', duration: 5 },
        { name: 'III. Adagio cantabile – Allegro vivace', duration: 7 },
      ],
    },
    {
      composer: 'Rachmaninov',
      title: 'Momentos musicales, Op. 16',
      aliases: ['rachmaninov op 16', 'moments musicaux op 16', 'momentos op 16'],
      movements: [
        { name: 'I. Andantino', duration: 6 },
        { name: 'II. Allegretto', duration: 2 },
        { name: 'III. Andante cantabile', duration: 4 },
        { name: 'IV. Presto', duration: 3 },
        { name: 'V. Adagio sostenuto', duration: 4 },
        { name: 'VI. Maestoso', duration: 4 },
      ],
    },
    {
      composer: 'Tchaikovsky',
      title: 'Concierto para piano n.º 1 en si bemol menor, Op. 23',
      aliases: ['tchaikovsky piano concerto 1 op 23', 'tchaikovsky concierto 1 op 23', 'concierto piano 1 op 23'],
      movements: [
        { name: 'I. Allegro non troppo e molto maestoso – Allegro con spirito', duration: 20 },
        { name: 'II. Andantino semplice – Prestissimo – Tempo I', duration: 7 },
        { name: 'III. Allegro con fuoco', duration: 7 },
      ],
    },
  ];

  function normalize(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[º°ª]/g, '')
      .replace(/[«»“”„'’]/g, '')
      .replace(/\bopus\b/g, 'op')
      .replace(/\bno\.?\b|\bnro\.?\b|\bnum\.?\b|\bnumero\b/g, 'n')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokens(value) {
    return new Set(normalize(value).split(/\s+/).filter(Boolean));
  }

  function scoreCandidate(entry, composer, title) {
    const query = normalize(`${composer || ''} ${title || ''}`);
    if (!query) return 0;
    const candidates = [entry.title].concat(entry.aliases || []).map(alias => normalize(`${entry.composer} ${alias}`));
    let best = 0;
    candidates.forEach(candidate => {
      if (query === candidate) best = Math.max(best, 100);
      if (query.includes(candidate) || candidate.includes(query)) best = Math.max(best, 92);
      const q = tokens(query);
      const c = tokens(candidate);
      const common = Array.from(q).filter(token => c.has(token)).length;
      const coverage = common / Math.max(1, Math.min(q.size, c.size));
      const composerMatch = normalize(composer).includes(normalize(entry.composer)) || normalize(entry.composer).includes(normalize(composer));
      best = Math.max(best, coverage * 75 + (composerMatch ? 15 : 0));
    });
    return best;
  }

  function matchWorkStructure(workOrComposer, maybeTitle) {
    const work = typeof workOrComposer === 'object' && workOrComposer
      ? workOrComposer
      : { composer: workOrComposer, name: maybeTitle };
    const composer = work.composer || '';
    const title = work.name || work.title || '';
    let winner = null;
    let winnerScore = 0;
    WORKS.forEach(entry => {
      const score = scoreCandidate(entry, composer, title);
      if (score > winnerScore) {
        winner = entry;
        winnerScore = score;
      }
    });
    return winnerScore >= 72 ? { ...winner, score: Math.round(winnerScore) } : null;
  }

  function isGenericMovementName(name) {
    const n = normalize(name);
    return !n || /^movimiento\s*\d+$/.test(n) || /^movement\s*\d+$/.test(n) || /^(i|ii|iii|iv|v|vi|vii|viii)\.?$/.test(n);
  }

  function makeMovement(template, index) {
    return {
      id: `mv${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      name: template.name,
      duracion: template.duration,
      duracionEstimada: true,
      duracionFuente: 'catalogo-curado',
      dificultad: 5,
      apr: 1,
      esc: 1,
      sol: 1,
      solHistory: [],
      paseHistory: [],
      zoneHistory: [],
      compasHistory: [],
      compasActual: null,
      compasesTotal: null,
      lastPase: null,
    };
  }

  function completeWorkStructure(work, structure) {
    if (!work) return { work, changed: false, structure: null };
    const matched = structure || matchWorkStructure(work);
    if (!matched) return { work, changed: false, structure: null };
    const clone = { ...work, movimientos: Array.isArray(work.movimientos) ? work.movimientos.map(m => ({ ...m })) : [] };
    let changed = false;

    if (!clone.movimientos.length) {
      clone.movimientos = matched.movements.map(makeMovement);
      changed = true;
    } else if (clone.movimientos.length === matched.movements.length) {
      clone.movimientos = clone.movimientos.map((movement, index) => {
        const template = matched.movements[index];
        const next = { ...movement };
        if (isGenericMovementName(next.name) && template.name) {
          next.name = template.name;
          changed = true;
        }
        if (next.duracion == null && template.duration != null) {
          next.duracion = template.duration;
          next.duracionEstimada = true;
          next.duracionFuente = 'catalogo-curado';
          changed = true;
        }
        return next;
      });
    }

    return { work: clone, changed, structure: matched };
  }

  return {
    WORKS,
    normalize,
    isGenericMovementName,
    matchWorkStructure,
    completeWorkStructure,
  };
});
