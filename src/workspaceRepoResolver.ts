import * as vscode from "vscode";

export type RepoResolutionMode = "explicit" | "single-root" | "picked";

export interface RepoSelection {
  folder: vscode.WorkspaceFolder;
  mode: RepoResolutionMode;
}

/**
 * Resolves the target repository folder for repo-scoped operations.
 * In multi-root workspaces, when no explicit target is provided,
 * this function keeps a human in the loop via Quick Pick.
 */
export async function resolveRepositoryFolder(
  explicitFolderName?: string
): Promise<RepoSelection | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage("No workspace folder is open.");
    return undefined;
  }

  if (explicitFolderName) {
    const match = folders.find(
      (f) => f.name.toLowerCase() === explicitFolderName.toLowerCase()
    );
    if (!match) {
      vscode.window.showWarningMessage(
        `Repository '${explicitFolderName}' was not found in the current workspace.`
      );
      return undefined;
    }
    return { folder: match, mode: "explicit" };
  }

  if (folders.length === 1) {
    return { folder: folders[0], mode: "single-root" };
  }

  const picks = folders.map((folder) => ({
    label: folder.name,
    description: folder.uri.fsPath,
    folder,
  }));

  const picked = await vscode.window.showQuickPick(picks, {
    title: "Select Repository",
    placeHolder:
      "This workspace has multiple repositories. Choose the repository to target.",
    ignoreFocusOut: true,
  });

  if (!picked) {
    return undefined;
  }

  return { folder: picked.folder, mode: "picked" };
}

/**
 * Guard for repo-scoped commands: resolve the target repository and ask for
 * confirmation before running an operation when the target is selected by user.
 */
export async function withRepositoryGuard(
  actionLabel: string,
  run: (folder: vscode.WorkspaceFolder) => Promise<void> | void,
  explicitFolderName?: string
): Promise<void> {
  const resolved = await resolveRepositoryFolder(explicitFolderName);
  if (!resolved) {
    return;
  }

  if (resolved.mode === "picked") {
    const proceed = await vscode.window.showInformationMessage(
      `Run '${actionLabel}' on '${resolved.folder.name}'?`,
      { modal: true },
      "Run",
      "Cancel"
    );

    if (proceed !== "Run") {
      return;
    }
  }

  await run(resolved.folder);
}
