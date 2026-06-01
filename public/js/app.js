'use strict';
// entry point: fullscreen + event wiring (loaded last)

const ICON_EXPAND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_COMPRESS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v3a2 2 0 0 1-2 2H4M15 3v3a2 2 0 0 0 2 2h3M9 21v-3a2 2 0 0 0-2-2H4M15 21v-3a2 2 0 0 1 2-2h3"/></svg>';

const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function setupFullscreen() {
  const btn = $('#fullscreenBtn');
  const sync = () => {
    btn.innerHTML = isFullscreen() ? ICON_COMPRESS : ICON_EXPAND;
    btn.title = isFullscreen() ? 'Exit fullscreen' : 'Enter fullscreen';
  };
  btn.addEventListener('click', async () => {
    try {
      if (isFullscreen()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        const el = document.documentElement;
        await (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      }
    } catch (e) { /* denied or unsupported */ }
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
}

async function init() {
  applyTheme();
  $('#storageNote').textContent = 'Progress is saved per deck and survives reloads.';

  // theme
  $('#themeBtn').addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(); saveSettings();
  });

  // fullscreen
  setupFullscreen();

  // home nav
  $('#homeLink').addEventListener('click', renderHome);

  // import
  $('#importBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });

  // paste
  $('#pasteBtn').addEventListener('click', () => { $('#pasteArea').value = ''; show('pasteView'); });
  $('#pasteCancel').addEventListener('click', renderHome);
  $('#pasteImport').addEventListener('click', () => {
    const id = addDeckFromText($('#pasteArea').value);
    if (id) openDeck(id);
  });
  $('#pasteArea').addEventListener('paste', handleImagePaste);

  // edit deck
  $('#editDeck').addEventListener('click', openEditor);
  $('#editCancel').addEventListener('click', () => openDeck(currentDeckId));
  $('#editSave').addEventListener('click', saveDeckEdit);
  $('#editToggle').addEventListener('click', toggleEditTruncate);
  $('#editArea').addEventListener('paste', handleImagePaste);

  // deck detail
  $('#deckBack').addEventListener('click', renderHome);
  $('#deleteDeck').addEventListener('click', () => {
    if (!confirm('Delete this deck and its progress from this browser?')) return;
    const decks = getDecks(); delete decks[currentDeckId]; setDecks(decks);
    localStorage.removeItem(LS_PROGRESS(currentDeckId));
    renderHome();
  });
  $('#resetProgress').addEventListener('click', () => {
    if (!confirm('Reset all progress for this deck?')) return;
    localStorage.removeItem(LS_PROGRESS(currentDeckId));
    renderDeckStats();
  });
  $('#exportPlain').addEventListener('click', () => exportDeck(false));
  $('#exportProgress').addEventListener('click', () => exportDeck(true));

  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
    settings.mode = b.dataset.mode; saveSettings(); syncSegs();
  }));
  $$('#orderSeg button').forEach((b) => b.addEventListener('click', () => {
    settings.order = b.dataset.order; saveSettings(); syncSegs();
  }));
  $$('#hintsSeg button').forEach((b) => b.addEventListener('click', () => {
    settings.hints = b.dataset.hints; saveSettings(); syncSegs();
  }));
  $$('#shuffleSeg button').forEach((b) => b.addEventListener('click', () => {
    settings.shuffleAnswers = b.dataset.shuffle; saveSettings(); syncSegs();
  }));
  $('#countRange').addEventListener('input', () => {
    const total = currentParsed.cards.length;
    const v = parseInt($('#countRange').value, 10);
    // Dragging to the top means the whole deck; store 'all' so it stays "all"
    // even when you switch to a deck of a different size.
    settings.count = v >= total ? 'all' : String(v);
    saveSettings(); syncSegs();
  });

  $('#startStudy').addEventListener('click', startStudy);

  // study controls
  $('#revealBtn').addEventListener('click', reveal);
  $('#gradeRight').addEventListener('click', () => grade(true));
  $('#gradeWrong').addEventListener('click', () => grade(false));
  $('#continueBtn').addEventListener('click', () => grade(session.autoCorrect));
  $('#quitStudy').addEventListener('click', () => { session = null; openDeck(currentDeckId); });
  $('#typeInput').addEventListener('input', liveTypeEval);
  $('#typeInput').addEventListener('keydown', (e) => {
    // Enter reveals here; stopPropagation so the doc handler doesn't also grade + skip
    if (e.key === 'Enter' && !session.revealed) { e.preventDefault(); e.stopPropagation(); reveal(); }
  });

  // summary
  $('#studyAgain').addEventListener('click', startStudy);
  $('#summaryBack').addEventListener('click', () => openDeck(currentDeckId));

  // keyboard shortcuts during study
  document.addEventListener('keydown', (e) => {
    const s = session;
    if ($('#studyView').classList.contains('hidden') || !s) return;
    if (e.target.tagName === 'INPUT' && !s.revealed) return;
    // a-z picks an MC option before reveal
    if (s.mc && !s.revealed && /^[a-z]$/i.test(e.key)
        && s.mc.options.some((o) => o.label === e.key.toLowerCase())) {
      e.preventDefault(); toggleChoice(e.key.toLowerCase()); return;
    }
    if (!s.revealed) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
      return;
    }
    // revealed: MC/type just advance, flip takes a wrong/right verdict
    if (s.mc || s.mode === 'type') {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); grade(s.autoCorrect); }
    } else if (e.key === '2' || e.key === 'ArrowRight') { e.preventDefault(); grade(true); }
    else if (e.key === '1' || e.key === 'ArrowLeft') { e.preventDefault(); grade(false); }
  });

  // accordion: opening one home dropdown closes the other
  const dropdowns = [$('#samplePanel'), $('.format-help')].filter(Boolean);
  dropdowns.forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) dropdowns.forEach((other) => { if (other !== d) other.open = false; });
  }));

  // load decks before the first render so getDecks() can stay synchronous
  await initDeckStore();
  renderHome();
  loadSamples();
}

document.addEventListener('DOMContentLoaded', init);
