'use strict';
// dom + storage helpers

const LS_DECKS    = 'magpie.decks.v1';
const LS_PROGRESS = (id) => `magpie.prog.${id}`;
const LS_SETTINGS = 'magpie.settings.v1';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function hash(str) {            // djb2, base36
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deck';
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// Decks can hold base64 images that bust localStorage's ~5MB, so they live in
// IndexedDB behind an in-memory cache (keeps getDecks/setDecks synchronous).
// Falls back to localStorage when IndexedDB is missing (some file:// setups).
const IDB_NAME = 'magpie';
const IDB_STORE = 'kv';
const IDB_DECKS_KEY = 'decks';
let idbDB = null;
let decksCache = {};

function idbOpen() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); }
    catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}
function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbSet(db, key, val) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Populate the cache before first render; migrate old localStorage decks once.
async function initDeckStore() {
  idbDB = await idbOpen();
  if (idbDB) {
    let stored = null;
    try { stored = await idbGet(idbDB, IDB_DECKS_KEY); } catch (e) { stored = null; }
    if (!stored || Object.keys(stored).length === 0) {
      const legacy = loadJSON(LS_DECKS, {});
      if (Object.keys(legacy).length) {
        stored = legacy;
        try { await idbSet(idbDB, IDB_DECKS_KEY, legacy); localStorage.removeItem(LS_DECKS); }
        catch (e) { /* keep the localStorage copy if the move fails */ }
      }
    }
    decksCache = stored || {};
  } else {
    decksCache = loadJSON(LS_DECKS, {});
  }
}

function persistDecks(d) {
  if (idbDB) {
    idbSet(idbDB, IDB_DECKS_KEY, d).catch(() =>
      alert('Could not save to storage. It may be full - large embedded images use a lot of space.'));
  } else {
    try { saveJSON(LS_DECKS, d); }
    catch (e) {
      alert('Could not save this deck. Browser storage here is limited to about 5 MB; large embedded images may have exceeded it.');
    }
  }
}

