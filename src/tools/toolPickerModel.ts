/**
 * Picker model: groups the registered tools under their owner, tracks the tri-state
 * selection of a simulated tree, and projects the result back onto the `disabledTools` /
 * `extraTools` deltas the settings already persist.
 *
 * Deliberately vscode-free (see AGENTS.md); `agentSettingsView` is a thin adapter over it.
 */

import {
  toolIdMatches,
  toolIdNamespace,
  type ToolCatalogEntry,
  type ToolOwner,
} from "./toolIdentity";

export type NodeState = "checked" | "unchecked" | "partial";

/** Group keys for the two anonymous buckets, which have no owner id of their own. */
export const UNKNOWN_MCP_GROUP_KEY = "mcp:unknown";
export const UNKNOWN_GROUP_KEY = "unknown";

export interface ToolPickerGroup {
  /** Stable key for the reducers; the owner id, or a bucket key when there is none. */
  key: string;
  owner: ToolOwner;
  children: ToolCatalogEntry[];
  state: NodeState;
  expanded: boolean;
  /** True when the agent declares the group wildcard (e.g. "al-symbols-mcp/*"). */
  wildcardSelected: boolean;
  /** Qualified ids of the checked children; all of them while `wildcardSelected`. */
  checked: string[];
}

export interface ToolPickerState {
  groups: ToolPickerGroup[];
  /** Stored ids whose owner is not currently registered — shown, never dropped silently. */
  orphans: string[];
  /** The deltas the picker opened with, so an untouched round-trip stays byte-identical. */
  baseline: { disabledTools: string[]; extraTools: string[] };
}

export interface BuildPickerOptions {
  /**
   * Known MCP server ids, from `getAvailableMcpServerIds` at the call site (D11). The
   * flattened prefix is derived *forward* from each id; a server id is never parsed back
   * out of a tool name, because that mapping is not invertible.
   */
  mcpServerIds?: Iterable<string>;
}

interface McpServerPrefix {
  id: string;
  prefix: string;
}

export function buildPickerState(
  catalog: ToolCatalogEntry[],
  declaredTools: string[],
  disabledTools: string[],
  extraTools: string[],
  options: BuildPickerOptions = {}
): ToolPickerState {
  const groups = groupCatalog(catalog, mcpServerPrefixes(options.mcpServerIds));
  const declared = unique(declaredTools);
  const declaredSet = new Set(declared);
  const selected = effectiveSelection(declared, disabledTools, extraTools);

  const byQualifiedId = new Map<string, ToolPickerGroup>();
  const byWildcard = new Map<string, ToolPickerGroup>();
  for (const group of groups) {
    if (group.owner.wildcardId) {
      byWildcard.set(group.owner.wildcardId, group);
    }
    for (const child of group.children) {
      byQualifiedId.set(child.qualifiedId, group);
    }
  }

  const orphans: string[] = [];
  for (const token of selected) {
    const wildcardGroup = byWildcard.get(token);
    if (wildcardGroup) {
      wildcardGroup.wildcardSelected = true;
      continue;
    }
    const group = byQualifiedId.get(token);
    if (group) {
      if (!group.checked.includes(token)) {
        group.checked.push(token);
      }
      continue;
    }
    orphans.push(token);
  }

  for (const group of groups) {
    if (group.wildcardSelected) {
      group.checked = group.children.map((child) => child.qualifiedId);
    } else {
      group.checked = orderChecked(group);
    }
    group.state = deriveState(group);
    group.expanded =
      group.state === "partial" ||
      group.children.some((child) => declaredSet.has(child.qualifiedId));
  }

  return {
    groups,
    orphans,
    baseline: { disabledTools: [...disabledTools], extraTools: [...extraTools] },
  };
}

export function toggleGroup(
  state: ToolPickerState,
  ownerId: string,
  checked: boolean
): ToolPickerState {
  return mapGroup(state, ownerId, (group) => {
    const wildcardSelected = checked && Boolean(group.owner.wildcardId);
    const nextChecked = checked ? group.children.map((child) => child.qualifiedId) : [];
    return withState({ ...group, wildcardSelected, checked: nextChecked });
  });
}

