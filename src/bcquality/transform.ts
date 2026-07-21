import * as fs from "fs";
import * as path from "path";
import {
  IReservedNamespaces,
  qualifiedInstructionFileName,
  qualifiedSkillFolderName,
} from "./namespace";
import { ICustomLayerEntry } from "./types";

/**
 * Transforms a fork's `custom/` folder tree into the on-disk layout the
 * extension serves from globalStorage.
 *
 * Two artifact shapes come in:
 *
 *   1. `custom/knowledge` markdown files — atomic BCQuality knowledge.
 *      Frontmatter is BCQuality-native (`bc-version`, `domain`, `keywords`…),
 *      NOT VS Code's `applyTo` schema. We rewrite the frontmatter (adding
 *      an `applyTo` glob when missing, plus a `description` for the Copilot
 *      instruction picker) and rename to `.instructions.md`.
 *
 *   2. `custom/skills` — action skills, either
 *      (a) flat `<name>.md` (mirroring `microsoft/skills/review/al-<name>.md`), or
 *      (b) folder-per-skill `<name>/SKILL.md` (per agentskills.io spec).
 *      Flat form gets wrapped into `<qualified>/SKILL.md`; folder form is
 *      passthrough-copied with the folder renamed.
 *
 * A provenance banner is prepended to each artifact so, no matter where the
 * agent reads it, the citation includes layer id + source URL + commit SHA.
 */

const KNOWLEDGE_SUBDIR = "knowledge";
const SKILLS_SUBDIR = "skills";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ITransformInput {
  /** Root of the *checked-out* fork on disk. */
  forkRoot: string;
  /** Destination roots inside globalStorage. */
  destinationInstructionsDir: string;
  destinationSkillsDir: string;
  layer: ICustomLayerEntry;
  /** Full 40-hex SHA that was cloned. Used for banners + provenance. */
  sha: string;
  reserved: IReservedNamespaces;
}

export interface ITransformResult {
  instructionsCount: number;
  skillsCount: number;
  skipped: Array<{ path: string; reason: string }>;
}

/** Max size per single file (defensive cap — customer content is markdown). */
const MAX_FILE_BYTES = 1_000_000;

export async function transformLayer(
  input: ITransformInput
): Promise<ITransformResult> {
  const result: ITransformResult = {
    instructionsCount: 0,
    skillsCount: 0,
    skipped: [],
  };

  await fs.promises.mkdir(input.destinationInstructionsDir, { recursive: true });
  await fs.promises.mkdir(input.destinationSkillsDir, { recursive: true });

  const customRoot = path.join(input.forkRoot, "custom");
  if (!fs.existsSync(customRoot)) {
    result.skipped.push({
      path: "custom/",
      reason: `Fork does not contain a "custom/" folder. Nothing to import.`,
    });
    return result;
  }

  const knowledgeRoot = path.join(customRoot, KNOWLEDGE_SUBDIR);
  await transformKnowledge(knowledgeRoot, input, result);

  const skillsRoot = path.join(customRoot, SKILLS_SUBDIR);
  await transformSkills(skillsRoot, input, result);

  return result;
}

// ---------------------------------------------------------------------------
// Knowledge → *.instructions.md
// ---------------------------------------------------------------------------

async function transformKnowledge(
  knowledgeRoot: string,
  input: ITransformInput,
  result: ITransformResult
): Promise<void> {
  if (!fs.existsSync(knowledgeRoot)) {
    return;
  }
  const files = await walkMarkdown(knowledgeRoot);
  for (const source of files) {
    const rel = path.relative(knowledgeRoot, source);
    try {
      const stat = await fs.promises.stat(source);
      if (stat.size > MAX_FILE_BYTES) {
        result.skipped.push({
          path: `knowledge/${rel}`,
          reason: `File exceeds ${MAX_FILE_BYTES} bytes.`,
        });
        continue;
      }
      const body = await fs.promises.readFile(source, "utf8");
      const baseName = path.basename(rel);
      const qualified = qualifiedInstructionFileName(
        input.layer.id,
        baseName,
        input.reserved
      );
      if (qualified.collision) {
        result.skipped.push({ path: `knowledge/${rel}`, reason: qualified.collision });
        continue;
      }
      const transformed = rewriteKnowledgeFrontmatter(body, {
        sourceRelPath: `custom/${KNOWLEDGE_SUBDIR}/${normalizeRelPathForFrontmatter(rel)}`,
        layer: input.layer,
        sha: input.sha,
      });
      const dest = path.join(input.destinationInstructionsDir, qualified.name);
      await fs.promises.writeFile(dest, transformed, "utf8");
      result.instructionsCount += 1;
    } catch (err) {
      result.skipped.push({
        path: `knowledge/${rel}`,
        reason: (err as Error).message,
      });
    }
  }
}

