import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface AlSourceEntry {
  /** Git repository URL of the AL source (BC base app or ISV product). */
  repository: string;
  /** Branch to check out. */
  branch: string;
  /** Base folder under which repo/branch subfolders are resolved. */
  folder: string;
  /** Whether this source is cloned/pulled and mounted in the workspace. */
  enabled: boolean;
}

const CONFIG_SECTION = "acdc";
const REPOS_KEY = "alBaseCode.repositories";
const SYNC_ON_STARTUP_KEY = "alBaseCode.syncOnStartup";
const ACCESS_MODE_KEY = "alBaseCode.accessMode";
const MOUNT_PREFIX = "[AL Src] ";
const SOURCES_SUBDIR = "acdc-sources";
/**
 * MCP server id we own inside the workspace `.vscode/mcp.json`. A single
 * aggregate filesystem server exposes every enabled source folder. Fixed
 * (not per-workspace-unique) because the file itself is already per-workspace.
 */
const MCP_SERVER_ID = "acdc-al-sources";

export type AccessMode = "workspace" | "mcp";

// ---------------------------------------------------------------------------
// Settings access
// ---------------------------------------------------------------------------

export function getEntries(): AlSourceEntry[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const raw = config.get<AlSourceEntry[]>(REPOS_KEY, []);
  return raw.map(normalizeEntry);
}

export async function saveEntries(entries: AlSourceEntry[]): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(
    REPOS_KEY,
    entries.map((entry) => normalizeAndResolveEntry(entry)),
    vscode.ConfigurationTarget.Workspace
  );
}

export function isSyncOnStartupEnabled(): boolean {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>(SYNC_ON_STARTUP_KEY, false);
}

export function getAccessMode(): AccessMode {
  const raw = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>(ACCESS_MODE_KEY, "workspace");
  return raw === "mcp" ? "mcp" : "workspace";
}

export async function setAccessMode(mode: AccessMode): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(ACCESS_MODE_KEY, mode, vscode.ConfigurationTarget.Workspace);
}

function normalizeEntry(entry: Partial<AlSourceEntry>): AlSourceEntry {
  return {
    repository: (entry.repository ?? "").trim(),
    branch: (entry.branch ?? "").trim(),
    folder: (entry.folder ?? "").trim(),
    enabled: Boolean(entry.enabled),
  };
}

function normalizeAndResolveEntry(entry: Partial<AlSourceEntry>): AlSourceEntry {
  const normalized = normalizeEntry(entry);
  if (normalized.repository && !normalized.folder) {
    normalized.folder = suggestDefaultFolder(
      normalized.repository,
      normalized.branch
    );
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Folder helpers
// ---------------------------------------------------------------------------

/** Base directory for cloned sources: %LOCALAPPDATA%\acdc-sources (cross-platform fallback). */
export function getSourcesBaseDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA ??
    path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, SOURCES_SUBDIR);
}

/** Derives a repo folder name from a git URL (last path segment, without .git). */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const segment = trimmed.split(/[\\/]/).pop() ?? "al-source";
  return segment || "al-source";
}

/** Proposes a default base folder under %LOCALAPPDATA%\acdc-sources. */
export function suggestDefaultFolder(url: string, branch = ""): string {
  void url;
  void branch;
  return getSourcesBaseDir();
}

function branchFolderName(branch: string): string {
  const value = branch.trim();
  if (!value) {
    return "";
  }
  // Branch names may contain path separators (feature/x) and Windows-invalid
  // path characters. Convert to a stable single-folder segment.
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim();
}

export function repoFolderName(repositoryUrl: string): string {
  return repoNameFromUrl(repositoryUrl);
}

export function branchFolderDisplayName(branch: string): string {
  return branchFolderName(branch);
}

/**
 * The folder an entry actually resolves to. When `folder` is left empty in
 * settings, we compute a per-user default under %LOCALAPPDATA% at runtime — this
 * keeps committed workspace settings portable across developers (each machine
 * expands to its own local path instead of a hard-coded, username-specific one).
 */
