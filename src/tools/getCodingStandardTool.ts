import * as vscode from "vscode";

/**
 * Input parameters for the get-coding-standard tool.
 * Must match the `inputSchema` declared in package.json.
 */
interface IGetCodingStandardInput {
  topic: string;
}

/**
 * The company coding standards served by this tool.
 *
 * In a real deployment you can replace this in-memory map with content loaded
 * from the bundled `assets/` folder, an internal API, or a Git-backed source.
 */
const CODING_STANDARDS: Record<string, string> = {
  naming: [
    "## FRW naming conventions",
    "- Use descriptive, intention-revealing names.",
    "- Types/classes: `PascalCase`. Functions/variables: `camelCase`. Constants: `UPPER_SNAKE_CASE`.",
    "- Never use single-letter names except for loop indices.",
  ].join("\n"),
  "error-handling": [
    "## FRW error handling",
    "- Validate input only at system boundaries; do not add defensive checks for impossible states.",
    "- Throw typed errors with actionable messages.",
    "- Never swallow exceptions silently; log with context.",
  ].join("\n"),
  logging: [
    "## FRW logging",
    "- Use structured logging (key/value), not string concatenation.",
    "- Never log secrets, tokens, or PII.",
    "- Use levels consistently: error, warn, info, debug.",
  ].join("\n"),
  testing: [
    "## FRW testing",
    "- Every bug fix ships with a regression test.",
    "- Prefer deterministic tests; no reliance on wall-clock time or network unless mocked.",
    "- Name tests by behavior, not implementation.",
  ].join("\n"),
  security: [
    "## FRW security",
    "- Follow the OWASP Top 10; never trust external input.",
    "- No secrets in source control; use the company secret store.",
    "- Use parameterized queries; never build SQL via string concatenation.",
  ].join("\n"),
};

export class GetCodingStandardTool
  implements vscode.LanguageModelTool<IGetCodingStandardInput>
{
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetCodingStandardInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const requested = (options.input.topic ?? "").trim().toLowerCase();
    const available = Object.keys(CODING_STANDARDS);

    const content = CODING_STANDARDS[requested];
    if (!content) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `No FRW coding standard found for "${options.input.topic}". ` +
            `Available topics: ${available.join(", ")}.`
        ),
      ]);
    }

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(content),
    ]);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetCodingStandardInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Looking up the FRW coding standard for "${options.input.topic}"`,
    };
  }
}
