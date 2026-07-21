import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  getAllInstructionDirs,
  getInstructionsDir,
  readProvenance,
} from "../bcquality/storage";
import { getCustomLayers } from "../bcquality/settings";

interface IListInput {
  layerId?: string;
}

interface IRuleRow {
  name: string;
  layerId: string;
  applyTo?: string;
  description?: string;
  repository?: string;
  sha?: string;
  path: string;
}

/**
 * Language model tool `acdc_list_bcquality_custom_rules` — enumerates every
 * imported customer/partner BCQuality rule with enough metadata for the agent
 * to decide whether to fetch the full body via
 * `acdc_get_bcquality_custom_rule`.
 */
export class ListBcqualityCustomRulesTool
  implements vscode.LanguageModelTool<IListInput>
{
  constructor(private readonly context: vscode.ExtensionContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IListInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const filterLayerId = options.input?.layerId?.trim().toLowerCase();
    const rows: IRuleRow[] = [];

    const dirs = getAllInstructionDirs(this.context);
    for (const dir of dirs) {
      const layerId = path.basename(path.dirname(dir));
      if (filterLayerId && layerId !== filterLayerId) {
        continue;
      }
      const provenance = await readProvenance(this.context, layerId);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".instructions.md"));
      } catch {
        files = [];
      }
      for (const file of files) {
        const abs = path.join(dir, file);
        let body = "";
        try {
          body = await fs.promises.readFile(abs, "utf8");
        } catch {
          continue;
        }
        const applyTo = readFrontmatterValue(body, "applyTo");
        const description = readFrontmatterValue(body, "description");
        rows.push({
          name: file.replace(/\.instructions\.md$/i, ""),
          layerId,
          applyTo,
          description,
          repository: provenance?.repository,
          sha: provenance?.sha,
          path: abs,
        });
      }
    }

    if (rows.length === 0) {
      const layers = getCustomLayers();
      const summary =
        layers.length === 0
          ? "No custom layers are configured (see `acdc.bcquality.customLayers`)."
          : "No imported rules yet — run `AC/DC: Sync BCQuality Custom Layers` first.";
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(summary),
      ]);
    }

    const lines: string[] = [
      "# BCQuality Custom Rules",
      "",
      "| Name | Layer | applyTo | Description |",
      "| --- | --- | --- | --- |",
    ];
    for (const r of rows) {
      lines.push(
        `| \`${r.name}\` | \`${r.layerId}\` | \`${r.applyTo ?? ""}\` | ${r.description ?? ""} |`
      );
    }
    lines.push("");
    lines.push(
      "Read the full body of any rule with `acdc_get_bcquality_custom_rule` " +
        "(pass the `Name` column value)."
    );
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(lines.join("\n")),
    ]);
  }
}

interface IGetInput {
  name: string;
}

/**
 * Language model tool `acdc_get_bcquality_custom_rule` — returns the full
 * transformed instruction body (with provenance banner and rewritten
 * frontmatter) for a qualified rule name.
 */
export class GetBcqualityCustomRuleTool
  implements vscode.LanguageModelTool<IGetInput>
{
  constructor(private readonly context: vscode.ExtensionContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const requested = (options.input?.name ?? "").trim();
    if (!requested) {
      return errorResult(
        "Pass the qualified rule name from `acdc_list_bcquality_custom_rules`."
      );
    }
    const match = requested.match(/^([a-z][a-z0-9-]{1,31})__(.+)$/i);
    if (!match) {
      return errorResult(
        `"${requested}" is not a qualified rule name. Expected \`<layerId>__<rule-name>\`.`
      );
    }
    const layerId = match[1].toLowerCase();
    const stem = match[2].replace(/\.instructions\.md$/i, "");
    const abs = path.join(
      getInstructionsDir(this.context, layerId),
      `${layerId}__${stem}.instructions.md`
    );
    try {
      const body = await fs.promises.readFile(abs, "utf8");
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(body),
      ]);
    } catch {
      return errorResult(
        `Rule "${requested}" is not installed in globalStorage. ` +
          `Run \`AC/DC: Sync BCQuality Custom Layers\` first.`
      );
    }
  }
}

function readFrontmatterValue(source: string, key: string): string | undefined {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) {
    return undefined;
  }
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv && kv[1] === key) {
      return kv[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return undefined;
}

function errorResult(msg: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(msg),
  ]);
}
