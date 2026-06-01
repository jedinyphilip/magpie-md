'use strict';
// deck parsing, serializing, ordering, MC + cloze, Anki import

// progress comment. also accepts the old "anki" marker for decks from old builds.
const STAT_RE = /<!--\s*(?:magpie|anki)\s+([^>]*?)-->/i;

const FENCE_RE = /^\s*(```|~~~)/;
const isCardSep  = (l) => /^[ \t]*===[ \t]*$/.test(l);
const isFaceSep  = (l) => /^[ \t]*---[ \t]*$/.test(l);

function parseDeck(text) {
  const all = text.replace(/\r\n/g, '\n').split('\n');
  let title = 'Untitled deck';
  let start = 0;

  // first "# heading" is the title
  for (let i = 0; i < all.length; i++) {
    if (all[i].trim() === '') { start = i + 1; continue; }
    const m = all[i].match(/^#\s+(.+?)\s*$/);
    if (m) { title = m[1].trim(); start = i + 1; }
    break;
  }

  // split on === , but not inside a code fence
  const cards = [];
  let buf = [];
  let fence = false;
  const flush = () => { const c = buildCard(buf); if (c) cards.push(c); buf = []; };
  for (let i = start; i < all.length; i++) {
    const line = all[i];
    if (FENCE_RE.test(line)) fence = !fence;
    if (!fence && isCardSep(line)) { flush(); continue; }
    buf.push(line);
  }
  flush();
  return { title, cards };
}

function buildCard(lines) {
  let stats = null;
  const text = lines.join('\n');
  const sm = text.match(STAT_RE);
  if (sm) stats = parseStats(sm[1]);
  const clean = lines.filter((l) => !STAT_RE.test(l));

  // first --- outside a fence is the front/back split
  let fence = false, sep = -1;
  for (let i = 0; i < clean.length; i++) {
    if (FENCE_RE.test(clean[i])) fence = !fence;
    if (!fence && isFaceSep(clean[i])) { sep = i; break; }
  }
  const front = (sep === -1 ? clean : clean.slice(0, sep)).join('\n').trim();
  const back  = (sep === -1 ? [] : clean.slice(sep + 1)).join('\n').trim();
  if (!front && !back) return null;
  return { key: hash(front), front, back, stats };
}

function parseStats(s) {
  const out = { seen: 0, correct: 0, wrong: 0, last: '', ts: 0 };
  for (const m of s.matchAll(/(\w+)=("[^"]*"|\S+)/g)) {
    const k = m[1];
    let v = m[2].replace(/^"|"$/g, '');
    if (k in out) out[k] = /^\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}

function serializeDeck(deck, progress, includeProgress) {
  let out = `# ${deck.title}\n\n`;
  out += deck.cards.map((c) => {
    let block = `${c.front}\n---\n${c.back}`;
    const st = progress && progress[c.key];
    if (includeProgress && st && st.seen > 0) {
      block += `\n<!-- magpie seen=${st.seen} correct=${st.correct} wrong=${st.wrong}` +
               ` last=${st.last || 'none'} ts=${st.ts || 0} -->`;
    }
    return block;
  }).join('\n===\n');
  return out + '\n';
}

function getDecks() { return decksCache; }
function setDecks(d) { decksCache = d; persistDecks(d); }

function addDeckFromText(text) {
  // Anki TSV gets turned into markdown here, so what we store is still markdown
  if (looksLikeAnki(text)) text = ankiToMarkdown(text);
  const parsed = parseDeck(text);
  if (parsed.cards.length === 0) { alert('No cards found. Check the format (use --- and ===).'); return null; }
  const id = slug(parsed.title) + '-' + hash(parsed.title);
  const decks = getDecks();
  decks[id] = { title: parsed.title, source: text, addedAt: Date.now() };
  setDecks(decks);

  // merge embedded progress, keeping the newer record per card (by ts, then
  // review count) so an old import can't clobber fresher local progress.
  const prog = loadJSON(LS_PROGRESS(id), {});
  let changed = false;
  const newer = (a, b) => (a.ts || 0) !== (b.ts || 0)
    ? (a.ts || 0) > (b.ts || 0) : (a.seen || 0) > (b.seen || 0);
  for (const c of parsed.cards) {
    if (c.stats && (!prog[c.key] || newer(c.stats, prog[c.key]))) {
      prog[c.key] = c.stats; changed = true;
    }
  }
  if (changed) saveJSON(LS_PROGRESS(id), prog);
  return id;
}

