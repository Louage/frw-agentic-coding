/**
 * Presentation-layer logic for the tool picker, kept vscode-free (see AGENTS.md) so both
 * defects it fixes are unit-testable:
 *
 * - **B2** the Tools summary counted *tokens*, so a group wildcard read as "1 added"
 *   instead of the ten tools it actually grants. `summarizeToolSelection` counts the
 *   expansion.
 * - **B3** every selected token missing from the runtime catalog was labelled
 *   "Not currently registered - uncheck to remove it from this agent", which invited the
 *   user to permanently strip a tool whose MCP server merely was not running.
 *   `classifyUnavailableTokens` separates always-available built-ins and offline providers
 *   (never removable) from genuinely unknown tokens.
 *
 * Why built-ins land here at all: the owner index is built from
 * `vscode.extensions.all[].packageJSON.contributes.languageModelTools`, but a large set of
 * tools (`vscode_askQuestions`, `manage_todo_list`, `get_terminal_output`,
 * `vscode_listCodeUsages`, ...) is registered by the VS Code workbench itself and appears in
 * no extension manifest. Those tools can never enter the index no matter what is installed,
 * so their frontmatter tokens must be classified by namespace, not by catalog membership.
 */

import { expandToolTokens, type BuildPickerOptions } from "./toolPickerModel";
import type { ToolCatalogEntry } from "./toolIdentity";

export type ToolAvailability = "builtin" | "provider-offline" | "unknown";

export interface UnavailableToolInfo {
  token: string;
  availability: ToolAvailability;
  /** The namespace the token names: "vscode", "al-symbols-mcp", "" for a bare token. */
  ownerId: string;
  /** Short badge for the row. */
  badge: string;
  /** Full sentence shown under the row. */
  reason: string;
  /** Only a genuinely unknown token may be unchecked; everything else stays granted. */
  removable: boolean;
}

export interface AvailabilityContext {
  /** Built-in toolset names: `VSCODE_BUILTIN_PREFIXES` plus any contributed toolset. */
  builtinNamespaces: ReadonlySet<string>;
  /** Server ids known to `getAvailableMcpServerIds` - configured, possibly not running. */
  knownMcpServerIds: ReadonlySet<string>;
  /** `vscode.extensions.all[].id`. */
  installedExtensionIds: ReadonlySet<string>;
}

export function classifyUnavailableToken(
  token: string,
  context: AvailabilityContext
): UnavailableToolInfo {
  const trimmed = token.trim();
  const isWildcard = trimmed.endsWith("/*");
  const ownerId = namespaceOf(trimmed, isWildcard);

  if (!ownerId) {
    // A bare token: either a built-in toolset name (`todo`, `agent`) or nothing we know.
    if (context.builtinNamespaces.has(trimmed)) {
      return builtin(trimmed, trimmed);
    }
    return {
      token: trimmed,
      availability: "unknown",
      ownerId: "",
      badge: "Unknown",
      reason:
        "No installed extension, configured MCP server or built-in toolset provides this tool.",
      removable: true,
    };
  }

  if (context.builtinNamespaces.has(ownerId)) {
    return builtin(trimmed, ownerId);
  }

  if (context.installedExtensionIds.has(ownerId)) {
    return offline(
      trimmed,
      ownerId,
      "Not registered yet",
      `${ownerId} is installed but has not registered this tool in this session.`
    );
  }

  if (matchesKnownMcpServer(ownerId, context.knownMcpServerIds)) {
    return offline(
      trimmed,
      ownerId,
      "Server offline",
      `MCP server "${ownerId}" is known but is not running right now. It stays granted.`
    );
  }

  return offline(
    trimmed,
    ownerId,
    isExtensionId(ownerId) ? "Extension missing" : "Provider offline",
    isExtensionId(ownerId)
      ? `Extension "${ownerId}" is not installed. The tool stays granted and works again once it is.`
      : `"${ownerId}" is not available right now. The tool stays granted and works again once it is.`
  );
}

export function classifyUnavailableTokens(
  tokens: readonly string[],
  context: AvailabilityContext
): UnavailableToolInfo[] {
  return tokens.map((token) => classifyUnavailableToken(token, context));
}

export interface ToolCounts {
  /** Tools actually granted, wildcards expanded. This is the headline number (B2). */
  tools: number;
  /** Tokens written to frontmatter - a wildcard counts once. */
  tokens: number;
  disabled: number;
  /** Tools added on top of what the agent declares, wildcards expanded. */
  added: number;
  addedTokens: number;
}

export function summarizeToolSelection(
  declaredTools: readonly string[],
  disabledTools: readonly string[],
  extraTools: readonly string[],
  catalog: ToolCatalogEntry[],
  options: BuildPickerOptions = {}
): ToolCounts {
  const disabled = new Set(clean(disabledTools));
  const effectiveTokens = dedupe(
    [...clean(declaredTools), ...clean(extraTools)].filter((token) => !disabled.has(token))
  );
  const extraTokens = dedupe(clean(extraTools).filter((token) => !disabled.has(token)));

  return {
    tools: expandToolTokens(effectiveTokens, catalog, options).length,
    tokens: effectiveTokens.length,
    disabled: dedupe(clean(disabledTools)).length,
    added: expandToolTokens(extraTokens, catalog, options).length,
    addedTokens: extraTokens.length,
  };
}

function builtin(token: string, ownerId: string): UnavailableToolInfo {
  return {
    token,
    availability: "builtin",
    ownerId,
    badge: "Built-in",
    reason: "Provided by VS Code itself and always available; it is simply not listed above.",
    removable: false,
  };
}

function offline(
  token: string,
  ownerId: string,
  badge: string,
  reason: string
): UnavailableToolInfo {
  return { token, availability: "provider-offline", ownerId, badge, reason, removable: false };
}

/**
 * `upstash/context7/*` names the server `upstash/context7`, but the discovery service may
 * only know `upstash` or `context7`, so accept any segment of the id.
 */
function matchesKnownMcpServer(ownerId: string, known: ReadonlySet<string>): boolean {
  if (known.has(ownerId)) {
    return true;
  }
  return ownerId.split("/").some((segment) => segment.length > 0 && known.has(segment));
}

function namespaceOf(token: string, isWildcard: boolean): string {
  if (isWildcard) {
    return token.slice(0, -2);
  }
  const slashIndex = token.indexOf("/");
  return slashIndex > 0 ? token.slice(0, slashIndex) : "";
}

/** Extension ids are `publisher.name`; MCP server ids conventionally are not dotted. */
function isExtensionId(ownerId: string): boolean {
  return ownerId.includes(".") && !ownerId.includes("/");
}

function clean(tokens: readonly string[]): string[] {
  return tokens.map((token) => token?.trim()).filter((token): token is string => !!token);
}

function dedupe(tokens: string[]): string[] {
  return [...new Set(tokens)];
}
