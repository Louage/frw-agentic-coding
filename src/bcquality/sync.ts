import * as vscode from "vscode";
import { downloadFork, resolveRemoteSha } from "./download";
import { computeReservedNamespaces, isLayerIdReserved } from "./namespace";
import {
  ensureMarker,
  getInstructionsDir,
  getSkillsDir,
  readProvenance,
  removeLayerDir,
  writeProvenance,
} from "./storage";
import {
  findDuplicateIds,
  getCustomLayers,
  isSyncOnStartupEnabled,
  shouldRegisterInstructionsLocation,
  validateEntry,
} from "./settings";
import { transformLayer } from "./transform";
import { registerInstructionsLocations } from "./instructionsLocation";
import { ICustomLayerEntry, ILayerSyncResult, IProvenance } from "./types";

/**
 * End-to-end orchestrator: for every enabled custom layer, resolves the remote
 * SHA, decides whether to skip (already installed) or (re)install, clones,
 * transforms, writes to globalStorage, and updates provenance.
 *
 * Always safe to call — a layer whose SHA is unchanged is a no-op.
 */
export async function syncCustomLayers(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  options: { promptOnFirstInstall: boolean }
): Promise<ILayerSyncResult[]> {
  const layers = getCustomLayers();
  const reserved = computeReservedNamespaces(context.extensionUri);
  const dupes = findDuplicateIds(layers);
  if (dupes.length > 0) {
    output.appendLine(
      `[bcquality] Duplicate layer ids detected: ${dupes.join(", ")}. Fix them in "acdc.bcquality.customLayers".`
    );
  }

  const results: ILayerSyncResult[] = [];
  for (const layer of layers) {
    if (!layer.enabled) {
      results.push({ layer, outcome: "skipped-disabled" });
      continue;
    }
    const structural = validateEntry(layer);
    if (!structural.ok) {
      output.appendLine(`[bcquality] Skipping "${layer.id || "(no id)"}": ${structural.reason}`);
      results.push({ layer, outcome: "error", message: structural.reason });
      continue;
    }
    if (isLayerIdReserved(layer.id, reserved)) {
      const reason = `Layer id "${layer.id}" collides with a bundled namespace. Rename it.`;
      output.appendLine(`[bcquality] ${reason}`);
      results.push({ layer, outcome: "error", message: reason });
      continue;
    }
    try {
      results.push(await syncOneLayer(context, layer, output, options));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.appendLine(`[bcquality] "${layer.id}" failed: ${message}`);
      results.push({ layer, outcome: "error", message });
    }
  }

  // Update chat.instructionsFilesLocations pointer (best-effort, guarded by
  // the user's setting + one-time consent inside the registrar).
  if (shouldRegisterInstructionsLocation()) {
    try {
      await registerInstructionsLocations(context, output);
    } catch (err) {
      output.appendLine(
        `[bcquality] Failed to register instructions location: ${(err as Error).message}`
      );
    }
  }

  return results;
}

async function syncOneLayer(
  context: vscode.ExtensionContext,
  layer: ICustomLayerEntry,
  output: vscode.OutputChannel,
  options: { promptOnFirstInstall: boolean }
): Promise<ILayerSyncResult> {
  const token = await resolveToken(context, layer);

  // Short-circuit: if the resolved SHA equals what's on disk, do nothing.
  const remoteSha = await resolveRemoteSha(layer, token);
  const existing = await readProvenance(context, layer.id);
  if (remoteSha && existing && existing.sha === remoteSha) {
    return {
      layer,
      outcome: "up-to-date",
      sha: existing.sha,
      instructionsCount: existing.instructionsCount,
      skillsCount: existing.skillsCount,
    };
  }

  // First-time install: ask for consent unless the user launched the sync
  // manually (promptOnFirstInstall = false when running from the command).
  if (!existing && options.promptOnFirstInstall) {
    const confirm = await vscode.window.showInformationMessage(
      `AC⚡DC is about to import the BCQuality custom layer "${layer.name || layer.id}" from ${layer.repository}. ` +
        `Only files under the fork's custom/ folder will be copied into extension globalStorage. Continue?`,
      { modal: true },
      "Install",
      "Cancel"
    );
    if (confirm !== "Install") {
      return { layer, outcome: "declined" };
    }
  }

  const fork = await downloadFork(layer, token, output);
  try {
    const reserved = computeReservedNamespaces(context.extensionUri);
    // Always wipe the layer folder before re-installing to avoid leftover
    // stale files from a previous version of the fork.
    await removeLayerDir(context, layer.id).catch(() => {
      // Marker missing / directory absent — safe to continue.
    });
    await ensureMarker(context, layer.id);
    const instructionsDir = getInstructionsDir(context, layer.id);
    const skillsDir = getSkillsDir(context, layer.id);

    const transformResult = await transformLayer({
      forkRoot: fork.workingRoot,
      destinationInstructionsDir: instructionsDir,
      destinationSkillsDir: skillsDir,
      layer,
      sha: fork.sha,
      reserved,
    });

    const provenance: IProvenance = {
      layerId: layer.id,
      repository: layer.repository,
      ref: layer.ref || "main",
      sha: fork.sha,
      syncedAt: new Date().toISOString(),
      instructionsCount: transformResult.instructionsCount,
      skillsCount: transformResult.skillsCount,
      license: fork.license,
    };
    await writeProvenance(context, provenance);

    for (const skipped of transformResult.skipped) {
      output.appendLine(`[bcquality] "${layer.id}" skipped ${skipped.path}: ${skipped.reason}`);
    }
    output.appendLine(
      `[bcquality] "${layer.id}" installed @${fork.sha.slice(0, 12)} — ` +
        `${transformResult.instructionsCount} rule(s), ${transformResult.skillsCount} skill(s).`
    );
    return {
      layer,
      outcome: "installed",
      sha: fork.sha,
      instructionsCount: transformResult.instructionsCount,
      skillsCount: transformResult.skillsCount,
    };
  } finally {
    await fork.dispose();
  }
}

async function resolveToken(
  context: vscode.ExtensionContext,
  layer: ICustomLayerEntry
): Promise<string | undefined> {
  if (!layer.tokenSecretKey) {
    return undefined;
  }
  try {
    return await context.secrets.get(layer.tokenSecretKey);
  } catch {
    return undefined;
  }
}

/**
 * Startup hook. Cheap when `syncOnStartup` is off (bails before touching git);
 * with it on, performs a full pass but silently skips first-install prompts —
 * unattended startup should never popup a modal.
 */
export async function syncCustomLayersOnStartup(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  if (!isSyncOnStartupEnabled()) {
    return;
  }
  const layers = getCustomLayers().filter((l) => l.enabled);
  if (layers.length === 0) {
    return;
  }
  // Startup: never popup. Layers that have never been installed will show
  // "declined" here; the user has to run the command once to accept.
  const results = await syncCustomLayers(context, output, {
    promptOnFirstInstall: false,
  });
  const errors = results.filter((r) => r.outcome === "error").length;
  const declined = results.filter((r) => r.outcome === "declined").length;
  if (errors > 0 || declined > 0) {
    output.appendLine(
      `[bcquality] Startup sync summary: ${errors} error(s), ${declined} awaiting first-run consent. ` +
        `Run "AC/DC: Sync BCQuality Custom Layers" to accept and finish install.`
    );
  }
}
