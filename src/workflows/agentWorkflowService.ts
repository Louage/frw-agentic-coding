import * as vscode from "vscode";
import { getAvailableMcpServerIds, checkToolAvailability } from "../tools/mcpDiscoveryService";
import { lookupKnownTool, type KnownToolSuggestion } from "../tools/knownToolsCatalog";

export interface AgentWorkflowHandoff {
  label: string;
  targetDisplayName: string;
  targetStableId?: string;
}

export interface AgentWorkflowIncomingRoute {
  sourceDisplayName: string;
  sourceStableId?: string;
  label: string;
}

export interface AgentWorkflowTool {
  id: string;
  available: boolean;
  /** True when the tool is known-deprecated and will be removed on next sync — do not count as an error */
  deprecated?: boolean;
  suggestion?: KnownToolSuggestion;
}

export interface AgentWorkflowViewModel {
  title: string;
  description: string;
  mermaid: string;
  svg: string;
  currentAgent: {
    displayName: string;
    stableId?: string;
  };
  bcReviewSpecialist?: string;
  requiredTools?: AgentWorkflowTool[];
  requiredMcpServers?: AgentWorkflowTool[];
  handoffs: AgentWorkflowHandoff[];
  incoming: AgentWorkflowIncomingRoute[];
}

interface ParsedHandoff {
  label: string;
  agentName: string;
}

interface ParsedAgent {
  fileId: string;
  name: string;
  userInvocable: boolean;
  handoffs: ParsedHandoff[];
  bcReviewSpecialist?: string;
  tools?: string[];
}

export async function getAgentWorkflowViewModel(
  extensionUri: vscode.Uri,
  displayName: string,
  stableId?: string,
  context?: vscode.ExtensionContext
): Promise<AgentWorkflowViewModel> {
  const agents = await loadAgents(extensionUri);
  const byId = new Map(agents.map((agent) => [agent.fileId.toLowerCase(), agent]));
  const byName = new Map(agents.map((agent) => [agent.name.toLowerCase(), agent]));

  const selected =
    (stableId ? byId.get(stableId.toLowerCase()) : undefined) ??
    byName.get(displayName.toLowerCase()) ?? {
      fileId: stableId ?? displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: displayName,
      userInvocable: true,
      handoffs: [],
    };

  const handoffs = selected.handoffs.map((handoff) => {
    const target = byName.get(handoff.agentName.toLowerCase());
    return {
      label: handoff.label,
      targetDisplayName: handoff.agentName,
      targetStableId: target?.fileId,
    };
  });

  const incoming = agents
    .flatMap((agent) =>
      agent.handoffs
        .filter(
          (handoff) => handoff.agentName.toLowerCase() === selected.name.toLowerCase()
        )
        .map((handoff) => ({
          sourceDisplayName: agent.name,
          sourceStableId: agent.fileId,
          label: handoff.label,
        }))
    )
    .sort((a, b) => a.sourceDisplayName.localeCompare(b.sourceDisplayName));

  const mermaid = buildMermaidSequenceDiagram(selected, handoffs, incoming);
  const svg = buildSvgDiagram(selected.name, handoffs, incoming);

  // Resolve tool availability against the user's configured MCP servers
  let requiredTools: AgentWorkflowTool[] | undefined;
  let requiredMcpServers: AgentWorkflowTool[] | undefined;
  if (selected.tools && selected.tools.length > 0) {
    const availableServers = context
      ? await getAvailableMcpServerIds(context)
      : new Set<string>();
    const requirements = checkToolAvailability(selected.tools, availableServers);
    requiredTools = requirements.filter((r) => !isMcpRequirement(r.id, availableServers));
    requiredMcpServers = requirements.filter((r) => isMcpRequirement(r.id, availableServers));
  }

  return {
    title: `${selected.name} Workflow`,
    description: `${handoffs.length} outgoing handoff(s), ${incoming.length} incoming path(s)`,
    mermaid,
    svg,
    currentAgent: {
      displayName: selected.name,
      stableId: selected.fileId,
    },
    bcReviewSpecialist: selected.bcReviewSpecialist,
    requiredTools,
    requiredMcpServers,
    handoffs,
    incoming,
  };
}

