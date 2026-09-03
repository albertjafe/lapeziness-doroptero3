// Research corrections and additional long-range cello competition leads.
const pauloLead = competitions.find(c => c.id === 'pauloLead');
if (pauloLead) Object.assign(pauloLead, {
  year:'Cycle watch',
  dates:'No current call found · a 2028 return is plausible if the five-year cycle continues',
  status:'watch',
  eligibility:'Next-edition eligibility TBA. Do not reuse the 2023 age rules as if they were current.',
  note:'Corrected from an earlier 2027 lead: the documented edition was in 2023 and institutional material describes the Paulo competition as taking place every five years. That points towards 2028 if the cycle continues, but no current organiser call was found, so this remains a watch item only.',
  sources:[['2023 / five-year-cycle reference','https://musicamundischool.org/paulo-international-cello-competition-helsinki-finland-participation-of-liav-kerbel/']]
});

competitions.push(
{
 id:'janacek28',name:'International Leoš Janáček Competition in Brno · Cello',year:'2028',dates:'2028 · exact dates TBA',location:'Brno, Czech Republic',deadline:'TBA',status:'watch',tier:'professional',major:true,
 eligibility:'The competition’s general age ceiling is 35; the detailed 2028 cello rules are not yet published.',eligClass:'watch',video:'TBA for the 2028 cello cycle.',
 repertoire:'TBA. The official competition rotates disciplines over a five-year cycle; cello was held in 2023, making 2028 the next expected cello year if the published rotation continues.',
 prizes:'2028 cello prizes TBA.',jury:'2028 jury TBA.',note:'A well-grounded 2028 cycle watch: official Janáček competition information shows the rotating discipline structure and the recent cello edition in 2023.',
 sources:[['Official competition','https://hf.jamu.cz/en/projects/international-leos-janacek-competition-in-brno/']]
},
{
 id:'penderecki28',name:'International Krzysztof Penderecki Cello Competition',year:'2028',dates:'2028 · exact dates TBA',location:'Kraków, Poland',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'2028 eligibility TBA.',eligClass:'watch',video:'TBA for the next edition.',
 repertoire:'TBA. The official 2023 competition information states that the event is held every five years; therefore 2028 is the expected next cycle, but a 2028 rulebook has not yet been published.',
 prizes:'2028 prizes TBA.',jury:'2028 jury TBA.',note:'Strong 2028 watch target because the organiser explicitly describes a five-year cycle. Wait for the actual 2028 call before fixing Penderecki-specific repertoire.',
 sources:[['Official competition','https://pendereckicello.amuz.krakow.pl/?lang=en&page_id=113']]
},
{
 id:'mahler27',name:'Gustav Mahler Prize Cello Competition',year:'2027 lead',dates:'2027 · call not yet found',location:'Online / Czech Republic',deadline:'TBA',status:'unconfirmed',tier:'secondary',major:false,
 eligibility:'2027 categories TBA. The 2026 edition included adult birth-year groups as well as younger categories.',eligClass:'watch',video:'Recent editions are video-based; 2027 requirements TBA.',
 repertoire:'2027 programme TBA. The 2026 edition used free-choice repertoire within category time limits.',prizes:'2027 prizes TBA; the 2026 edition advertised a €5,000 prize pool.',jury:'2027 jury TBA.',note:'Recent official editions ran in consecutive years, so this is worth checking for a 2027 call, but no 2027 announcement was verified in this research pass.',
 sources:[['Official 2026 edition','https://www.mahler.institute/en/cello-2026/']]
},
{
 id:'feuermann',name:'Grand Prix Emanuel Feuermann',year:'Cycle watch',dates:'Next edition not announced',location:'Berlin, Germany',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'Next-edition rules TBA. The official site currently still displays the 2022 edition.',eligClass:'watch',video:'Next-edition requirements TBA. In 2022, preselection used four recent uncut YouTube recordings.',
 repertoire:'Next edition TBA. The 2022 programme combined Bach, Schubert, Strauss/Klengel preselection, commissioned work, Beethoven, Classical concerto repertoire and a major concerto final.',
 prizes:'Next-edition prizes TBA. In 2022 the Grand Prix was €15,000, with €10,000 / €5,000 second and third prizes plus special prizes and concert-promotion support.',jury:'Next-edition jury TBA.',note:'Prestigious cello-specific cycle to monitor. There is no new call on the official site yet, so old 2022 dates and repertoire are shown only as context, not as current rules.',
 sources:[['Official competition','https://www.gp-emanuelfeuermann.de/en/'],['Last published rules','https://www.gp-emanuelfeuermann.de/en/participation/']]
},
{
 id:'naumburg',name:'Walter W. Naumburg International Cello Competition',year:'Cycle watch',dates:'Next cello edition not announced',location:'New York, USA',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'Next cello edition rules TBA.',eligClass:'watch',video:'TBA for the next cello edition.',repertoire:'TBA. The most recent cello competition was held in 2024; the foundation’s 2026 competition is violin, so there is no actionable cello call at present.',prizes:'Next cello edition prizes TBA.',jury:'Next cello jury TBA.',note:'Important American career competition to keep on the master watchlist, but not something to prepare specifically for until the foundation announces the next cello cycle.',
 sources:[['Official Naumburg Foundation','https://www.naumburg.org/']]
}
);

