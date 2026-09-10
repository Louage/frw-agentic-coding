/**
 * Tool identity: maps the bare runtime names reported by `vscode.lm.tools` onto the
 * qualified tokens VS Code expects in agent `tools:` frontmatter and in our settings
 * (`al_build` -> `ms-dynamics-smb.al/al_build`).
 *
 * Deliberately vscode-free so it can be unit-tested (see AGENTS.md). The host maps
 * `vscode.extensions.all` onto `ContributingExtension` at the call site.
 */

export type ToolOwnerKind = "builtin" | "extension" | "mcp" | "unknown";

/** A parent node in the picker; also the wildcard namespace for that node. */
export interface ToolOwner {
  kind: ToolOwnerKind;
  /** Qualifier prefix and group key: "ms-dynamics-smb.al" | "al-symbols-mcp" | "read" | "". */
  id: string;
  /** Human label shown on the parent row: "AL Language" | "al-symbols-mcp" | "Built-In". */
  label: string;
  /** Token persisted when the parent row is selected, e.g. "ms-dynamics-smb.al/*". */
  wildcardId?: string;
}

export interface ToolCatalogEntry {
  /** Raw name as reported by vscode.lm.tools, e.g. "al_build". */
  runtimeName: string;
  /** Token persisted in settings and frontmatter, e.g. "ms-dynamics-smb.al/al_build". */
  qualifiedId: string;
  label: string;
  description: string;
  owner: ToolOwner;
}

/** One `contributes.languageModelTools` entry. */
export interface ContributedTool {
  /** `name` — what `vscode.lm.tools` reports, e.g. "al_getdiagnostics". */
  name: string;
  /** `toolReferenceName` — what frontmatter refers to, e.g. "al_get_diagnostics". */
  referenceName?: string;
}

/** One `contributes.languageModelToolSets` entry; members are *reference* names. */
export interface ContributedToolSet {
  /** "read", "edit", "execute", … */
  name: string;
  /** Member reference names: ["readFile", "problems", …]. */
  toolReferenceNames: string[];
}

/** Minimal projection of vscode.extensions.all — keeps this module vscode-free. */
export interface ContributingExtension {
  id: string;               // "ms-dynamics-smb.al"
  displayName?: string;     // "AL Language"
  /** Runtime names only. Prefer `tools` when reference names are available. */
  toolNames?: string[];     // contributes.languageModelTools[].name
  tools?: ContributedTool[];
  toolSets?: ContributedToolSet[];
}

/** Everything the qualification rules need, keyed by runtime name. */
export interface ToolOwnerIndex {
  /** runtimeName -> owning group. */
  owners: Map<string, ToolOwner>;
  /** runtimeName -> the token frontmatter expects. */
  qualifiedIds: Map<string, string>;
  /** qualified token -> owning group. */
  byQualifiedId: Map<string, ToolOwner>;
  /** extension id -> group, so a qualified token resolves even when its tool is not registered. */
  extensionOwners: Map<string, ToolOwner>;
  /** Toolset names contributed by any extension ("read", "edit", …). */
  toolSetNames: Set<string>;
}

/**
 * VS Code built-in tool group prefixes — always available, no MCP server and no
 * contributing extension. These are toolset names as they appear in frontmatter
 * (`read`, `edit`), not runtime tool names, so they must never be qualified.
 */
export const VSCODE_BUILTIN_PREFIXES = new Set([
  "read", "search", "edit", "execute", "web", "browser", "agent", "todo", "new", "changes", "vscode",
]);

function builtinOwner(toolSetName: string): ToolOwner {
  return {
    kind: "builtin",
    id: toolSetName,
    label: `Built-In: ${toolSetName}`,
    // A checked built-in parent persists the bare toolset name, never "read/*".
    wildcardId: toolSetName,
  };
}

export function emptyOwnerIndex(): ToolOwnerIndex {
  return {
    owners: new Map(),
    qualifiedIds: new Map(),
    byQualifiedId: new Map(),
    extensionOwners: new Map(),
    toolSetNames: new Set(),
  };
}

/**
 * Indexes `runtimeName -> owner` and `runtimeName -> qualified token` from the
 * contributing extensions.
 *
 * A tool whose reference name belongs to a contributed toolset is owned by that
 * **toolset**, not by the extension: `copilot_readFile` carries
 * `toolReferenceName: "readFile"` and sits in the `read` toolset, so the token
 * frontmatter expects is `read/readFile`, not `GitHub.copilot-chat/copilot_readFile`.
 *
 * When two extensions contribute the same tool name the lexicographically smallest
 * extension id wins, so the result does not depend on the order VS Code happens to
 * report extensions in.
 */
