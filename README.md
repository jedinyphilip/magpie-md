# <img src="public/favicon.svg" width="22" height="22" alt="magpie.md logo" style="vertical-align: middle;"> magpie.md

A small static flashcard app that runs on [GitHub Pages](https://jedinyphilip.github.io/magpie-md/). No backend, no build step,
no dependencies (the math rendering loads KaTeX from a CDN).

The whole reason it exists: the default is the full deck, not some random
subset. Every session covers every card, unless you deliberately pick a
smaller batch.

### What you get

- **Full deck by default.** No SRS picking cards for you. Study every card, or
  opt into a smaller batch (your weakest cards, or a random sample) for a quick run.
- **Plain markdown decks.** Import and export them as `.md` files.
- **Multiple choice** with `a`/`b`/`c` options, single or multi answer.
- **Cloze deletions** with `{{...}}` (optional `::hint`), studied by recall or typed answer.
- **Forgiving typed answers.** Type-to-answer grading scores by similarity, so
  case, punctuation, accents and small typos don't count against you.
- **LaTeX math** via KaTeX: inline `$...$` and display `$$...$$`.
- **Images** by URL, relative path, or embedded as base64 inside the `.md`, plus raw inline `<svg>` drawings.
- **Import from Anki** by exporting *Notes in Plain Text*. It's converted to markdown on the way in.
- **Mobile friendly**, with controls you can reach with a thumb.
- **Edit in the app or your editor.** Tweak a deck right in the browser (paste an
  image and it embeds as base64), or edit the `.md` file and re-import.
- **Progress travels inside the markdown**: exporting bakes your stats into
  hidden comments, so you can move decks between devices or back them up.
- **Stored locally**: decks live in your browser (IndexedDB, so big embedded
  images fit), progress in `localStorage`. Nothing leaves your machine.

## What's new

- **Cloze deletions.** Hide words with `{{...}}` (and `{{answer::hint}}`). Study
  them by recall or by typing the missing word.
- **Anki import.** Drop in an Anki *Notes in Plain Text* export and it's converted
  to a normal markdown deck, cloze and basic formatting included.
- **Study a subset.** Keep the full deck by default, or pull a slider down to drill
  a smaller batch (weakest cards, random, or first N).
- **Embedded images.** `![](data:...)` base64 images are stored inside the `.md`,
  so a deck can travel as a single self-contained file.
- **Bigger storage.** Decks moved to IndexedDB, so embedded images no longer bump
  into the old ~5 MB localStorage ceiling (with a localStorage fallback).

## Deck format

```markdown
# Deck title

What is the capital of France?
---
**Paris**
===
2 + 2 = ?
---
4
```

`---` splits the front from the back, `===` separates cards, and the first
`# heading` becomes the deck title. The back (and front) can use markdown: bold,
italic, code, lists, links, images, quotes, and LaTeX math.

### Multiple choice

Put `a)`, `b)`, ... options (or `a.`, `b.`) on the front, and the correct
letter(s) on the *first line* of the back. Anything after that line shows up as an
explanation.

```markdown
Which of these are prime numbers?
a) 4
b) 5
c) 7
d) 9
---
b, c
4 is 2*2 and 9 is 3*3, so both are composite.
```

One correct letter means single-select. Several (like `b, c`) means multi-select.
Detection is automatic and only kicks in when the front has 2+ labeled options
*and* the back's first line is just those letters, so a normal card that happens
to use `a)`/`b)` won't be mistaken for one. Pick options by clicking or with the
`a`-`z` keys, then `Enter` or `Space` to check. Under the hood it's still an
ordinary card, so it imports and exports unchanged.

### Cloze deletions

Wrap the words to hide in `{{...}}`. The front shows the sentence with them
blanked. Revealing fills them in. Add a hint with `{{answer::hint}}`, and put any
extra context after `---`.

```markdown
The mitochondria is the {{powerhouse}} of the {{cell::organelle}}.
---
A favourite exam factoid.
```

In *Type answer* mode you type the missing word and it's graded by similarity like
any typed answer. In the other modes you reveal and self-grade. Anki's
`{{c1::...}}` group syntax is accepted too — a note with several groups becomes one
card per group, the same way Anki splits them.

### Importing from Anki

In Anki, **File → Export → Notes in Plain Text (`.txt`)**, then import or paste the
file here. magpie reads the tab/CSV export, converts the basic formatting (bold,
italics, line breaks, images, cloze) to markdown, and stores it as an ordinary deck
you can edit and re-export. `Front`/`Back` become the two faces, and cloze notes
stay cloze.

Media isn't included in that text export, so image and audio references won't
resolve unless you embed them yourself. Packaged `.apkg` files (a zipped database)
aren't supported — exporting as plain text keeps magpie dependency-free.

### Progress in exported files

`Export .md + progress` adds a hidden comment to each studied card:

```markdown
What is the capital of France?
---
**Paris**
<!-- magpie seen=4 correct=3 wrong=1 last=right ts=1717000000000 -->
===
```

It renders invisibly on GitHub and is read back when you import the file, which
restores your stats. Cards are matched by the text of their front, so editing a
back keeps the progress while editing a front starts that card fresh.

## Study options

**Mode.** *Flip & grade* shows the front, you reveal the back and mark yourself.
*Type answer* compares what you type to the answer by similarity instead of an
exact match: it ignores case, punctuation and accents and tolerates typos and
transpositions (Damerau-Levenshtein distance), updates live as you type, and flags
the result as match / close / no match. It only suggests a grade, you still
confirm. For multiple-choice cards in this mode, either the correct letter or the
option text is accepted.

**Order.** *Weighted* (unseen and previously-wrong cards first), *Shuffle*, or
*Original*.

**Cards.** *All* by default. Pick a number to study just that many. They come off
the top of the chosen order, so *Weighted* gives you the cards you know least,
*Shuffle* a random sample, and *Original* the first few.

**Keyboard.** `Space`/`Enter` reveals. `1` or Left marks wrong, `2` or Right marks
correct.

## Run it

Locally:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

On GitHub Pages: push this folder to a repo, then under
**Settings > Pages > Build from branch** pick your branch and `/ (root)`. The site
shows up at `https://<user>.github.io/<repo>/`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup / views (served from the repo root) |
| `public/css/styles.css` | Styling + light/dark theme |
| `public/js/app.js` | Entry point: fullscreen + init wiring (loaded last) |
| `public/js/src/` | App modules: `util`, `config`, `markdown`, `deck`, `samples`, `study`, `views` |
| `public/favicon.svg` | magpie icon (tab + header) |
| `public/decks/` | Sample decks (also embedded in `samples.js`) + your local decks |

The JS is plain classic scripts loaded in order (no bundler, no ES modules) so the
app also runs when opened directly as a `file://`.

## License

[GNU AGPL-3.0](LICENSE) © Philip Jediny

If you run a modified version as a network service, the AGPL requires you to
offer its source to users.
