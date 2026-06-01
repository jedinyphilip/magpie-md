'use strict';
// views: home, deck detail, edit, import/export

const views = ['homeView', 'pasteView', 'editView', 'deckView', 'studyView', 'summaryView'];
function show(view) {
  for (const v of views) $('#' + v).classList.toggle('hidden', v !== view);
  document.body.classList.toggle('studying', view === 'studyView');  // body.studying locks the viewport
  window.scrollTo(0, 0);
}

function renderHome() {
  const decks = getDecks();
  const ids = Object.keys(decks).sort((a, b) => decks[b].addedAt - decks[a].addedAt);
  const list = $('#deckList');
  list.innerHTML = '';
  $('#emptyHint').classList.toggle('hidden', ids.length > 0);

  for (const id of ids) {
    const parsed = parseDeck(decks[id].source);
    const s = deckStats(id, parsed);
    list.appendChild(deckItem(id, decks[id].title, s));
  }
  show('homeView');
}

function deckItem(id, title, s) {
  const li = document.createElement('li');
  li.className = 'deck-item';
  li.innerHTML = `
    <div class="d-main">
      <div class="d-title">${escapeHtml(title)}</div>
      <div class="d-sub">${s.total} cards · ${s.seen} studied · ${s.mastered} mastered · ${s.accuracy}% acc.</div>
    </div>
    <div class="ring">${miniRing(s.total ? s.seen / s.total : 0)}</div>
    <div class="d-actions">
      <button class="btn ghost mini" data-act="copy">Copy</button>
      <button class="btn ghost mini danger" data-act="delete">Delete</button>
    </div>`;
  li.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return openDeck(id);
    if (act.dataset.act === 'copy') copyDeckToClipboard(id, act);
    else deleteDeckFromHome(id, title);
  });
  return li;
}

function deckMarkdown(id, includeProgress) {
  const decks = getDecks();
  if (!decks[id]) return '';
  const parsed = parseDeck(decks[id].source);
  const prog = loadJSON(LS_PROGRESS(id), {});
  return serializeDeck(parsed, prog, includeProgress);
}

