# Vendored engine

`knobe-core.js` is copied byte-for-byte from the KNOBE Protocol repository.
It is not modified, rebuilt, or bundled: the extension loads this exact file
at runtime with a native `import()`, so the code that produces each verdict
is the file below. `package.json` in this folder only marks the file as an
ES module for Node; it does not alter the engine.

| | |
|---|---|
| Source | https://github.com/KnobeOne/knobe-protocol/blob/4f6688595b1a8021dca3128626461d50fea58d2f/knobe-core.js |
| Upstream commit | `4f6688595b1a8021dca3128626461d50fea58d2f` |
| SHA-256 | `2712c8359257cfee035573a07a5f6a0710a29cb81edb3e0bce917fd5e72d374b` |
| License | Apache-2.0, full text in `LICENSE-knobe-core.txt` |

`test/unit/vendor.test.mjs` fails if the file's hash drifts from the value
above. The test vectors in `test/fixtures/vectors/` are copied from
`test-vectors/` at the same commit, READMEs included: the vector tests read
their expected results from those READMEs' tables.

To update, with `UP` a checkout of the new upstream commit:

1. Copy `$UP/knobe-core.js` here, and replace `test/fixtures/vectors/` with
   a copy of `$UP/test-vectors/`.
2. Update the commit and hash here and in `vendor.test.mjs`, and the
   per-set vector counts in `vectors.test.mjs` and `README.md`.
3. Run `KNOBE_PROTOCOL_DIR=$UP npm test`. With that variable set, the unit
   tests also check that the engine and every vector file match `$UP` byte
   for byte.
