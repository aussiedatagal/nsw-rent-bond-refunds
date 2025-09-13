/* NSW Rental Bonds Explorer */
function titleCaseSuburbs(s){
  if(!s) return "";
  const parts = s.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  function tcWord(w){
    return w.split(/([\-'\s])/).map(seg => {
      if (/[\-'\s]/.test(seg)) return seg;
      if (seg.length===0) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    }).join('');
  }
  return parts.map(seg => seg.split(' ').map(tcWord).join(' ')).join(', ');
}

const fmtAUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const fmtPct1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });

function arrMin(arr, fallback=0){ let m=Infinity; for(let i=0;i<arr.length;i++){const v=arr[i]; if(Number.isFinite(v)&&v<m)m=v;} return m===Infinity?fallback:m; }
function arrMax(arr, fallback=0){ let m=-Infinity; for(let i=0;i<arr.length;i++){const v=arr[i]; if(Number.isFinite(v)&&v>m)m=v;} return m===-Infinity?fallback:m; }
function ensureSpan(min, max, eps=1){ if(!Number.isFinite(min))min=0; if(!Number.isFinite(max))max=min+eps; if(min===max)return [min,min+eps]; if(min>max)return [max,min]; return [min,max]; }

let RAW = { rows: [], suburbs: new Map(), poa: null };
let MAP = { map: null, layer: null, featureIndex: new Map(), aggByPc: null, rankIndex: null, rankN: 0, legendEl: null };
let UI = {};
let FILTERS = { dwellings: new Set(['F','H','T','O','U']), percent: [0,100], withheld: [0,100], days: [0,2000], bond: [0,10000], count: [20, 999999], sortBy: 'percent', sortDir: 'asc' };

const bondValue = r => (r['Payment To Agent'] ?? 0) + (r['Payment To Tenant'] ?? 0);
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function colorByRank(rankRatio){ const h = (1 - rankRatio) * 120; return `hsl(${h}, 70%, 55%)`; }
function toKey(pc){ return String(pc).padStart(4,'0'); }

function legendLabelPair(key, dir){
  const map = {
    percent: ['lower % withheld','higher % withheld'],
    withheld: ['less frequent withholding','more frequent withholding'],
    days: ['shorter tenancies','longer tenancies'],
    bond: ['smaller total bond','larger total bond'],
  };
  const pair = map[key] || ['lower','higher'];
  return dir === 'asc' ? pair : [pair[1], pair[0]];
}
function updateLegend(){
  if(!MAP.legendEl) return;
  const [left,right] = legendLabelPair(FILTERS.sortBy, FILTERS.sortDir);
  MAP.legendEl.innerHTML = `<span>${left}</span><div class="gradient"></div><span>${right}</span>`;
}

function getSuburbName(pc){ return RAW.suburbs.get(Number(pc)) || ''; }
function displayName(pc){ const s = getSuburbName(pc); return s && s.length ? s : `Postcode ${pc}`; }

function summaryHTML(s){
  return `<div class="kv">
    <div><span class="badge">Records</span> ${fmtNum.format(s.records)}</div>
    <div><span class="badge">Postcodes</span> ${fmtNum.format(s.postcodes)}</div>
    <div><span class="badge">Percent of bond withheld from tenant</span> ${fmtPct1.format(s.avgPercent)}%</div>
    <div><span class="badge">Average tenancy length (days)</span> ${fmtNum.format(s.avgDays)}</div>
    <div><span class="badge">Average total bond</span> ${fmtAUD.format(s.avgBond)}</div>
    <div><span class="badge">Percent of rentals with any bond withheld</span> ${fmtPct1.format(s.pctWithheld)}%</div>
  </div>`;
}
function typesHTML(freq){
  const names = {F:"Flat/unit",H:"House",T:"Terrace/townhouse",O:"Other",U:"Unknown"};
  const total = Object.values(freq).reduce((a,b)=>a+b,0) || 1;
  return Object.entries(freq).sort((a,b)=> b[1]-a[1]).map(([t,c])=> {
    const pct = (c/total)*100;
    return `<span class="badge">${names[t]||t}: ${fmtPct1.format(pct)}% (${fmtNum.format(c)})</span>`;
  }).join('');
}
function cardHTML(pc, agg, rank, rankN){
  const title = displayName(pc);
  const rlabel = rankN>0 ? `Rank: ${rank}/${rankN}` : "No rank";
  const pcBadge = `<span class="badge">Postcode</span> <span class="mono">${pc}</span>`;
  return `<article class="card-item" data-postcode="${pc}">
    <header><div class="title">${title}</div><div class="badge">${rlabel}</div></header>
    <div class="suburbs">${pcBadge}</div>
    <div class="kv" style="margin-top:6px">
      <div><span class="badge">Percent of bond withheld from tenant</span> ${fmtPct1.format(agg.avgPercent)}%</div>
      <div><span class="badge">Average tenancy length (days)</span> ${fmtNum.format(agg.avgDays)}</div>
      <div><span class="badge">Average total bond</span> ${fmtAUD.format(agg.avgBond)}</div>
      <div><span class="badge">Percent of rentals with any bond withheld</span> ${fmtPct1.format(agg.pctWithheld)}%</div>
      <div><span class="badge">Data points</span> ${fmtNum.format(agg.count)}</div>
    </div>
    <div class="types">${typesHTML(agg.typeCounts)}</div>
  </article>`;
}
function popupHTML(pc, agg, rank, rankN){
  const title = displayName(pc);
  const rlabel = rankN>0 ? `Rank: ${rank}/${rankN}` : "No rank";
  return `<div style="min-width:260px">
    <div style="font-weight:700; margin-bottom:6px">${title}</div>
    <div class="kv" style="grid-template-columns: 1fr; gap:4px">
      <div><span class="badge">Percent of bond withheld from tenant</span> ${fmtPct1.format(agg.avgPercent)}%</div>
      <div><span class="badge">Average tenancy length (days)</span> ${fmtNum.format(agg.avgDays)}</div>
      <div><span class="badge">Average total bond</span> ${fmtAUD.format(agg.avgBond)}</div>
      <div><span class="badge">Percent of rentals with any bond withheld</span> ${fmtPct1.format(agg.pctWithheld)}%</div>
      <div><span class="badge">Data points</span> ${fmtNum.format(agg.count)}</div>
      <div><span class="badge">Rank</span> ${rlabel}</div>
    </div>
    <div class="types" style="margin-top:6px">${typesHTML(agg.typeCounts)}</div>
  </div>`;
}

// Load data
async function loadAll(){
  const [poaRes, subCSV, bondsCSV] = await Promise.all([
    fetch('data/POA_2021_NSW.geojson').then(r=>r.json()),
    fetch('data/postcode_to_suburbs.csv').then(r=>r.text()),
    fetch('data/rental-bonds-refunds-year-2024.csv').then(r=>r.text()),
  ]);
  RAW.poa = poaRes;

  const sub = Papa.parse(subCSV, { header: true, skipEmptyLines: true, dynamicTyping: true });
  sub.data.forEach(row => { if(row.Postcode!=null) RAW.suburbs.set(Number(row.Postcode), titleCaseSuburbs(String(row.Suburbs || '').trim())); });

  const bonds = Papa.parse(bondsCSV, { header: true, skipEmptyLines: true, dynamicTyping: true });
  RAW.rows = bonds.data.map(r => ({
    Postcode: Number(r['Postcode']),
    'Dwelling Type': String(r['Dwelling Type']||'').trim(),
    Bedrooms: Number(r['Bedrooms']),
    'Payment To Agent': Number(r['Payment To Agent']||0),
    'Payment To Tenant': Number(r['Payment To Tenant']||0),
    'Days Bond Held': Number(r['Days Bond Held']||0),
    'Percent To Agent': Number(r['Percent To Agent']||0),
  })).filter(r => !Number.isNaN(r.Postcode));

  initRanges();
  initMap();
  initUI();
  initAboutModal();
  initHelpTips();
  update();
}

function initRanges(){
  const percMin = 0, percMax = 100;
  const daysVals = RAW.rows.map(r => r['Days Bond Held']).filter(v=>Number.isFinite(v));
  let daysMin = arrMin(daysVals, 0), daysMax = arrMax(daysVals, 0); [daysMin, daysMax] = ensureSpan(daysMin, daysMax);
  const bondVals = RAW.rows.map(bondValue).filter(v=>Number.isFinite(v));
  let bondMin = arrMin(bondVals, 0), bondMax = arrMax(bondVals, 0); [bondMin, bondMax] = ensureSpan(bondMin, bondMax);

  FILTERS.percent = [percMin, percMax];
  FILTERS.withheld = [0, 100];
  FILTERS.days = [daysMin, daysMax];
  FILTERS.bond = [bondMin, bondMax];

  // Count slider from global dataset
  const allAgg = aggregate(RAW.rows);
  const allCounts = allAgg.map(([pc,a])=> a.count);
  let cmin = arrMin(allCounts, 0), cmax = arrMax(allCounts, 0); [cmin, cmax] = ensureSpan(cmin, cmax);
  FILTERS.count = [Math.min(20, cmax), cmax];

  UI.percentSlider = createSlider('sliderPercent', percMin, percMax, FILTERS.percent, 0.1, '%', (v)=>{ FILTERS.percent = v; syncInputs('percent', v); update(); });
  UI.withheldSlider = createSlider('sliderWithheld', 0, 100, FILTERS.withheld, 0.1, '%', (v)=>{ FILTERS.withheld = v; syncInputs('withheld', v); update(); });
  UI.daysSlider = createSlider('sliderDays', daysMin, daysMax, FILTERS.days, 1, '', (v)=>{ FILTERS.days = v.map(x=>Math.round(x)); syncInputs('days', v); update(); });
  UI.bondSlider = createSlider('sliderBond', bondMin, bondMax, FILTERS.bond, 1, '', (v)=>{ FILTERS.bond = v; syncInputs('bond', v); update(); });
  UI.countSlider = createSlider('sliderCount', cmin, cmax, FILTERS.count, 1, '', (v)=>{ FILTERS.count = v.map(x=>Math.round(x)); syncInputs('count', FILTERS.count); update(); });

  hookInputs('percent', percMin, percMax, 0.1, val => { FILTERS.percent = val; UI.percentSlider.set(val); update(); });
  hookInputs('withheld', 0, 100, 0.1, val => { FILTERS.withheld = val; UI.withheldSlider.set(val); update(); });
  hookInputs('days', daysMin, daysMax, 1, val => { FILTERS.days = val.map(Math.round); UI.daysSlider.set(val); update(); });
  hookInputs('bond', bondMin, bondMax, 1, val => { FILTERS.bond = val; UI.bondSlider.set(val); update(); });
  hookInputs('count', cmin, cmax, 1, val => { FILTERS.count = val.map(Math.round); UI.countSlider.set(val); update(); });
}

function createSlider(id, min, max, start, step, suffix, onUpdate){
  const el = document.getElementById(id);
  const hasW = (typeof wNumb === 'function');
  const tooltips = hasW ? [ wNumb({decimals: step>=1?0:1, suffix}), wNumb({decimals: step>=1?0:1, suffix}) ] : [true, true];
  noUiSlider.create(el, { start, connect: true, step, tooltips, range: { min, max } });
  el.noUiSlider.on('change', (vals)=>{ const v = vals.map(parseFloat); onUpdate(v); });
  return el.noUiSlider;
}
function hookInputs(prefix, min, max, step, onChange){
  const lo = document.getElementById(prefix+'Min'), hi = document.getElementById(prefix+'Max');
  lo.value = Math.round((FILTERS[prefix][0]) * (step>=1?1:10)) / (step>=1?1:10);
  hi.value = Math.round((FILTERS[prefix][1]) * (step>=1?1:10)) / (step>=1?1:10);
  lo.addEventListener('change', ()=>{ let v0 = parseFloat(lo.value); let v1 = parseFloat(hi.value); v0 = clamp(v0, min, v1); onChange([v0, v1]); });
  hi.addEventListener('change', ()=>{ let v0 = parseFloat(lo.value); let v1 = parseFloat(hi.value); v1 = clamp(v1, v0, max); onChange([v0, v1]); });
}
function syncInputs(prefix, range){ const lo = document.getElementById(prefix+'Min'); const hi = document.getElementById(prefix+'Max'); lo.value = range[0]; hi.value = range[1]; }

function initMap(){
  MAP.map = L.map('map', { scrollWheelZoom: true, preferCanvas: true }).setView([-33.5, 147.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(MAP.map);
  function styleFeature(f){ return { color: '#243046', weight: 1, fillColor: '#555', fillOpacity: 0.8 }; }
  MAP.layer = L.geoJSON(RAW.poa, {
    style: styleFeature,
    onEachFeature: (feature, layer) => {
      const pc = ('' + (feature.properties['POA_CODE21'] || feature.properties['POA_NAME21'] || feature.properties['POA_2021'] || feature.properties['POA_CODE'])).padStart(4,'0');
      MAP.featureIndex.set(pc, layer);
      layer.on('click', (e) => {
        const info = MAP.aggByPc ? MAP.aggByPc.get(pc) : null;
        const rank = MAP.rankIndex ? MAP.rankIndex.get(pc) : undefined;
        const rankN = MAP.rankN || 0;
        if (info){
          const html = popupHTML(pc, info, rank, rankN);
          layer.bindPopup(html, { maxWidth: 340 }).openPopup(e.latlng);
        } else {
          layer.bindPopup(`<div><div style='font-weight:700'>${displayName(pc)}</div><div>No data in current filters</div></div>`, { maxWidth: 280 }).openPopup(e.latlng);
        }
      });
    }
  }).addTo(MAP.map);
  MAP.map.fitBounds(MAP.layer.getBounds());
  addLegend();
}

function addLegend(){
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = function(){
    const box = L.DomUtil.create('div','legend-control');
    const inner = L.DomUtil.create('div','legend', box);
    MAP.legendEl = inner;
    return box;
  };
  legend.addTo(MAP.map);
  updateLegend();
}

function initUI(){
  document.querySelectorAll('#dwellingTypes input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e)=>{ if(e.target.checked) FILTERS.dwellings.add(e.target.value); else FILTERS.dwellings.delete(e.target.value); update(); });
  });
  const sortBy = document.getElementById('sortBy'); const sortDir = document.getElementById('sortDir');
  sortBy.value = 'percent'; sortDir.value = 'asc';
  sortBy.addEventListener('change', ()=> { FILTERS.sortBy = sortBy.value; update(); });
  sortDir.addEventListener('change', ()=> { FILTERS.sortDir = sortDir.value; update(); });
  document.getElementById('resetBtn').addEventListener('click', ()=>{
    FILTERS.dwellings = new Set(['F','H','T','O','U']); document.querySelectorAll('#dwellingTypes input[type=checkbox]').forEach(cb => cb.checked = true);
    UI.percentSlider.set([0,100]); FILTERS.percent = [0,100]; syncInputs('percent', FILTERS.percent);
    UI.withheldSlider.set([0,100]); FILTERS.withheld = [0,100]; syncInputs('withheld', FILTERS.withheld);
    const daysVals = RAW.rows.map(r => r['Days Bond Held']).filter(v=>Number.isFinite(v)); let dmin = arrMin(daysVals,0), dmax = arrMax(daysVals,0); [dmin,dmax] = ensureSpan(dmin,dmax);
    UI.daysSlider.updateOptions({ range: { min: dmin, max: dmax } }, true); UI.daysSlider.set([dmin,dmax]); FILTERS.days = [dmin,dmax]; syncInputs('days', FILTERS.days);
    const bvals = RAW.rows.map(bondValue).filter(v=>Number.isFinite(v)); let bmin = arrMin(bvals,0), bmax = arrMax(bvals,0); [bmin,bmax] = ensureSpan(bmin,bmax);
    UI.bondSlider.updateOptions({ range: { min: bmin, max: bmax } }, true); UI.bondSlider.set([bmin,bmax]); FILTERS.bond = [bmin,bmax]; syncInputs('bond', FILTERS.bond);
    const allAgg = aggregate(RAW.rows); const counts = allAgg.map(([pc,a])=>a.count); let cmin = arrMin(counts,0), cmax = arrMax(counts,0); [cmin,cmax] = ensureSpan(cmin,cmax);
    UI.countSlider.updateOptions({ range: { min: cmin, max: cmax } }, true); UI.countSlider.set([Math.min(20,cmax), cmax]); FILTERS.count = [Math.min(20,cmax), cmax]; syncInputs('count', FILTERS.count);
    FILTERS.sortBy = 'percent'; FILTERS.sortDir = 'asc'; sortBy.value='percent'; sortDir.value='asc'; update();
  });
}

function initAboutModal(){
  const modal = document.getElementById('aboutModal');
  const openBtn = document.getElementById('aboutBtn');
  if(!modal || !openBtn) return;
  const closes = modal.querySelectorAll('.close, .modal-backdrop');
  const open = ()=>{ modal.classList.add('show'); modal.setAttribute('aria-hidden','false'); };
  const close = ()=>{ modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); };
  openBtn.addEventListener('click', open);
  closes.forEach(el => el.addEventListener('click', (e)=>{ if(e.target.dataset.close || e.currentTarget.classList.contains('close')) close(); }));
  window.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') close(); });
}

function initHelpTips(){
  document.querySelectorAll('.help-tip').forEach(btn => {
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      document.querySelectorAll('.help-tip.help-open').forEach(b => { if(b!==btn) b.classList.remove('help-open'); });
      btn.classList.toggle('help-open');
    });
  });
  document.addEventListener('click', ()=>{
    document.querySelectorAll('.help-tip.help-open').forEach(b => b.classList.remove('help-open'));
  });
}

