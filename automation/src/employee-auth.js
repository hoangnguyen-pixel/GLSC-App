// Ersetzt die bisherige "anonym + Personalnummer" Anmeldung von mitarbeiter.html
// durch eine echte Identitätsbindung: der Mitarbeiter meldet sich mit PID + PIN
// an, hier geprüft, und bekommt ein Firebase Custom Token mit uid `emp_<pid>`
// und Claim `pid` zurück. Vorher konnte JEDER anonyme Nutzer sich als jede
// beliebige Personalnummer ausgeben (Firestore-Regeln konnten das nicht
// unterscheiden — anonyme Auth hat keine Identität, nur "irgendwer ist
// angemeldet"). Jetzt kann firestore.rules `request.auth.token.pid` prüfen.
//
// Läuft mit Admin SDK (bypasst Firestore-Regeln bewusst, wie jede
// Cloud-Run-Route hier) — die eigentliche Prüfung passiert in diesem Skript.
// Erste Anmeldung eines Mitarbeiters legt den PIN fest (Self-Service, kein
// Admin muss PINs verteilen) — jede weitere Anmeldung muss ihn bestätigen.
const bcrypt = require('bcryptjs');
const { getDb, admin } = require('./firestore-client');

const PIN_REGEX = /^\d{4,6}$/;
const MAX_VERSUCHE = 5;
const SPERR_MINUTEN = 15;

async function employeeLogin(pid, pin) {
  if (!pid || typeof pid !== 'string') { const e = new Error('not_found'); e.status = 404; throw e; }
  if (!pin || !PIN_REGEX.test(pin)) { const e = new Error('pin_format'); e.status = 400; throw e; }

  const db = getDb();
  const ref = db.collection('emps').doc(pid);
  const doc = await ref.get();
  if (!doc.exists) { const e = new Error('not_found'); e.status = 404; throw e; }
  const d = doc.data() || {};
  if (d.active === false) { const e = new Error('inactive'); e.status = 403; throw e; }

  const now = Date.now();
  if (d.pinLockedUntil && d.pinLockedUntil.toMillis && d.pinLockedUntil.toMillis() > now) {
    const e = new Error('locked'); e.status = 429; throw e;
  }

  let isNewPin = false;
  if (!d.pinHash) {
    // Erste Anmeldung überhaupt (oder Admin hat den PIN zurückgesetzt) — der
    // gerade eingegebene PIN wird als der neue, gültige PIN übernommen.
    isNewPin = true;
    const hash = await bcrypt.hash(pin, 10);
    await ref.update({
      pinHash: hash, pinSetAt: admin.firestore.FieldValue.serverTimestamp(),
      pinFailCount: 0, pinLockedUntil: admin.firestore.FieldValue.delete(),
    });
  } else {
    const ok = await bcrypt.compare(pin, d.pinHash);
    if (!ok) {
      const failCount = (d.pinFailCount || 0) + 1;
      const patch = { pinFailCount: failCount };
      if (failCount >= MAX_VERSUCHE) {
        patch.pinLockedUntil = admin.firestore.Timestamp.fromMillis(now + SPERR_MINUTEN * 60 * 1000);
        patch.pinFailCount = 0;
      }
      await ref.update(patch);
      const e = new Error('wrong_pin'); e.status = 401;
      e.attemptsLeft = Math.max(0, MAX_VERSUCHE - failCount);
      throw e;
    }
    if (d.pinFailCount) await ref.update({ pinFailCount: 0 });
  }

  const token = await admin.auth().createCustomToken('emp_' + pid, { pid: pid });
  return { token, isNewPin };
}

module.exports = { employeeLogin };
