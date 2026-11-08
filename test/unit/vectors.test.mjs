import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { verifyInWorker } = require("../../out/engine.js");
const P = require("../../out/present.js");
const { VECTORS, SETS, expectations, bundledVectors } = require("../vector-expectations.cjs");

// Expected results come from the upstream README tables bundled with the
// vectors (see test/vector-expectations.cjs), not from a list typed here.
const ROWS = expectations();

test("every bundled vector has exactly one README row, and every row a file", () => {
  assert.deepEqual(ROWS.map((r) => r.file).sort(), bundledVectors());
});

test("the core set is the nine conformance vectors; all 33 published at 8d664d3 are covered", () => {
  assert.equal(ROWS.filter((r) => r.set === "").length, 9);
  for (const set of SETS.filter(Boolean)) assert.ok(ROWS.some((r) => r.set === set), set);
  assert.ok(ROWS.length >= 33, `only ${ROWS.length} vectors`);
});

async function verdictOf(file) {
  const outcome = await verifyInWorker(readFileSync(join(VECTORS, file)), 10_000);
  assert.equal(outcome.kind, "done", JSON.stringify(outcome));
  return outcome.verdict;
}

for (const { file, state, bodyVerified, conformance } of ROWS) {
  test(`vector ${file}: ${state} / ${bodyVerified} / ${conformance}`, async () => {
    const v = await verdictOf(file);
    assert.equal(v.state, state);
    assert.equal(v.bodyVerified, bodyVerified);
    assert.equal(v.conformance, conformance);
  });
}

// Display safety on every published file, as knobe-core.selftest.mjs checks
// upstream: nothing shown in the status bar, its accessible label, the
// tooltip, a notification or the details document may carry a control
// character, a bidi override or isolate, a line or paragraph separator, or
// an unpaired surrogate. Newlines that separate report lines are ours.
const cp = (...n) => String.fromCodePoint(...n);
const UNSAFE = new RegExp("[" + cp(0) + "-" + cp(0x1f) + cp(0x7f) + "-" + cp(0x9f)
  + cp(0x202a) + "-" + cp(0x202e) + cp(0x2066) + "-" + cp(0x2069) + cp(0x2028) + cp(0x2029) + "]", "u");
const BS = "\\";

function shownTexts(file, v) {
  const status = { kind: "verified", verdict: v, source: "disk", checkedAt: new Date(0) };
  return [
    P.statusBarText(status),
    P.accessibleLabel(status),
    P.problemAnnouncement(status)?.text ?? "",
    ...P.tooltipText(status).split("\n"),
    ...P.detailsText(file, status).split("\n"),
  ];
}

for (const { file } of ROWS) {
  test(`vector ${file}: everything shown is escaped`, async () => {
    const v = await verdictOf(file);
    // Each payload-derived field on its own first: a raw line feed here
    // would otherwise just become a line break in the joined report text.
    const fields = [v.state, v.conformance, v.bodyVerified, v.title, v.reason, v.stored, v.computed,
      ...v.conformanceIssues, ...v.missing].filter((s) => s !== null);
    for (const text of [...fields, ...shownTexts(file, v)]) {
      assert.ok(!UNSAFE.test(text), JSON.stringify(text));
      assert.ok(text.isWellFormed(), JSON.stringify(text));
    }
  });
}

test("bidi-title: the right-to-left override in the title is shown escaped", async () => {
  const v = await verdictOf("adversarial/bidi-title.knobe.md");
  assert.equal(v.title, "ok" + BS + "u202e" + "gnikcol");
  assert.ok(P.tooltipText({ kind: "verified", verdict: v, source: "disk" })
    .includes("Title (from payload, untrusted): ok" + BS + "u202egnikcol\n"));
});

test("control-character-title: the ANSI escape and newline are shown escaped", async () => {
  const v = await verdictOf("adversarial/control-character-title.knobe.md");
  assert.ok(v.title.includes(BS + "x1b["), v.title);
  assert.ok(v.title.includes(BS + "x0a"), v.title);
});

test("null-payload-hash: a JSON null payload_hash is shown as null, not (none)", async () => {
  const v = await verdictOf("adversarial/null-payload-hash.knobe.md");
  assert.equal(v.stored, "null (expected a hash, got null)");
  const status = { kind: "verified", verdict: v, source: "disk", checkedAt: new Date(0) };
  assert.ok(P.detailsText("n.knobe.md", status).includes("Stored payload_hash:   null (expected a hash, got null)\n"));
});

test("unreadable vectors show no stored payload_hash", async () => {
  for (const { file } of ROWS.filter((r) => r.state === "unreadable")) {
    assert.equal((await verdictOf(file)).stored, null, file);
  }
});

test("float-overflow is unreadable, not a verification error (upstream PR #11)", async () => {
  const v = await verdictOf("adversarial/float-overflow.knobe.md");
  assert.equal(v.state, "unreadable");
  assert.ok(v.reason, "an unreadable verdict carries its reason");
});

test("lone-surrogate gives the reference verifiers' reason", async () => {
  const v = await verdictOf("adversarial/lone-surrogate.knobe.md");
  assert.match(v.reason, /cannot be UTF-8 encoded/);
});

test("omitted-body-hash and multi-block report body omitted, never yes", async () => {
  for (const f of ["omitted-body-hash.knobe.md", "multi-block.knobe.md"]) {
    assert.equal((await verdictOf(f)).bodyVerified, "omitted", f);
  }
});

test("timeout path terminates the worker and reports timeout", async () => {
  const o = await verifyInWorker(readFileSync(join(VECTORS, "full-valid.knobe.md")), 1);
  assert.deepEqual(o, { kind: "timeout", ms: 1 });
});

test("a large (8 MB) file verifies without error", async () => {
  const base = readFileSync(join(VECTORS, "omitted-body-hash.knobe.md"), "utf8");
  const idx = base.indexOf("\n-----BEGIN KNOBE B64-----");
  const big = base.slice(0, idx) + "\n" + "lorem ipsum dolor sit amet\n".repeat(300_000) + base.slice(idx);
  const o = await verifyInWorker(new TextEncoder().encode(big), 30_000);
  assert.equal(o.kind, "done");
  assert.equal(o.verdict.state, "verified");
});

test("garbage bytes are unreadable, not a crash", async () => {
  const o = await verifyInWorker(new Uint8Array([0xff, 0xfe, 0x00, 0x41]), 10_000);
  assert.equal(o.kind, "done");
  assert.equal(o.verdict.state, "unreadable");
});

test("aborting terminates the worker and reports cancelled", async () => {
  const c = new AbortController();
  const p = verifyInWorker(readFileSync(join(VECTORS, "full-valid.knobe.md")), 10_000, c.signal);
  c.abort();
  assert.deepEqual(await p, { kind: "cancelled" });
  const pre = new AbortController();
  pre.abort();
  assert.deepEqual(await verifyInWorker(new Uint8Array(1), 10_000, pre.signal), { kind: "cancelled" });
});
