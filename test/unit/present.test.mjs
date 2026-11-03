import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../../out/present.js");
const { verifyInWorker } = require("../../out/engine.js");
const here = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(here, "..", "fixtures", "vectors");

// Raw control characters, DEL, C1, bidi controls, line/para separators.
const cp = (...n) => String.fromCodePoint(...n);
const UNSAFE = new RegExp("[" + cp(0) + "-" + cp(0x1f) + cp(0x7f) + "-" + cp(0x9f)
  + cp(0x202a) + "-" + cp(0x202e) + cp(0x2066) + "-" + cp(0x2069) + cp(0x2028) + cp(0x2029) + "]", "u");
const linesUnsafe = (s) => s.split("\n").some((l) => UNSAFE.test(l));

const verdict = (over = {}) => ({
  state: "verified", conformance: "valid", conformanceIssues: [], conformanceIssuesTruncated: false,
  bodyVerified: "omitted", computed: "a".repeat(64), stored: "a".repeat(64), missing: [],
  blockCount: 1, reason: null, title: null, ...over,
});
const done = (v, source = "disk") => ({ kind: "verified", verdict: v, source, checkedAt: new Date(0) });

test("escapeControls escapes C0, DEL, C1, bidi and separators; keeps normal text", () => {
  assert.equal(P.escapeControls("a\x1b[31mb\nc\x7f\x85"), "a\\x1b[31mb\\x0ac\\x7f\\x85");
  assert.equal(P.escapeControls("x" + cp(0x202e) + "y" + cp(0x2066) + "z" + cp(0x2028)), "x\\u202ey\\u2066z\\u2028");
  assert.equal(P.escapeControls("café 中文 עברית 😀"), "café 中文 עברית 😀");
});

test("escapeControls is idempotent on engine-escaped strings", () => {
  const once = P.escapeControls("t\x1b\n");
  assert.equal(P.escapeControls(once), once);
});

test("status bar uses the exact protocol state and conformance names", () => {
  for (const state of ["verified", "verified-body-modified", "failed", "unreadable"]) {
    for (const conformance of ["valid", "warnings", "invalid"]) {
      const text = P.statusBarText(done(verdict({ state, conformance })));
      assert.ok(text.includes(`KNOBE: ${state}, ${conformance}`), text);
    }
  }
});

test("status bar text never carries payload strings, even crafted ones", () => {
  const text = P.statusBarText(done(verdict({ state: "$(pass) evil", conformance: "x\x1b", title: "$(check) fake" })));
  assert.equal(text, "$(question) KNOBE: unknown, unknown");
});

test("verified/valid has no background (no 'endorsement' styling); problems do", () => {
  assert.equal(P.severity(done(verdict())), "none");
  assert.equal(P.severity(done(verdict({ conformance: "warnings" }))), "warning");
  assert.equal(P.severity(done(verdict({ state: "verified-body-modified" }))), "warning");
  assert.equal(P.severity(done(verdict({ state: "failed" }))), "error");
  assert.equal(P.severity(done(verdict({ state: "unreadable", conformance: "invalid" }))), "error");
});

test("tooltip and details carry the caveat and the three dimensions", () => {
  const s = done(verdict({ conformance: "invalid", conformanceIssues: ["issue one", "issue two"] }));
  for (const out of [P.tooltipText(s), P.detailsText("a.knobe.md", s)]) {
    assert.ok(out.includes(P.CAVEAT));
    assert.ok(out.includes("Integrity: verified"));
    assert.ok(out.includes("Body verified: omitted"));
    assert.ok(out.includes("Conformance: invalid"));
    assert.ok(out.includes("  - issue one") && out.includes("  - issue two"));
  }
  assert.ok(P.accessibleLabel(s).includes("not truth"));
});

test("stale status shows no verdict", () => {
  const s = { kind: "stale" };
  assert.equal(P.statusBarText(s), "$(circle-slash) KNOBE: unsaved edits, no verdict");
  assert.ok(!/verified\b/.test(P.accessibleLabel(s)));
  assert.ok(P.tooltipText(s).includes("unsaved edits"));
});