export function toggleTool(
  state: ToolPickerState,
  qualifiedId: string,
  checked: boolean
): ToolPickerState {
  const owning = state.groups.find((group) =>
    group.children.some((child) => child.qualifiedId === qualifiedId)
  );

  if (!owning) {
    // An orphan row: it can only be dropped, never re-added from the picker.
    if (checked || !state.orphans.includes(qualifiedId)) {
      return state;
    }
    return { ...state, orphans: state.orphans.filter((id) => id !== qualifiedId) };
  }

  return mapGroup(state, owning.key, (group) => {
    // Unchecking one child of a wildcard-checked group expands the wildcard into the
    // children that survive, and drops the wildcard itself.
    const base = group.wildcardSelected
      ? group.children.map((child) => child.qualifiedId)
      : group.checked;
    const nextChecked = checked
      ? base.includes(qualifiedId)
        ? base
        : [...base, qualifiedId]
      : base.filter((id) => id !== qualifiedId);
    return withState({
      ...group,
      wildcardSelected: group.wildcardSelected && checked,
      checked: orderChecked({ ...group, checked: nextChecked }),
    });
  });
}

export function toggleExpanded(state: ToolPickerState, ownerId: string): ToolPickerState {
  return mapGroup(state, ownerId, (group) => ({ ...group, expanded: !group.expanded }));
}

/** Projects the state back onto the delta model the settings already persist. */
export function toDeltas(
  state: ToolPickerState,
  declaredTools: string[]
): { disabledTools: string[]; extraTools: string[] } {
  const selected = selectedTokens(state);
  const selectedSet = new Set(selected);
  const declared = unique(declaredTools);
  const declaredSet = new Set(declared);

  // A wildcard covers its members, so a declared child under a checked wildcard must not
  // be reported as disabled just because it is no longer enumerated.
  const covered = new Set(selected);
  for (const group of state.groups) {
    if (group.wildcardSelected) {
      for (const child of group.children) {
        covered.add(child.qualifiedId);
      }
    }
  }

  const disabledTools: string[] = [];
  for (const token of state.baseline.disabledTools) {
    if (declaredSet.has(token) && !covered.has(token)) {
      pushUnique(disabledTools, token);
    }
  }
  for (const token of declared) {
    if (!covered.has(token)) {
      pushUnique(disabledTools, token);
    }
  }

  const extraTools: string[] = [];
  for (const token of state.baseline.extraTools) {
    if (!declaredSet.has(token) && selectedSet.has(token)) {
      pushUnique(extraTools, token);
    }
  }
  for (const token of selected) {
    if (!declaredSet.has(token)) {
      pushUnique(extraTools, token);
    }
  }

  return { disabledTools, extraTools };
}

/** The tokens the agent ends up with: one wildcard per checked group, else the children. */
export function selectedTokens(state: ToolPickerState): string[] {
  const tokens: string[] = [];
  for (const group of state.groups) {
    if (group.wildcardSelected && group.owner.wildcardId) {
      pushUnique(tokens, group.owner.wildcardId);
      continue;
    }
    for (const token of group.checked) {
      pushUnique(tokens, token);
    }
  }
  for (const token of state.orphans) {
    pushUnique(tokens, token);
  }
  return tokens;
}

/**
 * Resolves group wildcards against the registered tools, so a grant made by wildcard can
 * be inspected member by member (D8: the write-capable warning must see through it).
 */
export function expandToolTokens(
  tokens: string[],
  catalog: ToolCatalogEntry[],
  options: BuildPickerOptions = {}
): string[] {
  const groups = groupCatalog(catalog, mcpServerPrefixes(options.mcpServerIds));
  const byWildcard = new Map<string, ToolPickerGroup>();
  for (const group of groups) {
    if (group.owner.wildcardId) {
      byWildcard.set(group.owner.wildcardId, group);
    }
  }

  const expanded: string[] = [];
  for (const token of tokens) {
    const group = byWildcard.get(token.trim());
    if (!group || group.children.length === 0) {
      pushUnique(expanded, token.trim());
      continue;
    }
    for (const child of group.children) {
      pushUnique(expanded, child.qualifiedId);
    }
  }
  return expanded;
}

/** The write-capable tools a token list grants, wildcards included. */
export function collectWriteCapableTools(
  tokens: string[],
  catalog: ToolCatalogEntry[],
  writeCapableIds: readonly string[],
  options: BuildPickerOptions = {}
): string[] {
  const granted: string[] = [];
  for (const token of expandToolTokens(tokens, catalog, options)) {
    if (isWriteCapable(token, writeCapableIds)) {
      pushUnique(granted, token);
    }
  }
  for (const token of tokens) {
    if (isWriteCapable(token.trim(), writeCapableIds)) {
      pushUnique(granted, token.trim());
    }
  }
  return granted;
}

function isWriteCapable(token: string, writeCapableIds: readonly string[]): boolean {
  if (writeCapableIds.some((writeId) => toolIdMatches(writeId, token))) {
    return true;
  }
  const namespace = toolIdNamespace(token);
  return namespace.length > 0 && writeCapableIds.includes(namespace);
}

