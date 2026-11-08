# Vendored engine

`knobe-core.js` is copied byte-for-byte from the KNOBE Protocol repository.
It is not modified, rebuilt, or bundled: the extension loads this exact file
at runtime with a native `import()`, so the code that produces each verdict
is the file below. `package.json` in this folder only marks the file as an
ES module for Node; it does not alter the engine.

| | |
|---|---|
| Source | https://github.com/KnobeOne/knobe-protocol/blob/8d664d37211388e0bdaab08fced2546be8bb9f64/knobe-core.js |
| Upstream commit | `8d664d37211388e0bdaab08fced2546be8bb9f64` |
| SHA-256 | `6d83ffa6aead57ce0dde61f410475c0e70707ea6740abff47a9e32df86ea1a41` |
| License | Apache-2.0, full text in `LICENSE-knobe-core.txt` |

`test/unit/vendor.test.mjs` fails if the file's hash drifts from the value
above. The test vectors in `test/fixtures/vectors/` are copied from
`test-vectors/` at the same commit, READMEs included: the vector tests read
their expected results from those READMEs' tables.

To update, with `UP` a checkout of the new upstream commit:

1. Copy `$UP/knobe-core.js` here, and replace `test/fixtures/vectors/` with
   a copy of `$UP/test-vectors/`.
2. Update the commit and hash here and in `vendor.test.mjs`.
3. Run `KNOBE_PROTOCOL_DIR=$UP npm test`. With that variable set, the unit
   tests also check that the engine and every vector file match `$UP` byte
   for byte.
