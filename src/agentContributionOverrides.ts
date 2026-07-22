import * as vscode from "vscode";
import { getSettingsMap, type AgentSettingEntry } from "./agentSettingsService";

interface ContributionEntry {
  path?: string;
}

interface PackageContributes {
  chatAgents?: ContributionEntry[];
}

interface PackageJsonManifest {
  contributes?: PackageContributes;
}

export interface ApplyAgentContributionOverridesResult {
  generatedFiles: number;
  changedContributionFiles: number;
  restoredContributionFiles: number;
  skippedContributionFiles: number;
}

export async function applyAgentContributionOverrides(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<ApplyAgentContributionOverridesResult> {
  const settings = getSettingsMap();
  const contributionPaths = await loadContributedAgentPaths(context.extensionUri);
  const availableModels = await loadAvailableModels();

  const backupRoot = vscode.Uri.joinPath(context.globalStorageUri, "agent-overrides", "originals");
  const generatedRoot = vscode.Uri.joinPath(context.globalStorageUri, "agent-overrides", "generated");
  await vscode.workspace.fs.createDirectory(backupRoot);
  await vscode.workspace.fs.createDirectory(generatedRoot);

  let generatedFiles = 0;
  let changedContributionFiles = 0;
  let restoredContributionFiles = 0;
  let skippedContributionFiles = 0;

  for (const relPath of contributionPaths) {
    const normalizedRelPath = normalizeRelativePath(relPath);
    const contributionUri = vscode.Uri.joinPath(context.extensionUri, normalizedRelPath);
    const backupUri = vscode.Uri.joinPath(backupRoot, normalizedRelPath);
    const generatedUri = vscode.Uri.joinPath(generatedRoot, normalizedRelPath);

    const contributionContent = await tryReadText(contributionUri);
    if (contributionContent === undefined) {
      skippedContributionFiles += 1;
      output?.appendLine(`[agent-overrides] Skipping unreadable contribution file: ${normalizedRelPath}`);
      continue;
    }

    const fileId = extractFileIdFromPath(normalizedRelPath);
    const setting = settings[fileId];
    const hasOverride = hasRuntimeOverride(setting);

    const originalContent = await ensureOriginalBackup(backupUri, contributionContent);

    if (!hasOverride) {
      if (contributionContent !== originalContent) {
        await writeText(contributionUri, originalContent);
        restoredContributionFiles += 1;
      }
      await tryDelete(generatedUri);
      continue;
    }

    const overriddenContent = applySettingToAgentDefinition(
      originalContent,
      setting!,
      availableModels
    );
    await writeText(generatedUri, overriddenContent);
    generatedFiles += 1;

    if (contributionContent !== overriddenContent) {
      await writeText(contributionUri, overriddenContent);
      changedContributionFiles += 1;
    }
  }

  return {
    generatedFiles,
    changedContributionFiles,
    restoredContributionFiles,
    skippedContributionFiles,
  };
}

function hasRuntimeOverride(setting: AgentSettingEntry | undefined): boolean {
  if (!setting) {
    return false;
  }
  return Boolean(
    setting.model?.trim() ||
      setting.argumentHint?.trim() ||
      (setting.handoffs && setting.handoffs.length > 0)
  );
}

async function loadContributedAgentPaths(extensionUri: vscode.Uri): Promise<string[]> {
  const packageUri = vscode.Uri.joinPath(extensionUri, "package.json");
  const content = await readText(packageUri);
  const manifest = JSON.parse(content) as PackageJsonManifest;
  const entries = manifest.contributes?.chatAgents ?? [];
  const paths = entries
    .map((entry) => entry.path?.trim())
    .filter((value): value is string => Boolean(value));

  return [...new Set(paths)];
}

async function ensureOriginalBackup(backupUri: vscode.Uri, currentContent: string): Promise<string> {
  const backupContent = await tryReadText(backupUri);
  if (backupContent !== undefined) {
    return backupContent;
  }

  await writeText(backupUri, currentContent);
  return currentContent;
}

function applySettingToAgentDefinition(
  content: string,
  setting: AgentSettingEntry,
  availableModels: vscode.LanguageModelChat[]
): string {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!frontmatterMatch) {
    return content;
  }

  const frontmatter = frontmatterMatch[1];
  const originalHandoffPrompts = readHandoffPrompts(frontmatter);
  const modelFrontmatterValue = resolveModelForFrontmatter(
    setting.model?.trim(),
    availableModels
  );
  let updated = upsertScalar(frontmatter, "model", modelFrontmatterValue);
  updated = upsertScalar(updated, "argument-hint", setting.argumentHint?.trim());
  updated = upsertHandoffs(updated, setting.handoffs ?? [], originalHandoffPrompts);

  const replacement = `---\n${updated}\n---`;
  return content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, replacement);
}

function upsertScalar(frontmatter: string, key: string, value: string | undefined): string {
  const lines = frontmatter.split(/\r?\n/);
  const keyPattern = new RegExp(`^${escapeRegExp(key)}:\\s*`);
  const index = lines.findIndex((line) => keyPattern.test(line));

  if (!value) {
    if (index >= 0) {
      lines.splice(index, 1);
    }
    return lines.join("\n");
  }

  const newLine = `${key}: ${toYamlString(value)}`;
  if (index >= 0) {
    lines[index] = newLine;
  } else {
    lines.push(newLine);
  }

  return lines.join("\n");
}

