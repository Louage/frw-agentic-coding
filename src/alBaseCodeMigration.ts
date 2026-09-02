import * as vscode from "vscode";
import {
  AL_SOURCE_SCHEME,
  effectiveFolder,
  getDefaultSourcesBaseDir,
  getEntries,
  getRawEntries,
  getSourcesRootSetting,
  saveEntries,
  setSourcesRootSetting,
  clearOurGitIgnoredRepositories,
  expandEnvVars,
  type AlSourceEntry,
} from "./alBaseCode";

/**
 * Detection + repair for workspaces still on the pre-portable AL Base Code
 * layout, where machine-specific absolute paths (a clone folder, a `file:`
 * workspace mount, a `git.ignoredRepositories` entry) were written into a
 * `.code-workspace` that teams commit.
 */

const SUPPRESS_KEY = "acdc.alBaseCode.migrationDismissed";
const MOUNT_PREFIX = "[AL Src] ";

export interface ILegacyFindings {
  /** Git-backed entries carrying a folder that belongs in `sourcesRoot`. */
  entriesWithFolder: AlSourceEntry[];
  /**
   * Subset of `entriesWithFolder` whose folder resolves somewhere other than
   * the built-in default — i.e. a real machine path that must be preserved in
   * `sourcesRoot` before the workspace value is cleared. A folder like
   * `%LOCALAPPDATA%\acdc-sources` is portable and merely redundant, so it is
   * excluded: clearing it changes nothing.
   */
  entriesWithMachinePath: AlSourceEntry[];
  /**
   * A `folder` key is still persisted on a git-backed entry, including the
   * `"folder": ""` an earlier migration pass left behind. Purely cosmetic —
   * resolution is unaffected — but it is noise in a committed workspace file.
   */
  staleFolderKeys: number;
  /** Workspace roots we own that still use the `file:` scheme. */
  legacyMounts: vscode.WorkspaceFolder[];
  /** `git.ignoredRepositories` values pointing at one of our source folders. */
  ignoredRepositories: string[];
  /** True when the machine-scoped root has not been set by the user yet. */
  sourcesRootUnset: boolean;
}

export function detectLegacyConfiguration(): ILegacyFindings {
  const entries = getEntries();
  const ourFolders = entries.map(effectiveFolder).filter(Boolean).map(normalize);
  const defaultRoot = normalize(getDefaultSourcesBaseDir());

  const gitConfig = vscode.workspace.getConfiguration("git");
  const ignored = gitConfig.get<string[]>("ignoredRepositories", []) ?? [];

  const entriesWithFolder = entries.filter(
    (e) => e.repository.trim() && e.folder.trim()
  );

  return {
    entriesWithFolder,
    entriesWithMachinePath: entriesWithFolder.filter(
      (e) => normalize(expandEnvVars(e.folder.trim())) !== defaultRoot
    ),
    staleFolderKeys: getRawEntries().filter(
      (e) => (e.repository ?? "").trim() && e.folder !== undefined
    ).length,
    legacyMounts: (vscode.workspace.workspaceFolders ?? []).filter(
      (f) => f.name.startsWith(MOUNT_PREFIX) && f.uri.scheme === "file"
    ),
    ignoredRepositories: ignored.filter((p) =>
      ourFolders.includes(normalize(p))
    ),
    sourcesRootUnset: getSourcesRootSetting() === "",
  };
}

export function hasLegacyConfiguration(findings: ILegacyFindings): boolean {
  return (
    findings.entriesWithFolder.length > 0 ||
    findings.staleFolderKeys > 0 ||
    findings.legacyMounts.length > 0 ||
    findings.ignoredRepositories.length > 0
  );
}

/**
 * Activation hook. Notifies once per workspace when legacy configuration is
 * found and offers to repair it. Silent when nothing is stale or the user
 * previously dismissed the prompt.
 */
