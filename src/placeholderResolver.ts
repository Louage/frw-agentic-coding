import * as vscode from "vscode";

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

/** VS Code configuration key for the user-defined placeholder map. */
const CONFIG_KEY = "acdc.agents.placeholders";

/**
 * Default placeholder → agent name mappings bundled with the extension.
 * Developers can override any key via the `acdc.agents.placeholders` setting.
 */
export const DEFAULT_PLACEHOLDERS: Readonly<Record<string, string>> = {
  reviewAgent: "AL Code Review Subagent",
  architectAgent: "Angus, AL Architect",
  developerAgent: "Phil, AL Developer",
  conductorAgent: "Malcolm, AL Conductor",
  auditorAgent: "Bon, AL Auditor",
};

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
    const userMap = config.get<Record<string, string>>(CONFIG_KEY) ?? {};
    return { ...DEFAULT_PLACEHOLDERS, ...userMap };
  }

  /**
   * Replaces every `${key}` occurrence in `text` with its configured value.
   * Placeholders with no configured or default value are left as `${key}`.
   */
  resolve(text: string): string {
    const map = this.getMap();
    return text.replace(PLACEHOLDER_RE, (_match, key: string) => map[key] ?? _match);
  }

  /**
   * Returns the keys of all `${…}` placeholders found in `text` that are not
   * covered by the current configuration (neither default nor user-set).
   * Used to emit warnings when unknown placeholders are encountered.
   */
  findUnknown(text: string): string[] {
    const map = this.getMap();
    const unknown: string[] = [];
    const re = new RegExp(PLACEHOLDER_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const key = m[1];
      if (!(key in map) && !unknown.includes(key)) {
        unknown.push(key);
      }
    }
    return unknown;
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
