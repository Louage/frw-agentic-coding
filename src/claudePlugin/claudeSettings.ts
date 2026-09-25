// src/claudePlugin/claudeSettings.ts — must not import "vscode" (WI-5a, revised by D54, PROJECT_BRIEF.md §14.6).
//
// Pure read-modify-write decisions for the user's `~/.claude/settings.json`
// (or `$CLAUDE_CONFIG_DIR/settings.json`). This module never touches the
// filesystem: it takes the current file's raw text (or `undefined` if it
// doesn't exist) and returns either a `next` text to write, or a reason the
// write was skipped. The thin adapter (`registration.ts`) does the actual
// read, atomic write and `vscode` calls.
//
// Hard safety rules enforced here (see PROJECT_BRIEF.md §14.11 risks table):
//   - never clobber on a parse error or an unexpected shape (`skip: "unparseable" | "not-an-object"`)
//   - preserve every foreign key, its value and its position (R2, R13)
//   - preserve the file's original indent, EOL and final-newline style (R13)
//   - never flip a user's `enabledPlugins["acdc@acdc-vscode"] === false` (R6)
//   - never touch the legacy `aldc@aldc-marketplace` entry (D41, R12)
//   - idempotent: report `skip: "up-to-date"` (no `next`) when nothing changed (R3/R4/R11)

import { win32, posix } from "path";

export const ACDC_MARKETPLACE = "acdc-vscode";
export const ACDC_PLUGIN_KEY = "acdc@acdc-vscode";
export const LEGACY_PLUGIN_KEY = "aldc@aldc-marketplace";

export interface RegistrationOptions {
  platform: NodeJS.Platform; // path comparison (win32: case-insensitive, \ ≡ /)
  force: boolean; // true only from the explicit Register command
}

export type SkipReason = "up-to-date" | "unparseable" | "not-an-object" | "user-managed-path";
export type RegistrationChange = "settings-created" | "marketplace-added" | "marketplace-path-updated" | "plugin-enabled";
export type RegistrationNotice = "legacy-aldc-enabled" | "plugin-disabled-by-user" | "known-location-needs-reset";

export type SettingsUpdateResult =
  | { changed: true; next: string; changes: RegistrationChange[]; notices: RegistrationNotice[] }
  | { changed: false; skip: SkipReason; notices: RegistrationNotice[] };

export type RegistrationGate = { proceed: true } | { proceed: false; reason: "no-config-dir" | "disabled-by-setting" };

// ---------------------------------------------------------------------------
// Small JSON helpers (no library: D42 keeps settings handling on plain JSON).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First indented line's leading whitespace, used as the `space` argument to `JSON.stringify` so re-serialising doesn't change the file's indent style. */
function detectIndent(raw: string): string {
  const match = /\n([ \t]+)\S/.exec(raw);
  return match ? match[1] : "  ";
}