const fmtDate = d => { if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')) return d||'TBA'; const x=new Date(d+'T12:00:00'); return x.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); };
const daysLeft = d => { if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')) return null; const now=new Date(); now.setHours(0,0,0,0); const x=new Date(d+'T00:00:00'); return Math.ceil((x-now)/86400000); };
const statusText={open:'OPEN',future:'FUTURE',watch:'WATCH',conditional:'CONDITIONAL',unconfirmed:'UNCONFIRMED'};
function card(c){ const days=daysLeft(c.deadline); const soon=days!==null&&days>=0&&days<=30; const deadlineText = fmtDate(c.deadline)+(days!==null&&days>=0?` · ${days} day${days===1?'':'s'} left`: ''); const links=(c.sources||[]).map(s=>`<a class="source" href="${s[1]}" target="_blank" rel="noopener">${s[0]} ↗</a>`).join(''); return `<article class="card" data-year="${c.year}" data-status="${c.status}" data-tier="${c.tier}" data-major="${c.major}" data-search="${[c.name,c.location,c.repertoire,c.video,c.jury,c.note].join(' ').toLowerCase()}">
<div class="card-top"><div class="card-row"><div><div class="eyebrow">${c.year}</div><h3>${c.name}</h3><div class="where">${c.location} · ${c.dates}</div></div><span class="tag ${c.status}">${statusText[c.status]}</span></div></div>
<div class="facts"><div class="fact deadline ${soon?'soon':''}"><label>Application deadline</label><strong>${deadlineText}</strong></div><div class="fact"><label>Application opens</label><strong>${c.opens?fmtDate(c.opens):(c.status==='open'||c.status==='conditional'?'Open / check now':'TBA')}</strong></div><div class="fact"><label>Video / prescreen</label><strong>${c.video.startsWith('Required')?'Required':c.video.startsWith('No ')?'Not stated':'See details'}</strong></div><div class="fact"><label>Level</label><strong>${c.tier.charAt(0).toUpperCase()+c.tier.slice(1)}</strong></div></div>
<div class="eligibility ${c.eligClass||''}"><strong>Eligibility:</strong> ${c.eligibility}</div><div class="summary">${c.note}</div>
<details><summary>Repertoire, prizes & jury</summary><div class="detail-body"><h4>Video / preselection</h4><p>${c.video}</p><h4>Repertoire</h4><p>${c.repertoire}</p><h4>Prizes / support</h4><p>${c.prizes}</p><h4>Jury</h4><p>${c.jury}</p>${links?`<div class="sources">${links}</div>`:''}</div></details></article>`; }

const cards=document.getElementById('cards'); cards.innerHTML=competitions.map(card).join('');
document.getElementById('countAll').textContent=competitions.length; document.getElementById('countOpen').textContent=competitions.filter(c=>['open','conditional'].includes(c.status)).length; document.getElementById('countMajor').textContent=competitions.filter(c=>c.major).length;
const sorted=[...competitions].sort((a,b)=>{const ad=/^\d/.test(a.deadline)?a.deadline:'9999',bd=/^\d/.test(b.deadline)?b.deadline:'9999';return ad.localeCompare(bd)});
document.getElementById('calendarBody').innerHTML=sorted.map(c=>`<tr><td><strong>${fmtDate(c.deadline)}</strong></td><td>${c.name}</td><td>${c.dates}</td><td>${c.location}</td><td><span class="tag ${c.status}">${statusText[c.status]}</span></td></tr>`).join('');
let filter='all'; const search=document.getElementById('search'); function apply(){ const q=search.value.trim().toLowerCase(); document.querySelectorAll('#cards .card').forEach(el=>{let ok=filter==='all'||(filter==='major'&&el.dataset.major==='true')||(filter==='watch'&&['watch','unconfirmed'].includes(el.dataset.status))||(filter==='secondary'&&['secondary','development'].includes(el.dataset.tier))||el.dataset.status===filter||el.dataset.year===filter; if(q&&!el.dataset.search.includes(q)) ok=false; el.classList.toggle('hidden',!ok);});}
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');filter=b.dataset.filter;apply();}));search.addEventListener('input',apply);