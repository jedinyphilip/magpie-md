'use strict';
// images: stored as Blobs next to their deck (store.js), and cards point at
// them with ![alt](media:<name>). Inline data: URIs are pulled out on the way
// in and put back on the way out, so an exported .md stays self-contained.

const MEDIA_PREFIX = 'media:';
const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
};
const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'image/bmp': 'bmp', 'image/avif': 'avif', 'image/x-icon': 'ico', 'image/tiff': 'tif',
};
const mimeFor = (name) => MIME_BY_EXT[(name.split('.').pop() || '').toLowerCase()] || '';

// names sit inside a markdown URL, which can't hold spaces or parens
const encodeMediaName = (name) => encodeURIComponent(name)
  .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function decodeMediaName(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}
const mediaRef = (name) => MEDIA_PREFIX + encodeMediaName(name);
// media:<name> -> name, anything else -> null
const refName = (url) => (url.startsWith(MEDIA_PREFIX) ? decodeMediaName(url.slice(MEDIA_PREFIX.length)) : null);

const IMG_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;    // the image syntax md2html renders

// Every name a deck's text points at. Loose on purpose: keeping an unused
// image is harmless, deleting a used one isn't.
function mediaNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/media:([^)\s"'<>]+)/g)) names.add(decodeMediaName(m[1]));
  return names;
}

// data:image/png;name=cat.png;base64,.... -> { type, name, b64 }
function parseDataUri(url) {
  const m = url.match(/^data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+=[^;,]*)*);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  const name = (m[2].match(/;name=([^;]*)/i) || [])[1];
  return { type: (m[1] || '').toLowerCase(), name: name ? decodeMediaName(name) : '', b64: m[3] };
}

// Pull ![..](data:...;base64,...) images out into Blobs. Named ones (magpie
// exports them as data:<type>;name=<file>;base64,...) keep their name, so an
// exported and re-imported deck gets back the same card text and card keys.
function extractInlineImages(text) {
  const media = new Map(), sums = new Map();   // name -> sha1 of its bytes
  const out = text.replace(IMG_MD_RE, (whole, alt, url) => {
    const d = parseDataUri(url);
    if (!d) return whole;
    let bytes;
    try { bytes = base64ToBytes(d.b64); } catch (e) { return whole; }
    const sum = sha1Hex(bytes);
    let name = d.name.replace(/[\\/]/g, '_').trim() || `img-${sum.slice(0, 12)}.${EXT_BY_MIME[d.type] || 'bin'}`;
    // same name, different picture: keep both
    if (sums.has(name) && sums.get(name) !== sum) name = name.replace(/(\.[^.]*)?$/, `-${sum.slice(0, 8)}$1`);
    sums.set(name, sum);
    media.set(name, new Blob([bytes], { type: d.type || mimeFor(name) }));
    return `![${alt}](${mediaRef(name)})`;
  });
  return { text: out, media };
}

// media: refs -> named data: URIs (the .md export and Copy)
async function inlineMedia(text, id) {
  if (!text.includes(MEDIA_PREFIX)) return text;
  return inlineMediaFrom(text, await loadMedia(id));
}

async function inlineMediaFrom(text, media) {
  const b64 = new Map();
  for (const m of text.matchAll(IMG_MD_RE)) {
    const name = refName(m[2]);
    if (name != null && media.has(name) && !b64.has(name)) {
      b64.set(name, bytesToBase64(new Uint8Array(await media.get(name).arrayBuffer())));
    }
  }
  return text.replace(IMG_MD_RE, (whole, alt, url) => {
    const name = refName(url);
    if (name == null || !b64.has(name)) return whole;
    const type = media.get(name).type || mimeFor(name) || 'application/octet-stream';
    return `![${alt}](data:${type};name=${encodeMediaName(name)};base64,${b64.get(name)})`;
  });
}

// Object URLs for the open deck. md2html is synchronous, so openDeck loads a
// deck's images up front and startStudy waits for them before rendering.
let shownMedia = { id: null, urls: new Map() };
let mediaReady = Promise.resolve();

function useDeckMedia(id) {
  if (shownMedia.id === id) return mediaReady;
  forgetShownMedia();
  const mine = shownMedia = { id, urls: new Map() };
  mediaReady = loadMedia(id).then((map) => {
    if (shownMedia !== mine) return;           // another deck was opened meanwhile
    for (const [name, blob] of map) mine.urls.set(name, URL.createObjectURL(blob));
  }).catch(() => {});
  return mediaReady;
}

function forgetShownMedia() {
  for (const url of shownMedia.urls.values()) URL.revokeObjectURL(url);
  shownMedia = { id: null, urls: new Map() };
}
function forgetDeckMedia(id) { if (shownMedia.id === id) forgetShownMedia(); }

const mediaUrl = (name) => shownMedia.urls.get(name) || '';
