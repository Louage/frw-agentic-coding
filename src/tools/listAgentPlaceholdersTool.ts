import * as vscode from "vscode";
import { PlaceholderResolver } from "../placeholderResolver";

/**
 * Language model tool that exposes the current agent placeholder map to AI
 * agents. Agents call this tool to discover which concrete agent/tool names
 * are mapped to well-known role placeholders (e.g. `reviewAgent`,
 * `architectAgent`) in the current workspace configuration.
 *
 * The tool declaration in package.json must match the name
 * `frw_list_agent_placeholders`.
 */
export class ListAgentPlaceholdersTool
  implements vscode.LanguageModelTool<Record<string, never>>
{
  private readonly resolver: PlaceholderResolver;

  constructor() {
    this.resolver = new PlaceholderResolver();
  }

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const map = this.resolver.getMap();

    const lines: string[] = [
      "# Agent Placeholder Mappings",
      "",
      "The following placeholder names are configured for this workspace. " +
        "Use `${placeholderName}` in agent prose, prompts, or skills — the extension " +
        "resolves them to the concrete agent/tool name shown below.",
      "",
      "| Placeholder | Resolves to |",
      "| --- | --- |",
    ];

    for (const [key, value] of Object.entries(map)) {
      lines.push(`| \`\${${key}}\` | ${value} |`);
    }

    lines.push(
      "",
      "_Override any entry via the `acdc.agents.placeholders` VS Code setting._"
    );

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(lines.join("\n")),
    ]);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Reading agent placeholder configuration…",
    };
  }
}
