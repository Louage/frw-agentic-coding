import * as vscode from "vscode";
import { GetCodingStandardTool } from "./tools/getCodingStandardTool";
import { ListAgentPlaceholdersTool } from "./tools/listAgentPlaceholdersTool";
import { GetSddConfigTool } from "./tools/getSddConfigTool";
import { RenderSddPathTool } from "./tools/renderSddPathTool";
import { AssetTreeProvider } from "./views/assetTreeProvider";
import {
  getAgentWorkflowViewModel,
  listAllAgents,
  listUserInvocableAgents,
  type AgentWorkflowViewModel,
} from "./workflows/agentWorkflowService";
import {
  syncAlBaseCode,
  syncOnStartup,
  syncGitIgnoredRepositories,
} from "./alBaseCode";
import { AlBaseCodePanel } from "./views/alBaseCodePanel";
import { BcqualityCustomLayersPanel } from "./views/bcqualityCustomLayersPanel";
import { AgentSettingsViewProvider } from "./views/agentSettingsView";
import { PlaceholderResolver, DEFAULT_PLACEHOLDERS } from "./placeholderResolver";
import {
  syncCustomLayers,
  syncCustomLayersOnStartup,
} from "./bcquality/sync";
import { removeAllLayers } from "./bcquality/storage";
import { pruneStaleEntries } from "./bcquality/instructionsLocation";
import {
  GetBcqualityCustomRuleTool,
  ListBcqualityCustomRulesTool,
} from "./tools/bcqualityCustomRulesTool";
import {
  GetBcqualityCustomSkillTool,
  ListBcqualityCustomSkillsTool,
} from "./tools/bcqualityCustomSkillsTool";
import { savePlaceholderTarget } from "./agentSettingsService";
import { applyAgentContributionOverrides } from "./agentContributionOverrides";

