// Read-only check: how many docs in the newly list-rule-tightened collections
// are missing a `region` field? Those would silently disappear from admin
// `list` results once the tightened rules (isManagerForRegion(resource.data.region))
// are deployed. Run with: node scratch/check-region-migration.js
require('dotenv').config();
const { getDb } = require('../src/firestore-client');

async function countMissing(db, colName) {
  const snap = await db.collection(colName).get();
  let missing = 0, total = 0;
  const byRegion = {};
  snap.forEach((doc) => {
    total++;
    const r = doc.data().region;
    if (!r) missing++;
    else byRegion[r] = (byRegion[r] || 0) + 1;
  });
  return { colName, total, missing, byRegion };
}

async function countMissingCollectionGroup(db, groupName) {
  const snap = await db.collectionGroup(groupName).get();
  let missing = 0, total = 0;
  const byRegion = {};
  snap.forEach((doc) => {
    total++;
    const r = doc.data().region;
    if (!r) missing++;
    else byRegion[r] = (byRegion[r] || 0) + 1;
  });
  return { colName: groupName + ' (collectionGroup)', total, missing, byRegion };
}

async function main() {
  const db = getDb();
  const results = [];
  for (const col of ['krank', 'antrag', 'wareneingang', 'umlagerung']) {
    results.push(await countMissing(db, col));
  }
  results.push(await countMissingCollectionGroup(db, 'urlaub'));

  console.log('\n=== Region-Feld Vollständigkeits-Check ===\n');
  results.forEach((r) => {
    const status = r.missing === 0 ? '✓ OK' : `⚠️ ${r.missing} OHNE region`;
    console.log(`${r.colName}: ${r.total} Dokumente gesamt — ${status}`);
    console.log('   nach Region:', JSON.stringify(r.byRegion));
  });
  console.log('\nFazit: "OHNE region"-Dokumente würden nach dem Rules-Deploy aus den admin list()-Ergebnissen verschwinden (nicht gelöscht, nur unsichtbar).');
  process.exit(0);
}

main().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