export function effectiveFolder(entry: AlSourceEntry): string {
  const explicit = entry.folder.trim();
  if (!entry.repository.trim()) {
    return explicit;
  }
  const baseFolder = explicit || suggestDefaultFolder(entry.repository, entry.branch);
  const repoFolder = repoFolderName(entry.repository);
  const branchFolder = branchFolderName(entry.branch);
  return branchFolder
    ? path.join(baseFolder, repoFolder, branchFolder)
    : path.join(baseFolder, repoFolder);
}

/**
 * A "manual" entry has a folder but no repository: the developer downloads and
 * updates the source themselves (e.g. an ISV that ships a file download instead
 * of git access). The extension only mounts it — it never clones or pulls.
 */
export function isManualEntry(entry: AlSourceEntry): boolean {
  return !entry.repository.trim() && !!entry.folder.trim();
}

function normalizePath(p: string): string {
  return path.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * Returns the path of an ancestor git repository that would be polluted if we
 * cloned into `folder`, or undefined when the folder is safe.
 *
 * The folder itself is allowed to be a git repo (that is our clone target); we
 * only reject when a *parent* directory is a git working tree.
 */
export function findEnclosingGitRepo(folder: string): string | undefined {
  let dir: string;
  try {
    dir = path.dirname(path.resolve(folder));
  } catch {
    return undefined;
  }

  let previous = "";
  while (dir && dir !== previous) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    previous = dir;
    dir = path.dirname(dir);
  }
  return undefined;
}

export interface FolderValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validates a folder. For clone targets (`forClone`, default) we also reject a
 * location nested inside another git repo so a clone can't pollute it. Manual
 * folders skip that check because we never write into them.
 */
