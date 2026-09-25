// src/claudePlugin/emitCli.ts — node-only (fs, no "vscode"). WI-5a, D32.
//
// Thin CLI: read inputs → planPluginSurface() → write, or --check the drift
// gate. Built by a second esbuild entry to out-tools/emit-claude-plugin.cjs
// (platform node, never bundled into dist/extension.js, never imported by
// src/extension.ts). Must run on Node 20 (CI).

import fs from "node:fs";
import path from "node:path";
import { planPluginSurface } from "./planPluginSurface";
import type { PlannedFile, PluginSurfaceInput, RelPath } from "./types";

const REPO_ROOT = path.resolve(__dirname, "..");

function toPosix(relPath: string): RelPath {
  return relPath.split(path.sep).join("/");
}

function stripLeadingDotSlash(p: string): RelPath {
  return p.startsWith("./") ? p.slice(2) : p;
}

function absFromRel(relPath: RelPath): string {
  return path.join(REPO_ROOT, ...relPath.split("/"));
}

function walkFiles(absDir: string): string[] {
  if (!fs.existsSync(absDir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(abs));
    } else if (entry.isFile()) {
      results.push(abs);
    }
  }
  return results;
}

function readPackageJson(): {
  contributes: { chatAgents?: { path: string }[]; chatPromptFiles?: { path: string }[]; chatSkills?: { path: string }[] };
  name: string;
  displayName?: string;
  description?: string;
  publisher: string;
  license?: string;
  repository?: string | { url?: string };
} {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
  return JSON.parse(raw);
}

function buildInput(): PluginSurfaceInput {
  const pkg = readPackageJson();
  const contributions = {
    agents: (pkg.contributes.chatAgents ?? []).map((entry) => stripLeadingDotSlash(entry.path)),
    prompts: (pkg.contributes.chatPromptFiles ?? []).map((entry) => stripLeadingDotSlash(entry.path)),
    skills: (pkg.contributes.chatSkills ?? []).map((entry) => stripLeadingDotSlash(entry.path)),
  };

  const files = new Map<RelPath, string>();
  const addFile = (relPath: RelPath): void => {
    if (files.has(relPath)) {
      return;
    }
    const abs = absFromRel(relPath);
    if (!fs.existsSync(abs)) {
      return; // planPluginSurface reports missing-source; the CLI doesn't throw here.
    }
    files.set(relPath, fs.readFileSync(abs, "utf8"));
  };

  for (const relPath of [...contributions.agents, ...contributions.prompts]) {
    addFile(relPath);
  }
  for (const skillPath of contributions.skills) {
    addFile(skillPath);
    const absDir = absFromRel(path.posix.dirname(skillPath));
    for (const abs of walkFiles(absDir)) {
      addFile(toPosix(path.relative(REPO_ROOT, abs)));
    }
  }

  const repositoryUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;

  return {
    packageMeta: {
      name: pkg.name,
      displayName: pkg.displayName,
      description: pkg.description,
      publisher: pkg.publisher,
      license: pkg.license,
      repositoryUrl,
    },
    contributions,
    files,
  };
}

function writePlannedFile(file: PlannedFile): void {
  const abs = absFromRel(file.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (typeof file.content === "string") {
    fs.writeFileSync(abs, file.content, "utf8");
  } else {
    fs.writeFileSync(abs, Buffer.from(file.content));
  }
}

function pruneEmptyDirs(absDir: string, isManagedRoot: boolean): void {
  if (!fs.existsSync(absDir)) {
    return;
  }
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      pruneEmptyDirs(path.join(absDir, entry.name), false);
    }
  }
  if (!isManagedRoot && fs.readdirSync(absDir).length === 0) {
    fs.rmdirSync(absDir);
  }
}

function printDiagnostics(diagnostics: readonly { level: string; source: string; code: string; message: string }[]): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "info") {
      continue;
    }
    const line = `[${diagnostic.level}] ${diagnostic.code} ${diagnostic.source}: ${diagnostic.message}`;
    if (diagnostic.level === "error") {
      console.error(line);
    } else {
      console.warn(line);
    }
  }
}

function runWrite(): number {
  const input = buildInput();
  const plan = planPluginSurface(input);

  printDiagnostics(plan.diagnostics);
  for (const file of plan.files) {
    writePlannedFile(file);
  }

  const plannedPaths = new Set(plan.files.map((file) => file.path));
  for (const root of plan.managedRoots) {
    const absRoot = absFromRel(root);
    for (const abs of walkFiles(absRoot)) {
      const relPath = toPosix(path.relative(REPO_ROOT, abs));
      if (!plannedPaths.has(relPath)) {
        fs.unlinkSync(abs);
      }
    }
    pruneEmptyDirs(absRoot, true);
  }

  console.log(
    `[emit-claude-plugin] agents=${plan.counts.agents} commands=${plan.counts.commands} skills=${plan.counts.skills} files=${plan.files.length}`,
  );

  return plan.diagnostics.some((d) => d.level === "error") ? 1 : 0;
}

function contentsEqual(planned: string | Uint8Array, onDisk: string | Uint8Array): boolean {
  if (typeof planned === "string" || typeof onDisk === "string") {
    const a = typeof planned === "string" ? planned.replace(/\r\n/g, "\n") : Buffer.from(planned).toString("utf8").replace(/\r\n/g, "\n");
    const b = typeof onDisk === "string" ? onDisk.replace(/\r\n/g, "\n") : Buffer.from(onDisk).toString("utf8").replace(/\r\n/g, "\n");
    return a === b;
  }
  return Buffer.compare(Buffer.from(planned), Buffer.from(onDisk)) === 0;
}

function runCheck(): number {
  const input = buildInput();
  const plan = planPluginSurface(input);
  printDiagnostics(plan.diagnostics);

  const problems: string[] = [];
  const plannedPaths = new Set(plan.files.map((file) => file.path));

  for (const file of plan.files) {
    const abs = absFromRel(file.path);
    if (!fs.existsSync(abs)) {
      problems.push(`missing: ${file.path}`);
      continue;
    }
    const onDisk: string | Uint8Array = typeof file.content === "string" ? fs.readFileSync(abs, "utf8") : fs.readFileSync(abs);
    if (!contentsEqual(file.content, onDisk)) {
      problems.push(`changed: ${file.path}`);
    }
  }

  for (const root of plan.managedRoots) {
    const absRoot = absFromRel(root);
    for (const abs of walkFiles(absRoot)) {
      const relPath = toPosix(path.relative(REPO_ROOT, abs));
      if (!plannedPaths.has(relPath)) {
        problems.push(`extra: ${relPath}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error("[emit-claude-plugin] --check found drift:");
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
  } else {
    console.log(
      `[emit-claude-plugin] --check OK: agents=${plan.counts.agents} commands=${plan.counts.commands} skills=${plan.counts.skills}`,
    );
  }

  const hasError = plan.diagnostics.some((d) => d.level === "error");
  return problems.length > 0 || hasError ? 1 : 0;
}

function main(): void {
  const check = process.argv.includes("--check");
  const exitCode = check ? runCheck() : runWrite();
  process.exit(exitCode);
}

main();
