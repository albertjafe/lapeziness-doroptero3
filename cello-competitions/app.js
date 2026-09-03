const FX = Object.freeze({ EUR: 1, USD: 0.86153, GBP: 1.16273 });
const TODAY = '2026-09-03';

// Only current/relevant edition cash figures that are reliable enough to put in the scan table.
// Historical prize amounts for an unannounced future cycle are intentionally NOT carried forward.
const prizeOverrides = Object.freeze({
  vienna26: [{ value: 4500 }],
  dicc27: [{ value: 14000 }, { value: 8000 }, { value: 5000 }],
  fmb27: [{ value: 6000 }, { value: 4000 }, { value: 2000 }],
  split27: [{ value: 3000 }, { value: 1500 }, { value: 500 }],
  geringas27: [{ value: 10000 }, { value: 7500 }, { value: 5000 }],
  sphinx27: [
    { value: 50000 * FX.USD, approx: true },
    { value: 20000 * FX.USD, approx: true },
    { value: 10000 * FX.USD, approx: true }
  ],
  bromsgrove27: [
    { value: 4000 * FX.GBP, approx: true },
    { value: 1500 * FX.GBP, approx: true },
    { value: 1500 * FX.GBP, approx: true }
  ],
  johansen28: [
    { value: 10000 * FX.USD, approx: true },
    { value: 7000 * FX.USD, approx: true },
    { value: 5000 * FX.USD, approx: true }
  ]
});

const statusText = {
  open: 'OPEN', future: 'FUTURE', watch: 'WATCH', conditional: 'CONDITIONAL',
  unconfirmed: 'UNCONFIRMED', closed: 'CLOSED', dormant: 'DORMANT'
};

