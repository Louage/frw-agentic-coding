import * as vscode from "vscode";
import { GetCodingStandardTool } from "./tools/getCodingStandardTool";
import { ListAgentPlaceholdersTool } from "./tools/listAgentPlaceholdersTool";
import { AssetTreeProvider } from "./views/assetTreeProvider";
import { WorkflowPanel } from "./views/workflowPanel";
import {
  getAgentWorkflowViewModel,
  listUserInvocableAgents,
  type AgentWorkflowHandoff,
  type AgentWorkflowViewModel,
} from "./workflows/agentWorkflowService";
import { checkForUpdates } from "./update/updateChecker";
import { withRepositoryGuard } from "./workspaceRepoResolver";
import {
  syncAlBaseCode,
  syncOnStartup,
  syncGitIgnoredRepositories,
} from "./alBaseCode";
import { AlBaseCodePanel } from "./views/alBaseCodePanel";
import { PlaceholderResolver, DEFAULT_PLACEHOLDERS } from "./placeholderResolver";

export function activate(context: vscode.ExtensionContext): void {
  // Shared output channel — visible via View → Output → "AC⚡DC"
  const output = vscode.window.createOutputChannel("AC⚡DC");
  context.subscriptions.push(output);

  // 1. Skill (executable tool): registered so agent mode can invoke it.
  //    Skills (SKILL.md) and rules (*.instructions.md) are contributed
  //    declaratively via the chatSkills / chatInstructions manifest points
  //    and served live from the extension — no workspace copy needed.
  context.subscriptions.push(
    vscode.lm.registerTool(
      "frw_get_coding_standard",
      new GetCodingStandardTool(context.extensionUri)
    ),
    vscode.lm.registerTool(
      "frw_list_agent_placeholders",
      new ListAgentPlaceholdersTool()
    )
  );

  // Validate placeholder values on startup and on configuration change.
  const resolver = new PlaceholderResolver();
  const validatePlaceholders = async (): Promise<void> => {
    const agents = await listUserInvocableAgents(context.extensionUri);
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

  // 2. Sidebar: tree views listing the bundled skills and rules.
  const skillsProvider = new AssetTreeProvider(context.extensionUri, "skill");
  const rulesProvider = new AssetTreeProvider(context.extensionUri, "rule");
  const agentsProvider = new AssetTreeProvider(context.extensionUri, "agent");
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("frwSkills", skillsProvider),
    vscode.window.registerTreeDataProvider("frwRules", rulesProvider),
    vscode.window.registerTreeDataProvider("frwAgents", agentsProvider),
    vscode.commands.registerCommand("frwAgenticCoding.refreshSkills", () =>
      skillsProvider.refresh()
    ),
    vscode.commands.registerCommand("frwAgenticCoding.refreshRules", () =>
      rulesProvider.refresh()
    ),
    vscode.commands.registerCommand("frwAgenticCoding.refreshAgents", () =>
      agentsProvider.refresh()
    ),
    // Clicking a skill drops its `/slash` command into the chat input.
    vscode.commands.registerCommand(
      "frwAgenticCoding.useSkill",
      (skillName: string) => openChatWith(`/${skillName} `)
    ),
    // Clicking a rule references the coding-standard tool for that topic.
    vscode.commands.registerCommand(
      "frwAgenticCoding.useRule",
      (topic: string) => openChatWith(`#frwCodingStandard ${topic} `)
    ),
    // Clicking an agent prepares an @mention to assign the next task.
    vscode.commands.registerCommand(
      "frwAgenticCoding.useAgent",
      async (displayName: string | undefined, stableId?: string) => {
        // When invoked from the command palette, displayName is undefined —
        // show a quick-pick so the user can choose an agent.
        if (!displayName) {
          const picked = await pickAgent(context.extensionUri);
          if (!picked) { return; }
          displayName = picked.displayName;
          stableId = picked.stableId;
        }
        output.show(true); // reveal the AC⚡DC output channel without stealing focus
        output.appendLine(`[useAgent] Activating: ${displayName} (${stableId ?? "no stableId"})`);
        await selectAgentInChat(displayName, stableId, context.extension.id);
        await openAgentWorkflowVisualizer(
          context.extensionUri,
          displayName,
          stableId,
          context.extension.id,
          context,
          output
        );
      }
    ),
    vscode.commands.registerCommand(
      "frwAgenticCoding.runRepoScopedAction",
      async (explicitRepositoryName?: string) => {
        await withRepositoryGuard(
          "The Framework repository action",
          async (folder) => {
            vscode.window.showInformationMessage(
              `Repository action target: ${folder.name} (${folder.uri.fsPath})`
            );
          },
          explicitRepositoryName
        );
      }
    ),
  );

  // 3. Command: manual update check.
  context.subscriptions.push(
    vscode.commands.registerCommand("frwAgenticCoding.checkForUpdates", () =>
      checkForUpdates(context, true)
    )
  );

  // 3b. Command: set an agent placeholder via a two-step live QuickPick.
  context.subscriptions.push(
    vscode.commands.registerCommand("acdc.setAgentPlaceholder", async () => {
      await setAgentPlaceholderCommand(context.extensionUri, resolver);
    })
  );

  // 4. AL Base Code / ISV Code: mount external BC/ISV source folders for AI context.
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

  // 5. Startup checks.
  const config = vscode.workspace.getConfiguration("acdc");
  if (config.get<boolean>("update.checkOnStartup", true)) {
    void checkForUpdates(context, false);
  }
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
  const config = vscode.workspace.getConfiguration();
  const userMap = config.get<Record<string, string>>("acdc.agents.placeholders") ?? {};
  await config.update(
    "acdc.agents.placeholders",
    { ...userMap, [keyPick.label]: valuePick.label },
    vscode.ConfigurationTarget.Global
  );
  void vscode.window.showInformationMessage(
    `\${${keyPick.label}} now resolves to "${valuePick.label}".`
  );
}

