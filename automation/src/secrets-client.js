// Speichert/liest pro-Region-Zugangsdaten (Axonity/Welo) in Google Secret
// Manager statt in einer lokalen .env — nötig, damit ein Gebietsleiter mit
// eigenem Cloud-Run-Konto (z.B. "hoang") seine eigenen Zugangsdaten selbst
// über index.html eintragen kann, ohne dass jemand anders sie zu sehen
// bekommt oder ein Container neu gebaut/gestartet werden muss.
//
// Secret-Namen tragen ein Region-Präfix (z.B. "hoang-AXONITY_USER"), weil
// alle Regionen dasselbe Google-Cloud-Projekt teilen und sich sonst
// gegenseitig überschreiben würden.
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

async function getSecret(name) {
  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
    });
    return version.payload.data.toString('utf8');
  } catch (e) {
    return null; // Secret existiert noch nicht = für diese Region noch nicht eingerichtet
  }
}

async function setSecret(name, value) {
  const secretPath = `projects/${PROJECT_ID}/secrets/${name}`;
  try {
    await client.getSecret({ name: secretPath });
  } catch (e) {
    await client.createSecret({
      parent: `projects/${PROJECT_ID}`,
      secretId: name,
      secret: { replication: { automatic: {} } },
    });
  }
  await client.addSecretVersion({ parent: secretPath, payload: { data: Buffer.from(value, 'utf8') } });
}

// Gibt {AXONITY_USER, AXONITY_PASSWORD, ...} zurück (nur Keys, die tatsächlich
// gesetzt sind) — bewusst ein Rückgabewert statt direktem process.env-Schreiben:
// die Sync-Skripte lesen ihre Zugangsdaten in Konstanten auf Modul-Ebene
// (`const USER = process.env.AXONITY_USER`, ausgewertet beim require()) — ein
// nachträgliches process.env-Schreiben im SELBEN Prozess käme dafür zu spät.
// sync-runner.js ruft das stattdessen VOR dem Start des jeweiligen
// Kind-Prozesses auf und reicht das Ergebnis über dessen eigenes env weiter,
// sodass der Kind-Prozess von Anfang an mit den richtigen Werten startet.
async function getRegionSecrets(region) {
  const keys = ['AXONITY_USER', 'AXONITY_PASSWORD', 'WELO_USER', 'WELO_PASSWORD', 'WELO_STATISTIK_URL', 'GEBIETSLEITER_NAME', 'KOSTENSTELLEN'];
  const result = {};
  for (const key of keys) {
    const val = await getSecret(`${region}-${key}`);
    if (val != null) result[key] = val;
  }
  return result;
}

module.exports = { getSecret, setSecret, getRegionSecrets };
