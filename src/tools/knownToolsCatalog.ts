/**
 * Catalog of known tool prefixes referenced in .agent.md files.
 * Used to show install guidance when a tool is not configured, and to
 * identify deprecated tools that should be stripped during normalization.
 */

export type KnownToolType = "mcp-server" | "vscode-extension" | "deprecated";

export interface KnownToolSuggestion {
  type: KnownToolType;
  description: string;
  /** JSON snippet to add to mcp.json (for mcp-server) */
  mcpConfig?: string;
  /** VS Code marketplace extension ID (for vscode-extension) */
  extensionId?: string;
  extensionName?: string;
  /** For deprecated: what replaces it */
  replacedBy?: string;
}

/** Keys are tool ID prefixes as they appear in agent files (before the first /). */
const CATALOG: Record<string, KnownToolSuggestion> = {
  // ── MCP Servers ──────────────────────────────────────────────────────────

  "upstash": {
    type: "mcp-server",
    description: "Context7 (Upstash) – resolves up-to-date npm/library documentation into agent context",
    mcpConfig: `"context7": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp@latest"]
}`,
  },
  "context7": {
    type: "mcp-server",
    description: "Context7 (Upstash) – resolves up-to-date npm/library documentation into agent context",
    mcpConfig: `"context7": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp@latest"]
}`,
  },

  "markitdown": {
    type: "mcp-server",
    description: "MarkItDown (Microsoft) – converts PDF, Office, images and other files to Markdown",
    mcpConfig: `"markitdown": {
  "type": "stdio",
  "command": "uvx",
  "args": ["markitdown-mcp"]
}`,
  },

  "azure-devops": {
    type: "mcp-server",
    description: "Azure DevOps MCP – access work items, repos and pipelines",
    mcpConfig: `"azure-devops": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@azure-devops/mcp", "<org>", "--authentication", "env"],
  "env": {
    "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/<org>",
    "AZURE_DEVOPS_PAT": "<your-pat>"
  }
}`,
  },

  "azure-mcp": {
    type: "mcp-server",
    description: "Legacy alias used in some agent files for Azure DevOps MCP search tools",
    mcpConfig: `"azure-devops": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@azure-devops/mcp", "<org>", "--authentication", "env"],
  "env": {
    "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/<org>",
    "AZURE_DEVOPS_PAT": "<your-pat>"
  }
}`,
  },

  // ── VS Code Extensions ────────────────────────────────────────────────────

  "vscode.mermaid-chat-features": {
    type: "deprecated",
    description: "VS Code built-in Mermaid Chat feature — not available in the marketplace and removed from agent requirements",
    replacedBy: undefined,
  },

  "ms-vscode.vscode-websearchforcopilot": {
    type: "vscode-extension",
    description: "Web Search for GitHub Copilot – adds real-time web search to chat",
    extensionId: "ms-vscode.vscode-websearchforcopilot",
    extensionName: "Web Search for GitHub Copilot",
  },

  "sshadowsdk.al-lsp-for-agents": {
    type: "vscode-extension",
    description: "AL LSP for Agents – exposes AL language server features (go-to-definition, references, call hierarchy) as LM tools",
    extensionId: "sshadowsdk.al-lsp-for-agents",
    extensionName: "AL LSP for Agents",
  },

  "ms-dynamics-smb.al": {
    type: "vscode-extension",
    description: "AL Language extension for Microsoft Dynamics 365 Business Central",
    extensionId: "ms-dynamics-smb.al",
    extensionName: "AL Language",
  },

  // ── Deprecated (remove during normalization) ──────────────────────────────

  "upstash/context7": {
    type: "deprecated",
    description: "Slash in mcp.json key — use key 'context7' instead",
    replacedBy: "context7",
  },
};

/**
 * Returns the catalog entry for a tool ID (exact or prefix match).
 * e.g. "upstash/context7/*" → looks up "upstash/context7", then "upstash".
 */
export function lookupKnownTool(toolId: string): KnownToolSuggestion | undefined {
  // Exact match first
  if (CATALOG[toolId]) { return CATALOG[toolId]; }
  // Try progressively shorter prefix segments
  const parts = toolId.split("/");
  for (let len = parts.length - 1; len >= 1; len--) {
    const prefix = parts.slice(0, len).join("/");
    if (CATALOG[prefix]) { return CATALOG[prefix]; }
  }
  return undefined;
}

/**
 * Tool ID patterns that should be stripped from agent files during
 * normalization because they are deprecated or renamed.
 */
export const DEPRECATED_TOOL_PATTERNS: RegExp[] = [
  // No entries yet — add as tools become deprecated
];
