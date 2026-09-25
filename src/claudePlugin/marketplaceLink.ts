// src/claudePlugin/marketplaceLink.ts — must not import "vscode" (WI-5a, D54/D55, PROJECT_BRIEF.md §14.6).
//
// Pure decision for the stable marketplace link: whether to create, repoint,
// keep or refuse the directory junction (Windows) / symlink (POSIX) at
// `<home>/.acdc/claude-marketplace`, which the extension re-points at its own
// `context.extensionPath` on every activation instead of ever changing the
// path registered in Claude Code's settings.json (S7 FAIL -> D54).
//
// This module has no side effects: it never touches the filesystem. The thin
// adapter that does (`registration.ts`) builds a `LinkState` from `lstat` +
// `readlink` and passes it in.

import { win32, posix } from "path";

import { pathsEqual, versionFromExtensionDir } from "./claudeSettings";

export const STABLE_MARKETPLACE_DIRNAME = ".acdc/claude-marketplace";

/**
 * `<home>/.acdc/claude-marketplace` (POSIX separators) or
 * `<home>\.acdc\claude-marketplace` (win32), using the platform's own path
 * rules regardless of the OS this code happens to run on (L12).
 */
export function resolveStableMarketplacePath(homedir: string, platform: NodeJS.Platform): string {
  const p = platform === "win32" ? win32 : posix;
  return p.join(homedir, ".acdc", "claude-marketplace");
}

/**
 * What the adapter observed at the stable path via `lstat` (never `stat`:
 * the path is never followed for inspection, and never for deletion either —
 * see registration.ts's link-removal helpers).
 */
export type LinkState =
  | { kind: "missing" }
  | { kind: "link"; target: string; targetExists: boolean } // junction or symlink; target normalised (strip \\?\)
  | { kind: "directory" } // a REAL directory — never deleted
  | { kind: "file" }
  | { kind: "other" };

export type LinkDecision =
  | { action: "create" | "repoint"; target: string }
  | { action: "keep"; reason: "up-to-date" | "newer-or-equal-incumbent" | "foreign-target" | "development-host" }
  | { action: "refuse"; reason: "real-directory" | "file" | "unknown-entry" };

/** Strips a Windows extended-length-path prefix (`\\?\`) so comparisons never fail on it (L11). */
function stripExtendedPrefix(target: string): string {
  return target.startsWith("\\\\?\\") ? target.slice(4) : target;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): Semver | undefined {
  const [core, ...preParts] = version.split("-");
  const segments = core.split(".");
  if (segments.length !== 3) {
    return undefined;
  }
  const [major, minor, patch] = segments.map((s) => Number(s));
  if ([major, minor, patch].some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  const prerelease = preParts.length > 0 ? preParts.join("-").split(".") : [];
  return { major, minor, patch, prerelease };
}

/** Returns > 0 when `a` is newer than `b`, 0 when equal, < 0 when older. Unparseable inputs sort as equal (never crashes). */
function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    return 0;
  }
  if (pa.major !== pb.major) {
    return pa.major - pb.major;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor - pb.minor;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch - pb.patch;
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) {
    return 0;
  }
  if (pa.prerelease.length === 0) {
    return 1; // a is a release, b is a prerelease of the same core version -> a wins
  }
  if (pb.prerelease.length === 0) {
    return -1;
  }
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) {
      return -1;
    }
    if (bi === undefined) {
      return 1;
    }
    if (ai === bi) {
      continue;
    }
    const an = Number(ai);
    const bn = Number(bi);
    const aIsNum = /^\d+$/.test(ai);
    const bIsNum = /^\d+$/.test(bi);
    if (aIsNum && bIsNum) {
      return an - bn;
    }
    return ai < bi ? -1 : 1;
  }
  return 0;
}

/**
 * Link rules, in order (§14.6). `force` only ever comes from the explicit
 * Register command; automatic activation always passes `force: false`.
 */
export function decideMarketplaceLink(input: {
  state: LinkState;
  extensionPath: string; // context.extensionPath (the link target we want)
  extensionVersion: string;
  platform: NodeJS.Platform;
  isDevelopmentOrTest: boolean;
  force: boolean;
}): LinkDecision {
  const { state, extensionPath, extensionVersion, platform, isDevelopmentOrTest, force } = input;

  // Rule 1 — F5 never re-points the user's real Claude Code. Not even `force` overrides this.
  if (isDevelopmentOrTest) {
    return { action: "keep", reason: "development-host" };
  }

  // Rule 2 — never delete or replace a real directory / file / unknown entry. `force` changes none of these.
  if (state.kind === "directory") {
    return { action: "refuse", reason: "real-directory" };
  }
  if (state.kind === "file") {
    return { action: "refuse", reason: "file" };
  }
  if (state.kind === "other") {
    return { action: "refuse", reason: "unknown-entry" };
  }

  // Rule 3
  if (state.kind === "missing") {
    return { action: "create", target: extensionPath };
  }

  // From here, state.kind === "link".
  const target = stripExtendedPrefix(state.target);

  // Rule 4
  if (pathsEqual(target, extensionPath, platform)) {
    return { action: "keep", reason: "up-to-date" };
  }

  // Rule 5 — the incumbent was uninstalled or updated away.
  if (!state.targetExists) {
    return { action: "repoint", target: extensionPath };
  }

  // Rule 6 — ownership: the basename must look like an AC⚡DC install we could have linked ourselves.
  const incumbentVersion = versionFromExtensionDir(target);
  if (incumbentVersion === undefined) {
    if (force) {
      return { action: "repoint", target: extensionPath };
    }
    return { action: "keep", reason: "foreign-target" };
  }

  // Rule 7 — owned and existing: the newer version wins, a tie keeps the incumbent.
  const comparison = compareVersions(incumbentVersion, extensionVersion);
  if (comparison >= 0) {
    if (force) {
      return { action: "repoint", target: extensionPath };
    }
    return { action: "keep", reason: "newer-or-equal-incumbent" };
  }
  return { action: "repoint", target: extensionPath };
}
