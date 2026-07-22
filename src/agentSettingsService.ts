import * as vscode from "vscode";
import {
  AGENT_SETTINGS_CONFIG_KEY,
  DEFAULT_PLACEHOLDERS,
  LEGACY_PLACEHOLDERS_CONFIG_KEY,
  resolvePlaceholders,
} from "./agentPlaceholderUtils";

export interface AgentHandoffSetting {
  label: string;
  agent: string;
  prompt?: string;
}

export interface AgentSettingEntry {
  model?: string;
  argumentHint?: string;
  bcReviewSpecialist?: string;
  disabledTools?: string[];
  handoffs?: AgentHandoffSetting[];
  placeholderTarget?: string;
}

export interface AgentProfile {
  fileId: string;
  name: string;
  description?: string;
  model?: string;
  argumentHint?: string;
  bcReviewSpecialist?: string;
  userInvocable: boolean;
  tools: string[];
  rawTools: string[];
  handoffs: AgentHandoffSetting[];
}

export interface EffectiveAgentProfile extends AgentProfile {
  settings: AgentSettingEntry;
  effectiveModel?: string;
  effectiveArgumentHint?: string;
  effectiveBcReviewSpecialist?: string;
  effectiveTools: string[];
  disabledTools: string[];
  effectiveHandoffs: AgentHandoffSetting[];
}

export interface ToolGroupViewModel {
  key: string;
  label: string;
  toolIds: string[];
  disabled: boolean;
}

export interface PlaceholderViewModel {
  key: string;
  target: string;
  source: "default" | "legacy" | "user";
}

export interface AgentSettingsViewModel {
  agents: AgentProfile[];
  allAgents: AgentProfile[];
  selected: EffectiveAgentProfile;
  selectedPlaceholder?: PlaceholderViewModel;
  availableModels: vscode.LanguageModelChat[];
  toolGroups: ToolGroupViewModel[];
  placeholders: PlaceholderViewModel[];
}

interface AgentMetadataManifest {
  bcReviewSpecialist?: string;
}

type AgentMetadataById = Record<string, AgentMetadataManifest>;

export async function getAgentSettingsViewModel(
  extensionUri: vscode.Uri,
  selectedAgentId?: string
): Promise<AgentSettingsViewModel> {
  const allAgents = await loadAgents(extensionUri, true);
  const agents = allAgents.filter((agent) => agent.userInvocable);
  const settingsMap = getSettingsMap();
  const legacyPlaceholders = getLegacyPlaceholders();
  const availableModels = await loadAvailableModels();

  const selected =
    (selectedAgentId ? agents.find((agent) => agent.fileId.toLowerCase() === selectedAgentId.toLowerCase()) : undefined) ??
    agents[0] ??
    createEmptyAgentProfile(selectedAgentId ?? "agent");

  const overrides = settingsMap[selected.fileId] ?? {};
  const effectiveTools = selected.tools;
  const effectiveHandoffs = overrides.handoffs ?? selected.handoffs;
  const effectiveProfile: EffectiveAgentProfile = {
    ...selected,
    settings: overrides,
    effectiveModel: overrides.model ?? selected.model,
    effectiveArgumentHint: overrides.argumentHint ?? selected.argumentHint,
    effectiveBcReviewSpecialist: overrides.bcReviewSpecialist ?? selected.bcReviewSpecialist,
    effectiveTools,
    disabledTools: [],
    effectiveHandoffs,
  };
  const placeholders = buildPlaceholderRows(settingsMap, legacyPlaceholders);
  const selectedPlaceholderKey = getDefaultPlaceholderKeyForAgent(selected.name);
  const selectedPlaceholder = selectedPlaceholderKey
    ? placeholders.find((row) => row.key === selectedPlaceholderKey) ?? {
        key: selectedPlaceholderKey,
        target: selected.name,
        source: "default" as const,
      }
    : undefined;

  return {
    agents,
    allAgents,
    selected: effectiveProfile,
    selectedPlaceholder,
    availableModels,
    toolGroups: buildToolGroups(selected.tools, []),
    placeholders,
  };
}

export function getSettingsMap(): Record<string, AgentSettingEntry> {
  const raw = vscode.workspace
    .getConfiguration()
    .get<Record<string, AgentSettingEntry>>(AGENT_SETTINGS_CONFIG_KEY, {}) ?? {};
  return normalizeSettingsMap(raw);
}

export function getLegacyPlaceholders(): Record<string, string> {
  return vscode.workspace
    .getConfiguration()
    .get<Record<string, string>>(LEGACY_PLACEHOLDERS_CONFIG_KEY, {}) ?? {};
}