export function activate(context: vscode.ExtensionContext): void {
  // Shared output channel — visible via View → Output → "AC⚡DC"
  const output = vscode.window.createOutputChannel("AC⚡DC");
  context.subscriptions.push(output);
  const agentSettingsProvider = new AgentSettingsViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AgentSettingsViewProvider.viewType,
      agentSettingsProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // 1. Skill (executable tool): registered so agent mode can invoke it.
  //    Skills (SKILL.md) and rules (*.instructions.md) are contributed
  //    declaratively via the chatSkills / chatInstructions manifest points
  //    and served live from the extension — no workspace copy needed.
  context.subscriptions.push(
    vscode.lm.registerTool(
      "acdc_get_coding_standard",
      new GetCodingStandardTool(context.extensionUri)
    ),
    vscode.lm.registerTool(
      "acdc_list_agent_placeholders",
      new ListAgentPlaceholdersTool()
    ),
    vscode.lm.registerTool("acdc_get_sdd_config", new GetSddConfigTool()),
    vscode.lm.registerTool("acdc_render_sdd_path", new RenderSddPathTool()),
    vscode.lm.registerTool(
      "acdc_list_bcquality_custom_rules",
      new ListBcqualityCustomRulesTool(context)
    ),
    vscode.lm.registerTool(
      "acdc_get_bcquality_custom_rule",
      new GetBcqualityCustomRuleTool(context)
    ),
    vscode.lm.registerTool(
      "acdc_list_bcquality_custom_skills",
      new ListBcqualityCustomSkillsTool(context)
    ),
    vscode.lm.registerTool(
      "acdc_get_bcquality_custom_skill",
      new GetBcqualityCustomSkillTool(context)
    )
  );

  // Validate placeholder values on startup and on configuration change.
  const resolver = new PlaceholderResolver();
  const validatePlaceholders = async (): Promise<void> => {
    const agents = await listAllAgents(context.extensionUri);
    const knownNames = agents.map((a) => a.displayName);
    const invalid = resolver.validateAgainstKnown(knownNames);
    if (invalid.length > 0) {
      output.appendLine(
        `[Agent Placeholders] Warning — the following configured values do not match any known agent:\n` +
          invalid.map((e) => `  \${${e.key}} → "${e.value}"`).join("\n") +
          `\nCheck the "acdc.agents.placeholders" setting.`
      );
    }
  };
  void validatePlaceholders();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("acdc.agents.placeholders")) {
        void validatePlaceholders();
      }
    })
  );

  // 2. Sidebar: agents tree view.
  //    Skills and Rules are no longer surfaced as tree views — they are still
  //    contributed declaratively (chatSkills / chatInstructions) and used by
  //    agents through the chat host.
  const agentsProvider = new AssetTreeProvider(context.extensionUri, "agent");
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("acdc.agents", agentsProvider),
    vscode.commands.registerCommand("acdc.reloadAgents", () => {
      agentsProvider.refresh();
      void agentSettingsProvider.refresh();
    }),
    // Clicking an agent activates it: switches the chat participant, auto-
    // enables its declared tools, and warns about missing ones.
    vscode.commands.registerCommand(
      "acdc.useAgent",
      async (displayName: string | undefined, stableId?: string) => {
        if (!displayName) {
          const picked = await pickAgent(context.extensionUri);
          if (!picked) { return; }
          displayName = picked.displayName;
          stableId = picked.stableId;
        }
        output.appendLine(`[useAgent] Activating: ${displayName} (${stableId ?? "no stableId"})`);
        await activateAgent(
          context.extensionUri,
          displayName,
          stableId,
          context.extension.id,
          context,
          output
        );
        void agentSettingsProvider.selectAgent(displayName, stableId);
      }
    ),
  );

  // 3b. Command: set an agent placeholder via a two-step live QuickPick.
  context.subscriptions.push(
    vscode.commands.registerCommand("acdc.setAgentPlaceholder", async () => {
      await setAgentPlaceholderCommand(context.extensionUri, resolver);
    })
  );

  // 3e. Command: materialize per-user agent contribution overrides from
  //     Agent Settings, then offer a window reload so Chat re-reads metadata.
  context.subscriptions.push(
    vscode.commands.registerCommand("acdc.applyAgentSettingsToChat", async (options?: {
      autoReload?: boolean;
      promptReload?: boolean;
      silentNoChanges?: boolean;
    }) => {
      const autoReload = options?.autoReload ?? false;
      const promptReload = options?.promptReload ?? true;
      const silentNoChanges = options?.silentNoChanges ?? false;

      const result = await applyAgentContributionOverrides(context, output);
      output.appendLine(
        `[agent-overrides] generated=${result.generatedFiles}, ` +
          `changed=${result.changedContributionFiles}, ` +
          `restored=${result.restoredContributionFiles}, ` +
          `skipped=${result.skippedContributionFiles}`
      );

      const hasWork =
        result.generatedFiles > 0 ||
        result.changedContributionFiles > 0 ||
        result.restoredContributionFiles > 0;

      if (!hasWork) {
        if (!silentNoChanges) {
          vscode.window.showInformationMessage(
            "Agent settings are already reflected in contribution files."
          );
        }
        return;
      }

      if (autoReload) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
        return;
      }

      if (!promptReload) {
        return;
      }

      const action = await vscode.window.showInformationMessage(
        "Agent contribution overrides applied. Reload the window so Chat re-reads agent metadata?",
        "Reload window"
      );

      if (action === "Reload window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    })
  );

  // 3c. Command: pick a workspace folder and store its relative path in
  //     `acdc.plansRoot`. Wired into the setting's markdownDescription
  //     as a clickable "Pick folder…" link.
  context.subscriptions.push(
    vscode.commands.registerCommand("acdc.pickSddPlansRoot", async () => {
      await pickSddPlansRootCommand();
    })
  );

  // 3d. Command: open the settings help document as a Markdown preview.
  //     Not declared in contributes.commands so it is hidden from the palette;
  //     invoked only via command: links in setting markdownDescriptions.
  context.subscriptions.push(
    vscode.commands.registerCommand("acdc.showSettingsHelp", async () => {
      const helpUri = vscode.Uri.joinPath(
        context.extensionUri,
        "assets",
        "help",
        "settings-help.md"
      );
      try {
        await vscode.commands.executeCommand("markdown.showPreviewToSide", helpUri);
      } catch {
        const doc = await vscode.workspace.openTextDocument(helpUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
      }
    })
  );

  // 4. AL Base Code
  context.subscriptions.push(
    vscode.commands.registerCommand("acdc.manageAlBaseCode", () =>
      AlBaseCodePanel.show(output)
    ),
    vscode.commands.registerCommand("acdc.syncAlBaseCode", async () => {
      const results = await syncAlBaseCode(output, { promptBeforeClone: true });
      const errors = results.filter((r) => r.outcome === "error").length;
      const cloned = results.filter((r) => r.outcome === "cloned").length;
      const pulled = results.filter((r) => r.outcome === "pulled").length;
      if (errors > 0) {
        vscode.window.showWarningMessage(
          `AL Base Code sync: ${errors} error(s). Check the AC⚡DC output.`
        );
      } else {
        vscode.window.showInformationMessage(
          `AL Base Code synced: ${cloned} cloned, ${pulled} updated.`
        );
      }
    })
  );

  // 6. BCQuality custom layers (customer/partner forks — see aldc.yaml
  //    external.bcquality.customLayers). Table editor + manual sync command
  //    + startup hook (guarded by `acdc.bcquality.syncOnStartup`).
  context.subscriptions.push(
    vscode.commands.registerCommand("acdc.manageBcqualityCustomLayers", () =>
      BcqualityCustomLayersPanel.show(context, output)
    ),
    vscode.commands.registerCommand("acdc.syncBcqualityCustomLayers", async () => {
      const results = await syncCustomLayers(context, output, {
        promptOnFirstInstall: true,
      });
      const installed = results.filter((r) => r.outcome === "installed").length;
      const upToDate = results.filter((r) => r.outcome === "up-to-date").length;
      const declined = results.filter((r) => r.outcome === "declined").length;
      const errors = results.filter((r) => r.outcome === "error").length;
      if (errors > 0) {
        vscode.window.showWarningMessage(
          `BCQuality custom layers: ${errors} error(s). See the AC⚡DC output for details.`
        );
      } else if (installed === 0 && upToDate === 0 && declined === 0) {
        vscode.window.showInformationMessage(
          `No enabled BCQuality custom layers to sync. Add one in "acdc.bcquality.customLayers".`
        );
      } else {
        vscode.window.showInformationMessage(
          `BCQuality custom layers: ${installed} installed, ${upToDate} up-to-date, ${declined} declined.`
        );
      }
    }),
    vscode.commands.registerCommand("acdc.clearBcqualityCustomLayers", async () => {
      const confirm = await vscode.window.showWarningMessage(
        `Remove ALL imported BCQuality custom layers from extension globalStorage? ` +
          `They will be re-installable via "Sync BCQuality Custom Layers".`,
        { modal: true },
        "Remove"
      );
      if (confirm !== "Remove") {
        return;
      }
      const removed = await removeAllLayers(context);
      await pruneStaleEntries(context, output);
      vscode.window.showInformationMessage(
        removed.length === 0
          ? `No imported BCQuality custom layers found.`
          : `Removed ${removed.length} custom layer(s): ${removed.join(", ")}.`
      );
    })
  );
  void syncCustomLayersOnStartup(context, output);

  // 5. Startup checks.
  void syncOnStartup(output);
  // Keep already-mounted AL source folders out of the Source Control view.
  void syncGitIgnoredRepositories();
}

export function deactivate(): void {
  // Nothing to clean up; all disposables are tracked in context.subscriptions.
}

/**
 * Two-step QuickPick command: first pick the placeholder key, then pick the
 * agent from the live list loaded in the current workspace. Writes the result
 * to user-global settings so it persists across projects.
 */
async function setAgentPlaceholderCommand(
  extensionUri: vscode.Uri,
  resolver: PlaceholderResolver
): Promise<void> {
  const currentMap = resolver.getMap();
  const defaultKeys = Object.keys(DEFAULT_PLACEHOLDERS);
  const allKeys = [...new Set([...defaultKeys, ...Object.keys(currentMap)])].sort();

  // Step 1 — choose the placeholder key to configure.
  const keyPick = await vscode.window.showQuickPick(
    allKeys.map((k) => ({
      label: k,
      description: `currently: ${currentMap[k] ?? "(not set)"}`,
    })),
    {
      title: "Agent Placeholders (1/2): Select placeholder to configure",
      placeHolder: "Pick a placeholder name…",
    }
  );
  if (!keyPick) {
    return;
  }

  // Step 2 — choose the agent from the live workspace list.
  const agents = await listUserInvocableAgents(extensionUri);
  const agentNames = agents.map((a) => a.displayName).sort();
  const currentValue = currentMap[keyPick.label];

  const valuePick = await vscode.window.showQuickPick(
    agentNames.map((name) => ({
      label: name,
      picked: name === currentValue,
      description: name === currentValue ? "(current)" : undefined,
    })),
    {
      title: `Agent Placeholders (2/2): Set "\${${keyPick.label}}" → agent`,
      placeHolder: "Pick an agent…",
    }
  );
  if (!valuePick) {
    return;
  }

  // Merge into the existing user-level map and write back.
  await savePlaceholderTarget(keyPick.label, valuePick.label);
  void vscode.window.showInformationMessage(
    `\${${keyPick.label}} now resolves to "${valuePick.label}".`
  );
}

/**
 * Opens a folder picker rooted in the first workspace folder and stores the
 * selected folder as a workspace-relative POSIX path in `acdc.plansRoot`.
 *
 * Scope selection: the update is written to the same scope that already
 * defines the setting (Workspace wins over User), falling back to Workspace
 * when a workspace is open and User otherwise. After saving, the correct
 * settings editor scope is opened and scrolled to the setting so the value
 * is visibly reflected in the input.
 *
 * Out-of-workspace folders: the user can (a) add the folder to the current
 * workspace (multi-root), (b) store an absolute path anyway, or (c) cancel.
 */
async function pickSddPlansRootCommand(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const defaultUri = folders && folders.length > 0 ? folders[0].uri : undefined;

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Use as SDD plans root",
    title: "Select the folder that holds Spec-Driven Development artifacts",
    defaultUri,
  });
  if (!picked || picked.length === 0) {
    return;
  }
  const selected = picked[0];

  let value: string | undefined;

  if (folders && folders.length > 0) {
    // Try each root — pick the shortest relative path if the folder lives
    // inside one of them.
    const relativeMatches = folders
      .map((f) => ({ folder: f, rel: toWorkspaceRelativePosix(f.uri.fsPath, selected.fsPath) }))
      .filter((m): m is { folder: vscode.WorkspaceFolder; rel: string } => m.rel !== undefined)
      .sort((a, b) => a.rel.length - b.rel.length);

    if (relativeMatches.length > 0) {
      const best = relativeMatches[0];
      const rel = best.rel === "" ? "." : best.rel;
      // In multi-root workspaces the setting is window-scoped, so we need to
      // qualify with the folder name when it's not the first root.
      value =
        folders.length > 1 && best.folder !== folders[0]
          ? `${best.folder.name}/${rel === "." ? "" : rel}`.replace(/\/$/, "")
          : rel;
    } else {
      // Out of workspace — offer to add it, or store absolute path.
      const proceed = await vscode.window.showWarningMessage(
        `The chosen folder is outside the current workspace (${selected.fsPath}). ` +
          `Add it to the workspace, or store the absolute path? Absolute paths are less portable across machines.`,
        { modal: true },
        "Add to Workspace",
        "Use absolute path"
      );
      if (!proceed) {
        return;
      }
      if (proceed === "Add to Workspace") {
        const added = vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders?.length ?? 0,
          0,
          { uri: selected }
        );
        if (!added) {
          void vscode.window.showErrorMessage(
            `Failed to add "${selected.fsPath}" to the workspace.`
          );
          return;
        }
        // The added folder becomes a new workspace root. In a single-root
        // workspace we ended up in multi-root territory; in either case the
        // plans root IS that folder, so store its basename as folder-qualified
        // relative path.
        const basename = selected.path.split("/").filter(Boolean).pop() ?? selected.fsPath;
        value = basename;
      } else {
        value = selected.fsPath.replace(/\\/g, "/");
      }
    }
  } else {
    value = selected.fsPath.replace(/\\/g, "/");
  }

  // Determine the scope: honour the existing scope if one is set, otherwise
  // prefer Workspace when a workspace is open.
  const config = vscode.workspace.getConfiguration();
  const inspect = config.inspect<string>("acdc.plansRoot");
  let target: vscode.ConfigurationTarget;
  if (inspect?.workspaceValue !== undefined) {
    target = vscode.ConfigurationTarget.Workspace;
  } else if (inspect?.globalValue !== undefined) {
    target = vscode.ConfigurationTarget.Global;
  } else {
    target = folders && folders.length > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  }

  await config.update("acdc.plansRoot", value, target);

  const scopeLabel =
    target === vscode.ConfigurationTarget.Workspace ? "workspace" : "user";
  void vscode.window.showInformationMessage(
    `SDD plans root set to "${value}" (${scopeLabel} setting).`
  );
}

