import * as vscode from "vscode";
import { GetCodingStandardTool } from "./tools/getCodingStandardTool";
import { AssetTreeProvider } from "./views/assetTreeProvider";
import { WorkflowPanel } from "./views/workflowPanel";
import {
  getAgentWorkflowViewModel,
  type AgentWorkflowHandoff,
  type AgentWorkflowViewModel,
} from "./workflows/agentWorkflowService";
import { checkForUpdates } from "./update/updateChecker";
import { withRepositoryGuard } from "./workspaceRepoResolver";

export function activate(context: vscode.ExtensionContext): void {
  // 1. Skill (executable tool): registered so agent mode can invoke it.
  //    Skills (SKILL.md) and rules (*.instructions.md) are contributed
  //    declaratively via the chatSkills / chatInstructions manifest points
  //    and served live from the extension — no workspace copy needed.
  context.subscriptions.push(
    vscode.lm.registerTool(
      "frw_get_coding_standard",
      new GetCodingStandardTool(context.extensionUri)
    )
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
      async (displayName: string, stableId?: string) => {
        await selectAgentInChat(displayName, stableId, context.extension.id);
        await openAgentWorkflowVisualizer(
          context.extensionUri,
          displayName,
          stableId,
          context.extension.id
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
    vscode.commands.registerCommand(
      "frwAgenticCoding.diagnoseChatAgentCommands",
      async () => {
        await printChatAgentCommandDiagnostics();
      }
    )
  );

  // 3. Command: manual update check.
  context.subscriptions.push(
    vscode.commands.registerCommand("frwAgenticCoding.checkForUpdates", () =>
      checkForUpdates(context, true)
    )
  );

  // 4. Startup update check (silent auth, opt-out via setting).
  const config = vscode.workspace.getConfiguration("frwAgenticCoding");
  if (config.get<boolean>("update.checkOnStartup", true)) {
    void checkForUpdates(context, false);
  }
}

export function deactivate(): void {
  // Nothing to clean up; all disposables are tracked in context.subscriptions.
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
  extensionId: string
): Promise<void> {
  const workflow = await getAgentWorkflowViewModel(
    extensionUri,
    displayName,
    stableId
  );

  // Check if required tools are available
  await checkToolsAvailable(workflow);

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
        extensionId
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
  });
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

/**
 * Temporary diagnostics helper to inspect available chat/agent commands.
 */
async function printChatAgentCommandDiagnostics(): Promise<void> {
  const all = await vscode.commands.getCommands(true);
  const relevant = all
    .filter((command) => {
      const lc = command.toLowerCase();
      return (
        lc.includes("chat") ||
        lc.includes("copilot") ||
        lc.includes("agent") ||
        lc.includes("participant")
      );
    })
    .sort((a, b) => a.localeCompare(b));

  const output = vscode.window.createOutputChannel(
    "The Framework Agent Diagnostics"
  );
  output.clear();
  output.appendLine("=== Chat/Agent Command Diagnostics ===");
  output.appendLine(`Total commands in host: ${all.length}`);
  output.appendLine(`Relevant commands: ${relevant.length}`);
  output.appendLine("");

  for (const command of relevant) {
    output.appendLine(command);
  }

  output.show(true);
  vscode.window.showInformationMessage(
    `Wrote ${relevant.length} chat/agent command IDs to output: The Framework Agent Diagnostics.`
  );
}
