/**
 * Decides which AL source workspace folders to add and which to remove.
 *
 * Deliberately free of any `vscode` import so the decision can be unit-tested
 * in plain Node — `applyWorkspaceMounts` is a thin adapter over this module.
 */

/**
 * Display-name prefix of every workspace folder AC⚡DC mounts for AL Base Code.
 * Also the marker other features use to tell a read-only source mirror from a
 * real project folder.
 */
export const AL_SOURCE_MOUNT_PREFIX = "[AL Src] ";

export type MountScheme = "virtual" | "file";

export interface PlannedMount {
  /** Stable identity: virtual path for "virtual", normalized fsPath for "file". */
  key: string;
  scheme: MountScheme;
  name: string;
}

export interface MountedFolder {
  uriString: string;
  scheme: string;
  fsPath?: string;
  name: string;
}

export interface MountPlan {
  add: PlannedMount[];
  /** Indices into the supplied `mounted` array, caller removes highest-first. */
  removeIndices: number[];
}

/**
 * Windows paths are case-insensitive, POSIX paths are not. Detect the flavour
 * from the value itself rather than from `process.platform`, so a plan is
 * reproducible wherever it is computed (and testable on any OS).
 */
function isWindowsStylePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\");
}

export function normalizeMountPath(value: string): string {
  const trimmed = value.trim();
  const collapsed = trimmed.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  return isWindowsStylePath(trimmed) ? collapsed.toLowerCase() : collapsed;
}

function normalizeVirtualPath(value: string): string {
  const collapsed = value.trim().replace(/\/+/g, "/").replace(/\/+$/, "");
  return collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
}

/** Path component of a URI string, without scheme, authority, query or fragment. */
function uriPath(uriString: string): string {
  const withoutFragment = uriString.split("#")[0].split("?")[0];
  const colon = withoutFragment.indexOf(":");
  let rest = colon >= 0 ? withoutFragment.slice(colon + 1) : withoutFragment;
  if (rest.startsWith("//")) {
    const slash = rest.indexOf("/", 2);
    rest = slash >= 0 ? rest.slice(slash) : "/";
  }
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

function mountedKey(folder: MountedFolder): string {
  if (folder.scheme === "file") {
    return normalizeMountPath(folder.fsPath ?? uriPath(folder.uriString));
  }
  return normalizeVirtualPath(uriPath(folder.uriString));
}

function desiredKey(mount: PlannedMount): string {
  return mount.scheme === "file"
    ? normalizeMountPath(mount.key)
    : normalizeVirtualPath(mount.key);
}

/** Scheme-qualified so a virtual path can never collide with an fsPath. */
function identity(scheme: string, key: string): string {
  return `${scheme === "file" ? "file" : "virtual"}\u0000${key}`;
}

/**
 * Reconciles the mounts we want against the workspace folders already present.
 *
 * Only folders named with `mountPrefix` are ever removed — a same-path folder
 * the developer added themselves is left alone (and suppresses a duplicate add).
 */
export function planWorkspaceMounts(
  desired: PlannedMount[],
  mounted: MountedFolder[],
  mountPrefix: string
): MountPlan {
  const satisfied = new Set<string>();
  const removeIndices: number[] = [];

  const wanted = new Map<string, PlannedMount>();
  for (const mount of desired) {
    const id = identity(mount.scheme, desiredKey(mount));
    if (!wanted.has(id)) {
      wanted.set(id, mount);
    }
  }

  mounted.forEach((folder, index) => {
    const id = identity(folder.scheme, mountedKey(folder));
    const isOurs = folder.name.startsWith(mountPrefix);
    if (wanted.has(id) && !satisfied.has(id)) {
      satisfied.add(id);
      return;
    }
    if (!isOurs) {
      // Not ours: never removed, but still blocks a duplicate root on the same path.
      satisfied.add(id);
      return;
    }
    removeIndices.push(index);
  });

  const add: PlannedMount[] = [];
  for (const [id, mount] of wanted) {
    if (!satisfied.has(id)) {
      add.push(mount);
    }
  }

  removeIndices.sort((a, b) => b - a);
  return { add, removeIndices };
}