/**
 * Returns the POSIX relative path from `root` to `child`, or `undefined` when
 * `child` is not a descendant of `root`. Comparison is case-insensitive on
 * Windows to match the OS filesystem semantics.
 */
function toWorkspaceRelativePosix(root: string, child: string): string | undefined {
  const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/g, "");
  const rootN = norm(root);
  const childN = norm(child);
  const rootCmp = process.platform === "win32" ? rootN.toLowerCase() : rootN;
  const childCmp = process.platform === "win32" ? childN.toLowerCase() : childN;
  if (childCmp === rootCmp) { return ""; }
  const prefix = rootCmp + "/";
  if (!childCmp.startsWith(prefix)) { return undefined; }
  return childN.slice(prefix.length);
}

async function selectAgentInChat(
  displayName: string,
  stableId: string | undefined,
  extensionId: string
): Promise<void> {
  await openChat();
  const switched = await trySelectChatAgent(displayName, stableId, extensionId);
  if (!switched) {
    const openedPicker = await tryOpenAgentPicker();
    if (!openedPicker) {
      vscode.window.showWarningMessage(
        `Could not switch chat agent automatically for '${displayName}'. Please choose it from the agent selector.`
      );
    }
  }
}

/**
 * Central agent-activation entrypoint invoked from the Agents tree view.
 *
 * Responsibilities:
 *  1. Switch the chat participant to the requested agent.
 *  2. Auto-enable the agent's declared tools in the current chat session.
 *  3. Notify the user about any missing extensions / MCP servers.
 */
