// src/claudePlugin/planPluginSurface.ts — must not import "vscode" (WI-5a).
//
// Whole-surface plan from in-memory inputs: package.json metadata plus every
// contributed agent/prompt/skill file's text. Pure — no fs, no process.

import posixPath from "node:path/posix";
import { buildAgentIdIndex, mapAgent, mapPromptToCommand, mapSkill, renderClaudeAgentMarkdown, renderClaudeCommandMarkdown } from "./mapAgent";
import { parseFrontmatter } from "./frontmatter";
import type {
  CopilotAgentDoc,
  CopilotAgentFrontmatter,
  EmitDiagnostic,
  PlannedFile,
  PluginFilePlan,
  PluginSurfaceInput,
  RelPath,
  SkillSource,
} from "./types";

export const MARKETPLACE_NAME = "acdc-vscode";
export const PLUGIN_NAME = "acdc";
export const PLUGIN_DIR = "claude-plugin";

/** Fixed brand string — there is no package.json field that carries this short form (§14.5). */
const PLUGIN_DISPLAY_NAME = "AC⚡DC";
const PLUGIN_LICENSE = "MIT";
const PLUGIN_KEYWORDS = ["AL", "Business Central", "Dynamics 365"];
const MARKETPLACE_DESCRIPTION = "AC⚡DC VS Code extension, as a Claude Code marketplace.";

function readText(files: PluginSurfaceInput["files"], relPath: RelPath): string | undefined {
  const raw = files.get(relPath);
  if (raw === undefined) {
    return undefined;
  }
  return typeof raw === "string" ? raw : new TextDecoder("utf-8").decode(raw);
}

function planAgents(
  input: PluginSurfaceInput,
  diagnostics: EmitDiagnostic[],
): { files: PlannedFile[]; count: number } {
  const docs: CopilotAgentDoc[] = [];

  for (const sourcePath of input.contributions.agents) {
    const text = readText(input.files, sourcePath);
    if (text === undefined) {
      diagnostics.push({
        level: "error",
        source: sourcePath,
        code: "missing-source",
        message: `Contributed agent file is missing from the input set: ${sourcePath}`,
      });
      continue;
    }
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      diagnostics.push({
        level: "error",
        source: sourcePath,
        code: "unparseable-frontmatter",
        message: `Could not parse frontmatter in ${sourcePath}.`,
      });
      continue;
    }
    docs.push({
      sourcePath,
      frontmatter: parsed.data as CopilotAgentFrontmatter,
      body: parsed.body,
    });
  }

  const { byDisplayName, diagnostics: idDiagnostics } = buildAgentIdIndex(docs);
  diagnostics.push(...idDiagnostics);

  const invokedByMap = new Map<string, string[]>();
  for (const doc of docs) {
    for (const target of doc.frontmatter.agents ?? []) {
      const existing = invokedByMap.get(target) ?? [];
      existing.push(doc.frontmatter.name);
      invokedByMap.set(target, existing);
    }
  }

  const files: PlannedFile[] = [];
  for (const doc of docs) {
    const invokedBy = invokedByMap.get(doc.frontmatter.name) ?? [];
    const { agent, diagnostics: agentDiagnostics } = mapAgent(doc, byDisplayName, invokedBy);
    diagnostics.push(...agentDiagnostics);
    files.push({
      path: posixPath.join(PLUGIN_DIR, "agents", agent.fileName),
      content: renderClaudeAgentMarkdown(agent),
    });
  }

  return { files, count: docs.length };
}

function planCommands(
  input: PluginSurfaceInput,
  diagnostics: EmitDiagnostic[],
): { files: PlannedFile[]; count: number } {
  const files: PlannedFile[] = [];
  const idsSeen = new Map<string, RelPath[]>();

  for (const sourcePath of input.contributions.prompts) {
    const text = readText(input.files, sourcePath);
    if (text === undefined) {
      diagnostics.push({
        level: "error",
        source: sourcePath,
        code: "missing-source",
        message: `Contributed prompt file is missing from the input set: ${sourcePath}`,
      });
      continue;
    }
    const { command, diagnostics: commandDiagnostics } = mapPromptToCommand(sourcePath, text);
    diagnostics.push(...commandDiagnostics);

    const existing = idsSeen.get(command.id) ?? [];
    existing.push(sourcePath);
    idsSeen.set(command.id, existing);

    files.push({
      path: posixPath.join(PLUGIN_DIR, "commands", command.fileName),
      content: renderClaudeCommandMarkdown(command),
    });
  }

  for (const [id, sources] of idsSeen) {
    if (sources.length > 1) {
      for (const source of sources) {
        diagnostics.push({
          level: "error",
          source,
          code: "duplicate-command-id",
          message: `Command id "${id}" collides with: ${sources.filter((s) => s !== source).join(", ")}`,
        });
      }
    }
  }

  return { files, count: idsSeen.size };
}

