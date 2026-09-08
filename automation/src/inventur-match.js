// Logik zum Abgleichen App-Artikelnummern (aus inventur_counts) mit den
// Artikelnummern auf einer Welo-Inventurseite — 1:1 portiert aus dem
// bewährten Tampermonkey-Script (scinventurautofill.user.js v1.2), damit
// Vorschau (sync-inventur-diff.js) und Anwenden (sync-inventur-apply.js)
// exakt dieselbe Zuordnung sehen wie bisher der manuelle Weg.

// App-Nr -> Welo-Nr, für Artikel, die beide Systeme unter verschiedenen
// Nummern führen (Reis, Lachsfilet). Manuell gepflegt — neue Paare hier
// ergänzen, wenn ein Artikel trotz korrektem Zählen als "fehlt" auftaucht.
const ART_ALIAS = {
  '80003': 'AF12396', // App "Sushireis (Sack 10kg)" -> Welo "Reis-Zensho / Japonica Reis", Packung 10 kg
  '99338': 'AF12453', // App "Lachsfilet (SC, kg)" -> Welo "SC Lachsfilet Treim E"
};

function normArt(a) {
  return String(a == null ? '' : a).replace(/\s+/g, '').toUpperCase();
}
function baseArt(a) {
  return normArt(a).split('-')[0];
}
function fmtWeloVal(n) {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

// weloRows: [{artNr, currentVal}] — aus der Welo-Seite gelesen (siehe
// sync-inventur-diff.js: table.inventur-table input.inp Zeilen).
// counts: {artNr: menge} — aus inventur_counts/{month}__{slug}.counts.
// labelByArt: {normArt(artNr): name} — aus inventur-data.js, optional.
function matchInventur(weloRows, counts, labelByArt) {
  labelByArt = labelByArt || {};
  const byNorm = {}, byBase = {};
  Object.keys(counts).forEach((a) => {
    byNorm[normArt(a)] = { art: a, val: counts[a] };
    const b = baseArt(a);
    if (!byBase[b]) byBase[b] = { art: a, val: counts[a] };
  });

  const aliasToApp = {};
  Object.keys(ART_ALIAS).forEach((appA) => { aliasToApp[normArt(ART_ALIAS[appA])] = appA; });

  const usedApp = {};
  const conflicts = [];
  const matches = weloRows.map((row) => {
    const n = normArt(row.artNr);
    const cands = [];
    if (byNorm[n]) cands.push(byNorm[n]);
    const aliasApp = aliasToApp[n];
    if (aliasApp && counts[aliasApp] !== undefined) {
      cands.push({ art: aliasApp, val: counts[aliasApp], alias: true });
    }
    if (!cands.length) {
      const fb = byNorm[baseArt(row.artNr)] || byBase[n] || byBase[baseArt(row.artNr)];
      if (fb) cands.push(fb);
    }
    // Die Filiale zaehlt oft nur eine der beiden Zeilen (App-Nr vs. Welo-Nr) —
    // die mit einer echten Menge gewinnt, sonst ueberschreibt eine 0 aus der
    // ungenutzten Zeile die richtige Zahl.
    const nonzero = cands.filter((c) => Number(c.val) > 0);
    const hit = nonzero[0] || cands[0] || null;
    if (nonzero.length > 1 && Number(nonzero[0].val) !== Number(nonzero[1].val)) {
      conflicts.push({ welo: row.artNr, a: nonzero[0], b: nonzero[1] });
    }
    cands.forEach((c) => { usedApp[c.art] = true; });
    return {
      artNr: row.artNr,
      weloName: row.weloName,
      oldVal: row.currentVal,
      newVal: hit ? Number(hit.val) : null,
      appArt: hit ? hit.art : null,
      viaAlias: !!(hit && hit.alias),
      fuzzy: !!hit && !hit.alias && hit.art !== row.artNr,
      label: labelByArt[n] || (hit ? labelByArt[normArt(hit.art)] : '') || '',
    };
  });

  const missing = Object.keys(counts).filter((a) => !usedApp[a]).map((a) => ({
    art: a, label: labelByArt[normArt(a)] || '', menge: counts[a],
  })).sort((x, y) => (y.menge || 0) - (x.menge || 0));

  const changed = matches.filter((m) => m.newVal !== null && fmtWeloVal(m.newVal) !== String(m.oldVal).replace('.', ','));

  return { matches, changed, missing, conflicts };
}

module.exports = { ART_ALIAS, normArt, baseArt, fmtWeloVal, matchInventur };