async function activateAgent(
  extensionUri: vscode.Uri,
  displayName: string,
  stableId: string | undefined,
  extensionId: string,
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<void> {
  // 1. Switch chat participant.
  await selectAgentInChat(displayName, stableId, extensionId);

  // 2. Load workflow view-model (tools + availability) and auto-enable tools.
  const workflow = await getAgentWorkflowViewModel(
    extensionUri,
    displayName,
    stableId,
    context
  );

  // The per-agent model override is applied deterministically through the
  // agent contribution frontmatter + window reload (see
  // applyAgentContributionOverrides). We deliberately do NOT probe chat
  // model commands here: several host commands cycle the active model
  // instead of setting it, which caused the model to change on every
  // agent (re)selection.

  if (output) {
    const ext = workflow.requiredTools ?? [];
    const mcp = workflow.requiredMcpServers ?? [];
    output.appendLine(`[tools] Extension tools (${ext.length}): ${ext.map((t) => `${t.available ? "✓" : "✗"} ${t.id}`).join(", ") || "none"}`);
    output.appendLine(`[tools] MCP servers   (${mcp.length}): ${mcp.map((t) => `${t.available ? "✓" : "✗"} ${t.id}`).join(", ") || "none"}`);
  }

  const rawToolIds = workflow.rawTools ?? [];
  if (output) {
    output.appendLine(`[tools] Passing to selectTools: [${rawToolIds.join(", ")}]`);
  }
  if (rawToolIds.length > 0) {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.selectTools", rawToolIds);
    } catch { /* command not available in this VS Code version — ignore */ }
  }

  // 3. Notify about missing tools/MCP servers.
  postToolAvailabilitySummary(workflow, output);
}