export function buildOwnerIndex(extensions: ContributingExtension[]): ToolOwnerIndex {
  const index = emptyOwnerIndex();
  const toolSetOfReference = new Map<string, string>();
  const winningExtension = new Map<string, string>();

  for (const extension of extensions) {
    for (const toolSet of extension.toolSets ?? []) {
      const name = toolSet?.name?.trim();
      if (!name) {
        continue;
      }
      index.toolSetNames.add(name);
      for (const reference of toolSet.toolReferenceNames ?? []) {
        const trimmed = reference?.trim();
        if (!trimmed) {
          continue;
        }
        const existing = toolSetOfReference.get(trimmed);
        if (existing && existing <= name) {
          continue;
        }
        toolSetOfReference.set(trimmed, name);
      }
    }
  }

  for (const extension of extensions) {
    const id = extension.id?.trim();
    if (!id) {
      continue;
    }
    const extensionOwner: ToolOwner = {
      kind: "extension",
      id,
      label: extension.displayName?.trim() || id,
      wildcardId: `${id}/*`,
    };
    index.extensionOwners.set(id, extensionOwner);

    for (const tool of contributedTools(extension)) {
      const name = tool.name?.trim();
      if (!name) {
        continue;
      }
      const previous = winningExtension.get(name);
      if (previous && previous <= id) {
        continue;
      }
      const reference = tool.referenceName?.trim() || name;
      const toolSet = toolSetOfReference.get(reference);
      const owner = toolSet ? builtinOwner(toolSet) : extensionOwner;
      const qualifiedId = toolSet ? `${toolSet}/${reference}` : `${id}/${reference}`;

      winningExtension.set(name, id);
      index.owners.set(name, owner);
      index.qualifiedIds.set(name, qualifiedId);
      index.byQualifiedId.set(qualifiedId, owner);
    }
  }

  return index;
}

function contributedTools(extension: ContributingExtension): ContributedTool[] {
  if (extension.tools?.length) {
    return extension.tools;
  }
  return (extension.toolNames ?? []).map((name) => ({ name }));
}

/** True for a frontmatter toolset name — the one namespace that is never qualified. */
export function isBuiltinToolSetName(name: string, index: ToolOwnerIndex): boolean {
  const trimmed = name.trim();
  return VSCODE_BUILTIN_PREFIXES.has(trimmed) || index.toolSetNames.has(trimmed);
}

/**
 * Idempotent. Returns the id unchanged when it is already qualified, is a wildcard,
 * or has no known owner — never invents a prefix.
 */
export function qualifyToolId(id: string, index: ToolOwnerIndex): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return id;
  }
  // 1. Already qualified, an MCP token, or a wildcard.
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0) {
    const prefix = trimmed.slice(0, slashIndex);
    // Repair `<extensionId>/<runtimeName>`: correct for most tools, wrong for the ones
    // whose frontmatter token is a reference name or a built-in toolset member.
    if (index.extensionOwners.has(prefix)) {
      const declared = index.qualifiedIds.get(trimmed.slice(slashIndex + 1));
      if (declared) {
        return declared;
      }
    }
    return trimmed;
  }
  // 2. A built-in toolset name.
  if (isBuiltinToolSetName(trimmed, index)) {
    return trimmed;
  }
  // 3. Owned by a contributing extension or one of its toolsets.
  const declared = index.qualifiedIds.get(trimmed);
  if (declared) {
    return declared;
  }
  // 4. Unknown owner — leave it alone rather than mangle it.
  return trimmed;
}

/**
 * Classifies a tool id for the picker. MCP tools registered by VS Code carry no
 * contributing extension, so a slash-namespaced id with no extension behind it is
 * treated as MCP; anything else unrecognised stays "unknown" and is surfaced as such
 * instead of being silently qualified.
 */
export function resolveToolOwner(id: string, index: ToolOwnerIndex): ToolOwner {
  const trimmed = id.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0) {
    const prefix = trimmed.slice(0, slashIndex);
    if (isBuiltinToolSetName(prefix, index)) {
      return builtinOwner(prefix);
    }
    const owned = index.byQualifiedId.get(trimmed);
    if (owned) {
      return owned;
    }
    const extensionOwner = index.extensionOwners.get(prefix);
    if (extensionOwner) {
      return extensionOwner;
    }
    return { kind: "mcp", id: prefix, label: prefix, wildcardId: `${prefix}/*` };
  }
  if (isBuiltinToolSetName(trimmed, index)) {
    return builtinOwner(trimmed);
  }
  return index.owners.get(trimmed) ?? { kind: "unknown", id: "", label: "Unknown owner" };
}

/** Migration helper: qualifies a stored list, de-duplicates, preserves order. */
export function normalizeStoredToolIds(ids: string[], index: ToolOwnerIndex): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const qualified = qualifyToolId(id, index);
    if (!qualified.trim() || seen.has(qualified)) {
      continue;
    }
    seen.add(qualified);
    result.push(qualified);
  }
  return result;
}

/** Comparison used by the write-capable warning; qualifier-insensitive. */
export function toolIdMatches(a: string, b: string): boolean {
  return bareName(a) === bareName(b);
}

/** The namespace of a qualified token: "edit" for "edit/createFile", "" for "edit". */
export function toolIdNamespace(id: string): string {
  const trimmed = id.trim();
  const slashIndex = trimmed.indexOf("/");
  return slashIndex > 0 ? trimmed.slice(0, slashIndex) : "";
}

function bareName(id: string): string {
  const trimmed = id.trim();
  const slashIndex = trimmed.lastIndexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}
