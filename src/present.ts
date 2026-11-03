// Turns a DocStatus into what the user sees: status bar text, an accessible
// label, a plain-text tooltip, and a plain-text details report.
//
// Rules this module keeps:
//  - Integrity states and conformance levels are shown by their exact
//    protocol names, never paraphrased into "OK" or "secure".
//  - Nothing payload-derived ever reaches the status bar text (it is parsed
//    for $(icon) syntax). Payload strings appear only in the tooltip and the
//    details document, both plain text, and are escaped again here.
//  - "verified" is never styled as an endorsement: no green background, and
//    the caveat travels with every verdict.

import type { DocStatus, Source, Verdict } from "./types";

export const CAVEAT = "A match proves integrity, not truth. Inspect before trusting.";

/** Escape C0/C1 controls, DEL, bidi format controls, and line/paragraph
 * separators. Mirrors the character classes of knobe-core.js safe(), so
 * re-escaping an already-safe string is a no-op. */
export function escapeControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const o = ch.codePointAt(0)!;
    if (o < 0x20 || o === 0x7f || (o >= 0x80 && o <= 0x9f)) {
      out += "\\x" + o.toString(16).padStart(2, "0");
    } else if ((o >= 0x202a && o <= 0x202e) || (o >= 0x2066 && o <= 0x2069) || o === 0x2028 || o === 0x2029) {
      out += "\\u" + o.toString(16).padStart(4, "0");
    } else {
      out += ch;
    }
  }
  return out;
}

export type Severity = "none" | "warning" | "error";

const STATE_ICON: Record<string, string> = {
  "verified": "$(check)",
  "verified-body-modified": "$(diff-modified)",
  "failed": "$(error)",
  "unreadable": "$(error)",
};

/** Engine enums go through an allowlist before reaching status bar text. */
function enumOr(value: string, allowed: readonly string[], fallback: string): string {
  return allowed.includes(value) ? value : fallback;
}
const STATES = ["verified", "verified-body-modified", "failed", "unreadable"] as const;
const LEVELS = ["valid", "warnings", "invalid"] as const;

/** The visible words of the status bar item, without the leading icon. The
 * accessible label starts with exactly this text, so a voice-control user
 * can say what they see (WCAG 2.1 SC 2.5.3, Label in Name). */
export function visibleText(status: DocStatus): string {
  switch (status.kind) {
    case "pending": return "KNOBE: verifying…";
    case "stale": return "KNOBE: unsaved edits, no verdict";
    case "manual": return "KNOBE: not verified, click to verify";
    case "skipped-size": return "KNOBE: large file, click to verify";
    case "timeout": return "KNOBE: verification timed out";
    case "error": return "KNOBE: could not verify";
    case "verified": {
      const state = enumOr(status.verdict.state, STATES, "unknown");
      const level = enumOr(status.verdict.conformance, LEVELS, "unknown");
      return `KNOBE: ${state}, ${level}`;
    }
  }
}

const KIND_ICON: Record<DocStatus["kind"], string> = {
  "pending": "$(sync~spin)",
  "stale": "$(circle-slash)",
  "manual": "$(info)",
  "skipped-size": "$(info)",
  "timeout": "$(watch)",
  "error": "$(error)",
  "verified": "$(question)",
};

export function statusBarText(status: DocStatus): string {
  const icon = status.kind === "verified"
    ? STATE_ICON[enumOr(status.verdict.state, STATES, "unknown")] ?? KIND_ICON.verified
    : KIND_ICON[status.kind];
  return `${icon} ${visibleText(status)}`;
}

export function severity(status: DocStatus): Severity {
  if (status.kind === "error" || status.kind === "timeout") return "error";
  if (status.kind !== "verified") return "none";
  const v = status.verdict;
  if (v.state === "failed" || v.state === "unreadable") return "error";
  if (v.state === "verified-body-modified" || v.conformance !== "valid") return "warning";
  return "none";
}

/** Starts with the visible text verbatim, then says the rest in plain words.
 * Does not depend on icons or color. */
export function accessibleLabel(status: DocStatus): string {
  const shown = visibleText(status);
  switch (status.kind) {
    case "pending": return `${shown}`;
    case "stale": return `${shown}. The file has unsaved edits, so no verdict is shown. Save to verify.`;
    case "manual": return `${shown}. Automatic verification is off. Activate to verify the saved file.`;
    case "skipped-size": return `${shown}. The file is larger than the automatic verification limit. Activate to verify now.`;
    case "timeout": return `${shown}. Activate for details.`;
    case "error": return `${shown}. Activate for details.`;
    case "verified": {
      const v = status.verdict;
      return `${shown}. Integrity: ${escapeControls(v.state)}. Conformance: ${escapeControls(v.conformance)}. `
        + `Body verified: ${escapeControls(v.bodyVerified)}. This checks integrity, not truth. Activate for details.`;
    }
  }
}

/** A one-line, payload-free announcement for a verdict that needs attention,
 * or null when nothing should be announced. Used with VS Code's warning and
 * error notifications, which screen readers announce (SC 4.1.3). */
