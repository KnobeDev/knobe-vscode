// Size and length limits. No vscode import, so these are unit-tested directly.

/** Largest file this extension will ever read into memory, even on an
 * explicit Verify KNOBE. Matches the auto-verify setting's maximum. */
export const HARD_MAX_BYTES = 256 * 1024 * 1024;

/** Heap ceiling for a verification worker. A hostile file that blows past
 * it kills only the worker (reported as an error), not the extension host. */
export const WORKER_MAX_HEAP_MB = 2048;

export type SizeDecision = "verify" | "skip" | "refuse";

/** Auto-verify steps aside above maxBytes; nothing reads above the hard cap. */
export function sizeDecision(size: number, explicit: boolean, maxBytes: number): SizeDecision {
  if (size > HARD_MAX_BYTES) return "refuse";
  if (!explicit && size > maxBytes) return "skip";
  return "verify";
}

/** Truncate an already-escaped display string to `limit` code points,
 * never cutting through an escape sequence (\xNN, \uNNNN) or a surrogate
 * pair. The engine's safe() truncates after escaping and can leave a
 * dangling "\x1"; this is called on untruncated safe() output instead. */
export function truncateDisplay(s: string, limit: number): string {
  const cps = Array.from(s);
  if (cps.length <= limit) return s;
  let cut = limit;
  // An escape is at most 6 code points ("\uNNNN"); look back that far for
  // one that starts before the cut and ends after it.
  for (let i = Math.max(0, cut - 5); i < cut; i++) {
    if (cps[i] !== "\\") continue;
    const len = cps[i + 1] === "x" ? 4 : cps[i + 1] === "u" ? 6 : 0;
    if (len && i + len > cut) {
      cut = i;
      break;
    }
  }
  return cps.slice(0, cut).join("") + "…";
}
