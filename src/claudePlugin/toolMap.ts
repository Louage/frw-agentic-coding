// src/claudePlugin/toolMap.ts — must not import "vscode" (WI-5a).
//
// D37: emit an explicit allowlist of Claude Code built-in tools only. Anything
// that isn't a VS Code/Copilot built-in with a direct Claude Code equivalent
// (VS Code-only tokens, `acdc_*` LM tools, extension namespaces, MCP server
// namespaces) is dropped and reported, never hardcoded as a Claude tool name.
//
// Reuses the vocabulary in automation/scripts/Normalize-AgentTools.ps1's
// `$CoreTools` (see PROJECT_BRIEF.md §14.5 TOOL_MAP table).

import type { ClaudeToolName } from "./types";

export const TOOL_MAP: ReadonlyArray<{ match: string | RegExp; to: readonly ClaudeToolName[] }> = [
  { match: /^read\/skill$/, to: ["Skill"] },
  { match: /^(read|read\/readFile|read\/viewImage)$/, to: ["Read"] },
  {
    match: /^(search|search\/codebase|search\/textSearch|search\/fileSearch|search\/listDirectory|search\/usages)$/,
    to: ["Grep", "Glob"],
  },
  {
    match: /^(edit|edit\/editFiles|edit\/createFile|edit\/createDirectory|edit\/rename)$/,
    to: ["Edit", "Write"],
  },
  {
    match: /^(execute|execute\/runInTerminal|execute\/getTerminalOutput)$/,
    to: ["Bash", "PowerShell"],
  },
  { match: /^(web|web\/fetch|web\/githubTextSearch)$/, to: ["WebFetch", "WebSearch"] },
  { match: /^(agent|search\/searchSubagent)$/, to: ["Agent"] },
  { match: /^todo$/, to: ["TodoWrite"] },
];

/** Canonical output order for every mapped tools list (§14.5). */
export const CANONICAL_TOOL_ORDER: readonly ClaudeToolName[] = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash",
  "PowerShell",
  "WebFetch",
  "WebSearch",
  "Agent",
  "Skill",
  "TodoWrite",
];

function matches(rule: { match: string | RegExp }, token: string): boolean {
  return typeof rule.match === "string" ? rule.match === token : rule.match.test(token);
}

/**
 * Maps a Copilot chat-mode tool token list onto the Claude Code built-in
 * allowlist. De-duplicated, in canonical order. Anything that maps to no
 * TOOL_MAP row (VS Code-only tokens, `acdc_*`, extension namespaces like
 * `ms-dynamics-smb.al/*`, MCP namespaces like `github/*`) is reported in
 * `dropped`, verbatim, in input order.
 */
export function mapTools(tokens: readonly string[]): { tools: ClaudeToolName[]; dropped: string[] } {
  const matched = new Set<ClaudeToolName>();
  const dropped: string[] = [];

  for (const token of tokens) {
    const rule = TOOL_MAP.find((candidate) => matches(candidate, token));
    if (rule) {
      for (const tool of rule.to) {
        matched.add(tool);
      }
    } else {
      dropped.push(token);
    }
  }

  const tools = CANONICAL_TOOL_ORDER.filter((tool) => matched.has(tool));
  return { tools, dropped };
}

/**
 * Maps a Copilot model display string onto a Claude Code model alias.
 * Anything that doesn't mention sonnet/opus/haiku (GPT, Gemini, …) or is
 * absent maps to `undefined` (inherit).
 */
export function mapModel(copilotModel: string | undefined): "sonnet" | "opus" | "haiku" | undefined {
  if (!copilotModel) {
    return undefined;
  }
  if (/sonnet/i.test(copilotModel)) {
    return "sonnet";
  }
  if (/opus/i.test(copilotModel)) {
    return "opus";
  }
  if (/haiku/i.test(copilotModel)) {
    return "haiku";
  }
  return undefined;
}