export function problemAnnouncement(status: DocStatus): { level: "warning" | "error"; text: string } | null {
  if (status.kind === "timeout") return { level: "error", text: "KNOBE Verify: verification timed out. No verdict." };
  if (status.kind === "error") return { level: "error", text: "KNOBE Verify: verification could not run." };
  if (status.kind !== "verified") return null;
  const sev = severity(status);
  if (sev === "none") return null;
  return {
    level: sev,
    text: `KNOBE Verify: integrity ${enumOr(status.verdict.state, STATES, "unknown")}, `
      + `conformance ${enumOr(status.verdict.conformance, LEVELS, "unknown")}. Open the details for more.`,
  };
}

function sourceNote(source: Source): string | null {
  return source === "buffer"
    ? "Checked editor text (no readable file behind this document). Line endings may differ from the original file."
    : null;
}

function verdictLines(v: Verdict): string[] {
  const lines = [
    `Integrity: ${escapeControls(v.state)}`,
    `Body verified: ${escapeControls(v.bodyVerified)}`,
    `Conformance: ${escapeControls(v.conformance)}`,
  ];
  if (v.title !== null) lines.push(`Title (from payload, untrusted): ${escapeControls(v.title)}`);
  if (v.reason) lines.push(`Reason: ${escapeControls(v.reason)}`);
  if (v.conformanceIssues.length) {
    lines.push("Conformance issues:");
    for (const issue of v.conformanceIssues) lines.push(`  - ${escapeControls(issue)}`);
    if (v.conformanceIssuesTruncated) lines.push("  - (more issues not shown)");
  }
  return lines;
}

/** Plain-text tooltip (never a MarkdownString: no markup is interpreted). */
export function tooltipText(status: DocStatus): string {
  switch (status.kind) {
    case "pending": return "Verifying this KNOBE locally…";
    case "manual":
      return "Automatic verification is off (setting: knobeVerify.autoVerify). "
        + "Click to verify the saved file.";
    case "stale":
      return "This file has unsaved edits. The previous verdict was cleared because it "
        + "described the saved file, not this buffer. Save to verify again.";
    case "skipped-size":
      return `This file is ${formatBytes(status.size)}, above the auto-verify limit of `
        + `${formatBytes(status.limit)} (setting: knobeVerify.autoVerifyMaxSizeKB). `
        + "Click to run Verify KNOBE now.";
    case "timeout":
      return `Verification did not finish within ${Math.round(status.ms / 1000)} s and was stopped `
        + "(setting: knobeVerify.timeoutSeconds). No verdict.";
    case "error":
      return `Verification could not run: ${escapeControls(status.message)}`;
    case "verified": {
      const note = sourceNote(status.source);
      return [...verdictLines(status.verdict), ...(note ? ["", note] : []), "", CAVEAT,
        "Click for full details."].join("\n");
    }
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Full plain-text report for the read-only details document. */
export function detailsText(fileLabel: string, status: DocStatus | undefined): string {
  const head = [
    "KNOBE Verify for VS Code: verification details",
    `File: ${escapeControls(fileLabel)}`,
    "",
  ];
  if (!status) return [...head, "Not verified yet.", "", CAVEAT, ""].join("\n");
  if (status.kind !== "verified") return [...head, tooltipText(status), "", CAVEAT, ""].join("\n");

  const v = status.verdict;
  const body = [
    "Three independent results (see \"Verifying a KNOBE\" in the KNOBE Protocol README):",
    "",
    ...verdictLines(v),
    "",
    `Payload blocks found: ${v.blockCount}${v.blockCount > 1 ? " (the last block was evaluated)" : ""}`,
    `Stored payload_hash:   ${v.stored ? escapeControls(v.stored) : "(none)"}`,
    `Computed payload_hash: ${v.computed ? escapeControls(v.computed) : "(not computed)"}`,
  ];
  if (v.missing.length) body.push(`Missing required fields: ${v.missing.map(escapeControls).join(", ")}`);
  body.push(
    `Checked: ${status.checkedAt.toISOString()}`,
    `Source: ${status.source === "disk" ? "saved file on disk" : "editor text"}`,
  );
  const note = sourceNote(status.source);
  if (note) body.push(note);
  body.push(
    "",
    "What this means:",
    "  verified: the sealed payload is byte-identical to what was sealed.",
    "  verified-body-modified: the payload is intact, but the markdown body no longer matches its body_hash.",
    "  failed: the payload does not match its payload_hash.",
    "  unreadable: no usable payload could be decoded.",
    "  Conformance is a separate check of the file against the v1 schema.",
    "",
    CAVEAT,
    "A verified result says nothing about whether the content is accurate or the attribution honest.",
    "",
    "Verdicts come from knobe-core.js (KNOBE Protocol v1 engine, Apache-2.0), vendored unmodified.",
    "Everything ran locally; no network requests were made.",
    "",
  );
  return [...head, ...body].join("\n");
}
