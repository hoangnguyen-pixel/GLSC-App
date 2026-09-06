// Baut zwei editierbare Filial-Personalverteilungs-Diagramme (West/Ost).
// V2: Kanban-Board-Stil statt eines einzigen riesigen Diagramms mit
// quer über die Seite laufenden Pfeilen - das war bei normaler Ansicht
// ("An Fenster anpassen") viel zu klein und unübersichtlich zu lesen.
// Jede Filiale ist eine Spalte, jede/r Mitarbeitende eine große Karte
// darin; Zweitfiliale wird als kleines Badge direkt auf der Karte
// angezeigt statt als Pfeil quer durchs Bild. Mehrere normal große
// Folien statt einer riesigen. Region West/Ost wird NICHT als Text im
// Dokument selbst genannt (nur im Dateinamen).
const pptxgen = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'output', 'ma_verteilung_final.json'), 'utf8'));

const KAT_FARBE = {
  Minijob: '8FCE7A',
  Shopleiter: 'ED9B40',
  Vollzeit: '5B9BD5',
  Teilzeit: 'F2C6A0',
};
const KAT_LABEL = {
  Minijob: 'Minijob',
  Shopleiter: 'Vollzeit Shopleiter/-in',
  Vollzeit: 'Vollzeit',
  Teilzeit: 'Teilzeit',
};
const BRANCH_FARBE = '1E5631';
const ZWEIT_FARBE = 'B35A00';

// ── Layout-Konstanten (Zoll) – normale Foliengröße (16:9) ────────────────
const SLIDE_W = 13.333, SLIDE_H = 7.5;
const MARGIN = 0.55;
const COLS = 4;
const COL_GAP = 0.32;
const COL_W = (SLIDE_W - MARGIN * 2 - COL_GAP * (COLS - 1)) / COLS;
const HEADER_H = 0.6;
const CARD_H = 0.95, CARD_GAP = 0.16;
const CONTENT_TOP = 1.32;
const CONTENT_BOTTOM = 6.35; // darunter: Legende + Fußnote

function balancedChunks(arr, maxPerChunk) {
  const n = Math.max(1, Math.ceil(arr.length / maxPerChunk));
  const base = Math.floor(arr.length / n), extra = arr.length % n;
  const chunks = []; let i = 0;
  for (let c = 0; c < n; c++) {
    const size = base + (c < extra ? 1 : 0);
    chunks.push(arr.slice(i, i + size));
    i += size;
  }
  return chunks;
}

function nameFontSize(len) {
  if (len <= 16) return 16;
  if (len <= 24) return 14;
  if (len <= 32) return 12.5;
  return 11;
}
function badgeFontSize(len) {
  if (len <= 18) return 10.5;
  if (len <= 32) return 9.5;
  return 8.5;
}

function drawLegend(slide, pageLabel) {
  let ly = CONTENT_BOTTOM + 0.2;
  const legendItems = Object.keys(KAT_LABEL);
  const lw = (SLIDE_W - MARGIN * 2) / legendItems.length;
  legendItems.forEach((k, i) => {
    const lx = MARGIN + i * lw;
    slide.addShape('roundRect', { x: lx, y: ly, w: 0.3, h: 0.26, rectRadius: 0.04, fill: { color: KAT_FARBE[k] }, line: { color: KAT_FARBE[k] } });
    slide.addText(KAT_LABEL[k], { x: lx + 0.38, y: ly - 0.04, w: lw - 0.4, h: 0.34, fontFace: 'Calibri', fontSize: 11.5, color: '1E1E1E', isTextBox: true, margin: 0, valign: 'middle' });
  });
  ly += 0.36;
  slide.addText('🔄  = arbeitet bei Bedarf auch in einer weiteren Filiale (Zweitfiliale, z. B. bei Krankheit oder Urlaub)', {
    x: MARGIN, y: ly, w: SLIDE_W - MARGIN * 2, h: 0.3, fontFace: 'Calibri', fontSize: 11, color: ZWEIT_FARBE, italic: true, isTextBox: true, margin: 0,
  });
  ly += 0.32;
  slide.addText('* Alle Mitarbeitenden sind verpflichtet, bei Bedarf in einer anderen Filiale des eigenen Bereichs zu arbeiten.', {
    x: MARGIN, y: ly, w: SLIDE_W - MARGIN * 2 - 1.0, h: 0.3, fontFace: 'Calibri', fontSize: 11, italic: true, bold: true, color: 'B33A1A', isTextBox: true, margin: 0,
  });
  slide.addText(pageLabel, {
    x: SLIDE_W - MARGIN - 1.0, y: ly, w: 1.0, h: 0.3, fontFace: 'Calibri', fontSize: 10, color: '9A9690', align: 'right', isTextBox: true, margin: 0,
  });
}