function groupCatalog(
  catalog: ToolCatalogEntry[],
  servers: McpServerPrefix[]
): ToolPickerGroup[] {
  const groups = new Map<string, ToolPickerGroup>();

  for (const entry of catalog) {
    const owner = groupOwner(entry, servers);
    const key = groupKey(owner);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        owner,
        children: [],
        state: "unchecked",
        expanded: false,
        wildcardSelected: false,
        checked: [],
      };
      groups.set(key, group);
    }
    if (!group.children.some((child) => child.qualifiedId === entry.qualifiedId)) {
      group.children.push({ ...entry, owner });
    }
  }

  const ordered = [...groups.values()];
  for (const group of ordered) {
    group.children.sort((a, b) => a.qualifiedId.localeCompare(b.qualifiedId));
  }
  ordered.sort((a, b) => {
    const rank = ownerRank(a.owner) - ownerRank(b.owner);
    return rank !== 0 ? rank : a.owner.label.localeCompare(b.owner.label);
  });
  return ordered;
}

function groupOwner(entry: ToolCatalogEntry, servers: McpServerPrefix[]): ToolOwner {
  if (entry.owner.kind === "extension" || entry.owner.kind === "builtin") {
    return entry.owner;
  }
  if (entry.owner.kind === "mcp" && entry.owner.id) {
    return entry.owner;
  }

  const runtimeName = entry.runtimeName.toLowerCase();
  for (const server of servers) {
    if (runtimeName.startsWith(server.prefix)) {
      return {
        kind: "mcp",
        id: server.id,
        label: server.id,
        wildcardId: `${server.id}/*`,
      };
    }
  }
  if (runtimeName.startsWith("mcp_")) {
    // No wildcard: the server id is not recoverable from the tool name (S2/D11), so these
    // are individually selectable only.
    return { kind: "mcp", id: "", label: "MCP tools (unknown server)" };
  }
  return entry.owner;
}

function groupKey(owner: ToolOwner): string {
  if (owner.id) {
    return owner.id;
  }
  return owner.kind === "mcp" ? UNKNOWN_MCP_GROUP_KEY : UNKNOWN_GROUP_KEY;
}

function ownerRank(owner: ToolOwner): number {
  const base = { extension: 0, mcp: 2, builtin: 4, unknown: 6 }[owner.kind];
  return owner.id ? base : base + 1;
}

/**
 * `mcp.json` id -> the underscore-flattened prefix VS Code gives its tools:
 * "github-mcp-se" -> "mcp_github_mcp_se_".
 */
function mcpServerPrefixes(ids?: Iterable<string>): McpServerPrefix[] {
  const prefixes: McpServerPrefix[] = [];
  const seen = new Set<string>();
  for (const raw of ids ?? []) {
    const id = raw?.trim();
    // "mcp" is not a server: it is what a naive underscore split reports for every
    // flattened MCP tool name, and its prefix would swallow the whole bucket.
    if (!id || id.toLowerCase() === "mcp" || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const flattened = id.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
    if (!flattened || flattened === "_") {
      continue;
    }
    prefixes.push({ id, prefix: `mcp_${flattened}_` });
  }
  // Longest first, so a server id that prefixes another still resolves to the right group.
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  return prefixes;
}

function effectiveSelection(
  declared: string[],
  disabledTools: string[],
  extraTools: string[]
): string[] {
  const disabled = new Set(disabledTools.map((id) => id.trim()).filter(Boolean));
  const selected: string[] = [];
  for (const token of [...declared, ...extraTools]) {
    const trimmed = token.trim();
    if (!trimmed || disabled.has(trimmed)) {
      continue;
    }
    pushUnique(selected, trimmed);
  }
  return selected;
}

function deriveState(group: ToolPickerGroup): NodeState {
  if (group.wildcardSelected) {
    return "checked";
  }
  if (group.checked.length === 0) {
    return "unchecked";
  }
  return group.checked.length === group.children.length ? "checked" : "partial";
}

function withState(group: ToolPickerGroup): ToolPickerGroup {
  return { ...group, state: deriveState(group) };
}

function orderChecked(group: ToolPickerGroup): string[] {
  const checked = new Set(group.checked);
  return group.children
    .map((child) => child.qualifiedId)
    .filter((qualifiedId) => checked.has(qualifiedId));
}

function mapGroup(
  state: ToolPickerState,
  key: string,
  update: (group: ToolPickerGroup) => ToolPickerGroup
): ToolPickerState {
  let changed = false;
  const groups = state.groups.map((group) => {
    if (group.key !== key) {
      return group;
    }
    changed = true;
    return update(group);
  });
  return changed ? { ...state, groups } : state;
}

function unique(ids: string[]): string[] {
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id?.trim();
    if (trimmed) {
      pushUnique(result, trimmed);
    }
  }
  return result;
}

function pushUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}
