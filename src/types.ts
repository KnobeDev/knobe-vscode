/** The subset of a knobe-core.js report this extension shows. Every string
 * here has already been through the engine's safe() in the worker. */
export interface Verdict {
  /** verified | verified-body-modified | failed | unreadable */
  state: string;
  /** valid | warnings | invalid */
  conformance: string;
  conformanceIssues: string[];
  conformanceIssuesTruncated: boolean;
  /** yes | modified | omitted */
  bodyVerified: string;
  computed: string | null;
  stored: string | null;
  missing: string[];
  blockCount: number;
  reason: string | null;
  /** Payload title, if the payload had a string title. Untrusted. */
  title: string | null;
}

export interface WorkerRequest {
  bytes: Uint8Array;
}

export type WorkerResponse =
  | { ok: true; verdict: Verdict }
  | { ok: false; message: string };

export type Outcome =
  | { kind: "done"; verdict: Verdict }
  | { kind: "timeout"; ms: number }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

/** Where the verified bytes came from. "disk" is the saved file; "buffer"
 * is editor text, used only for documents with no readable file behind
 * them (VS Code normalizes line endings in buffers, so this is weaker). */
export type Source = "disk" | "buffer";

/** What the extension knows about one document right now. */
export type DocStatus =
  | { kind: "pending" }
  | { kind: "verified"; verdict: Verdict; source: Source; checkedAt: Date }
  | { kind: "stale" }
  /** Auto-verify is off; nothing has been verified since the last save. */
  | { kind: "manual" }
  | { kind: "skipped-size"; size: number; limit: number }
  /** Above HARD_MAX_BYTES: never read, even on request. */
  | { kind: "too-large"; size: number; limit: number }
  | { kind: "timeout"; ms: number }
  | { kind: "error"; message: string };
