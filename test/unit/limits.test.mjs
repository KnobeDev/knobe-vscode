import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const L = require("../../out/limits.js");
const { verifyInWorker } = require("../../out/engine.js");
const cp = (...n) => String.fromCodePoint(...n);

test("sizeDecision: auto skips above the setting, nothing reads above the hard cap", () => {
  const MB = 1024 * 1024;
  assert.equal(L.sizeDecision(1 * MB, false, 5 * MB), "verify");
  assert.equal(L.sizeDecision(6 * MB, false, 5 * MB), "skip");
  assert.equal(L.sizeDecision(6 * MB, true, 5 * MB), "verify");
  assert.equal(L.sizeDecision(L.HARD_MAX_BYTES, true, 0), "verify");
  assert.equal(L.sizeDecision(L.HARD_MAX_BYTES + 1, true, 0), "refuse");
  assert.equal(L.sizeDecision(L.HARD_MAX_BYTES + 1, false, Infinity), "refuse");
});

test("truncateDisplay leaves short strings alone", () => {
  assert.equal(L.truncateDisplay("abc", 3), "abc");
  assert.equal(L.truncateDisplay("", 0), "");
});

test("truncateDisplay never cuts through \\xNN or \\uNNNN", () => {
  // escape starts 2 before the cut: "ab\x1b..." with limit 4 would give "ab\x"
  assert.equal(L.truncateDisplay("ab\\x1bcd", 4), "ab…");
  assert.equal(L.truncateDisplay("ab\\x1bcd", 6), "ab\\x1b…");
  assert.equal(L.truncateDisplay("a\\u202ezz", 5), "a…");
  assert.equal(L.truncateDisplay("a\\u202ezz", 7), "a\\u202e…");
  // every cut position through an escape yields only whole escapes
  const s = "x".repeat(10) + "\\u2066" + "\\x1b" + "y".repeat(10);
  for (let limit = 0; limit < Array.from(s).length; limit++) {
    const out = L.truncateDisplay(s, limit).replace(/…$/, "");
    assert.ok(!/\\(x[0-9a-f]?|u[0-9a-f]{0,3})$/.test(out), `limit ${limit}: ${out}`);
  }
});

test("truncateDisplay counts code points and never splits a surrogate pair", () => {
  const out = L.truncateDisplay(cp(0x1f600).repeat(5), 3);
  assert.equal(out, cp(0x1f600).repeat(3) + "…");
  assert.ok(out.isWellFormed());
});

test("a sealed title with an escape at the 200-char cut is shown with whole escapes", async () => {
  const engine = await import("../../vendor/knobe-core.js");
  const title = "t".repeat(198) + cp(0x1b) + "[31m tail";
  const { text } = await engine.createKnobe({
    fields: { title, summary: "s", license: "CC0-1.0", privacy_level: "public",
      quarantine_status: "quarantine", content_type: "original" },
    body: "body\n", author: "tester",
  });
  // The engine's own truncation is the behavior being worked around:
  assert.match(engine.safe(title, 200), /\\x…$/);
  const o = await verifyInWorker(new TextEncoder().encode(text), 10_000);
  assert.equal(o.kind, "done", JSON.stringify(o));
  assert.equal(o.verdict.state, "verified");
  assert.equal(o.verdict.title, "t".repeat(198) + "…");
});
