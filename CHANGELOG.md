# Changelog

## 0.1.0 (unreleased)

- First release: read-only, offline verification of `*.knobe.md` files on open, save, and change on disk.
- Status bar verdict with the protocol's exact state and conformance names; plain-text tooltip and details view with the three verification results and the integrity-not-truth caveat.
- Verdict cleared while a buffer has unsaved edits.
- Notifications for results that need attention (`knobeVerify.announceProblems`).
- Size and timeout settings clamped and restricted in untrusted workspaces; superseded verifications are cancelled.
- Verification in a worker thread with a size limit for auto-verify and a timeout.
- Vendors `knobe-core.js` unmodified (upstream commit `c7ada1f`).
