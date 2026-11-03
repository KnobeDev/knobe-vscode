/**
 * knobe-core.js — KNOBE Protocol v1 engine: the JavaScript sibling verifier.
 *
 * One file, zero dependencies, isomorphic: runs unmodified in Node ≥20 and
 * every modern browser (WebCrypto, TextEncoder/TextDecoder, atob/btoa).
 *
 * lens.py is the reference verifier and defines correct behavior for v1.
 * knobe-core.js is its JavaScript sibling: written by closely studying
 * lens.py, sharing no code but sharing lineage. It reproduces the reference
 * verifier's verdicts — state, conformance, body verdict, computed hash,
 * and exit code — across every published test vector and sealed example.
 * Run `node knobe-core.selftest.mjs` in this repository to check the two
 * verifiers against each other. Report keys are snake_case, identical to
 * lens.py's JSON output, so the two can be diffed directly.
 *
 * Capabilities:
 *   verify(), read()                      — inspect + verify existing KNOBEs
 *   seal(), createKnobe(), transformKnobe() — author and derive new ones
 *   permits()                             — evaluate the sealed governance
 *                                           fields for a proposed action
 *                                           (integrity-gated; cites clauses)
 *
 * Canonical hash rule (spec §5, FROZEN): decode the Base64 payload to JSON;
 * remove payload_hash; NFC-normalize all JSON object keys and string values
 * recursively; serialize with keys recursively sorted (code-point order),
 * no whitespace, arrays in insertion order, literal UTF-8 (never \uXXXX);
 * SHA-256; compare to stored payload_hash.
 *
 * A match proves integrity, not truth. Inspect before trusting.
 */

// ---------------------------------------------------------------------------
// Constants (mirrors lens.py)
// ---------------------------------------------------------------------------

export const SUPPORTED_SPEC_VERSIONS = new Set(["1.0"]);

export const REQUIRED = [
  "spec_version", "title", "summary", "content_type", "created_date",
  "license", "privacy_level", "quarantine_status", "attribution", "payload_hash",
];

// Required fields that MUST be JSON strings (spec §4). attribution is an
// object and is validated structurally; payload_hash has its own HEX64 check.
export const STRING_FIELDS = [
  "spec_version", "title", "summary", "content_type", "created_date",
  "license", "privacy_level", "quarantine_status",
];

// Vocabulary canonical values (spec §8). Custom values are not invalid, but
// trigger a `warnings` conformance level if they are not prefix-namespaced.
export const CANONICAL_VOCAB = {
  content_type: new Set(["original", "synthesis", "adaptation", "compression",
                         "annotation", "seed", "collection", "translation"]),
  quarantine_status: new Set(["quarantine", "trusted", "rejected"]),
  privacy_level: new Set(["public", "internal", "sensitive", "restricted"]),
  identity_status: new Set(["declared", "signed"]),
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const BEGIN_MARKER = "-----BEGIN KNOBE B64-----";
const END_MARKER = "-----END KNOBE B64-----";
const BLOCK_RE = /(?:^|\n)-----BEGIN KNOBE B64-----\n([\s\S]*?)\n-----END KNOBE B64-----/g;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

class DuplicateKeyError extends Error {
  constructor(key) { super(String(key)); this.name = "DuplicateKeyError"; this.key = key; }
}

/** Wraps a JSON float so canonicalization can reproduce Python's repr(),
 * which ALWAYS shows a decimal point (1.0, 100.0, -0.0). A bare JS number
 * loses the 1-vs-1.0 distinction (Number("1.0") === 1). Produced only by
 * parseNumber for lexemes containing '.', 'e', or 'E'. Bare numbers are a
 * §5 violation regardless — this exists so integrity still evaluates
 * byte-identically to lens.py even on non-conformant input. */
class KFloat {
  constructor(n) { this.n = n; }
  toJSON() { return this.n; }
}

/** Python-style type name for a parsed JSON value (message parity). */
function pyTypeName(x) {
  if (x === null) return "NoneType";
  if (x instanceof KFloat) return "float";
  if (Array.isArray(x)) return "list";
  switch (typeof x) {
    case "string": return "str";
    case "boolean": return "bool";
    case "bigint": return "int";
    case "number": return Number.isInteger(x) ? "int" : "float";
    case "object": return "dict";
    default: return typeof x;
  }
}

/** Python truthiness for JSON values ([]/{}/""/0/null/false are falsy). */
function pyTruthy(x) {
  if (x === null || x === undefined || x === false) return false;
  if (x === true) return true;
  if (x instanceof KFloat) return x.n !== 0;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "bigint") return x !== 0n;
  if (typeof x === "string") return x.length > 0;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === "object") return Object.keys(x).length > 0;
  return true;
}

function isDict(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x) && !(x instanceof KFloat);
}

/**
 * Render a (possibly payload-derived) value safely for display: escape
 * C0/C1 control characters and DEL so a crafted string cannot spoof a
 * report or inject ANSI/HTML control sequences. Port of lens.py safe().
 */
export function safe(value, limit = 300) {
  if (typeof value !== "string") {
    // approximate Python repr() for non-strings — display-only
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  }
  let out = "";
  for (const ch of value) {
    const o = ch.codePointAt(0);
    if (o < 0x20 || o === 0x7f || (o >= 0x80 && o <= 0x9f)) {
      out += "\\x" + o.toString(16).padStart(2, "0");
    } else if ((o >= 0x202a && o <= 0x202e) || (o >= 0x2066 && o <= 0x2069) || o === 0x2028 || o === 0x2029) {
      // Trojan-Source bidi controls (LRE/RLE/PDF/LRO/RLO, isolates) + line/para
      // separators — used to visually reorder displayed text. Escape for display;
      // legitimate RTL letters (not format controls) are left untouched.
      out += "\\u" + o.toString(16).padStart(4, "0");
    } else {
      out += ch;
    }
  }
  if (out.length > limit) out = out.slice(0, limit) + "…";
  return out;
}

