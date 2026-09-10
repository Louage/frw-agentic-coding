import * as vscode from "vscode";
import { AGENT_SETTINGS_CONFIG_KEY } from "../agentPlaceholderUtils";
import type { AgentSettingEntry } from "../agentSettingsService";
import {
  buildOwnerIndex,
  normalizeStoredToolIds,
  type ContributingExtension,
  type ToolOwnerIndex,
} from "./toolIdentity";

// v2 re-runs the rename for ids qualified under the pre-toolset rule, which produced
// `GitHub.copilot-chat/copilot_readFile` where frontmatter expects `read/readFile`.
const MIGRATION_KEY = "acdc.toolIds.qualifiedV2";

/**
 * Host adapter for `buildOwnerIndex`: projects `vscode.extensions.all` onto the
 * vscode-free `ContributingExtension` shape. The index comes from the extension
 * manifests, not from `vscode.lm.tools`, so it is complete at activation time even
 * though tool registration keeps trickling in for another few seconds.
 */
export function buildHostOwnerIndex(): ToolOwnerIndex {
  const contributing: ContributingExtension[] = [];
  for (const extension of vscode.extensions.all) {
    const tools = extension.packageJSON?.contributes?.languageModelTools as
      | Array<{ name?: string; toolReferenceName?: string }>
      | undefined;
    const toolSets = extension.packageJSON?.contributes?.languageModelToolSets as
      | Array<{ name?: string; tools?: string[] }>
      | undefined;
    if (!Array.isArray(tools) && !Array.isArray(toolSets)) {
      continue;
    }
    contributing.push({
      id: extension.id,
      displayName: extension.packageJSON?.displayName,
      tools: (Array.isArray(tools) ? tools : [])
        .filter((tool) => typeof tool?.name === "string" && tool.name.length > 0)
        .map((tool) => ({ name: tool.name as string, referenceName: tool.toolReferenceName })),
      toolSets: (Array.isArray(toolSets) ? toolSets : [])
        .filter((toolSet) => typeof toolSet?.name === "string" && toolSet.name.length > 0)
        .map((toolSet) => ({
          name: toolSet.name as string,
          toolReferenceNames: Array.isArray(toolSet.tools) ? toolSet.tools : [],
        })),
    });
  }
  return buildOwnerIndex(contributing);
}

/**
 * One-time, silent rewrite of tool ids stored by earlier versions of the picker:
 * a bare `al_build` becomes `ms-dynamics-smb.al/al_build`, which is the token VS Code
 * expects in agent frontmatter. Ids with no known owner — wildcards, MCP tokens,
 * tools whose extension is not installed — are left exactly as they are.
 */
export async function migrateStoredToolIds(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  if (context.globalState.get<boolean>(MIGRATION_KEY) === true) {
    return;
  }

  const stored = vscode.workspace
    .getConfiguration()
    .inspect<Record<string, AgentSettingEntry>>(AGENT_SETTINGS_CONFIG_KEY)?.globalValue;

  if (stored && typeof stored === "object") {
    const index = buildHostOwnerIndex();
    const next: Record<string, AgentSettingEntry> = {};
    const changed: string[] = [];

    for (const [agentId, entry] of Object.entries(stored)) {
      const disabledTools = normalizeStoredToolIds(entry?.disabledTools ?? [], index);
      const extraTools = normalizeStoredToolIds(entry?.extraTools ?? [], index);
      if (
        differs(entry?.disabledTools ?? [], disabledTools) ||
        differs(entry?.extraTools ?? [], extraTools)
      ) {
        changed.push(agentId);
        next[agentId] = { ...entry };
        if (entry?.disabledTools) {
          next[agentId].disabledTools = disabledTools;
        }
        if (entry?.extraTools) {
          next[agentId].extraTools = extraTools;
        }
      } else {
        next[agentId] = entry;
      }
    }

    if (changed.length > 0) {
      await vscode.workspace
        .getConfiguration()
        .update(AGENT_SETTINGS_CONFIG_KEY, next, vscode.ConfigurationTarget.Global);
      output.appendLine(
        `[tools] Qualified stored tool ids for: ${changed.join(", ")}.`
      );
    }
  }

  await context.globalState.update(MIGRATION_KEY, true);
}

function differs(before: string[], after: string[]): boolean {
  return before.length !== after.length || before.some((id, i) => id !== after[i]);
}
