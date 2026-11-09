# KNOBE Protocol v1 — Adversarial Hardening Set

Seventeen additional `.knobe.md` files probing edge cases and hostile input beyond the nine conformance vectors in the parent directory. These are **not** part of the canonical-compatibility bar — an implementation is conforming if it reproduces the nine core results — but a robust verifier should handle all seventeen of these without crashing, misreporting, or rendering unsafe output.

Verify each with the reference implementation:

```
python3 lens.py adversarial/<file>
```

## Expected results

| file | expected status | body_verified | conformance | what it probes |
|------|----------------|---------------|-------------|----------------|
| `bad-attribution-sources-type.knobe.md` | verified | omitted | invalid | `attribution.sources` has wrong JSON type; integrity intact, schema violation reported |
| `bad-body-hash-format.knobe.md` | verified-body-modified | modified | invalid | malformed `body_hash` value; treated as body mismatch, never as payload failure |
| `bad-created-date.knobe.md` | verified | omitted | invalid | impossible calendar date; conformance catches it, hash is unaffected |
| `bidi-title.knobe.md` | failed | omitted | invalid | U+202E (RIGHT-TO-LEFT OVERRIDE) in `title`, which visually reverses the text after it if printed raw. The stored hash is deliberately wrong and most required fields are absent, so integrity and display are both exercised; see the note below (PR #19) |
| `bigint-payload.knobe.md` | failed | omitted | invalid | a 33-digit bare integer, beyond 2^53, reported as a §5 violation without crashing; the stored hash is deliberately wrong (PR #19) |
| `control-character-title.knobe.md` | verified | omitted | valid | ANSI escape + newline injection in `title` attempting to spoof verifier output — see note below |
| `duplicate-key.knobe.md` | unreadable | — | invalid | duplicate JSON key in payload; ambiguous, MUST be rejected |
| `float-overflow.knobe.md` | unreadable | — | invalid | a float literal (`1e400`) that overflows to infinity, which has no canonical form; formerly a `lens.py` traceback (PR #11) |
| `lone-surrogate.knobe.md` | unreadable | — | invalid | an unpaired surrogate escape (`\ud800`) in a string value, which cannot be UTF-8 encoded; both reference verifiers give the same reason (PR #11, PR #19) |
| `multi-block-warning.knobe.md` | verified (last block, with warning) | omitted | warnings | two payload blocks; verifier evaluates the last per spec §3.3 and MUST surface a warning |
| `nested-payload-hash.knobe.md` | verified | omitted | valid | a `parents` entry carries the parent's `payload_hash`. Spec §5 leaves out only the top-level `payload_hash`, so the nested one is covered by the seal; a verifier that removes `payload_hash` at every depth computes a different hash and reports failed (#23) |
| `nfc-key-collision.knobe.md` | unreadable | — | invalid | keys distinct as bytes but identical after NFC normalization; ambiguous, MUST be rejected |
| `no-frontmatter-valid-payload.knobe.md` | verified | omitted | invalid | YAML frontmatter missing entirely; payload intact but file is nonconforming (`spec_version` required in frontmatter) |
| `null-payload-hash.knobe.md` | failed | omitted | invalid | `payload_hash` is JSON `null`; integrity fails, and machine output reports `stored` as `null` in both reference verifiers. Most required fields are absent (PR #19) |
| `payload-array.knobe.md` | unreadable | — | invalid | payload decodes to a JSON array, not an object |
| `spec-version-array.knobe.md` | unreadable | — | invalid | `spec_version` is a JSON array; an unsupported value is refused, not interpreted; formerly a `lens.py` traceback (PR #11) |
| `unsupported-spec-version.knobe.md` | unreadable | — | invalid | `spec_version: 2.0`; a v1 verifier MUST refuse rather than guess semantics |

## Note on `control-character-title`

This file is deliberately **fully valid and verified**. Its `title` contains terminal escape sequences and a newline crafted to print a fake `status: verified` line if a verifier echoes payload strings raw. The hazard is in display, not integrity: verifiers and any tool that renders payload fields MUST escape or strip control characters in output (the reference verifier prints them escaped, e.g. `\x1b`). A green result on this file plus clean output is the pass condition.

## Note on `bidi-title`

As with `control-character-title`, the hazard under test is display, though this file also fails integrity on purpose. Its `title` is `ok`, then U+202E RIGHT-TO-LEFT OVERRIDE, then `gnikcol`; printed raw, a terminal or page shows the tail reversed. The reference verifiers print the override escaped (`ok\u202egnikcol`), as they escape the other bidi overrides and isolates (U+202A–202E, U+2066–2069), U+2028 and U+2029, and unpaired surrogates. `knobe-core.selftest.mjs` checks that neither engine lets one of these characters through on any published file.

KNOBE Protocol v1 · Test vectors: [CC0-1.0](../LICENSE) (public domain — no attribution required) · David Kyle (UC Davis)
