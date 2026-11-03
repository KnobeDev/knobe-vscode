# Vendored engine

`knobe-core.js` is copied byte-for-byte from the KNOBE Protocol repository.
It is not modified, rebuilt, or bundled: the extension loads this exact file
at runtime with a native `import()`, so the code that produces each verdict
is the file below. `package.json` in this folder only marks the file as an
ES module for Node; it does not alter the engine.

| | |
|---|---|
| Source | https://github.com/KnobeOne/knobe-protocol/blob/c7ada1f843721824ec7eb770ff8d661f8cd6df14/knobe-core.js |
| Upstream commit | `c7ada1f843721824ec7eb770ff8d661f8cd6df14` |
| SHA-256 | `689720ddf156b864b7d09d35017176d6b6b8642f2be92a84ab98f9aebc670659` |
| License | Apache-2.0, full text in `LICENSE-knobe-core.txt` |

`test/unit/vendor.test.mjs` fails if the file's hash drifts from the value
above. To update: copy the new upstream file, update the commit and hash
here and in that test, and rerun the full test suite.
