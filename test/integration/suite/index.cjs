// Runs inside the VS Code extension host. No mocha: a small sequential
// runner so the suite has no extra dependencies.
const vscode = require("vscode");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const WS = process.env.KNOBE_IT_WORKSPACE;
const CAVEAT = "A match proves integrity, not truth. Inspect before trusting.";
const cp = (...n) => String.fromCodePoint(...n);
const UNSAFE = new RegExp("[" + cp(0) + "-" + cp(0x1f) + cp(0x7f) + "-" + cp(0x9f)
  + cp(0x202a) + "-" + cp(0x202e) + cp(0x2066) + "-" + cp(0x2069) + cp(0x2028) + cp(0x2029) + "]", "u");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let api;
async function getApi() {
  if (api) return api;
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "knobe-verify-vscode");
  assert.ok(ext, "extension not found");
  api = await ext.activate();
  return api;
}

async function open(rel) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(WS, rel)));
  await vscode.window.showTextDocument(doc);
  const a = await getApi();
  await sleep(80); // let the open/debounce fire
  await a.whenSettled(doc.uri);
  return { doc, a, status: a.getStatus(doc.uri) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await sleep(25); }
  assert.fail("timed out waiting for condition");
}

// Expected results from the upstream README tables bundled with the vectors,
// the same source the unit tests read.
const { expectations } = require(path.join(__dirname, "..", "..", "vector-expectations.cjs"));
const ROWS = expectations();

test("the suite covers every bundled vector", async () => {
  const onDisk = (await vscode.workspace.findFiles("vectors/**/*.knobe.md"))
    .map((u) => path.relative(path.join(WS, "vectors"), u.fsPath).split(path.sep).join("/")).sort();
  assert.deepEqual(ROWS.map((r) => r.file).sort(), onDisk);
});

for (const { file, state, bodyVerified, conformance } of ROWS) {
  test(`opening ${file} shows ${state} / ${bodyVerified} / ${conformance}`, async () => {
    const { a, status } = await open(`vectors/${file}`);
    assert.equal(status.kind, "verified", JSON.stringify(status));
    assert.equal(status.verdict.state, state);
    assert.equal(status.verdict.bodyVerified, bodyVerified);
    assert.equal(status.verdict.conformance, conformance);
    const bar = a.statusBar();
    assert.ok(bar.visible);
    assert.ok(bar.text.includes(`KNOBE: ${state}, ${conformance}`), bar.text);
    assert.ok(bar.tooltip.includes(CAVEAT));
    assert.ok(bar.tooltip.includes(`Body verified: ${bodyVerified}`));
    for (const line of bar.tooltip.split("\n")) {
      assert.ok(!UNSAFE.test(line) && line.isWellFormed(), JSON.stringify(line));
    }
  });
}

test("control-character-title: escaped in tooltip and details document", async () => {
  const { a } = await open("vectors/adversarial/control-character-title.knobe.md");
  assert.ok(a.statusBar().tooltip.includes("\\x1b[31m"));
  await vscode.commands.executeCommand("knobeVerify.showDetails");
  await waitFor(() => vscode.workspace.textDocuments.some((d) => d.uri.scheme === "knobe-verify"
    && d.getText().includes("control-character-title")));
  const details = vscode.workspace.textDocuments.find((d) => d.uri.scheme === "knobe-verify"
    && d.getText().includes("control-character-title"));
  const text = details.getText();
  assert.ok(text.includes(CAVEAT));
  assert.ok(text.includes("Integrity: verified") && text.includes("Body verified: omitted")
    && text.includes("Conformance: valid"));
  for (const line of text.split("\n")) assert.ok(!UNSAFE.test(line), JSON.stringify(line));
  assert.ok(!/^status:/m.test(text));
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
});

test("bidi-title: the right-to-left override is escaped in the details document", async () => {
  await open("vectors/adversarial/bidi-title.knobe.md");
  await vscode.commands.executeCommand("knobeVerify.showDetails");
  const isDetails = (d) => d.uri.scheme === "knobe-verify" && d.getText().includes("bidi-title");
  await waitFor(() => vscode.workspace.textDocuments.some(isDetails));
  const text = vscode.workspace.textDocuments.find(isDetails).getText();
  assert.ok(text.includes("Integrity: failed"));
  assert.ok(text.includes("Title (from payload, untrusted): ok" + "\\" + "u202egnikcol\n"));
  for (const line of text.split("\n")) assert.ok(!UNSAFE.test(line) && line.isWellFormed(), JSON.stringify(line));
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
});

