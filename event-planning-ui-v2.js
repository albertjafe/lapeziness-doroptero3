/* Competition planning UI v2: compact mobile header + readable competition dossiers.
 * Keeps the existing event-planning data model intact and layers a clearer UI on top.
 */
(function competitionPlanningUiV2(){
  'use strict';

  const MONTREAL_SOURCE = 'dossier-2026-2027:montreal-2027';
  const MONTREAL = {
    id: MONTREAL_SOURCE,
    source: 'dossier',
    sourceSnapshot: '2026-09-03',
    sourceLabel: 'Dossier + comprobación oficial 3 sep 2026',
    name: 'Concours musical international de Montréal – Piano',
    start: '2027-04-24',
    end: '2027-05-05',
    location: 'Montréal, Canadá',
    deadline: '2026-10-31',
    applicationOpen: '2026-09-03',
    requiresVideo: true,
    dossierStatus: 'PLAZO PROXIMO',
    eligibility: '18–30 años al comienzo del concurso; nacimiento entre 25-04-1996 y 24-04-2009. Finalistas de ediciones anteriores de piano no pueden volver a competir.',
    video: 'Cuatro vídeos de audición, uno por obra: Preludio y Fuga de J. S. Bach; sonata completa de Haydn, Mozart, Beethoven o Schubert; estudio virtuoso; y una obra de estilo contrastante. Las grabaciones deben cumplir las condiciones de las bases.',
    repertoire: '1ª ronda 25–28 min. Semifinal 50–55 min con sonata clásica, obra canadiense obligatoria y repertorio libre. Música de cámara con un concierto de Mozart y cuarteto. Final con gran concierto y Orchestre symphonique de Montréal.',
    prizes: 'Más de CAD 200.000 en premios y becas. 1º CAD 70.000; 2º CAD 25.000; 3º CAD 20.000; Steinway Recording Prize valorado en CAD 55.000 y otros premios especiales.',
    mainPrize: 'CAD 70.000',
    jury: 'Angela Cheng preside el jurado internacional. El resto de miembros se anuncia en septiembre de 2026.',
    officialUrl: 'https://www.concoursmontreal.ca/en/piano-2027/rules/',
    verifiedAt: '2026-09-03'
  };

  const SHORT_NAMES = [
    [/brescia/i, 'Brescia Classica'],
    [/compositores de españa|cipce/i, 'CIPCE · Mompou'],
    [/orchestra.?sion|istanbul/i, 'Istanbul Orchestra’Sion'],
    [/german piano award/i, 'German Piano Award'],
    [/campillos/i, 'Campillos'],
    [/maria canals/i, 'Maria Canals'],
    [/epinal/i, 'Épinal'],
    [/london classic/i, 'London Classic'],
    [/montr[eé]al/i, 'CMIM Montréal'],
    [/g[eé]za anda/i, 'Géza Anda'],
    [/iturbi/i, 'Iturbi'],
    [/sydney/i, 'Sydney'],
    [/cleveland/i, 'Cleveland'],
    [/clara haskil/i, 'Clara Haskil'],
    [/leeds/i, 'Leeds'],
    [/hummel/i, 'Hummel'],
    [/pozzoli/i, 'Pozzoli'],
    [/ciurlionis/i, 'Čiurlionis'],
    [/maj lind/i, 'Maj Lind'],
    [/xiamen/i, 'Xiamen'],
    [/mottram|rncm/i, 'James Mottram'],
    [/hamamatsu/i, 'Hamamatsu'],
    [/beethoven competition/i, 'Telekom Beethoven'],
    [/tchaikovsky/i, 'Tchaikovsky']
  ];

  let modalObserver = null;
  let headerTimer = null;

  function ready(){
    try { return typeof db !== 'undefined' && db && Array.isArray(db.eventos); }
    catch(error){ return false; }
  }

  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[char]);
  }

  function save(){
    try {
      if(typeof saveData === 'function') saveData();
      else if(typeof saveLocalNow === 'function') saveLocalNow();
    } catch(error){ console.warn('[competition-ui-v2] no se pudo guardar', error); }
  }

  function uid(prefix){
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
  }

  function dateParts(iso){
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if(!match) return null;
    return { y:Number(match[1]), m:Number(match[2]), d:Number(match[3]) };
  }

  function dateEs(iso, options){
    const parts = dateParts(iso);
    if(!parts) return String(iso || 'Por publicar');
    const opts = options || { day:'numeric', month:'short', year:'numeric' };
    return new Intl.DateTimeFormat('es-ES', opts).format(new Date(parts.y, parts.m - 1, parts.d, 12));
  }

  function rangeLabel(c){
    if(c && c.dateNote) return c.dateNote;
    if(!c || !c.start) return 'Por publicar';
    if(!c.end || c.end === c.start) return dateEs(c.start, { day:'numeric', month:'long', year:'numeric' });
    const a = dateParts(c.start), b = dateParts(c.end);
    if(!a || !b) return dateEs(c.start) + ' – ' + dateEs(c.end);
    if(a.y === b.y && a.m === b.m){
      const month = new Intl.DateTimeFormat('es-ES',{ month:'long' }).format(new Date(a.y,a.m-1,1,12));
      return a.d + '–' + b.d + ' ' + month + ' ' + a.y;
    }
    return dateEs(c.start,{day:'numeric',month:'short'}) + ' – ' + dateEs(c.end,{day:'numeric',month:'short',year:'numeric'});
  }

  function currencySymbol(code){
    return ({ EUR:'€', GBP:'£', CHF:'CHF ', USD:'USD ', CAD:'CAD ', AUD:'AUD ', JPY:'JPY ' })[code] || (code ? code + ' ' : '');
  }

  function mainPrize(c){
    if(!c) return 'Pendiente';
    if(c.mainPrize) return c.mainPrize;
    const text = String(c.prizes || '');
    if(!text || /pendient|no publicad|no detallad/i.test(text)) return 'Pendiente';
    let match = text.match(/\b(EUR|GBP|CHF|USD|CAD|AUD|JPY)\s*([0-9][0-9.\s]*)/i);
    if(match) return currencySymbol(match[1].toUpperCase()) + match[2].trim();
    match = text.match(/(?:premio principal\s*)?([0-9][0-9.\s]*)\s*(EUR|GBP|CHF|USD|CAD|AUD|JPY)\b/i);
    if(match) return currencySymbol(match[2].toUpperCase()) + match[1].trim();
    return text.split(/[;\.]/)[0].slice(0,36) || 'Ver premios';
  }

  function ageSummary(c){
    const text = String(c && c.eligibility || '');
    if(!text) return 'Pendiente';
    if(/sin l[ií]mite de edad/i.test(text)) return 'Sin límite';
    let match = text.match(/(\d{1,2})\s*[–-]\s*(\d{1,2})\s*años/i);
    if(match) return match[1] + '–' + match[2] + ' años';
    match = text.match(/hasta\s+(\d{1,2})\s*años/i);
    if(match) return 'Hasta ' + match[1] + ' años';
    match = text.match(/menor de\s+(\d{1,2})/i);
    if(match) return '< ' + match[1] + ' años';
    if(/elegible/i.test(text)) return 'Elegible';
    if(/confirmar|no verificable|pendiente/i.test(text)) return 'Pendiente';
    return text.split(';')[0].slice(0,38);
  }

  function videoSummary(c){
    if(!c) return 'Pendiente';
    const text = String(c.video || '');
    if(c.requiresVideo === false || /no (se )?exige|no exigen/i.test(text)) return 'No requiere';
    if(c.requiresVideo == null || /pendiente/i.test(text)) return 'Pendiente';
    const count = /cuatro v[ií]deos/i.test(text) ? '4 vídeos' : /dos v[ií]deos|dos archivos/i.test(text) ? '2 vídeos' : '';
    const min = text.match(/(?:aprox\.?\s*)?(\d{1,2})\s*[–-]\s*(\d{1,2})\s*min/i);
    const max = text.match(/m[aá]x\.?\s*(\d{1,2})\s*min/i);
    const approx = text.match(/aprox\.?\s*(\d{1,2})\s*min/i);
    let duration = '';
    if(min) duration = min[1] + '–' + min[2] + ' min';
    else if(max) duration = '≤' + max[1] + ' min';
    else if(approx) duration = '≈' + approx[1] + ' min';
    if(count && duration) return count + ' · ' + duration;
    if(count) return count;
    if(duration) return duration;
    return 'Vídeo requerido';
  }

  function shortName(name){
    const value = String(name || '').replace(/^V[ií]deo\s*\/\s*inscripci[oó]n\s*·\s*/i,'').replace(/^Inscripci[oó]n\s*·\s*/i,'').replace(/^Deadline solicitud\s*·\s*/i,'').trim();
    for(const [pattern,label] of SHORT_NAMES){ if(pattern.test(value)) return label; }
    return value
      .replace(/International Piano Competition/gi,'')
      .replace(/Piano Competition/gi,'')
      .replace(/International Competition/gi,'')
      .replace(/\s{2,}/g,' ')
      .trim()
      .slice(0,32) || 'Próximo evento';
  }

  function currentEvent(){
    if(!ready()) return null;
    const id = document.getElementById('eventoEditId')?.value;
    return id ? db.eventos.find(event => String(event.id) === String(id)) || null : null;
  }

  function competitionData(event){
    if(!event) return null;
    if(event.competition) return event.competition;
    const source = event.planSourceId || event.parentSourceId;
    if(!source) return null;
    return Array.isArray(db.competitionPlans) ? db.competitionPlans.find(item => item && item.id === source) || null : null;
  }

  function stateLabel(state){
    return ({standby:'Standby',planificado:'Planificado',confirmado:'Confirmado',descartado:'Descartado',completado:'Completado'})[state] || 'Confirmado';
  }

  function ensureMontreal(){
    if(!ready()) return false;
    if(db.competitionUiSeedVersion === 1) return true;
    let changed = false;
    if(!Array.isArray(db.competitionPlans)) db.competitionPlans = [];
    const index = db.competitionPlans.findIndex(item => item && item.id === MONTREAL_SOURCE);
    if(index >= 0){
      const before = JSON.stringify(db.competitionPlans[index]);
      Object.assign(db.competitionPlans[index], Object.assign({}, MONTREAL, db.competitionPlans[index]));
      if(JSON.stringify(db.competitionPlans[index]) !== before) changed = true;
    } else {
      db.competitionPlans.push(Object.assign({}, MONTREAL, { updatedAt:new Date().toISOString() }));
      changed = true;
    }

    let parent = db.eventos.find(event => event && event.planSourceId === MONTREAL_SOURCE && !event.esHito);
    if(!parent){
      parent = db.eventos.find(event => event && String(event.fecha || '') === MONTREAL.start && /montr[eé]al/i.test(String(event.nombre || '')));
    }
    if(!parent){
      parent = { id:uid('competition'), nombre:MONTREAL.name, tipo:'concurso', fecha:MONTREAL.start, fechaFin:MONTREAL.end, obras:[], rondas:[], estado:'standby' };
      db.eventos.push(parent);
      changed = true;
    }
    Object.assign(parent, Object.assign({
      planSourceId:MONTREAL_SOURCE,
      lugar:MONTREAL.location,
      deadline:MONTREAL.deadline,
      videoRequisitos:MONTREAL.video,
      competition:Object.assign({}, parent.competition || {}, MONTREAL),
      planSource:{ type:'dossier', label:MONTREAL.sourceLabel, snapshot:MONTREAL.sourceSnapshot }
    }, parent));
    if(!Array.isArray(parent.obras)) parent.obras = [];
    if(!Array.isArray(parent.rondas)) parent.rondas = [];
    if(!Array.isArray(parent.repertorioPlanificado)) parent.repertorioPlanificado = [];
    if(!parent.estado) parent.estado = 'standby';

    let deadline = db.eventos.find(event => event && event.parentSourceId === MONTREAL_SOURCE && event.hitoTipo === 'deadline');
    if(!deadline){
      deadline = db.eventos.find(event => event && String(event.fecha || '') === MONTREAL.deadline && /montr[eé]al/i.test(String(event.nombre || '')));
    }
    if(!deadline){
      deadline = { id:uid('deadline'), nombre:'Vídeo / inscripción · ' + MONTREAL.name, tipo:'concurso', fecha:MONTREAL.deadline, fechaFin:'', obras:parent.obras.slice(), rondas:[], estado:'standby' };
      db.eventos.push(deadline);
      changed = true;
    }
    Object.assign(deadline, Object.assign({
      esHito:true,
      hitoTipo:'deadline',
      parentSourceId:MONTREAL_SOURCE,
      videoRequisitos:MONTREAL.video,
      competition:Object.assign({}, deadline.competition || {}, MONTREAL),
      planSource:{ type:'dossier', label:MONTREAL.sourceLabel, snapshot:MONTREAL.sourceSnapshot }
    }, deadline));
    if(!deadline.estado) deadline.estado = parent.estado || 'standby';
    if(!Array.isArray(deadline.obras)) deadline.obras = parent.obras.slice();
    if(!Array.isArray(deadline.repertorioPlanificado)) deadline.repertorioPlanificado = [];

    db.competitionUiSeedVersion = 1;
    save();
    return true;
  }

  function metric(label, value, note){
    return '<div class="competition-key-metric"><span>' + esc(label) + '</span><strong>' + esc(value || '—') + '</strong>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }

  function detailsRow(title, content, open){
    if(!content) return '';
    return '<details class="competition-info-detail"' + (open ? ' open' : '') + '><summary><span>' + esc(title) + '</span><b>+</b></summary><div>' + esc(content) + '</div></details>';
  }

  function markDossierControls(modal, enabled){
    modal.classList.toggle('is-dossier-competition', enabled);
    modal.querySelectorAll('.competition-source-control-hidden').forEach(node => node.classList.remove('competition-source-control-hidden'));
    if(!enabled) return;

    const selector = document.getElementById('eventoTipoSelector');
    if(selector){
      selector.classList.add('competition-source-control-hidden');
      if(selector.previousElementSibling && selector.previousElementSibling.classList.contains('evento-form-label')) selector.previousElementSibling.classList.add('competition-source-control-hidden');
    }
    const name = document.getElementById('eventoNombre');
    if(name && name.closest('label')) name.closest('label').classList.add('competition-source-control-hidden');
    const dates = modal.querySelector('.evento-date-range');
    if(dates) dates.classList.add('competition-source-control-hidden');
    ['eventoLugarPlan','eventoDeadline','eventoVideoRequisitos'].forEach(id => {
      const field = document.getElementById(id);
      if(field && field.closest('label')) field.closest('label').classList.add('competition-source-control-hidden');
    });
  }

  function ensureModalContainers(){
    const modal = document.querySelector('#modalAddEvento .evento-modal');
    if(!modal) return null;
    let hero = document.getElementById('competitionDossierHero');
    if(!hero){
      hero = document.createElement('section');
      hero.id = 'competitionDossierHero';
      hero.className = 'competition-dossier-hero';
      hero.hidden = true;
      const title = document.getElementById('eventoModalTitle');
      if(title) title.insertAdjacentElement('afterend', hero);
      else modal.prepend(hero);
    }
    let planKicker = document.getElementById('competitionPlanKicker');
    if(!planKicker){
      planKicker = document.createElement('div');
      planKicker.id = 'competitionPlanKicker';
      planKicker.className = 'competition-plan-kicker';
      planKicker.innerHTML = '<span>Tu plan</span><small>Estado, fecha objetivo y repertorio</small>';
      planKicker.hidden = true;
      const planning = document.getElementById('eventPlanningFields');
      if(planning) planning.insertAdjacentElement('beforebegin', planKicker);
    }
    let info = document.getElementById('competitionDossierInfo');
    if(!info){
      info = document.createElement('section');
      info.id = 'competitionDossierInfo';
      info.className = 'competition-dossier-info';
      info.hidden = true;
      const source = document.getElementById('eventPlanningSourceCard');
      if(source) source.insertAdjacentElement('afterend', info);
      else {
        const competitionFields = document.getElementById('eventCompetitionFields');
        if(competitionFields) competitionFields.appendChild(info);
      }
    }
    return { modal, hero, planKicker, info };
  }

  function renderCompetitionModal(){
    const nodes = ensureModalContainers();
    if(!nodes) return;
    const event = currentEvent();
    const c = competitionData(event);
    const dossier = Boolean(event && c && (c.source === 'dossier' || event.planSourceId || event.parentSourceId));
    markDossierControls(nodes.modal, dossier);
    nodes.hero.hidden = !dossier;
    nodes.planKicker.hidden = !dossier;
    nodes.info.hidden = !dossier;
    const sourceCard = document.getElementById('eventPlanningSourceCard');
    if(sourceCard) sourceCard.classList.toggle('competition-source-card-superseded', dossier);
    if(!dossier){
      nodes.hero.innerHTML = '';
      nodes.info.innerHTML = '';
      return;
    }

    const openNow = c.applicationOpen && c.deadline && new Date(c.deadline + 'T23:59:00').getTime() >= Date.now();
    const applicationBadge = openNow ? '<span class="competition-live-badge">Inscripción abierta</span>' : '';
    const dossierStatus = c.dossierStatus ? '<span class="competition-source-status">' + esc(c.dossierStatus.replace(/_/g,' ')) + '</span>' : '';
    nodes.hero.innerHTML =
      '<div class="competition-hero-top">' +
        '<div class="competition-hero-copy">' +
          '<div class="competition-hero-kicker">Concurso <span>·</span> ' + esc(stateLabel(event.estado || 'standby')) + '</div>' +
          '<h2>' + esc(c.name || event.nombre || 'Concurso') + '</h2>' +
          '<div class="competition-hero-location">' + esc(c.location || event.lugar || 'Lugar por publicar') + '</div>' +
        '</div>' +
        '<div class="competition-hero-badges">' + applicationBadge + dossierStatus + '</div>' +
      '</div>' +
      '<div class="competition-key-grid">' +
        metric('Lugar', c.location || event.lugar || 'Por publicar') +
        metric('Fechas', rangeLabel(c)) +
        metric('Premio principal', mainPrize(c), /pendient/i.test(mainPrize(c)) ? 'por confirmar' : '') +
        metric('Edad', ageSummary(c)) +
        metric('Vídeo', videoSummary(c)) +
        metric('Deadline', c.deadline ? dateEs(c.deadline,{day:'numeric',month:'short',year:'numeric'}) : 'Por publicar', c.applicationOpen ? 'abrió ' + dateEs(c.applicationOpen,{day:'numeric',month:'short'}) : '') +
      '</div>';

    nodes.info.innerHTML =
      '<div class="competition-info-head"><span>Información del concurso</span><small>Lo importante primero; abre solo lo que necesites</small></div>' +
      '<div class="competition-info-accordions">' +
        detailsRow('Vídeo / preselección', c.video) +
        detailsRow('Repertorio', c.repertoire) +
        detailsRow('Premios', c.prizes) +
        detailsRow('Edad y elegibilidad', c.eligibility) +
        detailsRow('Jurado', c.jury) +
      '</div>' +
      '<div class="competition-source-foot">' +
        '<span>' + esc(c.sourceLabel || 'Dossier de concursos') + (c.verifiedAt ? ' · verificado ' + esc(dateEs(c.verifiedAt,{day:'numeric',month:'short',year:'numeric'})) : '') + '</span>' +
        '<small>Las bases oficiales prevalecen si cambian.</small>' +
      '</div>';
  }

  function installModalObserver(){
    const overlay = document.getElementById('modalAddEvento');
    if(!overlay || modalObserver) return;
    modalObserver = new MutationObserver(() => setTimeout(renderCompetitionModal, 0));
    modalObserver.observe(overlay,{ attributes:true, attributeFilter:['class','style'] });
    const editId = document.getElementById('eventoEditId');
    if(editId) new MutationObserver(() => setTimeout(renderCompetitionModal,0)).observe(editId,{attributes:true,attributeFilter:['value']});
  }

  function localToday(){
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  }

  function daysUntil(iso){
    const p = dateParts(iso);
    if(!p) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
    const target = new Date(p.y,p.m-1,p.d,12);
    return Math.ceil((target - today) / 86400000);
  }

  function nextDeadline(){
    if(!ready()) return null;
    const today = localToday();
    return db.eventos
      .filter(event => event && event.esHito && event.hitoTipo === 'deadline' && String(event.fecha || '') >= today && event.estado !== 'descartado')
      .sort((a,b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))[0] || null;
  }

  function ensureMobileHeader(){
    const topbar = document.querySelector('.topbar');
    if(!topbar) return null;
    let chip = document.getElementById('mobileCompetitionDeadline');
    if(!chip){
      chip = document.createElement('button');
      chip.id = 'mobileCompetitionDeadline';
      chip.type = 'button';
      chip.className = 'mobile-competition-deadline';
      chip.setAttribute('aria-label','Abrir próximo plazo de concurso');
      const header = topbar.querySelector('.header');
      if(header) header.insertAdjacentElement('afterend', chip);
      else topbar.appendChild(chip);
      chip.addEventListener('click', () => {
        const event = nextDeadline();
        if(!event) return;
        try {
          if(typeof showView === 'function') showView('calendario');
          if(typeof switchCalTab === 'function') switchCalTab('eventos', document.getElementById('calTabEventos'));
        } catch(error){}
        setTimeout(() => {
          try {
            if(typeof openAddEvento === 'function'){
              const edit = document.getElementById('eventoEditId');
              if(edit) edit.value = event.id;
            }
          } catch(error){}
        },0);
      });
    }
    return chip;
  }

  function renderMobileHeader(){
    const chip = ensureMobileHeader();
    if(!chip || !ready()) return;
    const event = nextDeadline();
    if(!event){ chip.hidden = true; chip.innerHTML = ''; return; }
    const c = competitionData(event) || {};
    const days = daysUntil(event.fecha);
    const kind = c.requiresVideo === false ? 'Inscripción' : 'Vídeo / inscripción';
    chip.hidden = false;
    chip.dataset.eventId = event.id || '';
    chip.innerHTML = '<span class="mobile-deadline-kind">' + esc(kind) + '</span><strong>' + esc(shortName(c.name || event.nombre)) + '</strong><span class="mobile-deadline-days">' + (days == null ? '—' : days + ' d') + '</span>';
  }

  function installHeaderRefresh(){
    renderMobileHeader();
    if(headerTimer) clearInterval(headerTimer);
    headerTimer = setInterval(renderMobileHeader, 30000);
    document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') renderMobileHeader(); });
    window.addEventListener('focus', renderMobileHeader);
  }

  function rerender(){
    try { if(typeof renderEventos === 'function') renderEventos(); } catch(error){}
    try { if(typeof renderMesCalendario === 'function') renderMesCalendario(); } catch(error){}
  }

  function install(){
    ensureMontreal();
    ensureModalContainers();
    installModalObserver();
    installHeaderRefresh();
    renderCompetitionModal();
    rerender();
    window.CompetitionPlanningUiV2 = {
      version:2,
      ensureMontreal,
      renderCompetitionModal,
      renderMobileHeader,
      montreal:Object.assign({},MONTREAL)
    };
  }

  function boot(attempt){
    if(ready() && document.getElementById('modalAddEvento')) { install(); return; }
    if(attempt < 140) setTimeout(() => boot(attempt + 1), 100);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), { once:true });
  else boot(0);
})();
