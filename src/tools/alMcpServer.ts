// vscode-free: pure resolution of Microsoft's AL MCP server launch command.
// Binary resolution lives in alToolchain.ts; the vscode adapter in alMcpServerProvider.ts.
import { AL_SOURCE_MOUNT_PREFIX } from "../alSourceMountPlan";

/**
 * Server name surfaced in the MCP server list. Matches the name used in
 * Microsoft's own documented sample so agent files and docs agree.
 */
export const AL_MCP_SERVER_LABEL = "al";

/** `altool launchmcpserver --transport stdio` — see the AL MCP server docs. */
export const AL_MCP_SERVER_ARGS = ["launchmcpserver", "--transport", "stdio"];

export interface AlProjectFolder {
  /** Workspace folder display name, i.e. `vscode.WorkspaceFolder.name`. */
  name: string;
  /** Filesystem path of the workspace folder. */
  path: string;
  /** URI scheme of the workspace folder. */
  scheme: string;
  /**
   * True when `app.json` exists at the folder ROOT. Never a recursive match: a
   * `**` probe would promote nested test apps and `.alpackages` payloads to
   * projects in their own right.
   */
  hasAppJson: boolean;
}

/**
 * The slice of window state the launch args depend on. `folders` is `undefined`
 * when no folder is open, mirroring `vscode.workspace.workspaceFolders`.
 */
export interface AlWorkspaceProjection {
  folders: readonly AlProjectFolder[] | undefined;
}

/**
 * Workspace folders that are real AL projects: on disk, carrying a root
 * `app.json`, and not one of our AL Base Code mirrors.
 *
 * The mount exclusion is unconditional and is the point of this function. An
 * `[AL Src] ` folder is a read-only mirror of the BC base app or an ISV product
 * holding hundreds of `app.json` files; handing those to the MCP server would
 * load the entire base codebase. In this extension a multi-root window
 * frequently exists *because of* those mounts, so "multi-root" does not imply
 * more than one real project — hence a per-folder filter rather than one keyed
 * off the window shape.
 */
export function resolveAlProjectPaths(workspace: AlWorkspaceProjection): string[] {
  return (workspace.folders ?? [])
    .filter(
      (folder) =>
        folder.scheme === "file" &&
        !folder.name.startsWith(AL_SOURCE_MOUNT_PREFIX) &&
        folder.hasAppJson
    )
    .map((folder) => folder.path);
}

/**
 * Launch arguments for the `al` MCP server: the transport options followed by
 * the window's AL projects as the variadic `<projects>` positional (D28), so the
 * server comes up preloaded instead of empty. No qualifying folder — including
 * the no-folder case — means no positional argument at all.
 */
export function buildAlMcpServerArgs(workspace: AlWorkspaceProjection): string[] {
  return [...AL_MCP_SERVER_ARGS, ...resolveAlProjectPaths(workspace)];
}