test("control-character-title: verified, and every surface is free of raw control chars", async () => {
  const o = await verifyInWorker(readFileSync(join(VECTORS, "adversarial/control-character-title.knobe.md")), 10_000);
  const s = done(o.verdict);
  assert.equal(o.verdict.state, "verified");
  assert.equal(P.severity(s), "none");
  const surfaces = [P.statusBarText(s), P.accessibleLabel(s), P.tooltipText(s), P.detailsText("f\x1b.knobe.md", s)];
  for (const out of surfaces) assert.ok(!linesUnsafe(out), JSON.stringify(out));
  // The spoofed "status: verified (SPOOFED)" must not start its own line.
  for (const out of surfaces) assert.ok(!/^status:/m.test(out));
  assert.ok(P.tooltipText(s).includes("\\x1b[31m"));
});

test("defense in depth: unescaped strings in a verdict are escaped anyway", () => {
  const s = done(verdict({ title: "a\x1bb\nstatus: verified", conformanceIssues: ["bad\r\nline"], reason: "r\x00" }));
  for (const out of [P.tooltipText(s), P.detailsText("x", s)]) assert.ok(!linesUnsafe(out));
  assert.ok(!linesUnsafe(P.tooltipText({ kind: "error", message: "boom\x1b\n" })));
});

test("buffer-sourced verdicts say so", () => {
  assert.ok(P.tooltipText(done(verdict(), "buffer")).includes("editor text"));
  assert.ok(!P.tooltipText(done(verdict(), "disk")).includes("editor text"));
});

test("skipped-size explains the setting", () => {
  const t = P.tooltipText({ kind: "skipped-size", size: 9 * 1024 * 1024, limit: 5 * 1024 * 1024 });
  assert.ok(t.includes("knobeVerify.autoVerifyMaxSizeKB") && t.includes("9.0 MB"));
});

test("label in name: every accessible label starts with the visible text (SC 2.5.3)", () => {
  const statuses = [
    { kind: "pending" }, { kind: "stale" }, { kind: "manual" }, { kind: "timeout", ms: 1000 },
    { kind: "error", message: "x" }, { kind: "skipped-size", size: 10, limit: 1 }, { kind: "too-large", size: 300 * 1024 * 1024, limit: 256 * 1024 * 1024 },
    ...["verified", "verified-body-modified", "failed", "unreadable"].map((state) => done(verdict({ state }))),
  ];
  for (const s of statuses) {
    const visible = P.visibleText(s);
    assert.ok(P.statusBarText(s).endsWith(" " + visible));
    assert.ok(P.accessibleLabel(s).startsWith(visible), `${s.kind}: ${P.accessibleLabel(s)}`);
  }
});

test("announcements: only for problems, and never carry payload strings", () => {
  assert.equal(P.problemAnnouncement(done(verdict())), null);
  assert.equal(P.problemAnnouncement({ kind: "stale" }), null);
  assert.equal(P.problemAnnouncement({ kind: "pending" }), null);
  const failed = P.problemAnnouncement(done(verdict({ state: "failed", title: "EVIL [x](command:y)" })));
  assert.equal(failed.level, "error");
  assert.ok(failed.text.includes("integrity failed") && !failed.text.includes("EVIL"));
  assert.equal(P.problemAnnouncement(done(verdict({ conformance: "warnings" }))).level, "warning");
  assert.equal(P.problemAnnouncement({ kind: "error", message: "secret\x1b" }).text.includes("secret"), false);
});

test("manual status (autoVerify off) shows no verdict and offers to verify", () => {
  const s = { kind: "manual" };
  assert.equal(P.statusBarText(s), "$(info) KNOBE: not verified, click to verify");
  assert.ok(P.tooltipText(s).includes("knobeVerify.autoVerify"));
});

test("too-large status: no verdict, names the cap, points to a CLI verifier", () => {
  const s = { kind: "too-large", size: 300 * 1024 * 1024, limit: 256 * 1024 * 1024 };
  assert.equal(P.statusBarText(s), "$(circle-slash) KNOBE: file too large to verify");
  assert.equal(P.severity(s), "none");
  const t = P.tooltipText(s);
  assert.ok(t.includes("300.0 MB") && t.includes("256.0 MB") && t.includes("lens.py"));
});