function upsertHandoffs(
  frontmatter: string,
  handoffs: Array<{ label: string; agent: string; prompt?: string }>,
  originalPrompts: Map<string, string>
): string {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^handoffs:\s*$/.test(line));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && /^\s+/.test(lines[end])) {
      end += 1;
    }
    lines.splice(start, end - start);
  }

  const normalized = handoffs
    .map((handoff) => ({
      label: handoff.label.trim(),
      agent: handoff.agent.trim(),
      prompt: (handoff.prompt ?? "").trim(),
    }))
    .filter((handoff) => handoff.label.length > 0 && handoff.agent.length > 0);

  if (normalized.length === 0) {
    return lines.join("\n");
  }

  lines.push("handoffs:");
  for (const handoff of normalized) {
    // The chat agent frontmatter schema requires a prompt on every handoff.
    // Prefer an explicit prompt, then the original file's prompt for the same
    // label/agent, and finally fall back to the label so the entry stays valid.
    const prompt =
      handoff.prompt ||
      originalPrompts.get(handoffKey(handoff.label)) ||
      originalPrompts.get(handoffKey(handoff.agent)) ||
      handoff.label;
    lines.push(`  - label: ${toYamlString(handoff.label)}`);
    lines.push(`    agent: ${toYamlString(handoff.agent)}`);
    lines.push(`    prompt: ${toYamlString(prompt)}`);
  }

  return lines.join("\n");
}

/**
 * Parses the original frontmatter's handoffs into a lookup keyed by both the
 * normalized label and the normalized target agent, so a rewritten handoff can
 * recover its original prompt even if only one of the two still matches.
 */
function readHandoffPrompts(frontmatter: string): Map<string, string> {
  const prompts = new Map<string, string>();
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^handoffs:\s*$/.test(line));
  if (start < 0) {
    return prompts;
  }

  let currentLabel: string | undefined;
  let currentAgent: string | undefined;
  let currentPrompt: string | undefined;

  const flush = (): void => {
    if (!currentPrompt) {
      currentLabel = undefined;
      currentAgent = undefined;
      currentPrompt = undefined;
      return;
    }
    if (currentLabel) {
      prompts.set(handoffKey(currentLabel), currentPrompt);
    }
    if (currentAgent) {
      prompts.set(handoffKey(currentAgent), currentPrompt);
    }
    currentLabel = undefined;
    currentAgent = undefined;
    currentPrompt = undefined;
  };

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s+/.test(line)) {
      break;
    }

    const labelMatch = /^\s*-\s*label:\s*(.*)$/.exec(line);
    if (labelMatch) {
      flush();
      currentLabel = stripYamlQuotes(labelMatch[1].trim());
      continue;
    }

    const agentMatch = /^\s+agent:\s*(.*)$/.exec(line);
    if (agentMatch) {
      currentAgent = stripYamlQuotes(agentMatch[1].trim());
      continue;
    }

    const promptMatch = /^\s+prompt:\s*(.*)$/.exec(line);
    if (promptMatch) {
      currentPrompt = stripYamlQuotes(promptMatch[1].trim());
    }
  }

  flush();
  return prompts;
}

function handoffKey(value: string): string {
  return value.trim().toLowerCase();
}

function stripYamlQuotes(value: string): string {
  const doubleQuoted = /^"(.*)"$/.exec(value);
  if (doubleQuoted) {
    return doubleQuoted[1];
  }
  const singleQuoted = /^'(.*)'$/.exec(value);
  if (singleQuoted) {
    return singleQuoted[1].replace(/''/g, "'");
  }
  return value;
}

function toYamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function extractFileIdFromPath(pathValue: string): string {
  const fileName = normalizeRelativePath(pathValue).split("/").at(-1) ?? "";
  return fileName.replace(/\.agent\.md$/i, "");
}

function normalizeRelativePath(value: string): string {
  return value.replace(/^\.\//, "").replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function tryReadText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return await readText(uri);
  } catch {
    return undefined;
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString("utf8");
}

async function writeText(uri: vscode.Uri, content: string): Promise<void> {
  const parentPath = uri.path.split("/").slice(0, -1).join("/") || "/";
  await vscode.workspace.fs.createDirectory(uri.with({ path: parentPath }));
  const encoded = Buffer.from(content, "utf8");
  await vscode.workspace.fs.writeFile(uri, encoded);
}

async function tryDelete(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch {
    // Ignore when the generated file does not exist.
  }
}

function resolveModelForFrontmatter(
  configuredModel: string | undefined,
  availableModels: vscode.LanguageModelChat[]
): string | undefined {
  if (!configuredModel) {
    return undefined;
  }

  const candidate = configuredModel.trim();
  if (!candidate) {
    return undefined;
  }

  const byId = availableModels.find((model) => model.id === candidate);
  if (byId) {
    return byId.name;
  }

  const byName = availableModels.find((model) => model.name === candidate);
  if (byName) {
    return byName.name;
  }

  const normalizedCandidate = normalizeModelToken(candidate);
  const byNormalizedName = availableModels.find(
    (model) => normalizeModelToken(model.name) === normalizedCandidate
  );
  if (byNormalizedName) {
    return byNormalizedName.name;
  }

  return candidate;
}

function normalizeModelToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\(copilot\)\s*/g, " ")
    .replace(/\s*\(\s*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadAvailableModels(): Promise<vscode.LanguageModelChat[]> {
  try {
    return await vscode.lm.selectChatModels({ vendor: "copilot" });
  } catch {
    return [];
  }
}