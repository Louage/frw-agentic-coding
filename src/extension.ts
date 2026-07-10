import * as vscode from "vscode";
import { GetCodingStandardTool } from "./tools/getCodingStandardTool";
import { ListAgentPlaceholdersTool } from "./tools/listAgentPlaceholdersTool";
import { UpdateAgentFlowTool } from "./tools/updateAgentFlowTool";
import { AssetTreeProvider } from "./views/assetTreeProvider";
import { AgentFlowViewProvider } from "./views/agentFlowViewProvider";
import {
  getAgentWorkflowViewModel,
  listUserInvocableAgents,
  type AgentWorkflowViewModel,
} from "./workflows/agentWorkflowService";
import { FlowStateService } from "./workflows/flowStateService";
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

  // Flow-state service: authoritative store for the sidebar "Agent Flow" view.
  // Registered before any tools/views so both can wire against it.
  const flowState = new FlowStateService(context, output);
  context.subscriptions.push({ dispose: () => flowState.dispose() });

  // One-shot: remove any leftover `.vscode/acdc-agent-flow.txt` files from
  // earlier extension versions. New writes always go to the OS temp folder
  // so the workspace stays clean.
  void flowState.cleanupLegacyWorkspaceFiles();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void flowState.cleanupLegacyWorkspaceFiles();
    })
  );

  // Re-seed the planned roadmap whenever the active agent changes. This
  // catches Copilot-driven handoffs (user clicks a handoff button in the
  // chat, Copilot switches participant) which our extension has no direct
  // event for — the switch is detected via the optional `agent: <name>`
  // header the new agent writes in the flow file.
  let lastKnownAgent: string | undefined = flowState.current?.agentDisplayName;
  context.subscriptions.push(
    flowState.onDidChange(async (newState) => {
      const name = newState?.agentDisplayName;
      if (!name || name === lastKnownAgent) { return; }
      lastKnownAgent = name;
      output.appendLine(`[flow] agent changed to "${name}" — re-parsing planned roadmap`);
      try {
        const planned = await extractPlannedFlow(context.extensionUri, newState?.agentStableId, name);
        flowState.setPlannedFlow(planned);
      } catch (e) {
        output.appendLine(`[flow] planned-flow re-parse failed: ${(e as Error).message}`);
      }
    })
  );

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
    ),
    vscode.lm.registerTool(
      "frw_update_agent_flow",
      new UpdateAgentFlowTool(flowState, output)
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

  // 2. Sidebar: agents tree view + agent-flow webview view.
  //    Skills and Rules are no longer surfaced as tree views — they are still
  //    contributed declaratively (chatSkills / chatInstructions) and used by
  //    agents through the chat host.
  const agentsProvider = new AssetTreeProvider(context.extensionUri, "agent");
  const agentFlowProvider = new AgentFlowViewProvider(flowState, {
    onSelectAgent: async (displayName, stableId) => {
      await activateAgent(
        context.extensionUri,
        displayName,
        stableId,
        context.extension.id,
        context,
        flowState,
        output
      );
    },
    onResetFlow: async () => {
      flowState.resetFlow();
    },
  });
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("frwAgents", agentsProvider),
    vscode.window.registerWebviewViewProvider(
      AgentFlowViewProvider.viewType,
      agentFlowProvider
    ),
    vscode.commands.registerCommand("frwAgenticCoding.refreshAgents", () =>
      agentsProvider.refresh()
    ),
    vscode.commands.registerCommand("frwAgenticCoding.resetAgentFlow", () =>
      flowState.resetFlow()
    ),
    // Clicking an agent activates it: switches the chat participant, updates the
    // Agent Flow view, auto-enables its declared tools, and warns about missing ones.
    vscode.commands.registerCommand(
      "frwAgenticCoding.useAgent",
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
          flowState,
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
 * Central agent-activation entrypoint invoked from the Agents tree view and
 * from the "re-select agent" button in the Agent Flow sidebar view.
 *
 * Responsibilities:
 *  1. Switch the chat participant to the requested agent.
 *  2. Auto-enable the agent's declared tools in the current chat session.
 *  3. Update the FlowStateService so the sidebar "Agent Flow" view reflects
 *     the new active agent (resets history when switching to a different agent).
 *  4. Reveal the Agent Flow view so the user sees the flow surface.
 *  5. Notify the user about any missing extensions / MCP servers.
 */
async function activateAgent(
  extensionUri: vscode.Uri,
  displayName: string,
  stableId: string | undefined,
  extensionId: string,
  context: vscode.ExtensionContext,
  flowState: FlowStateService,
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

  // 3. Update the sidebar flow state (resets history when the agent changes)
  //    and enable passive activity tracking so the sidebar reflects agent
  //    file opens / edits even if the agent doesn't self-report its steps.
  flowState.setActiveAgent(displayName, stableId);
  flowState.setActivityTrackingEnabled(true);

  // 3b. Parse the agent body for a planned flow (### Step N — <label>) and
  //     seed the sidebar with the full roadmap so the user sees the whole
  //     workflow up-front, with the active step highlighted as it progresses.
  try {
    const planned = await extractPlannedFlow(extensionUri, stableId, displayName);
    if (planned.length > 0) {
      output?.appendLine(`[flow] planned roadmap: ${planned.map((p) => p.label).join(" → ")}`);
      flowState.setPlannedFlow(planned);
    }
  } catch (e) {
    output?.appendLine(`[flow] planned-flow parse failed: ${(e as Error).message}`);
  }

  // 4. Reveal the Agent Flow view so the user sees the flow surface.
  try {
    await vscode.commands.executeCommand("frwAgentFlow.focus");
  } catch { /* view not registered yet — ignore */ }

  // 5. Notify about missing tools/MCP servers.
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
 * Parses an agent's `.agent.md` body and returns its planned roadmap: the
 * ordered list of `### Step N — <label>` headings, optionally followed by a
 * "Review with <specialist>" pseudo-step (from `agent-metadata.json`), and
 * finally by each declared handoff as an outgoing option.
 *
 * The three kinds render distinctly in the sidebar:
 *   - `"step"` — a normal internal phase of the agent (grey dashed circle).
 *   - `"review"` — a review/critique loop with another agent (amber dashed
 *     circle, clickable to jump to the reviewer).
 *   - `"handoff"` — an outgoing handoff option (grey arrow, clickable to
 *     jump to the target agent).
 *
 * Returns an empty array when there is nothing to show — the sidebar then
 * simply renders history + active.
 *
 * Extraction rules for `### Step N` headings (best-effort, forgiving):
 *   - Match `### Step 1 — Label`, `## Step 3: Label`, `#### Step 4 - Label`.
 *   - Preserve appearance order.
 *   - Description = the first non-empty paragraph after the heading (≤200
 *     chars).
 */
async function extractPlannedFlow(
  extensionUri: vscode.Uri,
  stableId: string | undefined,
  displayName: string
): Promise<Array<{
  label: string;
  description?: string;
  kind?: "step" | "review" | "handoff";
  agentName?: string;
  agentStableId?: string;
}>> {
  // Locate the .agent.md file. Prefer stableId; fall back to display-name slug.
  const agentsRoot = vscode.Uri.joinPath(extensionUri, "assets", "generated");
  const candidates: vscode.Uri[] = [];
  const slug = (stableId ?? displayName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Try the known aldc-community location first; then walk any subfolder.
  candidates.push(
    vscode.Uri.joinPath(
      agentsRoot,
      "aldc-community",
      "agents",
      `${slug}.agent.md`
    )
  );

  let body: string | undefined;
  for (const uri of candidates) {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      body = Buffer.from(raw).toString("utf8");
      break;
    } catch {
      // Try next candidate.
    }
  }
  if (!body) {
    // Fallback: scan the whole generated tree for a matching file.
    body = await findAgentBodyByBasename(agentsRoot, `${slug}.agent.md`);
  }
  if (!body) {
    return [];
  }

  // Strip the YAML frontmatter and our injected flow-reporting block so they
  // don't interfere with heading matching, but keep the raw frontmatter for
  // handoff extraction below.
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/m.exec(body);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";
  const stripped = body
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, "")
    .replace(
      /<!--\s*BEGIN:AC-DC-FLOW-REPORTING\s*-->[\s\S]*?<!--\s*END:AC-DC-FLOW-REPORTING\s*-->/g,
      ""
    );

  // ── 1. Parse internal Step N headings ────────────────────────────────────
  const headingRegex = /^#{2,4}\s*Step\s*\d+\s*[—\-:.]\s*(.+?)\s*$/gim;
  const results: Array<{
    label: string;
    description?: string;
    kind?: "step" | "review" | "handoff";
    agentName?: string;
    agentStableId?: string;
  }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(stripped)) !== null) {
    const label = match[1].trim();
    const afterIdx = match.index + match[0].length;
    const rest = stripped.slice(afterIdx, afterIdx + 800);
    const paragraph = rest
      .split(/\r?\n\s*\r?\n/)
      .map((p) => p.trim())
      .find((p) => p.length > 0 && !p.startsWith("#"));
    const description = paragraph
      ? paragraph.replace(/\s+/g, " ").slice(0, 200)
      : undefined;
    results.push({ label, description, kind: "step" });
  }

  // ── 2. Append a review pseudo-step (if metadata declares a reviewer) ─────
  const metadata = await loadAgentMetadata(extensionUri);
  const reviewer = stableId ? metadata[stableId]?.bcReviewSpecialist : undefined;
  if (reviewer) {
    const reviewerSlug = reviewer
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    results.push({
      label: `Review with ${reviewer}`,
      description: `Hand off for review by ${reviewer}. May loop back with critique.`,
      kind: "review",
      agentName: reviewer,
      agentStableId: reviewerSlug,
    });
  }

  // ── 3. Append handoff options parsed from `handoffs:` frontmatter ────────
  for (const h of parseHandoffs(frontmatter)) {
    const targetSlug = h.agent
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    results.push({
      label: h.label,
      description: h.prompt ? `Hand off to ${h.agent}: ${h.prompt}` : `Hand off to ${h.agent}`,
      kind: "handoff",
      agentName: h.agent,
      agentStableId: targetSlug,
    });
  }

  return results;
}

