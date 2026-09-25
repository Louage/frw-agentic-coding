// src/claudePlugin/mapAgent.ts — must not import "vscode" or "yaml" (WI-5a, D48).
//
// Agent, command and skill frontmatter transforms (PROJECT_BRIEF.md §14.5).

import path from "node:path/posix";
import { mapModel, mapTools, CANONICAL_TOOL_ORDER } from "./toolMap";
import type {
  ClaudeAgentDoc,
  ClaudeCommandDoc,
  ClaudeSkillDoc,
  CopilotAgentDoc,
  EmitDiagnostic,
  RelPath,
  SkillSource,
} from "./types";

const REASONING_EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * The frontmatter keys the agent transform understands. Everything else on a
 * source agent's frontmatter is stripped (#15, A10).
 */
const KNOWN_AGENT_KEYS = new Set([
  "name",
  "description",
  "tools",
  "model",
  "argument-hint",
  "user-invocable",
  "disable-model-invocation",
  "reasoning-effort",
  "handoffs",
  "agents",
]);

/**
 * A1: the text before the first comma, NFKD-normalised, non-ASCII stripped,
 * lower-cased, runs of non-`[a-z0-9]` collapsed to `-`, leading/trailing `-`
 * trimmed. No comma → the whole name is slugified. Never contains `:`.
 */
