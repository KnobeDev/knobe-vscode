// Worker thread: loads the vendored, unmodified knobe-core.js and runs
// verify() on the bytes it is handed. Running here (not on the extension
// host's main thread) means a huge or hostile file can be timed out and
// terminated without stalling other extensions.
//
// Only plain, already-escaped strings cross back to the main thread. Every
// payload-derived string passes through the engine's own safe() first; the
// presentation layer escapes again as defense in depth.

import { parentPort } from "node:worker_threads";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { truncateDisplay } from "./limits";
import type { Verdict, WorkerRequest, WorkerResponse } from "./types";

type Engine = {
  verify(input: Uint8Array): Promise<Record<string, unknown>>;
  safe(value: unknown, limit?: number): string;
};

const ENGINE_URL = pathToFileURL(path.join(__dirname, "..", "vendor", "knobe-core.js")).href;

let enginePromise: Promise<Engine> | undefined;
function loadEngine(): Promise<Engine> {
  enginePromise ??= import(ENGINE_URL) as Promise<Engine>;
  return enginePromise;
}

const TITLE_LIMIT = 200;
const ISSUE_LIMIT = 500;
const MAX_ISSUES = 50;

function toVerdict(engine: Engine, r: Record<string, unknown>): Verdict {
  // Escape in full with the engine's safe(), then truncate here: safe()'s own
  // limit can cut through an escape sequence it just inserted.
  const esc = (v: string, limit: number) => truncateDisplay(engine.safe(v, Number.MAX_SAFE_INTEGER), limit);
  const str = (v: unknown, limit = 300): string | null => (typeof v === "string" ? esc(v, limit) : null);
  const list = (v: unknown, limit: number): string[] =>
    Array.isArray(v) ? v.slice(0, MAX_ISSUES).map((x) => esc(String(x), limit)) : [];
  const payload = r.payload && typeof r.payload === "object"
    ? (r.payload as Record<string, unknown>)
    : null;
  const issues = Array.isArray(r.conformance_issues) ? r.conformance_issues : [];

  return {
    state: esc(String(r.state), 100),
    conformance: esc(String(r.conformance), 100),
    conformanceIssues: list(issues, ISSUE_LIMIT),
    conformanceIssuesTruncated: issues.length > MAX_ISSUES,
    // The engine reports null for unreadable files; spec §7 mandates
    // "omitted" there, and E11 allows either spelling. Show "omitted".
    bodyVerified: str(r.body_verified) ?? "omitted",
    computed: str(r.computed, 64),
    stored: str(r.stored, 100),
    missing: list(r.missing, 100),
    blockCount: typeof r.block_count === "number" ? r.block_count : 0,
    reason: str(r.reason, ISSUE_LIMIT),
    title: payload ? str(payload.title, TITLE_LIMIT) : null,
  };
}

parentPort?.on("message", async (msg: WorkerRequest) => {
  let reply: WorkerResponse;
  try {
    const engine = await loadEngine();
    const report = await engine.verify(msg.bytes);
    reply = { ok: true, verdict: toVerdict(engine, report) };
  } catch (e) {
    reply = { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  parentPort?.postMessage(reply);
});
