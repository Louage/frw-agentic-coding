import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { lookupKnownTool, type KnownToolSuggestion } from "./knownToolsCatalog";

/**
 * Discovers MCP server IDs available to the current VS Code instance by:
 * 1. Reading registered vscode.lm.tools (actively running servers)
 * 2. Reading mcp.json files from workspace + all user profiles
 *
 * This lets the extension resolve tool references in agent files against
 * what the user actually has configured, without hardcoding server IDs.
 */
export async function getAvailableMcpServerIds(
  context: vscode.ExtensionContext
): Promise<Set<string>> {
  const servers = new Set<string>();

  // 1. From actively registered LM tools (servers currently running)
  for (const tool of vscode.lm.tools) {
    const prefix = extractServerPrefix(tool.name);
    if (prefix) { servers.add(prefix); }
  }

  // 2. From mcp.json config files (workspace + all user profiles)
  for (const filePath of findMcpJsonPaths(context)) {
    for (const serverId of parseMcpServerIds(filePath)) {
      servers.add(serverId);
    }
  }

  return servers;
}

/**
 * VS Code built-in tool group prefixes — always available, no MCP server needed.
 * Exported so consumers can filter them from required-tool reporting.
 */
export const VSCODE_BUILTIN_PREFIXES = new Set([
  "read", "search", "edit", "execute", "web", "browser", "agent", "todo", "new", "changes",
]);

/**
 * Checks a list of tool references (as found in agent files) against
 * the given set of available server IDs. Returns availability per tool,
 * plus a catalog suggestion for unavailable tools that are known.
 * Built-in VS Code tool categories are always marked as available.
 */
export function checkToolAvailability(
  toolServerIds: string[],
  availableServers: Set<string>
): Array<{ id: string; available: boolean; deprecated?: boolean; suggestion?: KnownToolSuggestion }> {
  return toolServerIds.map((id) => {
    const catalogEntry = lookupKnownTool(id);
    if (catalogEntry?.type === "deprecated") {
      return { id, available: false, deprecated: true, suggestion: catalogEntry };
    }
    const extensionAvailable =
      catalogEntry?.type === "vscode-extension" && !!catalogEntry.extensionId
        ? isExtensionInstalled(catalogEntry.extensionId)
        : false;
    const available =
      VSCODE_BUILTIN_PREFIXES.has(id) ||
      availableServers.has(id) ||
      hasEquivalentServer(id, availableServers) ||
      extensionAvailable;
    const suggestion = available ? undefined : catalogEntry;
    return { id, available, suggestion };
  });
}

function hasEquivalentServer(id: string, availableServers: Set<string>): boolean {
  // External agent packs sometimes use legacy/generic names that differ from
  // the actual configured server key in mcp.json.
  if (id === "azure-mcp") {
    return (
      availableServers.has("azure-devops") ||
      availableServers.has("@azure-devops/mcp") ||
      availableServers.has("azure-devops-mcp")
    );
  }
  return false;
}

function isExtensionInstalled(extensionId: string): boolean {
  const ext = vscode.extensions.getExtension(extensionId);
  return !!ext;
}

/**
 * Extracts the server ID prefix from a tool name registered in vscode.lm.tools.
 * MCP tools are typically named "{serverId}_{toolName}" or "{serverId}/{toolName}".
 */
function extractServerPrefix(toolName: string): string | undefined {
  const slashIdx = toolName.indexOf("/");
  if (slashIdx > 0) { return toolName.substring(0, slashIdx); }
  const underscoreIdx = toolName.indexOf("_");
  if (underscoreIdx > 0) { return toolName.substring(0, underscoreIdx); }
  return undefined;
}

/**
 * Locates mcp.json files from:
 * - Workspace .vscode/mcp.json
 * - User root mcp.json (Code/User/mcp.json)
 * - All profile mcp.json files (Code/User/profiles/{id}/mcp.json)
 *
 * The user data dir is derived from globalStorageUri:
 *   .../Code/User/globalStorage/{extId}  →  .../Code/User
 */
