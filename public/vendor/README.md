# Vendored libraries

Loaded only when an Anki `.apkg` is imported or exported (see `public/js/src/apkg.js`).

| File | Source | License |
|------|--------|---------|
| `sql-wasm.js` | [sql.js](https://github.com/sql-js/sql.js) 1.14.2, `dist/sql-wasm-browser.js` | MIT, `LICENSE-sqljs.txt` |
| `sql-wasm-binary.js` | sql.js 1.14.2, `dist/sql-wasm-browser.wasm` as base64 | MIT, `LICENSE-sqljs.txt` |
| `fzstd.js` | [fzstd](https://github.com/101arrowz/fzstd) 0.1.1, `umd/index.js` | MIT, `LICENSE-fzstd.txt` |

The wasm is wrapped in a script so the app still works when `index.html` is
opened as a `file://` page, where browsers refuse to `fetch()` a `.wasm` file.

To update, from an empty directory:

```bash
npm pack sql.js@<version> fzstd@<version>
tar xzf sql.js-*.tgz && cp package/dist/sql-wasm-browser.js <repo>/public/vendor/sql-wasm.js
{ printf '// sql.js <version> dist/sql-wasm-browser.wasm as base64 (MIT, see LICENSE-sqljs.txt).\n// A script tag can load this from file://, where fetch() of a .wasm file is blocked.\n// Regenerate: see public/vendor/README.md\nvar MAGPIE_SQL_WASM = "'
  base64 -w0 package/dist/sql-wasm-browser.wasm; printf '";\n'; } > <repo>/public/vendor/sql-wasm-binary.js
rm -rf package && tar xzf fzstd-*.tgz && cp package/umd/index.js <repo>/public/vendor/fzstd.js
```

Then bump the `?v=` on the vendor URLs in `apkg.js`.
