import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { IProvenance } from "./types";

/**
 * Physical layout under `context.globalStorageUri`:
 *
 * ```
 * bcquality-custom/
 *   <layer-id>/
 *     instructions/          # <id>__*.instructions.md  (from custom/knowledge)
 *     skills/                # <id>__<skill>/SKILL.md   (from custom/skills)
 *     provenance.json
 *     .acdc-managed          # sentinel — clean removals only touch marked dirs
 * ```
 *
 * All customer content lives under `bcquality-custom/`. Nothing is ever
 * written into the workspace.
 */
const ROOT_DIR = "bcquality-custom";
const INSTRUCTIONS_SUBDIR = "instructions";
const SKILLS_SUBDIR = "skills";
const PROVENANCE_FILENAME = "provenance.json";
const MARKER_FILENAME = ".acdc-managed";

/** globalStorage root for all custom BCQuality layers. */
export function getRoot(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, ROOT_DIR);
}

export function getLayerDir(context: vscode.ExtensionContext, layerId: string): string {
  return path.join(getRoot(context), layerId);
}

export function getInstructionsDir(
  context: vscode.ExtensionContext,
  layerId: string
): string {
  return path.join(getLayerDir(context, layerId), INSTRUCTIONS_SUBDIR);
}

export function getSkillsDir(
  context: vscode.ExtensionContext,
  layerId: string
): string {
  return path.join(getLayerDir(context, layerId), SKILLS_SUBDIR);
}

/**
 * Aggregate directory the extension exposes via
 * `chat.instructionsFilesLocations` — a symlink-style pointer isn't necessary
 * because VS Code accepts an absolute path. Callers concatenate each layer's
 * instructions subfolder individually.
 */
export function getAllInstructionDirs(context: vscode.ExtensionContext): string[] {
  const root = getRoot(context);
  if (!fs.existsSync(root)) {
    return [];
  }
  const layers = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const dirs: string[] = [];
  for (const id of layers) {
    const dir = getInstructionsDir(context, id);
    if (fs.existsSync(dir)) {
      dirs.push(dir);
    }
  }
  return dirs;
}

/** Full path to the provenance sidecar. */
export function getProvenancePath(
  context: vscode.ExtensionContext,
  layerId: string
): string {
  return path.join(getLayerDir(context, layerId), PROVENANCE_FILENAME);
}

export async function readProvenance(
  context: vscode.ExtensionContext,
  layerId: string
): Promise<IProvenance | undefined> {
  const p = getProvenancePath(context, layerId);
  try {
    const raw = await fs.promises.readFile(p, "utf8");
    return JSON.parse(raw) as IProvenance;
  } catch {
    return undefined;
  }
}

export async function writeProvenance(
  context: vscode.ExtensionContext,
  provenance: IProvenance
): Promise<void> {
  const p = getProvenancePath(context, provenance.layerId);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(provenance, null, 2), "utf8");
}

/** Creates the marker file that authorizes future clean-removals. */
export async function ensureMarker(
  context: vscode.ExtensionContext,
  layerId: string
): Promise<void> {
  const dir = getLayerDir(context, layerId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, MARKER_FILENAME),
    "This directory is managed by AC⚡DC. Do not edit by hand.\n",
    "utf8"
  );
}

/**
 * Refuses to delete a directory that is not marked. Safety net against ever
 * `rm -rf`-ing a path that isn't ours.
 */
export async function removeLayerDir(
  context: vscode.ExtensionContext,
  layerId: string
): Promise<void> {
  const dir = getLayerDir(context, layerId);
  if (!fs.existsSync(dir)) {
    return;
  }
  if (!fs.existsSync(path.join(dir, MARKER_FILENAME))) {
    throw new Error(
      `Refusing to delete "${dir}" — marker file missing. Delete it manually if you are sure.`
    );
  }
  await fs.promises.rm(dir, { recursive: true, force: true });
}

/** Removes every layer subdirectory (used by the "Clear" command). */
export async function removeAllLayers(context: vscode.ExtensionContext): Promise<string[]> {
  const root = getRoot(context);
  if (!fs.existsSync(root)) {
    return [];
  }
  const layers = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const removed: string[] = [];
  for (const id of layers) {
    try {
      await removeLayerDir(context, id);
      removed.push(id);
    } catch {
      // Skip unmanaged folders — they were not created by us.
    }
  }
  return removed;
}
