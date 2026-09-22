'use strict';
// Anki .apkg import + export. An .apkg is a zip holding a SQLite collection,
// the media files (named 0, 1, 2, ...) and a 'media' index of their real names.
// Anki 2.1.50+ packages zstd-compress all of it and write that index as
// protobuf. SQLite (sql.js) and zstd (fzstd) are vendored in public/vendor and
// only loaded when an .apkg is imported or exported.

const VENDOR = 'public/vendor/';

const loadedScripts = {};
function loadScript(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loadedScripts[src]; reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  return loadedScripts[src];
}

// The wasm is embedded as base64 in a script: fetch() can't read a file:// URL,
// but a <script> tag can, so this still works when index.html is opened directly.
let sqlReady = null;
function loadSql() {
  if (!sqlReady) {
    sqlReady = Promise.all([loadScript(VENDOR + 'sql-wasm.js?v=6'), loadScript(VENDOR + 'sql-wasm-binary.js?v=6')])
      .then(() => initSqlJs({ wasmBinary: base64ToBytes(MAGPIE_SQL_WASM) }))
      .catch((e) => { sqlReady = null; throw e; });
  }
  return sqlReady;
}

const isZstd = (b) => b.length >= 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
async function unzstd(bytes) {
  await loadScript(VENDOR + 'fzstd.js?v=6');
  return fzstd.decompress(bytes);
}

// ---- zip

// name -> { method, csize, usize, off } from the central directory
function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("it isn't a zip file");
  let count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  if ((cdOff === 0xffffffff || count === 0xffff) && eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = Number(dv.getBigUint64(eocd - 12, true));      // zip64 end record
    count = Number(dv.getBigUint64(z64 + 32, true));
    cdOff = Number(dv.getBigUint64(z64 + 48, true));
  }
  const entries = new Map(), utf8 = new TextDecoder();
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('the zip is damaged');
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), off = dv.getUint32(p + 42, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const name = utf8.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // zip64 extra field: holds only the values maxed out above, in this order
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; e += 4 + dv.getUint16(e + 2, true)) {
      if (dv.getUint16(e, true) !== 1) continue;
      let q = e + 4;
      if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
      if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
      if (off === 0xffffffff) off = Number(dv.getBigUint64(q, true));
    }
    entries.set(name, { method, csize, usize, off });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function zipEntryBytes(buf, entry) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(entry.off, true) !== 0x04034b50) throw new Error('the zip is damaged');
  const start = entry.off + 30 + dv.getUint16(entry.off + 26, true) + dv.getUint16(entry.off + 28, true);
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error(`unsupported zip compression (method ${entry.method})`);
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser is too old to unzip files');
  return pipeBytes(data, new DecompressionStream('deflate-raw'));
}