/** NFC-normalize a string; identity for anything else. */
const nfc = (s) => (typeof s === "string" ? s.normalize("NFC") : s);

/** Compare two strings by Unicode CODE POINT (Python str ordering), not
 * UTF-16 code units — they differ for astral-plane characters. */
function cpCompare(a, b) {
  const A = Array.from(a), B = Array.from(b);
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const ca = A[i].codePointAt(0), cb = B[i].codePointAt(0);
    if (ca !== cb) return ca - cb;
  }
  return A.length - B.length;
}

/** True if any string (key or value) in the structure is not well-formed
 * UTF-16 (contains a lone surrogate). Such strings cannot be UTF-8
 * canonicalized. (lens.py, given the same input via a \uD800 escape,
 * crashes at canon.encode(); we reject cleanly instead — see NOTES.md.) */
function hasIllFormed(x) {
  if (typeof x === "string") {
    if (typeof x.isWellFormed === "function") return !x.isWellFormed();
    return /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(x);
  }
  if (Array.isArray(x)) return x.some(hasIllFormed);
  if (isDict(x)) {
    for (const k of Object.keys(x)) {
      if (hasIllFormed(k) || hasIllFormed(x[k])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Strict JSON parser
// ---------------------------------------------------------------------------
// JSON.parse cannot reject duplicate keys (last silently wins), which the
// protocol treats as ambiguous → unreadable. So we parse by hand: RFC 8259
// strict, duplicate keys rejected at any depth, objects created with a null
// prototype (immune to prototype pollution via "__proto__" keys), integer
// lexemes beyond 2^53 parsed as BigInt (arbitrary precision, like Python).
// NaN/Infinity are simply not valid JSON here (Python needs parse_constant
// to reject them; strictness is the default in this grammar).

export function parseJSONStrict(text) {
  let i = 0;

  const fail = (msg) => { throw new SyntaxError(`${msg} at offset ${i}`); };
  const ws = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };

  function parseValue() {
    ws();
    if (i >= text.length) fail("unexpected end of input");
    const c = text[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    if (text.startsWith("true", i)) { i += 4; return true; }
    if (text.startsWith("false", i)) { i += 5; return false; }
    if (text.startsWith("null", i)) { i += 4; return null; }
    fail("unexpected token");
  }

  function parseObject() {
    i++; // consume {
    const obj = Object.create(null);
    const seen = new Set();
    ws();
    if (text[i] === "}") { i++; return obj; }
    for (;;) {
      ws();
      if (text[i] !== '"') fail("expected string key");
      const key = parseString();
      if (seen.has(key)) throw new DuplicateKeyError(key);
      seen.add(key);
      ws();
      if (text[i] !== ":") fail("expected ':'");
      i++;
      obj[key] = parseValue();
      ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; return obj; }
      fail("expected ',' or '}'");
    }
  }

  function parseArray() {
    i++; // consume [
    const arr = [];
    ws();
    if (text[i] === "]") { i++; return arr; }
    for (;;) {
      arr.push(parseValue());
      ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; return arr; }
      fail("expected ',' or ']'");
    }
  }

  function parseString() {
    i++; // consume opening quote
    let s = "";
    for (;;) {
      if (i >= text.length) fail("unterminated string");
      const c = text[i];
      if (c === '"') { i++; return s; }
      if (c === "\\") {
        i++;
        const e = text[i];
        if (e === '"') s += '"';
        else if (e === "\\") s += "\\";
        else if (e === "/") s += "/";
        else if (e === "b") s += "\b";
        else if (e === "f") s += "\f";
        else if (e === "n") s += "\n";
        else if (e === "r") s += "\r";
        else if (e === "t") s += "\t";
        else if (e === "u") {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid \\u escape");
          s += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else fail("invalid escape");
        i++;
      } else {
        if (c.charCodeAt(0) < 0x20) fail("control character in string");
        s += c;
        i++;
      }
    }
  }

  function parseNumber() {
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "0") i++;
    else if (text[i] >= "1" && text[i] <= "9") { while (text[i] >= "0" && text[i] <= "9") i++; }
    else fail("invalid number");
    let isInt = true;
    if (text[i] === ".") {
      isInt = false; i++;
      if (!(text[i] >= "0" && text[i] <= "9")) fail("invalid number");
      while (text[i] >= "0" && text[i] <= "9") i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      isInt = false; i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!(text[i] >= "0" && text[i] <= "9")) fail("invalid number");
      while (text[i] >= "0" && text[i] <= "9") i++;
    }
    const lexeme = text.slice(start, i);
    if (isInt) {
      const n = Number(lexeme);
      // Beyond 2^53, Number loses precision; BigInt keeps Python-int parity.
      return Number.isSafeInteger(n) ? n : BigInt(lexeme);
    }
    return new KFloat(Number(lexeme));   // preserve float-ness for canon parity
  }

  const v = parseValue();
  ws();
  if (i !== text.length) fail("trailing content");
  return v;
}

// ---------------------------------------------------------------------------
// Canonicalization + hashing (spec §5 — FROZEN)
// ---------------------------------------------------------------------------

/**
 * Python-repr-compatible rendering of a JSON number, so that canonical
 * serialization matches json.dumps() exactly.
 *
 * Integers: full digits, never exponent (ints beyond 2^53 arrive as BigInt
 * from parseJSONStrict, preserving every digit like Python's int).
 * Floats: Python repr() = shortest round-trip digits, fixed notation for
 * 1e-4 ≤ |x| < 1e16, else exponent form with sign and ≥2-digit exponent.
 * (Bare numerics are a §5 violation and conformance-invalid regardless —
 * this exists so integrity still evaluates byte-identically to lens.py.)
 */
function pyNumberRepr(x) {
  if (typeof x === "bigint") return x.toString();
  if (!Number.isFinite(x)) throw new Error("non-finite number cannot be canonicalized");
  if (Number.isInteger(x) && Math.abs(x) < 1e16) {
    return Object.is(x, -0) ? "0" : String(x);   // JS integer -> Python int repr
  }
  return pyFloatRepr(x);
}

/**
 * Python float repr() — reproduces json.dumps(float) exactly. ALWAYS shows a
 * decimal point (1.0, 100.0, 1000000000000000.0), preserves -0.0, uses
 * shortest round-trip digits, fixed notation for 1e-4 ≤ |x| < 1e16 and
 * exponent form (mantissa, 'e', sign, ≥2-digit exponent) otherwise.
 * This is why parseNumber wraps floats in KFloat: a whole-valued float like
 * 1.0 must serialize as "1.0", not "1", or the §5 hash diverges from lens.py.
 */
function pyFloatRepr(x) {
  if (Object.is(x, -0)) return "-0.0";
  if (!Number.isFinite(x)) throw new Error("non-finite number cannot be canonicalized");
  const exp = x.toExponential();               // shortest round-trip, e.g. "1e+0", "1.5e+22"
  const m = exp.match(/^(-?)(\d)(?:\.(\d+))?e([+-])(\d+)$/);
  if (!m) return String(x);                    // unreachable for finite numbers
  const [, sign, lead, fracRaw, esign, edigitsRaw] = m;
  const frac = fracRaw || "";
  const e10 = (esign === "-" ? -1 : 1) * parseInt(edigitsRaw, 10);
  if (e10 >= 16 || e10 < -4) {
    const mant = frac ? `${lead}.${frac}` : lead;
    const edigits = String(Math.abs(e10)).padStart(2, "0");
    return `${sign}${mant}e${e10 < 0 ? "-" : "+"}${edigits}`;
  }
  const digits = lead + frac;
  let out;
  if (e10 >= 0) {
    if (e10 + 1 >= digits.length) out = digits.padEnd(e10 + 1, "0") + ".0";   // whole -> ".0"
    else out = digits.slice(0, e10 + 1) + "." + digits.slice(e10 + 1);
  } else {
    out = "0." + "0".repeat(-e10 - 1) + digits;
  }
  return sign + out;
}

/**
 * Serialize a parsed JSON value exactly as Python's
 * json.dumps(obj, sort_keys=True, separators=(",",":"), ensure_ascii=False)
 * after recursive NFC normalization of keys and string values.
 * JSON.stringify's string escaping is byte-identical to Python's for
 * well-formed strings (", \, and C0 controls escaped; everything else
 * literal UTF-8), which the parity suite confirms.
 */
export function canonicalize(x) {
  if (x === null) return "null";
  if (x instanceof KFloat) return pyFloatRepr(x.n);
  switch (typeof x) {
    case "boolean": return x ? "true" : "false";
    case "number":
    case "bigint": return pyNumberRepr(x);
    case "string": return JSON.stringify(nfc(x));
  }
  if (Array.isArray(x)) return "[" + x.map(canonicalize).join(",") + "]";
  const entries = Object.keys(x).map((k) => [nfc(k), x[k]]);
  entries.sort((a, b) => cpCompare(a[0], b[0]));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v)).join(",") + "}";
}

