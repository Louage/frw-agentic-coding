import * as vscode from "vscode";
import { FlowStateService, type IFlowState, type IFlowPlannedStep } from "../workflows/flowStateService";

interface IAgentFlowMessage {
  type: string;
  agentDisplayName?: string;
  agentStableId?: string;
}

interface IAgentFlowHandlers {
  /** Called when the user asks to switch back to / activate the agent in chat. */
  onSelectAgent: (displayName: string, stableId: string | undefined) => Promise<void>;
  /** Called when the user clicks "Reset flow" in the view. */
  onResetFlow: () => Promise<void>;
}

/**
 * WebviewView provider for the sidebar "Agent Flow" view. Renders a compact
 * top-to-bottom state diagram of the active agent's flow, highlighting the
 * current in-progress step. Updates live whenever the FlowStateService fires.
 *
 * Rendering is intentionally minimal: an inline SVG chain of pills. No
 * external dependencies (no mermaid.js, no CDN scripts) so the view works
 * offline and inside VS Code's default webview CSP.
 */
export class AgentFlowViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "acdc.agentFlow";

  private view?: vscode.WebviewView;

  constructor(
    private readonly stateService: FlowStateService,
    private readonly handlers: IAgentFlowHandlers
  ) {
    this.stateService.onDidChange(() => this.render());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    this.render();
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }
    const payload = message as IAgentFlowMessage;
    if (payload.type === "selectAgent" && payload.agentDisplayName) {
      await this.handlers.onSelectAgent(payload.agentDisplayName, payload.agentStableId);
      return;
    }
    if (payload.type === "resetFlow") {
      await this.handlers.onResetFlow();
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.getHtml(this.stateService.current);
  }

  private getHtml(state: IFlowState | undefined): string {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    const body = state ? renderFlowBody(state) : renderEmpty();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        margin: 0;
        padding: 10px 12px;
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground, #ccc);
      }
      .empty {
        color: var(--vscode-descriptionForeground, #888);
        font-size: 12px;
        line-height: 1.5;
        padding: 20px 4px;
        text-align: center;
      }
      .empty code {
        font-family: var(--vscode-editor-font-family, monospace);
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
        padding: 1px 4px;
        border-radius: 3px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .agent-name {
        background: none;
        border: none;
        color: var(--vscode-textLink-foreground, #3794ff);
        font-weight: 600;
        font-size: 13px;
        padding: 0;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
      }
      .agent-name:hover { text-decoration: underline; }
      .reset {
        background: none;
        border: 1px solid var(--vscode-panel-border, #444);
        color: var(--vscode-descriptionForeground, #888);
        border-radius: 3px;
        padding: 2px 6px;
        cursor: pointer;
        font-size: 11px;
      }
      .reset:hover { color: var(--vscode-foreground, #fff); }
      .chain {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .step {
        position: relative;
        padding: 6px 10px 6px 28px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.35;
        margin-bottom: 2px;
      }
      .step-done {
        color: var(--vscode-descriptionForeground, #999);
        background: rgba(255,255,255,0.02);
      }
      .step-done .marker {
        background: var(--vscode-testing-iconPassed, #6fbf73);
      }
      .step-active {
        color: var(--vscode-foreground, #fff);
        background: rgba(75,157,217,0.14);
        border: 1px solid rgba(75,157,217,0.5);
        font-weight: 600;
      }
      .step-active .marker {
        background: var(--vscode-textLink-foreground, #3794ff);
        box-shadow: 0 0 0 3px rgba(75,157,217,0.2);
        animation: pulse 1.8s ease-in-out infinite;
      }
      .step-planned {
        color: var(--vscode-descriptionForeground, #888);
        opacity: 0.55;
      }
      .step-planned .marker {
        background: transparent;
        border: 1.5px dashed var(--vscode-descriptionForeground, #888);
      }
      /* Review-loop step (planned): amber, indicates critique / feedback loop. */
      .step-review {
        color: var(--vscode-descriptionForeground, #ccc);
        opacity: 0.75;
        background: rgba(217, 119, 6, 0.06);
        border: 1px dashed rgba(217, 119, 6, 0.45);
        cursor: pointer;
      }
      .step-review .marker {
        background: transparent;
        border: 1.5px dashed rgba(217, 119, 6, 0.9);
      }
      .step-review:hover { opacity: 1; background: rgba(217, 119, 6, 0.12); }
      /* Handoff step (planned): arrow prefix, clickable to activate target. */
      .step-handoff {
        color: var(--vscode-descriptionForeground, #ccc);
        opacity: 0.7;
        background: rgba(255,255,255,0.02);
        border: 1px dashed var(--vscode-panel-border, #444);
        cursor: pointer;
      }
      .step-handoff .marker {
        background: transparent;
        border: 1.5px dashed var(--vscode-descriptionForeground, #888);
      }
      .step-handoff:hover { opacity: 1; background: rgba(75,157,217,0.08); border-color: rgba(75,157,217,0.4); }
      .step-agent-target {
        font-size: 10px;
        color: var(--vscode-textLink-foreground, #3794ff);
        margin-top: 2px;
      }
      .marker {
        position: absolute;
        left: 10px;
        top: 10px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .connector {
        margin-left: 14px;
        width: 2px;
        height: 8px;
        background: var(--vscode-panel-border, #444);
      }
      .skill {
        font-size: 10px;
        color: var(--vscode-descriptionForeground, #888);
        font-style: italic;
        margin-top: 2px;
      }
      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 3px rgba(75,157,217,0.2); }
        50%       { box-shadow: 0 0 0 6px rgba(75,157,217,0.1); }
      }
    </style>
  </head>
  <body>
    ${body}
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll("[data-select-agent]").forEach(function (el) {
        el.addEventListener("click", function () {
          vscode.postMessage({
            type: "selectAgent",
            agentDisplayName: el.getAttribute("data-agent-name"),
            agentStableId: el.getAttribute("data-agent-id") || undefined,
          });
        });
      });
      const resetBtn = document.getElementById("resetBtn");
      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          vscode.postMessage({ type: "resetFlow" });
        });
      }
    </script>
  </body>
</html>`;
  }
}

function renderEmpty(): string {
  return `<div class="empty">
    No agent selected.<br /><br />
    Pick an agent from the <strong>Agents</strong> view above to start.<br /><br />
    The active agent updates this flow via the <code>acdcUpdateAgentFlow</code> tool as it moves through its workflow.
  </div>`;
}

function renderFlowBody(state: IFlowState): string {
  const nameAttr = escapeAttr(state.agentDisplayName);
  const idAttr = escapeAttr(state.agentStableId ?? "");

  // Build the set of tokens already reached (history + active) so we can hide
  // planned entries that overlap significantly with completed / active steps.
  const reachedTokens: string[][] = [];
  for (const h of state.history) {
    reachedTokens.push(tokenise(h.label));
  }
  if (state.active) {
    reachedTokens.push(tokenise(state.active.label));
  }

  const items: string[] = [];

  // Completed steps (green).
  for (const step of state.history) {
    items.push(renderStep(step.label, step.skill, "done"));
    items.push('<div class="connector"></div>');
  }

  // Active step (blue, pulsing).
  if (state.active) {
    items.push(renderStep(state.active.label, state.active.skill, "active"));
  }

  // Planned/upcoming steps (dimmed dashed circles) — hide any that
  // significantly overlap with a reached label.
  const remainingPlanned = (state.planned ?? []).filter((p) => {
    const plannedTokens = tokenise(p.label);
    return !reachedTokens.some((reached) => overlapRatio(plannedTokens, reached) >= 0.5);
  });
  if (remainingPlanned.length > 0) {
    // Small connector to visually link the active step to the planned list.
    if (state.active || state.history.length > 0) {
      items.push('<div class="connector"></div>');
    }
    for (let i = 0; i < remainingPlanned.length; i += 1) {
      const p = remainingPlanned[i];
      items.push(renderPlannedStep(p));
      if (i < remainingPlanned.length - 1) {
        items.push('<div class="connector"></div>');
      }
    }
  }

  if (items.length === 0) {
    items.push(`<div class="empty">Waiting for the agent to report its first step\u2026</div>`);
  }

  return `<div class="header">
    <button class="agent-name" data-select-agent data-agent-name="${nameAttr}" data-agent-id="${idAttr}" title="Re-select this agent in chat">
      ${escapeHtml(state.agentDisplayName)}
    </button>
    <button id="resetBtn" class="reset" title="Clear the flow history for this agent">Reset</button>
  </div>
  <div class="chain">
    ${items.join("\n    ")}
  </div>`;
}

function renderStep(label: string, skill: string | undefined, kind: "done" | "active"): string {
  const cls = kind === "active" ? "step step-active" : "step step-done";
  const skillMarkup = skill ? `<div class="skill">${escapeHtml(skill)}</div>` : "";
  return `<div class="${cls}"><span class="marker"></span>${escapeHtml(label)}${skillMarkup}</div>`;
}

function renderPlannedStep(step: IFlowPlannedStep): string {
  const kind = step.kind ?? "step";
  const tip = step.description ? ` title="${escapeAttr(step.description)}"` : "";

  // Review + handoff entries are clickable — clicking activates the target agent.
  const clickable = (kind === "handoff" || kind === "review") && step.agentName;
  const clickAttrs = clickable
    ? ` data-select-agent data-agent-name="${escapeAttr(step.agentName!)}" data-agent-id="${escapeAttr(step.agentStableId ?? "")}"`
    : "";

  const cls =
    kind === "handoff" ? "step step-handoff" :
    kind === "review" ? "step step-review" :
    "step step-planned";

  // Prefix: arrow for handoff, review-circle for review, nothing for plain step.
  const prefix =
    kind === "handoff" ? "&#8594; " :
    kind === "review" ? "&#8635; " :
    "";

  const targetMarkup = clickable
    ? `<div class="step-agent-target">${escapeHtml(step.agentName!)}</div>`
    : "";

  return `<div class="${cls}"${clickAttrs}${tip}><span class="marker"></span>${prefix}${escapeHtml(step.label)}${targetMarkup}</div>`;
}

/**
 * Splits a label into a set of significant lowercase word tokens (≥3 chars,
 * common stop-words removed). Used to match free-form agent-reported labels
 * against curated planned-flow labels with a tolerant heuristic.
 */
function tokenise(label: string): string[] {
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "into", "onto", "per",
    "step", "phase", "task", "run", "use",
  ]);
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
}

/**
 * Returns the fraction of `planned` tokens that appear in `reached`. Symmetric
 * enough that any planned step whose meaningful words are >= 50% present in a
 * reached label is treated as "already done" and dropped from the roadmap.
 */
function overlapRatio(planned: string[], reached: string[]): number {
  if (planned.length === 0 || reached.length === 0) {
    return 0;
  }
  const reachedSet = new Set(reached);
  let hits = 0;
  for (const t of planned) {
    if (reachedSet.has(t)) {
      hits += 1;
    }
  }
  return hits / planned.length;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
