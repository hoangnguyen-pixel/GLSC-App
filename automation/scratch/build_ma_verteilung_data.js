require('dotenv').config();
const { getDb } = require('../src/firestore-client');

const GL_MUSTER = /\bGL\b|Gebietsleiter/i;
const SPRINGER_IDS = new Set(['550078', '550152']);

// Gleiche Normalisierung wie plan-urlaub-ost.js: East-Mitarbeiter haben ihre
// Zweitfiliale oft als lose Axonity-Kette-Bezeichnung ("Edeka Kassel
// Frankfurter Str.") statt der kanonischen "NNNNNN: X-..."-Form gespeichert.
function normalizeBranchText(s) {
  return ('' + s)
    .replace(/^\d+:\s*/, '')
    .replace(/^[A-Za-z]{1,3}-/, '')
    .replace(/^(Edeka|Kaufland|Tegut|Marktkauf|Rewe)\s+/i, '')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractSuffix(fullName, ort) {
  const m = fullName.match(/^\d+:\s*[A-Za-z]+-(.+)$/);
  let rest = m ? m[1] : fullName;
  if (rest.indexOf(ort + '-') === 0) rest = rest.slice(ort.length + 1);
  const parts = rest.split(' - ');
  if (parts.length > 1) return parts[parts.length - 1].trim();
  let s = parts[0].replace(/-/g, ' ').replace(/straße/gi, 'str.').replace(/strasse/gi, 'str.');
  s = s.replace(/^(An der|Am|In der)\s+/i, '').trim();
  return s.toLowerCase() === ort.toLowerCase() ? '' : s;
}

function classify(e, w) {
  if (e.shopleiter) return 'Shopleiter';
  const s = w.sollStd;
  if (s == null) return 'Vollzeit';
  if (s <= 12) return 'Minijob';
  if (s < 30) return 'Teilzeit';
  return 'Vollzeit';
}

async function main() {
  const db = getDb();
  const empsSnap = await db.collection('emps').where('active', '==', true).get();
  const weloSnap = await db.collection('emp_welo').get();
  const filSnap = await db.collection('filialen_meta').get();
  const welo = {}; weloSnap.forEach((d) => { welo[d.id] = d.data(); });
  const filByName = {}; const filList = [];
  filSnap.forEach((d) => { const v = d.data(); filByName[v.name] = v; filList.push(v); });
  const filNorm = filList.map((f) => ({ full: f.name, ort: f.ort, n: normalizeBranchText(f.name) }));
  function resolveBranch(loose) {
    if (filByName[loose]) return { full: loose, ort: filByName[loose].ort };
    const nl = normalizeBranchText(loose);
    const exact = filNorm.find((c) => c.n === nl);
    if (exact) return exact;
    const sub = filNorm.find((c) => c.n.includes(nl) || nl.includes(c.n));
    return sub || null;
  }

  const people = { west: [], ost: [] };
  const rawBranchesPerRegion = { west: new Set(), ost: new Set() };
  const empRecords = [];

  empsSnap.forEach((d) => {
    const e = d.data();
    const w = welo[d.id] || {};
    if (GL_MUSTER.test(w.taetigkeit || '')) return;
    if (SPRINGER_IDS.has(d.id)) return;
    if ((w.taetigkeit || '') === 'Springer') return;
    const region = e.region;
    if (!people[region]) return;
    const filResolved = resolveBranch(e.filiale);
    const zweitResolved = (e.zweit || []).map(resolveBranch).filter(Boolean);
    if (!filResolved) { console.warn('  ⚠ Stammfiliale nicht aufloesbar:', e.name, e.filiale); return; }
    rawBranchesPerRegion[region].add(filResolved.full);
    zweitResolved.forEach((z) => rawBranchesPerRegion[region].add(z.full));
    empRecords.push({ region, id: d.id, name: e.name, filiale: filResolved.full, zweit: zweitResolved.map((z) => z.full), kategorie: classify(e, w), sollStd: w.sollStd });
  });

  const branchesShort = { west: {}, ost: {} };
  ['west', 'ost'].forEach((region) => {
    const list = [...rawBranchesPerRegion[region]];
    const ortCount = {};
    list.forEach((f) => { const o = (filByName[f] || {}).ort || f; ortCount[o] = (ortCount[o] || 0) + 1; });
    list.forEach((f) => {
      const meta = filByName[f];
      const ort = meta ? meta.ort : f;
      const needsSuffix = ortCount[ort] > 1;
      const suffix = needsSuffix && meta ? extractSuffix(f, ort) : '';
      branchesShort[region][f] = ort + (suffix ? ' ' + suffix : '');
    });
  });

  empRecords.forEach((r) => {
    people[r.region].push({
      id: r.id, name: r.name, filiale: r.filiale, filialeKurz: branchesShort[r.region][r.filiale],
      zweit: r.zweit, zweitKurz: r.zweit.map((z) => branchesShort[r.region][z]),
      kategorie: r.kategorie, sollStd: r.sollStd,
    });
  });

  const out = {
    west: { branches: branchesShort.west, people: people.west },
    ost: { branches: branchesShort.ost, people: people.ost },
  };
  console.log('WEST Personen:', out.west.people.length, '| Filialen:', Object.keys(out.west.branches).length);
  console.log('OST Personen:', out.ost.people.length, '| Filialen:', Object.keys(out.ost.branches).length);
  console.log('\nWEST kurz:', JSON.stringify(Object.values(out.west.branches).sort()));
  console.log('\nOST kurz:', JSON.stringify(Object.values(out.ost.branches).sort()));
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'output', 'ma_verteilung_final.json'), JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
