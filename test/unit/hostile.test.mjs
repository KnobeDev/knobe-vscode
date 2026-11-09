import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Hostile payloads, end to end: worker verdict, then the details report.

const require = createRequire(import.meta.url);
const P = require("../../out/present.js");
const { verifyInWorker } = require("../../out/engine.js");
const here = dirname(fileURLToPath(import.meta.url));
const engine = await import(pathToFileURL(join(here, "..", "..", "vendor", "knobe-core.js")).href);

const cp = (...n) => String.fromCodePoint(...n);
const UNSAFE = new RegExp("[" + cp(0) + "-" + cp(9) + cp(0x0b) + "-" + cp(0x1f) + cp(0x7f) + "-" + cp(0x9f)
  + cp(0x202a) + "-" + cp(0x202e) + cp(0x2066) + "-" + cp(0x2069) + cp(0x2028) + cp(0x2029) + "]", "u");
const HASH = /"payload_hash":"[0-9a-f]{64}"/;
const BLOCK = /-----BEGIN KNOBE B64-----\n([\s\S]*?)\n-----END KNOBE B64-----/;

/** Re-encode a sealed document's payload after editing its JSON text. */
function rewritePayload(doc, edit) {
  const m = doc.match(BLOCK);
  const json = Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8");
  const b64 = Buffer.from(edit(json), "utf8").toString("base64");
  return doc.replace(m[0], `-----BEGIN KNOBE B64-----\n${b64}\n-----END KNOBE B64-----`);
}

const SEALED = (await engine.createKnobe({
  fields: {
    title: "Plain title",
    attribution: {
      good_faith_declaration: true,
      sources: [{ author: "A. Author", contribution: "author", rights_bearing: true }],
    },
  },
  body: "Hello.\n",
})).text;

async function verdictOf(text) {
  const o = await verifyInWorker(new TextEncoder().encode(text), 10_000);
  assert.equal(o.kind, "done", JSON.stringify(o));
  return o.verdict;
}
const details = (v) => P.detailsText("hostile.knobe.md", { kind: "verified", verdict: v, source: "disk", checkedAt: new Date(0) });

// The engine gives this one reason for any payload it cannot decode or parse,
// so each test below also runs a control that differs only in the character
// under test, to show the rewrite itself leaves a readable file.
const DECODE_FAILED = /could not be decoded or parsed/;

/** SEALED with its empty summary replaced by the number literal `num`. */
const withSummary = (num) => rewritePayload(SEALED, (j) => {
  assert.ok(j.includes('"summary":""'), j);
  return j.replace('"summary":""', `"summary":${num}`);
});

/** SEALED with `ch` inserted ten characters into its payload block. */
const withBlockChar = (ch) => {
  const out = SEALED.replace(/(-----BEGIN KNOBE B64-----\n.{10})/, "$1" + ch);
  assert.notEqual(out, SEALED, "the insertion point was not found");
  return out;
};

test("a payload with an overflowing number is unreadable, not an error (upstream PR #11)", async () => {
  // Control: a finite number in the same place is read, and fails the hash.
  assert.equal((await verdictOf(withSummary("1e300"))).state, "failed");
  const v = await verdictOf(withSummary("1e400"));
  assert.equal(v.state, "unreadable");
  assert.match(v.reason, DECODE_FAILED);
});

test("only ASCII whitespace is stripped from a payload block (ERRATA E12)", async () => {
  // Controls: an ASCII space or tab in the same place is stripped and the file verifies.
  for (const ch of [" ", cp(0x09)]) {
    assert.equal((await verdictOf(withBlockChar(ch))).state, "verified", `U+${ch.codePointAt(0).toString(16)}`);
  }
  // A no-break space or NEXT LINE is not whitespace there, so the Base64 is invalid.
  for (const ch of [cp(0xa0), cp(0x85)]) {
    const v = await verdictOf(withBlockChar(ch));
    assert.equal(v.state, "unreadable", `U+${ch.codePointAt(0).toString(16)}`);
    assert.match(v.reason, DECODE_FAILED);
  }
});

for (const [label, json, shown] of [
  ["a number", "12345", "12345 (expected a hash, got a number)"],
  ["an integer beyond 2^53", "123456789012345678901234567890", "123456789012345678901234567890 (expected a hash, got a number)"],
  ["a float", "1.5", "1.5 (expected a hash, got a number)"],
  ["an object", '{"a":"\\u202e"}', '{"a":"\\u202e"} (expected a hash, got a group of fields)'],
  ["an object holding an integer beyond 2^53", '{"x":123456789012345678901234567890}', '{"x":123456789012345678901234567890} (expected a hash, got a group of fields)'],
  ["an array", "[1,2]", "[1,2] (expected a hash, got a list)"],
  ["a boolean", "false", "false (expected a hash, got a true/false value)"],
  // knobe-core.js 8d664d3 passes a null payload_hash through as null, as
  // lens.py does (adversarial/null-payload-hash.knobe.md).
  ["null", "null", "null (expected a hash, got null)"],
]) {
  test(`a payload_hash that is ${label} is shown for what it is, not as (none)`, async () => {
    const v = await verdictOf(rewritePayload(SEALED, (j) => j.replace(HASH, `"payload_hash":${json}`)));
    assert.equal(v.state, "failed");
    assert.equal(v.stored, shown);
    const text = details(v);
    assert.ok(text.includes(`Stored payload_hash:   ${shown}\n`), text);
    assert.ok(!UNSAFE.test(text));
  });
}

test("a missing payload_hash is shown as (none)", async () => {
  const v = await verdictOf(rewritePayload(SEALED, (j) => j.replace(new RegExp(HASH.source + ","), "")));
  assert.equal(v.state, "failed");
  assert.ok(details(v).includes("Stored payload_hash:   (none)\n"));
});

test("a crafted payload_hash cannot add report lines or terminal escapes", async () => {
  const forged = cp(0x1b) + "[31mPWNED" + cp(0x1b) + "[0m" + cp(0x0a, 0x0a) + "Integrity: verified";
  const v = await verdictOf(rewritePayload(SEALED, (j) => j.replace(HASH, `"payload_hash":${JSON.stringify(forged)}`)));
  const text = details(v);
  assert.deepEqual(text.split("\n").filter((l) => l.startsWith("Integrity:")), ["Integrity: failed"]);
  assert.ok(text.includes("Stored payload_hash:   \\x1b[31mPWNED\\x1b[0m\\x0a\\x0aIntegrity: verified\n"));
  assert.ok(!UNSAFE.test(text));
});

test("an unpaired surrogate in a duplicate key is shown as \\udXXX", async () => {
  const v = await verdictOf(rewritePayload(SEALED, (j) => j.replace("{", '{"\\ud800":1,"\\ud800":2,')));
  assert.equal(v.state, "unreadable");
  for (const text of [details(v), P.tooltipText({ kind: "verified", verdict: v, source: "disk" })]) {
    assert.ok(text.isWellFormed());
    assert.ok(text.includes("duplicate JSON key: \\ud800"), text);
  }
});