/**
 * Posts a first-response availability summary as a VS Code notification when
 * the agent has required tools/MCP servers that are not yet available.
 * If everything is available, stays silent.
 */
function postToolAvailabilitySummary(
  workflow: AgentWorkflowViewModel,
  output?: vscode.OutputChannel
): void {
  const missingExtensions = workflow.requiredTools?.filter((t) => !t.available && !t.deprecated) ?? [];
  const missingMcp = workflow.requiredMcpServers?.filter((t) => !t.available && !t.deprecated) ?? [];

  if (missingExtensions.length === 0 && missingMcp.length === 0) {
    output?.appendLine(`[summary] All required tools available — no action needed.`);
    return;
  }

  const parts: string[] = [];
  if (missingExtensions.length > 0) {
    const names = missingExtensions.map((t) => t.id).slice(0, 2).join(", ");
    const extra = missingExtensions.length > 2 ? ` (+${missingExtensions.length - 2} more)` : "";
    parts.push(`${missingExtensions.length} extension${missingExtensions.length > 1 ? "s" : ""} not installed: ${names}${extra}`);
  }
  if (missingMcp.length > 0) {
    const names = missingMcp.map((t) => t.id).slice(0, 2).join(", ");
    const extra = missingMcp.length > 2 ? ` (+${missingMcp.length - 2} more)` : "";
    parts.push(`${missingMcp.length} MCP server${missingMcp.length > 1 ? "s" : ""} not configured: ${names}${extra}`);
  }

  const message = `${workflow.currentAgent.displayName}: ${parts.join("; ")}.`;
  output?.appendLine(`[summary] ${message}`);

  void vscode.window.showWarningMessage(message);
}