function isMcpRequirement(id: string, availableServers: Set<string>): boolean {
  const known = lookupKnownTool(id);
  if (known?.type === "mcp-server") {
    return true;
  }
  if (known?.type === "vscode-extension") {
    return false;
  }

  // Built-in tool groups are not MCP servers.
  const builtins = new Set(["read", "search", "edit", "execute", "web", "browser", "agent", "todo", "new", "changes"]);
  if (builtins.has(id)) {
    return false;
  }

  // If this id appears as a discovered server id, treat it as MCP.
  if (availableServers.has(id)) {
    return true;
  }

  // Heuristic fallback for unknown ids: names containing "mcp" are MCP servers.
  return /(^|[-_.])mcp($|[-_.])/i.test(id);
}

async function loadAgents(extensionUri: vscode.Uri): Promise<ParsedAgent[]> {
  const root = vscode.Uri.joinPath(extensionUri, "assets", "generated");
  const files = await findAgentFiles(root);

  const parsed: ParsedAgent[] = [];
  for (const file of files) {
    const text = await readText(file);
    const fm = extractFrontmatter(text);
    if (!fm) {
      continue;
    }

    const fileName = file.path.split("/").at(-1) ?? "";
    const fileId = fileName.replace(/\.agent\.md$/i, "");
    const name = readScalar(fm, "name") ?? fileId;
    const userInvocable = (readScalar(fm, "user-invocable") ?? "true")
      .toLowerCase()
      .trim() !== "false";
    const handoffs = readHandoffs(fm);
    const bcReviewSpecialist = readScalar(fm, "bc-review-specialist");
    const tools = readTools(fm);

    parsed.push({
      fileId,
      name,
      userInvocable,
      handoffs,
      bcReviewSpecialist,
      tools,
    });
  }

  return parsed.filter((agent) => agent.userInvocable);
}

async function findAgentFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
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
      } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".agent.md")) {
        results.push(child);
      }
    }
  };

  await walk(root);
  return results;
}

async function readText(uri: vscode.Uri): Promise<string> {
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString("utf8");
}

function extractFrontmatter(content: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match?.[1];
}

function readScalar(frontmatter: string, key: string): string | undefined {
  const regex = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, "m");
  const match = regex.exec(frontmatter);
  if (!match) {
    return undefined;
  }
  return unquote(match[1].trim());
}

function readHandoffs(frontmatter: string): ParsedHandoff[] {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^handoffs:\s*$/.test(line));
  if (start < 0) {
    return [];
  }

  const handoffs: ParsedHandoff[] = [];
  let current: ParsedHandoff | undefined;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }

    const labelMatch = /^\s*-\s*label:\s*(.*)$/.exec(line);
    if (labelMatch) {
      if (current && current.label && current.agentName) {
        handoffs.push(current);
      }
      current = {
        label: unquote(labelMatch[1].trim()),
        agentName: "",
      };
      continue;
    }

    const agentMatch = /^\s+agent:\s*(.*)$/.exec(line);
    if (agentMatch) {
      if (!current) {
        current = { label: "Handoff", agentName: "" };
      }
      current.agentName = unquote(agentMatch[1].trim());
    }
  }

  if (current && current.label && current.agentName) {
    handoffs.push(current);
  }

  return handoffs;
}