function buildRegion(regionKey, outPath) {
  const region = DATA[regionKey];
  const people = region.people.filter((p) => p.filiale !== undefined);
  // Selbst-Referenzen (Zweitfiliale == eigene Stammfiliale) sind ein
  // Datenrest ohne Bedeutung - herausfiltern.
  people.forEach((p) => { p.zweitKurz = p.zweitKurz.filter((z, i) => z !== p.filialeKurz && p.zweit[i] !== p.filiale); });

  const byBranch = {};
  Object.values(region.branches).forEach((b) => { byBranch[b] = []; });
  people.forEach((p) => { (byBranch[p.filialeKurz] = byBranch[p.filialeKurz] || []).push(p); });
  people.forEach((p) => p.zweitKurz.sort());
  Object.values(byBranch).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name, 'de')));

  const branchNames = Object.keys(byBranch).sort((a, b) => a.localeCompare(b, 'de'));
  const pages = balancedChunks(branchNames, COLS);

  const P = new pptxgen();
  P.defineLayout({ name: 'GLSC_MA', width: SLIDE_W, height: SLIDE_H });
  P.layout = 'GLSC_MA';

  pages.forEach((pageBranches, pageIdx) => {
    const slide = P.addSlide();
    slide.background = { color: 'FFFFFF' };

    slide.addText('Filial- und Personalverteilung', {
      x: MARGIN, y: 0.32, w: SLIDE_W - MARGIN * 2, h: 0.5, fontFace: 'Calibri', fontSize: 26, bold: true, color: '1E1E1E', isTextBox: true, margin: 0,
    });
    slide.addText('Wer arbeitet wo, und wer springt bei Bedarf in welcher weiteren Filiale ein', {
      x: MARGIN, y: 0.82, w: SLIDE_W - MARGIN * 2, h: 0.32, fontFace: 'Calibri', fontSize: 13, italic: true, color: '6B6860', isTextBox: true, margin: 0,
    });

    pageBranches.forEach((b, ci) => {
      const x = MARGIN + ci * (COL_W + COL_GAP);
      slide.addShape('roundRect', {
        x, y: CONTENT_TOP, w: COL_W, h: HEADER_H, rectRadius: 0.07,
        fill: { color: BRANCH_FARBE }, line: { color: BRANCH_FARBE },
        shadow: { type: 'outer', color: '000000', opacity: 0.25, blur: 4, offset: 2, angle: 90 },
      });
      slide.addText(b, {
        x: x + 0.1, y: CONTENT_TOP, w: COL_W - 0.2, h: HEADER_H, fontFace: 'Calibri', fontSize: 17, bold: true, color: 'FFFFFF',
        align: 'center', valign: 'middle', isTextBox: true, margin: 0, fit: 'shrink',
      });

      const staff = byBranch[b];
      if (staff.length === 0) {
        slide.addText('– kein festes Personal –\n(nur Zweitfiliale-Unterstützung)', {
          x: x + 0.1, y: CONTENT_TOP + HEADER_H + 0.15, w: COL_W - 0.2, h: 0.7, fontFace: 'Calibri', fontSize: 10.5, italic: true, color: '9A9690',
          align: 'center', valign: 'top', isTextBox: true, margin: 0,
        });
        return;
      }

      staff.forEach((p, ri) => {
        const cy = CONTENT_TOP + HEADER_H + 0.15 + ri * (CARD_H + CARD_GAP);
        slide.addShape('roundRect', {
          x, y: cy, w: COL_W, h: CARD_H, rectRadius: 0.06,
          fill: { color: KAT_FARBE[p.kategorie] }, line: { color: KAT_FARBE[p.kategorie] },
          shadow: { type: 'outer', color: '000000', opacity: 0.18, blur: 3, offset: 1.5, angle: 90 },
        });
        const hasZweit = p.zweitKurz.length > 0;
        slide.addText(p.name, {
          x: x + 0.1, y: cy + (hasZweit ? 0.06 : 0), w: COL_W - 0.2, h: hasZweit ? CARD_H * 0.56 : CARD_H,
          fontFace: 'Calibri', fontSize: nameFontSize(p.name.length), bold: true, color: '1E1E1E',
          align: 'center', valign: hasZweit ? 'bottom' : 'middle', isTextBox: true, margin: 0, fit: 'shrink', wrap: true,
        });
        if (hasZweit) {
          const badgeText = '🔄 ' + p.zweitKurz.join(', ');
          slide.addText(badgeText, {
            x: x + 0.08, y: cy + CARD_H * 0.58, w: COL_W - 0.16, h: CARD_H * 0.4,
            fontFace: 'Calibri', fontSize: badgeFontSize(badgeText.length), italic: true, bold: true, color: ZWEIT_FARBE,
            align: 'center', valign: 'top', isTextBox: true, margin: 0, fit: 'shrink', wrap: true,
          });
        }
      });
    });

    drawLegend(slide, 'Seite ' + (pageIdx + 1) + ' von ' + pages.length);
  });

  return P.writeFile({ fileName: outPath }).then(() => console.log('Gespeichert:', outPath, '|', branchNames.length, 'Filialen,', people.length, 'Mitarbeitende,', pages.length, 'Folien'));
}

async function main() {
  const outDir = path.join(__dirname, '..', 'output');
  await buildRegion('west', path.join(outDir, 'Filialverteilung_West.pptx'));
  await buildRegion('ost', path.join(outDir, 'Filialverteilung_Ost.pptx'));
}
main().catch((e) => { console.error(e); process.exit(1); });
