import * as vscode from "vscode";
import { SddConfigResolver } from "../sddConfigResolver";

/**
 * Language model tool `frw_get_sdd_config` — returns the current
 * spec-driven-development path/naming configuration to AI agents, so they
 * can honour the workspace's plans-folder and naming conventions instead of
 * hardcoding `.github/plans/`, folder shapes, or branch names.
 *
 * Agents should call this tool ONCE at the start of any task that creates
 * (or references) spec folders, spec files, or git branches.
 */
export class GetSddConfigTool
  implements vscode.LanguageModelTool<Record<string, never>>
{
  private readonly resolver: SddConfigResolver;

  constructor() {
    this.resolver = new SddConfigResolver();
  }

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const snapshot = this.resolver.getSnapshot();

    const lines: string[] = [
      "# SDD (Spec-Driven Development) Configuration",
      "",
      "The current workspace resolves spec folders, spec file names, and git",
      "branch names as follows. **Read this before creating any folder, file,",
      "or branch.** Use the `frw_render_sdd_path` tool to render concrete",
      "paths — do NOT hardcode `.github/plans/` or naming shapes.",
      "",
      "| Setting | Value |",
      "| --- | --- |",
      `| \`acdc.plansRoot\` | \`${snapshot.plansRoot}\` |`,
      `| \`acdc.specFolderFormat\` | \`${snapshot.specFolderFormat}\` |`,
      `| \`acdc.specFileFormat\` | \`${snapshot.specFileFormat}\` |`,
      `| \`acdc.branchFormat\` | \`${snapshot.branchFormat}\` |`,
      "",
      this.resolver.variableReferenceMarkdown(),
      "",
      "_Override any of the above via VS Code settings (`acdc.*`)._",
    ];

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(lines.join("\n")),
    ]);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Reading SDD path/naming configuration…",
    };
  }
}
