/**
 * Decides what to surface after the extension version changed.
 *
 * Deliberately free of any `vscode` import so the decision can be unit-tested
 * in plain Node — `releaseNotes.ts` is a thin adapter over this module.
 */

export type ReleaseNotesTrigger = "never" | "minor" | "always";

export type ReleaseNotesAction =
  | { kind: "none" }
  | { kind: "welcome" }
  | { kind: "update"; auto: boolean };

const TRIGGERS: readonly ReleaseNotesTrigger[] = ["never", "minor", "always"];

interface SemVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Accepts `major.minor.patch` with an optional pre-release/build suffix. */
function parseVersion(value: string | undefined): SemVersion | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isReleaseNotesTrigger(value: unknown): value is ReleaseNotesTrigger {
  return typeof value === "string" && (TRIGGERS as readonly string[]).includes(value);
}

/**
 * Compares the running version against the last one we announced.
 *
 * A downgrade, an identical version or a value we cannot parse yields
 * `none` — we never auto-open on a version relationship we do not understand.
 */
export function decideReleaseNotesAction(
  previousVersion: string | undefined,
  currentVersion: string,
  trigger: ReleaseNotesTrigger
): ReleaseNotesAction {
  if (trigger === "never") {
    return { kind: "none" };
  }

  if (previousVersion === undefined) {
    return { kind: "welcome" };
  }

  const previous = parseVersion(previousVersion);
  const current = parseVersion(currentVersion);
  if (!previous || !current) {
    return { kind: "none" };
  }

  if (current.major < previous.major) {
    return { kind: "none" };
  }
  if (current.major === previous.major) {
    if (current.minor < previous.minor) {
      return { kind: "none" };
    }
    if (current.minor === previous.minor && current.patch <= previous.patch) {
      return { kind: "none" };
    }
  }

  const majorOrMinorBump =
    current.major > previous.major || current.minor > previous.minor;

  return { kind: "update", auto: trigger === "always" || majorOrMinorBump };
}
