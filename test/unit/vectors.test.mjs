import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { EXPECTED } from "./expected.mjs";

const require = createRequire(import.meta.url);
const { verifyInWorker } = require("../../out/engine.js");
const here = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(here, "..", "fixtures", "vectors");

test("every vector on disk has an expectation (25 total)", () => {
  const found = [];
  for (const sub of ["", "adversarial", "interpretation"]) {
    for (const f of readdirSync(join(VECTORS, sub))) {
      if (f.endsWith(".knobe.md")) found.push(sub ? `${sub}/${f}` : f);
    }
  }
  assert.deepEqual(found.sort(), Object.keys(EXPECTED).sort());
  assert.equal(found.length, 25);
});

for (const [file, [state, body, conformance]] of Object.entries(EXPECTED)) {
  test(`vector ${file}`, async () => {
    const outcome = await verifyInWorker(readFileSync(join(VECTORS, file)), 10_000);
    assert.equal(outcome.kind, "done", JSON.stringify(outcome));
    const v = outcome.verdict;
    assert.equal(v.state, state);
    assert.equal(v.conformance, conformance);
    if (body !== null) assert.equal(v.bodyVerified, body);
  });
}

test("omitted-body-hash and multi-block report body omitted, never yes", async () => {
  for (const f of ["omitted-body-hash.knobe.md", "multi-block.knobe.md"]) {
    const o = await verifyInWorker(readFileSync(join(VECTORS, f)), 10_000);
    assert.equal(o.verdict.bodyVerified, "omitted", f);
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
