import * as vscode from "vscode";

export interface AgentWorkflowHandoff {
  label: string;
  targetDisplayName: string;
  targetStableId?: string;
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
  requiredTools?: string[];
  handoffs: AgentWorkflowHandoff[];
  incoming: Array<{
    sourceDisplayName: string;
    label: string;
  }>;
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
  stableId?: string
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
          label: handoff.label,
        }))
    )
    .sort((a, b) => a.sourceDisplayName.localeCompare(b.sourceDisplayName));

  const mermaid = buildMermaidSequenceDiagram(selected, handoffs, incoming);
  const svg = buildSvgDiagram(selected.name, handoffs, incoming);

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
    requiredTools: selected.tools,
    handoffs,
    incoming,
  };
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
 * Build a sequence diagram as SVG showing the approval workflow.
 * Vertical flow: User → Agent → Specialist → Approved? → Handoffs (with rejection loop)
 */
export function buildSvgDiagram(
  selectedName: string,
  handoffs: AgentWorkflowHandoff[],
  _incoming: Array<{ sourceDisplayName: string; label: string }>
): string {
  const agentShort = selectedName.replace(/^AL\s+/i, "");
  const participants = [
    { id: "dev", label: "BC Developer" },
    { id: "agent", label: agentShort },
    { id: "spec", label: "Specialist/Alex" },
  ];
  
  // Add handoff participants
  handoffs.forEach((h, i) => {
    participants.push({ id: `handoff${i}`, label: h.label });
  });

  const PAD = 40;
  const COL_W = 140;
  const _LINE_H = 40;
  const W = PAD * 2 + participants.length * COL_W;
  
  let H = 300 + (handoffs.length > 0 ? handoffs.length * 100 : 0);
  
  // Calculate positions
  const cols = participants.map((p, i) => ({
    ...p,
    x: PAD + i * COL_W + COL_W / 2,
  }));

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;background:var(--vscode-editor-background,#1e1e1e)">`,
    `  <defs>`,
    `    <marker id="seqArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">`,
    `      <polygon points="0,0 8,4 0,8" fill="var(--vscode-descriptionForeground,#888)"/>`,
    `    </marker>`,
    `    <marker id="seqArrowDash" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">`,
    `      <polygon points="0,0 8,4 0,8" fill="#f48482"/>`,
    `    </marker>`,
    `  </defs>`,
    `  <style>`,
    `    .participant-box { fill: var(--vscode-textCodeBlock-background,#252526); stroke: var(--vscode-panel-border,#444); stroke-width: 1.5; }`,
    `    .participant-label { fill: var(--vscode-editor-foreground,#ccc); font-size: 11px; font-weight: 600; font-family: var(--vscode-font-family,sans-serif); }`,
    `    .lifeline { stroke: var(--vscode-descriptionForeground,#888); stroke-width: 1; stroke-dasharray: 2,2; }`,
    `    .activation { fill: var(--vscode-textCodeBlock-background,#252526); stroke: var(--vscode-panel-border,#444); stroke-width: 1.5; }`,
    `    .message-arrow { stroke: var(--vscode-descriptionForeground,#888); stroke-width: 1.5; fill: none; marker-end: url(#seqArrow); }`,
    `    .loop-box { fill: none; stroke: #4b9dd9; stroke-width: 1.5; }`,
    `    .alt-box { fill: none; stroke: #fbbf24; stroke-width: 1.5; }`,
    `    .box-label { fill: #4b9dd9; font-size: 10px; font-weight: 600; font-family: var(--vscode-font-family,sans-serif); }`,
    `    .alt-label { fill: #fbbf24; font-size: 10px; font-weight: 600; font-family: var(--vscode-font-family,sans-serif); }`,
    `    .message-label { fill: var(--vscode-editor-foreground,#ccc); font-size: 10px; font-family: var(--vscode-font-family,sans-serif); }`,
    `    .separator { stroke: var(--vscode-panel-border,#444); stroke-width: 1; }`,
    `  </style>`,
  ];

  // Draw participant boxes
  let y = 20;
  const headerH = 50;
  cols.forEach((col) => {
    lines.push(`  <rect class="participant-box" x="${col.x - 60}" y="${y}" width="120" height="${headerH}" rx="2" />`);
    lines.push(`  <text class="participant-label" x="${col.x}" y="${y + 30}" text-anchor="middle">${svgEsc(col.label)}</text>`);
  });

  y += headerH + 10;
  const _contentStart = y;

  // Draw lifelines
  cols.forEach((col) => {
    lines.push(`  <line class="lifeline" x1="${col.x}" y1="${y}" x2="${col.x}" y2="${H - 30}" />`);
  });

  // Message 1: Dev -> Agent
  let msgY = y + 20;
  lines.push(`  <line class="message-arrow" x1="${cols[0].x}" y1="${msgY}" x2="${cols[1].x}" y2="${msgY}" />`);
  lines.push(`  <text class="message-label" x="${(cols[0].x + cols[1].x) / 2}" y="${msgY - 5}" text-anchor="middle">Analyze Request</text>`);

  // Activation box for agent
  const agentActY = msgY + 10;
  const agentActH = 220 + (handoffs.length > 0 ? handoffs.length * 100 : 0);
  lines.push(`  <rect class="activation" x="${cols[1].x - 8}" y="${agentActY}" width="16" height="${agentActH}" />`);

  // Agent self-message
  msgY += 30;
  lines.push(`  <line class="message-arrow" x1="${cols[1].x + 15}" y1="${msgY}" x2="${cols[1].x + 40}" y2="${msgY}" />`);
  lines.push(`  <line class="message-arrow" x1="${cols[1].x + 40}" y1="${msgY}" x2="${cols[1].x + 40}" y2="${msgY + 20}" />`);
  lines.push(`  <line class="message-arrow" x1="${cols[1].x + 40}" y1="${msgY + 20}" x2="${cols[1].x}" y2="${msgY + 20}" />`);
  lines.push(`  <text class="message-label" x="${cols[1].x + 50}" y="${msgY + 8}" text-anchor="start" font-size="9">Create design</text>`);

  // Message 2: Agent -> Specialist
  msgY += 40;
  lines.push(`  <line class="message-arrow" x1="${cols[1].x}" y1="${msgY}" x2="${cols[2].x}" y2="${msgY}" />`);
  lines.push(`  <text class="message-label" x="${(cols[1].x + cols[2].x) / 2}" y="${msgY - 5}" text-anchor="middle">Review design?</text>`);

  // Activation box for specialist
  const specActY = msgY + 5;
  const specActH = 120 + (handoffs.length > 0 ? handoffs.length * 100 : 0);
  lines.push(`  <rect class="activation" x="${cols[2].x - 8}" y="${specActY}" width="16" height="${specActH}" />`);

  // LOOP box
  msgY += 20;
  const loopY = msgY;
  const loopH = 100 + (handoffs.length > 0 ? handoffs.length * 80 : 0);
  lines.push(`  <rect class="loop-box" x="${PAD}" y="${loopY - 15}" width="${W - PAD * 2}" height="${loopH}" />`);
  lines.push(`  <text class="box-label" x="${PAD + 5}" y="${loopY}">loop Until Design OK</text>`);
  lines.push(`  <line class="loop-box" x1="${PAD}" y1="${loopY + 10}" x2="${W - PAD}" y2="${loopY + 10}" />`);

  // Specialist feedback
  msgY += 20;
  lines.push(`  <line class="message-arrow" x1="${cols[2].x}" y1="${msgY}" x2="${cols[1].x}" y2="${msgY + 10}" stroke-dasharray="5,5" />`);
  lines.push(`  <text class="message-label" x="${(cols[1].x + cols[2].x) / 2}" y="${msgY + 5}" text-anchor="middle">Result (OK/NOK)</text>`);

  // Agent redesign
  msgY += 20;
  lines.push(`  <line class="message-arrow" x1="${cols[1].x + 15}" y1="${msgY}" x2="${cols[1].x + 40}" y2="${msgY}" />`);
  lines.push(`  <line class="message-arrow" x1="${cols[1].x + 40}" y1="${msgY}" x2="${cols[1].x + 40}" y2="${msgY + 20}" />`);
  lines.push(`  <line class="message-arrow" x1="${cols[1].x + 40}" y1="${msgY + 20}" x2="${cols[1].x}" y2="${msgY + 20}" />`);
  lines.push(`  <text class="message-label" x="${cols[1].x + 50}" y="${msgY + 8}" text-anchor="start" font-size="9">Redesign</text>`);

  // ALT box for handoff decision
  msgY += 40;
  const altY = msgY;
  const altH = 50 + (handoffs.length > 0 ? handoffs.length * 80 : 0);
  lines.push(`  <rect class="alt-box" x="${PAD}" y="${altY - 10}" width="${W - PAD * 2}" height="${altH}" />`);
  lines.push(`  <text class="alt-label" x="${PAD + 5}" y="${altY + 5}">alt [Design Decision]</text>`);
  lines.push(`  <line class="alt-box" x1="${PAD}" y1="${altY + 20}" x2="${W - PAD}" y2="${altY + 20}" />`);

  // Draw handoff alternatives
  handoffs.forEach((handoff, idx) => {
    const altIdx = idx;
    const altLabelY = altY + 25 + altIdx * 80;

    // Alt separator
    if (idx > 0) {
      lines.push(`  <line class="alt-box" x1="${PAD}" y1="${altLabelY - 15}" x2="${W - PAD}" y2="${altLabelY - 15}" />`);
    }

    // Alt condition label
    lines.push(`  <text class="alt-label" x="${PAD + 10}" y="${altLabelY}" font-size="11">[${handoff.label}]</text>`);

    // Arrow from agent to handoff participant
    lines.push(`  <line class="message-arrow" x1="${cols[1].x}" y1="${altLabelY + 10}" x2="${cols[3 + idx].x}" y2="${altLabelY + 10}" />`);
    lines.push(`  <text class="message-label" x="${(cols[1].x + cols[3 + idx].x) / 2}" y="${altLabelY + 5}" text-anchor="middle">Handoff</text>`);

    // Activation box for handoff target
    lines.push(`  <rect class="activation" x="${cols[3 + idx].x - 8}" y="${altLabelY + 15}" width="16" height="25" />`);
  });

  lines.push(`</svg>`);

  return lines.join("\n");
}