export function slugifyAgentId(displayName: string): string {
  const namePart = displayName.includes(",") ? displayName.slice(0, displayName.indexOf(",")) : displayName;
  const decomposed = namePart.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const asciiOnly = decomposed.replace(/[^\x00-\x7F]/g, "");
  const lower = asciiOnly.toLowerCase();
  return lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Builds the display-name → Claude id index used to resolve `handoffs[].agent`
 * and `agents[]` (Malcolm's subagent allowlist) targets, and flags every
 * agent whose name slugifies to an id already claimed by another agent.
 */
export function buildAgentIdIndex(docs: readonly CopilotAgentDoc[]): {
  byDisplayName: Map<string, string>;
  diagnostics: EmitDiagnostic[];
} {
  const byDisplayName = new Map<string, string>();
  const namesBySlug = new Map<string, RelPath[]>();

  for (const doc of docs) {
    const slug = slugifyAgentId(doc.frontmatter.name);
    byDisplayName.set(doc.frontmatter.name, slug);
    const existing = namesBySlug.get(slug) ?? [];
    existing.push(doc.sourcePath);
    namesBySlug.set(slug, existing);
  }

  const diagnostics: EmitDiagnostic[] = [];
  for (const doc of docs) {
    const slug = slugifyAgentId(doc.frontmatter.name);
    const sources = namesBySlug.get(slug) ?? [];
    if (sources.length > 1) {
      diagnostics.push({
        level: "error",
        source: doc.sourcePath,
        code: "duplicate-agent-id",
        message: `Agent "${doc.frontmatter.name}" slugifies to id "${slug}", which collides with: ${sources
          .filter((s) => s !== doc.sourcePath)
          .join(", ")}`,
      });
    }
  }

  return { byDisplayName, diagnostics };
}

function resolveAgentId(displayName: string, idIndex: ReadonlyMap<string, string>): string {
  return idIndex.get(displayName) ?? slugifyAgentId(displayName);
}

function sortToolsCanonically(tools: readonly string[]): import("./types").ClaudeToolName[] {
  const set = new Set(tools as import("./types").ClaudeToolName[]);
  return CANONICAL_TOOL_ORDER.filter((tool) => set.has(tool));
}

/**
 * Maps a single Copilot chat agent document onto its Claude Code equivalent
 * (§14.5 A1–A11, A12 for the eventual render step).
 */
export function mapAgent(
  doc: CopilotAgentDoc,
  idIndex: Map<string, string>,
  invokedBy: readonly string[],
): { agent: ClaudeAgentDoc; diagnostics: EmitDiagnostic[] } {
  const diagnostics: EmitDiagnostic[] = [];
  const fm = doc.frontmatter;
  const id = resolveAgentId(fm.name, idIndex);
  const fileName = `${id}.md`;

  // A3 + A6: description, plus the invocation-constraint suffix.
  let description = fm.description ?? "";
  const userInvocableFalse = fm["user-invocable"] === false;
  const disableModelInvocation = fm["disable-model-invocation"] === true;
  if (userInvocableFalse) {
    description +=
      invokedBy.length > 0
        ? ` Internal subagent: only invoked by ${invokedBy
            .map((name) => `\`acdc:${resolveAgentId(name, idIndex)}\``)
            .join(", ")} via the Agent tool.`
        : " Internal subagent: not for direct use.";
  } else if (disableModelInvocation) {
    description += " Use only when the user explicitly asks for this agent.";
  }

  // A8: does this agent declare a subagent allowlist?
  const hasSubagents = Array.isArray(fm.agents) && fm.agents.length > 0;

  // A4: tool mapping.
  let tools: import("./types").ClaudeToolName[] | undefined;
  if (fm.tools !== undefined) {
    const { tools: mapped } = mapTools(fm.tools);
    if (mapped.length === 0) {
      tools = ["Read"];
      diagnostics.push({
        level: "warn",
        source: doc.sourcePath,
        code: "tool-dropped",
        message: "Every source tool dropped by TOOL_MAP; falling back to tools: Read.",
      });
    } else {
      tools = mapped;
    }
    if (hasSubagents && !tools.includes("Agent")) {
      tools = sortToolsCanonically([...tools, "Agent"]);
    }
  }

  // A5: model.
  let model: "sonnet" | "opus" | "haiku" | undefined;
  if (fm.model !== undefined) {
    model = mapModel(fm.model);
    if (model === undefined) {
      diagnostics.push({
        level: "warn",
        source: doc.sourcePath,
        code: "model-unmapped",
        message: `Model "${fm.model}" has no Claude Code equivalent; omitted (inherit).`,
      });
    }
  }

  // A11: reasoning-effort → effort.
  let effort: string | undefined;
  const rawEffort = fm["reasoning-effort"];
  if (typeof rawEffort === "string") {
    if (REASONING_EFFORT_VALUES.has(rawEffort)) {
      effort = rawEffort;
    } else {
      diagnostics.push({
        level: "warn",
        source: doc.sourcePath,
        code: "key-stripped",
        message: `reasoning-effort "${rawEffort}" is not a supported value; dropped.`,
      });
    }
  }

  // A10: strip every other key, one info diagnostic per key.
  for (const key of Object.keys(fm)) {
    if (!KNOWN_AGENT_KEYS.has(key)) {
      diagnostics.push({
        level: "info",
        source: doc.sourcePath,
        code: "key-stripped",
        message: `Dropped unsupported agent key "${key}".`,
      });
    }
  }

  // A2: persona prefix line, inserted above the byte-identical original body.
  const personaLine = `> Persona: **${fm.name}** · Claude Code id \`acdc:${id}\``;
  let body = `${personaLine}\n${doc.body}`;

  // A7: appended Handoffs section.
  if (Array.isArray(fm.handoffs) && fm.handoffs.length > 0) {
    const bullets = fm.handoffs.map((handoff) => {
      const targetId = idIndex.get(handoff.agent);
      let target: string;
      if (targetId) {
        target = `\`acdc:${targetId}\``;
      } else {
        target = `\`${handoff.agent}\``;
        diagnostics.push({
          level: "warn",
          source: doc.sourcePath,
          code: "handoff-target-unknown",
          message: `Handoff target "${handoff.agent}" was not found among the emitted agents.`,
        });
      }
      return `- **${handoff.label}**: delegate to ${target} with: ${handoff.prompt ?? ""}`;
    });
    body += `\n\n<!-- BEGIN:ACDC-CLAUDE-HANDOFFS -->\n## Handoffs\n\n${bullets.join("\n")}\n<!-- END:ACDC-CLAUDE-HANDOFFS -->\n`;
  }

  // A8: appended Subagents section.
  if (hasSubagents) {
    const bullets = (fm.agents ?? []).map((name) => `- \`acdc:${resolveAgentId(name, idIndex)}\``);
    body += `\n\n<!-- BEGIN:ACDC-CLAUDE-SUBAGENTS -->\n## Subagents\n\n${bullets.join("\n")}\n<!-- END:ACDC-CLAUDE-SUBAGENTS -->\n`;
  }

  const agent: ClaudeAgentDoc = {
    id,
    fileName,
    frontmatter: { name: id, description, tools, model, effort },
    body,
  };

  return { agent, diagnostics };
}

/**
 * Renders a `ClaudeAgentDoc` into the fixed, restricted A12 frontmatter
 * format (JSON-quoted one-line scalars, `tools` joined into a single
 * comma-separated string, key order `name, description, tools, model,
 * effort`). This is what a future runtime rewriter (§14.15) can parse and
 * rewrite without a YAML library.
 */
export function renderClaudeAgentMarkdown(doc: ClaudeAgentDoc): string {
  const frontmatter: Record<string, unknown> = {
    name: doc.frontmatter.name,
    description: doc.frontmatter.description,
  };
  if (doc.frontmatter.tools && doc.frontmatter.tools.length > 0) {
    frontmatter.tools = doc.frontmatter.tools.join(", ");
  }
  if (doc.frontmatter.model) {
    frontmatter.model = doc.frontmatter.model;
  }
  if (doc.frontmatter.effort) {
    frontmatter.effort = doc.frontmatter.effort;
  }

  // Deliberately not routed through frontmatter.renderMarkdown: that helper is
  // shared with commands/skills and this fixed shape (A12) must never drift
  // if that shared renderer's defaults change.
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---");

  let text = `${lines.join("\n")}\n${doc.body.replace(/\r\n/g, "\n")}`;
  if (!text.endsWith("\n")) {
    text += "\n";
  }
  return text;
}

const KNOWN_COMMAND_KEYS = new Set(["description", "argument-hint", "model", "agent", "tools"]);

/**
 * C1: id = the file basename without `.prompt.md`, with `.` → `-`.
 */
export function promptIdFromPath(sourcePath: RelPath): string {
  const base = path.basename(sourcePath).replace(/\.prompt\.md$/, "");
  return base.replace(/\./g, "-");
}

/**
 * Maps a Copilot prompt file onto a Claude Code command (§14.5 C1–C4).
 */
export function mapPromptToCommand(
  sourcePath: RelPath,
  text: string,
): { command: ClaudeCommandDoc; diagnostics: EmitDiagnostic[] } {
  const diagnostics: EmitDiagnostic[] = [];
  const id = promptIdFromPath(sourcePath);
  const fileName = `${id}.md`;

  const parsed = parseFrontmatterLocal(text);
  if (!parsed) {
    diagnostics.push({
      level: "error",
      source: sourcePath,
      code: "unparseable-frontmatter",
      message: `Could not parse frontmatter in ${sourcePath}.`,
    });
    return {
      command: { id, fileName, frontmatter: { description: "" }, body: text },
      diagnostics,
    };
  }

  const { data, body } = parsed;
  const frontmatter: import("./types").ClaudeCommandFrontmatter = {
    description: typeof data.description === "string" ? data.description : "",
  };
  if (typeof data["argument-hint"] === "string") {
    frontmatter["argument-hint"] = data["argument-hint"];
  }
  if (data.model !== undefined) {
    const mapped = mapModel(String(data.model));
    if (mapped) {
      frontmatter.model = mapped;
    } else {
      diagnostics.push({
        level: "warn",
        source: sourcePath,
        code: "model-unmapped",
        message: `Model "${String(data.model)}" has no Claude Code equivalent; omitted.`,
      });
    }
  }

  for (const key of Object.keys(data)) {
    if (!KNOWN_COMMAND_KEYS.has(key)) {
      diagnostics.push({
        level: "info",
        source: sourcePath,
        code: "key-stripped",
        message: `Dropped unsupported command key "${key}".`,
      });
    }
  }

  return { command: { id, fileName, frontmatter, body }, diagnostics };
}

/** Renders a `ClaudeCommandDoc` into Markdown text. */
export function renderClaudeCommandMarkdown(doc: ClaudeCommandDoc): string {
  return renderMarkdownLocal(
    { description: doc.frontmatter.description, "argument-hint": doc.frontmatter["argument-hint"], model: doc.frontmatter.model },
    doc.body,
  );
}

/**
 * K1–K5: the plugin consumption note that replaces a bundled BCQuality
 * skill's original "clone-oriented" note. Meaning fixed by D46/§14.5;
 * wording may be polished.
 */
export const PLUGIN_CONSUMPTION_NOTE =
  "> **Plugin consumption note.** In Claude Code this skill ships inside the AC⚡DC plugin " +
  "*without* the bundled BCQuality instruction corpus. If a BCQuality `skills/entry.md` is " +
  "available in this session (for example from an installed BCQuality plugin), follow it. " +
  "Otherwise apply this skill's Relevance and Worklist natively and label findings **reduced " +
  "confidence (no BCQuality citation)**. Upstream clone-oriented paths below are kept for " +
  "provenance.";

const BCQUALITY_NAME_PREFIX = "microsoft-bcquality-assets-";
const BUNDLED_NOTE_LINE = /^> \*\*Bundled consumption note\.\*\*.*$/m;
const IMPORTED_DESCRIPTION_PREFIX = /^Imported BCQuality skill from /;

/**
 * Maps a single Copilot chat skill (folder containing SKILL.md) onto a
 * Claude Code plugin skill (§14.5 K1–K5).
 */
export function mapSkill(source: SkillSource): { skill: ClaudeSkillDoc; diagnostics: EmitDiagnostic[] } {
  const diagnostics: EmitDiagnostic[] = [];
  const fallbackId = path.basename(source.dir);

  const parsed = parseFrontmatterLocal(source.skillMd);
  if (!parsed) {
    diagnostics.push({
      level: "error",
      source: source.dir,
      code: "unparseable-frontmatter",
      message: `Could not parse frontmatter in ${source.dir}/SKILL.md.`,
    });
    return {
      skill: { id: fallbackId, skillMd: source.skillMd, supportingFiles: source.supportingFiles },
      diagnostics,
    };
  }

  const { data, body } = parsed;
  const originalName = typeof data.name === "string" ? data.name : fallbackId;
  const isBcQuality = originalName.startsWith(BCQUALITY_NAME_PREFIX);

  // K1: id.
  let id = originalName;
  if (isBcQuality) {
    const sourceLine = body.match(/^Source:\s*(.+)$/m);
    if (sourceLine) {
      id = path.basename(sourceLine[1].trim()).replace(/\.md$/, "");
    }
  }

  // K2: replace the bundled consumption note.
  let newBody = body;
  if (BUNDLED_NOTE_LINE.test(body)) {
    newBody = body.replace(BUNDLED_NOTE_LINE, PLUGIN_CONSUMPTION_NOTE);
  } else if (isBcQuality) {
    diagnostics.push({
      level: "warn",
      source: source.dir,
      code: "consumption-note-missing",
      message: `BCQuality skill "${id}" has no bundled consumption note to replace.`,
    });
  }

  // K3: description.
  let description = typeof data.description === "string" ? data.description : "";
  if (IMPORTED_DESCRIPTION_PREFIX.test(description)) {
    description = firstSentenceAfterSecondHeading(newBody);
  }

  const frontmatter: Record<string, unknown> = { ...data, name: id, description };
  const skillMd = renderMarkdownLocal(frontmatter, newBody);

  return { skill: { id, skillMd, supportingFiles: source.supportingFiles }, diagnostics };
}

function firstSentenceAfterSecondHeading(body: string): string {
  const lines = body.split("\n");
  let headingCount = 0;
  let startIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+/.test(lines[i])) {
      headingCount += 1;
      if (headingCount === 2) {
        startIndex = i + 1;
        break;
      }
    }
  }
  if (startIndex === -1) {
    return "";
  }

  let i = startIndex;
  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === "") {
      i += 1;
    }
  };
  skipBlank();
  while (i < lines.length && (/^Source:/i.test(lines[i].trim()) || lines[i].trim().startsWith(">"))) {
    i += 1;
    skipBlank();
  }

  const paragraph: string[] = [];
  while (i < lines.length && lines[i].trim() !== "" && !/^#/.test(lines[i])) {
    paragraph.push(lines[i]);
    i += 1;
  }

  const text = paragraph.join(" ").trim();
  const sentenceMatch = text.match(/^.*?[.!?](?=\s|$)/);
  const sentence = sentenceMatch ? sentenceMatch[0] : text;
  return sentence.slice(0, 1024);
}

