// HTTP-Server für Cloud Run — Ersatz für den lokalen Watcher, damit die
// Sync-Skripte laufen, ohne dass ein PC an sein muss.
//
// Zwei Arten von Aufrufern, zwei Auth-Mechanismen:
//  - Cloud Scheduler (3 feste Zeiten) ruft POST /internal/sync/:key auf,
//    abgesichert über einen geteilten Header-Wert (SYNC_SHARED_SECRET aus
//    Secret Manager) — Scheduler-Konfiguration ist nicht öffentlich einsehbar,
//    ein statisches Secret ist hier also ausreichend.
//  - Der "Jetzt aktualisieren"-Knopf im Dashboard (Browser, öffentlich
//    erreichbar) ruft POST /sync/all auf. Ein statisches Secret wäre dort im
//    Client-JS sichtbar — stattdessen wird das Firebase-ID-Token des
//    eingeloggten Managers geprüft (gleiche Logik wie isManager() in den
//    Firestore-Regeln: managers/{email}.regions muss nicht leer sein).
require('dotenv').config();
const express = require('express');
const { getDb, admin } = require('./firestore-client');
const { runOne, runAll } = require('./sync-runner');
const { setSecret } = require('./secrets-client');

// getDb() ruft intern admin.initializeApp() auf — muss VOR dem ersten
// admin.auth()-Aufruf passiert sein (sonst "default Firebase app does not
// exist" bei jedem frischen Cold-Start), daher hier sofort beim Start
// erzwungen statt erst lazy beim ersten Firestore-Zugriff.
getDb();

