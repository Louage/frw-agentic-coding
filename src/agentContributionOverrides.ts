import { createHash } from "crypto";
import * as vscode from "vscode";
import { getSettingsMap, resolveEffectiveTools, type AgentSettingEntry } from "./agentSettingsService";

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
  rebaselinedFiles: number;
}

/**
 * Per-file sidecar recording every content we have written into the installed
 * contribution file. It is the only proof that the file on disk is still "ours";
 * without it a backup taken once would be trusted forever, and an extension
 * update would be silently reverted to a stale snapshot.
 */
interface AgentOverrideState {
  /** sha256 of the pristine content stored in originals/<relPath>. Absent on pre-existing installs. */
  baselineSha?: string;
  /** sha256 of every content we wrote, most recent first, capped at MAX_WRITTEN_SHAS. */
  writtenShas: string[];
}

const MAX_WRITTEN_SHAS = 5;

export async function applyAgentContributionOverrides(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<ApplyAgentContributionOverridesResult> {
  const settings = getSettingsMap();
  const contributionPaths = await loadContributedAgentPaths(context.extensionUri);
  const availableModels = await loadAvailableModels();

  const backupRoot = vscode.Uri.joinPath(context.globalStorageUri, "agent-overrides", "originals");
  const generatedRoot = vscode.Uri.joinPath(context.globalStorageUri, "agent-overrides", "generated");
  const stateRoot = vscode.Uri.joinPath(context.globalStorageUri, "agent-overrides", "state");
  await vscode.workspace.fs.createDirectory(backupRoot);
  await vscode.workspace.fs.createDirectory(generatedRoot);
  await vscode.workspace.fs.createDirectory(stateRoot);

  let generatedFiles = 0;
  let changedContributionFiles = 0;
  let restoredContributionFiles = 0;
  let skippedContributionFiles = 0;
  let rebaselinedFiles = 0;

  for (const relPath of contributionPaths) {
    const normalizedRelPath = normalizeRelativePath(relPath);
    const contributionUri = vscode.Uri.joinPath(context.extensionUri, normalizedRelPath);
    const backupUri = vscode.Uri.joinPath(backupRoot, normalizedRelPath);
    const generatedUri = vscode.Uri.joinPath(generatedRoot, normalizedRelPath);
    const stateUri = vscode.Uri.joinPath(stateRoot, `${normalizedRelPath}.json`);

    const contributionContent = await tryReadText(contributionUri);
    if (contributionContent === undefined) {
      skippedContributionFiles += 1;
      output?.appendLine(`[agent-overrides] Skipping unreadable contribution file: ${normalizedRelPath}`);
      continue;
    }

    const fileId = extractFileIdFromPath(normalizedRelPath);
    const setting = settings[fileId];
    const hasOverride = hasRuntimeOverride(setting);

    const baseline = await resolveBaseline({
      relPath: normalizedRelPath,
      installedContent: contributionContent,
      backupUri,
      generatedUri,
      stateUri,
      output,
    });
    let state = baseline.state;
    const originalContent = baseline.originalContent;
    if (baseline.rebaselined) {
      rebaselinedFiles += 1;
    }

    if (!hasOverride) {
      if (contributionContent !== originalContent) {
        state = await recordWrittenContent(stateUri, state, originalContent);
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
    // Record before writing: a recorded-but-unwritten sha simply never matches,
    // whereas a written-but-unrecorded sha would look like a foreign edit and
    // bake the override in as the new pristine baseline.
    state = await recordWrittenContent(stateUri, state, overriddenContent);
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
    rebaselinedFiles,
  };
}

interface BaselineInput {
  relPath: string;
  installedContent: string;
  backupUri: vscode.Uri;
  generatedUri: vscode.Uri;
  stateUri: vscode.Uri;
  output?: vscode.OutputChannel;
}

interface BaselineResult {
  originalContent: string;
  state: AgentOverrideState;
  rebaselined: boolean;
}

/**
 * Decides whether the stored backup is still a valid pristine original.
 *
 * The installed file is "ours" only when its content is something we previously
 * wrote. Anything else (extension update, git checkout, manual edit) means the
 * file changed underneath us and IS the new pristine content, so the backup has
 * to be re-taken — otherwise a restore would silently revert the shipped file to
 * an arbitrarily old snapshot.
 *
 * Proving the installed file is ours is not enough: the backup itself must also
 * still be the content we stored, otherwise an altered backup would be restored
 * over a pristine installed file.
 */
async function resolveBaseline(input: BaselineInput): Promise<BaselineResult> {
  const { relPath, installedContent, backupUri, generatedUri, stateUri, output } = input;
  const installedSha = sha256(installedContent);
  const backupContent = await tryReadText(backupUri);
  let state = await readState(stateUri);
  let stateNeedsPersist = false;

  if (state === undefined) {
    // Migration for installs predating the sidecar: the previously generated
    // override output is the only legacy ownership signal available.
    const generatedContent = await tryReadText(generatedUri);
    const legacyOwned = generatedContent !== undefined && generatedContent === installedContent;
    state = {
      // Adopt the backup we are about to trust as the verifiable baseline, so this
      // install stops being unverifiable from now on.
      baselineSha: backupContent === undefined ? undefined : sha256(backupContent),
      writtenShas: legacyOwned ? [installedSha] : [],
    };
    stateNeedsPersist = true;

    const ambiguous =
      backupContent !== undefined &&
      !legacyOwned &&
      generatedContent !== undefined &&
      installedContent !== backupContent;
    if (ambiguous) {
      output?.appendLine(
        `[agent-overrides] Cannot prove ownership of ${relPath}; treating the installed file ` +
          `as the new original and discarding the stored backup.`
      );
    }
  }

  // `baselineSha === undefined` means the backup predates this check, so it cannot
  // be verified and is assumed trusted rather than force-re-baselining every install.
  const backupTrusted =
    backupContent !== undefined &&
    (state.baselineSha === undefined || sha256(backupContent) === state.baselineSha);

  const isOurs =
    (backupContent !== undefined && installedSha === sha256(backupContent)) ||
    state.writtenShas.includes(installedSha);

  if (backupContent !== undefined && !backupTrusted) {
    output?.appendLine(
      `[agent-overrides] Stored original for ${relPath} failed its integrity check ` +
        `(content no longer matches the recorded baseline); re-taking it from the installed file.`
    );
  }

  if (backupContent === undefined || !backupTrusted || !isOurs) {
    const rebaselinedState: AgentOverrideState = {
      baselineSha: installedSha,
      writtenShas: [installedSha],
    };
    await writeText(backupUri, installedContent);
    await writeState(stateUri, rebaselinedState);
    await tryDelete(generatedUri);
    return { originalContent: installedContent, state: rebaselinedState, rebaselined: true };
  }

  if (stateNeedsPersist) {
    await writeState(stateUri, state);
  }

  return { originalContent: backupContent, state, rebaselined: false };
}

async function recordWrittenContent(
  stateUri: vscode.Uri,
  state: AgentOverrideState,
  content: string
): Promise<AgentOverrideState> {
  const sha = sha256(content);
  const writtenShas = [sha, ...state.writtenShas.filter((value) => value !== sha)].slice(
    0,
    MAX_WRITTEN_SHAS
  );
  const next: AgentOverrideState = { baselineSha: state.baselineSha, writtenShas };
  await writeState(stateUri, next);
  return next;
}

async function readState(stateUri: vscode.Uri): Promise<AgentOverrideState | undefined> {
  const raw = await tryReadText(stateUri);
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AgentOverrideState>;
    const writtenShas = Array.isArray(parsed.writtenShas)
      ? parsed.writtenShas.filter((value): value is string => typeof value === "string")
      : [];
    const baselineSha = typeof parsed.baselineSha === "string" ? parsed.baselineSha : undefined;
    return { baselineSha, writtenShas };
  } catch {
    return undefined;
  }
}

async function writeState(stateUri: vscode.Uri, state: AgentOverrideState): Promise<void> {
  await writeText(stateUri, JSON.stringify(state, null, 2));
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Deletes the whole `agent-overrides` globalStorage tree so every contribution
 * file re-baselines from whatever is currently installed on the next apply.
 */
export async function resetAgentOverrideBaselines(
  context: vscode.ExtensionContext
): Promise<void> {
  const root = vscode.Uri.joinPath(context.globalStorageUri, "agent-overrides");
  try {
    await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
  } catch {
    // Nothing stored yet.
  }
}

function hasRuntimeOverride(setting: AgentSettingEntry | undefined): boolean {
  if (!setting) {
    return false;
  }
  return Boolean(
    setting.model?.trim() ||
      setting.reasoningEffort?.trim() ||
      setting.argumentHint?.trim() ||
      (setting.disabledTools && setting.disabledTools.length > 0) ||
      (setting.extraTools && setting.extraTools.length > 0) ||
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
  updated = upsertScalar(updated, "reasoning-effort", setting.reasoningEffort?.trim());
  updated = upsertScalar(updated, "argument-hint", setting.argumentHint?.trim());
  updated = upsertTools(updated, setting);
  updated = upsertHandoffs(updated, setting.handoffs ?? [], originalHandoffPrompts);

  const replacement = `---\n${updated}\n---`;
  return content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, replacement);
}

/**
 * Rewrites the `tools:` flow array from the stored deltas. Declared tokens are read
 * verbatim (wildcards such as `github/*` intact) so a round-trip never narrows a namespace.
 */
function upsertTools(frontmatter: string, setting: AgentSettingEntry): string {
  const disabledTools = setting.disabledTools ?? [];
  const extraTools = setting.extraTools ?? [];
  if (disabledTools.length === 0 && extraTools.length === 0) {
    return frontmatter;
  }

  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => /^tools:\s*/.test(line));
  if (index >= 0 && !/^tools:\s*\[.*\]\s*$/.test(lines[index])) {
    // Block-style tools list: leave it alone rather than corrupting it into a flow array.
    return frontmatter;
  }

  const declared = readDeclaredTools(frontmatter);
  const effective = resolveEffectiveTools(declared, disabledTools, extraTools);

  if (effective.length === 0) {
    if (index >= 0) {
      lines.splice(index, 1);
    }
    return lines.join("\n");
  }

  const newLine = `tools: [${effective.join(", ")}]`;
  if (index >= 0) {
    lines[index] = newLine;
  } else {
    lines.push(newLine);
  }

  return lines.join("\n");
}

function readDeclaredTools(frontmatter: string): string[] {
  const match = /^tools:\s*(.*)$/m.exec(frontmatter);
  if (!match) {
    return [];
  }

  const arrayMatch = /^\[(.*)\]$/.exec(match[1].trim());
  if (!arrayMatch) {
    return [];
  }

  return arrayMatch[1]
    .split(",")
    .map((token) => token.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter((token) => token.length > 0)
    .filter((token, index, all) => all.indexOf(token) === index);
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