export async function saveAgentSettingEntry(
  key: string,
  entry: AgentSettingEntry | undefined
): Promise<void> {
  const settings = getSettingsMap();
  const normalized = normalizeSettingEntry(entry);
  if (!normalized) {
    delete settings[key];
  } else {
    settings[key] = normalized;
  }

  await vscode.workspace
    .getConfiguration()
    .update(AGENT_SETTINGS_CONFIG_KEY, settings, vscode.ConfigurationTarget.Global);
}

export async function savePlaceholderTarget(key: string, target: string): Promise<void> {
  const settings = getSettingsMap();
  const current = settings[key] ?? {};
  const trimmed = target.trim();
  const legacy = getLegacyPlaceholders();
  const defaultTarget = DEFAULT_PLACEHOLDERS[key];
  const shouldPersist = trimmed.length > 0 && trimmed !== defaultTarget && trimmed !== legacy[key];

  if (!shouldPersist) {
    if (Object.keys(current).length === 0) {
      delete settings[key];
    } else {
      delete current.placeholderTarget;
      if (Object.keys(current).length === 0) {
        delete settings[key];
      } else {
        settings[key] = current;
      }
    }
  } else {
    settings[key] = {
      ...current,
      placeholderTarget: trimmed,
    };
  }

  await vscode.workspace
    .getConfiguration()
    .update(AGENT_SETTINGS_CONFIG_KEY, settings, vscode.ConfigurationTarget.Global);
}

export async function savePlaceholderRows(
  rows: Array<{ key: string; target: string }>
): Promise<void> {
  const settings = getSettingsMap();
  const nextKeys = new Set<string>();
  const legacy = getLegacyPlaceholders();

  for (const row of rows) {
    const key = row.key.trim();
    const target = row.target.trim();
    if (!key) {
      continue;
    }
    nextKeys.add(key);
    const current = settings[key] ?? {};
    const shouldPersist = target.length > 0 && target !== DEFAULT_PLACEHOLDERS[key] && target !== legacy[key];
    if (!shouldPersist) {
      if (Object.keys(current).length === 0) {
        delete settings[key];
      } else {
        delete current.placeholderTarget;
        if (Object.keys(current).length === 0) {
          delete settings[key];
        } else {
          settings[key] = current;
        }
      }
      continue;
    }
    settings[key] = {
      ...current,
      placeholderTarget: target,
    };
  }

  for (const [key, value] of Object.entries(settings)) {
    if (!value.placeholderTarget) {
      continue;
    }
    if (!nextKeys.has(key) && (key in DEFAULT_PLACEHOLDERS || key in legacy || value.placeholderTarget)) {
      delete value.placeholderTarget;
      if (Object.keys(value).length === 0) {
        delete settings[key];
      }
    }
  }

  await vscode.workspace
    .getConfiguration()
    .update(AGENT_SETTINGS_CONFIG_KEY, settings, vscode.ConfigurationTarget.Global);
}

export async function resetAgentSettingEntry(key: string): Promise<void> {
  const settings = getSettingsMap();
  delete settings[key];
  await vscode.workspace
    .getConfiguration()
    .update(AGENT_SETTINGS_CONFIG_KEY, settings, vscode.ConfigurationTarget.Global);
}

export function mergePlaceholderMap(): Record<string, string> {
  const settingsMap = getSettingsMap();
  const legacy = getLegacyPlaceholders();
  const merged: Record<string, string> = { ...DEFAULT_PLACEHOLDERS, ...legacy };

  for (const [key, value] of Object.entries(settingsMap)) {
    if (value.placeholderTarget) {
      merged[key] = value.placeholderTarget;
    }
  }

  return merged;
}

export function resolvePlaceholderText(text: string): string {
  return resolvePlaceholders(text, mergePlaceholderMap());
}

async function loadAvailableModels(): Promise<vscode.LanguageModelChat[]> {
  try {
    return await vscode.lm.selectChatModels({ vendor: "copilot" });
  } catch {
    return [];
  }
}

