# Changelog

## 0.1.0 (unreleased)

- First release: read-only, offline verification of `*.knobe.md` files on open, save, and change on disk.
- Status bar verdict with the protocol's exact state and conformance names; plain-text tooltip and details view with the three verification results and the integrity-not-truth caveat.
- Verdict cleared while a buffer has unsaved edits.
- Notifications for results that need attention (`knobeVerify.announceProblems`).
- Size and timeout settings clamped and restricted in untrusted workspaces; superseded verifications are cancelled.
- 256 MB hard ceiling on any read, including explicit Verify KNOBE; per-worker heap limit.
- Long payload strings are truncated without cutting through an escape sequence.
- Verification in a worker thread with a size limit for auto-verify and a timeout.
- Vendors `knobe-core.js` unmodified (upstream commit `8d664d3`): a number that overflows (such as `1e400`) makes a file unreadable instead of stopping verification with an error (upstream PR #11); only ASCII space, tab, CR and LF are stripped from a payload block (ERRATA E12), so a block holding a no-break space or U+0085 no longer verifies; the engine's `safe()` escapes unpaired surrogates and never throws on a non-string. The new sealer refusal of unassigned code points (upstream #34) does not apply: this extension only verifies.
- Matches all 33 test vectors published at `8d664d3`. Expected results are read from the READMEs published with the vectors, and the tests fail if a vector has no row there.
- A `payload_hash` that is not a string is shown for what it is, for example `12345 (expected a hash, got a number)` or `null (expected a hash, got null)`, instead of `(none)`.
- Unpaired surrogates in payload-derived text are shown as `\udXXX`.
