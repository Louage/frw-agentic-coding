import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  AL_MCP_SERVER_ARGS,
  AL_MCP_SERVER_LABEL,
  buildAlMcpServerArgs,
  type AlWorkspaceProjection,
} from "./alMcpServer";
import {
  AL_EXTENSION_ID,
  altoolVersionTag,
  resolveAltoolCommand,
  type AltoolResolution,
} from "./alToolchain";

/** Must match `contributes.mcpServerDefinitionProviders[].id` in package.json. */
const PROVIDER_ID = "acdc.alMcpServer";

function resolve(): AltoolResolution {
  return resolveAltoolCommand({
    alExtensionPath: vscode.extensions.getExtension(AL_EXTENSION_ID)?.extensionPath,
    platform: process.platform,
    fileExists: (candidate) => fs.existsSync(candidate),
  });
}

function workspaceProjection(): AlWorkspaceProjection {
  const folders = vscode.workspace.workspaceFolders;
  return {
    folders: folders?.map((folder) => ({
      name: folder.name,
      path: folder.uri.fsPath,
      scheme: folder.uri.scheme,
      // Root probe only — a recursive one would pick up nested test apps.
      hasAppJson:
        folder.uri.scheme === "file" &&
        fs.existsSync(path.join(folder.uri.fsPath, "app.json")),
    })),
  };
}

/**
 * Contributes Microsoft's AL MCP server (`altool launchmcpserver`) so every
 * profile gets it without hand-editing `mcp.json`. Contributes nothing when the
 * AL extension or `altool` is absent, and never throws into `activate()`.
 */
export function registerAlMcpServerProvider(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): void {
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") {
    output.appendLine("[MCP] Host does not support MCP server definition providers; skipping.");
    return;
  }

  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(changed);

  // Signature = command + launch args, so a folder added/removed at runtime
  // re-resolves the definition just like an AL extension upgrade does.
  let lastSignature: string | undefined;
  const refresh = (): void => {
    const resolution = resolve();
    const signature =
      resolution.kind === "ok"
        ? [resolution.command, ...buildAlMcpServerArgs(workspaceProjection())].join("\u0000")
        : undefined;
    if (signature !== lastSignature) {
      lastSignature = signature;
      changed.fire();
    }
  };

  context.subscriptions.push(
    vscode.extensions.onDidChange(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh)
  );

  try {
    context.subscriptions.push(
      vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
        onDidChangeMcpServerDefinitions: changed.event,
        provideMcpServerDefinitions: () => {
          const resolution = resolve();

          switch (resolution.kind) {
            case "no-extension":
              lastSignature = undefined;
              output.appendLine(
                `[MCP] '${AL_EXTENSION_ID}' is not installed; the '${AL_MCP_SERVER_LABEL}' MCP server is not contributed.`
              );
              return [];
            case "no-binary":
              lastSignature = undefined;
              output.appendLine(
                `[MCP] altool not found at ${resolution.expected}; the '${AL_MCP_SERVER_LABEL}' MCP server is not contributed.`
              );
              return [];
            case "ok": {
              const args = buildAlMcpServerArgs(workspaceProjection());
              lastSignature = [resolution.command, ...args].join("\u0000");
              const projects = args.slice(AL_MCP_SERVER_ARGS.length);
              output.appendLine(
                `[MCP] Contributing '${AL_MCP_SERVER_LABEL}' from ${resolution.command}` +
                  (projects.length > 0
                    ? ` with ${projects.length} AL project(s): ${projects.join(", ")}`
                    : " with no AL project (no workspace folder contains app.json)")
              );
              return [
                new vscode.McpStdioServerDefinition(
                  AL_MCP_SERVER_LABEL,
                  resolution.command,
                  args,
                  {},
                  altoolVersionTag(resolution.extensionPath)
                ),
              ];
            }
          }
        },
      })
    );
  } catch (error) {
    output.appendLine(`[MCP] Failed to register the AL MCP server provider: ${String(error)}`);
  }
}