function readTools(frontmatter: string): string[] {
  const toolsScalar = readScalar(frontmatter, "tools");
  if (!toolsScalar) {
    return [];
  }

  // Parse array format: [tool1, tool2, 'tool3', "tool4"]
  const arrayMatch = /^\[(.+)\]$/.exec(toolsScalar.trim());
  if (!arrayMatch) {
    return [];
  }

  const content = arrayMatch[1];
  const tools = content.split(",").map((t) => {
    const trimmed = t.trim();
    // Remove quotes
    const unquoted = trimmed.replace(/^['"]|['"]$/g, "");
    return unquoted;
  });

  // Filter for MCP tools (contain "/" or "-mcp"), and exclude standard ones
  return tools
    .filter((t) => (t.includes("/") || t.includes("-mcp")) && !t.startsWith("vscode/"))
    .map((t) => {
      // Normalize tool name for display (e.g., "bc-code-intelligence-mcp/*" → "bc-code-intelligence-mcp")
      return t.replace(/\/\*$/, "").replace(/\/.*/, "");
    })
    .filter((v, i, a) => a.indexOf(v) === i); // Deduplicate
}

function buildMermaidSequenceDiagram(
  selected: ParsedAgent,
  handoffs: AgentWorkflowHandoff[],
  _incoming: Array<{ sourceDisplayName: string; label: string }>
): string {
  const lines: string[] = [
    "sequenceDiagram",
    "  participant User",
    `  participant Agent as ${mermaidNode(selected.name)}`,
    `  participant Specialist as ${selected.bcReviewSpecialist ? mermaidNode(selected.bcReviewSpecialist.split("(")[0].trim()) : "BC Specialist"}`,
  ];

  if (handoffs.length > 0) {
    lines.push(`  participant Handoff as Handoff Agents`);
  }

  lines.push("");
  lines.push("  User->>Agent: Start workflow");
  lines.push("  Agent->>Agent: Analyze task & prepare");
  lines.push(`  Agent->>Specialist: Send for ${selected.bcReviewSpecialist ? "specialist review" : "review"}`);
  lines.push("  rect rgb(31, 118, 110)");
  lines.push("    Specialist->>Specialist: Review implementation");
  lines.push("  end");
  lines.push("  alt Approved");
  lines.push("    Specialist-->>Agent: ✓ Approved");

  if (handoffs.length > 0) {
    lines.push("    Agent->>Handoff: Send for next phase");
    lines.push("    Handoff-->>Agent: Complete");
    lines.push("    Agent-->>User: ✓ Done");
  } else {
    lines.push("    Agent-->>User: ✓ Complete");
  }

  lines.push("  else Changes needed");
  lines.push("    Specialist-->>Agent: Changes: [remarks]");
  lines.push("    Agent->>Agent: Incorporate feedback");
  lines.push("    Note over Agent: Re-submit to Specialist");
  lines.push("  end");

  return lines.join("\n");
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unquote(value: string): string {
  return value.replace(/^['\"]|['\"]$/g, "");
}

/** Escape text for Mermaid labels: remove problematic chars, keep readable. */
function mermaidNode(value: string): string {
  return value
    .replace(/"/g, "'")
    .replace(/[\n\r]/g, " ");
}

function svgEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build a simple state-diagram style SVG with exactly 3 blocks:
 * Incoming Routes | The Agent | Outgoing Routes
 */
export function buildSvgDiagram(
  selectedName: string,
  handoffs: AgentWorkflowHandoff[],
  incoming: AgentWorkflowIncomingRoute[]
): string {
  const clean = (v: string) => v.replace(/^AL\s+/i, "").trim();
  const agentName = clean(selectedName);

  const incomingItems = incoming.length > 0
    ? incoming.map((i) => ({
      label: clean(i.sourceDisplayName),
      exact: i.sourceDisplayName,
    }))
    : ["No incoming routes"];
  const outgoingItems = handoffs.length > 0
    ? handoffs.map((h) => ({
      label: clean(h.label),
      exact: h.targetDisplayName,
    }))
    : ["No outgoing routes"];

  const PAD = 24;
  const GAP = 20;
  const BLOCK_W = 260;
  const HEADER_H = 34;
  const ITEM_H = 20;
  const ITEM_GAP = 6;

  const maxRows = Math.max(incomingItems.length, outgoingItems.length, 4);
  const innerH = 30 + (maxRows * (ITEM_H + ITEM_GAP)) + 30;
  const blockH = HEADER_H + innerH;

  const W = PAD * 2 + BLOCK_W * 3 + GAP * 2;
  const H = PAD * 2 + blockH;

  const xIncoming = PAD;
  const xAgent = xIncoming + BLOCK_W + GAP;
  const xOutgoing = xAgent + BLOCK_W + GAP;
  const y = PAD;

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;background:var(--vscode-editor-background,#1e1e1e)">`,
    `  <defs>`,
    `    <marker id="stateArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">`,
    `      <polygon points="0,0 8,4 0,8" fill="var(--vscode-descriptionForeground,#888)"/>`,
    `    </marker>`,
    `  </defs>`,
    `  <style>`,
    `    .block { fill: var(--vscode-textCodeBlock-background,#252526); stroke: var(--vscode-panel-border,#444); stroke-width: 1.5; }`,
    `    .title { fill: var(--vscode-editor-foreground,#ccc); font-size: 13px; font-weight: 700; font-family: var(--vscode-font-family,sans-serif); }`,
    `    .item { fill: var(--vscode-editor-foreground,#ccc); font-size: 11px; font-family: var(--vscode-font-family,sans-serif); }`,
    `    .agentState { fill: rgba(75,157,217,0.12); stroke: #4b9dd9; stroke-width: 1.2; }`,
    `    .agentStep { fill: #9cd2ff; font-size: 10px; font-family: var(--vscode-font-family,sans-serif); }`,
    `    .arrow { stroke: var(--vscode-descriptionForeground,#888); stroke-width: 1.4; fill:none; marker-end:url(#stateArrow); }`,
    `  </style>`,
  ];

  // 3 fixed blocks
  lines.push(`  <rect class="block" x="${xIncoming}" y="${y}" width="${BLOCK_W}" height="${blockH}" rx="8" />`);
  lines.push(`  <rect class="block" x="${xAgent}" y="${y}" width="${BLOCK_W}" height="${blockH}" rx="8" />`);
  lines.push(`  <rect class="block" x="${xOutgoing}" y="${y}" width="${BLOCK_W}" height="${blockH}" rx="8" />`);

  lines.push(`  <text class="title" x="${xIncoming + 12}" y="${y + 22}">Incoming Routes</text>`);
  lines.push(`  <text class="title" x="${xAgent + 12}" y="${y + 22}">${svgEsc(agentName)}</text>`);
  lines.push(`  <text class="title" x="${xOutgoing + 12}" y="${y + 22}">Outgoing Routes</text>`);

  // Incoming list
  let yInc = y + HEADER_H + 16;
  incomingItems.forEach((item, idx) => {
    const name = typeof item === "string" ? item : item.label;
    const exact = typeof item === "string" ? item : item.exact;
    const label = `${String.fromCharCode(65 + (idx % 26))}: ${name}`;
    if (incoming.length > 0) {
      lines.push(`  <g class="nav-incoming" data-incoming-index="${idx}" style="cursor:pointer">`);
      lines.push(`    <title>Agent: ${svgEsc(exact)}</title>`);
      lines.push(`    <text class="item" x="${xIncoming + 14}" y="${yInc}">${svgEsc(label)}</text>`);
      lines.push(`  </g>`);
    } else {
      lines.push(`  <text class="item" x="${xIncoming + 14}" y="${yInc}">${svgEsc(label)}</text>`);
    }
    yInc += ITEM_H + ITEM_GAP;
  });

  // Agent inner state-like box + minimal flow
  const agentInnerX = xAgent + 12;
  const agentInnerY = y + HEADER_H + 8;
  const agentInnerW = BLOCK_W - 24;
  const agentInnerH = innerH - 16;
  lines.push(`  <rect class="agentState" x="${agentInnerX}" y="${agentInnerY}" width="${agentInnerW}" height="${agentInnerH}" rx="6" />`);

  const steps = getAgentStateSteps(agentName, handoffs);
  const s1y = agentInnerY + 26;
  const s2y = s1y + 30;
  const s3y = s2y + 30;
  lines.push(`  <text class="agentStep" x="${agentInnerX + 10}" y="${s1y}">${svgEsc(steps[0])}</text>`);
  lines.push(`  <text class="agentStep" x="${agentInnerX + 10}" y="${s2y}">${svgEsc(steps[1])}</text>`);
  lines.push(`  <text class="agentStep" x="${agentInnerX + 10}" y="${s3y}">${svgEsc(steps[2])}</text>`);
  lines.push(`  <line class="arrow" x1="${agentInnerX + 6}" y1="${s1y + 6}" x2="${agentInnerX + 6}" y2="${s2y - 10}" />`);
  lines.push(`  <line class="arrow" x1="${agentInnerX + 6}" y1="${s2y + 6}" x2="${agentInnerX + 6}" y2="${s3y - 10}" />`);

  // Outgoing list
  let yOut = y + HEADER_H + 16;
  outgoingItems.forEach((item, idx) => {
    const name = typeof item === "string" ? item : item.label;
    const exact = typeof item === "string" ? item : item.exact;
    const label = `${String.fromCharCode(89 + (idx % 2))}: ${name}`; // Y, Z style hint
    if (handoffs.length > 0) {
      lines.push(`  <g class="nav-handoff" data-handoff-index="${idx}" style="cursor:pointer">`);
      lines.push(`    <title>Agent: ${svgEsc(exact)}</title>`);
      lines.push(`    <text class="item" x="${xOutgoing + 14}" y="${yOut}">${svgEsc(label)}</text>`);
      lines.push(`  </g>`);
    } else {
      lines.push(`  <text class="item" x="${xOutgoing + 14}" y="${yOut}">${svgEsc(label)}</text>`);
    }
    yOut += ITEM_H + ITEM_GAP;
  });

  // Cross-block arrows (state transitions)
  const midY = y + HEADER_H + 30;
  lines.push(`  <line class="arrow" x1="${xIncoming + BLOCK_W}" y1="${midY}" x2="${xAgent}" y2="${midY}" />`);
  lines.push(`  <line class="arrow" x1="${xAgent + BLOCK_W}" y1="${midY}" x2="${xOutgoing}" y2="${midY}" />`);

  lines.push(`</svg>`);
  return lines.join("\n");
}

function getAgentStateSteps(
  agentName: string,
  handoffs: AgentWorkflowHandoff[]
): [string, string, string] {
  const n = agentName.toLowerCase();
  const handoffTarget = handoffs[0]?.label ? `Handoff: ${handoffs[0].label}` : "Handoff";

  if (n.includes("architect") || n.includes("design")) {
    return ["Analyze Request", "Ask BC Expert (check)", handoffTarget];
  }
  if (n.includes("implementation") || n.includes("developer")) {
    return ["Analyze Spec", "Implement Changes", handoffTarget];
  }
  if (n.includes("conductor")) {
    return ["Plan Phases", "Delegate Work", handoffTarget];
  }
  if (n.includes("review")) {
    return ["Review Deliverable", "Validate Rules", handoffTarget];
  }
  if (n.includes("triage") || n.includes("tester")) {
    return ["Assess Issue", "Define Test Strategy", handoffTarget];
  }
  if (n.includes("presales") || n.includes("market")) {
    return ["Analyze Opportunity", "Shape Proposal", handoffTarget];
  }
  if (n.includes("agent builder")) {
    return ["Analyze Request", "Create Agent Design", handoffTarget];
  }
  if (n.includes("dredd") || n.includes("debug")) {
    return ["Inspect Failure", "Propose Fix Path", handoffTarget];
  }

  return ["Analyze Request", "Ask Specialist (check)", handoffTarget];
}


