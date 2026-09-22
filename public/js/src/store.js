'use strict';
// storage: one IndexedDB record per deck, and each deck's images as Blobs in a
// separate store, so deck text stays small and saving one deck doesn't rewrite
// the rest. An in-memory cache keeps getDecks() synchronous.
// Falls back to localStorage (decks only, images stay inline as base64) when
// IndexedDB is missing (some file:// setups).

const IDB_NAME = 'magpie';
const IDB_VERSION = 2;
const IDB_KV = 'kv';          // v1 kept every deck in one 'decks' value; migrated on open
const IDB_DECKS = 'decks';    // id -> { title, source, addedAt }
const IDB_MEDIA = 'media';    // [deckId, filename] -> Blob (or { type, bytes }, see blobsInIdb)
let idbDB = null;
let decksCache = {};
// Some browsers (Safari private windows) refuse Blobs in IndexedDB. Then images
// are stored as { type, bytes } instead, and turned back into Blobs on read.
let blobsInIdb = true;

const mediaEnabled = () => !!idbDB;
// every [deckId, *] key: [id] sorts before them and [id, []] after (arrays sort above strings)
const mediaRange = (id) => IDBKeyRange.bound([id], [id, []]);

function idbOpen() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
    let req;
    try { req = indexedDB.open(IDB_NAME, IDB_VERSION); }
    catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of [IDB_KV, IDB_DECKS, IDB_MEDIA]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // a newer version opened in another tab: step aside instead of blocking it
      db.onversionchange = () => { db.close(); alert('magpie was updated in another tab. Reload this one.'); };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    // an older tab still holds the database open; the upgrade resumes once it closes
    req.onblocked = () => alert('magpie is open in another tab. Close it to finish updating storage.');
  });
}

// Run fn(tx, out) in one transaction. Resolves with out.value once it commits.
function idbRun(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = idbDB.transaction(stores, mode); }
    catch (e) { return reject(e); }
    const out = {};
    tx.oncomplete = () => resolve(out.value);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
    try { fn(tx, out); }
    catch (e) { try { tx.abort(); } catch (_) { /* already finished */ } reject(e); }
  });
}

// Writes run one after another and reads wait for them, so a deck opened
// right after a save sees its new images (a write may need an async step first).
let writeQueue = Promise.resolve();
function queueWrite(fn) {
  const run = writeQueue.then(fn);
  writeQueue = run.catch(() => {});
  return run;
}

async function storableMedia(media) {
  if (!media || blobsInIdb) return media;
  const out = new Map();
  for (const [name, blob] of media) out.set(name, { type: blob.type, bytes: await blob.arrayBuffer() });
  return out;
}
const asBlob = (v) => (v instanceof Blob ? v : new Blob([v.bytes], { type: v.type }));

function idbReadAll(store, range, out) {
  const keys = store.getAllKeys(range), vals = store.getAll(range);
  vals.onsuccess = () => { out.value = keys.result.map((k, i) => [k, vals.result[i]]); };
}

// Populate the cache before first render; migrate older layouts once.
async function initDeckStore() {
  idbDB = await idbOpen();
  if (idbDB) {
    try {
      const rows = await idbRun([IDB_DECKS], 'readonly', (tx, out) => idbReadAll(tx.objectStore(IDB_DECKS), null, out));
      decksCache = Object.fromEntries(rows);
      blobsInIdb = await idbRun([IDB_MEDIA], 'readwrite', (tx) => {
        const store = tx.objectStore(IDB_MEDIA);
        store.put(new Blob(['probe']), ['', 'probe']);
        store.delete(['', 'probe']);
      }).then(() => true, () => false);
      await migrateLegacyDecks();
      return;
    } catch (e) { idbDB = null; }
  }
  decksCache = loadJSON(LS_DECKS, {});
}