function copyDeckToClipboard(id, btn) {
  const text = deckMarkdown(id, false);
  const label = btn.textContent;
  const done = (ok) => {
    btn.textContent = ok ? 'Copied' : 'Failed';
    setTimeout(() => { btn.textContent = label; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
  } else {
    done(fallbackCopy(text));
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function deleteDeckFromHome(id, title) {
  if (!confirm('Delete "' + title + '" and its progress from this browser?')) return;
  const decks = getDecks();
  delete decks[id];
  setDecks(decks);
  localStorage.removeItem(LS_PROGRESS(id));
  renderHome();
}

function miniRing(frac) {
  const r = 16, c = 2 * Math.PI * r, off = c * (1 - frac);
  return `<svg width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--border)" stroke-width="4"/>
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--accent)" stroke-width="4"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" stroke-linecap="round"
      transform="rotate(-90 20 20)"/>
  </svg>`;
}

function loadSamples() {
  const list = $('#sampleList'), hint = $('#sampleHint');
  hint.classList.add('hidden');
  list.innerHTML = '';
  for (const deck of SAMPLE_DECKS) {
    const li = document.createElement('li');
    li.className = 'deck-item';
    li.innerHTML = `<div class="d-main"><div class="d-title">${escapeHtml(deck.title)}</div>
      <div class="d-sub">${escapeHtml(deck.description)}</div></div>
      <button class="btn ghost">Load</button>`;
    li.addEventListener('click', () => { const id = addDeckFromText(deck.source); if (id) openDeck(id); });
    list.appendChild(li);
  }
}

let currentDeckId = null;
let currentParsed = null;

function openDeck(id) {
  const decks = getDecks();
  if (!decks[id]) return renderHome();
  currentDeckId = id;
  currentParsed = parseDeck(decks[id].source);

  $('#deckTitle').textContent = currentParsed.title;
  renderDeckStats();
  syncSegs();
  show('deckView');
}

function renderDeckStats() {
  const s = deckStats(currentDeckId, currentParsed);
  $('#deckStats').innerHTML = [
    ['Cards', s.total], ['Studied', s.seen], ['Mastered', s.mastered], ['Accuracy', s.accuracy + '%'],
  ].map(([lbl, num]) => `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join('');
}

function syncSegs() {
  $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
  $$('#orderSeg button').forEach((b) => b.classList.toggle('active', b.dataset.order === settings.order));
  $$('#hintsSeg button').forEach((b) => b.classList.toggle('active', b.dataset.hints === settings.hints));
  $('#hintsCfg').classList.toggle('hidden', settings.mode !== 'flip');  // hints only matter in flip
  $$('#shuffleSeg button').forEach((b) => b.classList.toggle('active', b.dataset.shuffle === settings.shuffleAnswers));
  $('#shuffleCfg').classList.toggle('hidden', settings.mode !== 'choice');  // only choice shows options

  // count slider: top of the range = whole deck ("all"), below = a subset
  const total = currentParsed.cards.length;
  const subset = settings.count !== 'all' && parseInt(settings.count, 10) < total;
  const range = $('#countRange');
  range.max = total;
  range.value = subset ? parseInt(settings.count, 10) : total;
  range.disabled = total <= 1;
  $('#countValue').textContent = subset ? `${range.value} of ${total}` : `All ${total}`;
  $('#subsetHint').classList.toggle('hidden', !subset);
  updateStartLabel(total, subset);
}

function updateStartLabel(total, subset) {
  const n = subset ? parseInt(settings.count, 10) : total;
  $('#startStudy').textContent = subset ? `Study ${n} cards` : `Study all ${total} cards`;
}

function exportDeck(includeProgress) {
  const prog = loadJSON(LS_PROGRESS(currentDeckId), {});
  const text = serializeDeck(currentParsed, prog, includeProgress);
  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slug(currentParsed.title) + (includeProgress ? '.progress.md' : '.md');
  a.click();
  URL.revokeObjectURL(a.href);
}

// edits the markdown in place under the same deck id, so progress survives
// (changing a front rekeys that card, changing a back keeps it - like re-import)
let editorCollapsed = true;       // base64 / svg truncated by default
let editorBlobs = [];             // index -> full content behind each ⟪..#i⟫ token

// swap long base64 + whole <svg> for short ⟪..#i⟫ tokens so the textarea is readable
function collapseEditor(text) {
  editorBlobs = [];
  let out = text.replace(/<svg\b[\s\S]*?<\/svg>/gi, (m) => `⟪svg#${editorBlobs.push(m) - 1}⟫`);
  out = out.replace(/(data:[\w/.+-]*;base64,)([A-Za-z0-9+/=]{32,})/g,
    (_, prefix, payload) => prefix + `⟪img#${editorBlobs.push(payload) - 1}⟫`);
  return out;
}

function expandEditor(text) {
  return text.replace(/⟪(?:img|svg)#(\d+)⟫/g, (m, i) => {
    const b = editorBlobs[Number(i)];
    return b == null ? m : b;
  });
}

function syncEditToggle() {
  const b = $('#editToggle');
  b.classList.toggle('active', editorCollapsed);
  b.title = editorCollapsed ? 'Show full base64 & SVG' : 'Truncate base64 & SVG';
}

function toggleEditTruncate() {
  const ta = $('#editArea');
  ta.value = editorCollapsed ? expandEditor(ta.value) : collapseEditor(ta.value);
  editorCollapsed = !editorCollapsed;
  syncEditToggle();
  ta.focus();
}

function openEditor() {
  const decks = getDecks();
  if (!decks[currentDeckId]) return renderHome();
  editorCollapsed = true;
  $('#editArea').value = collapseEditor(decks[currentDeckId].source);
  syncEditToggle();
  show('editView');
  $('#editArea').focus();
}

function saveDeckEdit() {
  const text = editorCollapsed ? expandEditor($('#editArea').value) : $('#editArea').value;
  const parsed = parseDeck(text);
  if (parsed.cards.length === 0) { alert('No cards found. Check the format (use --- and ===).'); return; }
  const decks = getDecks();
  decks[currentDeckId] = Object.assign({}, decks[currentDeckId], { title: parsed.title, source: text });
  setDecks(decks);
  currentParsed = parsed;
  openDeck(currentDeckId);
}

// paste an image -> drop a base64 markdown image at the cursor (a token in the
// collapsed editor, the full data URI otherwise)
function handleImagePaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (!file) continue;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result;
        if (e.target.id === 'editArea' && editorCollapsed) {
          const m = url.match(/^(data:[\w/.+-]*;base64,)([A-Za-z0-9+/=]+)$/);
          if (m) {
            const i = editorBlobs.push(m[2]) - 1;
            return insertAtCursor(e.target, `![pasted image](${m[1]}⟪img#${i}⟫)`);
          }
        }
        insertAtCursor(e.target, `![pasted image](${url})`);
      };
      reader.readAsDataURL(file);
      return;
    }
  }
}

function insertAtCursor(ta, text) {
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
}

function importFiles(fileList) {
  let lastId = null, n = 0;
  const files = [...fileList];
  let pending = files.length;
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const id = addDeckFromText(reader.result);
      if (id) { lastId = id; n++; }
      if (--pending === 0) { renderHome(); if (n === 1 && lastId) openDeck(lastId); }
    };
    reader.readAsText(file);
  });
}

