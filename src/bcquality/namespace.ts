import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Scans the extension's bundled assets to build the set of "reserved names"
 * a customer layer must never collide with — even after the mandatory
 * `<layer-id>__` prefix is applied.
 *
 * Reserved = every filename/foldername Copilot Chat currently reads from
 * `contributes.chatAgents`, `contributes.chatSkills`, or
 * `contributes.chatInstructions`. If a customer file (after prefixing) still
 * matches one of these, the sync engine rejects the file and logs an
 * actionable error — never overwrites.
 *
 * Cached once per extension activation. Recomputed on activation because
 * bundled assets only change with an extension version bump.
 */
export interface IReservedNamespaces {
  agentBaseNames: Set<string>;
  skillFolderNames: Set<string>;
  instructionFileNames: Set<string>;
}

let cache: IReservedNamespaces | undefined;

export function computeReservedNamespaces(
  extensionUri: vscode.Uri
): IReservedNamespaces {
  if (cache) {
    return cache;
  }
  const root = extensionUri.fsPath;
  const generatedRoot = path.join(root, "assets", "generated");

  const agentBaseNames = new Set<string>();
  const skillFolderNames = new Set<string>();
  const instructionFileNames = new Set<string>();

  if (fs.existsSync(generatedRoot)) {
    for (const sourceDir of listDirs(generatedRoot)) {
      collectAgentBaseNames(path.join(sourceDir, "agents"), agentBaseNames);
      collectSkillFolderNames(path.join(sourceDir, "skills"), skillFolderNames);
      collectInstructionFileNames(
        path.join(sourceDir, "instructions"),
        instructionFileNames
      );
    }
  }

  // Also count workspace-level source-of-truth files under .github (used by
  // the auto-applied instructions layer) — they are what agents ACTUALLY see.
  const dotGithub = path.join(root, ".github");
  collectAgentBaseNames(path.join(dotGithub, "agents"), agentBaseNames);
  collectSkillFolderNames(path.join(dotGithub, "skills"), skillFolderNames);
  collectInstructionFileNames(
    path.join(dotGithub, "instructions"),
    instructionFileNames
  );

  cache = { agentBaseNames, skillFolderNames, instructionFileNames };
  return cache;
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function collectAgentBaseNames(agentsDir: string, out: Set<string>): void {
  try {
    for (const entry of fs.readdirSync(agentsDir)) {
      const m = entry.match(/^(.+?)\.agent\.md$/i);
      if (m) {
        out.add(m[1].toLowerCase());
      }
    }
  } catch {
    // Directory absent — nothing to add.
  }
}

function collectSkillFolderNames(skillsDir: string, out: Set<string>): void {
  try {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        out.add(entry.name.toLowerCase());
      }
    }
  } catch {
    // Directory absent — nothing to add.
  }
}

function collectInstructionFileNames(
  instructionsDir: string,
  out: Set<string>
): void {
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".instructions.md")) {
        out.add(e.name.toLowerCase());
      }
    }
  };
  walk(instructionsDir);
}

/**
 * Applies the mandatory `<id>__` prefix and asserts the resulting name does
 * not collide with a reserved namespace.
 */
export function qualifiedInstructionFileName(
  layerId: string,
  fileName: string,
  reserved: IReservedNamespaces
): { name: string; collision?: string } {
  const clean = sanitizeFileNameSegment(fileName).toLowerCase();
  const base = clean.endsWith(".instructions.md")
    ? clean
    : clean.replace(/\.md$/i, "") + ".instructions.md";
  const qualified = `${layerId}__${base}`;
  if (reserved.instructionFileNames.has(qualified)) {
    return {
      name: qualified,
      collision: `Instruction filename "${qualified}" collides with a bundled instruction.`,
    };
  }
  return { name: qualified };
}

export function qualifiedSkillFolderName(
  layerId: string,
  folderName: string,
  reserved: IReservedNamespaces
): { name: string; collision?: string } {
  const clean = sanitizeFileNameSegment(folderName).toLowerCase().replace(/\.md$/i, "");
  const qualified = `${layerId}__${clean}`;
  if (reserved.skillFolderNames.has(qualified)) {
    return {
      name: qualified,
      collision: `Skill folder name "${qualified}" collides with a bundled skill.`,
    };
  }
  if (reserved.agentBaseNames.has(qualified)) {
    return {
      name: qualified,
      collision: `Skill folder name "${qualified}" collides with a bundled agent name.`,
    };
  }
  return { name: qualified };
}

/** Also rejects layer ids that collide with existing bundled namespaces. */
export function isLayerIdReserved(
  layerId: string,
  reserved: IReservedNamespaces
): boolean {
  const lower = layerId.toLowerCase();
  return (
    reserved.agentBaseNames.has(lower) ||
    reserved.skillFolderNames.has(lower) ||
    reserved.skillFolderNames.has(`skill-${lower}`)
  );
}

function sanitizeFileNameSegment(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Test-only reset for the reserved-namespace cache. */
export function resetCache(): void {
  cache = undefined;
}