/**
 * Shows a quick-pick list of user-invocable agents and returns the selection.
 */
async function pickAgent(
  extensionUri: vscode.Uri
): Promise<{ displayName: string; stableId: string } | undefined> {
  const agents = await listUserInvocableAgents(extensionUri);
  if (agents.length === 0) {
    vscode.window.showWarningMessage("No agents found in this extension.");
    return undefined;
  }
  return vscode.window.showQuickPick(
    agents.map((a) => ({ label: a.displayName, description: a.stableId, ...a })),
    { placeHolder: "Select an agent to activate" }
  );
}

/**
 * Opens the chat panel without pre-filling prompt text.
 */
async function openChat(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.chat.open", {
    isPartialQuery: true,
  });
}

/**
 * Attempts to switch the selected chat agent in the chat composer.
 * Returns true when a switch command is accepted.
 */
async function trySelectChatAgent(
  displayName: string,
  stableId?: string,
  extensionId?: string
): Promise<boolean> {
  const tokens = buildAgentTokens(displayName, stableId, extensionId);

  const discovered = await findChatAgentCommands();

  // Best signal from host diagnostics: one command per agent name, e.g.
  // workbench.action.chat.openAngus, AL Architect
  const directOpenCandidates = buildDirectOpenAgentCommands(
    displayName,
    stableId,
    discovered.allCommands
  );
  for (const commandId of directOpenCandidates) {
    try {
      await vscode.commands.executeCommand(commandId);
      return true;
    } catch {
      // Keep trying fallback switch/picker routes.
    }
  }

  const commandCandidates = [
    "vscode.chat.switchAgent",
    "workbench.action.chat.switchAgent",
    "workbench.action.chat.selectAgent",
    "github.copilot.chat.switchAgent",
    ...discovered.switchCommands,
  ];

  const argCandidates: Array<unknown> = [];
  for (const token of tokens) {
    argCandidates.push(
      { name: token, id: token },
      { name: displayName, id: token },
      { id: token },
      { agent: token },
      { agentName: token },
      { agentId: token },
      { participant: token },
      { participantId: token },
      token
    );
  }

  argCandidates.push({ name: displayName }, { agent: displayName }, displayName);

  for (const commandId of commandCandidates) {
    for (const arg of argCandidates) {
      try {
        await vscode.commands.executeCommand(commandId, arg);
        return true;
      } catch {
        // Ignore and keep probing command/argument combinations.
      }
    }
  }

  return false;
}