/** SHA-256 of a string's UTF-8 bytes, as 64 lowercase hex chars. */
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute the §5 payload hash of a payload object (payload_hash removed,
 * NFC, sorted keys, compact, UTF-8, SHA-256).
 */
export async function computePayloadHash(payload) {
  const rest = {};
  for (const k of Object.keys(payload)) {
    if (k !== "payload_hash") rest[k] = payload[k];
  }
  return sha256Hex(canonicalize(rest));
}

// ---------------------------------------------------------------------------
// Body normalization (for the optional body_hash)
// ---------------------------------------------------------------------------

// Python str.strip() whitespace (Unicode) — differs from JS trim() at the
// edges: Python strips \x1c-\x1f and \x85 but NOT U+FEFF; JS is the reverse.
const PY_WS_EDGE =
  "[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+";
function pyStrip(s) {
  return s
    .replace(new RegExp("^" + PY_WS_EDGE), "")
    .replace(new RegExp(PY_WS_EDGE + "$"), "");
}

/** Spec body normalization: strip whole body; CRLF and lone CR → LF; strip
 * only U+0020 and U+0009 from each line end; no Unicode normalization. */
export function normalizeBody(text) {
  let t = pyStrip(text);
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return t.split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n");
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (display header; spec_version cross-check)
// ---------------------------------------------------------------------------

/**
 * Returns { ok, fmSpec, reason }. ok is true only when a YAML frontmatter
 * block is present: first line exactly '---' and a later line exactly '---'.
 * fmSpec is the frontmatter's declared spec_version if found before the
 * closing delimiter. Port of lens.py parse_frontmatter().
 */
export function parseFrontmatter(raw) {
  if (raw.startsWith("﻿")) raw = raw.slice(1);
  const lines = raw.split("\n");
  if (!lines.length || lines[0].replace(/\r+$/, "") !== "---") {
    return { ok: false, fmSpec: null, reason: "missing opening '---' frontmatter delimiter" };
  }
  let fmSpec = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r+$/, "");
    if (line === "---") return { ok: true, fmSpec, reason: null };
    const m = line.match(/^\s*spec_version\s*:\s*(.+?)\s*$/);
    if (m && fmSpec === null) {
      fmSpec = m[1].trim().replace(/^["']+/, "").replace(/["']+$/, "");
    }
  }
  return { ok: false, fmSpec, reason: "missing closing '---' frontmatter delimiter" };
}

/**
 * Given the text before the last BEGIN marker, return the offset where the
 * body begins: immediately after the closing '---' frontmatter line.
 * Line-exact. Returns null if no frontmatter. Port of _find_body_start().
 */
function findBodyStart(pre) {
  if (!(pre.startsWith("---\n") || pre.startsWith("---\r\n"))) return null;
  let idx = pre.indexOf("\n") + 1; // start of line 2
  for (;;) {
    const nl = pre.indexOf("\n", idx);
    const line = nl !== -1 ? pre.slice(idx, nl) : pre.slice(idx);
    if (line.replace(/\r+$/, "") === "---") {
      return nl !== -1 ? nl + 1 : pre.length;
    }
    if (nl === -1) return null;
    idx = nl + 1;
  }
}

// ---------------------------------------------------------------------------
// Base64 (strict, Python b64decode(validate=True) parity)
// ---------------------------------------------------------------------------

function b64decodeStrict(s) {
  const clean = s.replace(/\s+/gu, ""); // Python: "".join(block.split())
  if (clean.length % 4 !== 0) throw new Error("invalid base64 length");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("invalid base64 alphabet");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
  return bytes;
}

function b64encodeWrapped(str, width = 76) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const lines = [];
  for (let j = 0; j < b64.length; j += width) lines.push(b64.slice(j, j + width));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Structural scans (ports of find_numeric_paths / find_nfc_collisions)
// ---------------------------------------------------------------------------

function findNumericPaths(obj, path = "") {
  const out = [];
  if (typeof obj === "boolean") return out;
  if (typeof obj === "number" || typeof obj === "bigint" || obj instanceof KFloat) {
    out.push(path);
  } else if (isDict(obj)) {
    for (const k of Object.keys(obj)) {
      out.push(...findNumericPaths(obj[k], path ? `${path}.${k}` : k));
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...findNumericPaths(v, `${path}[${i}]`)));
  }
  return out;
}

