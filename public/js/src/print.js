'use strict';
// Printable cards (Print, or Save as PDF from the print dialog). Every card is
// the same size, given in mm, and the cards are packed onto the pages - turned
// sideways where that fits better - so little paper is wasted. Content that
// doesn't fit a card is scaled down to it; smaller content sits centred in it.
// Fold-over: front and back side by side; cut out, fold on the dashed line.
// Double-sided: fronts on one page, backs on the next, placed so they land on
// their card for the flip the printer makes - long side (backs mirrored left to
// right) or short side (mirrored top to bottom, and upside down).

const PAPER = { a4: { w: 210, h: 297, name: 'A4' }, letter: { w: 215.9, h: 279.4, name: 'Letter' } };
const PRINT_MARGIN = 8;                          // mm; most printers can't reach the edge
const CARD_PAD = 4;                              // mm inside each face
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

// The content height (mm) of each card's taller face at the card's width,
// measured in one pass in a hidden stage.
async function measureFaces(faces, width, stage, imgMaxH) {
  stage.innerHTML = '<div style="width:100mm"></div>';
  const pxPerMm = stage.firstChild.getBoundingClientRect().width / 100;
  stage.innerHTML = '';
  const boxes = [];
  const frag = document.createDocumentFragment();
  faces.forEach((f, i) => {
    for (const side of ['front', 'back']) {
      const el = document.createElement('div');
      el.className = 'pbody ' + side;
      el.style.width = (width - 2 * CARD_PAD) + 'mm';
      el.style.setProperty('--pimgmax', imgMaxH + 'mm');
      el.innerHTML = f[side];
      frag.appendChild(el);
      boxes.push({ i, el });
    }
  });
  stage.appendChild(frag);
  await imagesLoaded(stage);
  const need = faces.map(() => 0);
  for (const b of boxes) need[b.i] = Math.max(need[b.i], b.el.getBoundingClientRect().height / pxPerMm);
  stage.innerHTML = '';
  return need;
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

// One size for every card: content that doesn't fit is scaled down, content
// that is smaller sits centred in the space (both handled by faceHtml).
function fixedSize(need, w, h) {
  return { w, h, scale: Math.min(1, (h - 2 * CARD_PAD) / Math.max(need, 0.1)) };
}

// Card sizes, pieces and pages for the current deck and options.
function layoutCards(faces, need, paper, fold, card) {
  const uw = paper.w - 2 * PRINT_MARGIN, uh = paper.h - 2 * PRINT_MARGIN;
  const pieces = faces.map((f, i) => {
    const size = fixedSize(need[i], card.w, card.h);
    return { i, w: fold ? 2 * size.w : size.w, h: size.h, card: size };
  });
  return { pages: packPieces(pieces, uw, uh, fold ? 0 : DUPLEX_GAP), pieces };
}

// One face: the content centred in a w x h box, with the card number in the corner.
function faceHtml(html, i, size, side, left) {
  const zoom = size.scale < 1 ? `zoom:${size.scale};width:${(size.w - 2 * CARD_PAD) / size.scale}mm;` : '';
  return `<div class="pface ${side}" style="left:${left}mm;width:${size.w}mm;height:${size.h}mm;`
    + `--pimgmax:${(size.h - 2 * CARD_PAD) / (size.scale < 1 ? size.scale : 1)}mm">`
    + `<span class="pnum">${i + 1}</span><div class="pbody ${side}" style="${zoom}">${html}</div></div>`;
}

// A placed piece. It is drawn unrotated at w x h and turned into its slot:
// rot 90 = clockwise, -90 = anticlockwise, 180 = upside down. mirror puts the
// slot on the opposite side of the page: 'x' for a long-side flip, 'y' for a
// short-side one.
function pieceHtml(item, paper, inner, rot, mirror) {
  const { w, h } = item.piece;
  const sw = item.rot ? h : w, sh = item.rot ? w : h;
  const x = mirror === 'x' ? paper.w - PRINT_MARGIN - item.x - sw : PRINT_MARGIN + item.x;
  const y = mirror === 'y' ? paper.h - PRINT_MARGIN - item.y - sh : PRINT_MARGIN + item.y;
  const turn = rot === 90 ? `transform:translateX(${h}mm) rotate(90deg)`
    : rot === -90 ? `transform:translateY(${w}mm) rotate(-90deg)`
    : rot === 180 ? `transform:translate(${w}mm, ${h}mm) rotate(180deg)` : '';
  return `<div class="ppiece" style="left:${x}mm;top:${y}mm;width:${sw}mm;height:${sh}mm">`
    + `<div class="pcard" style="width:${w}mm;height:${h}mm;${turn}">${inner}</div></div>`;
}

// Where a back goes for the printer's flip. Long side: the sheet turns about
// its vertical axis, so the back is mirrored left to right and a turned card
// turns the other way. Short side: it turns about the horizontal axis, so the
// back is mirrored top to bottom and an unturned card prints upside down.
const backPlacement = (turned, shortSide) => (shortSide
  ? { rot: turned ? 90 : 180, mirror: 'y' }
  : { rot: turned ? -90 : 0, mirror: 'x' });

function renderPrintPages(faces, layout, paper, fold, title, shortSide) {
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
        return pieceHtml(it, paper, inner, it.rot ? 90 : 0, null);
      }).join(''), num);
    } else {
      page(items.map((it) => pieceHtml(it, paper, faceHtml(faces[it.piece.i].front, it.piece.i, it.piece.card, 'front', 0), it.rot ? 90 : 0, null)).join(''), `fronts, ${num}`);
      page(items.map((it) => {
        const back = backPlacement(it.rot, shortSide);
        return pieceHtml(it, paper, faceHtml(faces[it.piece.i].back, it.piece.i, it.piece.card, 'back', 0), back.rot, back.mirror);
      }).join(''), `backs, ${num}`);
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
  const mode = settings.printLayout === 'duplex' ? 'long' : (settings.printLayout || 'fold');   // 'duplex' is what older versions saved
  const fold = mode === 'fold', shortSide = mode === 'short';
  const card = {
    w: Math.min(400, Math.max(20, Math.round(settings.printCardW) || 90)),
    h: Math.min(400, Math.max(20, Math.round(settings.printCardH) || 55)),
  };
  const font = Math.min(24, Math.max(4, Number(settings.printFontPt) || 9.5));
  $('#printView').style.setProperty('--pfont', font + 'pt');
  $('#printCardW').value = card.w;
  $('#printCardH').value = card.h;
  $('#printFont').value = font;
  $$('#printPaperSeg button').forEach((b) => b.classList.toggle('active', b.dataset.paper === settings.printPaper));
  $$('#printLayoutSeg button').forEach((b) => b.classList.toggle('active', b.dataset.layout === mode));
  $('#printHint').textContent = (fold
    ? 'Cut out each card along its outline and fold it on the dashed line, front outward.'
    : `Print double-sided with your printer set to flip on the ${shortSide ? 'short' : 'long'} side, then cut the cards out along their outlines.`)
    + ' Content that does not fit a card is scaled down to it; smaller content sits centred in the space.';
  $('#printInfo').textContent = 'Laying out cards...';
  $('#printGo').disabled = true;
  $('#printPages').innerHTML = '';
  // @page size for the print dialog: the paper, no browser margins
  $('#printPageStyle').textContent = `@page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }`;

  const uw = paper.w - 2 * PRINT_MARGIN, uh = paper.h - 2 * PRINT_MARGIN;
  const fitsPiece = (w, h) => {
    const [a, b] = fold ? [2 * w, h] : [w, h];
    return (a <= uw && b <= uh) || (a <= uh && b <= uw);
  };
  if (!fitsPiece(card.w, card.h)) {
    // say which limit was hit, or the largest card that would fit at all
    const widest = (hh) => { let v = 19; while (v < 400 && fitsPiece(v + 1, hh)) v++; return v; };
    const tallest = (ww) => { let v = 19; while (v < 400 && fitsPiece(ww, v + 1)) v++; return v; };
    let tip;
    if (widest(card.h) >= 20) tip = `At this height the card can be at most ${widest(card.h)} mm wide.`;
    else if (tallest(card.w) >= 20) tip = `At this width the card can be at most ${tallest(card.w)} mm tall.`;
    else {
      let best = { w: 20, h: 20, area: 0 };
      for (let ww = 20; ww <= 400; ww++) {
        const hh = tallest(ww);
        if (hh >= 20 && ww * hh > best.area) best = { w: ww, h: hh, area: ww * hh };
      }
      tip = `The largest card that fits is ${best.w} × ${best.h} mm.`;
    }
    $('#printInfo').textContent = `A ${card.w} × ${card.h} mm card doesn't fit on ${paper.name}`
      + (fold ? ' with front and back side by side' : '') + '. ' + tip;
    return;
  }

  await mediaReady;                              // the deck's images
  const faces = currentParsed.cards.map(printFaces);
  const need = await measureFaces(faces, card.w, $('#printMeasure'), card.h - 2 * CARD_PAD);
  if (job !== printJob) return;
  const layout = layoutCards(faces, need, paper, fold, card);
  $('#printPages').innerHTML = renderPrintPages(faces, layout, paper, fold, currentParsed.title, shortSide);
  await imagesLoaded($('#printPages'));
  if (job !== printJob) return;
  scalePrintPreview();
  const sheets = layout.pages.length * (fold ? 1 : 2);
  const cards = faces.length;
  const shrunk = layout.pieces.filter((pc) => pc.card.scale < 0.995).length;
  $('#printInfo').textContent = `${cards} card${cards === 1 ? '' : 's'} of ${card.w} × ${card.h} mm`
    + ` on ${sheets} page${sheets === 1 ? '' : 's'} (${paper.name})`
    + (fold ? '' : `, printed as ${layout.pages.length} double-sided sheet${layout.pages.length === 1 ? '' : 's'}`) + '.'
    + (shrunk ? ` ${shrunk} card${shrunk === 1 ? ' was' : 's were'} scaled down to fit.` : '');
  $('#printGo').disabled = false;
}

function openPrintView() {
  $('#printTitle').textContent = currentParsed.title;
  show('printView');
  buildPrintView().catch((e) => { $('#printInfo').textContent = 'Could not lay out the cards: ' + e.message; });
}
