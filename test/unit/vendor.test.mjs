import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PINNED = "689720ddf156b864b7d09d35017176d6b6b8642f2be92a84ab98f9aebc670659";

test("vendored knobe-core.js is byte-identical to the pinned upstream file", () => {
  const bytes = readFileSync(join(root, "vendor", "knobe-core.js"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PINNED);
  assert.ok(bytes.toString("utf8").startsWith("/**\n * knobe-core.js — KNOBE Protocol v1 engine"));
  assert.ok(readFileSync(join(root, "vendor", "VENDORED.md"), "utf8").includes(PINNED));
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