async function loadAgents(extensionUri: vscode.Uri, includeHidden = false): Promise<AgentProfile[]> {
  const root = vscode.Uri.joinPath(extensionUri, "assets", "generated");
  const files = await findAgentFiles(root);
  const metadata = await loadAgentMetadata(extensionUri);
  const settingsMap = getSettingsMap();

  const parsed: AgentProfile[] = [];
  for (const file of files) {
    const text = await readText(file);
    const fm = extractFrontmatter(text);
    if (!fm) {
      continue;
    }

    const fileName = file.path.split("/").at(-1) ?? "";
    const fileId = fileName.replace(/\.agent\.md$/i, "");
    const name = resolvePlaceholderText(readScalar(fm, "name") ?? fileId);
    const userInvocable = (readScalar(fm, "user-invocable") ?? "true")
      .toLowerCase()
      .trim() !== "false";
    const handoffs = readHandoffs(fm).map((handoff) => ({
      ...handoff,
      agent: resolvePlaceholderText(handoff.agent),
      label: resolvePlaceholderText(handoff.label),
      prompt: resolvePlaceholderText(handoff.prompt ?? ""),
    }));
    const { normalized: tools, raw: rawTools } = readTools(fm);
    const ext = metadata[fileId] ?? {};
    const settings = settingsMap[fileId] ?? {};

    parsed.push({
      fileId,
      name,
      description: readScalar(fm, "description") ?? undefined,
      model: settings.model ?? readScalar(fm, "model") ?? undefined,
      argumentHint: settings.argumentHint ?? readScalar(fm, "argument-hint") ?? undefined,
      bcReviewSpecialist: settings.bcReviewSpecialist ?? ext.bcReviewSpecialist,
      userInvocable,
      tools,
      rawTools,
      handoffs: settings.handoffs ?? handoffs,
    });
  }

  return includeHidden ? parsed : parsed.filter((agent) => agent.userInvocable);
}

async function loadAgentMetadata(extensionUri: vscode.Uri): Promise<AgentMetadataById> {
  const manifestUri = vscode.Uri.joinPath(extensionUri, "assets", "agent-metadata.json");
  try {
    const data = await vscode.workspace.fs.readFile(manifestUri);
    return JSON.parse(Buffer.from(data).toString("utf8")) as AgentMetadataById;
  } catch {
    return {};
  }
}

async function findAgentFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
  const results: vscode.Uri[] = [];

  const walk = async (dir: vscode.Uri): Promise<void> => {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return;
    }

    for (const [name, type] of entries) {
      const child = vscode.Uri.joinPath(dir, name);
      if (type === vscode.FileType.Directory) {
        await walk(child);
      } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".agent.md")) {
        results.push(child);
      }
    }
  };

  await walk(root);
  return results;
}

async function readText(uri: vscode.Uri): Promise<string> {
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString("utf8");
}

function extractFrontmatter(content: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match?.[1];
}

function readScalar(frontmatter: string, key: string): string | undefined {
  const regex = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, "m");
  const match = regex.exec(frontmatter);
  if (!match) {
    return undefined;
  }
  return unquote(match[1].trim());
}

function readHandoffs(frontmatter: string): AgentHandoffSetting[] {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^handoffs:\s*$/.test(line));
  if (start < 0) {
    return [];
  }

  const handoffs: AgentHandoffSetting[] = [];
  let current: AgentHandoffSetting | undefined;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }

    const labelMatch = /^\s*-\s*label:\s*(.*)$/.exec(line);
    if (labelMatch) {
      if (current && current.label && current.agent) {
        handoffs.push(current);
      }
      current = {
        label: unquote(labelMatch[1].trim()),
        agent: "",
        prompt: "",
      };
      continue;
    }

    const agentMatch = /^\s+agent:\s*(.*)$/.exec(line);
    if (agentMatch) {
      if (!current) {
        current = { label: "Handoff", agent: "", prompt: "" };
      }
      current.agent = unquote(agentMatch[1].trim());
      continue;
    }

    const promptMatch = /^\s+prompt:\s*(.*)$/.exec(line);
    if (promptMatch) {
      if (!current) {
        current = { label: "Handoff", agent: "", prompt: "" };
      }
      current.prompt = unquote(promptMatch[1].trim());
    }
  }

  if (current && current.label && current.agent) {
    handoffs.push(current);
  }

  return handoffs;
}

