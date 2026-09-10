import * as fs from "fs";
import * as vscode from "vscode";
import {
  AL_EXTENSION_ID,
  resolveAlToolchain,
  type AlToolchain,
} from "./alToolchain";

/**
 * Language model tool `acdc_get_al_toolchain` — reports the AL compiler /
 * `altool` that VS Code actually resolved, so agents never glob
 * `~/.vscode/extensions/ms-dynamics-smb.al-*` for a binary. With several AL
 * versions installed, globbing can pick a compiler that does not match the
 * project's `app.json → runtime`; the reported version makes that checkable
 * before a build instead of after a failed one.
 */
export class GetAlToolchainTool
  implements vscode.LanguageModelTool<Record<string, never>>
{
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const extension = vscode.extensions.getExtension(AL_EXTENSION_ID);
    const resolution = resolveAlToolchain({
      alExtensionPath: extension?.extensionPath,
      platform: process.platform,
      fileExists: (candidate) => fs.existsSync(candidate),
      packageVersion: extension?.packageJSON?.version,
    });

    if (resolution.kind === "no-extension") {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          [
            "# AL toolchain",
            "",
            `The AL Language extension (\`${AL_EXTENSION_ID}\`) is not active in this window.`,
            "There is no compiler to use — ask the user to install/enable it rather than",
            "searching the extensions folder for `alc`.",
          ].join("\n")
        ),
      ]);
    }

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(this.render(resolution.toolchain)),
    ]);
  }

  private render(toolchain: AlToolchain): string {
    return [
      "# AL toolchain (resolved by VS Code — do NOT glob the extensions folder)",
      "",
      "| Field | Value |",
      "| --- | --- |",
      `| \`extensionId\` | \`${toolchain.extensionId}\` |`,
      `| \`version\` | \`${toolchain.version}\` |`,
      `| \`extensionPath\` | \`${toolchain.extensionPath}\` |`,
      `| \`alc\` | ${toolchain.alc ? `\`${toolchain.alc}\`` : "_not found_"} |`,
      `| \`altool\` | ${toolchain.altool ? `\`${toolchain.altool}\`` : "_not found (AL < 17 ships no altool)_"} |`,
      `| \`layout\` | \`${toolchain.layout}\` |`,
      "",
      "This is the **active** AL extension, which is not necessarily the newest one",
      "installed. Before compiling, compare the version above with the project's",
      "`app.json → runtime`: a runtime newer than this compiler cannot build here, and",
      "you should say so instead of running the build.",
    ].join("\n");
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Resolving the AL toolchain…",
    };
  }
}
