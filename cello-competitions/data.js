const competitions = [
{
 id:'vienna26',name:'Vienna International Classic Strings Competition',year:'2026',dates:'Winners’ concert: 18 Oct 2026',location:'Vienna, Austria',deadline:'2026-09-13',status:'open',tier:'secondary',major:false,
 eligibility:'Open to all ages and nationalities.',eligClass:'',video:'Yes — free-choice repertoire by video; no stated minimum duration.',
 repertoire:'Free choice for violin, viola, cello, double bass, harp and guitar categories. This is video-first rather than a fixed multi-round cello syllabus.',
 prizes:'Grand Prize €4,500; main and special prizes. First-prize category winners are invited to perform at Mozarthaus Vienna on 18 October 2026 with professional photo/audio/video documentation.',
 jury:'International Music Academy instructors and invited guests; see current competition page.',note:'Very close deadline and easy repertoire fit. Best used only if a strong existing video is ready.',
 sources:[['Official competition','https://www.classicalmusiccompetition.org/5th-classic-strings-competition']]
},
{
 id:'goritiensis26',name:'Musica Goritiensis · 6th International Music Competition',year:'2026',dates:'21–28 Nov 2026',location:'Gorizia, Italy',deadline:'2026-10-10',status:'open',tier:'secondary',major:false,
 eligibility:'Young musicians up to age 30, all nationalities; cello is an official section.',eligClass:'',video:'Live competition; current page announces live-streamed performances. Check the regulation for category-specific submission details.',
 repertoire:'Category-based cello programme. The senior category uses a two-round structure; consult the 2026 regulation before fixing repertoire.',
 prizes:'Cash prizes plus concert opportunities; senior-category special opportunities include a digital recording/distribution prize.',jury:'Cello jury published on the competition website.',note:'A real live competition with a practical European location; lower prestige than the major international targets, but potentially useful.',
 sources:[['Official competition','https://www.musicagoritiensis.eu/en/competition/']]
},
{
 id:'dicc27',name:'Danish International Cello Competition',year:'2027',dates:'26 Jun – 3 Jul 2027',location:'Sønderborg, Denmark',deadline:'2026-10-25',status:'open',tier:'major',major:true,
 eligibility:'All nationalities; age 30 or younger on the first day (born after 27 Jun 1996).',eligClass:'',video:'Required · max 35 min total. One cello sonata (solo or with piano) + one movement of a Romantic concerto. Separate, unedited landscape files; direct uploads, not YouTube/Vimeo links.',
 repertoire:'R1: contemporary solo programme + Bach suite movements. R2: Danish contemporary work + selected major-sonata repertoire. Semifinal: Haydn C or D with orchestra, no conductor. Final: Dvořák, Elgar or Schumann concerto.',
 prizes:'€14,000 / €8,000 / €5,000 + special prizes. First prize also includes 10 orchestra concerts, a PENTATONE album with the Danish Philharmonic, three years of management and long-term mentoring. Accommodation + breakfast provided for all 24 participants.',
 jury:'Daniel Müller-Schott (president), Andreas Brantelid, Tatjana Vassiljeva, Kathryn Stott and further published jury/industry members on the official page.',note:'The strongest immediately actionable target in this dossier. The preselection programme is flexible enough to build from existing repertoire.',
 sources:[['Official competition','https://www.dicc.dk/dicc-2027'],['Application process','https://www.dicc.dk/dicc-2027/application-process'],['Apply','https://apply.dicc.dk/']]
},
{
 id:'fmb27',name:'Felix Mendelssohn Bartholdy Hochschulwettbewerb · Cello',year:'2027',dates:'13–17 Jan 2027',location:'Berlin, Germany',deadline:'2026-11-01',status:'conditional',tier:'major',major:true,
 eligibility:'Under 30, but only students/junior students at German RKM member music universities. Each university runs an internal selection and can nominate a limited number of cellists.',eligClass:'cond',video:'Not a normal open video application: institutional preselection / nomination is the key gate.',
 repertoire:'R1 (max 25 min): new commissioned solo-cello work by Hannah Eisendle + Mendelssohn Sonata Op.45 or Op.58. R2 (max 45 min): one complete Bach suite + free recital repertoire. Final: orchestral stage.',
 prizes:'€6,000 / €4,000 / €2,000; €500 commissioned-work prize; additional €4,000 Friends of Young Musicians prize and follow-on concert opportunities.',jury:'2027 jury details are published/updated by the competition; institutional nomination remains the first thing to check.',note:'Potentially excellent if the institutional eligibility condition is met. Do not plan around it until the university can confirm nomination.',
 sources:[['Official 2027 call','https://www.fmb-hochschulwettbewerb.de/ausschreibung-2027/']]
},
{
 id:'split27',name:'Split International Cello Competition',year:'2027',dates:'19–22 Jan 2027',location:'Split, Croatia',deadline:'2026-12-01',status:'open',tier:'professional',major:false,
 eligibility:'Open to cellists up to age 32 at the time of the competition.',eligClass:'',video:'No separate cello preselection video is stated on the current cello page; application is via the online form with fee.',
 repertoire:'R1: dall’Abaco caprice + Piatti caprice or Popper Op.73 etude + Bach Suite Prelude. Semifinal: major cello sonata (Beethoven/Brahms/Shostakovich/Prokofiev/Britten options) + virtuoso piece. Final: one concerto from the published Haydn/Schumann/Saint-Saëns/Elgar/Dvořák/Rococo/Shostakovich list.',
 prizes:'€3,000 / €1,500 / €500; €200 Croatian-composition prize; €200 audience award; masterclass, winners’ concert and AV recording.',jury:'Romain Garioud, Justus Grimm, Karmen Pečar, Gal Faganel and Vid Veljak are displayed on the current page (the heading still says TBA, so verify before relying on final jury composition).',note:'Very clear requirements and useful standard repertoire. Application fee €100 early bird / €115 regular; official pianist optional €15.',
 sources:[['Official cello page','https://simc.hr/cello/']]
},
{
 id:'davidov27',name:'International K. Davidov Cello Competition',year:'2027',dates:'7–13 Mar 2027',location:'Kuldīga / Riga, Latvia',deadline:'2027-01-11',opens:'2026-11-16',status:'future',tier:'professional',major:false,
 eligibility:'2027 adult-category age rules should be rechecked when the new regulation is fully posted. Previous edition Group C was age 21–29.',eligClass:'watch',video:'2027 application materials not yet fully surfaced in the official page index.',
 repertoire:'2027 programme should be confirmed from the new regulation. Previous adult structure combined a Classical sonata, a Karl Davidov work, Bach, major sonata/solo repertoire and a concerto final.',
 prizes:'2027 prize distribution TBA. The competition culminates in a laureates’ concert with Sinfonietta Rīga at the Latvian Academy of Music.',jury:'Kristīne Blaumane is announced as head of jury; full jury to be announced.',note:'Applications are explicitly scheduled for 16 Nov 2026–11 Jan 2027. Good watch target, but wait for the actual 2027 adult programme before committing repertoire.',
 sources:[['Official home','https://www.kuldigacello.com/'],['Application dates','https://www.kuldigacello.com/application-form']]
},
{
 id:'sinfonima27',name:'SINFONIMA Competition · Cello cycle',year:'2027',dates:'2027 · exact audition date to check',location:'Germany',deadline:'2027-01-30',status:'conditional',tier:'development',major:false,
 eligibility:'For young string players from Germany/Switzerland and students at German/Swiss music universities in the final phase of artistic training.',eligClass:'cond',video:'See the 2027 call when applying.',
 repertoire:'Competition-specific call; this is primarily an instrument-support competition rather than a standard cash-prize recital contest.',prizes:'High-quality string instruments are awarded on loan, typically for two years.',jury:'See the 2027 call.',note:'Worth checking if the geographic/study requirement fits; potentially more valuable than a small cash prize if instrument support is useful.',
 sources:[['German Music Information Centre listing','https://miz.org/en/institutions/sinfonima-wettbewerb-i31969']]
},
{
 id:'geringas27',name:'International Klaipėda David Geringas Cello Competition',year:'2027',dates:'3–9 May 2027',location:'Klaipėda, Lithuania',deadline:'2027-03-31',status:'future',tier:'major',major:true,
 eligibility:'Professional Group D: age 30 or younger on 3 May 2027 (born 3 May 1997 or later); all nationalities.',eligClass:'',video:'Required · 10–15 min free programme, max 3 YouTube links, unedited. Recordings may come from different dates and may overlap the live competition programme.',
 repertoire:'R1: Bach Prelude/Sarabande/Gigue + Penderecki Per Slava. R2: Debussy Sonata + Balsys excerpts + one Beethoven first movement + one virtuoso work (Rostropovich/Popper/Ducros). Final with orchestra: Dvořák, Schumann or Elgar concerto.',
 prizes:'Professional Group D: €10,000 / €7,500 / €5,000. Total competition cash fund €30,000; special awards may also be given.',jury:'Professional jury chaired by David Geringas; current jury pages include Michaela Fukačová and other international cellists/teachers.',note:'Excellent target: very clear 2027 regulation, meaningful prize fund and a flexible initial video.',
 sources:[['Official regulations','https://www.koncertusale.lt/en/klaipeda-cello-festival/international-david-geringas-cello-competition-2027/regulations-2027/'],['Programme','https://celloklaipeda.artistdb.eu/en/b/program'],['Registration guidance','https://celloklaipeda.artistdb.eu/en/b/registration']]
},
{
 id:'popper27',name:'David Popper International Cello Competition · 12th edition',year:'2027',dates:'Oct 2027',location:'Várpalota, Hungary',deadline:'TBA',status:'watch',tier:'professional',major:false,
 eligibility:'Age-group categories will be published with the official 2027 announcement.',eligClass:'watch',video:'TBA for 2027.',repertoire:'TBA. Full announcement with exact dates, repertoire, rules and jury is expected in March 2027; registration opens in May 2027.',prizes:'TBA for 2027.',jury:'TBA for 2027.',note:'Confirmed 2027 edition. Put a reminder around March 2027 rather than preparing speculative repertoire now.',sources:[['Official competition','https://www.popper-cello-competition.com/']]
},
{
 id:'schoenfeld27',name:'Schoenfeld International String Competition · Cello',year:'2027',dates:'2027 · TBA',location:'Harbin, China',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'2027 cello eligibility/rules TBA. Do not reuse old age rules as if they were current.',eligClass:'watch',video:'2027 prescreening format TBA.',repertoire:'2027 repertoire TBA. Previous editions used a substantial prescreening/live-round structure, but the new call should be treated as authoritative.',prizes:'WFIMC 2026 yearbook lists USD 160,000 total prize money across violin, cello and chamber music; recordings, marketing and artist-management opportunities; limited travel support.',jury:'TBA.',note:'Major international watch target. 2027 cello/chamber/violin edition is confirmed by WFIMC, but current detailed cello web page still contains older rules.',sources:[['WFIMC 2026 yearbook entry','https://online.flippingbook.com/view/309220351/119/'],['Competition website','https://schoenfeldcompetition.com/cello.php']]
},
{
 id:'tchaikovsky27',name:'International Tchaikovsky Competition · Cello',year:'2027',dates:'2027 · TBA',location:'Russia · venues TBA',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'2027 age limits and admission rules have not yet been published.',eligClass:'watch',video:'TBA for 2027.',repertoire:'TBA for 2027. Historically a very large solo/sonata/virtuoso/concerto programme, so this needs long lead time once rules appear.',prizes:'2027 prizes TBA.',jury:'2027 jury TBA.',note:'The official site explicitly says “See you in 2027” and cello remains a core discipline. Treat as a major long-range target, not an actionable application yet.',sources:[['Official competition','https://www.tchaikovskycompetition.com/en/']]
},
{
 id:'ard28',name:'ARD International Music Competition · Violoncello',year:'2028',dates:'Sep 2028 · exact dates TBA',location:'Munich, Germany',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'2028 cello age rules TBA.',eligClass:'watch',video:'TBA.',repertoire:'TBA for the 2028 cello discipline.',prizes:'TBA for the 2028 cello cycle.',jury:'TBA.',note:'Confirmed by ARD as one of the 2028 disciplines (with horn, piano and viola). A very important long-range target.',sources:[['Official ARD competition','https://www.ard-musikwettbewerb.de/en/about-the-competition/']]
},
{
 id:'enescu28',name:'George Enescu International Competition · Cello',year:'2028',dates:'2028 · TBA',location:'Bucharest, Romania',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'2028 cello regulations TBA.',eligClass:'watch',video:'TBA; recent editions use online preselection.',repertoire:'2028 programme TBA. Recent cello editions use multiple solo/sonata rounds, a classical concerto semifinal and major concerto final.',prizes:'2028 split TBA. WFIMC lists the next 2028 edition and significant total prize/career-support structure in the current cycle.',jury:'2028 jury TBA.',note:'WFIMC confirms the next cello edition in 2028. Keep it in the two-year repertoire horizon even though the 2026 application is already closed.',sources:[['WFIMC 2026 yearbook','https://online.flippingbook.com/view/309220351/90/'],['Official competition','https://festivalenescu.ro/en/home']]
},
{
 id:'isangyun28',name:'ISANGYUN Competition · Cello',year:'2028',dates:'Nov 2028 · exact dates TBA',location:'Tongyeong, South Korea',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'2028 cello age rules TBA.',eligClass:'watch',video:'TBA for 2028.',repertoire:'TBA for the 2028 cello cycle.',prizes:'TBA for 2028. Recent editions include substantial cash and special prizes.',jury:'TBA.',note:'Official organiser confirms the rotation: piano 2026, violin 2027, cello 2028. Strong major-competition watch target.',sources:[['Official TIMF competition page','https://www.timf.org/kr/sub/business/concours_intro.asp']]
},
{
 id:'lutoslawski',name:'Witold Lutosławski International Cello Competition',year:'Cycle watch',dates:'Next edition not announced',location:'Warsaw, Poland',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'Next-edition rules TBA. The 2024 edition raised the age limit to 30.',eligClass:'watch',video:'Previous selection: Bach Prelude + Lutosławski/Penderecki + Piatti/Popper.',repertoire:'Previous live stages combined Lutosławski, Chopin, Bach, Boccherini, major sonata/contemporary works and two concertos for the final.',prizes:'Next-edition prizes TBA.',jury:'Next-edition jury TBA.',note:'No next edition was officially announced in this research pass, but this is important enough to keep on the cycle watchlist.',sources:[['Official competition history','https://www.lutoslawski-cello.art.pl/en/historia-konkursu.html']]
},
{
 id:'budapest',name:'Budapest International Cello Competition',year:'Cycle watch',dates:'Next edition not announced',location:'Budapest, Hungary',deadline:'TBA',status:'watch',tier:'major',major:true,
 eligibility:'Next-edition rules TBA.',eligClass:'watch',video:'2025 application used an introduction video + uncut Bach movements + a post-1940/round-II work.',repertoire:'Next edition TBA. 2025 culminated in major orchestral finals including Shostakovich, Prokofiev Sinfonia Concertante and Dvořák.',prizes:'2025: €18,000 / €12,000 / €6,000 plus audience and concert prizes. Next edition TBA.',jury:'Next edition TBA.',note:'A strong competition to monitor, but there is no verified 2027/28 call yet.',sources:[['Competition site / 2025 result','https://musiccompetitionbudapest.com/en/news/159/the-budapest-international-cello-competition-2025-has-come-to-an-end']]
},
{
 id:'pauloLead',name:'International Paulo Cello Competition',year:'Unconfirmed lead',dates:'A 2027 cycle is mentioned by a secondary source; official call not found',location:'Helsinki, Finland',deadline:'TBA',status:'unconfirmed',tier:'major',major:true,
 eligibility:'Historically aimed at international young professional cellists; do not assume the old age limit applies to a future call.',eligClass:'watch',video:'TBA.',repertoire:'TBA.',prizes:'TBA.',jury:'TBA.',note:'Important enough to watch, but I would not put it into the preparation calendar until the organiser publishes a current call. One secondary German cello-study resource says 2027; that same resource contains at least one outdated discipline listing elsewhere, so this item is intentionally marked unconfirmed.',sources:[['Historical official-domain reference / general info','http://cellocompetitionpaulo.org/']]
},
{
 id:'cassadoLead',name:'Gaspar Cassadó International Cello Competition',year:'Unconfirmed lead',dates:'A 2027 cycle is mentioned by a secondary source; current official call not found',location:'Florence / historical venues',deadline:'TBA',status:'unconfirmed',tier:'professional',major:false,
 eligibility:'TBA.',eligClass:'watch',video:'TBA.',repertoire:'TBA.',prizes:'TBA.',jury:'TBA.',note:'Treat only as a research lead until a current official announcement appears. Do not spend preparation time on speculative repertoire.',sources:[]
}
];