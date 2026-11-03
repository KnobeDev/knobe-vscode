// Runs one verification in a fresh worker thread with a hard timeout.
// No vscode import: this module is unit-tested directly under Node.

import { Worker } from "node:worker_threads";
import * as path from "node:path";
import type { Outcome, WorkerResponse } from "./types";

const WORKER_PATH = path.join(__dirname, "verifyWorker.js");

/** Verify bytes in a worker. Aborting the signal terminates the worker at
 * once, so a superseded verification never keeps a thread alive. */
export function verifyInWorker(bytes: Uint8Array, timeoutMs: number, signal?: AbortSignal): Promise<Outcome> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ kind: "cancelled" });
      return;
    }
    let settled = false;
    const worker = new Worker(WORKER_PATH);
    const onAbort = () => finish({ kind: "cancelled" });
    signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: "timeout", ms: timeoutMs }), timeoutMs);

    worker.once("message", (msg: WorkerResponse) => {
      finish(msg.ok ? { kind: "done", verdict: msg.verdict } : { kind: "error", message: msg.message });
    });
    worker.once("error", (e) => finish({ kind: "error", message: e.message }));
    worker.once("exit", (code) => finish({ kind: "error", message: `verifier exited (code ${code})` }));

    // Copy into a standalone buffer so it can be transferred, not cloned.
    const copy = new Uint8Array(bytes);
    worker.postMessage({ bytes: copy }, [copy.buffer]);
  });
}
