/* Planificación profesional de eventos y concursos.
 * Extiende el modal/eventos existentes sin tocar el núcleo grande de app.js.
 * Fuente inicial de concursos: dossier de Alberto, corte 2026-08-16.
 */
(function eventPlanningFeature(){
  'use strict';

  const SOURCE_SNAPSHOT = '2026-08-16';
  const SOURCE_LABEL = 'Dossier concursos de piano 2026–2027';
  const STATUS_LABELS = {
    confirmado: 'Confirmado',
    planificado: 'Planificado',
    standby: 'Standby',
    descartado: 'Descartado',
    completado: 'Completado',
  };
  const USE_LABELS = {
    general: 'General',
    video: 'Vídeo / preselección',
    ronda1: '1ª ronda',
    ronda2: '2ª ronda',
    semifinal: 'Semifinal',
    final: 'Final',
    concierto: 'Concierto',
  };

  const COMPETITIONS = [
    {
      id:'brescia-classica-2026', name:'Brescia Classica International Piano Competition', start:'2026-10-19', end:'2026-10-25', location:'Brescia, Italia', deadline:'2026-09-26', dossierStatus:'PLAZO PROXIMO', requiresVideo:false,
      eligibility:'Sin límite de edad. No admite ganadores previos del primer premio.',
      video:'Las bases no exigen vídeo de preselección.',
      repertoire:'1ª ronda: programa libre, máx. 20 min. 2ª: libre, 40–50 min. Final: un concierto de una lista amplia.',
      prizes:'5.000 / 3.500 / 1.000 EUR.', jury:'No publicado en las bases consultadas.'
    },
    {
      id:'cipce-mompou-2026', name:'CIPCE – Compositores de España (Federico Mompou)', start:'2026-11-08', end:'2026-11-14', location:'Las Rozas de Madrid, España', deadline:'2026-10-01', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'Hasta 36 años; elegible con 27 años.',
      video:'15–20 min de repertorio libre, piano solo; enlace único. Obras en una toma, aunque se puede parar entre obras.',
      repertoire:'2ª ronda: máx. 30 min, libre con al menos 5 min de Federico Mompou. Semifinal: libre, máx. 40 min. Final: concierto de lista.',
      prizes:'11.000 / 4.000 / 2.000 EUR; Premio Música Española 1.000 EUR; gira incluida en el primer premio.', jury:'No publicado en las bases consultadas.'
    },
    {
      id:'istanbul-orchestrasion-2026', name:"International Piano Competition Istanbul Orchestra'Sion", start:'2026-11-11', end:'2026-11-15', location:'Estambul, Turquía', deadline:null, dossierStatus:'SEGUIMIENTO', requiresVideo:null,
      eligibility:'No verificable todavía: el reglamento 2026 no estaba publicado en el corte del dossier.', video:'Pendiente.', repertoire:'Pendiente de bases completas.', prizes:'Pendientes.', jury:'Pendiente de publicación de las bases 2026.'
    },
    {
      id:'international-german-piano-award-2026', name:'International German Piano Award', start:'2026-11-20', end:'2026-11-22', location:'Kronberg im Taunus, Alemania', deadline:'2026-10-15', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'Las bases reunidas no fijan edad; orientado a pianistas con carrera profesional ya avanzada.',
      video:'Aprox. 20 min, libre, solo piano, variedad estilística; grabación profesional de menos de 12 meses.',
      repertoire:'Tres recitales libres y sin repetición: 30, 30 y 45 min. Hay que preparar completos Beethoven Concierto 3 y Rachmaninov Concierto 2.',
      prizes:'Premio principal 20.000 EUR; público 3.000 EUR; conciertos y posible grabación de CD.', jury:'No publicado en las bases consultadas.'
    },
    {
      id:'campillos-2026', name:'Campillos International Piano Competition', start:'2026-12-04', end:'2026-12-08', location:'Campillos, Málaga, España', deadline:'2026-10-15', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'Sin límite de edad; elegible con 27 años.', video:'10–15 min, repertorio libre, un único enlace; cara y manos visibles.',
      repertoire:'1ª ronda libre, máx. 15 min; semifinal libre, máx. 25 min. Final: concierto de lista.',
      prizes:'8.000 / 4.000 / 2.000 EUR; mejor pianista español 1.000 EUR y ayudas de viaje.', jury:'No publicado en las bases consultadas.'
    },
    {
      id:'maria-canals-2027', name:'Maria Canals International Piano Competition', start:'2027-03-07', end:'2027-03-18', location:'Barcelona, España', deadline:'2026-11-23', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'17–29 años a 1 enero 2027; elegible con 27 años.',
      video:'Dos vídeos, máx. 20 min en total: movimiento rápido de sonata de Beethoven (con exclusiones) y obra libre; cámara fija y sin edición.',
      repertoire:'1ª: Preludio y Fuga de Bach, sonata completa de Beethoven y estudio. 2ª: obra posterior a 1995, gran obra romántica prescrita y obra de compositor nacido desde 1860. En el conjunto: 2 compositores españoles (uno catalán) y una compositora. Final: concierto de lista.',
      prizes:'25.000 / 10.000 / 6.000 EUR; 4 conciertos con orquestas españolas para el primer premio; numerosos premios especiales.',
      jury:'Yukiko Akagi; Salvador Brotons; Florian Hölscher; Juan Lago; Pascal Nemirowski; Stanislav Pochekin; Inesa Sinkevych; Marie Vermeulin; Uta Weyand.'
    },
    {
      id:'epinal-2027', name:'Epinal International Piano Competition', start:'2027-03-12', end:'2027-03-21', location:'Épinal, Francia', deadline:'2026-11-30', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'El corte de nacimiento publicado incluye a una persona de 27 años.', video:'Máx. 15 min: un movimiento de sonata clásica (Beethoven, Clementi, Haydn o Mozart) y un estudio libre.',
      repertoire:'Entre 1ª y 2ª: Bach Preludio y Fuga, estudio de Chopin, otro estudio, obra romántica y sonata completa clásica. Semifinal: obra obligatoria y obra francesa. Final: concierto de lista.',
      prizes:'10.000 / 4.000 / 2.000 / 1.000 EUR; premios especiales.', jury:'Jurado de 7 personalidades internacionales; nombres no publicados en las bases.'
    },
    {
      id:'london-classic-2027', name:'London Classic Piano Competition', start:'2027-04-02', end:'2027-04-04', location:'Londres, Reino Unido', deadline:'2026-12-15', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'Mínimo 15; máximo 30 en la final de Barcelona 2028. Elegible con 27 años.', video:'Máx. 30 min: Bach Preludio y Fuga, dos estudios de compositores distintos y una obra libre; grabación de menos de 6 meses.',
      repertoire:'1ª máx. 25 min. 2ª 40–45 min: Sonata 2 de Alexey Shor, sonata completa de Haydn/Mozart/Beethoven y obra libre. No repetir el vídeo.',
      prizes:'20.000 / 10.000 / 5.000 EUR; los dos primeros pasan con gastos pagados a Classic Piano Barcelona 2028.', jury:'No publicado en las bases consultadas.'
    },
    {
      id:'montreal-2027', name:'Concours musical international de Montréal – Piano', start:'2027-04-24', end:'2027-05-05', location:'Montreal, Canadá', deadline:'2026-10-31', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'18–30 años; nacimiento 25-04-1996 a 24-04-2009. Elegible con 27 años.',
      video:'Cuatro vídeos: Bach Preludio y Fuga; sonata completa Haydn/Mozart/Beethoven/Schubert; estudio virtuoso; obra contrastante. Grabados después de 1-07-2025.',
      repertoire:'1ª 25–28 min. Semifinal 50–55 min: sonata clásica, obra canadiense y obra libre. Cámara: Mozart con cuarteto. Final: gran concierto de la lista oficial.',
      prizes:'Más de CAD 200.000: CAD 70.000 / 25.000 / 20.000; grabación Steinway y especiales.', jury:'Angela Cheng (presidenta); resto del jurado anunciado en septiembre de 2026.'
    },
    {
      id:'geza-anda-2027', name:'Concours Géza Anda', start:'2027-05-26', end:'2027-06-05', location:'Zúrich, Suiza', deadline:'2027-02-01', dossierStatus:'PLAZO FUTURO', requiresVideo:true,
      eligibility:'Nacidos después de 26 mayo 1995; elegible con 27 años.', video:'Una toma, aprox. 30 min: sonata de Scarlatti; repertorio 1765–1828; repertorio desde 1829, sin usar obras de las listas presenciales.',
      repertoire:'1ª: Barroco/Bach, Beethoven seleccionado y tres estudios. 2ª: dos recitales contrastantes. Semifinal: dos conciertos de Mozart. Final: concierto mayor de la lista oficial.',
      prizes:'Importes no detallados en el reglamento de repertorio reunido; comprobar al abrir la inscripción.', jury:'Gerhard Oppitz (presidente); Elena Bashkirova; Numa Bischof Ullmann; Ingrid Fliter; David Fray; Rico Gulda; Momo Kodama; Jinsang Lee.'
    },
    {
      id:'iturbi-2027', name:'Valencia Iturbi International Piano Competition', start:'2027-06-02', end:'2027-06-12', location:'Valencia, España', deadline:'2026-11-05', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'Nacidos desde 2 junio 1992; elegible con 27 años.', video:'20–30 min libre; cada obra en una toma, cara y manos visibles; grabado después de 1-01-2026.',
      repertoire:'Dos recitales de 40 y 60 min con requisitos de Beethoven, Mozart, Chopin y música española. Semifinal: concierto de Beethoven. Final: concierto romántico/XX de lista.',
      prizes:'30.000 / 20.000 / 10.000 EUR; semifinalistas 6.000 EUR; Beethoven y música española 2.000 EUR; ayudas.', jury:'No publicado en el extracto de bases consultado.'
    },
    {
      id:'sydney-2027', name:'Sydney International Piano Competition', start:'2027-07-07', end:'2027-07-24', location:'Sídney, Australia', deadline:'2026-12-15', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      eligibility:'18–35 años; nacimiento 25-07-1991 a 10-07-2009. Elegible.', video:'20–30 min, solo, al menos 3 compositores; cara y manos visibles, contador de tiempo continuo; menos de 12 meses.',
      repertoire:'Dos recitales libres de 20 y 30 min con al menos 7 min de música australiana. Cuartos: cámara y recital temático. Semifinal: Beethoven en quinteto. Final: concierto con Sydney Symphony.',
      prizes:'Lista completa 2027 aún en publicación; primer premio anunciado en AUD 50.000. Viaje, alojamiento y dietas con límites.', jury:'Piers Lane AO (presidente no votante); 7 miembros votantes por anunciar.'
    },
    {
      id:'cleveland-2027', name:'Cleveland International Piano Competition', start:'2027-07-25', end:'2027-08-08', location:'París/Cleveland; finales en Cleveland, EE. UU.', deadline:'2026-12-04', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      dateNote:'Primera fase en marzo/abril de 2027; finales 25 julio–8 agosto 2027.', eligibility:'18–32 años a 7 agosto 2027; elegible con 27 años.',
      video:'20–25 min: al menos dos estilos; una selección de Haydn/Mozart/Beethoven/Schubert y otra que muestre virtuosismo.',
      repertoire:'1ª: dos programas diversos de 25–30 min. Cuartos: recital y dúo. Semifinal: recital hablado y trío. Final: reto a cuatro manos y uno de dos conciertos contrastantes preparados.',
      prizes:'USD 100.000 / 50.000 / 25.000 / 15.000; Carnegie Hall, gestión y grabación Steinway para el primero; muchos especiales.', jury:'No publicado en las bases consultadas.'
    },
    {
      id:'clara-haskil-2027', name:'Clara Haskil International Piano Competition', start:'2027-08-26', end:'2027-09-03', location:'Vevey, Suiza', deadline:'2027-04-07', dossierStatus:'CONFIRMAR CUMPLEAÑOS', requiresVideo:true,
      eligibility:'Nacimiento 4-09-1998 a 3-09-2009. Con 27 años en el corte solo queda fuera quien naciera 17-08-1998 a 3-09-1998.',
      video:'Dos archivos: movimientos exigidos de una sonata de Mozart y Schumann Variaciones Abegg op. 1; tomas únicas, cámara fija.',
      repertoire:'Cuartos: Bach o Scarlatti/Soler, sonata completa Beethoven/Schubert, obra obligatoria y libre. Semifinal: quinteto y repertorio prescrito. Final: concierto de Mozart y propina Mendelssohn.',
      prizes:'Premio único CHF 25.000; otros finalistas CHF 5.000; público y obra moderna CHF 3.000, entre otros.', jury:'Hisako Kawamura (presidenta); Blythe Teh Engstroem; Ingrid Fliter; Heinz Holliger; Steven Osborne; Kazuki Yamada; Thomas Zehetmair.'
    },
    {
      id:'leeds-2027', name:'Leeds International Piano Competition', start:'2027-03-30', end:'2027-09-18', location:'Primera ronda mundial; finales en Leeds, Reino Unido', deadline:'2026-10-31', dossierStatus:'PLAZO PROXIMO', requiresVideo:true,
      dateNote:'Primera ronda 30 marzo–6 abril; fases finales 8–18 septiembre 2027.', eligibility:'Nacimiento 19-09-1991 a 30-03-2007; elegible con 27 años.',
      video:'Audio continuo anónimo 20–25 min, repertorio libre, grabado en los 12 meses previos; vídeo simultáneo fijo solo para verificación.',
      repertoire:'Libertad total: primera 20–25 min, segunda 40, semifinal 60 más propina. Finalistas preparan 2 de 3 conciertos propuestos por el candidato.',
      prizes:'GBP 50.000 / 20.000 / 15.000; desarrollo profesional y premios especiales.', jury:'No publicado; las bases indican que se anunciará antes de las fases correspondientes.'
    },
    {
      id:'hummel-2027', name:'Johann Nepomuk Hummel International Piano Competition', start:'2027-09-11', end:'2027-09-18', location:'Bratislava, Eslovaquia', deadline:'2027-06-30', dossierStatus:'PLAZO FUTURO', requiresVideo:false,
      eligibility:'Nacidos después de 11 septiembre 1997; elegible con 27 años.', video:'No se exige vídeo en las bases reunidas; solicitud por formulario, correo o email.',
      repertoire:'1ª: sonata Mozart, estudio Hummel, estudio Chopin y otro estudio. 2ª: Beethoven de lista y programa libre. Final: Septeto op. 74 de Hummel y concierto de lista.',
      prizes:'6.000 / 4.000 / 2.000 EUR; tres conciertos con la Filarmónica Eslovaca para el primero.', jury:'No publicado en las bases consultadas.'
    },
    {
      id:'pozzoli-2027', name:'Ettore Pozzoli International Piano Competition', start:'2027-09-25', end:'2027-10-03', location:'Seregno, Italia', deadline:null, dossierStatus:'SEGUIMIENTO', requiresVideo:null,
      eligibility:'Reglamento 2027 pendiente; no se puede confirmar el corte de edad.', video:'Pendiente.', repertoire:'Pendiente.', prizes:'Pendientes.', jury:'Pendiente de publicación del reglamento 2027.'
    },
    {
      id:'ciurlionis-2027', name:'M. K. Čiurlionis International Piano and Organ Competition', start:null, end:null, location:'Vilna, Lituania', deadline:null, dossierStatus:'SEGUIMIENTO', requiresVideo:null,
      dateNote:'Septiembre 2027, días por confirmar.', eligibility:'Bases 2027 pendientes; la web aún mostraba reglas antiguas.', video:'Pendiente.', repertoire:'Pendiente.', prizes:'Pendientes.', jury:'Pendiente de publicación de las bases 2027.'
    },
    {
      id:'maj-lind-2027', name:'Helsinki International Maj Lind Piano Competition', start:'2027-10-15', end:'2027-10-28', location:'Helsinki, Finlandia', deadline:null, dossierStatus:'SEGUIMIENTO', requiresVideo:null,
      eligibility:'Reglas y límite de edad 2027 pendientes; no descartar todavía.', video:'Pendiente.', repertoire:'Pendiente.', prizes:'Pendientes.', jury:'Pendiente de publicación de las bases 2027.'
    },
    {
      id:'xiamen-2027', name:'Xiamen International Piano Competition', start:'2027-10-26', end:'2027-11-06', location:'Xiamen, China', deadline:null, dossierStatus:'SEGUIMIENTO', requiresVideo:null,
      eligibility:'Reglamento 2027 pendiente; no se puede confirmar edad.', video:'Pendiente.', repertoire:'Pendiente.', prizes:'Pendientes.', jury:'Pendiente de publicación del reglamento 2027.'
    },
    {
      id:'rncm-mottram-2027', name:'RNCM James Mottram International Piano Competition', start:null, end:null, location:'Manchester, Reino Unido', deadline:null, dossierStatus:'PLAZO FUTURO', requiresVideo:true,
      dateNote:'Noviembre 2027, días por confirmar. Apertura prevista sep/oct 2027.', eligibility:'Menor de 30 durante el concurso; con 27 años hoy será elegible.',
      video:'Sonata Scarlatti, estudio Chopin op. 10/25 y Preludio o Estudio de Debussy; uno o tres vídeos.',
      repertoire:'1ª máx. 30 min: Scarlatti, gran obra de Chopin y libre anterior a 1918. Semifinal máx. 45: ciclo Debussy y libre anterior a 1918. Final: concierto de lista.',
      prizes:'GBP 10.000 / 5.000 / 2.500; 7 noches de alojamiento y ayuda parcial de viaje.', jury:'Las bases indican que los miembros se confirmarán más adelante.'
    },
    {
      id:'hamamatsu-2027', name:'Hamamatsu International Piano Competition', start:'2027-11-07', end:'2027-11-29', location:'Hamamatsu, Japón', deadline:'2027-02-28', dossierStatus:'PLAZO FUTURO', requiresVideo:true,
      eligibility:'Nacidos desde 1 enero 1997; elegible con 27 años.', video:'Bach del Clave bien temperado, sonata/movimientos de Mozart, Beethoven o Haydn de listas, y un estudio de lista; una grabación consecutiva.',
      repertoire:'1ª libre con al menos un estudio. 2ª: dos periodos y obra nueva japonesa. 3ª: sonata con violín y recital libre. Final: concierto de lista muy amplia.',
      prizes:'JPY 4.000.000 / 2.500.000 / 1.500.000 / 1.000.000 / 800.000 / 600.000; especiales y al menos 10 actuaciones para el ganador.',
      jury:'Kodama Momo (presidenta); Rodolphe Bruneau Boulmier; Ebi Akiko; Till Fellner; Ralf Gothóni; Michael Haefliger; HaeSun Paik; Arabella Pare; Ewa Pobłocka; Uehara Ayako; Xiaohan Wang.'
    },
    {
      id:'telekom-beethoven-2027', name:'Telekom Beethoven Competition', start:'2027-12-02', end:'2027-12-11', location:'Bonn, Alemania', deadline:null, dossierStatus:'SEGUIMIENTO', requiresVideo:true,
      dateNote:'Muvac abre 1 diciembre 2026; plazo por publicar.', eligibility:'Nacimiento 11-12-1995 a 1-12-2009; elegible con 27 años.',
      video:'Grabación del programa de primera ronda; la lista de repertorio aún no estaba publicada.',
      repertoire:'Cuatro sesiones; Beethoven será central. Se anuncia una obra posterior a 1980, pero las listas completas siguen pendientes.',
      prizes:'No publicados en la documentación 2027 reunida; alojamiento y ayuda de viaje hasta EUR 300 Europa / 600 fuera de Europa.', jury:'No publicado en la documentación 2027 consultada.'
    },
    {
      id:'tchaikovsky-2027', name:'International Tchaikovsky Competition', start:null, end:null, location:'Rusia, ciudad por confirmar', deadline:null, dossierStatus:'SEGUIMIENTO', requiresVideo:null,
      dateNote:'2027, fechas por confirmar.', eligibility:'La edición y la disciplina de piano están anunciadas, pero faltan bases y edad.', video:'Pendiente.', repertoire:'Pendiente.', prizes:'Pendientes.', jury:'Pendiente de publicación de las bases y del jurado 2027.'
    },
  ];

  let importOpen = false;
  let modalObserver = null;
  let renderPatchTimer = null;

  function dbReady(){
    try { return typeof db !== 'undefined' && db && Array.isArray(db.eventos); }
    catch(error){ return false; }
  }
  function save(){
    try {
      if(typeof saveData === 'function') saveData();
      else if(typeof saveLocalNow === 'function') {
        saveLocalNow();
        if(typeof enqueueCloudSync === 'function') enqueueCloudSync({ immediate:true });
      }
    } catch(error){ console.error('[event-planning] no se pudo guardar', error); }
  }
  function toast(text){ try { if(typeof showToast === 'function') showToast(text); } catch(error){} }
  function esc(value){ return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function norm(value){ return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
  function uid(prefix){ return (prefix || 'ep') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
  function sourceId(comp){ return 'dossier-2026-2027:' + comp.id; }
  function sourceForEvent(ev){ return String(ev && (ev.planSourceId || ev.parentSourceId) || ''); }
  function bySource(source){ return dbReady() ? db.eventos.find(ev => sourceForEvent(ev) === source || ev.planSourceId === source) : null; }

  function distinctiveTokens(name){
    const stop = new Set(['international','piano','competition','concours','musical','the','de','del','la','el','and','award']);
    return norm(name).split(' ').filter(t => t.length > 2 && !stop.has(t));
  }
  function titleMatches(a,b){
    const na=norm(a), nb=norm(b);
    if(!na || !nb) return false;
    if(na.includes(nb) || nb.includes(na)) return true;
    const ta=distinctiveTokens(a), tb=new Set(distinctiveTokens(b));
    const hits=ta.filter(t=>tb.has(t)).length;
    return hits >= Math.min(2, Math.max(1, Math.min(ta.length,tb.size)));
  }
  function findExisting(comp, date, kind){
    if(!dbReady()) return null;
    const source=sourceId(comp);
    let found=db.eventos.find(ev => kind==='parent' ? ev.planSourceId===source && !ev.esHito : ev.parentSourceId===source && ev.hitoTipo==='deadline');
    if(found) return found;
    if(!date) return null;
    return db.eventos.find(ev => String(ev.fecha||'')===date && titleMatches(ev.nombre||ev.titulo||'', comp.name));
  }

  function relationForWork(ev, obraId, previous){
    const old = previous && previous.get(String(obraId));
    return old || { obraId:String(obraId), movimientoId:null, uso:'general', notas:'' };
  }
  function syncRelations(ev, overrideUses){
    const previous = new Map((Array.isArray(ev.repertorioPlanificado)?ev.repertorioPlanificado:[]).filter(Boolean).map(rel => [String(rel.obraId||''), rel]));
    const works = Array.isArray(ev.obras) ? ev.obras : [];
    ev.repertorioPlanificado = works.map(id => {
      const rel = Object.assign({}, relationForWork(ev,id,previous));
      if(overrideUses && overrideUses[String(id)]) rel.uso = overrideUses[String(id)];
      if(!rel.uso) rel.uso='general';
      return rel;
    });
  }

  function parentEventFor(ev){
    if(!ev || !ev.parentSourceId || !dbReady()) return null;
    return db.eventos.find(item => item.planSourceId===ev.parentSourceId && !item.esHito) || null;
  }
  function syncMilestones(parent){
    if(!parent || !parent.planSourceId || !dbReady()) return;
    db.eventos.filter(ev => ev.parentSourceId===parent.planSourceId && ev.esHito).forEach(child => {
      child.obras = Array.isArray(parent.obras) ? parent.obras.slice() : [];
      child.repertorioPlanificado = (Array.isArray(parent.repertorioPlanificado)?parent.repertorioPlanificado:[]).map(rel => Object.assign({},rel));
      child.estado = parent.estado === 'descartado' ? 'descartado' : (child.estado || parent.estado || 'standby');
      child.updatedAt = new Date().toISOString();
    });
  }

  function canonicalPlan(comp){
    return {
      id: sourceId(comp),
      source:'dossier', sourceSnapshot:SOURCE_SNAPSHOT, sourceLabel:SOURCE_LABEL,
      name:comp.name, start:comp.start || null, end:comp.end || null, location:comp.location || '', deadline:comp.deadline || null,
      requiresVideo:comp.requiresVideo, dossierStatus:comp.dossierStatus || 'SEGUIMIENTO', dateNote:comp.dateNote || '',
      eligibility:comp.eligibility || '', video:comp.video || '', repertoire:comp.repertoire || '', prizes:comp.prizes || '', jury:comp.jury || '',
      updatedAt:new Date().toISOString(),
    };
  }
  function upsertPlan(comp){
    if(!Array.isArray(db.competitionPlans)) db.competitionPlans=[];
    const plan=canonicalPlan(comp);
    const index=db.competitionPlans.findIndex(item=>item&&item.id===plan.id);
    if(index>=0) db.competitionPlans[index]=Object.assign({},db.competitionPlans[index],plan);
    else db.competitionPlans.push(plan);
    return plan;
  }

  function enrichParent(ev, comp){
    const source=sourceId(comp);
    ev.nombre = ev.nombre || comp.name;
    ev.tipo = ev.tipo || 'concurso';
    ev.fecha = ev.fecha || comp.start;
    ev.fechaFin = ev.fechaFin || comp.end || '';
    ev.obras = Array.isArray(ev.obras) ? ev.obras : [];
    ev.rondas = Array.isArray(ev.rondas) ? ev.rondas : [];
    ev.estado = ev.estado || 'standby';
    ev.lugar = ev.lugar || comp.location || '';
    ev.deadline = ev.deadline || comp.deadline || '';
    ev.grabacionObjetivo = ev.grabacionObjetivo || '';
    ev.videoRequisitos = ev.videoRequisitos || comp.video || '';
    ev.planSourceId = source;
    ev.planSource = { type:'dossier', label:SOURCE_LABEL, snapshot:SOURCE_SNAPSHOT };
    ev.competition = Object.assign({}, ev.competition || {}, canonicalPlan(comp));
    syncRelations(ev);
    ev.updatedAt = new Date().toISOString();
    return ev;
  }

  function upsertParent(comp){
    if(!comp.start) return null;
    let ev=findExisting(comp,comp.start,'parent');
    if(!ev){
      ev={ id:uid('competition'), nombre:comp.name, tipo:'concurso', fecha:comp.start, fechaFin:comp.end||'', obras:[], rondas:[] };
      db.eventos.push(ev);
    }
    return enrichParent(ev,comp);
  }

  function deadlineTitle(comp){
    if(comp.requiresVideo===true) return 'Vídeo / inscripción · ' + comp.name;
    if(comp.requiresVideo===false) return 'Inscripción · ' + comp.name;
    return 'Deadline solicitud · ' + comp.name;
  }
  function upsertDeadline(comp,parent){
    if(!comp.deadline) return null;
    let ev=findExisting(comp,comp.deadline,'deadline');
    if(!ev){
      ev={ id:uid('deadline'), nombre:deadlineTitle(comp), tipo:'concurso', fecha:comp.deadline, fechaFin:'', obras:[], rondas:[] };
      db.eventos.push(ev);
    }
    ev.estado = ev.estado || 'standby';
    ev.esHito = true;
    ev.hitoTipo = 'deadline';
    ev.parentSourceId = sourceId(comp);
    ev.planSource = { type:'dossier', label:SOURCE_LABEL, snapshot:SOURCE_SNAPSHOT };
    ev.lugar = ev.lugar || '';
    ev.videoRequisitos = ev.videoRequisitos || comp.video || '';
    ev.competition = Object.assign({}, ev.competition || {}, canonicalPlan(comp));
    if(parent){
      ev.obras=Array.isArray(parent.obras)?parent.obras.slice():[];
      ev.repertorioPlanificado=(Array.isArray(parent.repertorioPlanificado)?parent.repertorioPlanificado:[]).map(rel=>Object.assign({},rel));
    } else syncRelations(ev);
    ev.updatedAt=new Date().toISOString();
    return ev;
  }

  function importCompetitions(selectedIds, includeDeadlines){
    if(!dbReady()) return { parents:0, deadlines:0, watch:0, enriched:0 };
    const selected=new Set(selectedIds || COMPETITIONS.map(item=>item.id));
    let parents=0, deadlines=0, watch=0;
    COMPETITIONS.filter(comp=>selected.has(comp.id)).forEach(comp=>{
      upsertPlan(comp);
      const hadParent=comp.start && Boolean(findExisting(comp,comp.start,'parent'));
      const parent=upsertParent(comp);
      if(parent && !hadParent) parents++;
      if(!comp.start) watch++;
      if(includeDeadlines && comp.deadline){
        const had=Boolean(findExisting(comp,comp.deadline,'deadline'));
        upsertDeadline(comp,parent);
        if(!had) deadlines++;
      }
    });
    save();
    rerender();
    renderWatchlist();
    return { parents, deadlines, watch };
  }

  function currentType(){
    const active=document.querySelector('#eventoTipoSelector .evento-tipo-btn.active');
    if(!active) return 'concurso';
    if(active.dataset && active.dataset.eventoTipo) return active.dataset.eventoTipo;
    const match=Array.from(active.classList).find(name=>!['evento-tipo-btn','active'].includes(name));
    return match || 'concurso';
  }
  function currentEvent(){
    if(!dbReady()) return null;
    const id=document.getElementById('eventoEditId')?.value;
    return id ? db.eventos.find(ev=>String(ev.id)===String(id)) || null : null;
  }

  function injectExamenButton(){
    const selector=document.getElementById('eventoTipoSelector');
    if(!selector || selector.querySelector('[data-evento-tipo="examen"]')) return;
    Array.from(selector.querySelectorAll('.evento-tipo-btn')).forEach(btn=>{
      const type=Array.from(btn.classList).find(name=>!['evento-tipo-btn','active'].includes(name));
      if(type) btn.dataset.eventoTipo=type;
    });
    const button=document.createElement('button');
    button.type='button'; button.className='evento-tipo-btn examen'; button.dataset.eventoTipo='examen'; button.textContent='Examen';
    button.addEventListener('click',()=>{
      if(typeof selectEventoTipo==='function') selectEventoTipo('examen',button);
      setTimeout(updateExtraVisibility,0);
    });
    selector.appendChild(button);
    selector.addEventListener('click',()=>setTimeout(updateExtraVisibility,0));
  }

  function injectModalFields(){
    const modal=document.querySelector('#modalAddEvento .evento-modal');
    if(!modal || document.getElementById('eventPlanningFields')) return;
    const dateRange=modal.querySelector('.evento-date-range');
    if(!dateRange) return;
    const section=document.createElement('section');
    section.id='eventPlanningFields'; section.className='event-planning-fields';
    section.innerHTML=`
      <div class="event-planning-row">
        <label class="evento-form-field"><span>Estado</span><select class="modal-input" id="eventoEstado">${Object.entries(STATUS_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>
        <label class="evento-form-field"><span>Lugar <small>opcional</small></span><input class="modal-input" id="eventoLugarPlan" type="text" placeholder="Ciudad, país"></label>
      </div>
      <div id="eventCompetitionFields" class="event-competition-fields">
        <div class="event-planning-kicker">Planificación del concurso</div>
        <div class="event-planning-row">
          <label class="evento-form-field"><span>Deadline oficial <small>solicitud / vídeo</small></span><input class="modal-input" id="eventoDeadline" type="date"></label>
          <label class="evento-form-field"><span>Objetivo de grabación <small>interno</small></span><input class="modal-input" id="eventoGrabacionObjetivo" type="date"></label>
        </div>
        <label class="evento-form-field"><span>Requisitos de vídeo</span><textarea class="modal-input event-planning-textarea" id="eventoVideoRequisitos" placeholder="Duración, toma única, repertorio, cámara…"></textarea></label>
        <div id="eventPlanningSourceCard" class="event-planning-source-card" hidden></div>
      </div>`;
    dateRange.insertAdjacentElement('afterend',section);

    const works=document.getElementById('obraCheckList');
    if(works){
      const uses=document.createElement('div'); uses.id='eventoRepertorioUsos'; uses.className='evento-repertorio-usos';
      works.insertAdjacentElement('afterend',uses);
      works.addEventListener('change',()=>renderWorkUses(currentEvent()));
    }
  }

  function readWorkId(input){ return String(input.value || input.dataset.obraId || input.dataset.id || ''); }
  function workLabel(input){
    const label=input.closest('label');
    return (label ? label.textContent : input.value || 'Obra').replace(/\s+/g,' ').trim();
  }
  function renderWorkUses(ev){
    const host=document.getElementById('eventoRepertorioUsos');
    const list=document.getElementById('obraCheckList');
    if(!host || !list) return;
    const previous=new Map((Array.isArray(ev?.repertorioPlanificado)?ev.repertorioPlanificado:[]).map(rel=>[String(rel.obraId||''),rel.uso||'general']));
    const checked=Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(input=>({input,id:readWorkId(input),label:workLabel(input)})).filter(item=>item.id);
    if(!checked.length){ host.innerHTML=''; host.hidden=true; return; }
    host.hidden=false;
    host.innerHTML='<div class="event-planning-kicker">Uso previsto</div>'+checked.map(item=>`<label class="evento-uso-row"><span>${esc(item.label)}</span><select class="modal-input evento-uso-select" data-obra-id="${esc(item.id)}">${Object.entries(USE_LABELS).map(([value,label])=>`<option value="${value}" ${previous.get(item.id)===value?'selected':''}>${label}</option>`).join('')}</select></label>`).join('');
  }
  function readWorkUses(){
    const out={};
    document.querySelectorAll('#eventoRepertorioUsos .evento-uso-select').forEach(select=>{ if(select.dataset.obraId) out[String(select.dataset.obraId)]=select.value||'general'; });
    return out;
  }

  function sourceCard(ev){
    const card=document.getElementById('eventPlanningSourceCard');
    if(!card) return;
    const c=ev && ev.competition;
    if(!c || c.source!=='dossier') { card.hidden=true; card.innerHTML=''; return; }
    const rows=[
      ['Estado dossier',c.dossierStatus], ['Elegibilidad',c.eligibility], ['Vídeo',c.video], ['Repertorio',c.repertoire], ['Premios',c.prizes], ['Jurado',c.jury]
    ].filter(([,value])=>value);
    card.hidden=false;
    card.innerHTML=`<div class="event-source-head"><div><span>Ficha importada</span><strong>${esc(SOURCE_LABEL)}</strong></div><small>Corte ${esc(c.sourceSnapshot||SOURCE_SNAPSHOT)}</small></div>${rows.map(([label,value])=>`<div class="event-source-row"><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('')}<div class="event-source-note">Las bases oficiales prevalecen si cambian.</div>`;
  }

  function updateExtraVisibility(){
    const section=document.getElementById('eventCompetitionFields');
    if(section) section.hidden=currentType()!=='concurso';
  }
  function populateExtras(ev){
    const status=document.getElementById('eventoEstado');
    if(status) status.value=(ev&&ev.estado)||'confirmado';
    const location=document.getElementById('eventoLugarPlan'); if(location) location.value=(ev&&ev.lugar)||'';
    const deadline=document.getElementById('eventoDeadline'); if(deadline) deadline.value=(ev&&ev.deadline)||'';
    const recording=document.getElementById('eventoGrabacionObjetivo'); if(recording) recording.value=(ev&&ev.grabacionObjetivo)||'';
    const video=document.getElementById('eventoVideoRequisitos'); if(video) video.value=(ev&&ev.videoRequisitos)||'';
    sourceCard(ev);
    renderWorkUses(ev);
    updateExtraVisibility();
  }

  function patchSaveEvento(){
    if(typeof window.saveEvento!=='function' || window.saveEvento.__eventPlanningPatched) return false;
    const original=window.saveEvento;
    const patched=function(){
      const editId=document.getElementById('eventoEditId')?.value || '';
      const beforeIds=dbReady()?new Set(db.eventos.map(ev=>String(ev.id))):new Set();
      const extras={
        estado:document.getElementById('eventoEstado')?.value || 'confirmado',
        lugar:document.getElementById('eventoLugarPlan')?.value?.trim() || '',
        deadline:document.getElementById('eventoDeadline')?.value || '',
        grabacionObjetivo:document.getElementById('eventoGrabacionObjetivo')?.value || '',
        videoRequisitos:document.getElementById('eventoVideoRequisitos')?.value?.trim() || '',
        uses:readWorkUses(),
      };
      const formName=document.getElementById('eventoNombre')?.value?.trim() || '';
      const formDate=document.getElementById('eventoFecha')?.value || '';
      const result=original.apply(this,arguments);
      const finalize=()=>{
        if(!dbReady()) return;
        let ev=editId?db.eventos.find(item=>String(item.id)===String(editId)):null;
        if(!ev) ev=db.eventos.find(item=>!beforeIds.has(String(item.id))) || null;
        if(!ev) ev=[...db.eventos].reverse().find(item=>(item.nombre||'')===formName && (item.fecha||'')===formDate) || null;
        if(!ev) return;
        Object.assign(ev,{ estado:extras.estado, lugar:extras.lugar, deadline:extras.deadline, grabacionObjetivo:extras.grabacionObjetivo, videoRequisitos:extras.videoRequisitos, updatedAt:new Date().toISOString() });
        syncRelations(ev,extras.uses);
        if(ev.planSourceId) syncMilestones(ev);
        const parent=parentEventFor(ev); if(parent && ev.hitoTipo==='deadline') syncRelations(ev,extras.uses);
        save(); rerender();
      };
      if(result && typeof result.then==='function') result.then(finalize).catch(()=>{}); else finalize();
      return result;
    };
    patched.__eventPlanningPatched=true;
    patched.__original=original;
    window.saveEvento=patched;
    try { saveEvento=patched; } catch(error){}
    return true;
  }

  function observeModal(){
    const overlay=document.getElementById('modalAddEvento');
    if(!overlay || modalObserver) return;
    const refresh=()=>{
      if(!overlay.classList.contains('open') && getComputedStyle(overlay).display==='none') return;
      setTimeout(()=>populateExtras(currentEvent()),0);
    };
    modalObserver=new MutationObserver(refresh);
    modalObserver.observe(overlay,{attributes:true,attributeFilter:['class','style']});
  }

  function statusClass(status){ return STATUS_LABELS[status] ? status : 'confirmado'; }
  function decorateCards(){
    if(!dbReady()) return;
    const events=db.eventos || [];
    document.querySelectorAll('#eventosList .evento-card, #eventosPasadosList .evento-history-card').forEach(card=>{
      const text=norm(card.textContent);
      const candidates=events.filter(ev=>ev&&ev.nombre&&text.includes(norm(ev.nombre)));
      const ev=candidates.sort((a,b)=>String(b.nombre||'').length-String(a.nombre||'').length)[0];
      if(!ev) return;
      card.dataset.eventState=statusClass(ev.estado||'confirmado');
      card.classList.toggle('event-is-milestone',Boolean(ev.esHito));
      let badge=card.querySelector('.event-planning-status-badge');
      if(!badge){ badge=document.createElement('span'); badge.className='event-planning-status-badge'; const top=card.querySelector('.evento-card-top,.evento-history-top')||card; top.appendChild(badge); }
      badge.textContent=STATUS_LABELS[ev.estado||'confirmado']||STATUS_LABELS.confirmado;
      badge.dataset.state=statusClass(ev.estado||'confirmado');
    });
    document.querySelectorAll('#mesGrid .mes-dot').forEach(dot=>{
      const title=dot.getAttribute('title')||dot.textContent||'';
      const ev=events.find(item=>item&&item.nombre&&titleMatches(title,item.nombre));
      if(ev) dot.dataset.eventState=statusClass(ev.estado||'confirmado');
    });
  }
  function patchRender(name){
    const fn=window[name];
    if(typeof fn!=='function' || fn.__eventPlanningPatched) return;
    const patched=function(){ const result=fn.apply(this,arguments); clearTimeout(renderPatchTimer); renderPatchTimer=setTimeout(decorateCards,0); return result; };
    patched.__eventPlanningPatched=true; patched.__original=fn; window[name]=patched; try { globalThis[name]=patched; } catch(error){}
  }
  function rerender(){
    try { if(typeof renderEventos==='function') renderEventos(); } catch(error){}
    try { if(typeof renderMesCalendario==='function') renderMesCalendario(); } catch(error){}
    setTimeout(decorateCards,0);
  }

  function injectImportButton(){
    const actions=document.querySelector('.calendar-action-buttons');
    if(!actions || document.getElementById('competitionPlanningOpen')) return;
    const button=document.createElement('button'); button.type='button'; button.id='competitionPlanningOpen'; button.className='competition-planning-open'; button.textContent='Plan de concursos';
    button.addEventListener('click',openImportModal); actions.insertBefore(button,actions.firstChild);
  }

  function importModal(){
    if(document.getElementById('competitionImportModal')) return;
    const overlay=document.createElement('div'); overlay.id='competitionImportModal'; overlay.className='competition-import-overlay'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
    overlay.innerHTML=`<div class="competition-import-modal">
      <header class="competition-import-head"><div><span>Plan profesional</span><h2>Concursos 2026–2027</h2><p>Importa el dossier como eventos en <b>Standby</b>. No inventa repertorio ni fechas que no estén publicadas.</p></div><button type="button" id="competitionImportClose" aria-label="Cerrar">×</button></header>
      <div class="competition-import-tools"><label><input type="checkbox" id="competitionImportAll" checked> Seleccionar todos</label><label><input type="checkbox" id="competitionImportDeadlines" checked> Añadir deadlines que no estén ya en el calendario</label></div>
      <div class="competition-import-list">${COMPETITIONS.map(comp=>`<label class="competition-import-item"><input type="checkbox" class="competition-import-check" value="${esc(comp.id)}" checked><span class="competition-import-copy"><strong>${esc(comp.name)}</strong><small>${esc(comp.start ? dateEs(comp.start)+(comp.end?' – '+dateEs(comp.end):'') : comp.dateNote || 'Fecha por publicar')} · ${esc(comp.location)}</small><em>${comp.deadline?'Deadline '+esc(dateEs(comp.deadline)):'Plazo por publicar'} · ${esc(comp.dossierStatus)}</em></span></label>`).join('')}</div>
      <footer class="competition-import-foot"><div><b>${COMPETITIONS.length} concursos</b><span>Fuente: dossier · corte ${SOURCE_SNAPSHOT}</span></div><button type="button" id="competitionImportCancel">Cancelar</button><button type="button" id="competitionImportConfirm">Importar / actualizar</button></footer>
    </div>`;
    document.body.appendChild(overlay);
    document.getElementById('competitionImportClose').onclick=closeImportModal;
    document.getElementById('competitionImportCancel').onclick=closeImportModal;
    document.getElementById('competitionImportAll').onchange=e=>document.querySelectorAll('.competition-import-check').forEach(box=>box.checked=e.target.checked);
    document.getElementById('competitionImportConfirm').onclick=()=>{
      const ids=Array.from(document.querySelectorAll('.competition-import-check:checked')).map(input=>input.value);
      const result=importCompetitions(ids,document.getElementById('competitionImportDeadlines').checked);
      closeImportModal();
      toast(`Plan actualizado · ${result.parents} concursos nuevos · ${result.deadlines} deadlines nuevas${result.watch?' · '+result.watch+' en seguimiento':''}`);
    };
    overlay.addEventListener('mousedown',e=>{ if(e.target===overlay) closeImportModal(); });
  }
  function dateEs(iso){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||''))) return String(iso||'');
    const [y,m,d]=iso.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric'}).format(new Date(y,m-1,d,12));
  }
  function openImportModal(){ importModal(); const overlay=document.getElementById('competitionImportModal'); overlay.classList.add('open'); importOpen=true; }
  function closeImportModal(){ const overlay=document.getElementById('competitionImportModal'); if(overlay) overlay.classList.remove('open'); importOpen=false; }

  function renderWatchlist(){
    if(!dbReady()) return;
    const host=document.getElementById('calPanelEventos');
    if(!host) return;
    let panel=document.getElementById('competitionWatchlist');
    if(!panel){ panel=document.createElement('section'); panel.id='competitionWatchlist'; panel.className='competition-watchlist'; const past=document.getElementById('eventosPasadosList'); if(past) past.insertAdjacentElement('beforebegin',panel); else host.appendChild(panel); }
    const plans=(Array.isArray(db.competitionPlans)?db.competitionPlans:[]).filter(item=>item&&item.source==='dossier'&&!item.start);
    if(!plans.length){ panel.hidden=true; panel.innerHTML=''; return; }
    panel.hidden=false;
    panel.innerHTML=`<div class="competition-watchlist-head"><div><span>Seguimiento</span><strong>Concursos sin fecha exacta</strong></div><small>${plans.length}</small></div><div class="competition-watchlist-items">${plans.map(plan=>`<div class="competition-watch-item"><div><b>${esc(plan.name)}</b><span>${esc(plan.dateNote||'Fecha por publicar')} · ${esc(plan.location||'')}</span></div><em>${esc(plan.dossierStatus||'SEGUIMIENTO')}</em></div>`).join('')}</div>`;
  }

  function migrateLegacyEvents(){
    if(!dbReady()) return false;
    let changed=false;
    db.eventos.forEach(ev=>{
      if(!ev || typeof ev!=='object') return;
      if(!ev.estado){ ev.estado='confirmado'; changed=true; }
      const before=JSON.stringify(ev.repertorioPlanificado||null);
      syncRelations(ev);
      if(before!==JSON.stringify(ev.repertorioPlanificado||null)) changed=true;
    });
    if(changed) save();
    return changed;
  }

  function install(){
    injectExamenButton();
    injectModalFields();
    injectImportButton();
    observeModal();
    patchSaveEvento();
    patchRender('renderEventos');
    patchRender('renderMesCalendario');
    migrateLegacyEvents();
    renderWatchlist();
    decorateCards();
    document.addEventListener('keydown',event=>{ if(event.key==='Escape'&&importOpen) closeImportModal(); });
    window.EventPlanning={
      version:1, sourceSnapshot:SOURCE_SNAPSHOT, competitions:COMPETITIONS.map(item=>Object.assign({},item)),
      importCompetitions, openImportModal, closeImportModal, renderWatchlist, decorateCards,
      statuses:Object.assign({},STATUS_LABELS),
    };
  }

  function boot(attempt){
    if(document.getElementById('modalAddEvento') && typeof window.saveEvento==='function' && dbReady()) { install(); return; }
    if(attempt<120) setTimeout(()=>boot(attempt+1),100);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>boot(0),{once:true}); else boot(0);
})();