/**
 * Builds likely agent identifiers accepted by different chat command shapes.
 */
function buildAgentTokens(
  displayName: string,
  stableId?: string,
  extensionId?: string
): string[] {
  const values = new Set<string>();
  const normalizedDisplay = displayName.trim();
  const slugFromDisplay = normalizedDisplay
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  for (const value of [stableId, normalizedDisplay, slugFromDisplay]) {
    if (value && value.length > 0) {
      values.add(value);
      if (extensionId) {
        values.add(`${extensionId}.${value}`);
      }
    }
  }

  return [...values];
}

/**
 * Opens the chat agent picker when direct switching isn't available.
 */
async function tryOpenAgentPicker(): Promise<boolean> {
  const discovered = await findChatAgentCommands();
  const pickerCommands = [
    "workbench.action.chat.selectAgent",
    "workbench.action.chat.switchAgent",
    "github.copilot.chat.selectAgent",
    "github.copilot.chat.switchAgent",
    ...discovered.switchCommands,
    ...discovered.pickerCommands,
  ];

  for (const commandId of pickerCommands) {
    try {
      await vscode.commands.executeCommand(commandId);
      return true;
    } catch {
      // Try next fallback command.
    }
  }

  return false;
}

/**
 * Discovers chat/agent command IDs exposed by the current VS Code host.
 */
async function findChatAgentCommands(): Promise<{
  allCommands: string[];
  switchCommands: string[];
  pickerCommands: string[];
}> {
  const all = await vscode.commands.getCommands(true);
  const relevant = all.filter((command) => {
    const lc = command.toLowerCase();
    const isRelevant =
      (lc.includes("chat") || lc.includes("copilot")) &&
      (lc.includes("agent") || lc.includes("participant"));
    return isRelevant;
  });

  const switchCommands = relevant.filter((command) => {
    const lc = command.toLowerCase();
    return (
      lc.includes("switch") ||
      lc.includes("select") ||
      lc.includes("set") ||
      lc.includes("change")
    );
  });

  const pickerCommands = relevant.filter((command) => {
    const lc = command.toLowerCase();
    return lc.includes("pick") || lc.includes("picker") || lc.includes("select");
  });

  return {
    allCommands: [...new Set(relevant)],
    switchCommands: [...new Set(switchCommands)],
    pickerCommands: [...new Set(pickerCommands)],
  };
}

/**
 * Build direct per-agent open command IDs exposed by the current host.
 */
function buildDirectOpenAgentCommands(
  displayName: string,
  stableId: string | undefined,
  allCommands: string[]
): string[] {
  const exact = [
    `workbench.action.chat.open${displayName}`,
    stableId ? `workbench.action.chat.open${stableId}` : undefined,
  ].filter((v): v is string => Boolean(v));

  const lcDisplay = displayName.toLowerCase();
  const lcStable = stableId?.toLowerCase();
  const discovered = allCommands.filter((command) => {
    if (!command.startsWith("workbench.action.chat.open")) {
      return false;
    }

    const suffix = command
      .slice("workbench.action.chat.open".length)
      .trim()
      .toLowerCase();

    if (!suffix) {
      return false;
    }

    return suffix === lcDisplay || (lcStable ? suffix === lcStable : false);
  });

  return [...new Set([...exact, ...discovered])];
}