function findMcpJsonPaths(context: vscode.ExtensionContext): string[] {
  const paths: string[] = [];

  // Workspace-level
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    tryAdd(paths, path.join(folder.uri.fsPath, ".vscode", "mcp.json"));
  }

  // User data dir: two levels up from globalStorageUri
  // e.g. C:\Users\…\Code\User\globalStorage\{extId}  →  C:\Users\…\Code\User
  const userDataDir = path.resolve(context.globalStorageUri.fsPath, "..", "..");

  tryAdd(paths, path.join(userDataDir, "mcp.json"));

  const profilesDir = path.join(userDataDir, "profiles");
  if (fs.existsSync(profilesDir)) {
    try {
      for (const profileId of fs.readdirSync(profilesDir)) {
        tryAdd(paths, path.join(profilesDir, profileId, "mcp.json"));
      }
    } catch { /* ignore FS errors */ }
  }

  return paths;
}

function tryAdd(arr: string[], filePath: string): void {
  if (fs.existsSync(filePath)) { arr.push(filePath); }
}

interface McpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  [key: string]: unknown;
}

/**
 * Parses a single mcp.json file and returns ALL identifiers that could be used
 * to reference its servers:
 *
 * - The mcp.json key itself          e.g. "bc-code-intel"
 * - The npx package name in args     e.g. "bc-code-intelligence-mcp"
 * - Aliases derived from an HTTP URL e.g. "microsoft.docs.mcp" URL gives
 *                                         "microsoft", "microsoft-learn", "learn.microsoft"
 *
 * This lets agent files that use the package name (e.g. "bc-code-intelligence-mcp/*")
 * match a server configured with a different key (e.g. "bc-code-intel").
 */
function parseMcpServerIds(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as { servers?: Record<string, McpServerConfig> };
    if (parsed?.servers && typeof parsed.servers === "object") {
      const ids: string[] = [];
      for (const [key, config] of Object.entries(parsed.servers)) {
        ids.push(key);

        // stdio: extract the package name from npx / node args, including scoped packages.
        // e.g. { command: "npx", args: ["bc-code-intelligence-mcp"] }
        //   → adds "bc-code-intelligence-mcp"
        // e.g. { command: "npx", args: ["--yes", "al-go-mcp-server@latest"] }
        //   → adds "al-go-mcp-server"
        // e.g. { command: "npx", args: ["--yes", "@upstash/context7-mcp@latest"] }
        //   → adds "upstash", "context7-mcp", "context7"
        if (typeof config.command === "string" && Array.isArray(config.args)) {
          for (const arg of config.args) {
            if (typeof arg === "string" && !arg.startsWith("-") && arg !== "npx" && arg !== "node") {
              // Strip @version but preserve @scope/pkg
              const noVersion = arg.replace(/@[^/@][^/]*$/, "");
              if (noVersion.startsWith("@")) {
                // Scoped package: @org/pkg → extract org, pkg, and pkg base
                const withoutAt = noVersion.slice(1);
                const slashIdx = withoutAt.indexOf("/");
                if (slashIdx > 0) {
                  const scope = withoutAt.slice(0, slashIdx);         // "upstash"
                  const pkg   = withoutAt.slice(slashIdx + 1);        // "context7-mcp"
                  ids.push(scope);                                     // "upstash"
                  ids.push(pkg);                                       // "context7-mcp"
                  ids.push(pkg.replace(/-mcp$|-server$/, ""));        // "context7"
                }
              } else {
                // Unscoped package
                ids.push(noVersion);
              }
              break;
            }
          }
        }

        // http: derive aliases from the server URL
        // e.g. "https://learn.microsoft.com/api/mcp"
        //   → adds "microsoft", "microsoft-learn", "learn.microsoft"
        if (typeof config.url === "string") {
          try {
            const hostname = new URL(config.url).hostname; // "learn.microsoft.com"
            const parts = hostname.replace(/^www\./, "").split(".");
            if (parts.length >= 2) {
              const domain = parts[parts.length - 2]; // "microsoft"
              const sub = parts.length >= 3 && parts[0] !== "api" ? parts[0] : undefined; // "learn"
              ids.push(domain);
              if (sub) {
                ids.push(`${domain}-${sub}`);   // "microsoft-learn"
                ids.push(`${sub}.${domain}`);   // "learn.microsoft"
              }
            }
          } catch { /* ignore invalid URLs */ }
        }
      }
      return ids;
    }
  } catch { /* ignore parse/read errors */ }
  return [];
}
