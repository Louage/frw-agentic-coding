import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  getSkillsDir,
  readProvenance,
} from "../bcquality/storage";
import { getCustomLayers } from "../bcquality/settings";

interface IListInput {
  layerId?: string;
}

interface ISkillRow {
  name: string;
  layerId: string;
  description?: string;
  repository?: string;
  sha?: string;
  path: string;
}

/**
 * Language model tool `acdc_list_bcquality_custom_skills` — enumerates every
 * imported customer/partner BCQuality action skill along with a short
 * description parsed from SKILL.md frontmatter.
 */
export class ListBcqualityCustomSkillsTool
  implements vscode.LanguageModelTool<IListInput>
{
  constructor(private readonly context: vscode.ExtensionContext) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IListInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const filterLayerId = options.input?.layerId?.trim().toLowerCase();
    const rows: ISkillRow[] = [];
    const layers = getCustomLayers();

    for (const layer of layers) {
      if (filterLayerId && layer.id !== filterLayerId) {
        continue;
      }
      const dir = getSkillsDir(this.context, layer.id);
      if (!fs.existsSync(dir)) {
        continue;
      }
      const provenance = await readProvenance(this.context, layer.id);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const skillMd = path.join(dir, entry.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) {
          continue;
        }
        let description: string | undefined;
        try {
          const body = await fs.promises.readFile(skillMd, "utf8");
          description = readFrontmatterValue(body, "description");
        } catch {
          description = undefined;
        }
        rows.push({
          name: entry.name,
          layerId: layer.id,
          description,
          repository: provenance?.repository,
          sha: provenance?.sha,
          path: skillMd,
        });
      }
    }

    if (rows.length === 0) {
      const summary =
        layers.length === 0
          ? "No custom layers are configured (see `acdc.bcquality.customLayers`)."
          : "No imported skills yet — run `AC/DC: Sync BCQuality Custom Layers` first.";
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(summary),
      ]);
    }

    const lines: string[] = [
      "# BCQuality Custom Skills",
      "",
      "| Name | Layer | Description |",
      "| --- | --- | --- |",
    ];
    for (const r of rows) {
      lines.push(`| \`${r.name}\` | \`${r.layerId}\` | ${r.description ?? ""} |`);
    }
    lines.push("");
    lines.push(
      "Read the full SKILL.md with `acdc_get_bcquality_custom_skill` (pass the `Name` column value)."
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
 * Language model tool `acdc_get_bcquality_custom_skill` — returns the full
 * SKILL.md content for a qualified skill name.
 */
export class GetBcqualityCustomSkillTool
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
        "Pass the qualified skill name from `acdc_list_bcquality_custom_skills`."
      );
    }
    const match = requested.match(/^([a-z][a-z0-9-]{1,31})__(.+)$/i);
    if (!match) {
      return errorResult(
        `"${requested}" is not a qualified skill name. Expected \`<layerId>__<skill-name>\`.`
      );
    }
    const layerId = match[1].toLowerCase();
    const abs = path.join(
      getSkillsDir(this.context, layerId),
      requested.toLowerCase(),
      "SKILL.md"
    );
    try {
      const body = await fs.promises.readFile(abs, "utf8");
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(body),
      ]);
    } catch {
      return errorResult(
        `Skill "${requested}" is not installed in globalStorage. ` +
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
