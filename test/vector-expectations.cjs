// Expected verification results, read from the upstream READMEs that ship
// with the vectors in test/fixtures/vectors, so a vector added upstream is
// checked as soon as it is copied in, with no hand-typed list to fall behind.
// CommonJS so the integration suite, which runs inside the extension host,
// can require it as the unit tests do.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const VECTORS = path.join(__dirname, "fixtures", "vectors");
/** Folders whose README.md holds an expected-results table. */
const SETS = ["", "adversarial", "interpretation"];

const EM_DASH = String.fromCodePoint(0x2014);
const STATES = ["verified", "verified-body-modified", "failed", "unreadable"];
const BODIES = ["yes", "modified", "omitted"];
const LEVELS = ["valid", "warnings", "invalid"];
const COLUMNS = ["status", "body_verified", "conformance"];

/** First word of a cell: "verified (last block)" gives "verified". */
const firstWord = (cell) => cell.split(/[\s(]/)[0];

/**
 * Rows of one set's README. Rows are read by column position, so each must
 * sit under a header whose columns were checked first: a renamed, missing or
 * reordered column throws here instead of comparing the wrong values.
 * An em dash in body_verified is read as "omitted" only on an unreadable
 * row, where it is spec section 7's mandated "omitted" (ERRATA E11), which is
 * how this extension shows it. On any other row it could mean "not stated",
 * so it is an unrecognized result there.
 */
function readmeRows(set) {
  const readme = path.join(set, "README.md");
  const rows = [];
  let underHeader = false;
  for (const line of fs.readFileSync(path.join(VECTORS, readme), "utf8").split("\n")) {
    if (!line.startsWith("|")) {
      underHeader = false;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0].toLowerCase() === "file") {
      const columns = cells.slice(1, 4).map((c) => c.replace(/^expected /, ""));
      if (columns.join() !== COLUMNS.join()) throw new Error(`${readme}: unexpected columns ${columns.join(", ")}`);
      underHeader = true;
      continue;
    }
    const file = /^`([^`]+\.knobe\.md)`$/.exec(cells[0])?.[1];
    if (!file) continue; // the |---| separator row
    if (!underHeader) throw new Error(`${readme}: ${file} is not under a recognized header`);
    const [state, body, conformance] = cells.slice(1, 4).map(firstWord);
    const bodyVerified = body === EM_DASH && state === "unreadable" ? "omitted" : body;
    if (!STATES.includes(state) || !BODIES.includes(bodyVerified) || !LEVELS.includes(conformance)) {
      throw new Error(`${readme}: ${file} has an unrecognized result: ${state} / ${body} / ${conformance}`);
    }
    rows.push({ set, file: set ? `${set}/${file}` : file, state, bodyVerified, conformance });
  }
  if (rows.length === 0) throw new Error(`${readme} has no vector rows`);
  return rows;
}

/** Every README row, core set first. */
function expectations() {
  return SETS.flatMap(readmeRows);
}

/** Every *.knobe.md under the fixtures folder, at any depth, sorted. */
function bundledVectors(dir = VECTORS) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return bundledVectors(p);
      return e.name.endsWith(".knobe.md") ? [path.relative(VECTORS, p).split(path.sep).join("/")] : [];
    })
    .sort();
}

module.exports = { VECTORS, SETS, expectations, bundledVectors };
