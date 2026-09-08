// Datenschutz: Krankmeldungs-Fotos sind Gesundheitsdaten (Art. 9 DSGVO) und dürfen
// laut Speicherbegrenzungsgrundsatz (Art. 5 Abs. 1 lit. e DSGVO) nicht länger
// aufbewahrt werden, als für ihren Zweck (Prüfung durch den Gebietsleiter) nötig.
// Der Hinweis dazu stand schon im UI ("Nach Bearbeitung bitte löschen (Gesundheitsdaten)"),
// wurde aber nie automatisch durchgesetzt — dieses Skript holt das nach.
//
// Löscht NUR das Feld "img" (das Foto selbst) aus Dokumenten, die älter als
// AUFBEWAHRUNG_TAGE sind — der Rest des Dokuments (Name, Filiale, Zeitraum)
// bleibt erhalten, da die Krankheitstage selbst lohnrelevant sind und für die
// Personalakte gebraucht werden. Nur das sensible Foto verschwindet.
//
// Region-unabhängig mit Absicht: diese Pflicht gilt für alle Gebiete gleich,
// unabhängig davon von welchem Cloud-Run-Konto aus sie angestoßen wird (siehe
// server.js — Admin SDK sieht ohnehin alle Regionen, Firestore-Regeln greifen
// hier nicht). Läuft täglich per Cloud Scheduler, nicht Teil von runAll().
require('dotenv').config();
const { getDb, admin } = require('./firestore-client');

const AUFBEWAHRUNG_TAGE = 30;

async function cleanupKrankmeldungFotos() {
  const db = getDb();
  const grenze = new Date(Date.now() - AUFBEWAHRUNG_TAGE * 24 * 60 * 60 * 1000).toISOString();

  // "created" ist ein ISO-8601-String (new Date().toISOString()) — lexikografisch
  // genauso sortierbar wie chronologisch, daher funktioniert ein normaler
  // String-Vergleich hier ohne Konvertierung.
  const snap = await db.collection('krank').where('created', '<', grenze).get();

  let geloescht = 0, uebersprungen = 0;
  let batch = db.batch();
  let batchCount = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.img) { uebersprungen++; continue; }
    batch.update(doc.ref, {
      img: admin.firestore.FieldValue.delete(),
      imgGeloeschtAm: admin.firestore.FieldValue.serverTimestamp(),
    });
    geloescht++; batchCount++;
    if (batchCount >= 400) { await batch.commit(); batch = db.batch(); batchCount = 0; }
  }
  if (batchCount > 0) await batch.commit();

  console.log(`✓ Krankmeldung-Fotos: ${geloescht} gelöscht (Meldung älter als ${AUFBEWAHRUNG_TAGE} Tage), ${uebersprungen} übersprungen (kein Foto oder bereits gelöscht).`);
  return { geloescht, uebersprungen };
}

module.exports = { cleanupKrankmeldungFotos };
if (require.main === module) {
  cleanupKrankmeldungFotos().catch((e) => { console.error('✗', e.message); process.exit(1); });
}