function readTools(frontmatter: string): { normalized: string[]; raw: string[] } {
  const toolsScalar = readScalar(frontmatter, "tools");
  if (!toolsScalar) {
    return { normalized: [], raw: [] };
  }

  const arrayMatch = /^\[(.+)\]$/.exec(toolsScalar.trim());
  if (!arrayMatch) {
    return { normalized: [], raw: [] };
  }

  const content = arrayMatch[1];
  const tools = content.split(",").map((t) => t.trim().replace(/^['"]|['"]$/g, ""));

  const normalized = tools
    .filter((t) => (t.includes("/") || t.includes("-mcp")) && !t.startsWith("vscode/"))
    .map((t) => t.replace(/\/\*$/, "").replace(/\/.*$/, ""))
    .filter((value, index, all) => all.indexOf(value) === index);

  const raw = tools
    .map((t) => t.replace(/\/\*$/, "").trim())
    .filter((t) => t.length > 0)
    .filter((value, index, all) => all.indexOf(value) === index);

  return { normalized, raw };
}

function buildToolGroups(toolIds: string[], disabledTools: string[]): ToolGroupViewModel[] {
  const groups = new Map<string, string[]>();

  for (const toolId of toolIds) {
    const groupKey = normalizeToolGroupKey(toolId);
    const current = groups.get(groupKey) ?? [];
    current.push(toolId);
    groups.set(groupKey, current);
  }

  return [...groups.entries()]
    .map(([key, groupToolIds]) => ({
      key,
      label: formatGroupLabel(key),
      toolIds: groupToolIds.sort((a, b) => a.localeCompare(b)),
      disabled: groupToolIds.every((toolId) => disabledTools.includes(toolId)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildPlaceholderRows(
  settingsMap: Record<string, AgentSettingEntry>,
  legacyPlaceholders: Record<string, string>
): PlaceholderViewModel[] {
  const rows: PlaceholderViewModel[] = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(DEFAULT_PLACEHOLDERS)) {
    rows.push({ key, target: value, source: "default" });
    seen.add(key);
  }

  for (const [key, value] of Object.entries(legacyPlaceholders)) {
    if (seen.has(key)) {
      const index = rows.findIndex((row) => row.key === key);
      if (index >= 0) {
        rows[index] = { key, target: value, source: "legacy" };
      }
      continue;
    }
    rows.push({ key, target: value, source: "legacy" });
    seen.add(key);
  }

  for (const [key, value] of Object.entries(settingsMap)) {
    if (!value.placeholderTarget) {
      continue;
    }
    const existing = rows.find((row) => row.key === key);
    if (existing) {
      existing.target = value.placeholderTarget;
      existing.source = "user";
    } else {
      rows.push({ key, target: value.placeholderTarget, source: "user" });
    }
  }

  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

function getDefaultPlaceholderKeyForAgent(agentName: string): string | undefined {
  const agentNameLc = agentName.toLowerCase();
  return Object.entries(DEFAULT_PLACEHOLDERS).find(([, target]) => target.toLowerCase() === agentNameLc)?.[0];
}

function normalizeSettingsMap(raw: Record<string, AgentSettingEntry>): Record<string, AgentSettingEntry> {
  const result: Record<string, AgentSettingEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeSettingEntry(value);
    if (normalized) {
      result[key] = normalized;
    }
  }
  return result;
}

function normalizeSettingEntry(entry: AgentSettingEntry | undefined): AgentSettingEntry | undefined {
  if (!entry) {
    return undefined;
  }

  const normalized: AgentSettingEntry = {};
  if (entry.model?.trim()) {
    normalized.model = entry.model.trim();
  }
  if (entry.argumentHint?.trim()) {
    normalized.argumentHint = entry.argumentHint.trim();
  }
  if (entry.bcReviewSpecialist?.trim()) {
    normalized.bcReviewSpecialist = entry.bcReviewSpecialist.trim();
  }
  if (entry.placeholderTarget?.trim()) {
    normalized.placeholderTarget = entry.placeholderTarget.trim();
  }
  const disabledTools = (entry.disabledTools ?? [])
    .map((toolId) => toolId.trim())
    .filter((toolId) => toolId.length > 0)
    .filter((toolId, index, all) => all.indexOf(toolId) === index);
  if (disabledTools.length > 0) {
    normalized.disabledTools = disabledTools;
  }
  const handoffs = (entry.handoffs ?? [])
    .map((handoff) => ({
      label: handoff.label.trim(),
      agent: handoff.agent.trim(),
      prompt: handoff.prompt?.trim() ?? "",
    }))
    .filter((handoff) => handoff.label.length > 0 || handoff.agent.length > 0 || handoff.prompt.length > 0)
    .filter((handoff) => handoff.label.length > 0 && handoff.agent.length > 0);
  if (handoffs.length > 0) {
    normalized.handoffs = handoffs;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeToolGroupKey(toolId: string): string {
  const trimmed = toolId.trim();
  const slashIndex = trimmed.indexOf("/");
  const dotIndex = trimmed.indexOf(".");
  if (slashIndex >= 0 && (dotIndex < 0 || slashIndex < dotIndex)) {
    return trimmed.slice(0, slashIndex).toLowerCase();
  }
  if (dotIndex >= 0) {
    return trimmed.slice(0, dotIndex).toLowerCase();
  }
  return trimmed.toLowerCase();
}

function formatGroupLabel(key: string): string {
  const mapping: Record<string, string> = {
    vscode: "VS Code",
    github: "GitHub",
    microsoft: "Microsoft",
    upstash: "Upstash",
    "al-symbols-mcp": "AL Symbols MCP",
    "sshadowsdk": "AL LSP",
    "ms-dynamics-smb": "Microsoft Dynamics SMB",
  };
  if (mapping[key]) {
    return mapping[key];
  }
  return key
    .split(/[-_.]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createEmptyAgentProfile(fileId: string): AgentProfile {
  return {
    fileId,
    name: fileId,
    userInvocable: true,
    tools: [],
    rawTools: [],
    handoffs: [],
  };
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
