import * as vscode from "vscode";

/**
 * Copies the extension's bundled agent customizations (instruction "rules" and
 * SKILL.md "skills") from the packaged `assets/` folder into the open
 * workspace's `.github/` folder, so VS Code chat/agent mode picks them up.
 *
 * - instruction files -> `.github/instructions/`
 * - skills            -> `.github/skills/`
 */
export async function installCustomizations(
  context: vscode.ExtensionContext
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(
      "The Framework: Open a folder/workspace first to install company skills & rules."
    );
    return;
  }

  const sourceRoot = vscode.Uri.joinPath(context.extensionUri, "assets");
  const targetGithub = vscode.Uri.joinPath(workspaceFolder.uri, ".github");

  const copied = await copyTree(
    vscode.Uri.joinPath(sourceRoot, "instructions"),
    vscode.Uri.joinPath(targetGithub, "instructions")
  );
  const copiedSkills = await copyTree(
    vscode.Uri.joinPath(sourceRoot, "skills"),
    vscode.Uri.joinPath(targetGithub, "skills")
  );

  vscode.window.showInformationMessage(
    `The Framework: Installed ${copied + copiedSkills} customization file(s) into .github/.`
  );
}

/**
 * Recursively copies a directory tree, creating folders as needed.
 * Returns the number of files copied.
 */
async function copyTree(source: vscode.Uri, target: vscode.Uri): Promise<number> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(source);
  } catch {
    return 0;
  }

  await vscode.workspace.fs.createDirectory(target);

  let count = 0;
  for (const [name, type] of entries) {
    const from = vscode.Uri.joinPath(source, name);
    const to = vscode.Uri.joinPath(target, name);
    if (type === vscode.FileType.Directory) {
      count += await copyTree(from, to);
    } else if (type === vscode.FileType.File) {
      const data = await vscode.workspace.fs.readFile(from);
      await vscode.workspace.fs.writeFile(to, data);
      count++;
    }
  }
  return count;
}