export function validateFolder(
  folder: string,
  options: { forClone?: boolean } = {}
): FolderValidation {
  const forClone = options.forClone ?? true;
  const value = folder.trim();
  if (!value) {
    return { ok: false, reason: "Folder is empty." };
  }
  if (!path.isAbsolute(value)) {
    return { ok: false, reason: "Folder must be an absolute path." };
  }
  if (!forClone) {
    return { ok: true };
  }
  const enclosing = findEnclosingGitRepo(value);
  if (enclosing) {
    // Enclosing git repos INSIDE our managed sources root are expected: they
    // are typically leftover Base/Repo clones from before the Base/Repo/Branch
    // layout was introduced. Sharing that clone across branch subfolders is
    // intentional (branch subfolders live next to the enclosing .git).
    const managedRoot = normalizePath(getSourcesBaseDir());
    const enclosingNormalized = normalizePath(enclosing);
    const isInsideManagedRoot =
      enclosingNormalized === managedRoot ||
      enclosingNormalized.startsWith(managedRoot + path.sep) ||
      enclosingNormalized.startsWith(managedRoot + "/") ||
      enclosingNormalized.startsWith(managedRoot + "\\");
    if (!isInsideManagedRoot) {
      return {
        ok: false,
        reason: `Folder is inside another git repository (${enclosing}). Choose a location outside any repo to avoid polluting it.`,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function runGit(args: string, cwd?: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/** Lists remote branch names for a repository URL via `git ls-remote --heads`. */
export async function listRemoteBranches(url: string): Promise<string[]> {
  const value = url.trim();
  if (!value) {
    return [];
  }
  const stdout = await runGit(`ls-remote --heads "${value}"`);
  const branches: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/refs\/heads\/(.+)$/);
    if (match) {
      branches.push(match[1]);
    }
  }
  return branches;
}

function folderHasGit(folder: string): boolean {
  return fs.existsSync(path.join(folder, ".git"));
}

function folderIsEmptyOrMissing(folder: string): boolean {
  if (!fs.existsSync(folder)) {
    return true;
  }
  try {
    return fs.readdirSync(folder).length === 0;
  } catch {
    return false;
  }
}

export type CloneOutcome =
  | "cloned"
  | "pulled"
  | "skipped"
  | "declined"
  | "error";

export interface EnsureResult {
  entry: AlSourceEntry;
  outcome: CloneOutcome;
  message?: string;
}

/**
 * Ensures the entry's folder holds the requested repo/branch:
 *  - folder missing/empty  → ask permission, then clone
 *  - folder is a git repo  → pull latest (fetch + hard reset to origin/branch), never push
 */
export async function ensureClonedOrPulled(
  entry: AlSourceEntry,
  output: vscode.OutputChannel,
  options: { promptBeforeClone: boolean } = { promptBeforeClone: true }
): Promise<EnsureResult> {
  const folder = effectiveFolder(entry);

  // Manual entry (folder, no repository): the developer maintains it. We only
  // check the folder exists so we can mount it; we never clone or pull.
  if (isManualEntry(entry)) {
    const validation = validateFolder(folder, { forClone: false });
    if (!validation.ok) {
      output.appendLine(`[alBaseCode] ${folder}: ${validation.reason}`);
      return { entry, outcome: "error", message: validation.reason };
    }
    if (!fs.existsSync(folder)) {
      const reason = `Manual source folder not found: ${folder}. Create/download it, then it will be mounted.`;
      output.appendLine(`[alBaseCode] ${reason}`);
      return { entry, outcome: "error", message: reason };
    }
    output.appendLine(`[alBaseCode] Manual source (no auto-update): ${folder}`);
    return { entry, outcome: "skipped" };
  }

  const validation = validateFolder(folder);
  if (!validation.ok) {
    output.appendLine(
      `[alBaseCode] ${entry.repository}: ${validation.reason}`
    );
    return { entry, outcome: "error", message: validation.reason };
  }

  try {
    if (folderIsEmptyOrMissing(folder)) {
      if (options.promptBeforeClone) {
        const choice = await vscode.window.showInformationMessage(
          `Clone AL source '${repoNameFromUrl(entry.repository)}' (branch '${entry.branch || "default"}') into:\n${folder}?`,
          { modal: true },
          "Clone"
        );
        if (choice !== "Clone") {
          output.appendLine(
            `[alBaseCode] Clone declined for ${entry.repository}`
          );
          return { entry, outcome: "declined" };
        }
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Cloning ${repoNameFromUrl(entry.repository)}…`,
          cancellable: false,
        },
        async () => {
          fs.mkdirSync(path.dirname(folder), { recursive: true });
          const branchArg = entry.branch
            ? `--branch "${entry.branch}" `
            : "";
          await runGit(
            `clone --depth 1 ${branchArg}"${entry.repository}" "${folder}"`
          );
        }
      );
      output.appendLine(`[alBaseCode] Cloned ${entry.repository} → ${folder}`);
      return { entry, outcome: "cloned" };
    }

    if (folderHasGit(folder)) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Updating ${repoNameFromUrl(entry.repository)}…`,
          cancellable: false,
        },
        async () => {
          if (entry.branch) {
            // Ensure the configured branch is checked out (may differ from what
            // another project left in this shared folder), then reset to latest.
            await checkoutBranch(folder, entry.branch);
          } else {
            const branch = await currentBranch(folder);
            if (branch) {
              await runGit(
                `fetch --depth 1 origin "${branch}:refs/remotes/origin/${branch}"`,
                folder
              );
              await runGit(`reset --hard "origin/${branch}"`, folder);
            } else {
              await runGit(`fetch --depth 1 origin`, folder);
              await runGit(`reset --hard @{u}`, folder);
            }
          }
        }
      );
      output.appendLine(`[alBaseCode] Pulled latest for ${entry.repository}`);
      return { entry, outcome: "pulled" };
    }

    // Folder exists, is non-empty, but is not a git repo — do not touch it.
    const reason = `Folder '${folder}' exists and is not a git repository. Choose an empty or dedicated folder.`;
    output.appendLine(`[alBaseCode] ${reason}`);
    return { entry, outcome: "error", message: reason };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output.appendLine(`[alBaseCode] ERROR (${entry.repository}): ${message}`);
    return { entry, outcome: "error", message };
  }
}

async function currentBranch(folder: string): Promise<string | undefined> {
  try {
    const out = await runGit("rev-parse --abbrev-ref HEAD", folder);
    const branch = out.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks out `branch` in an existing (possibly shallow / single-branch) clone,
 * fetching it explicitly so switching to a branch the clone doesn't yet have
 * works. Discards local changes (these folders are read-only mirrors). Never pushes.
 */
async function checkoutBranch(folder: string, branch: string): Promise<void> {
  await runGit(
    `fetch --depth 1 origin "${branch}:refs/remotes/origin/${branch}"`,
    folder
  );
  await runGit(`checkout -f -B "${branch}" "origin/${branch}"`, folder);
}

// ---------------------------------------------------------------------------
// Workspace folder mounting
// ---------------------------------------------------------------------------

function mountName(entry: AlSourceEntry): string {
  const label = entry.repository.trim()
    ? entry.branch.trim()
      ? `${repoNameFromUrl(entry.repository)} [${entry.branch.trim()}]`
      : repoNameFromUrl(entry.repository)
    : path.basename(entry.folder.trim()) || "al-source";
  return `${MOUNT_PREFIX}${label}`;
}

function entryLabel(entry: AlSourceEntry): string {
  return entry.repository.trim()
    ? entry.branch.trim()
      ? `${repoNameFromUrl(entry.repository)} [${entry.branch.trim()}]`
      : repoNameFromUrl(entry.repository)
    : path.basename(entry.folder.trim()) || "al-source";
}

/**
 * Keeps `git.ignoredRepositories` in sync so mounted AL source folders don't
 * clutter the Source Control view (developers shouldn't wonder which repo they
 * are working in). Enabled source folders are added; disabled ones we manage
 * are removed; unrelated user entries are preserved.
 */
export async function syncGitIgnoredRepositories(): Promise<void> {
  const entries = getEntries();
  const allOurFolders = entries.map(effectiveFolder).filter(Boolean);
  const enabledOurFolders = entries
    .filter((e) => e.enabled)
    .map(effectiveFolder)
    .filter(Boolean);

  const gitConfig = vscode.workspace.getConfiguration("git");
  const existing = gitConfig.get<string[]>("ignoredRepositories", []) ?? [];

  const isOurs = (p: string) =>
    allOurFolders.some((f) => normalizePath(f) === normalizePath(p));

  const preserved = existing.filter((p) => !isOurs(p));
  const next = [...preserved];
  for (const folder of enabledOurFolders) {
    if (!next.some((p) => normalizePath(p) === normalizePath(folder))) {
      next.push(folder);
    }
  }

  const changed =
    next.length !== existing.length ||
    next.some((p, i) => p !== existing[i]);
  if (changed) {
    await gitConfig.update(
      "ignoredRepositories",
      next,
      vscode.ConfigurationTarget.Workspace
    );
  }
}

/**
 * Removes every ignored-repositories entry pointing at one of our managed
 * folders. Used when switching to MCP mode, where we no longer mount those
 * folders as workspace roots and therefore have no reason to hide them from SCM.
 */
export async function clearOurGitIgnoredRepositories(): Promise<void> {
  const entries = getEntries();
  const ourFolders = entries.map(effectiveFolder).filter(Boolean);
  if (ourFolders.length === 0) { return; }

  const gitConfig = vscode.workspace.getConfiguration("git");
  const existing = gitConfig.get<string[]>("ignoredRepositories", []) ?? [];
  const isOurs = (p: string) =>
    ourFolders.some((f) => normalizePath(f) === normalizePath(p));
  const preserved = existing.filter((p) => !isOurs(p));
  if (preserved.length !== existing.length) {
    await gitConfig.update(
      "ignoredRepositories",
      preserved,
      vscode.ConfigurationTarget.Workspace
    );
  }
}

/**
 * Mounts enabled+cloned folders as read-only workspace roots and unmounts
 * disabled ones that we previously added.
 */
export function applyWorkspaceMounts(output: vscode.OutputChannel): {
  added: string[];
  removed: string[];
} {
  const entries = getEntries();
  const currentFolders = vscode.workspace.workspaceFolders ?? [];
  const added: string[] = [];
  const removed: string[] = [];

  const mountedByPath = new Map<string, number>();
  currentFolders.forEach((f, i) =>
    mountedByPath.set(normalizePath(f.uri.fsPath), i)
  );

  const toAdd: { uri: vscode.Uri; name: string }[] = [];
  const toRemove: number[] = [];

  for (const entry of entries) {
    const folder = effectiveFolder(entry);
    if (!folder) {
      continue;
    }
    const key = normalizePath(folder);
    const mountedIndex = mountedByPath.get(key);

    if (entry.enabled) {
      if (mountedIndex === undefined && fs.existsSync(folder)) {
        toAdd.push({
          uri: vscode.Uri.file(folder),
          name: mountName(entry),
        });
        added.push(entryLabel(entry));
      }
    } else if (mountedIndex !== undefined) {
      const mounted = currentFolders[mountedIndex];
      if (mounted.name.startsWith(MOUNT_PREFIX)) {
        toRemove.push(mountedIndex);
        removed.push(entryLabel(entry));
      }
    }
  }

  toRemove.sort((a, b) => b - a);
  for (const idx of toRemove) {
    vscode.workspace.updateWorkspaceFolders(idx, 1);
  }
  if (toAdd.length > 0) {
    const insertAt = vscode.workspace.workspaceFolders?.length ?? 0;
    vscode.workspace.updateWorkspaceFolders(insertAt, 0, ...toAdd);
  }

  for (const label of added) {
    output.appendLine(`[alBaseCode] Mounted: ${label}`);
  }
  for (const label of removed) {
    output.appendLine(`[alBaseCode] Unmounted: ${label}`);
  }

  return { added, removed };
}

/**
 * Unmounts every workspace folder we own (prefix `[AL Src] `). Used when
 * switching from workspace mode → MCP mode so leftovers don't linger.
 */
export function unmountAllOurWorkspaceMounts(
  output: vscode.OutputChannel
): { removed: string[] } {
  const currentFolders = vscode.workspace.workspaceFolders ?? [];
  const toRemove: number[] = [];
  const removed: string[] = [];
  currentFolders.forEach((f, i) => {
    if (f.name.startsWith(MOUNT_PREFIX)) {
      toRemove.push(i);
      removed.push(f.name.slice(MOUNT_PREFIX.length));
    }
  });
  toRemove.sort((a, b) => b - a);
  for (const idx of toRemove) {
    vscode.workspace.updateWorkspaceFolders(idx, 1);
  }
  for (const label of removed) {
    output.appendLine(`[alBaseCode] Unmounted (mode switch): ${label}`);
  }
  return { removed };
}

// ---------------------------------------------------------------------------
// MCP filesystem server mounting
// ---------------------------------------------------------------------------

interface McpJsonShape {
  servers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Resolves the target `.vscode/mcp.json` path for this workspace.
 *
 * NOTE — why workspace scope and NOT user-profile scope: VS Code does not
 * expose a stable API to identify the currently active profile from within
 * an extension. Extensions installed at the default level share their
 * `globalStorageUri` across profiles by design, so writes derived from that
 * URI land in the default profile's `mcp.json` regardless of which named
 * profile the user is actually in. Rather than shipping brittle heuristics
 * and an override setting to paper over the gap, we write to the workspace's
 * `.vscode/mcp.json`, which is unambiguous and always loaded by VS Code.
 *
 * Returns undefined when no workspace folder is open (nothing to write to).
 */
function getWorkspaceMcpJsonPath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return undefined; }
  return path.join(folder.uri.fsPath, ".vscode", "mcp.json");
}

/** Public accessor used by the webview panel's "Reveal mcp.json" button. */
export function getMcpTargetPath(): string | undefined {
  return getWorkspaceMcpJsonPath();
}

function logMcpTarget(output: vscode.OutputChannel): void {
  const target = getWorkspaceMcpJsonPath() ?? "(no workspace folder)";
  output.appendLine(`[alBaseCode] MCP: target file = ${target}`);
}

interface McpJsonReadResult {
  parsed: McpJsonShape;
  existed: boolean;
  parseError?: string;
}

function readMcpJson(filePath: string): McpJsonReadResult {
  if (!fs.existsSync(filePath)) {
    return { parsed: {}, existed: false };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) {
    return { parsed: {}, existed: true };
  }
  try {
    const parsed = JSON.parse(trimmed) as McpJsonShape;
    return { parsed: parsed ?? {}, existed: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      parsed: {},
      existed: true,
      parseError: reason,
    };
  }
}

function writeMcpJson(filePath: string, content: McpJsonShape): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const serialized = JSON.stringify(content, null, 2) + "\n";
  fs.writeFileSync(filePath, serialized, "utf8");
}

/**
 * True when the mcp.json payload contains no user data worth preserving:
 * `servers` empty or absent, and no other top-level keys. Used to decide
 * whether to delete the file entirely after removing our entry.
 */
function isMcpJsonEmpty(shape: McpJsonShape): boolean {
  const otherKeys = Object.keys(shape).filter((k) => k !== "servers");
  if (otherKeys.length > 0) { return false; }
  const servers = shape.servers;
  if (!servers || typeof servers !== "object") { return true; }
  return Object.keys(servers as Record<string, unknown>).length === 0;
}

/**
 * Writes/updates our aggregate filesystem MCP server in the workspace's
 * `.vscode/mcp.json`, pointing at every enabled entry's effective folder.
 * When there are no enabled folders, removes the server entry entirely (and
 * deletes the file if nothing else remains).
 *
 * Workspace scope is a deliberate choice: user-profile `mcp.json` cannot be
 * targeted reliably from a VS Code extension (see `getWorkspaceMcpJsonPath`
 * for the full explanation).
 *
 * Only touches our own server key — all other user-authored servers are
 * preserved. Refuses to overwrite if the existing file doesn't parse as JSON
 * (comments/trailing commas), to avoid destroying user content.
 */
export function applyMcpMounts(output: vscode.OutputChannel): {
  added: string[];
  removed: string[];
  error?: string;
} {
  const mcpPath = getWorkspaceMcpJsonPath();
  if (!mcpPath) {
    const reason = "No workspace folder is open — cannot write .vscode/mcp.json.";
    output.appendLine(`[alBaseCode] ${reason}`);
    return { added: [], removed: [], error: reason };
  }
  logMcpTarget(output);

  const entries = getEntries();
  const enabledFolders: string[] = [];
  for (const entry of entries) {
    if (!entry.enabled) { continue; }
    const folder = effectiveFolder(entry);
    if (!folder || !fs.existsSync(folder)) { continue; }
    enabledFolders.push(folder);
  }

  const { parsed, existed, parseError } = readMcpJson(mcpPath);
  if (parseError) {
    const reason = `Cannot update ${mcpPath}: file exists but is not valid JSON (${parseError}). Remove comments/trailing commas or delete the file, then try again.`;
    output.appendLine(`[alBaseCode] ${reason}`);
    return { added: [], removed: [], error: reason };
  }

  const servers: Record<string, unknown> =
    parsed.servers && typeof parsed.servers === "object"
      ? { ...(parsed.servers as Record<string, unknown>) }
      : {};

  const hadOurs = Object.prototype.hasOwnProperty.call(servers, MCP_SERVER_ID);
  const added: string[] = [];
  const removed: string[] = [];

  if (enabledFolders.length === 0) {
    if (hadOurs) {
      delete servers[MCP_SERVER_ID];
      removed.push(MCP_SERVER_ID);
      output.appendLine(
        `[alBaseCode] MCP: removed '${MCP_SERVER_ID}' (no enabled folders).`
      );
    }
  } else {
    servers[MCP_SERVER_ID] = {
      type: "stdio",
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        ...enabledFolders,
      ],
    };
    if (hadOurs) {
      output.appendLine(
        `[alBaseCode] MCP: updated '${MCP_SERVER_ID}' → ${enabledFolders.length} folder(s).`
      );
    } else {
      added.push(MCP_SERVER_ID);
      output.appendLine(
        `[alBaseCode] MCP: added '${MCP_SERVER_ID}' → ${enabledFolders.length} folder(s).`
      );
    }
  }

  const nextParsed: McpJsonShape = { ...parsed, servers };
  const somethingChanged = added.length > 0 || removed.length > 0;
  const needsInitialWrite = !existed && enabledFolders.length > 0;
  if (somethingChanged || needsInitialWrite) {
    // If after our edits the file is empty of any content worth keeping,
    // delete it rather than leaving a `{ "servers": {} }` shell behind.
    if (existed && isMcpJsonEmpty(nextParsed)) {
      try {
        fs.unlinkSync(mcpPath);
        output.appendLine(`[alBaseCode] MCP: deleted empty ${mcpPath}.`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        output.appendLine(`[alBaseCode] MCP delete failed: ${reason}`);
        return { added, removed, error: reason };
      }
    } else {
      try {
        writeMcpJson(mcpPath, nextParsed);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        output.appendLine(`[alBaseCode] MCP write failed: ${reason}`);
        return { added: [], removed: [], error: reason };
      }
    }
  }

  return { added, removed };
}

/**
 * Removes our aggregate MCP server entry from the workspace's `.vscode/mcp.json`
 * (used when switching from MCP → workspace, or when there are no enabled
 * sources). Leaves other user-authored servers untouched. Deletes the file
 * entirely when nothing else remains.
 */
export function unmountAllOurMcpMounts(
  output: vscode.OutputChannel
): { removed: string[]; error?: string } {
  const mcpPath = getWorkspaceMcpJsonPath();
  if (!mcpPath || !fs.existsSync(mcpPath)) {
    return { removed: [] };
  }
  logMcpTarget(output);

  const { parsed, parseError } = readMcpJson(mcpPath);
  if (parseError) {
    const reason = `Cannot clean ${mcpPath}: file exists but is not valid JSON (${parseError}).`;
    output.appendLine(`[alBaseCode] ${reason}`);
    return { removed: [], error: reason };
  }

  if (
    !parsed.servers ||
    typeof parsed.servers !== "object" ||
    !Object.prototype.hasOwnProperty.call(parsed.servers, MCP_SERVER_ID)
  ) {
    return { removed: [] };
  }

  const nextServers = { ...(parsed.servers as Record<string, unknown>) };
  delete nextServers[MCP_SERVER_ID];
  const nextParsed: McpJsonShape = { ...parsed, servers: nextServers };

  if (isMcpJsonEmpty(nextParsed)) {
    try {
      fs.unlinkSync(mcpPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      output.appendLine(`[alBaseCode] MCP delete failed: ${reason}`);
      return { removed: [], error: reason };
    }
    output.appendLine(
      `[alBaseCode] MCP: removed '${MCP_SERVER_ID}' and deleted empty ${mcpPath}.`
    );
    return { removed: [MCP_SERVER_ID] };
  }

  try {
    writeMcpJson(mcpPath, nextParsed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    output.appendLine(`[alBaseCode] MCP cleanup failed: ${reason}`);
    return { removed: [], error: reason };
  }
  output.appendLine(
    `[alBaseCode] MCP: removed '${MCP_SERVER_ID}' (mode switch).`
  );
  return { removed: [MCP_SERVER_ID] };
}

// ---------------------------------------------------------------------------
// High-level sync
// ---------------------------------------------------------------------------

/**
 * Clone/pull all enabled entries, then mount them. `promptBeforeClone` lets the
 * caller decide whether a missing folder should ask for permission (interactive
 * command) or run unattended.
 */
export async function syncAlBaseCode(
  output: vscode.OutputChannel,
  options: { promptBeforeClone: boolean } = { promptBeforeClone: true }
): Promise<EnsureResult[]> {
  const results: EnsureResult[] = [];
  for (const entry of getEntries()) {
    if (!entry.enabled) {
      continue;
    }
    // Include manual entries (folder only) — they are validated + mounted, but
    // never cloned/pulled. Skip entries that have neither repo nor folder.
    if (!entry.repository && !entry.folder) {
      continue;
    }
    results.push(await ensureClonedOrPulled(entry, output, options));
  }

  // Dispatch mounting on access mode. Only one mode per workspace: whichever
  // is active gets applied, and the alternate mode's leftovers are cleaned up
  // so switching between modes is idempotent.
  const mode = getAccessMode();
  if (mode === "mcp") {
    unmountAllOurWorkspaceMounts(output);
    applyMcpMounts(output);
    // In MCP mode our folders are NOT workspace roots, so the git.ignore
    // scrubber has nothing to do (and would leave stale entries behind if
    // called). Explicitly clear anything we previously added.
    await clearOurGitIgnoredRepositories();
  } else {
    unmountAllOurMcpMounts(output);
    applyWorkspaceMounts(output);
    await syncGitIgnoredRepositories();
  }
  return results;
}

/**
 * Startup branch guard: for each enabled repo-backed source with an existing
 * clone, make sure it is checked out to the branch configured **for this
 * project** (e.g. `be-28` here vs `nl-27` in another project that shares the
 * same local folder). Only touches existing folders — never clones or prompts —
 * and only fetches when the branch actually differs, so it's cheap when correct.
 */
export async function ensureConfiguredBranchesOnStartup(
  output: vscode.OutputChannel
): Promise<void> {
  for (const entry of getEntries()) {
    if (!entry.enabled || isManualEntry(entry) || !entry.branch) {
      continue;
    }
    const folder = effectiveFolder(entry);
    if (!folder || !fs.existsSync(folder) || !folderHasGit(folder)) {
      continue;
    }
    try {
      const current = await currentBranch(folder);
      if (current === entry.branch) {
        continue;
      }
      output.appendLine(
        `[alBaseCode] ${repoNameFromUrl(entry.repository)}: switching ${current ?? "?"} → ${entry.branch}`
      );
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Checking out ${entry.branch} for ${repoNameFromUrl(entry.repository)}…`,
          cancellable: false,
        },
        () => checkoutBranch(folder, entry.branch)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.appendLine(
        `[alBaseCode] Branch switch failed for ${entry.repository}: ${message}`
      );
    }
  }
}

/**
 * Startup hook. Always ensures each enabled source is on its configured branch
 * (cheap when already correct). When `syncOnStartup` is enabled it also clones
 * missing folders (after approval) and pulls existing ones to the latest commit.
 */
export async function syncOnStartup(
  output: vscode.OutputChannel
): Promise<void> {
  const enabled = getEntries().filter(
    (e) => e.enabled && (e.repository || e.folder)
  );
  if (enabled.length === 0) {
    return;
  }
  if (isSyncOnStartupEnabled()) {
    await syncAlBaseCode(output, { promptBeforeClone: true });
  } else {
    // Even without full sync, keep the checked-out branch correct for this project.
    await ensureConfiguredBranchesOnStartup(output);
    const mode = getAccessMode();
    if (mode === "mcp") {
      // In MCP mode: re-assert the mcp.json entry (folders may have appeared
      // since last session) and make sure no stale workspace mounts survive.
      unmountAllOurWorkspaceMounts(output);
      applyMcpMounts(output);
      await clearOurGitIgnoredRepositories();
    } else {
      unmountAllOurMcpMounts(output);
      await syncGitIgnoredRepositories();
    }
  }
}
