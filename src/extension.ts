import * as vscode from "vscode";
import { verifyInWorker } from "./engine";
import {
  accessibleLabel, detailsText, escapeControls, problemAnnouncement, severity, statusBarText, tooltipText,
} from "./present";
import type { DocStatus, Source } from "./types";

const DETAILS_SCHEME = "knobe-verify";
const DEBOUNCE_MS = 50;
// Hard ceilings, whatever the settings say, so a workspace's
// .vscode/settings.json cannot lift the safeguards (see package.json
// restrictedConfigurations for untrusted workspaces).
const MAX_AUTO_VERIFY_KB = 256 * 1024;
const MAX_TIMEOUT_S = 300;

export interface KnobeVerifyApi {
  /** Current status for a document URI (exposed for integration tests). */
  getStatus(uri: vscode.Uri): DocStatus | undefined;
  /** Resolves once no verification is in flight or scheduled for the URI. */
  whenSettled(uri: vscode.Uri): Promise<void>;
  /** The status bar item's current text, tooltip, and visibility. */
  statusBar(): { text: string; tooltip: string; visible: boolean };
}

export function isKnobe(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme !== DETAILS_SCHEME && doc.uri.path.toLowerCase().endsWith(".knobe.md");
}

function config() {
  const c = vscode.workspace.getConfiguration("knobeVerify");
  return {
    autoVerify: c.get<boolean>("autoVerify", true),
    maxBytes: clamp(c.get<number>("autoVerifyMaxSizeKB", 5120), 0, MAX_AUTO_VERIFY_KB) * 1024,
    timeoutMs: clamp(c.get<number>("timeoutSeconds", 30), 1, MAX_TIMEOUT_S) * 1000,
    announce: c.get<string>("announceProblems", "errors"),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

/** Read the saved bytes when a file system provider can serve them; fall
 * back to editor text only for documents with nothing readable behind them. */
async function readBytes(doc: vscode.TextDocument): Promise<{ bytes: Uint8Array; source: Source }> {
  if (!doc.isUntitled) {
    try {
      return { bytes: await vscode.workspace.fs.readFile(doc.uri), source: "disk" };
    } catch {
      // e.g. a git: diff view, which has a content provider but no file system
    }
  }
  return { bytes: new TextEncoder().encode(doc.getText()), source: "buffer" };
}

async function sizeOf(doc: vscode.TextDocument): Promise<number> {
  if (!doc.isUntitled) {
    try {
      return (await vscode.workspace.fs.stat(doc.uri)).size;
    } catch { /* fall through */ }
  }
  return Buffer.byteLength(doc.getText(), "utf8");
}

export function activate(context: vscode.ExtensionContext): KnobeVerifyApi {
  const statuses = new Map<string, DocStatus>();
  const generation = new Map<string, number>();
  const timers = new Map<string, { timer: NodeJS.Timeout; release: () => void }>();
  const inflight = new Map<string, Promise<void>>();
  const controllers = new Map<string, AbortController>();
  const announced = new Map<string, string>();
  const detailsChanged = new vscode.EventEmitter<vscode.Uri>();

  const item = vscode.window.createStatusBarItem("knobeVerify.status", vscode.StatusBarAlignment.Left, 100);
  item.name = "KNOBE Verify";
  item.command = "knobeVerify.showDetails";
  let itemVisible = false;

  const key = (uri: vscode.Uri) => uri.toString();
  /** Supersede whatever is scheduled or running for k. */
  const bump = (k: string) => {
    controllers.get(k)?.abort();
    controllers.delete(k);
    const g = (generation.get(k) ?? 0) + 1;
    generation.set(k, g);
    return g;
  };

  function detailsUriFor(uri: vscode.Uri): vscode.Uri {
    const base = escapeControls(uri.path.split("/").pop() ?? "file");
    return vscode.Uri.from({
      scheme: DETAILS_SCHEME, path: `/${base} (verification).txt`, query: encodeURIComponent(uri.toString()),
    });
  }

  function setStatus(uri: vscode.Uri, status: DocStatus) {
    statuses.set(key(uri), status);
    detailsChanged.fire(detailsUriFor(uri));
    render();
  }

  function render() {
    const doc = vscode.window.activeTextEditor?.document;
    const status = doc && isKnobe(doc) ? statuses.get(key(doc.uri)) : undefined;
    if (!doc || !status) {
      item.hide();
      itemVisible = false;
      return;
    }
    item.text = statusBarText(status);
    item.tooltip = tooltipText(status);
    item.accessibilityInformation = { label: accessibleLabel(status), role: "button" };
    const sev = severity(status);
    item.backgroundColor = sev === "none" ? undefined
      : new vscode.ThemeColor(sev === "error" ? "statusBarItem.errorBackground" : "statusBarItem.warningBackground");
    item.command = status.kind === "skipped-size" || status.kind === "manual"
      ? "knobeVerify.verify" : "knobeVerify.showDetails";
    item.show();
    itemVisible = true;
  }

  async function verifyNow(doc: vscode.TextDocument, explicit: boolean): Promise<void> {
    const k = key(doc.uri);
    const gen = bump(k);
    if (doc.isDirty) {
      setStatus(doc.uri, { kind: "stale" });
      return;
    }
    const { maxBytes, timeoutMs } = config();
    const size = await sizeOf(doc);
    if (generation.get(k) !== gen) return;
    if (!explicit && size > maxBytes) {
      setStatus(doc.uri, { kind: "skipped-size", size, limit: maxBytes });
      return;
    }
    setStatus(doc.uri, { kind: "pending" });
    const controller = new AbortController();
    controllers.set(k, controller);
    const { bytes, source } = await readBytes(doc);
    const outcome = await verifyInWorker(bytes, timeoutMs, controller.signal);
    // A newer request (edit, save, close) superseded this one: drop it.
    if (generation.get(k) !== gen || !statuses.has(k) || outcome.kind === "cancelled") return;
    controllers.delete(k);
    if (doc.isDirty) {
      setStatus(doc.uri, { kind: "stale" });
      return;
    }
    const status: DocStatus = outcome.kind === "done"
      ? { kind: "verified", verdict: outcome.verdict, source, checkedAt: new Date() }
      : outcome;
    setStatus(doc.uri, status);
    announce(doc, status);
  }

  /** Tell screen reader users (and anyone not watching the status bar) when
   * the active file's verdict needs attention. Announces once per distinct
   * result, not on every save; the text never includes payload strings. */
  function announce(doc: vscode.TextDocument, status: DocStatus) {
    const k = key(doc.uri);
    const a = problemAnnouncement(status);
    const { announce: mode } = config();
    if (!a) {
      announced.delete(k);
      return;
    }
    if (mode === "off" || (mode === "errors" && a.level !== "error")) return;
    if (announced.get(k) === a.text || vscode.window.activeTextEditor?.document !== doc) return;
    announced.set(k, a.text);
    void (a.level === "error" ? vscode.window.showErrorMessage(a.text) : vscode.window.showWarningMessage(a.text));
  }

  function track(doc: vscode.TextDocument, explicit: boolean): Promise<void> {
    const k = key(doc.uri);
    const p = verifyNow(doc, explicit).catch((e) =>
      setStatus(doc.uri, { kind: "error", message: e instanceof Error ? e.message : String(e) }));
    const tracked = p.finally(() => { if (inflight.get(k) === tracked) inflight.delete(k); });
    inflight.set(k, tracked);
    return tracked;
  }

  function cancelTimer(k: string) {
    const t = timers.get(k);
    if (!t) return;
    clearTimeout(t.timer);
    timers.delete(k);
    t.release();
  }

  /** Collapses the change+save events VS Code fires together on save. */
  function schedule(doc: vscode.TextDocument) {
    if (!isKnobe(doc)) return;
    const k = key(doc.uri);
    cancelTimer(k);
    bump(k); // invalidate anything in flight right away
    if (!config().autoVerify) {
      setStatus(doc.uri, doc.isDirty ? { kind: "stale" } : { kind: "manual" });
      return;
    }
    if (!statuses.has(k)) statuses.set(k, { kind: "pending" });
    let release!: () => void;
    const waiting = new Promise<void>((r) => { release = r; });
    inflight.set(k, waiting);
    const timer = setTimeout(() => {
      timers.delete(k);
      track(doc, false).then(release, release);
    }, DEBOUNCE_MS);
    timers.set(k, { timer, release });
    render();
  }

  function markStale(doc: vscode.TextDocument) {
    const k = key(doc.uri);
    cancelTimer(k);
    bump(k);
    setStatus(doc.uri, { kind: "stale" });
  }

  const contentProvider: vscode.TextDocumentContentProvider = {
    onDidChange: detailsChanged.event,
    provideTextDocumentContent(uri) {
      const target = vscode.Uri.parse(decodeURIComponent(uri.query));
      return detailsText(vscode.workspace.asRelativePath(target), statuses.get(key(target)));
    },
  };

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.knobe.md", true, false, true);
  const onDiskChange = (uri: vscode.Uri) => {
    const doc = vscode.workspace.textDocuments.find((d) => key(d.uri) === key(uri));
    if (doc && !doc.isDirty) schedule(doc);
  };

  context.subscriptions.push(
    item, detailsChanged, watcher,
    vscode.workspace.registerTextDocumentContentProvider(DETAILS_SCHEME, contentProvider),
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidSaveTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isKnobe(e.document)) return;
      if (e.document.isDirty) markStale(e.document);
      else if (statuses.get(key(e.document.uri))?.kind === "stale") schedule(e.document); // undo back to saved
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const k = key(doc.uri);
      cancelTimer(k);
      bump(k);
      statuses.delete(k);
      generation.delete(k);
      announced.delete(k);
      render();
    }),
    watcher.onDidChange(onDiskChange),
    vscode.window.onDidChangeActiveTextEditor(render),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("knobeVerify")) vscode.workspace.textDocuments.forEach(schedule);
    }),
    vscode.commands.registerCommand("knobeVerify.verify", async (uri?: vscode.Uri) => {
      const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
      if (!doc || !isKnobe(doc)) {
        void vscode.window.showInformationMessage("Verify KNOBE works on files named *.knobe.md.");
        return;
      }
      if (doc.isDirty) {
        markStale(doc);
        void vscode.window.showInformationMessage("KNOBE Verify checks the saved file. Save first, then verify.");
        return;
      }
      cancelTimer(key(doc.uri));
      await track(doc, true);
    }),
    vscode.commands.registerCommand("knobeVerify.showDetails", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || !isKnobe(doc)) {
        void vscode.window.showInformationMessage("Open a *.knobe.md file to see its verification details.");
        return;
      }
      const details = await vscode.workspace.openTextDocument(detailsUriFor(doc.uri));
      await vscode.window.showTextDocument(details, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }),
  );

  vscode.workspace.textDocuments.forEach(schedule);
  render();

  return {
    getStatus: (uri) => statuses.get(key(uri)),
    whenSettled: async (uri) => {
      // Loop: a settled run may have been replaced by a newer one meanwhile.
      for (let p = inflight.get(key(uri)); p; p = inflight.get(key(uri))) await p;
    },
    statusBar: () => ({ text: item.text, tooltip: String(item.tooltip ?? ""), visible: itemVisible }),
  };
}

export function deactivate(): void {}