// Local, minimal re-implementations to avoid a circular/duplicate dependency
// on frontmatter.ts's `yaml`-backed parser: mapAgent.ts must not import
// "yaml" (D48). Commands and skills only ever carry flat scalar frontmatter
// in this repo (string/boolean values, no nesting), so a tiny hand-rolled
// parser is enough and keeps the ESLint `no-restricted-imports` guard
// meaningful (only frontmatter.ts may import "yaml").
function parseFrontmatterLocal(text: string): { data: Record<string, unknown>; body: string } | undefined {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return undefined;
  }
  const afterFirstLine = normalized.slice(4);
  const closingIndex = afterFirstLine.indexOf("\n---\n");
  if (closingIndex === -1) {
    return undefined;
  }
  const yamlText = afterFirstLine.slice(0, closingIndex);
  const body = afterFirstLine.slice(closingIndex + 5);
  const data = parseFlatYaml(yamlText);
  return { data, body };
}

function parseFlatYaml(yamlText: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = yamlText.split("\n");
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    data[key] = parseScalar(rawValue);
  }
  return data;
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return trimmed.startsWith('"') ? (JSON.parse(trimmed) as string) : trimmed.slice(1, -1).replace(/''/g, "'");
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function renderMarkdownLocal(frontmatter: Record<string, unknown>, body: string): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) {
      continue;
    }
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---");
  const normalizedBody = body.replace(/\r\n/g, "\n");
  let text = `${lines.join("\n")}\n${normalizedBody}`;
  if (!text.endsWith("\n")) {
    text += "\n";
  }
  return text;
}