export async function promptForLegacyMigration(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  if (context.workspaceState.get<boolean>(SUPPRESS_KEY) === true) {
    return;
  }
  const findings = detectLegacyConfiguration();
  if (!hasLegacyConfiguration(findings)) {
    return;
  }

  const detail = describeFindings(findings);
  output.appendLine(`[alBaseCode] Legacy configuration detected: ${detail}`);

  const machineSpecific =
    findings.entriesWithMachinePath.length > 0 ||
    findings.legacyMounts.length > 0 ||
    findings.ignoredRepositories.length > 0;

  const message = machineSpecific
    ? `AC\u26a1DC: this workspace still stores machine-specific AL source paths (${detail}). ` +
      `They can be replaced with the portable "${AL_SOURCE_SCHEME}:" layout so the workspace file works for every developer.`
    : `AC\u26a1DC: this workspace has leftover AL source settings (${detail}) that are now redundant — ` +
      `the clone location comes from the machine-scoped "acdc.alBaseCode.sourcesRoot". Clearing them changes nothing on disk.`;

  const choice = await vscode.window.showInformationMessage(
    message,
    "Migrate now",
    "Show me the setting",
    "Not now"
  );

  if (choice === "Migrate now") {
    await runMigration(context, output);
  } else if (choice === "Show me the setting") {
    await openSourcesRootSetting();
  } else if (choice === "Not now") {
    await context.workspaceState.update(SUPPRESS_KEY, true);
  }
}

/**
 * Performs the repair: seeds the machine-scoped root from whatever the
 * workspace had configured, strips the now-redundant folders out of workspace
 * settings, removes legacy `file:` mounts, and scrubs `git.ignoredRepositories`.
 */
export async function runMigration(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  const findings = detectLegacyConfiguration();
  const steps: string[] = [];

  // 1. Seed the machine-scoped root from the folder the workspace used, so the
  //    existing clones on disk keep resolving after the folder is cleared.
  //    Skipped when the folder already resolves to the built-in default — then
  //    clearing it is a no-op and writing a literal path would only add noise.
  if (findings.sourcesRootUnset && findings.entriesWithMachinePath.length > 0) {
    const root = expandEnvVars(findings.entriesWithMachinePath[0].folder.trim());
    await setSourcesRootSetting(root);
    steps.push(`set sourcesRoot to "${root}" (User settings)`);
  }

  // 2. Drop redundant folders from git-backed entries in the workspace.
  //    saveEntries omits the key entirely once the value is empty.
  if (findings.staleFolderKeys > 0) {
    const cleaned = getEntries().map((entry) =>
      entry.repository.trim() ? { ...entry, folder: "" } : entry
    );
    await saveEntries(cleaned);
    steps.push(
      `removed ${findings.staleFolderKeys} folder key(s) from workspace settings`
    );
  }

  // 3. Legacy file: mounts are replaced by acdc-alsrc: ones on the next sync;
  //    remove them here so the workspace file stops carrying the old path.
  if (findings.legacyMounts.length > 0) {
    const indexes = findings.legacyMounts
      .map((f) => f.index)
      .sort((a, b) => b - a);
    for (const index of indexes) {
      vscode.workspace.updateWorkspaceFolders(index, 1);
    }
    steps.push(`unmounted ${indexes.length} legacy file: folder(s)`);
  }

  // 4. Virtual mounts are never scanned by the Git extension, so these entries
  //    are dead weight carrying an absolute path.
  if (findings.ignoredRepositories.length > 0) {
    await clearOurGitIgnoredRepositories();
    steps.push(
      `removed ${findings.ignoredRepositories.length} git.ignoredRepositories entry/entries`
    );
  }

  await context.workspaceState.update(SUPPRESS_KEY, true);

  const summary = steps.length > 0 ? steps.join("; ") : "nothing to change";
  output.appendLine(`[alBaseCode] Migration complete: ${summary}.`);

  const next = await vscode.window.showInformationMessage(
    `AL Base Code migrated: ${summary}. Run a sync to remount the sources in portable form.`,
    "Sync now",
    "Open setting"
  );
  if (next === "Sync now") {
    await vscode.commands.executeCommand("acdc.syncAlBaseCode");
  } else if (next === "Open setting") {
    await openSourcesRootSetting();
  }
}

async function openSourcesRootSetting(): Promise<void> {
  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "acdc.alBaseCode.sourcesRoot"
  );
}

function describeFindings(findings: ILegacyFindings): string {
  const parts: string[] = [];
  if (findings.entriesWithMachinePath.length > 0) {
    parts.push(`${findings.entriesWithMachinePath.length} clone folder(s)`);
  } else if (findings.staleFolderKeys > 0) {
    parts.push(`${findings.staleFolderKeys} redundant folder key(s)`);
  }
  if (findings.legacyMounts.length > 0) {
    parts.push(`${findings.legacyMounts.length} workspace mount(s)`);
  }
  if (findings.ignoredRepositories.length > 0) {
    parts.push(`${findings.ignoredRepositories.length} git-ignore entry/entries`);
  }
  return parts.join(", ");
}

function normalize(value: string): string {
  return value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}
