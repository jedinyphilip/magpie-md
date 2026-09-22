'use strict';
// Printable cards (Print, or Save as PDF from the print dialog). Every card
// gets the smallest size that fits its content, then the cards are packed onto
// the pages - turned sideways where that fits better - so little paper is wasted.
// Fold-over: front and back side by side; cut out, fold on the dashed line.
// Double-sided: fronts on one page, backs on the next, mirrored so they land on
// their card when printed double-sided, flipping on the long edge.

const PAPER = { a4: { w: 210, h: 297, name: 'A4' }, letter: { w: 215.9, h: 279.4, name: 'Letter' } };
const PRINT_MARGIN = 8;                          // mm; most printers can't reach the edge
const CARD_PAD = 4;                              // mm inside each face
const MIN_CARD_W = 40;                           // mm; narrower cards are too cramped for text
const MIN_IMAGE_SCALE = 0.5;                     // images print at least half their natural size, so text in them stays legible
const BASE_FONT = 9.5;                           // pt; the Card size slider scales this and MIN_IMAGE_SCALE
const DUPLEX_GAP = 4;                            // mm; a slightly shifted back still lands on its card
const EPS = 0.01;

let printJob = 0;                                // the newest layout wins if options change mid-way

function printFaces(card) {
  const cloze = parseCloze(card);
  if (cloze) {
    return {
      front: clozeFace(cloze.template, cloze.blanks),
      back: clozeFace(cloze.template, cloze.reveals) + (card.back ? md2html(card.back) : ''),
    };
  }
  return { front: md2html(card.front), back: md2html(card.back) };
}

// wait for the images in el to load, so measurements include them
function imagesLoaded(el) {
  return Promise.all([...el.querySelectorAll('img')].map((img) => {
    img.loading = 'eager';
    if (img.complete) return null;
    return new Promise((res) => { img.onload = img.onerror = res; setTimeout(res, 8000); });
  }));
}

// Card widths that tile the printable width: 1, 2, 3 or 4 printed pieces
// (with their gaps) fill a row exactly, so columns of cards leave no strips.
// Plus one as long as the printable height, laid sideways, for big pictures.
// A fold-over piece is two cards wide.
function cardWidths(uw, uh, fold, gap) {
  const out = [];
  const add = (piece) => {
    const w = Math.floor((fold ? piece / 2 : piece) * 10) / 10;
    if (w >= MIN_CARD_W && !out.includes(w)) out.push(w);
  };
  for (let k = 1; k <= 4; k++) add((uw - (k - 1) * gap) / k);
  add(uh);
  return out.sort((a, b) => a - b);
}

// For every card and candidate width: the content height (mm) of its taller
// face, and how small its images come out (shown width / natural width),
// laid out in one pass in a hidden stage.
async function measureFaces(faces, widths, stage) {
  stage.innerHTML = '<div style="width:100mm"></div>';
  const pxPerMm = stage.firstChild.getBoundingClientRect().width / 100;
  stage.innerHTML = '';
  const boxes = [];
  const frag = document.createDocumentFragment();
  faces.forEach((f, i) => {
    for (const w of widths) {
      for (const side of ['front', 'back']) {
        const el = document.createElement('div');
        el.className = 'pbody ' + side;
        el.style.width = (w - 2 * CARD_PAD) + 'mm';
        el.innerHTML = f[side];
        frag.appendChild(el);
        boxes.push({ i, w, el });
      }
    }
  });
  stage.appendChild(frag);
  await imagesLoaded(stage);
  const need = faces.map(() => ({}));
  for (const b of boxes) {
    const n = need[b.i][b.w] || (need[b.i][b.w] = { h: 0, img: 1 });
    n.h = Math.max(n.h, b.el.getBoundingClientRect().height / pxPerMm);
    for (const img of b.el.querySelectorAll('img')) {
      if (img.naturalWidth) n.img = Math.min(n.img, img.getBoundingClientRect().width / img.naturalWidth);
    }
  }
  stage.innerHTML = '';
  return need;
}

// Smallest card (by area) that fits the content and stays card-shaped (height
// 0.55-1.25x the width), and whose printed piece fits on the page. Only widths
// that show the card's images at least minImg of their size count; if none do, the widest one.
// Content too long for any of those gets the widest card, as tall as the page
// allows, shrunk if even that isn't enough.
function cardSize(need, widths, fits, minImg) {
  const onPage = widths.filter((w) => fits(w, 1));
  const legible = onPage.filter((w) => need[w].img >= minImg);
  const usable = legible.length ? legible : onPage.slice(-1);
  let best = null;
  for (const w of usable) {
    const h = Math.ceil(Math.max(need[w].h + 2 * CARD_PAD, w * 0.55));
    if (h > w * 1.25 || !fits(w, h)) continue;
    if (!best || w * h < best.w * best.h) best = { w, h, scale: 1 };
  }
  if (best) return best;
  const w = usable[usable.length - 1];
  let maxH = 1;
  while (fits(w, maxH + 1)) maxH++;
  const h = Math.ceil(need[w].h + 2 * CARD_PAD);
  return h <= maxH ? { w, h, scale: 1 } : { w, h: maxH, scale: (maxH - 2 * CARD_PAD) / (h - 2 * CARD_PAD) };
}