// v1 kept all decks in one kv value (v0 in localStorage) with images inline as
// base64. Give each deck its own record and pull its images out as Blobs.
// That rewrites image URLs inside cards, which changes card keys, so progress
// is first copied onto the new keys (cards keep their position). The old keys
// are left behind: nothing reads them, and a failed move still needs them.
async function migrateLegacyDecks() {
  let legacy = null, fromLS = false;
  try {
    legacy = await idbRun([IDB_KV], 'readonly', (tx, out) => {
      tx.objectStore(IDB_KV).get('decks').onsuccess = (e) => { out.value = e.target.result; };
    });
  } catch (e) { legacy = null; }
  if (!legacy || !Object.keys(legacy).length) { legacy = loadJSON(LS_DECKS, {}); fromLS = true; }
  const ids = Object.keys(legacy).filter((id) => !decksCache[id]);

  const moved = {};
  for (const id of ids) {
    const ex = extractInlineImages(legacy[id].source);
    copyProgressKeys(id, legacy[id].source, ex.text);
    moved[id] = { rec: Object.assign({}, legacy[id], { source: ex.text }), media: await storableMedia(ex.media) };
  }
  const write = (withMedia) => idbRun([IDB_KV, IDB_DECKS, IDB_MEDIA], 'readwrite', (tx) => {
    const decks = tx.objectStore(IDB_DECKS), media = tx.objectStore(IDB_MEDIA);
    for (const id of ids) {
      decks.put(withMedia ? moved[id].rec : legacy[id], id);
      if (withMedia) for (const [name, value] of moved[id].media) media.put(value, [id, name]);
    }
    tx.objectStore(IDB_KV).delete('decks');
  });

  let written = true;
  try {
    await write(true);
    for (const id of ids) decksCache[id] = moved[id].rec;
  } catch (e) {
    // e.g. quota: move the decks as they were (same size as before), images inline
    try { await write(false); }
    catch (e2) {
      written = false;
      alert('Could not move your decks to the new storage layout. They are loaded, but changes may not save.');
    }
    for (const id of ids) decksCache[id] = legacy[id];
  }
  // the localStorage copy goes only once IndexedDB holds the decks
  if (fromLS && written && Object.keys(legacy).length) localStorage.removeItem(LS_DECKS);
}

// Card keys hash the front, so rewriting image URLs gives new keys. Copy each
// card's progress to its new key by position.
function copyProgressKeys(id, oldSource, newSource) {
  if (oldSource === newSource) return;
  const before = parseDeck(oldSource).cards, after = parseDeck(newSource).cards;
  if (before.length !== after.length) return;
  const prog = loadJSON(LS_PROGRESS(id), {});
  let changed = false;
  before.forEach((c, i) => {
    const k = after[i].key;
    if (prog[c.key] && k !== c.key && !prog[k]) { prog[k] = prog[c.key]; changed = true; }
  });
  if (changed) saveJSON(LS_PROGRESS(id), prog);
}

function getDecks() { return decksCache; }

// Save one deck, add any new images (name -> Blob) and drop the images its
// text no longer points at. Resolves to false (after telling the user) on failure.
function saveDeck(id, rec, media) {
  decksCache[id] = rec;
  forgetDeckMedia(id);
  if (!idbDB) {
    try { saveJSON(LS_DECKS, decksCache); return Promise.resolve(true); }
    catch (e) {
      alert('Could not save this deck. Browser storage here is limited to about 5 MB; large embedded images may have exceeded it.');
      return Promise.resolve(false);
    }
  }
  const used = mediaNames(rec.source);
  return queueWrite(async () => {
    const stored = await storableMedia(media);
    return idbRun([IDB_DECKS, IDB_MEDIA], 'readwrite', (tx) => {
      tx.objectStore(IDB_DECKS).put(rec, id);
      const store = tx.objectStore(IDB_MEDIA);
      if (stored) for (const [name, value] of stored) if (used.has(name)) store.put(value, [id, name]);
      store.getAllKeys(mediaRange(id)).onsuccess = (e) => {
        for (const key of e.target.result) if (!used.has(key[1])) store.delete(key);
      };
    });
  }).then(() => true, () => {
    alert('Could not save to storage. It may be full - images use a lot of space.');
    return false;
  });
}

// deck, its images and its progress
function removeDeck(id) {
  delete decksCache[id];
  forgetDeckMedia(id);
  localStorage.removeItem(LS_PROGRESS(id));
  if (!idbDB) {
    try { saveJSON(LS_DECKS, decksCache); } catch (e) { /* removing only shrinks it */ }
    return Promise.resolve();
  }
  return queueWrite(() => idbRun([IDB_DECKS, IDB_MEDIA], 'readwrite', (tx) => {
    tx.objectStore(IDB_DECKS).delete(id);
    tx.objectStore(IDB_MEDIA).delete(mediaRange(id));
  })).catch(() => {});
}

// name -> Blob for one deck
function loadMedia(id) {
  if (!idbDB) return Promise.resolve(new Map());
  return writeQueue
    .then(() => idbRun([IDB_MEDIA], 'readonly', (tx, out) => idbReadAll(tx.objectStore(IDB_MEDIA), mediaRange(id), out)))
    .then((rows) => new Map(rows.map(([key, value]) => [key[1], asBlob(value)])));
}

// Ask once per session for storage the browser won't evict under pressure.
// Firefox shows a prompt, so this only runs after the user imports something.
let persistAsked = false;
function requestPersistence() {
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
  persistAsked = true;
  navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
}