test("edits clear the verdict; undo restores it; save re-verifies", async () => {
  const rel = "edit-me.knobe.md";
  fs.copyFileSync(path.join(WS, "vectors/interpretation/begin-marker-mid-line.knobe.md"), path.join(WS, rel));
  const { doc, a, status } = await open(rel);
  assert.equal(status.verdict.state, "verified");
  assert.equal(status.verdict.bodyVerified, "yes");

  const editor = vscode.window.activeTextEditor;
  const fmEnd = doc.getText().indexOf("\n---\n", 4) + 5;
  await editor.edit((e) => e.insert(doc.positionAt(fmEnd), "Tampered line.\n"));
  await waitFor(() => a.getStatus(doc.uri).kind === "stale");
  assert.ok(a.statusBar().text.includes("unsaved edits, no verdict"));
  assert.ok(!/KNOBE: verified/.test(a.statusBar().text));

  await vscode.commands.executeCommand("undo");
  await waitFor(() => !doc.isDirty);
  await sleep(80);
  await a.whenSettled(doc.uri);
  assert.equal(a.getStatus(doc.uri).verdict.state, "verified");

  await editor.edit((e) => e.insert(doc.positionAt(fmEnd), "Tampered line.\n"));
  await waitFor(() => a.getStatus(doc.uri).kind === "stale");
  await doc.save();
  await sleep(80);
  await a.whenSettled(doc.uri);
  const after = a.getStatus(doc.uri);
  assert.equal(after.kind, "verified");
  assert.equal(after.verdict.state, "verified-body-modified");
  assert.equal(after.verdict.bodyVerified, "modified");
  assert.ok(a.statusBar().text.includes("KNOBE: verified-body-modified, valid"));
});

test("external change on disk re-verifies an open, clean document", async () => {
  const rel = "disk-change.knobe.md";
  fs.copyFileSync(path.join(WS, "vectors/minimal-valid.knobe.md"), path.join(WS, rel));
  const { doc, a } = await open(rel);
  assert.equal(a.getStatus(doc.uri).verdict.state, "verified");
  fs.copyFileSync(path.join(WS, "vectors/payload-modified.knobe.md"), path.join(WS, rel));
  await waitFor(() => a.getStatus(doc.uri)?.verdict?.state === "failed", 10000);
});

test("above the size limit, auto-verify steps aside; the command still verifies", async () => {
  const cfg = vscode.workspace.getConfiguration("knobeVerify");
  await cfg.update("autoVerifyMaxSizeKB", 0, vscode.ConfigurationTarget.Workspace);
  try {
    const rel = "big.knobe.md";
    fs.copyFileSync(path.join(WS, "vectors/full-valid.knobe.md"), path.join(WS, rel));
    const { doc, a, status } = await open(rel);
    assert.equal(status.kind, "skipped-size");
    assert.ok(a.statusBar().text.includes("large file, click to verify"));
    await vscode.commands.executeCommand("knobeVerify.verify");
    await a.whenSettled(doc.uri);
    assert.equal(a.getStatus(doc.uri).verdict.state, "verified");
  } finally {
    await cfg.update("autoVerifyMaxSizeKB", undefined, vscode.ConfigurationTarget.Workspace);
  }
});

test("autoVerify off: open shows no verdict; command verifies; edit+save clears it again", async () => {
  const cfg = vscode.workspace.getConfiguration("knobeVerify");
  await cfg.update("autoVerify", false, vscode.ConfigurationTarget.Workspace);
  try {
    const rel = "manual.knobe.md";
    fs.copyFileSync(path.join(WS, "vectors/interpretation/begin-marker-mid-line.knobe.md"), path.join(WS, rel));
    const { doc, a, status } = await open(rel);
    assert.equal(status.kind, "manual");
    assert.ok(a.statusBar().text.includes("not verified, click to verify"));
    await vscode.commands.executeCommand("knobeVerify.verify");
    await a.whenSettled(doc.uri);
    assert.equal(a.getStatus(doc.uri).verdict.state, "verified");
    const editor = vscode.window.activeTextEditor;
    await editor.edit((e) => e.insert(doc.positionAt(doc.getText().indexOf("\n---\n", 4) + 5), "x\n"));
    await waitFor(() => a.getStatus(doc.uri).kind === "stale");
    await doc.save();
    await waitFor(() => a.getStatus(doc.uri).kind === "manual");
  } finally {
    await cfg.update("autoVerify", undefined, vscode.ConfigurationTarget.Workspace);
  }
});

test("status bar hides for non-KNOBE files", async () => {
  const p = path.join(WS, "plain.md");
  fs.writeFileSync(p, "# plain\n");
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
  await vscode.window.showTextDocument(doc);
  const a = await getApi();
  await waitFor(() => !a.statusBar().visible);
});

exports.run = async function run() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok   ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${t.name}\n       ${e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} integration tests passed`);
  if (failed) throw new Error(`${failed} integration test(s) failed`);
};