function detectEol(raw: string): "\r\n" | "\n" {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

function hasFinalNewline(raw: string): boolean {
  return raw.endsWith("\n");
}

/** Serialises `value`, matching `original`'s indent, EOL and final-newline style exactly (R13). */
function serializeLike(original: string, value: unknown): string {
  const indent = detectIndent(original);
  const eol = detectEol(original);
  const finalNewline = hasFinalNewline(original);
  return serializeWith(value, indent, eol, finalNewline);
}

function serializeWith(value: unknown, indent: string, eol: "\r\n" | "\n", finalNewline: boolean): string {
  const json = JSON.stringify(value, null, indent);
  const withEol = eol === "\r\n" ? json.replace(/\n/g, "\r\n") : json;
  return finalNewline ? withEol + eol : withEol;
}

// ---------------------------------------------------------------------------
// Path helpers shared with marketplaceLink.ts
// ---------------------------------------------------------------------------

/** Case-insensitive and `\`≡`/`-insensitive on win32 (trailing separators ignored); exact on other platforms (R4). */
export function pathsEqual(a: string, b: string, platform: NodeJS.Platform): boolean {
  const normalize = (value: string): string => {
    let normalized = value.replace(/[\\/]+$/, "");
    normalized = normalized.replace(/[\\/]+/g, "/");
    if (platform === "win32") {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  };
  return normalize(a) === normalize(b);
}

const VERSIONED_EXTENSION_DIR = /^theframework\.acdc-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/;

/** `"…/theframework.acdc-2.8.1"` -> `"2.8.1"`. Anything else (a dev clone, a differently-named folder) -> `undefined` (R20). */
export function versionFromExtensionDir(p: string): string | undefined {
  const trimmed = p.replace(/[\\/]+$/, "");
  const basename = trimmed.split(/[\\/]/).pop() ?? "";
  const match = VERSIONED_EXTENSION_DIR.exec(basename);
  return match ? match[1] : undefined;
}

export function resolveClaudeConfigDir(env: Record<string, string | undefined>, homedir: string, platform: NodeJS.Platform): string {
  const override = env["CLAUDE_CONFIG_DIR"];
  if (override) {
    return override;
  }
  const p = platform === "win32" ? win32 : posix;
  return p.join(homedir, ".claude");
}

export function decideRegistrationGate(input: { configDirExists: boolean; autoRegister: boolean; force: boolean }): RegistrationGate {
  if (!input.configDirExists) {
    // Force never creates ~/.claude (R16): checked before the setting, and never bypassed.
    return { proceed: false, reason: "no-config-dir" };
  }
  if (!input.autoRegister && !input.force) {
    return { proceed: false, reason: "disabled-by-setting" };
  }
  return { proceed: true };
}

/** Lenient read used for diagnostics/UI: never throws, returns `undefined` for anything it can't confidently read. */
export function readRegisteredMarketplacePath(current: string | undefined): string | undefined {
  if (current === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(current);
    if (!isPlainObject(parsed)) {
      return undefined;
    }
    const marketplaces = parsed[EXTRA_KNOWN_MARKETPLACES_KEY];
    if (!isPlainObject(marketplaces)) {
      return undefined;
    }
    const entry = marketplaces[ACDC_MARKETPLACE];
    if (!isPlainObject(entry)) {
      return undefined;
    }
    const source = entry["source"];
    if (!isPlainObject(source) || source["source"] !== "directory") {
      return undefined;
    }
    const pathValue = source["path"];
    return typeof pathValue === "string" ? pathValue : undefined;
  } catch {
    return undefined;
  }
}

const EXTRA_KNOWN_MARKETPLACES_KEY = "extraKnownMarketplaces";
const ENABLED_PLUGINS_KEY = "enabledPlugins";

function replaceMarketplaceEntry(entry: unknown, stablePath: string): Record<string, unknown> {
  const entryObj: Record<string, unknown> = isPlainObject(entry) ? { ...entry } : {};
  const sourceObj: Record<string, unknown> = isPlainObject(entryObj["source"]) ? { ...(entryObj["source"] as Record<string, unknown>) } : {};
  sourceObj["source"] = "directory";
  sourceObj["path"] = stablePath;
  entryObj["source"] = sourceObj;
  return entryObj;
}

/**
 * `stablePath` = `resolveStableMarketplacePath(...)`. It is the ONLY path this
 * function ever writes (§14.6). Rules, in order (unchanged unless noted):
 *   1. no file yet -> create with only our two keys.
 *   2. parse error (incl. JSONC) or a non-object root/`extraKnownMarketplaces`/`enabledPlugins` -> skip, never write.
 *   3. our marketplace entry: missing -> add; already `stablePath` -> untouched; an owned versioned
 *      extension dir -> replaced + `known-location-needs-reset`; anything else -> `user-managed-path`
 *      unless `force` -> replaced (same notice). Sibling fields of the entry (e.g. `autoUpdate`) are kept.
 *   4. `enabledPlugins[ACDC_PLUGIN_KEY]`: unset -> `true`; `false` -> left alone + notice; `true` -> untouched.
 *   5. legacy `aldc@aldc-marketplace` enabled -> notice only, never modified (D41).
 *   6. nothing changed -> `skip: "up-to-date"` (no write, no mtime change).
 *   7. serialised in the original indent/EOL/final-newline style; key order preserved, new keys appended.
 */
export function computeClaudeSettingsUpdate(current: string | undefined, stablePath: string, opts: RegistrationOptions): SettingsUpdateResult {
  if (current === undefined) {
    const created = {
      [EXTRA_KNOWN_MARKETPLACES_KEY]: {
        [ACDC_MARKETPLACE]: { source: { source: "directory", path: stablePath } },
      },
      [ENABLED_PLUGINS_KEY]: { [ACDC_PLUGIN_KEY]: true },
    };
    const next = serializeWith(created, "  ", "\n", true);
    return { changed: true, next, changes: ["settings-created"], notices: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(current);
  } catch {
    return { changed: false, skip: "unparseable", notices: [] };
  }
  if (!isPlainObject(parsed)) {
    return { changed: false, skip: "not-an-object", notices: [] };
  }

  const existingMarketplaces = parsed[EXTRA_KNOWN_MARKETPLACES_KEY];
  if (existingMarketplaces !== undefined && !isPlainObject(existingMarketplaces)) {
    return { changed: false, skip: "not-an-object", notices: [] };
  }
  const existingEnabledPlugins = parsed[ENABLED_PLUGINS_KEY];
  if (existingEnabledPlugins !== undefined && !isPlainObject(existingEnabledPlugins)) {
    return { changed: false, skip: "not-an-object", notices: [] };
  }

  const notices: RegistrationNotice[] = [];
  const changes: RegistrationChange[] = [];
  let mutated = false;

  const marketplaces: Record<string, unknown> = isPlainObject(existingMarketplaces) ? { ...existingMarketplaces } : {};
  const entry = marketplaces[ACDC_MARKETPLACE];

  if (entry === undefined) {
    marketplaces[ACDC_MARKETPLACE] = { source: { source: "directory", path: stablePath } };
    mutated = true;
    changes.push("marketplace-added");
  } else {
    const entrySource = isPlainObject(entry) ? entry["source"] : undefined;
    const entryPath = isPlainObject(entrySource) ? entrySource["path"] : undefined;
    const isDirectorySource = isPlainObject(entrySource) && entrySource["source"] === "directory" && typeof entryPath === "string";

    if (isDirectorySource && pathsEqual(entryPath as string, stablePath, opts.platform)) {
      // Already up to date — untouched.
    } else {
      const isOwnedVersionedDir = isDirectorySource && versionFromExtensionDir(entryPath as string) !== undefined;
      if (isOwnedVersionedDir || opts.force) {
        marketplaces[ACDC_MARKETPLACE] = replaceMarketplaceEntry(entry, stablePath);
        mutated = true;
        changes.push("marketplace-path-updated");
        notices.push("known-location-needs-reset");
      } else {
        return { changed: false, skip: "user-managed-path", notices: [] };
      }
    }
  }

  const enabledPlugins: Record<string, unknown> = isPlainObject(existingEnabledPlugins) ? { ...existingEnabledPlugins } : {};
  const currentEnabledValue = enabledPlugins[ACDC_PLUGIN_KEY];
  if (currentEnabledValue === undefined) {
    enabledPlugins[ACDC_PLUGIN_KEY] = true;
    mutated = true;
    changes.push("plugin-enabled");
  } else if (currentEnabledValue === false) {
    notices.push("plugin-disabled-by-user");
  }

  if (isPlainObject(existingEnabledPlugins) && existingEnabledPlugins[LEGACY_PLUGIN_KEY] === true) {
    notices.push("legacy-aldc-enabled");
  }

  if (!mutated) {
    return { changed: false, skip: "up-to-date", notices };
  }

  const next: Record<string, unknown> = { ...parsed };
  next[EXTRA_KNOWN_MARKETPLACES_KEY] = marketplaces;
  next[ENABLED_PLUGINS_KEY] = enabledPlugins;

  return { changed: true, next: serializeLike(current, next), changes, notices };
}

/** Removes only our own keys. Everything else, including the legacy `aldc` entry, is untouched (D41, R18). */
export function computeClaudeSettingsRemoval(current: string | undefined): SettingsUpdateResult {
  if (current === undefined) {
    return { changed: false, skip: "up-to-date", notices: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(current);
  } catch {
    return { changed: false, skip: "unparseable", notices: [] };
  }
  if (!isPlainObject(parsed)) {
    return { changed: false, skip: "not-an-object", notices: [] };
  }

  const marketplaces = parsed[EXTRA_KNOWN_MARKETPLACES_KEY];
  const enabledPlugins = parsed[ENABLED_PLUGINS_KEY];
  const next: Record<string, unknown> = { ...parsed };
  let mutated = false;

  if (isPlainObject(marketplaces) && ACDC_MARKETPLACE in marketplaces) {
    const nextMarketplaces = { ...marketplaces };
    delete nextMarketplaces[ACDC_MARKETPLACE];
    next[EXTRA_KNOWN_MARKETPLACES_KEY] = nextMarketplaces;
    mutated = true;
  }
  if (isPlainObject(enabledPlugins) && ACDC_PLUGIN_KEY in enabledPlugins) {
    const nextEnabledPlugins = { ...enabledPlugins };
    delete nextEnabledPlugins[ACDC_PLUGIN_KEY];
    next[ENABLED_PLUGINS_KEY] = nextEnabledPlugins;
    mutated = true;
  }

  if (!mutated) {
    return { changed: false, skip: "up-to-date", notices: [] };
  }

  return { changed: true, next: serializeLike(current, next), changes: [], notices: [] };
}
