'use strict';
// study session: choices, typed answers, grading

let session = null;

function startStudy() {
  const prog = loadJSON(LS_PROGRESS(currentDeckId), {});
  // order the whole deck, then take the top N for a subset
  const ordered = orderCards(currentParsed.cards, prog, settings.order);
  const queue = settings.count === 'all'
    ? ordered
    : ordered.slice(0, Math.min(parseInt(settings.count, 10), ordered.length));
  session = { queue, i: 0, revealed: false, mode: settings.mode, right: 0, wrong: 0, prog };
  show('studyView');
  renderCard();
}

// md2html the cloze template, then swap @@CZn@@ for the blanks (front) or answers (back)
function clozeFace(template, fills) {
  return md2html(template).replace(/@@CZ(\d+)@@/g, (_, i) => fills[Number(i)]);
}

// options come out of the file in a fixed order, so the answer always sits in
// the same spot. shuffle them and re-letter a/b/c by their new position.
function shuffleChoices(mc) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const correct = new Set();
  const options = shuffle(mc.options.slice()).map((o, i) => {
    if (mc.correct.has(o.label)) correct.add(letters[i]);
    return { label: letters[i], text: o.text };
  });
  return { question: mc.question, explanation: mc.explanation, multi: mc.multi, options, correct };
}

function renderChoices(mc) {
  const box = $('#choiceBox');
  box.innerHTML = '';
  box.classList.remove('hidden');
  if (mc.multi) {
    const note = document.createElement('div');
    note.className = 'choice-note';
    note.textContent = 'Select all that apply';
    box.appendChild(note);
  }
  for (const opt of mc.options) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'choice';
    el.tabIndex = -1;
    el.dataset.label = opt.label;
    el.innerHTML = `<span class="choice-key">${opt.label}</span><span class="choice-text">${md2html(opt.text)}</span>`;
    el.addEventListener('click', (e) => { toggleChoice(opt.label); e.currentTarget.blur(); });
    box.appendChild(el);
  }
}

function toggleChoice(label) {
  const s = session;
  if (s.revealed || !s.mc) return;
  const sel = s.selected;
  if (s.mc.multi) { sel.has(label) ? sel.delete(label) : sel.add(label); }
  else { sel.clear(); sel.add(label); }
  $$('#choiceBox .choice').forEach((el) => el.classList.toggle('selected', sel.has(el.dataset.label)));
}

function renderCard() {
  const s = session;
  if (s.i >= s.queue.length) return finishSession();

  const card = s.queue[s.i];
  s.revealed = false;
  const cloze = parseCloze(card);
  const mc = cloze ? null : parseChoices(card);
  // surface: type = text input, choice = clickable options (MC only, else flip),
  // flip = front/back self-grade. cloze is recall, so type or flip.
  const surface = s.mode === 'type' ? 'type'
    : (s.mode === 'choice' && mc) ? 'choice'
    : 'flip';
  s.mc = surface === 'choice' ? shuffleChoices(mc) : null;
  s.selected = new Set();

  // Build the front HTML, the revealed answer HTML, and the typed grading target.
  let frontHtml, backHtml;
  if (cloze) {
    // Blank the deletions on the front, fill them on the back; text after ---
    // (Anki's "Extra") shows as added context below the answer.
    frontHtml = clozeFace(cloze.template, cloze.blanks);
    backHtml = clozeFace(cloze.template, cloze.reveals);
    if (card.back) backHtml += md2html(card.back);
    s.typeTarget = cloze.answers.map((a) => a.text).join('\n');
  } else {
    let frontMd, backMd;
    if (surface === 'choice') {
      frontMd = mc.question;               // options become clickable rows
      backMd = mc.explanation;
    } else if (mc && (surface === 'type' || settings.hints === 'hide')) {
      // MC with options hidden: show just the question, use the explanation
      // as the answer (rebuilding it from the options is brittle).
      const correct = mc.options.filter((o) => mc.correct.has(o.label));
      frontMd = mc.question;
      backMd = mc.explanation || card.back;
      s.typeTarget = [...mc.correct].join(', ') + '\n' + correct.map((o) => o.text).join('\n');
    } else {
      frontMd = card.front;
      backMd = card.back;
      s.typeTarget = card.back;
    }
    frontHtml = md2html(frontMd);
    backHtml = md2html(backMd);
  }

  $('#progressBar').style.width = `${(s.i / s.queue.length) * 100}%`;
  $('#studyCounter').textContent = `${s.i + 1} / ${s.queue.length}`;

  $('#cardFront').innerHTML = frontHtml;
  $('#cardBack').innerHTML = backHtml;
  $('#cardBack').classList.add('hidden');
  $('#cardDivider').classList.add('hidden');

  const st = s.prog[card.key];
  $('#cardBadge').textContent = st && st.seen
    ? `seen ${st.seen} · ${st.correct} correct · ${st.wrong} wrong` : 'new';

  const typeBox = $('#typeBox'), input = $('#typeInput');
  typeBox.classList.add('hidden');
  $('#choiceBox').classList.add('hidden');

  if (surface === 'choice') {
    renderChoices(s.mc);
  } else if (surface === 'type') {
    typeBox.classList.remove('hidden');
    input.value = ''; input.className = ''; input.disabled = false;
    $('#typeHint').textContent = ''; $('#typeHint').className = 'type-hint';
    setTimeout(() => input.focus(), 30);
  }

  $('#revealBtn').classList.remove('hidden');
  $('#revealBtn').textContent = surface === 'flip' ? 'Show answer (Space)' : 'Check answer (Enter)';
  $('#gradeRow').classList.add('hidden');
  $('#continueBtn').classList.add('hidden');
}

