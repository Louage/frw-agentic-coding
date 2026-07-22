export const AGENT_SETTINGS_CONFIG_KEY = "acdc.agents.settings";
export const LEGACY_PLACEHOLDERS_CONFIG_KEY = "acdc.agents.placeholders";

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

export const DEFAULT_PLACEHOLDERS: Readonly<Record<string, string>> = {
  reviewAgent: "AL Code Review Subagent",
  architectAgent: "Angus, AL Architect",
  developerAgent: "Phil, AL Developer",
  conductorAgent: "Malcolm, AL Conductor",
  auditorAgent: "Bon, AL Auditor",
};

export function resolvePlaceholders(text: string, map: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER_RE, (_match, key: string) => map[key] ?? _match);
}

export function findUnknownPlaceholders(
  text: string,
  map: Readonly<Record<string, string>>
): string[] {
  const unknown: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const key = match[1];
    if (!(key in map) && !unknown.includes(key)) {
      unknown.push(key);
    }
  }

  return unknown;
}
