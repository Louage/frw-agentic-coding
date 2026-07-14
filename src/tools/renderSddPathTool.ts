import * as vscode from "vscode";
import { SddConfigResolver, ISddRenderVariables } from "../sddConfigResolver";

/**
 * Input parameters for the render-sdd-path tool.
 * Must match the `inputSchema` declared in package.json.
 */
interface IRenderSddPathInput {
  /** Requirement name in kebab-case (e.g. `customer-loyalty-points`). */
  req_name?: string;
  /** Short slug — defaults to `req_name` when omitted. */
  slug?: string;
  /**
   * Contract type for the spec file. When provided, the tool also renders
   * the target file name and full file path.
   */
  type?: "spec" | "architecture" | "test-plan" | "plan" | "delivery" | string;
  /** Optional sequence number for `{seq}` / `{00seq}` / ... variables. */
  seq?: number;
  /** Optional environment name for `{ENV}`. */
  env?: string;
}

/**
 * Language model tool `frw_render_sdd_path` — renders the workspace-configured
 * spec folder, spec file, and git branch names for a given requirement.
 *
 * Agents must call this instead of hardcoding `.github/plans/{req_name}/…`
 * or branch names.
 */
export class RenderSddPathTool
  implements vscode.LanguageModelTool<IRenderSddPathInput>
{
  private readonly resolver: SddConfigResolver;

  constructor() {
    this.resolver = new SddConfigResolver();
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IRenderSddPathInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const input = options.input ?? {};
    const vars: ISddRenderVariables = {
      req_name: input.req_name,
      slug: input.slug,
      type: input.type,
      seq: input.seq,
      env: input.env,
    };

    const paths = this.resolver.renderPaths(vars);

    const lines: string[] = [
      "# Rendered SDD Paths",
      "",
      "| Kind | Value |",
      "| --- | --- |",
      `| Plans root | \`${paths.plansRoot}\` |`,
      `| Spec folder name | \`${paths.specFolder}\` |`,
      `| Spec folder path | \`${paths.specFolderPath}\` |`,
    ];
    if (paths.specFile && paths.specFilePath) {
      lines.push(`| Spec file name | \`${paths.specFile}\` |`);
      lines.push(`| Spec file path | \`${paths.specFilePath}\` |`);
    }
    if (paths.branch) {
      lines.push(`| Git branch | \`${paths.branch}\` |`);
    }
    lines.push("", "Use these values verbatim when creating folders, files, or branches.");

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(lines.join("\n")),
    ]);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IRenderSddPathInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const label = options.input?.req_name ?? options.input?.slug ?? "the current requirement";
    return {
      invocationMessage: `Rendering SDD paths for "${label}"…`,
    };
  }
}