async function checkToolsAvailable(workflow: AgentWorkflowViewModel): Promise<void> {
  if (!workflow.requiredTools || workflow.requiredTools.length === 0) {
    return;
  }

  // Note: readTools() already filters and normalizes to only MCP tools.
  // All MCP tools are configured via mcp.json and don't need extension checks.
  // This function is a no-op but kept for future extensibility.
  return;
}

/**
 * Opens the Copilot Chat view and pre-fills its input with `text` without
 * sending it, so the user can review or adjust before submitting.
 */
function openChatWith(text: string): void {
  void vscode.commands.executeCommand("workbench.action.chat.open", {
    query: text,
    isPartialQuery: true,
  });
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

async function handleAgentFileDropped(
  displayName: string,
  stableId: string | undefined,
  extensionId: string,
  fileUri: string
): Promise<void> {
  await selectAgentInChat(displayName, stableId, extensionId);

  let parsedUri: vscode.Uri | undefined;

  try {
    parsedUri = vscode.Uri.parse(fileUri);
  } catch {
    parsedUri = undefined;
  }

  if (parsedUri) {
    try {
      await vscode.commands.executeCommand(
        "workbench.action.chat.attachFile",
        parsedUri
      );
    } catch {
      // If attachment fails, fall back to opening chat with message
      openChatWith(`Use this file as workflow input for '${displayName}'.`);
      return;
    }
  }

  // Open chat with a simple instruction message
  openChatWith(`Use this file as workflow input. Start with the active workflow for '${displayName}'.`);
}

async function openAgentWorkflowVisualizer(
  extensionUri: vscode.Uri,
  displayName: string,
  stableId: string | undefined,
  extensionId: string,
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): Promise<void> {
  const workflow = await getAgentWorkflowViewModel(
    extensionUri,
    displayName,
    stableId,
    context
  );

  // Check if required tools are available
  await checkToolsAvailable(workflow);

  // Log tool discovery results to the AC⚡DC output channel.
  if (output) {
    const ext = workflow.requiredTools ?? [];
    const mcp = workflow.requiredMcpServers ?? [];
    output.appendLine(`[tools] Extension tools (${ext.length}): ${ext.map((t) => `${t.available ? "✓" : "✗"} ${t.id}`).join(", ") || "none"}`);
    output.appendLine(`[tools] MCP servers   (${mcp.length}): ${mcp.map((t) => `${t.available ? "✓" : "✗"} ${t.id}`).join(", ") || "none"}`);
  }

  // Attempt to auto-enable the agent's available tools in the current chat session.
  // Use the raw frontmatter tool list (vscode/memory, read/readFile, al-symbols-mcp, etc.)
  // so VS Code can enable ALL declared tools — not just the MCP subset.
  // VS Code may not expose a stable public API for this; we try silently and ignore failures.
  const rawToolIds = workflow.rawTools ?? [];
  if (output) {
    output.appendLine(`[tools] Passing to selectTools: [${rawToolIds.join(", ")}]`);
  }
  if (rawToolIds.length > 0) {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.selectTools", rawToolIds);
    } catch { /* command not available in this VS Code version — ignore */ }
  }

  WorkflowPanel.show(workflow, {
    onSelectCurrentAgent: async () => {
      await selectAgentInChat(
        workflow.currentAgent.displayName,
        workflow.currentAgent.stableId,
        extensionId
      );
    },
    onSelectHandoff: async (handoff: AgentWorkflowHandoff) => {
      await selectAgentInChat(
        handoff.targetDisplayName,
        handoff.targetStableId,
        extensionId
      );
      await openAgentWorkflowVisualizer(
        extensionUri,
        handoff.targetDisplayName,
        handoff.targetStableId,
        extensionId,
        context,
        output
      );
    },
    onSelectIncoming: async (incoming) => {
      await selectAgentInChat(
        incoming.sourceDisplayName,
        incoming.sourceStableId,
        extensionId
      );
      await openAgentWorkflowVisualizer(
        extensionUri,
        incoming.sourceDisplayName,
        incoming.sourceStableId,
        extensionId,
        context,
        output
      );
    },
    onFileDropped: async (fileUri: string) => {
      await handleAgentFileDropped(
        workflow.currentAgent.displayName,
        workflow.currentAgent.stableId,
        extensionId,
        fileUri
      );
    },
    onSelectFile: async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Use as workflow input",
        filters: { "All files": ["*"] },
      });
      if (uris && uris.length > 0) {
        await handleAgentFileDropped(
          workflow.currentAgent.displayName,
          workflow.currentAgent.stableId,
          extensionId,
          uris[0].toString()
        );
      }
    },
    onRefreshTools: async () => {
      // Re-open the visualizer so tool availability is re-checked against
      // whatever MCP servers are now running / configured.
      await openAgentWorkflowVisualizer(
        extensionUri,
        workflow.currentAgent.displayName,
        workflow.currentAgent.stableId,
        extensionId,
        context,
        output
      );
    },
    onOpenToolsPicker: async () => {
      // Try known VS Code Chat tool-picker commands until one succeeds.
      const candidates = [
        "workbench.action.chat.selectTools",
        "workbench.action.chat.configureTools",
        "workbench.panel.chat.openToolsPicker",
      ];
      for (const cmd of candidates) {
        try {
          await vscode.commands.executeCommand(cmd);
          return;
        } catch { /* try next */ }
      }
      // Fallback: focus chat so the user can click the tools button manually.
      await vscode.commands.executeCommand("workbench.action.chat.open");
    },
    onInstallTool: async (toolId: string) => {
      // If this looks like an extension ID, open it in the Extensions view.
      await vscode.commands.executeCommand(
        "workbench.extensions.search",
        `@id:${toolId}`
      );
    },
  });

  // First-response availability summary: notify the developer about missing
  // tools/MCP servers so they are aware before starting a session with the agent.
  postToolAvailabilitySummary(workflow, extensionUri, extensionId, context, output);
}

/**
 * Posts a first-response availability summary as a VS Code notification when
 * the agent has required tools/MCP servers that are not yet available.
 * Separate MCP-server misses from extension misses so the developer knows
 * exactly which install/configure action is needed.
 * If everything is available (or there are no tool requirements), stays silent.
 */
function postToolAvailabilitySummary(
  workflow: AgentWorkflowViewModel,
  extensionUri: vscode.Uri,
  extensionId: string,
  context: vscode.ExtensionContext,
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

  void vscode.window.showWarningMessage(message, "Show Details").then((choice) => {
    if (choice === "Show Details") {
      void openAgentWorkflowVisualizer(
        extensionUri,
        workflow.currentAgent.displayName,
        workflow.currentAgent.stableId,
        extensionId,
        context,
        output
      );
    }
  });
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
  // workbench.action.chat.openAL Architecture & Design Specialist
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