async function pipeBytes(data, transform) {
  const stream = new Blob([data]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// [{ name, data: Uint8Array, compress }] -> zip Blob. Deflates when the
// browser has CompressionStream, otherwise stores. No zip64.
async function writeZip(files) {
  const parts = [], central = [], utf8 = new TextEncoder();
  let offset = 0, cdSize = 0;
  for (const f of files) {
    const name = utf8.encode(f.name), crc = crc32(f.data);
    let data = f.data, method = 0;
    if (f.compress && typeof CompressionStream !== 'undefined') {
      try {
        const z = await pipeBytes(f.data, new CompressionStream('deflate-raw'));
        if (z.length < data.length) { data = z; method = 8; }
      } catch (e) { /* store it */ }
    }
    if (offset + data.length > 0xfffffff0) throw new Error('the deck is too big for an .apkg (over 4 GB)');
    // local header (30 bytes) and central directory record (46 bytes);
    // flag 0x0800 = UTF-8 names, date 0x21 = 1980-01-01
    const lh = new DataView(new ArrayBuffer(30)), cd = new DataView(new ArrayBuffer(46));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    parts.push(lh, name, data);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
    cdSize += 46 + name.length;
  }
  if (files.length > 0xffff) throw new Error('the deck has too many images for an .apkg');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

// ---- protobuf: just enough to read Anki's media index and note type configs.
// field number -> list of values (varints as numbers, length-delimited as bytes)
function readProto(bytes) {
  const out = {};
  let i = 0;
  const varint = () => {
    let v = 0, mul = 1, b;
    do { b = bytes[i++]; v += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
    return v;
  };
  while (i < bytes.length) {
    const key = varint(), field = Math.floor(key / 8), type = key % 8;
    let val;
    if (type === 0) val = varint();
    else if (type === 2) { const len = varint(); val = bytes.subarray(i, i + len); i += len; }
    else if (type === 1) { i += 8; continue; }
    else if (type === 5) { i += 4; continue; }
    else throw new Error("it has Anki data magpie can't read");
    (out[field] = out[field] || []).push(val);
  }
  return out;
}
const protoStr = (msg, field) => (msg[field] ? new TextDecoder().decode(msg[field][0]) : '');

// ---- import

function sqlRows(db, sql) {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

// filename -> zip entry name. Older packages keep a JSON map; the latest
// (zstd) format has a protobuf MediaEntries whose i-th entry is zip entry "i".
async function readMediaIndex(buf, zip) {
  const files = new Map();
  if (!zip.has('media')) return files;
  const raw = await zipEntryBytes(buf, zip.get('media'));
  if (isZstd(raw)) {
    (readProto(await unzstd(raw))[1] || []).forEach((bytes, i) => {
      const e = readProto(bytes);          // name = 1, legacy_zip_filename = 255
      if (e[1]) files.set(protoStr(e, 1), String(e[255] ? e[255][0] : i));
    });
  } else {
    const map = JSON.parse(new TextDecoder().decode(raw) || '{}');
    for (const [zipName, name] of Object.entries(map)) files.set(name, zipName);
  }
  return files;
}

// note types (field names, templates, cloze or not) and deck paths, from
// either the newer schema (tables + protobuf) or the older one (JSON in col)
function readAnkiSchema(db) {
  const models = new Map(), decks = new Map();
  if (sqlRows(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notetypes'").length) {
    for (const r of sqlRows(db, 'SELECT id, name, config FROM notetypes')) {
      const kind = (readProto(r.config || new Uint8Array())[1] || [0])[0];     // Config.kind: 1 = cloze
      models.set(String(r.id), { cloze: kind === 1, fields: [], tmpls: [] });
    }
    // these tables also hold rows for note types that aren't in the package
    for (const r of sqlRows(db, 'SELECT ntid, name FROM fields ORDER BY ntid, ord')) {
      const m = models.get(String(r.ntid));
      if (m) m.fields.push(r.name);
    }
    for (const r of sqlRows(db, 'SELECT ntid, config FROM templates ORDER BY ntid, ord')) {
      const m = models.get(String(r.ntid)), cfg = readProto(r.config || new Uint8Array());
      if (m) m.tmpls.push({ qfmt: protoStr(cfg, 1), afmt: protoStr(cfg, 2) });
    }
    for (const r of sqlRows(db, 'SELECT id, name FROM decks')) decks.set(String(r.id), r.name.split('\x1f'));
  } else {
    const col = sqlRows(db, 'SELECT models, decks FROM col')[0];
    if (!col) throw new Error("it doesn't look like an Anki collection");
    const byOrd = (a, b) => a.ord - b.ord;
    for (const [id, m] of Object.entries(JSON.parse(col.models || '{}'))) {
      models.set(String(id), {
        cloze: m.type === 1,
        fields: m.flds.slice().sort(byOrd).map((f) => f.name),
        tmpls: m.tmpls.slice().sort(byOrd).map((t) => ({ qfmt: t.qfmt, afmt: t.afmt })),
      });
    }
    for (const [id, d] of Object.entries(JSON.parse(col.decks || '{}'))) decks.set(String(id), d.name.split('::'));
  }
  return { models, decks };
}

// The active cloze group becomes a magpie {{answer::hint}} blank; the other
// groups read as plain text.
function clozeFor(html, n) {
  return html.replace(/\{\{c(\d+)::([\s\S]*?)\}\}/gi, (_, g, body) =>
    (Number(g) === n ? `{{${body}}}` : body.split('::')[0]));
}

// Enough of Anki's template language for card faces: {{Field}}, filters
// (cloze:, text:, type:, hint:, tts), {{#Field}}/{{^Field}} sections and
// {{FrontSide}}. FrontSide is left off the back, since magpie shows the
// front above the answer anyway; same for the cloze text on the back.
function renderAnkiTemplate(tmpl, ctx, front) {
  const value = (name) => {
    if (ctx.fields.has(name)) return ctx.fields.get(name);
    if (name === 'Tags') return ctx.tags;
    if (name === 'Deck') return ctx.deckPath.join('::');
    if (name === 'Subdeck') return ctx.deckPath[ctx.deckPath.length - 1];
    return '';                         // FrontSide, Card, CardFlag, Type, unknown fields
  };
  const filled = (name) => {
    const v = value(name);
    return /<img\b/i.test(v) || v.replace(/<[^>]*>|&nbsp;/gi, '').trim() !== '';
  };
  // sections, innermost first
  const SECTION = /\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g;
  let out = tmpl, prev;
  do {
    prev = out;
    out = out.replace(SECTION, (_, kind, name, body) => (filled(name) === (kind === '#') ? body : ''));
  } while (out !== prev);
  out = out.replace(/\{\{[#^/][^}]*\}\}/g, '');             // unbalanced leftovers
  out = out.replace(/\{\{([^{}]+?)\}\}/g, (_, tag) => {
    const parts = tag.split(':').map((p) => p.trim());
    const name = parts.pop();
    const filters = parts.map((f) => f.toLowerCase());
    if (filters.some((f) => f === 'type' || f === 'hint' || f === 'cloze-only' || f.startsWith('tts'))) return '';
    if (filters.includes('cloze')) return front ? clozeFor(value(name), ctx.cloze) : '';
    const v = value(name);
    return filters.includes('text') ? v.replace(/<[^>]*>/g, '') : v;
  });
  return out.replace(/<hr[^>]*\bid\s*=\s*["']?answer\b["']?[^>]*>/gi, '');
}

function ankiHtmlToMd(html, resolveImg) {
  html = html.replace(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
    (_, a, b, c) => `<img src="${resolveImg(decodeEntities(a ?? b ?? c))}">`);
  // newlines in a template are only whitespace in HTML
  let md = htmlToMd(html.replace(/\s*\n\s*/g, ' ')).replace(/^[ \t]+/gm, '');
  // an unclosed ``` would swallow the card separators after it
  const fences = md.match(/^\s*(```|~~~)/gm);
  if (fences && fences.length % 2) md = md.replace(/^(\s*)(```|~~~)/gm, '$1\u200b$2');
  return md;
}

function ankiCardToMd(model, values, ord, ctx, resolveImg) {
  const tmpl = model.cloze ? model.tmpls[0] : model.tmpls[ord];
  if (!tmpl) return null;
  ctx = Object.assign({}, ctx, { fields: new Map(model.fields.map((n, i) => [n, values[i] || ''])), cloze: ord + 1 });
  const front = ankiHtmlToMd(renderAnkiTemplate(tmpl.qfmt, ctx, true), resolveImg);
  // a cloze card whose group was deleted has no blank left (Anki's "empty card")
  if (!front || (model.cloze && !/\{\{.+?\}\}/.test(front))) return null;
  const back = ankiHtmlToMd(renderAnkiTemplate(tmpl.afmt, ctx, false), resolveImg);
  return back ? `${front}\n---\n${back}` : front;
}

// One markdown deck per top-level Anki deck (subdecks merged in, grouped
// together). Its title is the deepest deck path all its cards share, so an
// export of just "Spanish::Verbs" comes back titled that.
function ankiCollectionToMarkdown(db, packageFiles) {
  const { models, decks } = readAnkiSchema(db);
  const rows = sqlRows(db, `SELECT c.ord, CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END AS did, n.mid, n.flds, n.tags
    FROM cards c JOIN notes n ON n.id = c.nid ORDER BY n.id, c.ord`);
  const groups = new Map();
  for (const r of rows) {
    const model = models.get(String(r.mid));
    if (!model) continue;
    const deckPath = decks.get(String(r.did)) || ['Imported deck'];
    const images = new Set();
    const resolveImg = (src) => {
      for (const name of [src, decodeMediaName(src)]) {
        if (packageFiles.has(name)) { images.add(name); return mediaRef(name); }
      }
      return src.replace(/[ "]/g, (c) => (c === ' ' ? '%20' : '%22'));
    };
    const md = ankiCardToMd(model, r.flds.split('\x1f'), r.ord, { deckPath, tags: (r.tags || '').trim() }, resolveImg);
    if (!md) continue;
    if (!groups.has(deckPath[0])) groups.set(deckPath[0], { title: deckPath, cards: [], images: new Set() });
    const g = groups.get(deckPath[0]);
    let n = 0;
    while (n < g.title.length && n < deckPath.length && g.title[n] === deckPath[n]) n++;
    g.title = g.title.slice(0, n);
    g.cards.push({ path: deckPath.join('\x1f'), md });
    images.forEach((name) => g.images.add(name));
  }
  return [...groups.values()].map((g) => {
    g.cards.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));   // stable: keeps note order
    const title = g.title.join('::').replace(/\s+/g, ' ').trim() || 'Imported deck';
    return { markdown: `# ${title}\n\n` + g.cards.map((c) => c.md).join('\n===\n') + '\n', images: g.images };
  });
}

// .apkg/.colpkg File -> ids of the decks it became
async function importApkg(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const zip = readZip(buf);
  const colName = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => zip.has(n));
  if (!colName) throw new Error('there is no Anki collection in it');
  let colBytes = await zipEntryBytes(buf, zip.get(colName));
  if (isZstd(colBytes)) colBytes = await unzstd(colBytes);
  const files = await readMediaIndex(buf, zip);
  const SQL = await loadSql();
  const db = new SQL.Database(colBytes);
  let groups;
  try { groups = ankiCollectionToMarkdown(db, files); }
  finally { db.close(); }

  const ids = [];
  for (const g of groups) {
    const media = new Map();
    for (const name of g.images) {
      const entry = zip.get(files.get(name));
      if (!entry) continue;
      let bytes = await zipEntryBytes(buf, entry);
      if (isZstd(bytes)) bytes = await unzstd(bytes);
      media.set(name, new Blob([bytes], { type: mimeFor(name) }));
    }
    // without IndexedDB (localStorage) images have to stay inline
    const text = mediaEnabled() ? g.markdown : await inlineMediaFrom(g.markdown, media);
    const id = storeDeck(text, mediaEnabled() ? media : null);
    if (id) ids.push(id);
  }
  if (!ids.length) throw new Error('no cards found in it');
  return ids;
}

// ---- export: the older schema-11 collection.anki2 that every Anki version
// imports (the layout genanki writes). Cards arrive as new cards.

const ANKI_SCHEMA_11 = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);`;

// fixed ids, so re-exporting reuses the same note types in Anki
const ANKI_BASIC_ID = 1700000000101;
const ANKI_CLOZE_ID = 1700000000102;
const ANKI_CSS = `.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }
img { max-width: 100%; height: auto; }
.cloze { font-weight: bold; color: blue; }
.nightMode .cloze { color: lightblue; }`;
const ANKI_LATEX_PRE = '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n'
  + '\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';
const ANKI_DCONF = {
  1: {
    autoplay: true, id: 1, maxTaken: 60, mod: 0, name: 'Default', replayq: true, timer: 0, usn: 0,
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
  },
};

// what Anki sorts and dedupes on: text without tags, image names kept
const ankiPlain = (html) => decodeEntities(html.replace(/<img[^>]*?src="([^"]*)"[^>]*>/gi, ' $1 ').replace(/<[^>]*>/g, '')).trim();

async function exportApkg(id) {
  const deck = getDecks()[id];
  if (!deck) return;
  // images still inline in the text (the localStorage fallback) go in the package too
  const ex = extractInlineImages(deck.source);
  const media = new Map([...(await loadMedia(id)), ...ex.media]);
  const parsed = parseDeck(ex.text);

  const used = new Map();              // filename -> Blob, only what the cards show
  const toHtml = (md) => md2html(md, {
    math: (tex, display) => escapeHtml(display ? `\\[${tex}\\]` : `\\(${tex}\\)`),   // Anki's MathJax
    img: (alt, url) => {
      const name = refName(url);
      if (name == null || !media.has(name)) return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
      used.set(name, media.get(name));
      return `<img src="${escapeHtml(name)}" alt="${escapeHtml(alt)}">`;
    },
  }).replace(/\x1f/g, '');

  const now = Date.now(), secs = Math.floor(now / 1000);
  const deckId = parseInt(sha1Hex('magpie-deck:' + id).slice(0, 10), 16) + 2;   // stable, never 1 (Default)
  const notes = [], guids = new Set();
  let usesBasic = false, usesCloze = false;
  for (const card of parsed.cards) {
    const cloze = !!parseCloze(card);
    const fields = cloze
      // every blank of a magpie cloze card is shown at once, so they're all c1
      ? [toHtml(card.front.replace(/\{\{(?:c\d+::)?(.+?)\}\}/g, '{{c1::$1}}')), toHtml(card.back)]
      : [toHtml(card.front), toHtml(card.back)];
    // stable guid, so re-importing into Anki updates these notes instead of duplicating them
    let guid = 'mp' + sha1Hex(id + '\x1f' + card.front).slice(0, 14);
    for (let n = 2; guids.has(guid); n++) guid = 'mp' + sha1Hex(id + '\x1f' + card.front + '\x1f' + n).slice(0, 14);
    guids.add(guid);
    notes.push({ mid: cloze ? ANKI_CLOZE_ID : ANKI_BASIC_ID, fields, guid });
    if (cloze) usesCloze = true; else usesBasic = true;
  }

  const model = (mid, name, type, fieldNames, qfmt, afmt) => ({
    id: mid, name, type, mod: secs, usn: -1, sortf: 0, did: deckId, tags: [], vers: [],
    css: ANKI_CSS, latexPre: ANKI_LATEX_PRE, latexPost: '\\end{document}', latexsvg: false, req: [[0, 'any', [0]]],
    flds: fieldNames.map((f, ord) => ({ name: f, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
    tmpls: [{ name: type ? 'Cloze' : 'Card 1', ord: 0, qfmt, afmt, did: null, bqfmt: '', bafmt: '', bfont: '', bsize: 0 }],
  });
  const models = {};
  if (usesBasic) {
    models[ANKI_BASIC_ID] = model(ANKI_BASIC_ID, 'magpie Basic', 0, ['Front', 'Back'],
      '{{Front}}', '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}');
  }
  if (usesCloze) {
    models[ANKI_CLOZE_ID] = model(ANKI_CLOZE_ID, 'magpie Cloze', 1, ['Text', 'Back Extra'],
      '{{cloze:Text}}', '{{cloze:Text}}<br>\n{{Back Extra}}');
  }
  const deckJson = (did, name) => ({
    id: did, name, mod: secs, usn: -1, desc: '', dyn: 0, conf: 1, collapsed: false, extendNew: 10, extendRev: 50,
    lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
  });
  const conf = {
    activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: String(usesBasic ? ANKI_BASIC_ID : ANKI_CLOZE_ID),
    dueCounts: true, estTimes: true, newBury: true, newSpread: 0, nextPos: notes.length + 1,
    sortBackwards: false, sortType: 'noteFld', timeLim: 0,
  };

  const SQL = await loadSql();
  const db = new SQL.Database();
  let colBytes;
  try {
    db.exec(ANKI_SCHEMA_11);
    db.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [
      secs - (secs % 86400), now, now, JSON.stringify(conf), JSON.stringify(models),
      JSON.stringify({ 1: deckJson(1, 'Default'), [deckId]: deckJson(deckId, parsed.title) }),
      JSON.stringify(ANKI_DCONF), '{}',
    ]);
    db.exec('BEGIN');
    const addNote = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, -1, \'\', ?, ?, ?, 0, \'\')');
    const addCard = db.prepare('INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, \'\')');
    notes.forEach((n, i) => {
      const plain = ankiPlain(n.fields[0]);
      addNote.run([now + i, n.guid, n.mid, secs, n.fields.join('\x1f'), plain, parseInt(sha1Hex(plain).slice(0, 8), 16)]);
      addCard.run([now + i, now + i, deckId, secs, i + 1]);
    });
    addNote.free(); addCard.free();
    db.exec('COMMIT');
    colBytes = db.export();
  } finally { db.close(); }

  const files = [{ name: 'collection.anki2', data: colBytes, compress: true }];
  const index = {};
  [...used.keys()].forEach((name, i) => { index[i] = name; });
  files.push({ name: 'media', data: new TextEncoder().encode(JSON.stringify(index)), compress: true });
  let i = 0;
  for (const blob of used.values()) {
    // photos are already compressed; svg and the like aren't
    files.push({ name: String(i++), data: new Uint8Array(await blob.arrayBuffer()), compress: !/^image\/(png|jpeg|gif|webp|avif)$/.test(blob.type) });
  }
  downloadBlob(await writeZip(files), slug(parsed.title) + '.apkg');
}