// paint the input + hint from a similarity score, return the state
function showTypeFeedback(sim) {
  const input = $('#typeInput'), hint = $('#typeHint');
  const state = sim >= 0.9 ? 'match' : sim >= 0.7 ? 'close' : 'miss';
  const pct = Math.round(sim * 100);
  input.className = state;
  hint.className = 'type-hint ' + state;
  hint.textContent = state === 'match' ? `Match (${pct}%)`
    : state === 'close' ? `Close (${pct}%) - typo-level difference`
    : `No match (${pct}%)`;
  return state;
}

// live feedback as you type, before Enter
function liveTypeEval() {
  const s = session;
  if (!s || s.revealed || s.mode !== 'type') return;
  const input = $('#typeInput'), hint = $('#typeHint');
  if (!input.value.trim()) { input.className = ''; hint.textContent = ''; hint.className = 'type-hint'; return; }
  showTypeFeedback(similarity(input.value, stripMd(s.typeTarget)));
}

function reveal() {
  const s = session;
  if (s.revealed) return;
  s.revealed = true;
  $('#revealBtn').classList.add('hidden');
  const hasBack = $('#cardBack').innerHTML.trim() !== '';
  $('#cardBack').classList.toggle('hidden', !hasBack);
  $('#cardDivider').classList.toggle('hidden', !hasBack);

  if (s.mc) {
    // MC grades itself from the selection - colour the options, offer Continue
    const sel = s.selected, correct = s.mc.correct;
    $$('#choiceBox .choice').forEach((el) => {
      const l = el.dataset.label;
      el.disabled = true;
      if (correct.has(l)) el.classList.add(sel.has(l) ? 'correct' : 'missed');
      else if (sel.has(l)) el.classList.add('wrong');
    });
    s.autoCorrect = sel.size === correct.size && [...sel].every((l) => correct.has(l));
    showContinue();
  } else if (s.mode === 'type') {
    // typed: similarity >= 0.7 (match or close) counts as correct
    const input = $('#typeInput');
    const sim = similarity(input.value, stripMd(s.typeTarget));
    showTypeFeedback(sim);
    input.disabled = true;
    s.autoCorrect = sim >= 0.7;
    showContinue();
  } else {
    // flip is the only mode you grade yourself
    $('#gradeRow').classList.remove('hidden');
    $('#gradeRight').focus();
  }
}

function showContinue() {
  const btn = $('#continueBtn');
  btn.classList.remove('hidden');
  btn.focus();
}

const stripMd = (s) => s.replace(/[*_`#>\-]/g, ' ');
// lowercase, strip accents + punctuation, collapse spaces
const normalize = (s) => s
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

// 0..1 score, best of the whole answer and each line, so "Canberra\n\n(aside)"
// still matches "canberra"
function similarity(typed, answer) {
  const a = normalize(typed);
  if (!a) return 0;
  let best = 0;
  for (const cand of [answer, ...answer.split('\n')]) {
    const c = normalize(cand);
    if (!c) continue;
    const s = c === a ? 1 : 1 - editDistance(a, c) / Math.max(a.length, c.length);
    if (s > best) best = s;
  }
  return best;
}
// Damerau-OSA distance - counts a swap like "Pairs"/"Paris" as one edit
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function grade(correct) {
  const s = session;
  if (!s.revealed) return;
  const card = s.queue[s.i];
  const st = s.prog[card.key] || { seen: 0, correct: 0, wrong: 0, last: '', ts: 0 };
  st.seen++;
  if (correct) { st.correct++; st.last = 'right'; s.right++; }
  else { st.wrong++; st.last = 'wrong'; s.wrong++; }
  st.ts = Date.now();
  s.prog[card.key] = st;
  saveJSON(LS_PROGRESS(currentDeckId), s.prog);

  s.i++;
  renderCard();
}

function finishSession() {
  const s = session;
  $('#progressBar').style.width = '100%';
  const total = s.right + s.wrong;
  $('#summaryStats').innerHTML = [
    ['Reviewed', total], ['Correct', s.right], ['Wrong', s.wrong],
    ['Accuracy', total ? Math.round((s.right / total) * 100) + '%' : '-'],
  ].map(([lbl, num]) => `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join('');
  show('summaryView');
}

