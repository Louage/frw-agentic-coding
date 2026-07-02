import * as vscode from "vscode";

/**
 * Input parameters for the get-coding-standard tool.
 * Must match the `inputSchema` declared in package.json.
 */
interface IGetCodingStandardInput {
  topic: string;
}

/**
 * Serves the company's AL coding standards directly from the extension's bundled
 * `assets/generated/aldc-community/instructions/*.instructions.md` files.
 * No copying into the workspace is required: the content is read live from the
 * installed extension.
 *
 * Topics are derived from the file names: `al-naming-conventions.instructions.md`
 * is exposed as the topic `naming-conventions` (the leading `al-` is optional when
 * querying, so both `naming-conventions` and `al-naming-conventions` resolve).
 */
export class GetCodingStandardTool
  implements vscode.LanguageModelTool<IGetCodingStandardInput>
{
  constructor(private readonly extensionUri: vscode.Uri) {}

  private get instructionsDir(): vscode.Uri {
    return vscode.Uri.joinPath(
      this.extensionUri,
      "assets",
      "generated",
      "aldc-community",
      "instructions"
    );
  }

  /**
   * Builds a map of normalized topic -> instruction file name. Each file is
   * registered both under its full base name and an `al-` stripped alias.
   */
  private async getTopicMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this.instructionsDir);
    } catch {
      return map;
    }

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith(".instructions.md")) {
        continue;
      }
      const base = name.replace(/\.instructions\.md$/i, "");
      map.set(base.toLowerCase(), name);
      map.set(base.replace(/^al-/i, "").toLowerCase(), name);
    }
    return map;
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetCodingStandardInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const requested = (options.input.topic ?? "").trim().toLowerCase();
    const topicMap = await this.getTopicMap();

    const availableTopics = [
      ...new Set([...topicMap.keys()].map((k) => k.replace(/^al-/i, ""))),
    ].sort();

    const fileName = topicMap.get(requested);
    if (!fileName) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `No coding standard found for "${options.input.topic}". ` +
            `Available topics: ${availableTopics.join(", ")}.`
        ),
      ]);
    }

    let content: string;
    try {
      const data = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.instructionsDir, fileName)
      );
      content = Buffer.from(data).toString("utf8");
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Failed to read coding standard "${options.input.topic}": ` +
            (err instanceof Error ? err.message : String(err))
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
      invocationMessage: `Looking up the coding standard for "${options.input.topic}"`,
    };
  }
}