function deckStats(id, parsed) {
  const prog = loadJSON(LS_PROGRESS(id), {});
  let seen = 0, mastered = 0, attempts = 0, correct = 0;
  for (const c of parsed.cards) {
    const st = prog[c.key];
    if (!st || !st.seen) continue;
    seen++;
    attempts += st.seen;
    correct += st.correct;
    if (st.correct >= 3 && st.last === 'right' && st.wrong <= st.correct) mastered++;
  }
  return {
    total: parsed.cards.length,
    seen, mastered,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
  };
}

// returns every card - the subset slice happens later in startStudy
function orderCards(cards, progress, order) {
  const arr = cards.slice();
  if (order === 'original') return arr;
  if (order === 'shuffle') return shuffle(arr);

  // weighted: unseen + recently-wrong float up, with some jitter
  return arr
    .map((c) => {
      const st = progress[c.key] || { seen: 0, correct: 0, wrong: 0, last: '' };
      let w;
      if (!st.seen) w = 3.0;
      else {
        const ratio = st.correct / st.seen;
        w = 1 + (1 - ratio) * 2 + (st.last === 'wrong' ? 1 : 0);
      }
      return { c, score: w * (0.6 + Math.random() * 0.8) };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// MC is just a way of reading a normal card: front has 2+ "a) ..." options and
// the back's first line is the correct letter(s) ("b" or "b, c"). Nothing
// special on disk, so MC decks import/export like any other.
const OPT_RE = /^\s*([a-zA-Z])[\)\.]\s+(.+?)\s*$/;

function parseChoices(card) {
  const options = [];
  const qLines = [];
  let started = false;
  for (const line of card.front.split('\n')) {
    const m = line.match(OPT_RE);
    if (m) { started = true; options.push({ label: m[1].toLowerCase(), text: m[2] }); }
    else if (!started) qLines.push(line);
    else if (line.trim() && options.length) options[options.length - 1].text += '\n' + line;
  }
  if (options.length < 2) return null;

  const labels = new Set(options.map((o) => o.label));
  const backLines = card.back.split('\n');
  const tokens = (backLines[0] || '').trim().toLowerCase().split(/[,\s/]+/).filter(Boolean);
  // Only an MC card if the back's first line is purely option letters.
  if (!tokens.length || !tokens.every((t) => t.length === 1 && labels.has(t))) return null;

  return {
    question: qLines.join('\n').trim(),
    options,
    correct: new Set(tokens),
    multi: tokens.length > 1,
    explanation: backLines.slice(1).join('\n').trim(),
  };
}

// Cloze, like MC, is read off a normal card: a front with {{...}} deletions.
// Accepts {{answer}}, {{answer::hint}}, and Anki's {{c1::answer}} (the cN group
// is ignored here - import already split groups into separate cards).
function parseCloze(card) {
  const src = card.front || '';
  if (!/\{\{.+?\}\}/.test(src)) return null;
  const answers = [], blanks = [], reveals = [];
  const template = src.replace(/\{\{(.+?)\}\}/g, (_, inner) => {
    const body = inner.replace(/^c\d+::/i, '');           // drop the cN prefix
    const parts = body.split('::');
    const answer = parts[0].trim();
    const hint = parts.length > 1 ? parts.slice(1).join('::').trim() : '';
    const i = answers.push({ text: answer, hint }) - 1;
    blanks[i] = `<span class="cloze">[${hint ? ' ' + escapeHtml(hint) + ' ' : ' … '}]</span>`;
    reveals[i] = `<span class="cloze">${escapeHtml(answer)}</span>`;
    return `@@CZ${i}@@`;
  });
  if (!answers.length) return null;
  return { template, answers, blanks, reveals };
}

// Convert an Anki "Notes in Plain Text" (TSV/CSV) export into markdown so it
// runs through parseDeck. Markdown stays the source of truth; .apkg (zip +
// sqlite) isn't handled.
function looksLikeAnki(text) {
  // these headers have a colon, so a markdown "# Deck title" won't match
  if (/^#(?:separator|html|columns|notetype|deck|tags|guid)\b.*:/im.test(text)) return true;
  if (text.includes('===') || text.includes('\n---')) return false;  // it's a magpie deck
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  return lines.length > 0 && lines.filter((l) => l.includes('\t')).length >= lines.length * 0.6;
}

function sepChar(val) {
  const map = { tab: '\t', comma: ',', semicolon: ';', space: ' ', pipe: '|', colon: ':' };
  return map[val.toLowerCase()] || (val.length === 1 ? val : '\t');
}

function htmlToMd(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p)>/gi, '\n')
    .replace(/<(?:div|p)[^>]*>/gi, '')
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<img[^>]*\bsrc\s*=\s*"([^"]*)"[^>]*>/gi, '![]($1)')
    .replace(/\[sound:[^\]]*\]/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0*39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

