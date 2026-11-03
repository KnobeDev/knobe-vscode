# KNOBE Verify for VS Code

Read-only, offline verification of `.knobe.md` files, built on KNOBE.

> A match proves integrity, not truth. Inspect before trusting.

When you open or save a file named `*.knobe.md`, this extension checks it locally and shows the verdict in the status bar. A `verified` result means the sealed payload is byte-identical to what was sealed. It does **not** mean the content is accurate, the attribution is honest, or the file is safe to rely on.

This is an independent editor integration by Joshua Hori. It is not the KNOBE Protocol steward's official or reference implementation, and the steward did not build, endorse, or review it.

## What it does

- Verifies `*.knobe.md` files when you open them, when you save them, and when they change on disk.
- Shows the integrity state in the status bar using the protocol's exact names: `verified`, `verified-body-modified`, `failed`, or `unreadable`, followed by the conformance level: `valid`, `warnings`, or `invalid`. For example: `KNOBE: verified, valid` or `KNOBE: verified-body-modified, invalid`.
- The status bar tooltip, and the details view you get by clicking it (or running **KNOBE Verify: Show KNOBE Verification Details**), list the three results the protocol defines:
  - **Integrity**: the `state` from the engine's report.
  - **Body verified**: `yes`, `modified`, or `omitted`. It is `omitted` when the file has no `body_hash`, has more than one payload block, or cannot be read.
  - **Conformance**, with each conformance issue listed.
  - The details view also shows the stored and computed `payload_hash`, the number of payload blocks, and any missing required fields.
- Clears the verdict as soon as the buffer has unsaved edits. The status bar then reads `KNOBE: unsaved edits, no verdict` until you save (or undo back to the saved text). A verdict describes the saved file, so it is never left showing over a modified buffer.
- Shows a notification when the active file's result is `failed` or `unreadable`, or verification could not run, so the result reaches people who are not watching the status bar. Each distinct result is announced once. See `knobeVerify.announceProblems`.
- Escapes control characters, DEL, C1 controls, and bidirectional formatting characters in every payload-derived string it displays, so a crafted title cannot spoof the report.

## What it does not do

- No sealing, creating, or transforming of KNOBE files. It never writes to a `.knobe.md` file. ([KNOBE Studio](https://knobe.org/studio/) covers authoring.)
- No network access of any kind: no remote verification, no telemetry, no update checks. The engine is vendored, not fetched.
- No judgment on whether content is true, whether attribution is honest, or whether a file's use conditions permit anything.
- No syntax highlighting or language features for `.knobe.md` beyond verification.

## How it works

The verdicts come from `knobe-core.js`, the KNOBE Protocol v1 JavaScript engine, vendored unmodified in [`vendor/`](vendor/VENDORED.md) and loaded as-is at runtime. This extension is a thin adapter over that engine: it does not reimplement the hash rule, so its verdicts are the engine's verdicts.

- The extension verifies the **saved bytes on disk**, not the editor buffer, because VS Code can normalize line endings in a buffer. For a document with no readable file behind it (for example, one side of a git diff), it falls back to the editor text and says so in the tooltip and details.
- Each verification runs in a worker thread with a time limit, so a huge or hostile file cannot stall the editor or other extensions.
- Files above a size limit are not verified automatically. The status bar shows `KNOBE: large file, click to verify` instead, and **Verify KNOBE** always runs.
- A newer edit, save, or close cancels any verification still running for that file and stops its worker.
- In an untrusted workspace, the size-limit and timeout settings are taken only from your user settings, so a repository's `.vscode/settings.json` cannot lift them. Both also have hard maximums (256 MB and 300 seconds).

## A note on saving sealed files

Sealed `.knobe.md` files are not meant to be edited in place. Settings such as `files.trimTrailingWhitespace`, `files.insertFinalNewline`, and format-on-save can change a file's bytes when you save it, even if you did not mean to edit it. If that changes the body, the status bar will show `verified-body-modified`. If it changes the payload block, it will show `failed`. The extension reports what is on disk; it does not prevent the change.

## Commands

| Command | What it does |
|---|---|
| **Verify KNOBE** | Verify the active `*.knobe.md` file now, ignoring the size limit. Also in the Explorer context menu. |
| **Show KNOBE Verification Details** | Open a read-only plain-text report beside the file. |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `knobeVerify.autoVerify` | `true` | Verify on open, save, and change on disk. When off, use **Verify KNOBE**. |
| `knobeVerify.autoVerifyMaxSizeKB` | `5120` | Files larger than this are not verified automatically. |
| `knobeVerify.timeoutSeconds` | `30` | Stop a verification that takes longer than this. |
| `knobeVerify.announceProblems` | `errors` | `errors`: notify for `failed`, `unreadable`, or a verification that could not run. `all`: also notify for `verified-body-modified` and for `warnings` or `invalid` conformance. `off`: never notify. |

## Accessibility

What the extension does:

- The status bar item's accessible name begins with exactly the words it shows (for example, "KNOBE: verified, valid"), then says the rest in full sentences: "Integrity: verified. Conformance: valid. Body verified: yes. This checks integrity, not truth." This lets voice-control users say what they see.
- Results are shown in words, not by color or icon alone. `verified` gets no colored background. Problems also use the theme's warning and error colors.
- Results that need attention are announced through VS Code notifications, which screen readers read out (see `knobeVerify.announceProblems`).
- The details view is an ordinary read-only text document, so it works with screen readers, zoom, and high-contrast themes like any other editor tab.
- Everything uses built-in VS Code interface parts (status bar, notifications, text editor). The extension adds no custom web views.

What has been tested: automated tests check the label wording, the escaping, and the announcement rules. Testing with assistive technology (NVDA, VoiceOver, Orca, voice control, keyboard-only use, braille) has **not** been done yet. If you use assistive technology and something does not work, please open an issue.

## Test-vector results

All 25 published KNOBE Protocol v1 test vectors (the nine core vectors, the ten adversarial vectors, and the six interpretation vectors) produce the expected integrity state, body result, and conformance level, both in unit tests against the engine wrapper and in integration tests that open each file in a real VS Code instance. These results come from the vendored engine; this extension adds no verification logic of its own.

| Set | Vectors | Result |
|---|---|---|
| Core (`test-vectors/`) | 9 | 9 match |
| Adversarial (`test-vectors/adversarial/`) | 10 | 10 match, no crashes; `control-character-title` shows `verified` with every displayed payload string escaped |
| Interpretation (`test-vectors/interpretation/`) | 6 | 6 match |

The integration suite also passes with networking disabled (an empty network namespace), which is how the offline requirement is checked.

## Development

Requires Node 20 or later.

```bash
npm install
```

```bash
npm test
```

`npm test` runs the unit tests (`node --test`) and then the integration tests, which launch VS Code. The integration runner uses a local VS Code if it finds one (set `VSCODE_EXECUTABLE` to point at it); otherwise `@vscode/test-electron` downloads one. To repeat the offline check on Linux:

```bash
npm run test:offline
```

## License

Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). The vendored `knobe-core.js` is Apache-2.0 from the [KNOBE Protocol repository](https://github.com/KnobeOne/knobe-protocol), with its license text in `vendor/LICENSE-knobe-core.txt`. The test vectors in `test/fixtures/vectors/` are CC0-1.0 and are not included in the packaged extension.