/**
 * Extracts the `bcReviewSpecialist` mapping from the extension-only metadata
 * manifest. This is the same file consumed by the agent-workflow service —
 * we read it standalone here so the planned-flow extraction stays self-
 * contained.
 */
async function loadAgentMetadata(
  extensionUri: vscode.Uri
): Promise<Record<string, { bcReviewSpecialist?: string }>> {
  const uri = vscode.Uri.joinPath(extensionUri, "assets", "agent-metadata.json");
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Parses the YAML `handoffs:` block from an agent's frontmatter. Returns each
 * entry with `label`, `agent`, and optional `prompt`. Deliberately lenient —
 * matches list items with `- label:` / `agent:` / `prompt:` on subsequent
 * indented lines.
 */
function parseHandoffs(
  frontmatter: string
): Array<{ label: string; agent: string; prompt?: string }> {
  const lines = frontmatter.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /^handoffs:\s*$/.test(l));
  if (startIdx < 0) { return []; }

  const results: Array<{ label: string; agent: string; prompt?: string }> = [];
  let current: { label?: string; agent?: string; prompt?: string } | undefined;

  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    // Any non-indented line ends the handoffs block.
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }
    const labelMatch = /^\s*-\s*label:\s*(.+?)\s*$/.exec(line);
    if (labelMatch) {
      if (current && current.label && current.agent) {
        results.push(current as { label: string; agent: string; prompt?: string });
      }
      current = { label: unquote(labelMatch[1]) };
      continue;
    }
    const agentMatch = /^\s+agent:\s*(.+?)\s*$/.exec(line);
    if (agentMatch && current) {
      current.agent = unquote(agentMatch[1]);
      continue;
    }
    const promptMatch = /^\s+prompt:\s*(.+?)\s*$/.exec(line);
    if (promptMatch && current) {
      current.prompt = unquote(promptMatch[1]);
    }
  }
  if (current && current.label && current.agent) {
    results.push(current as { label: string; agent: string; prompt?: string });
  }
  return results;
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

/**
 * Recursively searches `root` for a file with basename `basename` and returns
 * its body as text. Returns undefined when nothing is found. Used as a
 * fallback when the well-known `aldc-community/agents/<slug>.agent.md` path
 * does not resolve (e.g. because the slug was inferred from displayName).
 */
async function findAgentBodyByBasename(
  root: vscode.Uri,
  basename: string
): Promise<string | undefined> {
  const walk = async (dir: vscode.Uri): Promise<string | undefined> => {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return undefined;
    }
    for (const [name, type] of entries) {
      const child = vscode.Uri.joinPath(dir, name);
      if (type === vscode.FileType.Directory) {
        const found = await walk(child);
        if (found) { return found; }
      } else if (type === vscode.FileType.File && name === basename) {
        try {
          const raw = await vscode.workspace.fs.readFile(child);
          return Buffer.from(raw).toString("utf8");
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  };
  return walk(root);
}