function collectSupportingFiles(
  input: PluginSurfaceInput,
  skillMdPath: RelPath,
): ReadonlyMap<RelPath, string | Uint8Array> {
  const dir = posixPath.dirname(skillMdPath);
  const supporting = new Map<RelPath, string | Uint8Array>();
  const prefix = `${dir}/`;
  for (const [candidatePath, content] of input.files) {
    if (candidatePath === skillMdPath) {
      continue;
    }
    if (candidatePath.startsWith(prefix)) {
      supporting.set(candidatePath.slice(prefix.length), content);
    }
  }
  return supporting;
}

function planSkills(
  input: PluginSurfaceInput,
  diagnostics: EmitDiagnostic[],
): { files: PlannedFile[]; count: number } {
  const files: PlannedFile[] = [];
  const idsSeen = new Map<string, RelPath[]>();

  for (const sourcePath of input.contributions.skills) {
    const skillMd = readText(input.files, sourcePath);
    if (skillMd === undefined) {
      diagnostics.push({
        level: "error",
        source: sourcePath,
        code: "missing-source",
        message: `Contributed skill file is missing from the input set: ${sourcePath}`,
      });
      continue;
    }

    const source: SkillSource = {
      dir: posixPath.dirname(sourcePath),
      skillMd,
      supportingFiles: collectSupportingFiles(input, sourcePath),
    };

    const { skill, diagnostics: skillDiagnostics } = mapSkill(source);
    diagnostics.push(...skillDiagnostics);

    const existing = idsSeen.get(skill.id) ?? [];
    existing.push(sourcePath);
    idsSeen.set(skill.id, existing);

    const skillRoot = posixPath.join(PLUGIN_DIR, "skills", skill.id);
    files.push({ path: posixPath.join(skillRoot, "SKILL.md"), content: skill.skillMd });
    for (const [relPath, content] of skill.supportingFiles) {
      files.push({ path: posixPath.join(skillRoot, relPath), content });
    }
  }

  for (const [id, sources] of idsSeen) {
    if (sources.length > 1) {
      for (const source of sources) {
        diagnostics.push({
          level: "error",
          source,
          code: "duplicate-skill-id",
          message: `Skill id "${id}" collides with: ${sources.filter((s) => s !== source).join(", ")}`,
        });
      }
    }
  }

  return { files, count: idsSeen.size };
}

function planManifests(input: PluginSurfaceInput): PlannedFile[] {
  const marketplace = {
    name: MARKETPLACE_NAME,
    owner: { name: input.packageMeta.publisher },
    metadata: { description: MARKETPLACE_DESCRIPTION },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: `./${PLUGIN_DIR}`,
        description: input.packageMeta.description ?? "",
      },
    ],
  };

  const plugin = {
    name: PLUGIN_NAME,
    displayName: PLUGIN_DISPLAY_NAME,
    description: input.packageMeta.description ?? "",
    author: { name: input.packageMeta.publisher },
    repository: input.packageMeta.repositoryUrl ?? "",
    license: PLUGIN_LICENSE,
    keywords: PLUGIN_KEYWORDS,
  };

  return [
    { path: ".claude-plugin/marketplace.json", content: `${JSON.stringify(marketplace, null, 2)}\n` },
    {
      path: posixPath.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"),
      content: `${JSON.stringify(plugin, null, 2)}\n`,
    },
  ];
}

/**
 * Builds the entire Claude Code plugin surface (agents, commands, skills,
 * manifests) from in-memory inputs. Pure — deterministic for identical
 * input, no filesystem access (§14.4).
 */
export function planPluginSurface(input: PluginSurfaceInput): PluginFilePlan {
  const diagnostics: EmitDiagnostic[] = [];

  const agents = planAgents(input, diagnostics);
  const commands = planCommands(input, diagnostics);
  const skills = planSkills(input, diagnostics);
  const manifests = planManifests(input);

  return {
    files: [...agents.files, ...commands.files, ...skills.files, ...manifests],
    managedRoots: [".claude-plugin", "claude-plugin"],
    diagnostics,
    counts: { agents: agents.count, commands: commands.count, skills: skills.count },
  };
}
