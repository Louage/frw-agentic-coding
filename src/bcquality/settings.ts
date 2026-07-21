import * as vscode from "vscode";
import { ICustomLayerEntry } from "./types";

const CONFIG_SECTION = "acdc.bcquality";
const LAYERS_KEY = "customLayers";
const SYNC_ON_STARTUP_KEY = "syncOnStartup";
const REGISTER_INSTRUCTIONS_LOCATION_KEY = "registerInstructionsFileLocation";

/**
 * Layer-id pattern MUST stay in sync with the `pattern` on the JSON schema in
 * package.json — validation here is the runtime enforcement (schema warnings
 * are non-blocking).
 */
export const LAYER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** Reads and normalizes every `acdc.bcquality.customLayers` entry. */
export function getCustomLayers(): ICustomLayerEntry[] {
  const raw =
    vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<Array<Partial<ICustomLayerEntry>>>(LAYERS_KEY, []) ?? [];
  return raw.map(normalizeEntry);
}

/**
 * Persists an updated layer array back to `acdc.bcquality.customLayers` at
 * user-scope. The panel calls this on Save / Save & Sync so the settings.json
 * stays canonical; the sync engine subsequently re-reads it via getCustomLayers.
 *
 * The stored shape drops empty optional fields to keep settings.json tidy.
 */
export async function saveCustomLayers(
  layers: ICustomLayerEntry[]
): Promise<void> {
  const persisted = layers.map((raw) => {
    const entry = normalizeEntry(raw);
    const out: Record<string, unknown> = {
      id: entry.id,
      repository: entry.repository,
      enabled: entry.enabled,
    };
    if (entry.name && entry.name !== entry.id) {
      out.name = entry.name;
    }
    if (entry.ref) {
      out.ref = entry.ref;
    }
    if (entry.tokenSecretKey) {
      out.tokenSecretKey = entry.tokenSecretKey;
    }
    return out;
  });
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(LAYERS_KEY, persisted, vscode.ConfigurationTarget.Global);
}

export function isSyncOnStartupEnabled(): boolean {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>(SYNC_ON_STARTUP_KEY, false);
}

export function shouldRegisterInstructionsLocation(): boolean {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>(REGISTER_INSTRUCTIONS_LOCATION_KEY, true);
}

function normalizeEntry(entry: Partial<ICustomLayerEntry>): ICustomLayerEntry {
  return {
    id: (entry.id ?? "").trim().toLowerCase(),
    name: (entry.name ?? "").trim() || (entry.id ?? "").trim(),
    repository: (entry.repository ?? "").trim(),
    ref: (entry.ref ?? "").trim(),
    tokenSecretKey: (entry.tokenSecretKey ?? "").trim(),
    enabled: Boolean(entry.enabled),
  };
}

/** Validation result for one entry. */
export interface IEntryValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Structural validation of a single entry (id shape, url presence). Does NOT
 * check reserved-namespace collisions — that lives in `namespace.ts` because it
 * needs the extension's bundled asset tree.
 */
export function validateEntry(entry: ICustomLayerEntry): IEntryValidation {
  if (!entry.id) {
    return { ok: false, reason: "Layer id is required." };
  }
  if (!LAYER_ID_PATTERN.test(entry.id)) {
    return {
      ok: false,
      reason: `Layer id "${entry.id}" is invalid — must match ${LAYER_ID_PATTERN}.`,
    };
  }
  if (!entry.repository) {
    return { ok: false, reason: `Layer "${entry.id}" is missing a repository URL.` };
  }
  return { ok: true };
}

/** Detects duplicate ids across the current layers array. */
export function findDuplicateIds(layers: ICustomLayerEntry[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const layer of layers) {
    if (!layer.id) {
      continue;
    }
    if (seen.has(layer.id)) {
      dupes.add(layer.id);
    }
    seen.add(layer.id);
  }
  return [...dupes];
}
