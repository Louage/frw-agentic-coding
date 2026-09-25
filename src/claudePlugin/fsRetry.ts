// src/claudePlugin/fsRetry.ts — must not import "vscode" (WI-5a PR-B follow-up, §14.6/§14.11).
//
// The retry/cleanup DECISION for renaming a temp file/symlink into place is
// factored out here, injectable, so it's unit-testable without touching a
// real filesystem. The actual `fs.renameSync`/`fs.unlinkSync` calls and the
// real (bounded) sleep are supplied by the adapter (registration.ts), which
// is the only place that ever touches a real path.
//
// Why this exists: on Windows, Claude Code or an AV scanner can briefly hold
// an open handle on `settings.json` or the stable link, so
// `fs.renameSync(tmp, dest)` can fail with EPERM/EBUSY/EACCES even though
// nothing is actually wrong. Without this, the temp file/symlink
// (`.acdc-tmp-*`) would be left behind in the user's real `~/.claude` (or
// next to the stable link) forever.

export interface RenameRetryDeps {
  rename: (src: string, dest: string) => void;
  unlink: (path: string) => void;
  sleep: (ms: number) => void;
}

export type RenameOutcome = { ok: true } | { ok: false; error: unknown };

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 75;

/** EPERM/EBUSY/EACCES — the transient errors a locked settings.json/link produces on Windows. */
export function isRetryableFsErrorCode(code: string | undefined): boolean {
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Renames `tmpPath` to `destPath` via `deps.rename`, retrying up to
 * `attempts` times (with `deps.sleep` between attempts, bounded and short —
 * this runs fire-and-forget from `activate()` and must never block for
 * long) while the error is `isRetryableFsErrorCode`. On final failure the
 * temp entry is ALWAYS removed via `deps.unlink` before returning — a
 * failure to remove it is swallowed (best-effort only; the original rename
 * error is what's reported) — so a `.acdc-tmp-*` file or symlink is never
 * left behind. Never throws: the caller decides what a `{ ok: false }`
 * result means (e.g. `writeClaudeSettingsAtomic` treats it the same as the
 * concurrent-write-drift skip).
 */
export function renameWithRetry(
  tmpPath: string,
  destPath: string,
  deps: RenameRetryDeps,
  attempts: number = DEFAULT_ATTEMPTS,
  delayMs: number = DEFAULT_DELAY_MS
): RenameOutcome {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      deps.rename(tmpPath, destPath);
      return { ok: true };
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === attempts;
      if (!isLastAttempt && isRetryableFsErrorCode(errorCode(error))) {
        deps.sleep(delayMs);
        continue;
      }
      break;
    }
  }

  try {
    deps.unlink(tmpPath);
  } catch {
    // Best-effort cleanup only — the rename error above is what's reported.
  }
  return { ok: false, error: lastError };
}
