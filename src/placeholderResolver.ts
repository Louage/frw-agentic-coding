import * as vscode from "vscode";
import {
  AGENT_SETTINGS_CONFIG_KEY,
  DEFAULT_PLACEHOLDERS,
  LEGACY_PLACEHOLDERS_CONFIG_KEY,
  findUnknownPlaceholders,
  resolvePlaceholders,
} from "./agentPlaceholderUtils";

export { DEFAULT_PLACEHOLDERS };

const PLACEHOLDER_SETTINGS_KEY = AGENT_SETTINGS_CONFIG_KEY;
const LEGACY_KEY = LEGACY_PLACEHOLDERS_CONFIG_KEY;

/**
 * Resolves `${placeholderName}` tokens in text using values from the
 * `acdc.agents.placeholders` VS Code setting, merged over the built-in defaults.
 *
 * Unknown placeholders are left unchanged so callers can detect them.
 *
 * **Usage**: instantiate once and reuse — reads config each call, so it always
 * reflects the current settings without needing a restart.
 */
export class PlaceholderResolver {
  /**
   * Returns the merged placeholder map (user settings merged over defaults).
   * The user-supplied values always win.
   */
  getMap(): Record<string, string> {
    const config = vscode.workspace.getConfiguration();
    const userMap = config.get<Record<string, { placeholderTarget?: string }>>(PLACEHOLDER_SETTINGS_KEY) ?? {};
    const legacyMap = config.get<Record<string, string>>(LEGACY_KEY) ?? {};
    const merged: Record<string, string> = { ...DEFAULT_PLACEHOLDERS, ...legacyMap };

    for (const [key, value] of Object.entries(userMap)) {
      if (value.placeholderTarget) {
        merged[key] = value.placeholderTarget;
      }
    }

    return merged;
  }

  /**
   * Replaces every `${key}` occurrence in `text` with its configured value.
   * Placeholders with no configured or default value are left as `${key}`.
   */
  resolve(text: string): string {
    const map = this.getMap();
    return resolvePlaceholders(text, map);
  }

  /**
   * Returns the keys of all `${…}` placeholders found in `text` that are not
   * covered by the current configuration (neither default nor user-set).
   * Used to emit warnings when unknown placeholders are encountered.
   */
  findUnknown(text: string): string[] {
    const map = this.getMap();
    return findUnknownPlaceholders(text, map);
  }

  /**
   * Validates that all placeholder values in the current map resolve to one
   * of the provided `knownAgentNames`. Returns the set of placeholder keys
   * whose values are not in the known-agents list.
   */
  validateAgainstKnown(knownAgentNames: string[]): Array<{ key: string; value: string }> {
    const map = this.getMap();
    const knownSet = new Set(knownAgentNames.map((n) => n.toLowerCase()));
    const invalid: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(map)) {
      if (!knownSet.has(value.toLowerCase())) {
        invalid.push({ key, value });
      }
    }
    return invalid;
  }
}