function passesFilters(r){
  if(!FILTERS.dwellings.has(r['Dwelling Type'])) return false;
  const pct = r['Percent To Agent']; const days = r['Days Bond Held']; const bv = bondValue(r);
  if(!(pct >= FILTERS.percent[0] && pct <= FILTERS.percent[1])) return false;
  if(!(days >= FILTERS.days[0] && days <= FILTERS.days[1])) return false;
  if(!(bv >= FILTERS.bond[0] && bv <= FILTERS.bond[1])) return false;
  return true;
}
function aggregate(rows){
  const byPC = new Map();
  for(const r of rows){
    const pc = String(r.Postcode).padStart(4,'0');
    if(!byPC.has(pc)){ byPC.set(pc, { sumPercent:0, sumDays:0, sumBond:0, count:0, withheld:0, typeCounts:{F:0,H:0,T:0,O:0,U:0} }); }
    const a = byPC.get(pc);
    a.sumPercent += r['Percent To Agent'] || 0;
    a.sumDays += r['Days Bond Held'] || 0;
    a.sumBond += bondValue(r) || 0;
    a.count++;
    if ((r['Payment To Agent']||0) > 0 || (r['Percent To Agent']||0) > 0) a.withheld++;
    const t = r['Dwelling Type']; if(a.typeCounts[t]!=null) a.typeCounts[t]++; else a.typeCounts[t]=1;
  }
  const res = [];
  for(const [pc,a] of byPC.entries()){
    const avgPercent = a.count ? a.sumPercent / a.count : 0;
    const avgDays = a.count ? a.sumDays / a.count : 0;
    const avgBond = a.count ? a.sumBond / a.count : 0;
    const pctWithheld = a.count ? (a.withheld / a.count * 100) : 0;
    res.push([pc, { avgPercent, avgDays, avgBond, count: a.count, pctWithheld, typeCounts: a.typeCounts }]);
  }
  return res;
}