const app = express();
app.use(express.json());
// dashboard.html (GitHub Pages, andere Domain) ruft /sync/all direkt per
// fetch() auf — ohne CORS-Header blockt der Browser das serverseitig, bevor
// die eigentliche Auth-Prüfung (Bearer-Token unten) überhaupt greift. Der
// echte Schutz ist ohnehin die Token-/Secret-Prüfung pro Route, nicht die
// Herkunft der Anfrage — daher hier bewusst offen statt auf eine Domain fixiert.
app.use(function(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Sync-Secret');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const PORT = process.env.PORT || 8080;
const SYNC_SHARED_SECRET = process.env.SYNC_SHARED_SECRET;
// Siehe gleichnamige Konstante in watch-and-sync.js: ein zweites, eigenes
// Automation-Konto (eigene REGION in seiner .env) braucht sein eigenes
// sync_triggers-Dokument, sonst überschreiben sich zwei parallel deployte
// Instanzen gegenseitig den Fortschritt. Ohne REGION bleibt die Doc-ID 'manual'.
const REGION = process.env.REGION || null;
const TRIGGER_ID = REGION ? 'manual__' + REGION : 'manual';

app.get('/health', (req, res) => res.status(200).send('ok'));

// ── Cloud Scheduler → einzelnes Skript ────────────────────────────────────
app.post('/internal/sync/:key', async (req, res) => {
  if (!SYNC_SHARED_SECRET || req.get('X-Sync-Secret') !== SYNC_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const key = req.params.key;
  try {
    console.log(`[scheduler] Starte ${key}…`);
    const result = await runOne(key);
    console.log(`[scheduler] ${key}: ${result.ok ? 'ok' : 'FEHLER — ' + result.error}`);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    console.error(`[scheduler] ${key} fehlgeschlagen:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard-Button → alle drei Skripte ──────────────────────────────────
async function requireManager(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'missing bearer token' });

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const db = getDb();
    const managerDoc = await db.collection('managers').doc(decoded.email).get();
    const regions = (managerDoc.exists && managerDoc.data().regions) || [];
    if (!regions.length) return res.status(403).json({ error: 'not a manager' });
    req.managerEmail = decoded.email;
    req.managerRegions = regions;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token: ' + err.message });
  }
}

// Gemeinsame Logik für "alle vier Skripte nacheinander, mit Fortschritt in
// sync_triggers" — genutzt vom Dashboard-Button (/sync/all, Manager-Login)
// UND vom Cloud-Scheduler-Cron (/internal/sync-all, geteiltes Secret).
async function runAllAndTrackStatus(requestedBy, res) {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('sync_triggers').doc(TRIGGER_ID).set(
    { status: 'running', startedAt: now, requestedBy, region: REGION },
    { merge: true }
  );
  // Bewusst NICHT vorab antworten und im Hintergrund weiterlaufen: Cloud Run
  // drosselt die CPU standardmäßig, sobald die Antwort raus ist ("CPU is
  // only allocated during request processing") — Hintergrundarbeit nach
  // res.send() würde unzuverlässig laufen. Der Request bleibt offen, bis
  // alles fertig ist; Dashboard/Scheduler warten nicht auf diese Antwort,
  // sondern verfolgen den Fortschritt separat über den Firestore-Listener.
  try {
    console.log(`[sync-all] Angefordert von ${requestedBy} — starte alle vier Sync-Skripte…`);
    const results = await runAll();
    const allOk = results.every((r) => r.ok);
    await db.collection('sync_triggers').doc(TRIGGER_ID).set(
      { status: allOk ? 'done' : 'error', finishedAt: admin.firestore.FieldValue.serverTimestamp(), results, region: REGION },
      { merge: true }
    );
    console.log(`[sync-all] Fertig. ${results.filter((r) => r.ok).length}/${results.length} Skripte erfolgreich.`);
    res.status(200).json({ status: allOk ? 'done' : 'error', results });
  } catch (err) {
    console.error('[sync-all] Fehlgeschlagen:', err.message);
    await db.collection('sync_triggers').doc(TRIGGER_ID).set(
      { status: 'error', finishedAt: admin.firestore.FieldValue.serverTimestamp(), error: err.message, region: REGION },
      { merge: true }
    );
    res.status(500).json({ error: err.message });
  }
}

app.post('/sync/all', requireManager, async (req, res) => {
  await runAllAndTrackStatus(req.managerEmail, res);
});

// ── Cloud Scheduler → alle vier Skripte in einem Lauf (1x/Tag statt 5
// Einzel-Jobs — jeder Cloud-Scheduler-Job über die ersten 3 pro Projekt
// kostet $0.10/Monat, ein gebündelter täglicher Lauf spart das). ─────────
app.post('/internal/sync-all', async (req, res) => {
  if (!SYNC_SHARED_SECRET || req.get('X-Sync-Secret') !== SYNC_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  await runAllAndTrackStatus('cloud-scheduler', res);
});

// ── Gebietsleiter trägt seine eigenen Axonity/Welo-Zugangsdaten ein ────────
// Aufgerufen aus index.html (Settings-Panel), sobald diese Region ein
// eigenes Cloud-Run-Konto hat. REGION kommt bewusst aus der eigenen .env
// dieser Instanz (nicht vom Client) — ein Manager kann so nur Secrets für
// GENAU die Region schreiben, die diese Instanz bedient.
app.post('/credentials', requireManager, async (req, res) => {
  if (!REGION || !req.managerRegions.includes(REGION)) {
    return res.status(403).json({ error: 'not authorized for this region' });
  }
  const b = req.body || {};
  const map = {
    AXONITY_USER: b.axonityUser,
    AXONITY_PASSWORD: b.axonityPassword,
    WELO_USER: b.weloUser,
    WELO_PASSWORD: b.weloPassword,
    WELO_STATISTIK_URL: b.weloStatistikUrl,
    GEBIETSLEITER_NAME: b.gebietsleiterName,
    KOSTENSTELLEN: b.kostenstellen,
  };
  try {
    for (const [key, val] of Object.entries(map)) {
      if (val) await setSecret(`${REGION}-${key}`, String(val));
    }
    console.log(`[credentials] ${req.managerEmail} hat Zugangsdaten für Region "${REGION}" aktualisiert.`);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[credentials] Fehlgeschlagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Filial Radar sync server läuft auf Port ${PORT}`);
});
