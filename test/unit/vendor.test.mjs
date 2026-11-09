import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PINNED = "6d83ffa6aead57ce0dde61f410475c0e70707ea6740abff47a9e32df86ea1a41";

test("vendored knobe-core.js is byte-identical to the pinned upstream file", () => {
  const bytes = readFileSync(join(root, "vendor", "knobe-core.js"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PINNED);
  assert.ok(bytes.toString("utf8").startsWith("/**\n * knobe-core.js — KNOBE Protocol v1 engine"));
  assert.ok(readFileSync(join(root, "vendor", "VENDORED.md"), "utf8").includes(PINNED));
});

// Drift guard, opt-in: with KNOBE_PROTOCOL_DIR set to a checkout of the
// upstream commit named in VENDORED.md, the engine and every bundled vector
// file (READMEs included) must match it byte for byte.
const UPSTREAM = process.env.KNOBE_PROTOCOL_DIR;
test("engine and bundled vectors match the upstream checkout in KNOBE_PROTOCOL_DIR",
  { skip: UPSTREAM ? false : "KNOBE_PROTOCOL_DIR is not set" }, () => {
    const ours = join(root, "test", "fixtures", "vectors");
    const theirs = join(UPSTREAM, "test-vectors");
    const rel = (base) => walk(base).map((p) => p.slice(base.length + 1)).sort();
    assert.ok(readFileSync(join(root, "vendor", "knobe-core.js")).equals(readFileSync(join(UPSTREAM, "knobe-core.js"))));
    assert.deepEqual(rel(ours), rel(theirs));
    const drifted = rel(ours).filter((f) => !readFileSync(join(ours, f)).equals(readFileSync(join(theirs, f))));
    assert.deepEqual(drifted, []);
  });

test("Apache-2.0 license text ships next to the engine", () => {
  const lic = readFileSync(join(root, "vendor", "LICENSE-knobe-core.txt"), "utf8");
  assert.ok(lic.includes("Apache License") && lic.includes("Version 2.0"));
});

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("offline: no network APIs anywhere in shipped code", () => {
  const NET = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(|require\(\s*["'](node:)?(https?|http2|net|tls|dgram|dns)["']\s*\)|from\s+["'](node:)?(https?|http2|net|tls|dgram|dns)["']/;
  const files = [...walk(join(root, "out")), join(root, "vendor", "knobe-core.js")].filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 5);
  for (const f of files) assert.ok(!NET.test(readFileSync(f, "utf8")), `network API in ${f}`);
});

test("manifest: no runtime dependencies, attributed to the extension author", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.author.name, "Joshua Hori");
  assert.equal(pkg.displayName, "KNOBE Verify for VS Code");
  assert.ok(!/official|reference implementation/i.test(pkg.description));
  assert.ok(!/conformant/i.test(pkg.description));
});