function update(){
  const filtered = RAW.rows.filter(passesFilters);
  let aggEntries = aggregate(filtered);
  // Apply count and withheld filters at aggregated level
  aggEntries = aggEntries.filter(([pc,a])=> a.count >= FILTERS.count[0] && a.count <= FILTERS.count[1]);
  aggEntries = aggEntries.filter(([pc,a])=> a.pctWithheld >= FILTERS.withheld[0] && a.pctWithheld <= FILTERS.withheld[1]);

  // Colouring and ordering follow selected sort metric
  const metricKeyRank = FILTERS.sortBy === 'percent' ? 'avgPercent' : (FILTERS.sortBy === 'days' ? 'avgDays' : (FILTERS.sortBy === 'withheld' ? 'pctWithheld' : 'avgBond'));
  let ranked = aggEntries.slice().sort((a,b)=> a[1][metricKeyRank] - b[1][metricKeyRank]);
  if(FILTERS.sortDir === 'desc') ranked.reverse();
  const rankIndex = new Map(); ranked.forEach(([pc,a], i)=> rankIndex.set(pc, i+1));
  const rankN = ranked.length;
  MAP.rankIndex = rankIndex; MAP.rankN = rankN; updateLegend();
  const aggMap = new Map(aggEntries); MAP.aggByPc = aggMap;

  // Sort cards by current sort metric
  const metricKey = metricKeyRank;
  aggEntries.sort((a,b)=> a[1][metricKey] - b[1][metricKey]);
  if(FILTERS.sortDir === 'desc') aggEntries.reverse();

  // Update map polygon fill colours
  MAP.featureIndex.forEach((layer, pc) => {
    const agg = aggMap.get(pc);
    if(agg){
      const rank = rankIndex.get(pc);
      const ratio = rankN>1 ? (rank-1)/(rankN-1) : 0.5;
      const color = colorByRank(ratio);
      layer.setStyle({ fillColor: color, fillOpacity: 0.85, color: '#243046', weight: 1 });
    } else {
      layer.setStyle({ fillColor: '#222833', fillOpacity: 0.25, color: '#2a3550', weight: 1 });
    }
  });

  // Summary over kept postcodes
  const kept = new Set(aggEntries.map(([pc])=>pc));
  const rowsForSummary = filtered.filter(r => kept.has(String(r.Postcode).padStart(4,'0')));
  const s = {
    records: rowsForSummary.length,
    postcodes: aggEntries.length,
    avgPercent: rowsForSummary.length ? (rowsForSummary.reduce((acc,r)=> acc + (r['Percent To Agent']||0), 0) / rowsForSummary.length) : 0,
    avgDays: rowsForSummary.length ? (rowsForSummary.reduce((acc,r)=> acc + (r['Days Bond Held']||0), 0) / rowsForSummary.length) : 0,
    avgBond: rowsForSummary.length ? (rowsForSummary.reduce((acc,r)=> acc + (bondValue(r)||0), 0) / rowsForSummary.length) : 0,
    pctWithheld: rowsForSummary.length ? (rowsForSummary.filter(r => (r['Payment To Agent']||0) > 0 || (r['Percent To Agent']||0) > 0).length / rowsForSummary.length * 100) : 0,
  };
  document.getElementById('summary').innerHTML = summaryHTML(s);

  // Cards
  const cards = document.getElementById('cards'); cards.innerHTML = '';
  const frag = document.createDocumentFragment();
  for(const [pc, agg] of aggEntries){
    const rank = rankIndex.get(pc) || '-';
    const card = document.createElement('div');
    card.innerHTML = cardHTML(pc, agg, rank, rankN);
    const el = card.firstElementChild;
    el.addEventListener('mouseenter', ()=> { const layer = MAP.featureIndex.get(pc); if(layer) layer.setStyle({ weight: 3 }); });
    el.addEventListener('mouseleave', ()=> { const layer = MAP.featureIndex.get(pc); if(layer) layer.setStyle({ weight: 1 }); });
    el.addEventListener('click', ()=>{
      const layer = MAP.featureIndex.get(pc); const info = MAP.aggByPc.get(pc);
      if(layer && info){ const html = popupHTML(pc, info, rank, rankN); const center = layer.getBounds().getCenter(); layer.bindPopup(html, { maxWidth: 340 }).openPopup(center); MAP.map.panTo(center); }
    });
    frag.appendChild(el);
  }
  cards.appendChild(frag);
}

loadAll();
