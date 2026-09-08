// Datenschutz: Nach Rücksprache mit dem Gebietsleiter (08.09.2026) führt unsere
// App keine eigene, mehrjährige Aufbewahrungspflicht für ausgeschiedene
// Mitarbeiter — die offizielle Personalakte/Lohnunterlagen liegen im
// eigentlichen System (Welo/Axonity); diese App ist nur ein Arbeitswerkzeug
// für den täglichen Betrieb (Krankmeldung, Urlaub, Belege, Wareneingang,
// Umlagerung). Sobald jemand seit GRACE_TAGE als "inactive" markiert ist
// (siehe inactiveSince, gesetzt von sync-welo-personal.js beim automatischen
// Erkennen eines Austritts bzw. von delEmp() in index.html bei manueller
// Deaktivierung), werden seine App-eigenen Meldedaten gelöscht — Grundsatz
// der Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO), da diese Daten nach
// Austritt für unsere App keinen Zweck mehr erfüllen.
//
// BEWUSST AUSGENOMMEN von dieser automatischen Löschung:
//  - emps/{pid} selbst (Stammdaten-Dokument) bleibt erhalten — geringe
//    Sensitivität, wird bei Wiedereinstellung ohnehin weiterverwendet, und
//    Löschen würde referenzierte Personalnummern in Dienstplan-Historie
//    unnötig verwaisen lassen.
//  - aenderungsvertrag (unterschriebene Vertragsänderungen) — ggf. die
//    einzige digitale Kopie einer rechtsverbindlichen Vereinbarung; das ist
//    eine bewusste Einzelfallentscheidung, kein automatischer Lauf.
require('dotenv').config();
const { getDb, admin } = require('./firestore-client');

const GRACE_TAGE = 90;

async function deleteMatchingDocs(db, query) {
  const snap = await query.get();
  if (snap.empty) return 0;
  let batch = db.batch(), n = 0, count = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref); n++; count++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n > 0) await batch.commit();
  return count;
}

async function cleanupDepartedEmployees() {
  const db = getDb();
  const grenze = new Date(Date.now() - GRACE_TAGE * 24 * 60 * 60 * 1000);

  const snap = await db.collection('emps').where('active', '==', false).get();
  let geprueft = 0, bereinigt = 0, uebersprungen = 0;
  for (const doc of snap.docs) {
    geprueft++;
    const d = doc.data();
    if (d.dataPurgedAt) { uebersprungen++; continue; }
    const seit = d.inactiveSince && d.inactiveSince.toDate ? d.inactiveSince.toDate() : null;
    if (!seit || seit > grenze) { uebersprungen++; continue; }

    const pid = doc.id;
    let geloescht = 0;
    geloescht += await deleteMatchingDocs(db, db.collection('krank').where('empId', '==', pid));
    geloescht += await deleteMatchingDocs(db, db.collection('receipts').where('empId', '==', pid));
    geloescht += await deleteMatchingDocs(db, db.collection('wareneingang').where('empId', '==', pid));
    geloescht += await deleteMatchingDocs(db, db.collection('umlagerung').where('empId', '==', pid));
    geloescht += await deleteMatchingDocs(db, db.collection('antrag').where('id', '==', pid));
    geloescht += await deleteMatchingDocs(db, db.collectionGroup('urlaub').where('empId', '==', pid));

    await doc.ref.set({
      dataPurgedAt: admin.firestore.FieldValue.serverTimestamp(),
      dataPurgedCount: geloescht,
    }, { merge: true });
    bereinigt++;
  }

  console.log(`✓ Ausgeschiedene Mitarbeiter geprüft: ${geprueft}, Meldedaten bereinigt: ${bereinigt} (>= ${GRACE_TAGE} Tage inaktiv), übersprungen: ${uebersprungen}.`);
  return { geprueft, bereinigt, uebersprungen };
}

module.exports = { cleanupDepartedEmployees };
if (require.main === module) {
  cleanupDepartedEmployees().catch((e) => { console.error('✗', e.message); process.exit(1); });
}
