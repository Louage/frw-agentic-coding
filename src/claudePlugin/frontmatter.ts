// src/claudePlugin/frontmatter.ts — must not import "vscode" (WI-5a).
//
// The only module in the emitter allowed to import the `yaml` devDependency
// (D42, refined by D48: build-time only, never bundled into dist/extension.js).
// Enforced by the ESLint `no-restricted-imports` rule in eslint.config.mjs.

import { parse as parseYaml } from "yaml";

/**
 * Splits a Markdown file with a leading `---` YAML frontmatter block into its
 * parsed data and the remaining body text (verbatim, including the leading
 * newline that normally separates the closing `---` from the body).
 *
 * Returns `undefined` when the text has no frontmatter block to parse.
 */
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } | undefined {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return undefined;
  }

  const afterFirstLine = normalized.slice(4);
  const closingIndex = afterFirstLine.indexOf("\n---\n");

  let yamlText: string;
  let body: string;
  if (closingIndex !== -1) {
    yamlText = afterFirstLine.slice(0, closingIndex);
    body = afterFirstLine.slice(closingIndex + 5);
  } else if (afterFirstLine === "---" || afterFirstLine.endsWith("\n---")) {
    yamlText = afterFirstLine.endsWith("\n---") ? afterFirstLine.slice(0, -4) : "";
    body = "";
  } else {
    return undefined;
  }

  const parsed = parseYaml(yamlText);
  const data = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}) ?? {};
  return { data, body };
}

/**
 * Renders a frontmatter object plus body back into Markdown text.
 *
 * Deterministic: the caller controls key order via the object's own
 * (insertion-ordered) keys. Every scalar is rendered as a one-line JSON
 * string literal — valid YAML, and exactly reversible by `parseFrontmatter`
 * (JSON string-literal escaping is a subset of YAML double-quoted-scalar
 * escaping). Output always uses `\n`, and always ends with a trailing
 * newline.
 */
export function renderMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) {
      continue;
    }
    lines.push(`${key}: ${renderScalar(value)}`);
  }
  lines.push("---");

  const normalizedBody = body.replace(/\r\n/g, "\n");
  let text = `${lines.join("\n")}\n${normalizedBody}`;
  if (!text.endsWith("\n")) {
    text += "\n";
  }
  return text;
}

function renderScalar(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => renderScalar(entry)).join(", ")}]`;
  }
  // Objects are not expected for the doc kinds this emitter renders
  // (agents/commands/skills all use flat scalar frontmatter), but fall back
  // to a JSON literal rather than throwing.
  return JSON.stringify(value);
}
