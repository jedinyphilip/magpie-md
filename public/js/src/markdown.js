'use strict';
// small markdown -> html for card faces

function renderMath(tex, display) {
  try {
    if (window.katex) return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false });
  } catch (e) { /* no katex (offline): show the raw source */ }
  const d = display ? '$$' : '$';
  return `<code>${escapeHtml(d + tex + d)}</code>`;
}

// opts.math(tex, display) and opts.img(alt, url) override how math and images
// come out (the .apkg export wants MathJax delimiters and plain filenames).
function md2html(src, opts = {}) {
  if (!src) return '';
  const codeBlocks = [];
  const math = [];
  const keep = (html) => '@@M' + (math.push(html) - 1) + '@@';
  const mathHtml = opts.math || renderMath;
  const imgHtml = opts.img || cardImg;
  // fenced code
  src = src.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code.replace(/^\n/, ''));
    return `@@CODE${codeBlocks.length - 1}@@`;
  });

  // pull out <svg> before math (so a $ inside it isn't read as LaTeX) and
  // before escaping. code fences are already stashed, so ```<svg>``` stays text.
  const svgs = [];
  src = src.replace(/<svg\b[\s\S]*?<\/svg>/gi, (m) =>
    '@@SVG' + (svgs.push(sanitizeSvg(m)) - 1) + '@@');

  // math: $$ \[ display, $ \( inline. stashed so markdown leaves it alone.
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => keep(mathHtml(tex, true)));
  src = src.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => keep(mathHtml(tex, true)));
  src = src.replace(/\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$/g, (_, tex) => keep(mathHtml(tex, false)));
  src = src.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => keep(mathHtml(tex, false)));

  // stash images too - keeps a base64 data: src out of the emphasis/link passes
  // (a _ or / in the payload would otherwise get mangled).
  const imgs = [];
  src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
    '@@IMG' + (imgs.push(imgHtml(alt, url)) - 1) + '@@');

  const lines = src.split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

  for (let line of lines) {
    if (line.trim() === '') { closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

    if (/^\s*>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); html += '<hr/>'; continue; }

    // bullets only - "1. text" stays a paragraph so years/dates keep their number
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (!inList) { closeList(); html += '<ul>'; inList = true; } html += `<li>${inline(ul[1])}</li>`; continue; }

    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();

  html = html.replace(/@@CODE(\d+)@@/g, (_, i) =>
    `<pre><code>${escapeHtml(codeBlocks[Number(i)])}</code></pre>`);
  html = html.replace(/@@M(\d+)@@/g, (_, i) => math[Number(i)]);
  html = html.replace(/@@IMG(\d+)@@/g, (_, i) => imgs[Number(i)]);
  html = html.replace(/@@SVG(\d+)@@/g, (_, i) => svgs[Number(i)]);
  return html;
}

// media:<name> points at an image stored with the deck (see media.js)
function cardImg(alt, url) {
  const name = refName(url);
  const src = name == null ? url : mediaUrl(name);
  return `<img class="md-img" loading="lazy" alt="${escapeHtml(alt)}" src="${escapeHtml(src)}"/>`;
}

// strip script / on*= handlers / javascript: links from svg. not bulletproof,
// just the obvious vectors for an imported deck.
function sanitizeSvg(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/((?:xlink:)?href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '');
}

function inline(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
  return s;
}

