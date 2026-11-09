# KNOBE Protocol v1 — Test Vectors

Nine reference `.knobe.md` files with known expected verification results, for testing independent verifier implementations against the public v1 specification.

Verify each with the reference implementation:

```
python3 lens.py minimal-valid.knobe.md
```

## Expected results

### Core six (integrity model)

| file | expected status | expected body_verified | expected conformance |
|------|----------------|------------------------|----------------------|
| `minimal-valid.knobe.md` | verified | omitted | valid |
| `full-valid.knobe.md` | verified | yes | valid |
| `body-modified.knobe.md` | verified-body-modified | modified | valid |
| `payload-modified.knobe.md` | failed | omitted | valid (where readable) |
| `unreadable.knobe.md` | unreadable | — | invalid |
| `unicode-valid.knobe.md` | verified | yes | valid |

### Additional three (extended spec rules)

| file | expected status | expected body_verified | expected conformance | notes |
|------|----------------|------------------------|----------------------|-------|
| `numeric-violation.knobe.md` | verified | yes | invalid | bare integer in payload triggers §5 violation; integrity intact |
| `omitted-body-hash.knobe.md` | verified | omitted | valid | no body_hash field; body_verified MUST be omitted |
| `multi-block.knobe.md` | verified (last block) | omitted | warnings | two payload blocks; verifier surfaces a warning and MUST report body_verified omitted |

## Adversarial hardening set

The [`adversarial/`](adversarial/) subdirectory contains seventeen additional hostile-input files — duplicate keys, NFC key collisions, control-character and bidi injection, unsupported spec versions, numbers and strings with no canonical form — with expected results in [`adversarial/README.md`](adversarial/README.md). They are not part of the canonical-compatibility bar; they test verifier robustness.

## Interpretation set

The [`interpretation/`](interpretation/) subdirectory contains seven files pinning the documented rulings in [ERRATA.md](../ERRATA.md): questions the specification text left open: six reported from the steward-commissioned Go verifier (built from the specification text, with lens.py consulted for ambiguous edge cases), and one (E12) proposed in PR #12, each resolved authoritatively and fixed by a vector both reference verifiers agree on. Expected results in [`interpretation/README.md`](interpretation/README.md).

## Notes

- `payload_hash` is the SHA-256 of the canonical JSON payload (keys recursively sorted, no whitespace, NFC-normalized keys and string values, literal UTF-8, `payload_hash` field excluded).
- All numeric payload values MUST be JSON strings per spec §5.
- `body_hash` is optional and advisory. A mismatch yields `verified-body-modified`, not `failed`, when the payload still verifies.
- Body normalization: strip whole body; CRLF and lone CR to LF; strip only U+0020 and U+0009 from each line end; no Unicode normalization; UTF-8; SHA-256.
- Verifiers emit three independent dimensions: `status` (integrity), `body_verified` (yes/modified/omitted), and `conformance` (valid/warnings/invalid).
- An implementation that reproduces all nine expected results is canonically compatible with KNOBE Protocol v1.

KNOBE Protocol v1 · Test vectors: [CC0-1.0](LICENSE) (public domain — no attribution required) · David Kyle (UC Davis)