const scopeText = {
  cello: 'CELLO', mixed: 'STRINGS / MIXED', youth: 'YOUTH', national: 'NATIONAL',
  institution: 'INSTITUTION', online: 'ONLINE', dormant: 'DORMANT'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function fmtDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || 'TBA';
  const d = new Date(value + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function euro(value, approx = false) {
  const rounded = approx ? Math.round(value / 10) * 10 : Math.round(value);
  return `${approx ? '≈' : ''}€${rounded.toLocaleString('en-GB')}`;
}

function prizeCell(c) {
  const entries = prizeOverrides[c.id] || [];
  if (!entries.length) return '<div class="prize-stack prize-empty">—</div>';
  return `<div class="prize-stack">${entries.slice(0,3).map(p => `<span>${euro(p.value, p.approx)}</span>`).join('')}</div>`;
}

function sourceUrl(c) {
  const sources = Array.isArray(c.sources) ? c.sources : [];
  const first = sources.find(s => Array.isArray(s) && /^https?:\/\//.test(s[1] || ''));
  return first ? first[1] : '';
}

function websiteCell(c) {
  const url = sourceUrl(c);
  if (!url) return '<span class="web-missing">—</span>';
  return `<a class="web-link" href="${esc(url)}" target="_blank" rel="noopener">Open ↗</a>`;
}

function statusBadge(c) {
  const status = c.status || 'watch';
  return `<span class="tag ${esc(status)}">${esc(statusText[status] || status.toUpperCase())}</span>`;
}

function sourceBadge(c) {
  const level = c.sourceLevel || 'official';
  const label = level === 'federation' ? 'WFIMC / FEDERATION' : level.toUpperCase();
  return `<span class="mini-badge source-${esc(level)}">${esc(label)}</span>`;
}

function scopeBadge(c) {
  const scope = c.scope || (c.major ? 'cello' : 'mixed');
  return `<span class="mini-badge">${esc(scopeText[scope] || scope.toUpperCase())}</span>`;
}

function videoText(c) {
  const v = (c.video || '').trim();
  if (!v) return 'TBA';
  if (v === '—') return '—';
  return v;
}

function competitionMeta(c) {
  return `${c.location || 'Location TBA'} · ${c.year || ''}`;
}

function dataAttrs(c) {
  const text = [c.name,c.location,c.year,c.dates,c.deadline,c.video,c.eligibility,c.repertoire,c.note,(c.tags||[]).join(' ')].join(' ').toLowerCase();
  return `data-id="${esc(c.id)}" data-year="${esc(c.year || '')}" data-status="${esc(c.status || '')}" data-scope="${esc(c.scope || '')}" data-tier="${esc(c.tier || '')}" data-major="${c.major ? 'true' : 'false'}" data-source="${esc(c.sourceLevel || '')}" data-search="${esc(text)}"`;
}

function sortKey(c) {
  const statusPenalty = c.status === 'closed' ? 8 : c.status === 'dormant' ? 9 : 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(c.deadline || '')) {
    const past = c.deadline < TODAY ? 3 : 0;
    return `${statusPenalty + past}-0-${c.deadline}-${c.name}`;
  }
  const combined = `${c.year || ''} ${c.dates || ''} ${c.deadline || ''}`;
  const year = (combined.match(/20(?:26|27|28|29|30)/) || ['9999'])[0];
  return `${statusPenalty}-1-${year}-${c.name}`;
}

function masterRow(c) {
  return `<tr class="master-row" ${dataAttrs(c)}>
    <td class="competition-cell">
      <div class="comp-name">${esc(c.name)}</div>
      <div class="comp-meta">${esc(competitionMeta(c))}</div>
      <div class="comp-badges">${statusBadge(c)}${scopeBadge(c)}${sourceBadge(c)}</div>
    </td>
    <td class="prize-cell">${prizeCell(c)}</td>
    <td class="date-cell">${esc(c.dates || 'TBA')}</td>
    <td class="deadline-cell">${esc(fmtDate(c.deadline))}</td>
    <td class="video-cell">${esc(videoText(c))}</td>
    <td class="website-cell">${websiteCell(c)}</td>
  </tr>`;
}

function detailCard(c) {
  const links = (c.sources || []).filter(s => Array.isArray(s) && s[1]).map(s => `<a class="source" href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[0])} ↗</a>`).join('');
  return `<article class="card" ${dataAttrs(c)}>
    <div class="card-top">
      <div class="card-row">
        <div>
          <div class="eyebrow">${esc(c.year || 'CYCLE WATCH')}</div>
          <h3>${esc(c.name)}</h3>
          <div class="where">${esc(c.location || 'Location TBA')} · ${esc(c.dates || 'TBA')}</div>
        </div>
        ${statusBadge(c)}
      </div>
      <div class="card-badges">${scopeBadge(c)}${sourceBadge(c)}</div>
    </div>
    <div class="facts">
      <div class="fact"><label>Deadline</label><strong>${esc(fmtDate(c.deadline))}</strong></div>
      <div class="fact"><label>Video</label><strong>${esc(videoText(c))}</strong></div>
    </div>
    <div class="eligibility ${esc(c.eligClass || '')}"><strong>Eligibility:</strong> ${esc(c.eligibility || 'TBA')}</div>
    <details>
      <summary>Full requirements & sources</summary>
      <div class="detail-body">
        <h4>Video / preselection</h4><p>${esc(c.video || 'TBA')}</p>
        <h4>Repertoire</h4><p>${esc(c.repertoire || 'TBA')}</p>
        <h4>Prize context</h4><p>${esc(c.prizes || 'TBA')}</p>
        <h4>Jury</h4><p>${esc(c.jury || 'TBA')}</p>
        ${c.note ? `<h4>Planning note</h4><p>${esc(c.note)}</p>` : ''}
        ${links ? `<div class="sources">${links}</div>` : ''}
      </div>
    </details>
  </article>`;
}

const ordered = [...competitions].sort((a,b) => sortKey(a).localeCompare(sortKey(b)));
document.getElementById('masterBody').innerHTML = ordered.map(masterRow).join('');
document.getElementById('cards').innerHTML = ordered.map(detailCard).join('');

document.getElementById('countAll').textContent = competitions.length;
document.getElementById('countLive').textContent = competitions.filter(c => ['open','future','conditional'].includes(c.status)).length;
document.getElementById('countMajor').textContent = competitions.filter(c => c.major).length;
document.getElementById('countOfficial').textContent = competitions.filter(c => ['official','federation'].includes(c.sourceLevel || 'official')).length;

let activeFilter = 'all';
const search = document.getElementById('search');

function matchesFilter(el) {
  switch (activeFilter) {
    case 'all': return true;
    case 'actionable': return ['open','future','conditional'].includes(el.dataset.status);
    case '2027': return el.dataset.year.includes('2027') || el.dataset.search.includes('2027');
    case '2028': return el.dataset.year.includes('2028') || el.dataset.search.includes('2028');
    case 'major': return el.dataset.major === 'true';
    case 'cello': return el.dataset.scope === 'cello';
    case 'mixed': return ['mixed','institution','national'].includes(el.dataset.scope);
    case 'watch': return ['watch','unconfirmed','dormant'].includes(el.dataset.status);
    case 'youth': return el.dataset.scope === 'youth' || el.dataset.tier === 'youth';
    case 'online': return el.dataset.scope === 'online' || el.dataset.source === 'directory' || el.dataset.tier === 'directory';
    default: return true;
  }
}

function applyFilters() {
  const q = search.value.trim().toLowerCase();
  document.querySelectorAll('.master-row, #cards .card').forEach(el => {
    const visible = matchesFilter(el) && (!q || el.dataset.search.includes(q));
    el.classList.toggle('hidden', !visible);
  });
}

document.querySelectorAll('.filter').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeFilter = btn.dataset.filter;
  applyFilters();
}));
search.addEventListener('input', applyFilters);