interface IKnowledgeContext {
  sourceRelPath: string;
  layer: ICustomLayerEntry;
  sha: string;
}

/**
 * Splits the incoming markdown into frontmatter + body, merges required VS
 * Code discovery keys into the frontmatter (without dropping the original
 * BCQuality metadata), then prepends a provenance banner.
 */
export function rewriteKnowledgeFrontmatter(
  source: string,
  ctx: IKnowledgeContext
): string {
  const { frontmatter, body } = splitFrontmatter(source);
  const map = parseSimpleYaml(frontmatter);
  if (!map.has("applyTo")) {
    map.set("applyTo", "'**/*.al'");
  }
  if (!map.has("description")) {
    map.set(
      "description",
      `BCQuality rule imported from ${ctx.layer.name || ctx.layer.id} (${ctx.sourceRelPath})`
    );
  }
  const rebuiltFrontmatter = serializeSimpleYaml(map);
  const banner = buildBanner(ctx);
  return `---\n${rebuiltFrontmatter}---\n\n${banner}${body.trimStart()}\n`;
}

function buildBanner(ctx: IKnowledgeContext): string {
  return (
    `> **Custom BCQuality layer** — sourced from ` +
    `\`${ctx.layer.repository}\` @ \`${ctx.sha.slice(0, 12)}\` ` +
    `(layer id: \`${ctx.layer.id}\`). Path in fork: \`${ctx.sourceRelPath}\`.\n\n`
  );
}

// ---------------------------------------------------------------------------
// Skills → <qualified>/SKILL.md (+ optional companion files)
// ---------------------------------------------------------------------------

async function transformSkills(
  skillsRoot: string,
  input: ITransformInput,
  result: ITransformResult
): Promise<void> {
  if (!fs.existsSync(skillsRoot)) {
    return;
  }
  const entries = await fs.promises.readdir(skillsRoot, { withFileTypes: true });

  for (const entry of entries) {
    const abs = path.join(skillsRoot, entry.name);
    try {
      if (entry.isDirectory()) {
        await importFolderSkill(abs, entry.name, input, result);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        await importFlatSkill(abs, entry.name, input, result);
      }
    } catch (err) {
      result.skipped.push({
        path: `skills/${entry.name}`,
        reason: (err as Error).message,
      });
    }
  }
}

async function importFolderSkill(
  sourceDir: string,
  folderName: string,
  input: ITransformInput,
  result: ITransformResult
): Promise<void> {
  const skillMdSource = path.join(sourceDir, "SKILL.md");
  if (!fs.existsSync(skillMdSource)) {
    result.skipped.push({
      path: `skills/${folderName}/`,
      reason: `Folder skill without SKILL.md — expected agentskills.io layout.`,
    });
    return;
  }
  const qualified = qualifiedSkillFolderName(
    input.layer.id,
    folderName,
    input.reserved
  );
  if (qualified.collision) {
    result.skipped.push({
      path: `skills/${folderName}/`,
      reason: qualified.collision,
    });
    return;
  }
  const destDir = path.join(input.destinationSkillsDir, qualified.name);
  await copyDirectoryFiltered(sourceDir, destDir, {
    layer: input.layer,
    sha: input.sha,
    sourceRelBase: `custom/skills/${folderName}`,
  });
  result.skillsCount += 1;
}