const pyRepr = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

function findNfcCollisions(obj, path = "") {
  const out = [];
  if (isDict(obj)) {
    const normToOrig = new Map();
    for (const k of Object.keys(obj)) {
      const nk = nfc(k);
      if (normToOrig.has(nk) && normToOrig.get(nk) !== k) {
        const where = path ? `${path}.${k}` : String(k);
        out.push(`${pyRepr(where)} collides with ${pyRepr(normToOrig.get(nk))} under NFC`);
      } else if (!normToOrig.has(nk)) {
        normToOrig.set(nk, k);
      }
    }
    for (const k of Object.keys(obj)) {
      out.push(...findNfcCollisions(obj[k], path ? `${path}.${k}` : String(k)));
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...findNfcCollisions(v, `${path}[${i}]`)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conformance (port of check_conformance)
// ---------------------------------------------------------------------------

function isRealDate(iso) {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

function checkConformance(payload, missing, fmOk, fmReason, fmSpec, blockCount) {
  const errors = [];   // -> invalid
  const warnings = []; // -> warnings (only surfaced if no errors)

  // 1. Frontmatter presence (independent of body_hash).
  if (!fmOk) {
    errors.push(`YAML frontmatter missing or malformed: ${fmReason}`);
  } else if (fmSpec !== null && typeof payload.spec_version === "string"
             && fmSpec !== payload.spec_version) {
    warnings.push(`frontmatter spec_version ${pyRepr(fmSpec)} does not match `
                + `sealed payload spec_version ${pyRepr(payload.spec_version)}`);
  }

  // 2. Missing required fields -> invalid
  for (const m of missing) errors.push(`required field missing: ${m}`);

  // 3. Required-field types (spec §4): listed fields MUST be strings.
  for (const field of STRING_FIELDS) {
    if (field in payload && typeof payload[field] !== "string") {
      errors.push(`required field ${field} must be a string, got ${pyTypeName(payload[field])}`);
    }
  }

  // 4. attribution structure: object with a non-empty sources array.
  const att = payload.attribution ?? null;
  if (att !== null) {
    if (!isDict(att)) {
      errors.push(`attribution must be an object, got ${pyTypeName(att)}`);
    } else {
      const src = att.sources ?? null;
      if (src !== null && !Array.isArray(src)) {
        errors.push(`attribution.sources must be an array, got ${pyTypeName(src)}`);
      } else if (Array.isArray(src) && src.length === 0) {
        errors.push("attribution.sources must be a non-empty array");
      }
    }
  }

  // 5. payload_hash format (spec §4)
  const ph = payload.payload_hash ?? null;
  if (ph !== null && !(typeof ph === "string" && HEX64.test(ph))) {
    errors.push("payload_hash format invalid (must be 64 lowercase hex)");
  }

  // 6. body_hash format if present (spec §4)
  const bh = payload.body_hash ?? null;
  if (bh !== null && !(typeof bh === "string" && HEX64.test(bh))) {
    errors.push("body_hash format invalid (must be 64 lowercase hex)");
  }

  // 7. created_date: ISO shape AND a real calendar date (spec §4)
  const cd = payload.created_date ?? null;
  if (cd !== null) {
    if (!(typeof cd === "string" && ISO_DATE.test(cd))) {
      errors.push(`created_date is not in YYYY-MM-DD form: ${typeof cd === "string" ? pyRepr(cd) : safe(cd)}`);
    } else if (!isRealDate(cd)) {
      errors.push(`created_date is not a real calendar date: ${pyRepr(cd)}`);
    }
  }

  // 8. Numeric values (spec §5 — all numerics MUST be strings)
  const scan = {};
  for (const k of Object.keys(payload)) if (k !== "payload_hash") scan[k] = payload[k];
  const numericPaths = findNumericPaths(scan);
  if (numericPaths.length) {
    const shown = numericPaths.length <= 5 ? numericPaths : [...numericPaths.slice(0, 5), "..."];
    errors.push(`bare numeric value(s) in payload (spec §5 requires strings): ${shown.join(", ")}`);
  }

  // 9. Parent hash format (spec §4)
  const parents = pyTruthy(payload.parents) ? payload.parents : [];
  if (Array.isArray(parents)) {
    parents.forEach((parent, i) => {
      if (isDict(parent) && "payload_hash" in parent) {
        const pph = parent.payload_hash;
        if (typeof pph !== "string" || !HEX64.test(pph)) {
          errors.push(`parents[${i}].payload_hash format invalid (must be 64 lowercase hex)`);
        }
      }
    });
  }

  // 10. Multiple payload blocks (spec §3.3) -> warnings
  if (blockCount > 1) {
    warnings.push(`multiple payload blocks present (${blockCount}); `
                + `evaluated the last block per spec §3.3`);
  }

  // 11. Vocabulary — custom values without namespace -> warnings only
  for (const [field, canon] of Object.entries(CANONICAL_VOCAB)) {
    const v = payload[field];
    if (v === null || v === undefined || typeof v !== "string" || canon.has(v)) continue;
    if (!v.includes(":") && !v.startsWith("ext-")) {
      warnings.push(`${field}: ${pyRepr(v)} is a custom vocabulary value without `
                  + `namespace prefix (recommend 'ext-' or 'domain:' per §8)`);
    }
  }

  if (errors.length) return ["invalid", [...errors, ...warnings]];
  if (warnings.length) return ["warnings", warnings];
  return ["valid", []];
}

// ---------------------------------------------------------------------------
// Lens: verify
// ---------------------------------------------------------------------------

function unreadableReport(reason, blocks, payload = null) {
  const n = blocks.length;
  return {
    state: "unreadable", reason,
    conformance: "invalid", conformance_issues: [reason],
    multiple_blocks: n > 1, block_count: n, block_used: n,
    computed: null, stored: null, payload,
    body_verified: null, body: null, missing: [],
  };
}

/**
 * Verify a KNOBE. Input: the raw file as a string, Uint8Array, or
 * ArrayBuffer (bytes are UTF-8-decoded strictly, like lens.py).
 * Returns a report object with lens.py's exact keys and semantics.
 */
export async function verify(input) {
  let raw;
  if (typeof input === "string") {
    raw = input;
  } else {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    try {
      // ignoreBOM:true = keep U+FEFF as a character, matching Python's
      // bytes.decode('utf-8'); parseFrontmatter strips it itself.
      raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (e) {
      return unreadableReport(`file is not valid UTF-8: ${e.message}`, []);
    }
  }

  const blocks = Array.from(raw.matchAll(BLOCK_RE), (m) => m[1]);
  if (!blocks.length) return unreadableReport("no payload block found", blocks);

  // --- decode + parse the last block, rejecting ambiguous/illegal JSON ---
  let payload;
  try {
    const bytes = b64decodeStrict(blocks[blocks.length - 1]);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    payload = parseJSONStrict(text);
  } catch (e) {
    if (e instanceof DuplicateKeyError) {
      return unreadableReport(
        `payload contains duplicate JSON key: ${safe(e.key)} (ambiguous; rejected)`, blocks);
    }
    return unreadableReport("payload could not be decoded or parsed", blocks);
  }

  // P0-2: payload MUST be a JSON object
  if (!isDict(payload)) {
    return unreadableReport(`payload is not a JSON object (got ${pyTypeName(payload)})`, blocks);
  }

  // Lone UTF-16 surrogates cannot be UTF-8 canonicalized — reject cleanly.
  if (hasIllFormed(payload)) {
    return unreadableReport("payload could not be decoded or parsed", blocks);
  }

  // P0-4: NFC key collisions make canonicalization ambiguous -> reject
  const collisions = findNfcCollisions(payload);
  if (collisions.length) {
    return unreadableReport(
      "payload keys collide under NFC normalization: " + collisions.slice(0, 5).join("; "), blocks);
  }

  // P0-5: unsupported spec_version -> unreadable
  const sv = payload.spec_version;
  if (sv !== undefined && sv !== null && !SUPPORTED_SPEC_VERSIONS.has(sv)) {
    const svStr = typeof sv === "string" ? sv : canonicalize(sv);
    const r = unreadableReport(`unsupported spec_version: ${safe(svStr)}`, blocks, payload);
    r.conformance_issues = [
      `unsupported spec_version: ${safe(svStr)} `
      + `(this verifier supports ['${[...SUPPORTED_SPEC_VERSIONS].sort().join("', '")}'])`];
    return r;
  }

  // --- canonical hash (spec §5) — FROZEN ---
  const stored = payload.payload_hash ?? "";
  const computed = await computePayloadHash(payload);

  // --- required-field presence ---
  const missing = REQUIRED.filter((f) => !(f in payload));
  if ("attribution" in payload
      && !(isDict(payload.attribution) && pyTruthy(payload.attribution.sources))) {
    missing.push("attribution.sources");
  }

  let state = computed === stored ? "verified" : "failed";

  // --- frontmatter (validated regardless of body_hash presence) ---
  const { ok: fmOk, fmSpec, reason: fmReason } = parseFrontmatter(raw);

  // --- body_verified: yes / modified / omitted ---
  let bodyResult = null;
  let bodyVerified = "omitted";
  if (state === "verified" && "body_hash" in payload && blocks.length === 1) {
    const marker = "\n" + BEGIN_MARKER + "\n";
    const markerIdx = raw.lastIndexOf(marker);
    const pre = markerIdx !== -1 ? raw.slice(0, markerIdx) : "";
    const bodyStart = findBodyStart(pre);
    if (bodyStart === null) {
      return unreadableReport(
        "body_hash present but YAML frontmatter delimiters not found", blocks, payload);
    }
    const bodyText = pre.slice(bodyStart);
    const computedBody = await sha256Hex(normalizeBody(bodyText));
    if (computedBody === payload.body_hash) {
      bodyResult = "match"; bodyVerified = "yes";
    } else {
      bodyResult = "mismatch"; bodyVerified = "modified";
      state = "verified-body-modified";
    }
  }

  const [conformance, issues] = checkConformance(
    payload, missing, fmOk, fmReason, fmSpec, blocks.length);

  return {
    state, computed, stored, payload, missing,
    body: bodyResult, body_verified: bodyVerified,
    conformance, conformance_issues: issues,
    multiple_blocks: blocks.length > 1,
    block_count: blocks.length, block_used: blocks.length,
    reason: null,
  };
}

/** lens.py exit-code semantics for a report. */
export function exitCode(r) {
  if (r.state === "unreadable") return 2;
  if ((r.state === "verified" || r.state === "verified-body-modified")
      && (r.conformance === "valid" || r.conformance === "warnings")) return 0;
  return 1;
}

// ---------------------------------------------------------------------------
// Lens: read (parse + verify + present — the Reader capability)
// ---------------------------------------------------------------------------

/**
 * Read a KNOBE for presentation: runs verify(), then extracts the display
 * layers. Everything returned is UNTRUSTED content — render through safe()
 * or equivalent escaping; never as raw HTML.
 */
export async function read(input) {
  const report = await verify(input);
  let raw = typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        input instanceof ArrayBuffer ? new Uint8Array(input) : input);

  const fm = parseFrontmatter(raw);
  let body = null;
  const marker = "\n" + BEGIN_MARKER + "\n";
  const markerIdx = raw.lastIndexOf(marker);
  if (markerIdx !== -1 && report.block_count === 1) {
    const pre = raw.slice(0, markerIdx);
    const bodyStart = findBodyStart(pre);
    if (bodyStart !== null) body = pre.slice(bodyStart);
  }

  return { report, frontmatter: fm, body, payload: report.payload };
}

// ---------------------------------------------------------------------------
// Crystallizer: seal / create / transform
// ---------------------------------------------------------------------------

/** Recursively NFC-normalize keys and string values, coerce bare numbers to
 * strings (spec §5 requires string numerics), and drop undefined values.
 * Used at authoring intake so created payloads are canonical at rest. */
function normalizePayloadForAuthoring(x) {
  if (x === null) return null;
  switch (typeof x) {
    case "string": return nfc(x);
    case "boolean": return x;
    case "number": return pyNumberRepr(x);   // §5: numerics as strings
    case "bigint": return x.toString();
    case "undefined": return undefined;
  }
  if (Array.isArray(x)) {
    return x.map(normalizePayloadForAuthoring).filter((v) => v !== undefined);
  }
  const out = {};
  for (const k of Object.keys(x)) {
    const v = normalizePayloadForAuthoring(x[k]);
    if (v !== undefined) out[nfc(k)] = v;
  }
  return out;
}

/**
 * Seal a payload object: normalize for authoring, remove any stale
 * payload_hash, compute the §5 hash, and return { payload, payloadHash }
 * where payload carries the fresh payload_hash.
 */
export async function seal(payloadIn) {
  const normalized = normalizePayloadForAuthoring(payloadIn);
  delete normalized.payload_hash;
  const payloadHash = await sha256Hex(canonicalize(normalized));
  return { payload: { ...normalized, payload_hash: payloadHash }, payloadHash };
}

function yamlQuote(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** Serialize a sealed payload for storage: canonical form (sorted keys,
 * compact, literal UTF-8) INCLUDING payload_hash — matching how the
 * published vectors and examples are stored. */
function storedPayloadJSON(sealedPayload) {
  return canonicalize(sealedPayload);
}

/**
 * Create a complete .knobe.md file.
 *
 * fields: payload fields. Required (defaults in parentheses if omitted):
 *   title, summary, content_type ("original"), created_date (today),
 *   license ("CC BY 4.0"), privacy_level ("public"),
 *   quarantine_status ("quarantine"), attribution ({sources:[{author,contribution}]}).
 * body: markdown body (optional; if provided, body_hash is sealed in).
 *
 * Returns { text, payload, payloadHash, report } — report is a self-
 * verification of the emitted text; createKnobe throws if it is not
 * verified/valid-or-warnings (a Crystallizer must never emit a file that
 * fails its own Lens).
 */
export async function createKnobe({ fields = {}, body = "", author = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    spec_version: "1.0",
    title: fields.title ?? "Untitled KNOBE",
    summary: fields.summary ?? "",
    content_type: fields.content_type ?? "original",
    created_date: fields.created_date ?? today,
    license: fields.license ?? "CC BY 4.0",
    privacy_level: fields.privacy_level ?? "public",
    quarantine_status: fields.quarantine_status ?? "quarantine",
    identity_status: fields.identity_status ?? "declared",
    attribution: fields.attribution ?? {
      sources: [{
        author: author ?? "Anonymous",
        contribution: "author",
      }],
    },
    ...Object.fromEntries(Object.entries(fields).filter(([k]) =>
      !["title", "summary", "content_type", "created_date", "license",
        "privacy_level", "quarantine_status", "identity_status", "attribution",
        "payload_hash", "body_hash"].includes(k))),
  };

  const bodyText = body ? String(body) : "";
  if (bodyText) {
    payload.body_hash = await sha256Hex(normalizeBody(bodyText));
  }

  const { payload: sealed, payloadHash } = await seal(payload);

  const fmLines = [
    "---",
    `title: ${yamlQuote(sealed.title)}`,
    `spec_version: ${yamlQuote(sealed.spec_version)}`,
    `content_type: ${sealed.content_type}`,
    `license: ${sealed.license}`,
    `created_date: ${yamlQuote(sealed.created_date)}`,
    "---",
  ];
  const bodySection = bodyText ? `\n${bodyText.replace(/\s+$/, "")}\n` : "";
  const text = fmLines.join("\n") + "\n" + bodySection + "\n"
    + BEGIN_MARKER + "\n"
    + b64encodeWrapped(storedPayloadJSON(sealed)) + "\n"
    + END_MARKER + "\n";

  const report = await verify(text);
  if (!(report.state === "verified" || report.state === "verified-body-modified")
      || report.conformance === "invalid") {
    throw new Error(`createKnobe self-check failed: ${report.state}/${report.conformance} `
                  + `— ${report.conformance_issues.join("; ")}`);
  }
  return { text, payload: sealed, payloadHash, report };
}

/**
 * Create a derivative KNOBE from a verified original: carries
 * parents[{title, payload_hash}] lineage, a declared content_type for the
 * transformation, and the derivative's own body/payload.
 * The original MUST verify first — you cannot chain from a broken seal.
 */
export async function transformKnobe(originalInput, { fields = {}, body = "", author = null } = {}) {
  const orig = await verify(originalInput);
  if (orig.state !== "verified" && orig.state !== "verified-body-modified") {
    throw new Error(`cannot derive from an unverified KNOBE (status: ${orig.state})`);
  }
  const parentEntry = {
    title: typeof orig.payload.title === "string" ? orig.payload.title : "Untitled",
    payload_hash: orig.stored,
  };
  const mergedFields = {
    ...fields,
    content_type: fields.content_type ?? "adaptation",
    parents: [...(Array.isArray(fields.parents) ? fields.parents : []), parentEntry],
  };
  return createKnobe({ fields: mergedFields, body, author });
}

// ---------------------------------------------------------------------------
// Governance: permits (v1-honest policy evaluation)
// ---------------------------------------------------------------------------

// Action classes for governance evaluation.
const DISTRIBUTION_ACTIONS = new Set(["redistribute","distribute","publish","share","train","integrate"]);
const DERIVATIVE_ACTIONS = new Set(["transform","adapt","remix","summarize","translate","excerpt","annotate"]);

/**
 * Classify a license's redistribution/derivation posture. DEFAULT-DENY: an
 * unrecognized or rights-reserved license grants nothing beyond inspection,
 * so permits() never waves through distribution of "All rights reserved",
 * "Proprietary", or an unknown license string. Recognized-permissive (CC,
 * CC0 / public domain, common OSS) grant redistribution; a CC NoDerivatives
 * term blocks derivative works. This is deliberately conservative: a false
 * denial is safe, a false permit is not.
 */
function licensePosture(lic) {
  const L = (lic || "").trim();
  if (!L) return { known: false, redistribute: false, derive: false, note: "no license declared" };
  const U = L.toUpperCase();
  if (/ALL RIGHTS RESERVED|PROPRIETARY|CONFIDENTIAL/i.test(L) || U === "UNLICENSED")
    return { known: true, redistribute: false, derive: false, note: "rights reserved" };
  if (/\bCC0\b/i.test(L) || /PUBLIC DOMAIN/i.test(L))
    return { known: true, redistribute: true, derive: true, note: "public domain / CC0" };
  if (/\bCC\b|CREATIVE ?COMMONS/i.test(L)) {
    const nd = /\bND\b/i.test(L);
    return { known: true, redistribute: true, derive: !nd, note: nd ? "CC NoDerivatives" : "Creative Commons" };
  }
  if (/\b(MIT|BSD|APACHE|ISC|MPL|L?GPL|AGPL|ZLIB|UNLICENSE)\b/i.test(L) && U !== "UNLICENSED")
    return { known: true, redistribute: true, derive: true, note: "permissive open-source license" };
  return { known: false, redistribute: false, derive: false, note: "unrecognized license — no permission assumed" };
}

/**
 * Evaluate whether a proposed action is permitted by a KNOBE's SEALED
 * governance fields. v1 evaluates what is actually in the frozen spec —
 * integrity state, quarantine_status, privacy_level, license, attribution —
 * plus any namespaced extension fields (ext-* / prefix:*), which are
 * surfaced verbatim as obligations for the caller to honor.
 *
 * Returns { action, allowed: true|false|"conditional", obligations:[],
 *           basis:[{field, value, effect}], integrity:{state, conformance} }.
 * This tool cites clauses; it does not practice law. "conditional" means
 * the action is not forbidden by the sealed fields but carries obligations.
 */
export function permits(report, action) {
  const act = String(action || "").toLowerCase().trim();
  const basis = [];
  const obligations = [];
  let allowed = true;

  const integrity = { state: report.state, conformance: report.conformance };

  // Integrity gate: a broken or unreadable seal permits nothing.
  if (report.state === "failed" || report.state === "unreadable") {
    return {
      action: act, allowed: false, obligations: [],
      basis: [{
        field: "integrity", value: report.state,
        effect: report.state === "failed"
          ? "payload_hash mismatch — the sealed content has been altered; no sealed clause can be trusted"
          : `file is unreadable (${report.reason ?? "no payload"}) — there are no sealed clauses to evaluate`,
      }],
      integrity,
    };
  }

  const p = report.payload ?? {};

  if (report.state === "verified-body-modified") {
    obligations.push("the human-readable body differs from the sealed body_hash; "
      + "rely only on the sealed payload content");
    basis.push({ field: "body_verified", value: "modified",
      effect: "body text is not the sealed text" });
  }
  if (report.conformance === "invalid") {
    obligations.push("file is non-conformant with spec v1; treat all fields with caution");
    basis.push({ field: "conformance", value: "invalid",
      effect: report.conformance_issues.slice(0, 3).join("; ") });
  }

  // quarantine_status — the protocol's own trust posture.
  const q = typeof p.quarantine_status === "string" ? p.quarantine_status : null;
  if (q === "rejected") {
    allowed = false;
    basis.push({ field: "quarantine_status", value: q,
      effect: "object has been rejected; do not use its content for any purpose beyond inspection" });
  } else if (q === "quarantine") {
    basis.push({ field: "quarantine_status", value: q,
      effect: "object has not been reviewed and trusted yet" });
    if (DISTRIBUTION_ACTIONS.has(act)) {
      allowed = false;
    } else {
      obligations.push("quarantined: inspect and establish trust before relying on the content");
      if (allowed === true) allowed = "conditional";
    }
  }

  // privacy_level — distribution constraints.
  const priv = typeof p.privacy_level === "string" ? p.privacy_level : null;
  if (priv && priv !== "public") {
    basis.push({ field: "privacy_level", value: priv,
      effect: `content is ${priv}; distribution beyond its intended audience is not permitted` });
    if (DISTRIBUTION_ACTIONS.has(act)) {
      allowed = false;
    } else {
      obligations.push(`privacy_level ${priv}: keep within the intended audience`);
      if (allowed === true) allowed = "conditional";
    }
  }

  // license — default-deny: cite the clause, and forbid distribution or
  // derivation the license does not actually grant (unknown = no permission).
  const lic = typeof p.license === "string" ? p.license : null;
  if (lic !== null) {
    const pos = licensePosture(lic);
    if (DISTRIBUTION_ACTIONS.has(act) && !pos.redistribute) {
      allowed = false;
      basis.push({ field: "license", value: lic, effect: `${pos.note}: redistribution is not licensed` });
    } else if (DERIVATIVE_ACTIONS.has(act) && !pos.derive) {
      allowed = false;
      basis.push({ field: "license", value: lic, effect: `${pos.note}: derivative works are not licensed` });
    } else {
      const U = lic.toUpperCase();
      if (/\bBY\b/.test(U)) {
        obligations.push(`license ${lic}: attribution to the sealed sources is required`);
        if (allowed === true) allowed = "conditional";
      }
      if (/\bNC\b/.test(U)) {
        obligations.push(`license ${lic}: commercial use is not licensed`);
        if (allowed === true) allowed = "conditional";
      }
      if (/\bSA\b/.test(U)) {
        obligations.push(`license ${lic}: derivatives must carry the same license`);
        if (allowed === true) allowed = "conditional";
      }
      if (!pos.known) {
        obligations.push(`license ${lic}: unrecognized — assume no permission beyond inspection`);
        if (allowed === true) allowed = "conditional";
      }
      basis.push({ field: "license", value: lic, effect: "sealed license clause" });
    }
  }

  // Namespaced extension fields — surfaced verbatim; the caller must honor
  // or explicitly decline them. This is how domain profiles carry
  // obligations (e.g. "edu:fidelity": "verbatim") without breaking v1.
  for (const k of Object.keys(p)) {
    if (k.startsWith("ext-") || (k.includes(":") && typeof k === "string")) {
      obligations.push(`extension field ${k}: ${safe(canonicalize(p[k]), 120)} `
        + "(namespaced obligation — honor it or explicitly decline)");
      basis.push({ field: k, value: p[k], effect: "namespaced extension obligation" });
      if (allowed === true) allowed = "conditional";
    }
  }

  // Attribution travels with every use.
  const att = p.attribution;
  if (isDict(att) && Array.isArray(att.sources) && att.sources.length && allowed !== false) {
    obligations.push("attribution: preserve the sealed sources in any downstream use");
    if (allowed === true) allowed = "conditional";
  }

  return { action: act, allowed, obligations, basis, integrity };
}

export { DuplicateKeyError };