const firstIdx = (cols, names) => {
  for (const n of names) { const i = cols.indexOf(n); if (i >= 0) return i; }
  return -1;
};

function ankiToMarkdown(text) {
  const rows = text.replace(/\r\n/g, '\n').split('\n');
  let sep = '\t', html = false, columns = null;
  const metaCol = {};                                  // role -> 0-based col index
  const data = [];
  for (const line of rows) {
    if (line.startsWith('#')) {
      const m = line.match(/^#([^:]+):(.*)$/);
      if (m) {
        const key = m[1].trim().toLowerCase(), val = m[2].trim();
        if (key === 'separator') sep = sepChar(val);
        else if (key === 'html') html = /^true$/i.test(val);
        else if (key === 'columns') columns = val.split(sep).map((c) => c.trim().toLowerCase());
        else if (key.endsWith(' column')) metaCol[key.replace(/ column$/, '')] = parseInt(val, 10) - 1;
      }
      continue;
    }
    if (line.trim() !== '') data.push(line);
  }
  if (!data.length) return text;

  let frontIdx = -1, backIdx = -1, deckIdx = metaCol.deck ?? -1;
  if (columns) {
    frontIdx = firstIdx(columns, ['front', 'text', 'question']);
    backIdx = firstIdx(columns, ['back', 'extra', 'answer']);
    if (deckIdx < 0) deckIdx = columns.indexOf('deck');
  }
  const metaIdxs = new Set(Object.values(metaCol));

  let title = '';
  const cards = [];
  for (const row of data) {
    const fields = row.split(sep);
    let front, back;
    if (frontIdx >= 0) {
      front = fields[frontIdx]; back = backIdx >= 0 ? fields[backIdx] : '';
    } else {
      const content = fields.filter((_, i) => !metaIdxs.has(i));   // skip meta cols
      front = content[0]; back = content[1];
    }
    if (deckIdx >= 0 && fields[deckIdx] && !title) title = fields[deckIdx].split('::').pop().trim();
    front = (front || '').trim(); back = (back || '').trim();
    if (!front && !back) continue;
    if (html) { front = htmlToMd(front); back = htmlToMd(back); }
    if (/\{\{c\d+::/i.test(front)) cards.push(...expandCloze(front, back));
    else cards.push(back ? `${front}\n---\n${back}` : front);
  }
  return `# ${title || 'Imported deck'}\n\n` + cards.join('\n===\n') + '\n';
}

// One Anki cloze note can hold several groups (c1, c2, ...) and Anki makes one
// card per group. Mirror that: emit one block per group, with that group's
// deletions kept as {{...}} and the other groups revealed as plain text.
function expandCloze(text, extra) {
  const groups = [...new Set([...text.matchAll(/\{\{c(\d+)::/gi)].map((m) => m[1]))];
  if (!groups.length) return [extra ? `${text}\n---\n${extra}` : text];
  return groups.sort((a, b) => a - b).map((g) => {
    const t = text.replace(/\{\{c(\d+)::(.+?)\}\}/gi, (_, gn, body) =>
      gn === g ? `{{${body}}}` : body.split('::')[0]);
    return extra ? `${t}\n---\n${extra}` : t;
  });
}