async function importFlatSkill(
  sourceFile: string,
  fileName: string,
  input: ITransformInput,
  result: ITransformResult
): Promise<void> {
  const stat = await fs.promises.stat(sourceFile);
  if (stat.size > MAX_FILE_BYTES) {
    result.skipped.push({
      path: `skills/${fileName}`,
      reason: `File exceeds ${MAX_FILE_BYTES} bytes.`,
    });
    return;
  }
  const stem = fileName.toLowerCase().replace(/\.md$/i, "");
  const qualified = qualifiedSkillFolderName(input.layer.id, stem, input.reserved);
  if (qualified.collision) {
    result.skipped.push({ path: `skills/${fileName}`, reason: qualified.collision });
    return;
  }
  const destDir = path.join(input.destinationSkillsDir, qualified.name);
  await fs.promises.mkdir(destDir, { recursive: true });
  const body = await fs.promises.readFile(sourceFile, "utf8");
  const banner = buildBanner({
    layer: input.layer,
    sha: input.sha,
    sourceRelPath: `custom/skills/${fileName}`,
  });
  const wrapped = ensureFrontmatter(body, input.layer, `custom/skills/${fileName}`) +
    banner +
    stripLeadingFrontmatter(body).trimStart() +
    "\n";
  await fs.promises.writeFile(path.join(destDir, "SKILL.md"), wrapped, "utf8");
  result.skillsCount += 1;
}

interface ICopyContext {
  layer: ICustomLayerEntry;
  sha: string;
  sourceRelBase: string;
}

/**
 * Recursively copies allowed files. Bans binaries and executables — customer
 * skill payloads must stay text (agentskills.io permits `scripts/`, but for
 * v1 we only ship markdown / text / json / yaml alongside the SKILL.md so
 * the sandbox stays inert).
 */
const ALLOWED_EXT = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

async function copyDirectoryFiltered(
  sourceDir: string,
  destDir: string,
  ctx: ICopyContext
): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcAbs = path.join(sourceDir, entry.name);
    const dstAbs = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryFiltered(srcAbs, dstAbs, {
        ...ctx,
        sourceRelBase: `${ctx.sourceRelBase}/${entry.name}`,
      });
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      continue;
    }
    const stat = await fs.promises.stat(srcAbs);
    if (stat.size > MAX_FILE_BYTES) {
      continue;
    }
    const body = await fs.promises.readFile(srcAbs, "utf8");
    if (entry.name.toLowerCase() === "skill.md") {
      const banner = buildBanner({
        layer: ctx.layer,
        sha: ctx.sha,
        sourceRelPath: `${ctx.sourceRelBase}/SKILL.md`,
      });
      const withBanner =
        keepFrontmatter(body) +
        banner +
        stripLeadingFrontmatter(body).trimStart() +
        "\n";
      await fs.promises.writeFile(dstAbs, withBanner, "utf8");
    } else {
      await fs.promises.writeFile(dstAbs, body, "utf8");
    }
  }
}

// ---------------------------------------------------------------------------
// Frontmatter helpers (tiny YAML-ish parser — BCQuality frontmatter is flat)
// ---------------------------------------------------------------------------

function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  const m = source.match(FRONTMATTER_RE);
  if (!m) {
    return { frontmatter: "", body: source };
  }
  return { frontmatter: m[1], body: source.slice(m[0].length) };
}

function stripLeadingFrontmatter(source: string): string {
  return source.replace(FRONTMATTER_RE, "");
}

function keepFrontmatter(source: string): string {
  const m = source.match(FRONTMATTER_RE);
  return m ? m[0] : "";
}

/**
 * Simple frontmatter parser: one `key: value` per line at the top level.
 * Values are captured verbatim, so quoted/YAML-list values round-trip
 * without semantic interpretation.
 */
function parseSimpleYaml(source: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!source) {
    return map;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) {
      continue;
    }
    // Only handle top-level `key: value` (skip nested / list continuations to
    // avoid corrupting complex frontmatter — we preserve those lines
    // verbatim via the fallback below).
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m) {
      map.set(m[1], m[2]);
    }
  }
  return map;
}

function serializeSimpleYaml(map: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of map) {
    lines.push(`${key}: ${value}`);
  }
  return lines.join("\n") + "\n";
}

function ensureFrontmatter(
  body: string,
  layer: ICustomLayerEntry,
  sourceRelPath: string
): string {
  const existing = keepFrontmatter(body);
  if (existing) {
    return existing;
  }
  return (
    `---\n` +
    `description: BCQuality custom skill imported from ${layer.name || layer.id}\n` +
    `source: ${sourceRelPath}\n` +
    `layer: ${layer.id}\n` +
    `---\n\n`
  );
}

function normalizeRelPathForFrontmatter(rel: string): string {
  return rel.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Filesystem walk
// ---------------------------------------------------------------------------

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}