// MaxRects packing (best short side fit, rotation allowed) onto as many pages
// of binW x binH as needed. pieces: [{ w, h, ... }] -> pages: [[{ piece, x, y, rot }]]
function packPieces(pieces, binW, binH, gap) {
  const pages = [];
  const newPage = () => { const p = { free: [{ x: 0, y: 0, w: binW + gap, h: binH + gap }], items: [] }; pages.push(p); return p; };
  const order = pieces.slice().sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  for (const pc of order) {
    let best = null;
    const tryPage = (page) => {
      for (const fr of page.free) {
        for (const rot of [false, true]) {
          const w = (rot ? pc.h : pc.w) + gap, h = (rot ? pc.w : pc.h) + gap;
          if (w > fr.w + EPS || h > fr.h + EPS) continue;
          const short = Math.min(fr.w - w, fr.h - h), long = Math.max(fr.w - w, fr.h - h);
          if (!best || short < best.short - EPS || (Math.abs(short - best.short) <= EPS && long < best.long)) {
            best = { page, x: fr.x, y: fr.y, w, h, rot, short, long };
          }
        }
      }
    };
    pages.forEach(tryPage);
    if (!best) tryPage(newPage());
    if (!best) throw new Error('a card is larger than the page');
    const { page } = best;
    page.items.push({ piece: pc, x: best.x, y: best.y, rot: best.rot });
    // split every free rectangle the new piece overlaps into the parts around it
    const used = { x: best.x, y: best.y, w: best.w, h: best.h };
    const next = [];
    for (const fr of page.free) {
      if (used.x >= fr.x + fr.w - EPS || used.x + used.w <= fr.x + EPS || used.y >= fr.y + fr.h - EPS || used.y + used.h <= fr.y + EPS) {
        next.push(fr);
        continue;
      }
      if (used.x > fr.x + EPS) next.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
      if (used.x + used.w < fr.x + fr.w - EPS) next.push({ x: used.x + used.w, y: fr.y, w: fr.x + fr.w - used.x - used.w, h: fr.h });
      if (used.y > fr.y + EPS) next.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
      if (used.y + used.h < fr.y + fr.h - EPS) next.push({ x: fr.x, y: used.y + used.h, w: fr.w, h: fr.y + fr.h - used.y - used.h });
    }
    const inside = (a, b) => a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
    page.free = next.filter((a, i) => !next.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
  }
  return pages.map((p) => p.items);
}

// Card sizes, pieces and pages for the current deck and options.
function layoutCards(faces, need, widths, paper, fold, minImg = MIN_IMAGE_SCALE) {
  const uw = paper.w - 2 * PRINT_MARGIN, uh = paper.h - 2 * PRINT_MARGIN;
  const piece = (w, h) => (fold ? [2 * w, h] : [w, h]);
  const fits = (w, h) => {
    const [a, b] = piece(w, h);
    return (a <= uw && b <= uh) || (a <= uh && b <= uw);
  };
  const pieces = faces.map((f, i) => {
    const size = cardSize(need[i], widths, fits, minImg);
    const [w, h] = piece(size.w, size.h);
    return { i, w, h, card: size };
  });
  return { pages: packPieces(pieces, uw, uh, fold ? 0 : DUPLEX_GAP), pieces };
}

// One face: the content centred in a w x h box, with the card number in the corner.
function faceHtml(html, i, size, side, left) {
  const zoom = size.scale < 1 ? `zoom:${size.scale};width:${(size.w - 2 * CARD_PAD) / size.scale}mm;` : '';
  return `<div class="pface ${side}" style="left:${left}mm;width:${size.w}mm;height:${size.h}mm">`
    + `<span class="pnum">${i + 1}</span><div class="pbody ${side}" style="${zoom}">${html}</div></div>`;
}

// A placed piece. It is drawn unrotated at w x h and turned into its slot:
// rot 90 = clockwise, -90 = anticlockwise (the mirrored back of a turned card).
function pieceHtml(item, paper, inner, rot, mirror) {
  const { w, h } = item.piece;
  const sw = item.rot ? h : w, sh = item.rot ? w : h;
  const x = mirror ? paper.w - PRINT_MARGIN - item.x - sw : PRINT_MARGIN + item.x;
  const turn = rot === 90 ? `transform:translateX(${h}mm) rotate(90deg)` : rot === -90 ? `transform:translateY(${w}mm) rotate(-90deg)` : '';
  return `<div class="ppiece" style="left:${x}mm;top:${PRINT_MARGIN + item.y}mm;width:${sw}mm;height:${sh}mm">`
    + `<div class="pcard" style="width:${w}mm;height:${h}mm;${turn}">${inner}</div></div>`;
}

function renderPrintPages(faces, layout, paper, fold, title) {
  const out = [];
  const page = (items, label) => out.push(`<div class="ppage-wrap"><div class="ppage" style="width:${paper.w}mm;height:${paper.h}mm">${items}`
    + `<div class="pfoot">${escapeHtml(title)} · ${label}</div></div></div>`);
  const n = layout.pages.length;
  layout.pages.forEach((items, p) => {
    const num = `page ${p + 1} of ${n}`;
    if (fold) {
      page(items.map((it) => {
        const { i, card } = it.piece;
        const inner = faceHtml(faces[i].front, i, card, 'front', 0) + faceHtml(faces[i].back, i, card, 'back', card.w) + '<div class="pfold"></div>';
        return pieceHtml(it, paper, inner, it.rot ? 90 : 0, false);
      }).join(''), num);
    } else {
      page(items.map((it) => pieceHtml(it, paper, faceHtml(faces[it.piece.i].front, it.piece.i, it.piece.card, 'front', 0), it.rot ? 90 : 0, false)).join(''), `fronts, ${num}`);
      page(items.map((it) => pieceHtml(it, paper, faceHtml(faces[it.piece.i].back, it.piece.i, it.piece.card, 'back', 0), it.rot ? -90 : 0, true)).join(''), `backs, ${num}`);
    }
  });
  return out.join('');
}

// fit the page previews to the screen width (printing uses the real size)
function scalePrintPreview() {
  const box = $('#printPages');
  const avail = box.clientWidth;
  $$('#printPages .ppage-wrap').forEach((wrap) => {
    const pg = wrap.firstChild;
    const s = Math.min(1, avail / pg.offsetWidth);
    pg.style.transform = `scale(${s})`;
    wrap.style.width = pg.offsetWidth * s + 'px';
    wrap.style.height = pg.offsetHeight * s + 'px';
  });
}

async function buildPrintView() {
  const job = ++printJob;
  const paper = PAPER[settings.printPaper] || PAPER.a4;
  const fold = settings.printLayout !== 'duplex';
  // Card size: scales the text and how large pictures must print; cards follow
  const scale = (settings.printScale || 100) / 100;
  $('#printView').style.setProperty('--pfont', BASE_FONT * scale + 'pt');
  $('#printSize').value = settings.printScale || 100;
  $('#printSizeValue').textContent = (settings.printScale || 100) + '%';
  $$('#printPaperSeg button').forEach((b) => b.classList.toggle('active', b.dataset.paper === settings.printPaper));
  $$('#printLayoutSeg button').forEach((b) => b.classList.toggle('active', b.dataset.layout === settings.printLayout));
  $('#printHint').textContent = fold
    ? 'Cut out each card along its outline and fold it on the dashed line, front outward.'
    : 'Print double-sided, flipping on the long edge, then cut the cards out along their outlines.';
  $('#printInfo').textContent = 'Laying out cards...';
  $('#printGo').disabled = true;
  $('#printPages').innerHTML = '';
  // @page size for the print dialog: the paper, no browser margins
  $('#printPageStyle').textContent = `@page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }`;

  await mediaReady;                              // the deck's images
  const faces = currentParsed.cards.map(printFaces);
  const widths = cardWidths(paper.w - 2 * PRINT_MARGIN, paper.h - 2 * PRINT_MARGIN, fold, fold ? 0 : DUPLEX_GAP);
  const need = await measureFaces(faces, widths, $('#printMeasure'));
  if (job !== printJob) return;
  const layout = layoutCards(faces, need, widths, paper, fold, MIN_IMAGE_SCALE * scale);
  $('#printPages').innerHTML = renderPrintPages(faces, layout, paper, fold, currentParsed.title);
  await imagesLoaded($('#printPages'));
  if (job !== printJob) return;
  scalePrintPreview();
  const sheets = layout.pages.length * (fold ? 1 : 2);
  const cards = faces.length;
  $('#printInfo').textContent = `${cards} card${cards === 1 ? '' : 's'} on ${sheets} page${sheets === 1 ? '' : 's'} (${paper.name})`
    + (fold ? '' : `, printed as ${layout.pages.length} double-sided sheet${layout.pages.length === 1 ? '' : 's'}`) + '.';
  $('#printGo').disabled = false;
}

function openPrintView() {
  $('#printTitle').textContent = currentParsed.title;
  show('printView');
  buildPrintView().catch((e) => { $('#printInfo').textContent = 'Could not lay out the cards: ' + e.message; });
}
