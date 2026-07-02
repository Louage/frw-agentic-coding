import * as vscode from "vscode";

/** Which kind of bundled asset a tree shows. */
export type AssetKind = "skill" | "rule" | "agent";

/** A single skill or rule entry rendered in the sidebar. */
interface IAssetItem {
  /** Display label (the asset's name). */
  label: string;
  /**
   * Stable identifier used to reference the asset in chat: the skill name for
   * skills (used as `/skill-name`) or the topic for rules (passed to the
   * `#frwCodingStandard` tool).
   */
  id: string;
  /** Short trailing text (e.g. a rule's `applyTo` glob). */
  description?: string;
  /** Markdown tooltip (the asset's full description). */
  tooltip?: string;
  /** The bundled file the item opens. */
  resourceUri: vscode.Uri;
}

/**
 * Tree provider that lists the extension's bundled generated skills
 * (under generated skill folders with `SKILL.md`) or generated rules
 * (generated instruction files ending with `.instructions.md`). Items are read live
 * from the installed extension and open the underlying Markdown file when clicked.
 */
export class AssetTreeProvider implements vscode.TreeDataProvider<IAssetItem> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly kind: AssetKind
  ) {}

  refresh(): void {
    this.onDidChangeEmitter.fire();
  }

  getTreeItem(element: IAssetItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    if (element.tooltip) {
      item.tooltip = new vscode.MarkdownString(element.tooltip);
    }
    item.resourceUri = element.resourceUri;
    item.iconPath = new vscode.ThemeIcon(
      this.kind === "skill" ? "rocket" : this.kind === "rule" ? "law" : "hubot"
    );
    item.contextValue = this.kind;
    item.command = {
      command:
        this.kind === "skill"
          ? "frwAgenticCoding.useSkill"
          : this.kind === "rule"
            ? "frwAgenticCoding.useRule"
            : "frwAgenticCoding.useAgent",
      title: "Use in Chat",
      arguments: [element.id],
    };
    return item;
  }

  getChildren(): Promise<IAssetItem[]> {
    if (this.kind === "skill") {
      return this.getSkills();
    }
    if (this.kind === "rule") {
      return this.getRules();
    }
    return this.getAgents();
  }

  private get skillsDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, "assets", "generated");
  }

  private get instructionsDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, "assets", "generated");
  }

  private get agentsDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, "assets", "generated");
  }

  private async getSkills(): Promise<IAssetItem[]> {
    const items: IAssetItem[] = [];
    const skillFiles = await this.findFilesRecursive(this.skillsDir, (name) =>
      name.toLowerCase() === "skill.md"
    );

    for (const fileUri of skillFiles) {
      const meta = await this.readFrontmatter(fileUri);
      if (!meta) {
        continue;
      }

      const fallbackName = fileUri.path.split("/").slice(-2, -1)[0] ?? "skill";
      const skillName = meta["name"] ?? fallbackName;
      items.push({
        label: skillName,
        id: skillName,
        tooltip: meta["description"],
        resourceUri: fileUri,
      });
    }

    return items.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async getRules(): Promise<IAssetItem[]> {
    const items: IAssetItem[] = [];
    const instructionFiles = await this.findFilesRecursive(
      this.instructionsDir,
      (name) => name.toLowerCase().endsWith(".instructions.md")
    );

    for (const fileUri of instructionFiles) {
      const name = fileUri.path.split("/").at(-1) ?? "";
      const meta = await this.readFrontmatter(fileUri);
      const label = name
        .replace(/\.instructions\.md$/i, "")
        .replace(/^al-/i, "");
      items.push({
        label,
        id: label,
        description: meta?.["applyTo"],
        tooltip: meta?.["description"],
        resourceUri: fileUri,
      });
    }
    return items.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async getAgents(): Promise<IAssetItem[]> {
    const items: IAssetItem[] = [];
    const agentFiles = await this.findFilesRecursive(this.agentsDir, (name) =>
      name.toLowerCase().endsWith(".agent.md")
    );

    for (const fileUri of agentFiles) {
      const meta = await this.readFrontmatter(fileUri);
      const fileName = fileUri.path.split("/").at(-1) ?? "";
      const label = meta?.["name"] ?? fileName.replace(/\.agent\.md$/i, "");
      items.push({
        label,
        id: label,
        tooltip: meta?.["description"],
        resourceUri: fileUri,
      });
    }

    return items.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Recursively finds files below `root` that satisfy `predicate`.
   */
  private async findFilesRecursive(
    root: vscode.Uri,
    predicate: (name: string) => boolean
  ): Promise<vscode.Uri[]> {
    const results: vscode.Uri[] = [];

    const walk = async (dir: vscode.Uri): Promise<void> => {
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        return;
      }

      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          await walk(child);
        } else if (type === vscode.FileType.File && predicate(name)) {
          results.push(child);
        }
      }
    };

    await walk(root);
    return results;
  }

  /**
   * Reads the leading YAML frontmatter block of a Markdown file and returns its
   * top-level scalar keys. Returns undefined if the file can't be read or has no
   * frontmatter. This is a deliberately small parser for the simple `key: value`
   * frontmatter used by these assets, not a full YAML implementation.
   */
  private async readFrontmatter(
    uri: vscode.Uri
  ): Promise<Record<string, string> | undefined> {
    let text: string;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(data).toString("utf8");
    } catch {
      return undefined;
    }

    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!match) {
      return undefined;
    }

    const result: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!kv) {
        continue;
      }
      const value = kv[2].trim().replace(/^['"]|['"]$/g, "");
      if (value) {
        result[kv[1]] = value;
      }
    }
    return result;
  }
}
